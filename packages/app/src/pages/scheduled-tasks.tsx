import { useSDK } from "@/context/sdk"
import type { ScheduledRun, ScheduledTask } from "@opencode-ai/sdk/v2"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"

type Form = {
  name: string
  prompt: string
  scheduleMode: "interval" | "cron"
  intervalMinutes: string
  cron: string
  timezone: string
  enabled: boolean
  autoApprove: boolean
  agent: string
  providerID: string
  modelID: string
}

const blank = (): Form => ({
  name: "",
  prompt: "",
  scheduleMode: "interval",
  intervalMinutes: "30",
  cron: "0 9 * * 1-5",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  enabled: true,
  autoApprove: false,
  agent: "build",
  providerID: "",
  modelID: "",
})

const presets = [
  ["0 9 * * 1-5", "工作日 09:00"],
  ["0 9 * * *", "每天 09:00"],
  ["0 */6 * * *", "每 6 小时"],
] as const

const intervalPresets = [5, 15, 30, 60, 120] as const

function cronToInterval(cron: string): number | undefined {
  const value = cron.trim()
  const minute = value.match(/^\*\/(\d+) \* \* \* \*$/)
  if (minute) return Number(minute[1])
  if (value === "0 * * * *") return 60
  const hour = value.match(/^0 \*\/(\d+) \* \* \*$/)
  if (hour) return Number(hour[1]) * 60
  return undefined
}

function intervalToCron(minutes: number): string {
  if (minutes === 60) return "0 * * * *"
  if (minutes > 60 && minutes % 60 === 0) return `0 */${minutes / 60} * * *`
  return `*/${minutes} * * * *`
}

function describeCron(cron: string): string {
  const interval = cronToInterval(cron)
  if (!interval) return cron
  if (interval >= 60 && interval % 60 === 0) return `每 ${interval / 60} 小时`
  return `每 ${interval} 分钟`
}

export default function ScheduledTasksPage() {
  const sdk = useSDK()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  const [state, setState] = createStore<{
    selected?: string
    creating: boolean
    saving: boolean
    error?: string
    form: Form
  }>({
    creating: false,
    saving: false,
    form: blank(),
  })

  const [projects] = createResource(async () => {
    const result = await sdk().client.project.list()
    if (result.error) throw result.error
    return result.data ?? []
  })
  const [catalog] = createResource(
    () => sdk().directory,
    async () => {
      const result = await sdk().client.config.providers()
      if (result.error) throw result.error
      return result.data
    },
  )
  const [agents] = createResource(
    () => sdk().directory,
    async () => {
      const result = await sdk().client.v2.agent.list()
      if (result.error) throw result.error
      return (result.data?.data ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    },
  )
  const providers = createMemo(() =>
    (catalog()?.providers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  )
  const models = createMemo(() => {
    const provider = providers().find((item) => item.id === state.form.providerID)
    if (!provider) return []
    return Object.values(provider.models).sort((a, b) => a.name.localeCompare(b.name))
  })
  const selectProvider = (providerID: string) => {
    const provider = providers().find((item) => item.id === providerID)
    const fallback = catalog()?.default?.[providerID]
    const modelID = provider && fallback && provider.models[fallback] ? fallback : ""
    setState("form", { providerID, modelID })
  }
  const switchProject = (worktree: string) => {
    if (!worktree || worktree === sdk().directory) return
    navigate(`/${base64Encode(worktree)}/scheduled-tasks`)
  }
  const projectLabel = (project: { worktree: string; name?: string }) =>
    project.name?.trim() || getFilename(project.worktree) || project.worktree

  const [tasks, tasksControl] = createResource(
    () => sdk().directory,
    async () => {
      const result = await sdk().client.scheduledTask.list()
      if (result.error) throw result.error
      return result.data ?? []
    },
  )
  const selected = createMemo(() => tasks()?.find((task) => task.id === state.selected) ?? tasks()?.[0])
  const [runs, runsControl] = createResource(
    () => selected()?.id,
    async (taskID) => {
      if (!taskID) return []
      const result = await sdk().client.scheduledTask.runs({ taskID, limit: "50" })
      if (result.error) throw result.error
      return result.data ?? []
    },
  )

  const refresh = () => {
    void tasksControl.refetch()
    if (selected()) void runsControl.refetch()
  }
  const interval = window.setInterval(refresh, 10_000)
  onCleanup(() => window.clearInterval(interval))

  const edit = (task: ScheduledTask) => {
    const interval = cronToInterval(task.cron)
    setState({
      selected: task.id,
      creating: false,
      error: undefined,
      form: {
        name: task.name,
        prompt: task.prompt,
        scheduleMode: interval ? "interval" : "cron",
        intervalMinutes: String(interval ?? 30),
        cron: task.cron,
        timezone: task.timezone,
        enabled: task.enabled,
        autoApprove: task.autoApprove,
        agent: task.agent ?? "",
        providerID: task.model?.providerID ?? "",
        modelID: task.model?.modelID ?? "",
      },
    })
  }

  createEffect(() => {
    const first = tasks()?.[0]
    if (!first || state.selected || state.creating) return
    edit(first)
  })

  const create = () => setState({ selected: undefined, creating: true, error: undefined, form: blank() })

  const save = async () => {
    if (!state.form.name.trim() || !state.form.prompt.trim()) {
      setState("error", "请填写任务名称和任务内容。")
      return
    }
    if (state.form.providerID && !state.form.modelID) {
      setState("error", "已选择 Provider，请同时选择模型。")
      return
    }
    if (state.form.providerID && !state.form.modelID) {
      setState("error", "已选择 Provider，请同时选择模型。")
      return
    }
    let cron = state.form.cron.trim()
    if (state.form.scheduleMode === "interval") {
      const minutes = Number(state.form.intervalMinutes)
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        setState("error", "间隔分钟数需为 1–1440 之间的整数。")
        return
      }
      cron = intervalToCron(minutes)
    }
    setState({ saving: true, error: undefined })
    const model =
      state.form.providerID && state.form.modelID
        ? { providerID: state.form.providerID, modelID: state.form.modelID }
        : undefined
    const payload = {
      name: state.form.name.trim(),
      prompt: state.form.prompt.trim(),
      cron,
      timezone: state.form.timezone.trim(),
      enabled: state.form.enabled,
      autoApprove: state.form.autoApprove,
    }
    const result =
      state.creating || !selected()
        ? await sdk().client.scheduledTask.create({
            ...payload,
            agent: state.form.agent.trim() || undefined,
            model,
          })
        : await sdk().client.scheduledTask.update({
            taskID: selected()!.id,
            ...payload,
            agent: state.form.agent.trim() || undefined,
            model,
            clearAgent: !state.form.agent.trim(),
            clearModel: !model,
          })
    if (result.error || !result.data) {
      setState({ saving: false, error: "保存失败，请检查 Cron 表达式和时区。" })
      return
    }
    setState({ selected: result.data.id, creating: false, saving: false })
    await tasksControl.refetch()
  }

  const remove = async () => {
    const task = selected()
    if (!task || !window.confirm(`删除“${task.name}”及其运行记录？`)) return
    await sdk().client.scheduledTask.remove({ taskID: task.id })
    setState({ selected: undefined, creating: false, form: blank() })
    await tasksControl.refetch()
  }

  const runNow = async () => {
    const task = selected()
    if (!task) return
    const result = await sdk().client.scheduledTask.run({ taskID: task.id })
    if (result.error) {
      setState("error", "任务派发失败。")
      return
    }
    await runsControl.refetch()
    window.setTimeout(refresh, 1_000)
  }

  return (
    <div class="w-full h-full min-w-0 min-h-0 flex bg-background-base">
      <aside class="w-[340px] shrink-0 border-r border-border-weak-base flex flex-col">
        <header class="h-20 shrink-0 px-5 flex items-center justify-between border-b border-border-weak-base">
          <div>
            <p class="text-10-medium text-text-weak uppercase tracking-[0.16em]">Automation</p>
            <h1 class="mt-1 text-18-medium text-text-strong">定时任务</h1>
          </div>
          <button
            type="button"
            class="h-8 px-3 rounded-md border border-border-weak-base text-12-medium text-text-strong hover:bg-surface-base-hover"
            onClick={create}
            aria-label="新建定时任务"
          >
            + 新建任务
          </button>
        </header>
        <div class="px-4 py-3 border-b border-border-weak-base">
          <label class="oc-field">
            <span>项目</span>
            <select onChange={(event) => switchProject(event.currentTarget.value)}>
              <Show when={!projects()?.some((project) => project.worktree === sdk().directory)}>
                <option value={sdk().directory} selected>
                  {getFilename(sdk().directory) || sdk().directory}
                </option>
              </Show>
              <For each={projects()}>
                {(project) => (
                  <option value={project.worktree} selected={project.worktree === sdk().directory}>
                    {projectLabel(project)}
                  </option>
                )}
              </For>
            </select>
          </label>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <Show
            when={(tasks()?.length ?? 0) > 0}
            fallback={
              <div class="h-full flex flex-col items-center justify-center px-8 text-center">
                <div class="size-10 rounded-xl border border-border-weak-base flex items-center justify-center text-text-weak">
                  ◷
                </div>
                <p class="mt-4 text-13-medium text-text-strong">还没有定时任务</p>
                <p class="mt-1 text-11-regular text-text-weak">让 OpenCode 在指定时间自动处理工作。</p>
                <button type="button" class="mt-4 text-12-medium text-text-interactive-base" onClick={create}>
                  创建第一个任务
                </button>
              </div>
            }
          >
            <For each={tasks()}>
              {(task) => (
                <button
                  type="button"
                  class="w-full rounded-lg px-3 py-3 text-left border transition-colors"
                  classList={{
                    "bg-surface-base-hover border-border-weak-base": selected()?.id === task.id && !state.creating,
                    "border-transparent hover:bg-surface-base-hover": selected()?.id !== task.id || state.creating,
                  }}
                  onClick={() => edit(task)}
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="size-1.5 rounded-full"
                      classList={{ "bg-icon-success-base": task.enabled, "bg-icon-weak-base": !task.enabled }}
                    />
                    <span class="flex-1 truncate text-12-medium text-text-strong">{task.name}</span>
                    <span class="text-9-regular text-text-weak">{task.enabled ? "启用" : "暂停"}</span>
                  </div>
                  <p class="mt-2 truncate text-10-regular text-text-weak">{task.prompt}</p>
                  <div class="mt-2 flex items-center justify-between text-9-regular text-text-weak">
                    <code>{describeCron(task.cron)}</code>
                    <span>{task.nextRunAt ? formatDate(task.nextRunAt) : "—"}</span>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </div>
      </aside>

      <main class="flex-1 min-w-0 overflow-y-auto">
        <Show
          when={state.creating || selected()}
          fallback={
            <div class="h-full flex flex-col items-center justify-center text-center">
              <div class="text-28 text-text-weak">◷</div>
              <h2 class="mt-3 text-16-medium text-text-strong">选择一个定时任务</h2>
              <p class="mt-1 text-11-regular text-text-weak">查看计划、提示词和最近执行结果。</p>
            </div>
          }
        >
          <div class="max-w-[920px] mx-auto px-10 py-8">
            <div class="flex items-start justify-between gap-6 pb-6 border-b border-border-weak-base">
              <div>
                <p class="text-10-medium text-text-weak uppercase tracking-[0.16em]">
                  {state.creating ? "New automation" : "Scheduled session"}
                </p>
                <h2 class="mt-2 text-24-medium text-text-strong">
                  {state.creating ? "创建定时任务" : selected()?.name}
                </h2>
                <p class="mt-2 text-11-regular text-text-weak">
                  每次运行都会创建可在侧边栏中查看的新 OpenCode 会话。
                </p>
              </div>
              <Show when={!state.creating && selected()}>
                <div class="flex gap-2">
                  <button type="button" class="oc-button-secondary" onClick={runNow}>立即运行</button>
                  <button type="button" class="oc-button-danger" onClick={remove}>删除</button>
                </div>
              </Show>
            </div>

            <section class="grid grid-cols-2 gap-5 pt-6">
              <label class="col-span-2 oc-field">
                <span>任务名称</span>
                <input value={state.form.name} onInput={(event) => setState("form", "name", event.currentTarget.value)} placeholder="例如：每日代码健康检查" />
              </label>
              <label class="col-span-2 oc-field">
                <span>交给 OpenCode 的任务</span>
                <textarea rows={6} value={state.form.prompt} onInput={(event) => setState("form", "prompt", event.currentTarget.value)} placeholder="清晰描述希望 OpenCode 自动完成的工作…" />
              </label>
              <div class="col-span-2 flex items-center gap-2">
                <span class="text-11-medium text-text-weak">触发方式</span>
                <button type="button" class="oc-chip" classList={{ active: state.form.scheduleMode === "interval" }} onClick={() => setState("form", "scheduleMode", "interval")}>按分钟间隔</button>
                <button type="button" class="oc-chip" classList={{ active: state.form.scheduleMode === "cron" }} onClick={() => setState("form", "scheduleMode", "cron")}>Cron 表达式</button>
              </div>
              <Show
                when={state.form.scheduleMode === "interval"}
                fallback={
                  <>
                    <label class="oc-field">
                      <span>Cron 表达式</span>
                      <input class="font-mono" value={state.form.cron} onInput={(event) => setState("form", "cron", event.currentTarget.value)} />
                    </label>
                    <label class="oc-field">
                      <span>时区</span>
                      <input value={state.form.timezone} onInput={(event) => setState("form", "timezone", event.currentTarget.value)} />
                    </label>
                    <div class="col-span-2 flex flex-wrap gap-2">
                      <For each={presets}>
                        {(preset) => <button type="button" class="oc-chip" classList={{ active: state.form.cron === preset[0] }} onClick={() => setState("form", "cron", preset[0])}>{preset[1]}</button>}
                      </For>
                    </div>
                  </>
                }
              >
                <label class="oc-field">
                  <span>间隔（分钟）</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={state.form.intervalMinutes}
                    onInput={(event) => setState("form", "intervalMinutes", event.currentTarget.value)}
                    placeholder="30"
                  />
                </label>
                <label class="oc-field">
                  <span>时区</span>
                  <input value={state.form.timezone} onInput={(event) => setState("form", "timezone", event.currentTarget.value)} />
                </label>
                <div class="col-span-2 flex flex-wrap gap-2">
                  <For each={intervalPresets}>
                    {(minutes) => (
                      <button
                        type="button"
                        class="oc-chip"
                        classList={{ active: Number(state.form.intervalMinutes) === minutes }}
                        onClick={() => setState("form", "intervalMinutes", String(minutes))}
                      >
                        {minutes >= 60 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <label class="oc-field">
                <span>Agent</span>
                <select onChange={(event) => setState("form", "agent", event.currentTarget.value)}>
                  <option value="" selected={!state.form.agent}>
                    默认（跟随全局设置）
                  </option>
                  <Show when={state.form.agent && !agents()?.some((item) => item.id === state.form.agent)}>
                    <option value={state.form.agent} selected>
                      {state.form.agent}
                    </option>
                  </Show>
                  <For each={agents()}>
                    {(agent) => (
                      <option value={agent.id} selected={agent.id === state.form.agent}>
                        {agent.id.charAt(0).toUpperCase() + agent.id.slice(1)}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <div class="grid grid-cols-2 gap-2">
                <label class="oc-field">
                  <span>Provider（可选）</span>
                  <select onChange={(event) => selectProvider(event.currentTarget.value)}>
                    <option value="" selected={!state.form.providerID}>
                      默认（跟随全局设置）
                    </option>
                    <Show when={state.form.providerID && !providers().some((item) => item.id === state.form.providerID)}>
                      <option value={state.form.providerID} selected>
                        {state.form.providerID}
                      </option>
                    </Show>
                    <For each={providers()}>
                      {(provider) => (
                        <option value={provider.id} selected={provider.id === state.form.providerID}>
                          {provider.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="oc-field">
                  <span>Model（可选）</span>
                  <select
                    disabled={!state.form.providerID}
                    onChange={(event) => setState("form", "modelID", event.currentTarget.value)}
                  >
                    <option value="" selected={!state.form.modelID}>
                      {state.form.providerID ? "请选择模型" : "默认模型"}
                    </option>
                    <Show when={state.form.modelID && !models().some((item) => item.id === state.form.modelID)}>
                      <option value={state.form.modelID} selected>
                        {state.form.modelID}
                      </option>
                    </Show>
                    <For each={models()}>
                      {(model) => (
                        <option value={model.id} selected={model.id === state.form.modelID}>
                          {model.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </div>
              <label class="oc-toggle-card">
                <div><strong>启用计划</strong><span>到点后自动创建会话并执行</span></div>
                <input type="checkbox" checked={state.form.enabled} onChange={(event) => setState("form", "enabled", event.currentTarget.checked)} />
              </label>
              <label class="oc-toggle-card">
                <div><strong>自动批准权限</strong><span>允许无人值守地使用工具，谨慎开启</span></div>
                <input type="checkbox" checked={state.form.autoApprove} onChange={(event) => setState("form", "autoApprove", event.currentTarget.checked)} />
              </label>
            </section>

            <Show when={state.error}><p class="mt-4 text-11-medium text-text-on-critical-base">{state.error}</p></Show>
            <div class="mt-6 flex justify-end">
              <button type="button" class="oc-button-primary" disabled={state.saving} onClick={save}>
                {state.saving ? "保存中…" : state.creating ? "创建任务" : "保存更改"}
              </button>
            </div>

            <Show when={!state.creating && selected()}>
              <section class="mt-10 pt-7 border-t border-border-weak-base">
                <div class="flex items-center justify-between">
                  <div><h3 class="text-14-medium text-text-strong">运行记录</h3><p class="mt-1 text-10-regular text-text-weak">最近 50 次自动和手动执行</p></div>
                  <span class="text-10-regular text-text-weak">下次运行：{selected()?.nextRunAt ? formatDate(selected()!.nextRunAt) : "已暂停"}</span>
                </div>
                <div class="mt-4 rounded-lg border border-border-weak-base overflow-hidden">
                  <Show when={(runs()?.length ?? 0) > 0} fallback={<p class="py-10 text-center text-11-regular text-text-weak">尚无运行记录</p>}>
                    <For each={runs()}>
                      {(run) => (
                        <button type="button" class="w-full min-h-14 px-4 grid grid-cols-[12px_1fr_auto_auto] gap-3 items-center text-left border-b last:border-b-0 border-border-weak-base hover:bg-surface-base-hover" disabled={!run.sessionID} onClick={() => openRun(run, params.dir, navigate)}>
                          <span class="size-2 rounded-full" classList={{ "bg-icon-success-base": run.status === "success", "bg-icon-critical-base": run.status === "failed", "bg-icon-info-base animate-pulse": run.status === "running" }} />
                          <div class="min-w-0 py-2">
                            <p class="text-11-medium text-text-strong">{statusLabel(run.status)}</p>
                            <p class="mt-0.5 text-9-regular text-text-weak">{formatDate(run.time.started)}</p>
                            <Show when={run.status === "failed" && run.error}>
                              {(error) => (
                                <p class="mt-1 text-10-regular text-text-on-critical-base break-words" title={error()}>
                                  {friendlyError(error())}
                                </p>
                              )}
                            </Show>
                          </div>
                          <span class="text-9-regular text-text-weak">{run.trigger === "manual" ? "手动" : "计划"}</span>
                          <span class="text-10-medium text-text-interactive-base">{run.sessionID ? "打开会话 →" : ""}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </section>
            </Show>
          </div>
        </Show>
      </main>
    </div>
  )
}

function formatDate(value: number | string) {
  if (typeof value !== "number") return "—"
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value)
}

function statusLabel(status: ScheduledRun["status"]) {
  if (status === "success") return "执行成功"
  if (status === "failed") return "执行失败"
  return "正在运行"
}

function friendlyError(error: string): string {
  if (error.includes("A previous run is still active"))
    return "已跳过：上一次运行还未结束（同一任务不允许并发执行）"
  if (error.includes("OpenCode restarted before this run completed"))
    return "已中断：运行期间 OpenCode 退出或重启，会话未跑完"
  if (error.includes("MessageAbortedError") || error.includes("Aborted"))
    return "已中止：会话被手动停止或应用退出"
  if (error.includes("InvalidCronError")) return "配置错误：Cron 表达式或时区无效"
  if (error.includes("ProviderAuthError") || error.includes("401") || error.includes("Unauthorized"))
    return "认证失败：模型 Provider 的密钥无效或过期，请到设置里重新登录"
  if (error.includes("rate limit") || error.includes("429")) return "触发限流：模型服务请求过于频繁，稍后会正常"
  const firstLine = error
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("at "))
  const summary = firstLine ?? error
  return summary.length > 160 ? `${summary.slice(0, 160)}…（悬停查看完整错误）` : summary
}

function openRun(run: ScheduledRun, dir: string, navigate: ReturnType<typeof useNavigate>) {
  if (!run.sessionID) return
  navigate(`/${dir}/session/${run.sessionID}`)
}
