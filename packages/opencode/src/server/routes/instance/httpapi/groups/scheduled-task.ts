import { ScheduledTask } from "@/schedule/schedule"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/scheduled-task"

export const ScheduledTaskApi = HttpApi.make("scheduledTask")
  .add(
    HttpApiGroup.make("scheduledTask")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ScheduledTask.Task), "Scheduled tasks for the current project"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.list",
            summary: "List scheduled tasks",
            description: "List all recurring OpenCode tasks for the current project.",
          }),
        ),
        HttpApiEndpoint.get("get", `${root}/:taskID`, {
          params: { taskID: ScheduledTask.TaskID },
          query: WorkspaceRoutingQuery,
          success: described(ScheduledTask.Task, "Scheduled task"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.get",
            summary: "Get scheduled task",
            description: "Get one scheduled task by ID.",
          }),
        ),
        HttpApiEndpoint.post("create", root, {
          query: WorkspaceRoutingQuery,
          payload: ScheduledTask.CreateInput,
          success: described(ScheduledTask.Task, "Created scheduled task"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.create",
            summary: "Create scheduled task",
            description: "Create a recurring task that starts a new OpenCode session on schedule.",
          }),
        ),
        HttpApiEndpoint.patch("update", `${root}/:taskID`, {
          params: { taskID: ScheduledTask.TaskID },
          query: WorkspaceRoutingQuery,
          payload: ScheduledTask.UpdateInput,
          success: described(ScheduledTask.Task, "Updated scheduled task"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.update",
            summary: "Update scheduled task",
            description: "Update schedule, prompt, execution options, or enabled state.",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:taskID`, {
          params: { taskID: ScheduledTask.TaskID },
          query: WorkspaceRoutingQuery,
          success: Schema.Void,
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.remove",
            summary: "Delete scheduled task",
            description: "Permanently delete a scheduled task and its run history.",
          }),
        ),
        HttpApiEndpoint.post("run", `${root}/:taskID/run`, {
          params: { taskID: ScheduledTask.TaskID },
          query: WorkspaceRoutingQuery,
          success: described(ScheduledTask.Run, "Dispatched scheduled run"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.run",
            summary: "Run scheduled task now",
            description: "Immediately dispatch a scheduled task into a new OpenCode session.",
          }),
        ),
        HttpApiEndpoint.get("runs", `${root}/:taskID/run`, {
          params: { taskID: ScheduledTask.TaskID },
          query: Schema.Struct({
            ...WorkspaceRoutingQuery.fields,
            limit: Schema.optionalKey(Schema.NumberFromString),
          }),
          success: described(Schema.Array(ScheduledTask.Run), "Scheduled task runs"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.runs",
            summary: "List scheduled task runs",
            description: "List recent execution attempts for a scheduled task.",
          }),
        ),
        HttpApiEndpoint.post("validate", `${root}/validate`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ cron: Schema.String, timezone: Schema.String }),
          success: Schema.Struct({ nextRunAt: Schema.Number }),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "scheduledTask.validate",
            summary: "Validate schedule",
            description: "Validate a cron expression and calculate its next run time.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "scheduledTask",
          description: "Recurring OpenCode session automation.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode scheduled tasks API",
      version: "0.0.1",
    }),
  )
