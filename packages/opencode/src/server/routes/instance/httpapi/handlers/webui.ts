import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { WebUI } from "@/server/webui"
import { RootHttpApi } from "../api"
import type { WebUiStartInput } from "../groups/webui"

export const webuiHandlers = HttpApiBuilder.group(RootHttpApi, "webui", (handlers) =>
  Effect.gen(function* () {
    const start = Effect.fn("WebUiHttpApi.start")(function* (ctx: { payload: WebUiStartInput }) {
      return yield* Effect.tryPromise({
        try: () => WebUI.start(ctx.payload),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const stop = Effect.fn("WebUiHttpApi.stop")(function* () {
      return yield* Effect.promise(() => WebUI.stop())
    })

    return handlers
      .handle("status", () => Effect.sync(() => WebUI.status()))
      .handle("start", start)
      .handle("stop", stop)
      .handle("connections", () => Effect.sync(() => WebUI.connections()))
  }),
)
