import { ScheduledTask } from "@/schedule/schedule"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const notFound = () => new HttpApiError.NotFound({})
const badRequest = () => new HttpApiError.BadRequest({})

export const scheduledTaskHandlers = HttpApiBuilder.group(InstanceHttpApi, "scheduledTask", (handlers) =>
  Effect.gen(function* () {
    const scheduled = yield* ScheduledTask.Service

    return handlers
      .handle("list", () => scheduled.list())
      .handle("get", (ctx) => scheduled.get(ctx.params.taskID).pipe(Effect.mapError(notFound)))
      .handle("create", (ctx) => scheduled.create(ctx.payload).pipe(Effect.mapError(badRequest)))
      .handle("update", (ctx) =>
        scheduled.update(ctx.params.taskID, ctx.payload).pipe(
          Effect.catchTags({
            "ScheduledTask.InvalidCronError": badRequest,
            "ScheduledTask.NotFoundError": notFound,
          }),
        ),
      )
      .handle("remove", (ctx) => scheduled.remove(ctx.params.taskID).pipe(Effect.mapError(notFound)))
      .handle("run", (ctx) => scheduled.run(ctx.params.taskID).pipe(Effect.mapError(notFound)))
      .handle("runs", (ctx) =>
        scheduled.runs(ctx.params.taskID, ctx.query.limit).pipe(Effect.mapError(notFound)),
      )
      .handle("validate", (ctx) =>
        scheduled.validate(ctx.payload.cron, ctx.payload.timezone).pipe(Effect.mapError(badRequest)),
      )
  }),
)
