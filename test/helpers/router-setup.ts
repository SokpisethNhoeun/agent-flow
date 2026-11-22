import type { AttachmentStore } from '../../src/worker/commands/attachments.ts'
// Builds a CommandRouter over the fake context with a real Persistence in a temp dir.
import type { LabelConfig } from '../../src/shared/model.ts'
import { CommandRouter } from '../../src/worker/commands/router.ts'
import { Persistence } from '../../src/worker/state/persistence.ts'
import { makeContext, type CliResponse, type HostHandler } from './fake-context.ts'
import { makeRun, makeTask } from './fixtures.ts'

export type RouterSetupOptions = {
  host?: Record<string, HostHandler>
  cli?: Record<string, CliResponse>
  actAsCoordinator?: boolean
  coordinatorHandle?: string | null
  persistenceDir?: string
  attachments?: AttachmentStore
}

export function makeRouter(options: RouterSetupOptions = {}) {
  const fake = makeContext({ host: options.host, cli: options.cli })
  const settings = { actAsCoordinator: options.actAsCoordinator ?? false }
  const ownTerminals = new Set<string>()
  const labelUpdates: LabelConfig[] = []
  let refreshes = 0
  const interest: string[] = []
  fake.ctx.store.put({ entity: 'run', id: 'run_1', value: makeRun('run_1', { coordinatorHandle: options.coordinatorHandle ?? null }) })
  fake.ctx.store.upsertTask(makeTask('task_1', { dispatchIds: ['ctx_1', 'ctx_2'] }))
  const router = new CommandRouter({
    ctx: fake.ctx,
    persistence: new Persistence(options.persistenceDir ?? '/nonexistent/agent-flow-test'),
    ownTerminals,
    settings: () => ({ chatSend: true, ...settings }),
    updateLabels: async (labels) => {
      labelUpdates.push(labels)
      fake.ctx.store.put({ entity: 'labels', id: 'labels', value: labels })
    },
    dashboardInfo: () => ({ enabled: true, url: 'http://127.0.0.1:1/#token=x' }),
    refresh: () => void refreshes++,
    fullText: () => null,
    claudeTranscriptPath: async () => null,
    noteOutputInterest: (agentId) => void interest.push(agentId),
    attachments: options.attachments,
    setDashboard: async (enabled) => ({ enabled, url: enabled ? 'http://127.0.0.1:1/#token=x' : null })
  })
  return { ...fake, router, settings, ownTerminals, labelUpdates, refreshes: () => refreshes, interest }
}

let counter = 0
export function command(kind: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { requestId: `req_test_${String(++counter).padStart(6, '0')}`, kind, params, ...extra }
}
