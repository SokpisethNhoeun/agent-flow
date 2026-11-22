import type { TaskKind, TaskState } from './model.ts'

/** Allowed lifecycle transitions. Anything else is rejected by the store and by commands. */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  PENDING: ['READY', 'RUNNING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED', 'PENDING', 'FAILED'],
  RUNNING: ['REVIEW', 'TESTING', 'APPROVED', 'DONE', 'FAILED', 'BLOCKED', 'CANCELLED'],
  REVIEW: ['TESTING', 'APPROVED', 'RUNNING', 'FAILED', 'DONE', 'CANCELLED'],
  TESTING: ['APPROVED', 'RUNNING', 'FAILED', 'DONE', 'CANCELLED'],
  APPROVED: ['MERGED', 'DONE', 'FAILED'],
  MERGED: ['DONE'],
  DONE: ['RETRYING'],
  BLOCKED: ['READY', 'RUNNING', 'PENDING', 'CANCELLED', 'FAILED'],
  FAILED: ['RETRYING', 'CANCELLED'],
  RETRYING: ['RUNNING', 'FAILED', 'CANCELLED', 'READY'],
  CANCELLED: ['RETRYING']
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to)
}

export const TERMINAL_TASK_STATES: readonly TaskState[] = ['DONE', 'MERGED', 'CANCELLED', 'FAILED']

/**
 * Maps Orca's raw task status (+ live dispatch info) onto the Agent Flow lifecycle.
 * Orca statuses: pending, ready, dispatched, completed, failed, blocked.
 */
export function mapOrcaTaskStatus(input: {
  orcaStatus: string
  kind: TaskKind
  resultOutcome: string | null
  hasOpenGate: boolean
  retryCount: number
  dispatchActive: boolean
}): TaskState {
  const status = input.orcaStatus.toLowerCase()
  if (input.hasOpenGate && status !== 'completed' && status !== 'failed') return 'BLOCKED'
  switch (status) {
    case 'pending':
      return 'PENDING'
    case 'ready':
      return input.retryCount > 0 ? 'RETRYING' : 'READY'
    case 'dispatched':
      if (!input.dispatchActive && input.retryCount > 0) return 'RETRYING'
      if (input.kind === 'review') return 'REVIEW'
      if (input.kind === 'test') return 'TESTING'
      return 'RUNNING'
    case 'completed': {
      const outcome = (input.resultOutcome ?? '').toLowerCase()
      if (outcome === 'cancelled' || outcome === 'cancellation') return 'CANCELLED'
      if (outcome === 'failed' || outcome === 'failure') return 'FAILED'
      if (input.kind === 'merge') return 'MERGED'
      return 'DONE'
    }
    case 'failed': {
      const outcome = (input.resultOutcome ?? '').toLowerCase()
      return outcome.includes('cancel') ? 'CANCELLED' : 'FAILED'
    }
    case 'blocked':
      return 'BLOCKED'
    default:
      return 'PENDING'
  }
}

const KIND_PATTERNS: [TaskKind, RegExp][] = [
  ['merge', /\b(merge|integrat(e|ion)|deliver)\b/i],
  // "test" alone is too common in titles ("AF test: …"); require a testing phrase.
  ['test', /\b(tests|testing|qa|e2e|verify|verification|validation)\b|\b(run|write|add|fix|unit|integration|smoke)\s+tests?\b/i],
  ['review', /\b(review|audit|inspect|approve)\b/i],
  ['plan', /\b(plan|planning|design|architecture|analy[sz]e)\b/i]
]

/** Title-based inference; the inspector marks the kind as inferred. */
export function inferTaskKind(title: string): TaskKind {
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(title)) return kind
  return 'task'
}
