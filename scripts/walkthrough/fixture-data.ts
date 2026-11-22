// Test data for the fixture walkthrough only. Every name says "[Test fixture]" so screenshots can
// never be mistaken for real runs; nothing here is shown by the real plugin.
import { ALL_COMMANDS } from '../../src/shared/commands.ts'
import { emptyState, type FlowState } from '../../src/shared/model.ts'
import { makeAgent, makeRun, makeTask } from '../../test/helpers/fixtures.ts'

const MIN = 60_000

export function fixtureState(now: number): FlowState {
  const state = emptyState()
  state.generatedAt = now
  state.seq = 1
  for (const kind of ALL_COMMANDS) state.capabilities.commands[kind] = { available: true, mode: 'direct', reason: null }
  Object.assign(state.capabilities, { cliAvailable: true, dashboardControls: true, chatSend: true, hooks: true })
  state.runs.run_fx = makeRun('run_fx', { objective: '[Test fixture] Build the login page', state: 'active', startedAt: now - 42 * MIN, taskCount: 4 })
  const account = { accountId: 'fx', label: 'Test account', provider: 'claude', source: 'config' as const }
  const worker = (id: string, task: string, extra: Parameters<typeof makeAgent>[1]) =>
    makeAgent(id, { role: 'worker', agent: 'claude', runId: 'run_fx', taskId: task, dispatchId: `d_${id}`, model: 'claude-sonnet-5-5', branch: `fx/${task}`, account, lastSeenAt: now, startedAt: now - 30 * MIN, ...extra })
  state.agents.lead = makeAgent('lead', { role: 'lead', agent: 'claude', title: '[Test fixture] Coordinator', runId: 'run_fx', live: true, state: 'working', account, tokens: 52_000, lastSeenAt: now })
  state.agents.w_done = worker('w_done', 't_ui', { title: 'Worker: UI', state: 'done', live: false, tokens: 180_000, parentId: 'lead' })
  state.agents.w_fail = worker('w_fail', 't_tests', { title: 'Worker: tests', state: 'failed', live: false, tokens: 95_000, parentId: 'lead', failureCount: 1 })
  state.agents.w_live = worker('w_live', 't_api', { title: 'Worker: API', state: 'working', live: true, tokens: 240_000, parentId: 'lead', terminalId: 'term_fx', stateSince: now - 5 * MIN })
  state.agents.w_block = worker('w_block', 't_docs', { title: 'Worker: docs', state: 'blocked', live: true, tokens: 12_000, parentId: 'lead', stateSince: now - 3 * MIN })
  state.tasks.t_ui = makeTask('t_ui', { runId: 'run_fx', title: 'Build login form', state: 'DONE', orcaStatus: 'completed', assigneeAgentId: 'w_done', createdAt: now - 40 * MIN, completedAt: now - 20 * MIN })
  state.tasks.t_tests = makeTask('t_tests', { runId: 'run_fx', title: 'Write login tests', state: 'FAILED', orcaStatus: 'failed', assigneeAgentId: 'w_fail', deps: ['t_ui'], createdAt: now - 19 * MIN, completedAt: now - 8 * MIN })
  state.tasks.t_api = makeTask('t_api', { runId: 'run_fx', title: 'Session API', state: 'RUNNING', orcaStatus: 'dispatched', assigneeAgentId: 'w_live', createdAt: now - 30 * MIN })
  state.tasks.t_docs = makeTask('t_docs', { runId: 'run_fx', title: 'Update docs', state: 'BLOCKED', orcaStatus: 'blocked', assigneeAgentId: 'w_block', deps: ['t_api'], createdAt: now - 6 * MIN })
  return state
}

/** An earlier saved run with the same task names, for the compare view. */
export function fixtureHistory(now: number) {
  const current = fixtureState(now)
  const older = {
    run: makeRun('run_fx_old', { objective: '[Test fixture] Build the login page (yesterday)', state: 'completed', startedAt: now - 26 * 60 * MIN, endedAt: now - 25 * 60 * MIN, taskCount: 3 }),
    tasks: [
      makeTask('o_ui', { runId: 'run_fx_old', title: 'Build login form', state: 'FAILED', createdAt: 0, completedAt: 8 * MIN }),
      makeTask('o_tests', { runId: 'run_fx_old', title: 'Write login tests', state: 'DONE', createdAt: 0, completedAt: 6 * MIN }),
      makeTask('o_api', { runId: 'run_fx_old', title: 'Session API', state: 'FAILED', createdAt: 0, completedAt: 9 * MIN })
    ],
    agents: [],
    messages: [],
    events: [],
    savedAt: now - 25 * 60 * MIN
  }
  const live = { run: current.runs.run_fx, tasks: Object.values(current.tasks), agents: Object.values(current.agents), messages: [], events: [], savedAt: now }
  return { records: { run_fx: live, run_fx_old: older }, list: [live, older].map((r) => ({ id: r.run.id, objective: r.run.objective, state: r.run.state, startedAt: r.run.startedAt, endedAt: r.run.endedAt, taskCount: r.run.taskCount, savedAt: r.savedAt })) }
}

/** The live worker's conversation; `extra` replies are appended as the test "streams" output. */
export function fixtureConversation(extra: string[]) {
  const base = [
    { id: 'm1', role: 'user', ts: Date.now() - 10 * MIN, blocks: [{ type: 'text', text: 'Implement the session API for the login page.' }] },
    { id: 'm2', role: 'assistant', ts: Date.now() - 9 * MIN, blocks: [{ type: 'text', text: 'Looking at the existing auth code first.' }, { type: 'tool-call', name: 'Grep', input: '{"pattern":"login"}' }] },
    { id: 'm3', role: 'user', ts: Date.now() - 9 * MIN, blocks: [{ type: 'tool-result', output: 'src/auth/login.ts:14 export function login()', isError: false }] },
    { id: 'm4', role: 'assistant', ts: Date.now() - 8 * MIN, blocks: [{ type: 'text', text: 'Found the login handler. Adding POST /session next.' }] }
  ]
  const more = extra.map((text, i) => ({ id: `x${i}`, role: 'assistant', ts: Date.now(), blocks: [{ type: 'text', text }] }))
  return { kind: 'conversation', source: 'claude transcript', provider: 'claude', messages: [...base, ...more], truncated: false, push: true }
}

/** `n` test sub-agents under one worker (ids continue from `offset`). */
export function fixtureSubagents(parentId: string, n: number, offset: number, now: number) {
  return Array.from({ length: n }, (_, i) =>
    makeAgent(`sub_fx_${offset + i}`, { role: 'subagent', agent: 'claude', parentId, runId: 'run_fx', title: `[Test fixture] Sub-agent ${offset + i}`, subagentType: 'general-purpose', live: true, state: 'working', lastSeenAt: now, startedAt: now, stateSince: now })
  )
}
