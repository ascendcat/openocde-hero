import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ScheduledRunTable, ScheduledTaskTable } from "@opencode-ai/core/schedule/sql"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { Identifier } from "@/id/id"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { and, asc, desc, eq, lte } from "drizzle-orm"
import { CronExpressionParser } from "cron-parser"
import { Cause, Context, Duration, Effect, Layer, Schedule, Schema, Scope } from "effect"

export const TaskID = Schema.String.check(Schema.isStartsWith("tsk_"))
  .pipe(Schema.brand("ScheduledTaskID"))
  .annotate({ identifier: "ScheduledTask.ID" })
export type TaskID = typeof TaskID.Type

export const RunID = Schema.String.check(Schema.isStartsWith("run_"))
  .pipe(Schema.brand("ScheduledRunID"))
  .annotate({ identifier: "ScheduledRun.ID" })
export type RunID = typeof RunID.Type

const Model = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
  variant: Schema.optional(Schema.String),
})

export const Task = Schema.Struct({
  id: TaskID,
  projectID: Schema.String,
  directory: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  cron: Schema.String,
  timezone: Schema.String,
  enabled: Schema.Boolean,
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Model),
  autoApprove: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.Number),
  lastRunAt: Schema.NullOr(Schema.Number),
  lastRunStatus: Schema.NullOr(Schema.Literals(["success", "failed"])),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "ScheduledTask" })
export type Task = typeof Task.Type

export const Run = Schema.Struct({
  id: RunID,
  taskID: TaskID,
  sessionID: Schema.NullOr(Schema.String),
  trigger: Schema.Literals(["schedule", "manual"]),
  status: Schema.Literals(["running", "success", "failed"]),
  time: Schema.Struct({
    started: Schema.Number,
    finished: Schema.NullOr(Schema.Number),
  }),
  error: Schema.NullOr(Schema.String),
}).annotate({ identifier: "ScheduledRun" })
export type Run = typeof Run.Type

export const CreateInput = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  cron: Schema.String,
  timezone: Schema.String,
  enabled: Schema.Boolean,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Model),
  autoApprove: Schema.Boolean,
})
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  prompt: Schema.optionalKey(Schema.String),
  cron: Schema.optionalKey(Schema.String),
  timezone: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  agent: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Model),
  clearAgent: Schema.optionalKey(Schema.Boolean),
  clearModel: Schema.optionalKey(Schema.Boolean),
  autoApprove: Schema.optionalKey(Schema.Boolean),
})
export type UpdateInput = typeof UpdateInput.Type

export class InvalidCronError extends Schema.TaggedErrorClass<InvalidCronError>()("ScheduledTask.InvalidCronError", {
  expression: Schema.String,
  timezone: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ScheduledTask.NotFoundError", {
  id: TaskID,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Task[]>
  readonly get: (id: TaskID) => Effect.Effect<Task, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Task, InvalidCronError>
  readonly update: (id: TaskID, input: UpdateInput) => Effect.Effect<Task, InvalidCronError | NotFoundError>
  readonly remove: (id: TaskID) => Effect.Effect<void, NotFoundError>
  readonly runs: (id: TaskID, limit?: number) => Effect.Effect<Run[], NotFoundError>
  readonly run: (id: TaskID, trigger?: Run["trigger"]) => Effect.Effect<Run, NotFoundError>
  readonly validate: (
    expression: string,
    timezone: string,
  ) => Effect.Effect<{ nextRunAt: number }, InvalidCronError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ScheduledTask") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const instances = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const prompts = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope
    const running = new Set<TaskID>()

    yield* db
      .update(ScheduledRunTable)
      .set({
        status: "failed",
        time_finished: Date.now(),
        error: "OpenCode restarted before this run completed.",
      })
      .where(eq(ScheduledRunTable.status, "running"))
      .run()
      .pipe(Effect.orDie)

    const validate = Effect.fn("ScheduledTask.validate")(function* (expression: string, timezone: string) {
      const next = nextRun(expression, timezone)
      if (next === undefined) return yield* new InvalidCronError({ expression, timezone })
      return { nextRunAt: next }
    })

    const get = Effect.fn("ScheduledTask.get")(function* (id: TaskID) {
      const row = yield* db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ id })
      return fromTaskRow(row)
    })

    const list = Effect.fn("ScheduledTask.list")(function* () {
      const ctx = yield* InstanceState.context
      const rows = yield* db
        .select()
        .from(ScheduledTaskTable)
        .where(eq(ScheduledTaskTable.project_id, ctx.project.id))
        .orderBy(asc(ScheduledTaskTable.name))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromTaskRow)
    })

    const create = Effect.fn("ScheduledTask.create")(function* (input: CreateInput) {
      const ctx = yield* InstanceState.context
      const next = yield* validate(input.cron, input.timezone)
      const id = TaskID.make(Identifier.ascending("scheduledTask"))
      yield* db
        .insert(ScheduledTaskTable)
        .values({
          id,
          project_id: ctx.project.id,
          directory: ctx.directory,
          name: input.name,
          prompt: input.prompt,
          cron: input.cron,
          timezone: input.timezone,
          enabled: input.enabled,
          agent: input.agent,
          model: input.model,
          auto_approve: input.autoApprove,
          next_run_at: input.enabled ? next.nextRunAt : null,
        })
        .run()
        .pipe(Effect.orDie)
      return yield* get(id).pipe(Effect.orDie)
    })

    const update = Effect.fn("ScheduledTask.update")(function* (id: TaskID, input: UpdateInput) {
      const current = yield* get(id)
      const expression = input.cron ?? current.cron
      const timezone = input.timezone ?? current.timezone
      const next = yield* validate(expression, timezone)
      const enabled = input.enabled ?? current.enabled
      yield* db
        .update(ScheduledTaskTable)
        .set({
          name: input.name,
          prompt: input.prompt,
          cron: input.cron,
          timezone: input.timezone,
          enabled: input.enabled,
          agent: input.clearAgent ? null : input.agent,
          model: input.clearModel ? null : input.model,
          auto_approve: input.autoApprove,
          next_run_at: enabled ? next.nextRunAt : null,
          time_updated: Date.now(),
        })
        .where(eq(ScheduledTaskTable.id, id))
        .run()
        .pipe(Effect.orDie)
      return yield* get(id)
    })

    const remove = Effect.fn("ScheduledTask.remove")(function* (id: TaskID) {
      yield* get(id)
      yield* db.delete(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).run().pipe(Effect.orDie)
    })

    const runs = Effect.fn("ScheduledTask.runs")(function* (id: TaskID, limit = 50) {
      yield* get(id)
      const rows = yield* db
        .select()
        .from(ScheduledRunTable)
        .where(eq(ScheduledRunTable.task_id, id))
        .orderBy(desc(ScheduledRunTable.time_started))
        .limit(Math.min(limit, 200))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRunRow)
    })

    const finish = (input: { task: Task; runID: RunID; status: "success" | "failed"; error?: string }) =>
      Effect.gen(function* () {
        const time = Date.now()
        yield* db
          .update(ScheduledRunTable)
          .set({ status: input.status, time_finished: time, error: input.error })
          .where(eq(ScheduledRunTable.id, input.runID))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(ScheduledTaskTable)
          .set({
            last_run_at: time,
            last_run_status: input.status,
            time_updated: time,
          })
          .where(eq(ScheduledTaskTable.id, input.task.id))
          .run()
          .pipe(Effect.orDie)
      })

    const execute = (task: Task, runID: RunID) =>
      instances
        .provide(
          { directory: task.directory },
          Effect.gen(function* () {
            const session = yield* sessions.create({
              title: `[Scheduled] ${task.name}`,
              agent: task.agent ?? undefined,
              model: task.model
                ? {
                    providerID: task.model.providerID,
                    id: task.model.modelID,
                    variant: task.model.variant,
                  }
                : undefined,
              metadata: { scheduledTaskID: task.id, scheduledRunID: runID },
              permission: task.autoApprove
                ? [{ permission: "*", pattern: "*", action: "allow" }]
                : [
                    { permission: "question", pattern: "*", action: "deny" },
                    { permission: "plan_enter", pattern: "*", action: "deny" },
                    { permission: "plan_exit", pattern: "*", action: "deny" },
                  ],
            })
            yield* db
              .update(ScheduledRunTable)
              .set({ session_id: session.id })
              .where(eq(ScheduledRunTable.id, runID))
              .run()
              .pipe(Effect.orDie)
            yield* prompts.prompt({
              sessionID: session.id,
              agent: task.agent ?? undefined,
              model: task.model ?? undefined,
              variant: task.model?.variant,
              parts: [{ type: "text", text: task.prompt }],
            })
            yield* finish({ task, runID, status: "success" })
          }),
        )
        .pipe(
          Effect.catchCause((cause) =>
            finish({ task, runID, status: "failed", error: Cause.pretty(cause) }).pipe(
              Effect.catchCause((finishCause) =>
                Effect.logError("failed to record scheduled task failure", { cause: finishCause }),
              ),
            ),
          ),
          Effect.ensuring(Effect.sync(() => running.delete(task.id))),
        )

    const run = Effect.fn("ScheduledTask.run")(function* (id: TaskID, trigger: Run["trigger"] = "manual") {
      const task = yield* get(id)
      const runID = RunID.make(Identifier.ascending("scheduledRun"))
      const started = Date.now()
      yield* db
        .insert(ScheduledRunTable)
        .values({
          id: runID,
          task_id: id,
          trigger,
          status: "running",
          time_started: started,
        })
        .run()
        .pipe(Effect.orDie)
      const active = running.has(id)
      if (!active) {
        running.add(id)
        yield* execute(task, runID).pipe(Effect.forkIn(scope))
      } else {
        yield* finish({ task, runID, status: "failed", error: "A previous run is still active." })
      }
      return fromRunRow({
        id: runID,
        task_id: id,
        session_id: null,
        trigger,
        status: active ? "failed" : "running",
        time_started: started,
        time_finished: active ? Date.now() : null,
        error: active ? "A previous run is still active." : null,
      })
    })

    const dispatchDue = Effect.fn("ScheduledTask.dispatchDue")(function* () {
      const rows = yield* db
        .select()
        .from(ScheduledTaskTable)
        .where(
          and(
            eq(ScheduledTaskTable.enabled, true),
            lte(ScheduledTaskTable.next_run_at, Date.now()),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* () {
            const task = fromTaskRow(row)
            if (row.next_run_at === null) return
            const next = nextRun(task.cron, task.timezone)
            if (next === undefined) {
              yield* db
                .update(ScheduledTaskTable)
                .set({ enabled: false, next_run_at: null, time_updated: Date.now() })
                .where(eq(ScheduledTaskTable.id, task.id))
                .run()
                .pipe(Effect.orDie)
              return
            }
            const claimed = yield* db
              .update(ScheduledTaskTable)
              .set({ next_run_at: next, time_updated: Date.now() })
              .where(
                and(
                  eq(ScheduledTaskTable.id, task.id),
                  eq(ScheduledTaskTable.enabled, true),
                  eq(ScheduledTaskTable.next_run_at, row.next_run_at),
                ),
              )
              .returning({ id: ScheduledTaskTable.id })
              .all()
              .pipe(Effect.orDie)
            if (claimed.length === 0) return
            yield* run(task.id, "schedule")
          }).pipe(Effect.catchCause((cause) => Effect.logError("scheduled task dispatch failed", { cause }))),
        { concurrency: "unbounded", discard: true },
      )
    })

    yield* dispatchDue().pipe(
      Effect.catchCause((cause) => Effect.logError("scheduled task loop failed", { cause })),
      Effect.repeat(Schedule.spaced(Duration.seconds(15))),
      Effect.forkIn(scope),
    )

    return Service.of({ list, get, create, update, remove, runs, run, validate })
  }),
)

function nextRun(expression: string, timezone: string) {
  try {
    return CronExpressionParser.parse(expression, { currentDate: new Date(), tz: timezone }).next().getTime()
  } catch {
    return undefined
  }
}

type TaskRow = typeof ScheduledTaskTable.$inferSelect
function fromTaskRow(row: TaskRow): Task {
  return {
    id: TaskID.make(row.id),
    projectID: row.project_id,
    directory: row.directory,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled,
    agent: row.agent,
    model: row.model
      ? {
          providerID: ProviderV2.ID.make(row.model.providerID),
          modelID: ModelV2.ID.make(row.model.modelID),
          variant: row.model.variant,
        }
      : null,
    autoApprove: row.auto_approve,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    time: { created: row.time_created, updated: row.time_updated },
  }
}

type RunRow = typeof ScheduledRunTable.$inferSelect
function fromRunRow(row: RunRow): Run {
  return {
    id: RunID.make(row.id),
    taskID: TaskID.make(row.task_id),
    sessionID: row.session_id,
    trigger: row.trigger,
    status: row.status,
    time: { started: row.time_started, finished: row.time_finished },
    error: row.error,
  }
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Database.node, InstanceStore.node, Session.node, SessionPrompt.node],
})

export * as ScheduledTask from "./schedule"
