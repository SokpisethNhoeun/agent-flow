import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeTool, summarizeTools } from '../src/ui/chat/tool-labels.ts'

test('one line per call, in Orca wording', () => {
  assert.deepEqual(describeTool('Bash', '{"command":"npm test\\nmore"}'), { kind: 'command', verb: 'Ran', target: 'npm test' })
  assert.deepEqual(describeTool('Read', '{"file_path":"/repo/src/app.ts"}'), { kind: 'read', verb: 'Read', target: '/repo/src/app.ts' })
  assert.equal(describeTool('Edit', '{"file_path":"a.ts"}', true).verb, 'Tried to edit')
  assert.deepEqual(describeTool('Grep', '{"pattern":"login"}'), { kind: 'search', verb: 'Searched', target: 'login' })
  assert.deepEqual(describeTool('Task', '{"description":"Review the diff"}'), { kind: 'other', verb: 'Used', target: 'Task: Review the diff' })
  assert.equal(describeTool('Bash', 'not json').target, 'Bash')
})

test('a run of calls becomes one summary', () => {
  assert.equal(summarizeTools(['Bash', 'Bash', 'Read', 'Read', 'Bash']), 'Ran 3 commands, read 2 files')
  assert.equal(summarizeTools(['Edit']), 'Edited 1 file')
  assert.equal(summarizeTools(['Grep', 'Task']), 'Searched once, used 1 tool')
  assert.equal(summarizeTools(['Bash', 'Read'], true), 'Running 1 command, read 1 file')
})
