import { afterEach, describe, expect } from "bun:test"
import { ScheduledTask } from "@/schedule/schedule"
import { Effect, Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

function request(directory: string, url: string, init: RequestInit = {}) {
  return requestInDirectory(url, directory, init)
}

describe("scheduled task endpoints", () => {
  it.instance("creates, lists, updates, and removes a task", () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const created = yield* request(tmp.directory, "/scheduled-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Morning review",
          prompt: "Review this repository",
          cron: "0 9 * * 1-5",
          timezone: "Asia/Shanghai",
          enabled: true,
          autoApprove: false,
        }),
      })
      expect(created.status).toBe(200)
      const task = yield* Schema.decodeUnknownEffect(ScheduledTask.Task)(yield* created.json)
      expect(task.id).toStartWith("tsk_")
      expect(task.name).toBe("Morning review")
      expect(task.enabled).toBe(true)
      expect(task.nextRunAt).toBeGreaterThan(Date.now())

      const listed = yield* request(tmp.directory, "/scheduled-task")
      expect(listed.status).toBe(200)
      expect(yield* Schema.decodeUnknownEffect(Schema.Array(ScheduledTask.Task))(yield* listed.json)).toEqual([
        expect.objectContaining({ id: task.id }),
      ])

      const updated = yield* request(tmp.directory, `/scheduled-task/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false, name: "Paused review" }),
      })
      expect(updated.status).toBe(200)
      expect(yield* Schema.decodeUnknownEffect(ScheduledTask.Task)(yield* updated.json)).toMatchObject({
        name: "Paused review",
        enabled: false,
        nextRunAt: null,
      })

      const removed = yield* request(tmp.directory, `/scheduled-task/${task.id}`, { method: "DELETE" })
      expect(removed.status).toBe(200)
      const empty = yield* request(tmp.directory, "/scheduled-task")
      expect(yield* Schema.decodeUnknownEffect(Schema.Array(ScheduledTask.Task))(yield* empty.json)).toEqual([])
    }),
  )

  it.instance("rejects invalid cron expressions", () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const response = yield* request(tmp.directory, "/scheduled-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid",
          prompt: "Never runs",
          cron: "not a cron",
          timezone: "Asia/Shanghai",
          enabled: true,
          autoApprove: false,
        }),
      })
      expect(response.status).toBe(400)
    }),
  )
})
