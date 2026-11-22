// Builders for records and realistic Orca CLI payloads.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FlowEvent } from '../../src/shared/events.ts'
import type { AgentRecord, MessageRecord, RunRecord, TaskRecord } from '../../src/shared/model.ts'
import { newAgent } from '../../src/worker/context.ts'

export function makeAgent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { ...newAgent(id, overrides.role ?? 'agent', 1000), ...overrides }
}

export function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    runId: 'run_1',
    parentId: null,
    title: `Task ${id}`,
    displayName: null,
    spec: null,
    kind: 'task',
    orcaStatus: 'pending',
    state: 'PENDING',
    deps: [],
    assigneeAgentId: null,
    dispatchIds: [],
    result: null,
    createdAt: null,
    completedAt: null,
    retryCount: 0,
    gateIds: [],
    version: 0,
    ...overrides
  }
}

export function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return { id, objective: `Objective ${id}`, legacy: false, coordinatorHandle: null, state: 'active', startedAt: null, endedAt: null, taskCount: 0, version: 0, ...overrides }
}

export function makeMessage(id: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return { id, runId: null, fromHandle: null, toHandle: null, fromAgentId: null, toAgentId: null, type: 'message', subject: null, body: null, taskId: null, createdAt: 0, ...overrides }
}

export function makeEvent(id: string, overrides: Partial<FlowEvent> = {}): FlowEvent {
  return { id, seq: 1, ts: 0, kind: 'agent.created', source: 'cli-poll', entityId: 'x', summary: '', ...overrides }
}

/** Creates a temp dir under os.tmpdir(); returns it and a cleanup function. */
export async function tempDir(prefix = 'agent-flow-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// Realistic `orca orchestration … --json` result shapes.
export const RAW_TASK = {
  id: 'task_1',
  run_id: 'run_1',
  parent_id: null,
  created_by_terminal_handle: null,
  task_title: 'Review API',
  display_name: 'API review',
  spec: 'Review the public API for consistency.',
  status: 'completed',
  deps: '[]',
  result: '{"provenance":"worker_report","outcome":"succeeded","message":"done"}',
  created_at: '2026-11-18 06:05:41',
  completed_at: '2026-11-18T07:04:13.348Z'
}

export const WORKER_LIST = {
  workers: [{ dispatchId: 'ctx_1', taskId: 'task_1', state: 'succeeded', liveness: 'exited', terminal: 'structworker_x', workspace: 'repo::/path/wt', host: 'local' }],
  nextCursor: null
}

export const WORKER_SHOW = {
  dispatch: {
    id: 'ctx_1',
    taskId: 'task_1',
    assigneeHandle: 'structworker_x',
    assigneePaneKey: 'pane-1',
    retryOfDispatchId: null,
    creatorDispatchId: null,
    failureCount: 0,
    dispatchedAt: '2026-11-20 09:26:47',
    completedAt: '2026-11-20T09:44:11.466Z'
  },
  worker: {
    startOptions: {
      agent: 'claude',
      launch: {
        requested: { agent: 'claude', model: 'claude-opus-5-5', effort: 'medium' },
        effective: { agent: 'claude', model: 'claude-opus-5-5', effort: 'medium' }
      }
    }
  },
  projection: { outcome: 'succeeded' }
}

export const INBOX = {
  messages: [
    {
      id: 'msg_1',
      run_id: 'run_1',
      from_handle: 'structworker_x',
      to_handle: 'run:run_1',
      subject: 'done',
      body: 'Finished the API review.',
      type: 'worker_done',
      payload: '{"taskId":"task_1"}',
      created_at: '2026-11-20T09:44:11Z',
      sender_pane_key: 'pane-1'
    }
  ]
}
