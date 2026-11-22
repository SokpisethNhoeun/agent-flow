// The read-only walkthrough of the real dashboard: it never presses Send, Confirm, Retry or Stop.
import { sleep } from './browser.mjs'

// Each step is one person-like action, then a screenshot and a check of what should now be true.
export const liveSteps = ({ click, hover, key, rightClick, type, fill, evaluate }) => [
  { name: 'Dashboard loaded', act: () => {}, expect: `T.all('.react-flow__node').length > 0` },
  { name: 'Click “Workflow”', act: () => click('radio', 'Workflow'), expect: `T.btn('Workflow').getAttribute('data-state') === 'on'` },
  { name: 'Click “Hierarchy”', act: () => click('radio', 'Hierarchy'), expect: `T.btn('Hierarchy').getAttribute('data-state') === 'on'` },
  { name: 'Open the run dropdown', act: () => click('combobox', 'Orchestration run'), expect: `T.open('listbox') && T.all('[role=option]').length > 1` },
  { name: 'Pick the first run', act: () => click('option', /./, 1), expect: `!T.open('listbox') && !T.label('Orchestration run').innerText.includes('All runs')` },
  { name: 'Open the run dropdown again', act: () => click('combobox', 'Orchestration run'), expect: `T.open('listbox')` },
  { name: 'Pick “All runs and agents”', act: () => click('option', 'All runs and agents'), expect: `T.label('Orchestration run').innerText.includes('All runs')` },
  { name: 'Open the project dropdown', act: () => click('combobox', 'Project'), expect: `T.open('listbox')` },
  { name: 'Press Escape to close it', act: () => key('Escape'), expect: `!T.open('listbox')` },
  { name: 'Click “Flat”', act: () => click('radio', 'Flat'), expect: `T.all('.react-flow__node-project').length === 0` },
  { name: 'Click “Boxes”', act: () => click('radio', 'Boxes'), expect: `T.all('.react-flow__node-project').length > 0` },
  { name: 'Click “All”', act: () => click('radio', 'All'), expect: `T.btn('All').getAttribute('data-state') === 'on'` },
  { name: 'Click “Active”', act: () => click('radio', 'Active'), expect: `T.btn('Active').getAttribute('data-state') === 'on'` },
  { name: 'Click search and type “orca”', act: () => { click('textbox', 'Search nodes'); type('orca') }, expect: `T.label('Search nodes').value === 'orca'` },
  { name: 'Clear the search', act: () => fill('textbox', 'Search nodes', ''), expect: `T.label('Search nodes').value === ''` },
  { name: 'Hover “Auto-layout” (tooltip)', act: async () => { hover('button', 'Auto-layout (l)'); await sleep(700) }, expect: `T.open('tooltip')` },
  { name: 'Open “needs you”', act: () => click('button', /needs? you$/), expect: `T.open('menu') && T.all('[role=menuitem]').length > 0`, optional: `!!T.css('.af-attention-btn')` },
  { name: 'Pick the first item', act: () => click('menuitem', /./), expect: `!T.open('menu') && !!T.tab('Info')`, optional: `T.open('menu')` },
  { name: 'Click the “Chat” tab', act: () => click('tab', /^Chat/), expect: `T.tab('Chat').getAttribute('data-state') === 'active' && /messages|No output|Loading/.test(T.text())`, settle: 2500, optional: `!!T.tab('Chat')` },
  { name: 'Click the “Log” tab', act: () => click('tab', /^Log/), expect: `T.tab('Log').getAttribute('data-state') === 'active'`, optional: `!!T.tab('Log')` },
  { name: 'Click the “Git” tab', act: () => click('tab', /^Git/), expect: `T.tab('Git').getAttribute('data-state') === 'active'`, settle: 1500, optional: `!!T.tab('Git')` },
  { name: 'Click the “Actions” tab', act: () => click('tab', /^Actions/), expect: `T.tab('Actions').getAttribute('data-state') === 'active'`, optional: `!!T.tab('Actions')` },
  { name: 'Click the “Info” tab', act: () => click('tab', /^Info/), expect: `T.tab('Info').getAttribute('data-state') === 'active'`, optional: `!!T.tab('Info')` },
  { name: 'Right-click a card (context menu)', act: () => rightClick('.react-flow__node:not(.react-flow__node-project)'), expect: `T.open('menu') && !!T.menuText('Inspect')` },
  { name: 'Press Escape to close the menu', act: () => key('Escape'), expect: `!T.open('menu')` },
  { name: 'Open “Project boxes” dialog', act: () => click('button', 'Project boxes: names, colors and path rules'), expect: `T.open('dialog')` },
  { name: 'Close it with the × button', act: () => click('button', 'Close'), expect: `!T.open('dialog')` },
  { name: 'Open “Team and role labels” dialog', act: () => click('button', 'Team and role labels'), expect: `T.open('dialog')` },
  { name: 'Press Escape to close it', act: () => key('Escape'), expect: `!T.open('dialog')` }
]
