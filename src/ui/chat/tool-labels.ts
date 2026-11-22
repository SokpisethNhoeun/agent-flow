// How tool calls read in the chat, in Orca's wording: one line per call ("Ran npm test",
// "Read src/app.ts") and one summary per run of calls ("Ran 3 commands, read 2 files").

export type ToolKind = 'command' | 'read' | 'edit' | 'search' | 'other'

const KIND: Record<string, ToolKind> = {
  bash: 'command', shell: 'command', exec: 'command', exec_command: 'command', run: 'command', local_shell: 'command', killshell: 'command', bashoutput: 'command',
  read: 'read', view: 'read', read_file: 'read', notebookread: 'read', ls: 'read',
  edit: 'edit', write: 'edit', multiedit: 'edit', notebookedit: 'edit', apply_patch: 'edit', str_replace_editor: 'edit', create_file: 'edit',
  grep: 'search', glob: 'search', search: 'search', websearch: 'search', webfetch: 'search', find: 'search', toolsearch: 'search'
}

export function toolKind(name: string): ToolKind {
  return KIND[name.toLowerCase().replace(/^mcp__\w+__/, '')] ?? 'other'
}

function parse(argsText: string): Record<string, unknown> {
  try {
    const value = JSON.parse(argsText) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One call: the verb ("Ran", "Read", "Edited"…) and what it acted on. */
export function describeTool(name: string, argsText: string, failed = false): { kind: ToolKind; verb: string; target: string } {
  const args = parse(argsText)
  const kind = toolKind(name)
  const path = str(args.file_path) ?? str(args.path) ?? str(args.notebook_path)
  const firstLine = (s: string) => s.split('\n')[0].slice(0, 200)
  switch (kind) {
    case 'command':
      return { kind, verb: failed ? 'Tried to run' : 'Ran', target: firstLine(str(args.command) ?? str(args.cmd) ?? str(args.description) ?? name) }
    case 'read':
      return { kind, verb: failed ? 'Tried to read' : 'Read', target: path ?? name }
    case 'edit':
      return { kind, verb: failed ? 'Tried to edit' : 'Edited', target: path ?? name }
    case 'search':
      return { kind, verb: 'Searched', target: str(args.pattern) ?? str(args.query) ?? str(args.url) ?? name }
    default: {
      const detail = str(args.description) ?? str(args.prompt) ?? str(args.subject)
      return { kind, verb: 'Used', target: detail ? `${name}: ${firstLine(detail)}` : name }
    }
  }
}

const PHRASE: Record<ToolKind, [string, string, string]> = {
  command: ['Ran', 'command', 'commands'],
  read: ['Read', 'file', 'files'],
  edit: ['Edited', 'file', 'files'],
  search: ['Searched', 'time', 'times'],
  other: ['Used', 'tool', 'tools']
}

/** A run of calls: "Ran 3 commands, read 2 files". `live` uses the present tense ("Running…"). */
export function summarizeTools(names: string[], live = false): string {
  const counts = new Map<ToolKind, number>()
  for (const name of names) counts.set(toolKind(name), (counts.get(toolKind(name)) ?? 0) + 1)
  const order: ToolKind[] = ['command', 'read', 'edit', 'search', 'other']
  const parts = order
    .filter((kind) => counts.get(kind))
    .map((kind, i) => {
      const n = counts.get(kind)!
      const [verb, one, many] = PHRASE[kind]
      const tense = live && i === 0 ? { Ran: 'Running', Read: 'Reading', Edited: 'Editing', Searched: 'Searching', Used: 'Using' }[verb]! : verb
      const word = kind === 'search' ? (n === 1 ? 'once' : `${n} ${many}`) : `${n} ${n === 1 ? one : many}`
      return `${i === 0 ? tense : tense.toLowerCase()} ${word}`
    })
  return parts.join(', ')
}
