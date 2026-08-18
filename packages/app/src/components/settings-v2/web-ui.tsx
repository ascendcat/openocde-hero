import type { WebUiConnection, WebUiStatus } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type WebUiDraft = {
  hostname: string
  port: number
  mdns: boolean
  username: string
  password: string
}

const defaultDraft: WebUiDraft = {
  hostname: "0.0.0.0",
  port: 4096,
  mdns: false,
  username: "opencode",
  password: "",
}

const POLL_INTERVAL = 3000

export const SettingsWebUiV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()

  const [draft, setDraft] = persisted(Persist.global("settings.webui"), createStore<WebUiDraft>({ ...defaultDraft }))
  const [status, setStatus] = createSignal<WebUiStatus>()
  const [connections, setConnections] = createSignal<WebUiConnection[]>([])
  const [busy, setBusy] = createSignal(false)

  const running = createMemo(() => status()?.running === true)

  const refresh = async () => {
    const result = await serverSdk()
      .client.webui.status()
      .catch(() => undefined)
    if (!result?.data) return
    setStatus(result.data)
    if (!result.data.running) {
      setConnections([])
      return
    }
    const conns = await serverSdk()
      .client.webui.connections()
      .catch(() => undefined)
    setConnections(conns?.data ? [...conns.data] : [])
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL)
    onCleanup(() => clearInterval(timer))
  })

  const start = async () => {
    setBusy(true)
    try {
      const result = await serverSdk()
        .client.webui.start({
          webUiStartInput: {
            hostname: draft.hostname,
            port: draft.port,
            mdns: draft.mdns,
            username: draft.username.trim() || undefined,
            password: draft.password || undefined,
          },
        })
        .catch(() => undefined)
      if (!result?.data) {
        showToast({ title: language.t("settings.webui.error.start"), variant: "error" })
        return
      }
      setStatus(result.data)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      const result = await serverSdk()
        .client.webui.stop()
        .catch(() => undefined)
      if (!result?.data) {
        showToast({ title: language.t("settings.webui.error.stop"), variant: "error" })
        return
      }
      setStatus(result.data)
      setConnections([])
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      showToast({ title: language.t("session.share.copy.copied") })
    })
  }

  const hostnameOptions = createMemo(() => [
    { value: "0.0.0.0", label: language.t("settings.webui.hostname.all") },
    { value: "127.0.0.1", label: language.t("settings.webui.hostname.local") },
  ])

  const showAuthWarning = createMemo(() => {
    const current = status()
    if (!current?.running) return false
    if (current.password) return false
    return current.hostname !== "127.0.0.1" && current.hostname !== "localhost"
  })

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString()

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.webui")}</h2>
        </div>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.webui.server.title")}
              description={language.t("settings.webui.server.description")}
            >
              <div class="settings-v2-webui-control">
                <span
                  class="settings-v2-webui-status"
                  classList={{ "settings-v2-webui-status--running": running() }}
                >
                  {running() ? language.t("settings.webui.status.running") : language.t("settings.webui.status.stopped")}
                </span>
                <Show
                  when={running()}
                  fallback={
                    <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={() => void start()}>
                      {language.t("settings.webui.action.start")}
                    </ButtonV2>
                  }
                >
                  <ButtonV2 size="normal" variant="danger" disabled={busy()} onClick={() => void stop()}>
                    {language.t("settings.webui.action.stop")}
                  </ButtonV2>
                </Show>
              </div>
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webui.hostname.title")}
              description={language.t("settings.webui.hostname.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-webui-hostname"
                options={hostnameOptions()}
                placement="bottom-end"
                gutter={6}
                current={hostnameOptions().find((o) => o.value === draft.hostname) ?? hostnameOptions()[0]}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && setDraft("hostname", option.value)}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webui.port.title")}
              description={language.t("settings.webui.port.description")}
            >
              <TextInputV2
                appearance="base"
                class="settings-v2-webui-port"
                inputmode="numeric"
                value={String(draft.port)}
                onInput={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 10)
                  if (Number.isNaN(parsed)) return
                  setDraft("port", Math.max(0, Math.min(65535, parsed)))
                }}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webui.mdns.title")}
              description={language.t("settings.webui.mdns.description")}
            >
              <div data-action="settings-webui-mdns">
                <Switch checked={draft.mdns} onChange={(checked) => setDraft("mdns", checked)} />
              </div>
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webui.username.title")}
              description={language.t("settings.webui.username.description")}
            >
              <TextInputV2
                appearance="base"
                class="settings-v2-webui-credential-input"
                value={draft.username}
                onInput={(event) => setDraft("username", event.currentTarget.value)}
                placeholder="opencode"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.webui.password.title")}
              description={language.t("settings.webui.password.description")}
            >
              <TextInputV2
                appearance="base"
                class="settings-v2-webui-credential-input"
                value={draft.password}
                onInput={(event) => setDraft("password", event.currentTarget.value)}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
              />
            </SettingsRowV2>
          </SettingsListV2>

          <Show when={running()}>
            <p class="settings-v2-webui-hint">{language.t("settings.webui.restart.hint")}</p>
          </Show>

          <Show when={showAuthWarning()}>
            <div class="settings-v2-webui-warning">
              <IconV2 name="warning" size="large" />
              <span>{language.t("settings.webui.auth.warning")}</span>
            </div>
          </Show>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.webui.section.urls")}</h3>
          <Show
            when={running() && (status()?.urls.length ?? 0) > 0}
            fallback={<p class="settings-v2-webui-empty">{language.t("settings.webui.urls.empty")}</p>}
          >
            <SettingsListV2>
              <For each={status()?.urls ?? []}>
                {(url) => (
                  <div class="settings-v2-webui-url">
                    <a href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="copy" size="large" />}
                      onClick={() => copyUrl(url)}
                    />
                  </div>
                )}
              </For>
            </SettingsListV2>
            <Show when={status()?.password}>
              <SettingsListV2>
                <SettingsRowV2
                  title={language.t("settings.webui.credentials.title")}
                  description={language.t("settings.webui.credentials.description")}
                >
                  <div class="settings-v2-webui-credentials">
                    <code>{status()?.username ?? "opencode"}</code>
                    <span class="settings-v2-webui-credentials-sep">/</span>
                    <code>{status()?.password}</code>
                    <IconButtonV2
                      type="button"
                      variant="ghost-muted"
                      size="small"
                      icon={<IconV2 name="copy" size="large" />}
                      onClick={() => copyUrl(status()?.password ?? "")}
                    />
                  </div>
                </SettingsRowV2>
              </SettingsListV2>
            </Show>
          </Show>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">
            {language.t("settings.webui.section.connections")}
            <Show when={running()}> ({connections().length})</Show>
          </h3>
          <Show
            when={running() && connections().length > 0}
            fallback={<p class="settings-v2-webui-empty">{language.t("settings.webui.connections.empty")}</p>}
          >
            <SettingsListV2>
              <For each={connections()}>
                {(connection) => (
                  <div class="settings-v2-webui-connection">
                    <div class="settings-v2-webui-connection-lead">
                      <span class="settings-v2-webui-connection-remote">
                        {connection.remoteAddress}:{connection.remotePort}
                      </span>
                      <span class="settings-v2-webui-connection-meta">
                        {formatTime(Number(connection.connectedAt))}
                        {" • "}
                        {language.t("settings.webui.connections.requests", { count: connection.requestCount })}
                        <Show when={connection.userAgent}>
                          {" • "}
                          {connection.userAgent}
                        </Show>
                      </span>
                    </div>
                    <Show when={connection.lastPath}>
                      <span class="settings-v2-webui-connection-path">{connection.lastPath}</span>
                    </Show>
                  </div>
                )}
              </For>
            </SettingsListV2>
          </Show>
        </div>
      </div>
    </>
  )
}
