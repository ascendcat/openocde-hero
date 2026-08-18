export * as WebUI from "./webui"

import type * as http from "node:http"
import type { Socket } from "node:net"
import { networkInterfaces } from "node:os"

export type Connection = {
  id: string
  remoteAddress: string
  remotePort: number
  connectedAt: number
  requestCount: number
  lastPath?: string
  userAgent?: string
}

export type Status = {
  running: boolean
  hostname?: string
  port?: number
  urls: string[]
  startedAt?: number
  mdns: boolean
  connectionCount: number
  username?: string
  password?: string
}

export type StartOptions = {
  hostname?: string
  port?: number
  mdns?: boolean
  mdnsDomain?: string
  username?: string
  password?: string
}

type Listener = {
  hostname: string
  port: number
  node: http.Server
  stop: (close?: boolean) => Promise<void>
}

type State = {
  listener?: Listener
  starting?: Promise<Status>
  startedAt?: number
  mdns: boolean
  counter: number
  connections: Map<Socket, Connection>
  credentials?: { username: string; password: string }
}

const state: State = {
  mdns: false,
  counter: 0,
  connections: new Map(),
}

export function networkAddresses() {
  const nets = networkInterfaces()
  const results: string[] = []
  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    for (const info of net) {
      if (info.internal || info.family !== "IPv4") continue
      // Skip Docker bridge networks (typically 172.x.x.x)
      if (info.address.startsWith("172.")) continue
      results.push(info.address)
    }
  }
  return results
}

function urls(listener: Listener) {
  if (listener.hostname === "0.0.0.0" || listener.hostname === "::") {
    return [`http://localhost:${listener.port}`, ...networkAddresses().map((ip) => `http://${ip}:${listener.port}`)]
  }
  return [`http://${listener.hostname}:${listener.port}`]
}

function track(server: http.Server) {
  state.connections.clear()
  server.on("connection", (socket: Socket) => {
    const info: Connection = {
      id: `webui-conn-${++state.counter}`,
      remoteAddress: socket.remoteAddress ?? "unknown",
      remotePort: socket.remotePort ?? 0,
      connectedAt: Date.now(),
      requestCount: 0,
    }
    state.connections.set(socket, info)
    socket.once("close", () => {
      state.connections.delete(socket)
    })
  })
  server.on("request", (request: http.IncomingMessage) => {
    const info = state.connections.get(request.socket)
    if (!info) return
    info.requestCount += 1
    if (request.url) info.lastPath = request.url.split("?")[0]
    const userAgent = request.headers["user-agent"]
    if (typeof userAgent === "string") info.userAgent = userAgent
  })
}

export function status(): Status {
  const listener = state.listener
  return {
    running: !!listener,
    hostname: listener?.hostname,
    port: listener?.port,
    urls: listener ? urls(listener) : [],
    startedAt: listener ? state.startedAt : undefined,
    mdns: state.mdns,
    connectionCount: listener ? state.connections.size : 0,
    username: listener ? state.credentials?.username : undefined,
    password: listener ? state.credentials?.password : undefined,
  }
}

export function connections(): Connection[] {
  if (!state.listener) return []
  return Array.from(state.connections.values()).sort((a, b) => a.connectedAt - b.connectedAt)
}

export async function start(options: StartOptions): Promise<Status> {
  if (state.starting) return state.starting
  if (state.listener) return status()
  state.starting = (async () => {
    const { Server } = await import("./server")
    const credentials = options.password
      ? { username: options.username?.trim() || "opencode", password: options.password }
      : undefined
    // Each listener installs a fresh ConfigProvider that reads the current
    // process.env when its layers build, so temporarily overriding the auth
    // env vars scopes these credentials to the web UI listener only. The
    // primary listener keeps the snapshot taken when it was built, and Flag
    // captured process.env at module load, so neither is affected.
    const saved = {
      password: process.env["OPENCODE_SERVER_PASSWORD"],
      username: process.env["OPENCODE_SERVER_USERNAME"],
    }
    if (credentials) {
      process.env["OPENCODE_SERVER_PASSWORD"] = credentials.password
      process.env["OPENCODE_SERVER_USERNAME"] = credentials.username
    } else {
      delete process.env["OPENCODE_SERVER_PASSWORD"]
      delete process.env["OPENCODE_SERVER_USERNAME"]
    }
    let listener: Listener
    try {
      listener = await Server.listen({
        hostname: options.hostname ?? "0.0.0.0",
        port: options.port ?? 0,
        mdns: options.mdns,
        mdnsDomain: options.mdnsDomain,
        setUrl: false,
      })
    } finally {
      if (saved.password === undefined) delete process.env["OPENCODE_SERVER_PASSWORD"]
      else process.env["OPENCODE_SERVER_PASSWORD"] = saved.password
      if (saved.username === undefined) delete process.env["OPENCODE_SERVER_USERNAME"]
      else process.env["OPENCODE_SERVER_USERNAME"] = saved.username
    }
    track(listener.node)
    state.listener = listener
    state.startedAt = Date.now()
    state.mdns = options.mdns ?? false
    state.credentials = credentials
    return status()
  })()
  try {
    return await state.starting
  } finally {
    state.starting = undefined
  }
}

export async function stop(): Promise<Status> {
  const listener = state.listener
  if (!listener) return status()
  state.listener = undefined
  state.startedAt = undefined
  state.mdns = false
  state.credentials = undefined
  state.connections.clear()
  await listener.stop(true)
  return status()
}
