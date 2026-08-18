import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260720112820_scheduled_tasks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`scheduled_run\` (
          \`id\` text PRIMARY KEY,
          \`task_id\` text NOT NULL,
          \`session_id\` text,
          \`trigger\` text NOT NULL,
          \`status\` text NOT NULL,
          \`time_started\` integer NOT NULL,
          \`time_finished\` integer,
          \`error\` text,
          CONSTRAINT \`fk_scheduled_run_task_id_scheduled_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`scheduled_task\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_scheduled_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`scheduled_task\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`name\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`cron\` text NOT NULL,
          \`timezone\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`agent\` text,
          \`model\` text,
          \`auto_approve\` integer DEFAULT false NOT NULL,
          \`next_run_at\` integer,
          \`last_run_at\` integer,
          \`last_run_status\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_scheduled_task_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`scheduled_run_task_started_idx\` ON \`scheduled_run\` (\`task_id\`,\`time_started\`);`,
      )
      yield* tx.run(`CREATE INDEX \`scheduled_run_status_idx\` ON \`scheduled_run\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`scheduled_task_project_idx\` ON \`scheduled_task\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`scheduled_task_due_idx\` ON \`scheduled_task\` (\`enabled\`,\`next_run_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
