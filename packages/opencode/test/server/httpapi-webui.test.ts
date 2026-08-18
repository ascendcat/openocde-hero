import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { WebUiPaths } from "../../src/server/routes/instance/httpapi/groups/webui"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { webuiHandlers } from "../../src/server/routes/instance/httpapi/handlers/webui"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers, webuiHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("webui HttpApi", () => {
  it.live("reports a stopped listener by default", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(WebUiPaths.status)

      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({
        running: false,
        urls: [],
        mdns: false,
        connectionCount: 0,
      })
    }),
  )

  it.live("stop is a no-op when the listener is not running", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.post(WebUiPaths.stop)

      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({ running: false })
    }),
  )

  it.live("lists no connections when the listener is not running", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(WebUiPaths.connections)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual([])
    }),
  )
})
