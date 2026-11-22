// Token and message counts from Orca's Agent Session History (history:read).
import type { WorkerContext } from '../context.ts'

export class SessionsAdapter {
  constructor(private readonly ctx: WorkerContext) {}

  async refresh(): Promise<void> {
    const { host } = this.ctx.orca
    if (!host.has('agent.listSessions')) return
    try {
      const { sessions } = await host.call('agent.listSessions', { limit: 200 })
      const bySession = new Map(sessions.map((session) => [session.sessionId, session]))
      for (const agent of Object.values(this.ctx.store.read().agents)) {
        if (!agent.sessionId) continue
        const session = bySession.get(agent.sessionId)
        if (!session) continue
        if (agent.tokens === session.totalTokens && agent.messageCount === session.messageCount) continue
        this.ctx.store.upsertAgent(
          agent.id,
          agent.lastSeenAt,
          {
            tokens: session.totalTokens,
            messageCount: session.messageCount,
            agent: agent.agent ?? session.agent,
            title: agent.title ?? session.title,
            branch: agent.branch ?? session.branch ?? undefined,
            evidence: ['host-call']
          },
          () => agent
        )
      }
    } catch (error) {
      this.ctx.log(`agent.listSessions failed: ${(error as Error).message}`)
    }
  }
}
