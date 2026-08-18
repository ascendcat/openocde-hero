import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/web-ui"

export const WebUiConnection = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique connection identifier" }),
  remoteAddress: Schema.String.annotate({ description: "Remote IP address of the connected client" }),
  remotePort: Schema.Number.annotate({ description: "Remote TCP port of the connected client" }),
  connectedAt: Schema.Number.annotate({ description: "Connection timestamp in epoch milliseconds" }),
  requestCount: Schema.Number.annotate({ description: "Number of HTTP requests served on this connection" }),
  lastPath: Schema.optional(Schema.String).annotate({ description: "Path of the most recent request" }),
  userAgent: Schema.optional(Schema.String).annotate({ description: "User agent of the most recent request" }),
}).annotate({ identifier: "WebUiConnection" })
export type WebUiConnection = Schema.Schema.Type<typeof WebUiConnection>

export const WebUiStatus = Schema.Struct({
  running: Schema.Boolean.annotate({ description: "Whether the web UI listener is running" }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname the web UI listener is bound to" }),
  port: Schema.optional(Schema.Number).annotate({ description: "Port the web UI listener is bound to" }),
  urls: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "URLs where the web UI can be reached, including LAN addresses when bound to all interfaces",
  }),
  startedAt: Schema.optional(Schema.Number).annotate({ description: "Start timestamp in epoch milliseconds" }),
  mdns: Schema.Boolean.annotate({ description: "Whether mDNS service discovery is enabled" }),
  connectionCount: Schema.Number.annotate({ description: "Number of currently open client connections" }),
  username: Schema.optional(Schema.String).annotate({ description: "Basic auth username, when auth is enabled" }),
  password: Schema.optional(Schema.String).annotate({ description: "Basic auth password, when auth is enabled" }),
}).annotate({ identifier: "WebUiStatus" })
export type WebUiStatus = Schema.Schema.Type<typeof WebUiStatus>

export const WebUiStartInput = Schema.Struct({
  hostname: Schema.optional(Schema.String).annotate({
    description: "Hostname to bind, defaults to 0.0.0.0 (all interfaces)",
  }),
  port: Schema.optional(Schema.Number).annotate({ description: "Port to bind, defaults to 4096 or any free port" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: opencode.local)",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Basic auth username for this listener (default: opencode)",
  }),
  password: Schema.optional(Schema.String).annotate({
    description: "Basic auth password for this listener. Empty or omitted disables authentication",
  }),
}).annotate({ identifier: "WebUiStartInput" })
export type WebUiStartInput = Schema.Schema.Type<typeof WebUiStartInput>

export const WebUiPaths = {
  status: root,
  start: `${root}/start`,
  stop: `${root}/stop`,
  connections: `${root}/connections`,
} as const

export const WebUiApi = HttpApi.make("webui").add(
  HttpApiGroup.make("webui")
    .add(
      HttpApiEndpoint.get("status", WebUiPaths.status, {
        success: described(WebUiStatus, "Current web UI listener status"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "webui.status",
          summary: "Get web UI status",
          description: "Get the status of the shareable web UI listener, including reachable URLs.",
        }),
      ),
      HttpApiEndpoint.post("start", WebUiPaths.start, {
        payload: WebUiStartInput,
        success: described(WebUiStatus, "Web UI listener status after starting"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "webui.start",
          summary: "Start web UI",
          description: "Start an additional server listener that exposes the web UI, typically on the local network.",
        }),
      ),
      HttpApiEndpoint.post("stop", WebUiPaths.stop, {
        success: described(WebUiStatus, "Web UI listener status after stopping"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "webui.stop",
          summary: "Stop web UI",
          description: "Stop the web UI listener and close all of its client connections.",
        }),
      ),
      HttpApiEndpoint.get("connections", WebUiPaths.connections, {
        success: described(Schema.Array(WebUiConnection), "Currently open web UI client connections"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "webui.connections",
          summary: "List web UI connections",
          description: "List clients currently connected to the web UI listener.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "webui", description: "Shareable web UI listener control." })),
)
