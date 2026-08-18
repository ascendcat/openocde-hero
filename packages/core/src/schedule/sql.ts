import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { ProjectTable } from "../project/sql"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"

export const ScheduledTaskTable = sqliteTable(
  "scheduled_task",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: DatabasePath.directoryColumn().notNull(),
    name: text().notNull(),
    prompt: text().notNull(),
    cron: text().notNull(),
    timezone: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    agent: text(),
    model: text({ mode: "json" }).$type<{ providerID: string; modelID: string; variant?: string }>(),
    auto_approve: integer({ mode: "boolean" }).notNull().default(false),
    next_run_at: integer(),
    last_run_at: integer(),
    last_run_status: text().$type<"success" | "failed">(),
    ...Timestamps,
  },
  (table) => [
    index("scheduled_task_project_idx").on(table.project_id),
    index("scheduled_task_due_idx").on(table.enabled, table.next_run_at),
  ],
)

export const ScheduledRunTable = sqliteTable(
  "scheduled_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => ScheduledTaskTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    trigger: text().$type<"schedule" | "manual">().notNull(),
    status: text().$type<"running" | "success" | "failed">().notNull(),
    time_started: integer().notNull(),
    time_finished: integer(),
    error: text(),
  },
  (table) => [
    index("scheduled_run_task_started_idx").on(table.task_id, table.time_started),
    index("scheduled_run_status_idx").on(table.status),
  ],
)
