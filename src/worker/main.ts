// Agent Flow worker entry. Orca calls the default export once when the worker starts.
import type { OrcaWorkerApi } from 'orca/worker'
import { AgentFlowRuntime } from './runtime.ts'

let runtime: AgentFlowRuntime | null = null

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  runtime = new AgentFlowRuntime(orca)
  await runtime.start()
}

export async function deactivate(): Promise<void> {
  await runtime?.stop()
  runtime = null
}
