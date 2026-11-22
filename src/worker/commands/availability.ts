// What each command can actually do on this Orca, so the UI never shows a fake control.
import type { CommandAvailability, CommandKind } from '../../shared/commands.ts'

type Probe = { hostHas: (method: string) => boolean; cli: boolean; actAsCoordinator: boolean }

const COORDINATOR_REASON =
  'Orca only lets a Run’s coordinator change its tasks. Agent Flow shows the exact command to run in the coordinator, or runs it as the coordinator if you turn that on in settings.'

export function commandAvailability(kind: CommandKind, probe: Probe): CommandAvailability {
  const host = (method: string, reason?: string): CommandAvailability =>
    probe.hostHas(method) ? { available: true, mode: 'direct', reason: null } : { available: false, mode: 'unsupported', reason: reason ?? `This Orca does not offer ${method} to plugins.` }
  const cli = (): CommandAvailability =>
    probe.cli ? { available: true, mode: 'direct', reason: null } : { available: false, mode: 'unsupported', reason: 'The orca CLI was not found.' }
  const coordinator = (): CommandAvailability =>
    !probe.cli
      ? { available: false, mode: 'unsupported', reason: 'The orca CLI was not found.' }
      : { available: true, mode: 'coordinator', reason: probe.actAsCoordinator ? 'Runs as the Run’s coordinator (enabled in settings).' : COORDINATOR_REASON }
  switch (kind) {
    case 'terminal.focus':
      return host('terminal.focus')
    case 'terminal.read':
      return host('terminal.read')
    case 'agent.launch':
      return host('agent.launch')
    case 'agent.resume':
      return host('agent.resume')
    case 'agent.stop':
      return cli()
    case 'agent.readOutput':
      return probe.cli || probe.hostHas('terminal.read') ? { available: true, mode: 'direct', reason: null } : { available: false, mode: 'unsupported', reason: 'Neither the orca CLI nor terminal.read is available.' }
    case 'task.create':
    case 'task.update':
    case 'task.retry':
    case 'task.dispatch':
    case 'gate.resolve':
    case 'message.send':
      return coordinator()
    case 'task.cancel':
      return probe.cli ? { available: true, mode: 'direct', reason: 'Stops the task’s worker. Marking the task cancelled needs the coordinator.' } : cli()
    case 'worktree.create':
      return host('workspace.create')
    case 'worktree.open':
      return host('workspace.open')
    case 'worktree.inspect':
      return { available: true, mode: 'direct', reason: null }
    case 'agent.prompt':
      return probe.hostHas('terminal.sendText') || probe.cli
        ? { available: true, mode: 'direct', reason: null }
        : { available: false, mode: 'unsupported', reason: 'This Orca offers no way for plugins to send text to agents.' }
    case 'model.change':
      return { available: false, mode: 'unsupported', reason: 'Orca has no API to change a running agent’s model or effort. Pick a model when you retry or dispatch the task instead.' }
    case 'labels.update':
    case 'history.list':
    case 'history.load':
    case 'viewer.ping':
    case 'agent.attach':
    case 'star.visit':
    case 'update.check':
    case 'update.run':
    case 'star.answer':
    case 'dashboard.info':
    case 'entity.detail':
    case 'agent.image':
    case 'dashboard.enable':
    case 'dashboard.controls':
      return { available: true, mode: 'direct', reason: null }
  }
}
