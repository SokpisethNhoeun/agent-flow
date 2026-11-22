// In the canvas editor, view settings and node positions live in the .agentflow file itself,
// through Orca's document session (Orca owns saving, dirty state and outside edits).
import type { PersistedView, ViewPersistence } from './view-store.ts'
import { localStoragePersistence } from './view-store.ts'

type DocSession<T> = { value: T; change(value: T): void; onReplace(handler: (value: T) => void): void }
type OrcaDocument = { session?<T>(options: { decode: (content: { text?: string }) => T; encode: (value: T) => { kind: 'text'; text: string }; debounceMs?: number }): Promise<DocSession<T>> }

type FileShape = Partial<PersistedView> & { agentFlow: 1 }

export async function documentPersistence(): Promise<ViewPersistence> {
  const doc = (globalThis as { orca?: { document?: OrcaDocument } }).orca?.document
  if (!doc?.session) return localStoragePersistence('agent-flow:canvas-view')
  const session = await doc.session<FileShape>({
    decode: (content) => {
      try {
        const parsed = JSON.parse(content.text || '{}') as FileShape
        return parsed && typeof parsed === 'object' ? { ...parsed, agentFlow: 1 } : { agentFlow: 1 }
      } catch {
        return { agentFlow: 1 }
      }
    },
    encode: (value) => ({ kind: 'text', text: JSON.stringify(value, null, 2) + '\n' }),
    debounceMs: 800
  })
  return {
    async load() {
      return session.value
    },
    save(view) {
      // Only write when something actually changed, so opening the file never dirties it.
      const next: FileShape = { agentFlow: 1, ...view }
      if (JSON.stringify(next) !== JSON.stringify({ ...session.value, agentFlow: 1 })) session.change(next)
    }
  }
}
