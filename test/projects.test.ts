import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../src/shared/model.ts'
import { assignProjects, layoutProjects, assembleProjectGraph, boxNodeId } from '../src/ui/graph/group-projects.ts'
import { globToRegExp, OTHER_PROJECT, ProjectResolver } from '../src/ui/graph/projects.ts'
import { defaultView } from '../src/ui/state/view-store.ts'
import { makeAgent } from './helpers/fixtures.ts'
import { agentNode, edge } from '../src/ui/graph/node-data.ts'
import { buildActivity } from '../src/ui/graph/activity.ts'

function state() {
  const s = emptyState()
  s.capabilities.homeDir = '/home/me'
  s.projects = {
    p1: { id: 'p1', name: 'demo-project-core-backend', path: '/home/me/Coding/demo-project-core-backend', kind: 'git', hostId: 'local', hidden: false },
    p2: { id: 'p2', name: 'orca-improve', path: '/home/me/orca/projects/orca-improve', kind: 'git', hostId: 'local', hidden: false }
  }
  s.worktrees = {
    w1: { id: 'w1', name: 'team-a', path: '/home/me/orca/workspaces/demo-project-core-backend/team-a', branch: 'a', project: 'demo-project-core-backend', projectId: 'p1', hostId: 'local', kind: 'worktree', status: null, terminalCount: null, lastActivityAt: null, version: 1 }
  }
  return s
}

describe('ProjectResolver', () => {
  it('uses Orca’s project for a listed worktree, the project root, and the shared worktree folder for removed ones', () => {
    const r = new ProjectResolver(state())
    assert.equal(r.resolve('/home/me/orca/workspaces/demo-project-core-backend/team-a').key, 'project:p1')
    assert.equal(r.resolve('/home/me/orca/projects/orca-improve/src').key, 'project:p2')
    const removed = r.resolve('/home/me/orca/workspaces/demo-project-core-backend/team-b-gone')
    assert.equal(removed.key, 'project:p1')
    assert.equal(removed.source, 'path')
    assert.equal(r.resolve('/tmp/elsewhere').key, OTHER_PROJECT)
    assert.equal(r.resolve(null).name, 'Other')
  })

  it('your rules win, with ~ and ** globs; names and colors apply', () => {
    const s = state()
    s.labels.projectRules = { '~/orca/workspaces/demo-project-*/**': 'Demo project workers' }
    s.labels.projectNames = { 'project:p2': 'Agent Flow' }
    s.labels.projectColors = { 'project:p2': '#ff0000', 'rule:Demo project workers': 'red;background:url(x)' }
    const r = new ProjectResolver(s)
    const rule = r.resolve('/home/me/orca/workspaces/demo-project-core-backend/team-a')
    assert.equal(rule.key, 'rule:Demo project workers')
    assert.equal(rule.color, null, 'unsafe colors never reach CSS')
    const named = r.resolve('/home/me/orca/projects/orca-improve')
    assert.equal(named.name, 'Agent Flow')
    assert.equal(named.color, '#ff0000')
  })

  it('globToRegExp: * stays in one folder, a plain folder matches inside it', () => {
    assert.ok(globToRegExp('/a/*/c', null).test('/a/b/c'))
    assert.ok(!globToRegExp('/a/*/c', null).test('/a/b/x/c'))
    assert.ok(globToRegExp('/a/**/c', null).test('/a/b/x/c'))
    assert.ok(globToRegExp('/a/b', null).test('/a/b/deep/file'))
    assert.ok(!globToRegExp('/a/b', null).test('/a/bc'))
  })
})

describe('project boxes', () => {
  it('puts each agent in its project box and the lead with the majority of its workers (option A)', () => {
    const s = state()
    const lead = makeAgent('lead:r1', { role: 'lead', runId: 'r1' })
    const w1 = makeAgent('dispatch:1', { role: 'worker', runId: 'r1', parentId: 'lead:r1', worktreePath: '/home/me/orca/workspaces/demo-project-core-backend/team-a', agent: 'claude', live: true, state: 'working' })
    const w2 = makeAgent('dispatch:2', { role: 'worker', runId: 'r1', parentId: 'lead:r1', worktreePath: '/home/me/orca/workspaces/demo-project-core-backend/team-b', agent: 'codex' })
    const w3 = makeAgent('dispatch:3', { role: 'worker', runId: 'r1', parentId: 'lead:r1', worktreePath: '/home/me/orca/projects/orca-improve', agent: 'claude' })
    for (const a of [lead, w1, w2, w3]) s.agents[a.id] = a
    const activity = buildActivity([], Date.now())
    const graph = {
      nodes: [lead, w1, w2, w3].map((a) => agentNode(a, s)),
      edges: [w1, w2, w3].map((w) => edge('lead:r1', w.id, 'assignment', 'running', activity, false))
    }
    const assignment = assignProjects(graph, s)
    assert.equal(assignment.get('lead:r1')?.key, 'project:p1')
    assert.equal(assignment.get('dispatch:3')?.key, 'project:p2')
    const view = defaultView(false)
    const layout = layoutProjects(graph, assignment, view, {})
    const out = assembleProjectGraph(graph, assignment, layout, s)
    const boxes = out.nodes.filter((n) => n.type === 'project')
    assert.equal(boxes.length, 2)
    assert.ok(out.nodes.indexOf(boxes[0]) < out.nodes.findIndex((n) => n.parentId), 'boxes come before their children')
    assert.equal(out.nodes.find((n) => n.id === 'dispatch:3')?.parentId, boxNodeId('project:p2'))
    assert.equal(out.edges.length, 3, 'the cross-project edge is kept')
    const demoBox = boxes.find((b) => b.id === boxNodeId('project:p1'))!
    assert.deepEqual((demoBox.data.agentKinds as string[]).sort(), ['claude', 'codex'])
    assert.equal(demoBox.data.liveAgents, 1)
  })

  it('a collapsed box hides its members and the edges into them', () => {
    const s = state()
    const a = makeAgent('term:x', { worktreePath: '/home/me/orca/projects/orca-improve' })
    s.agents[a.id] = a
    const graph = { nodes: [agentNode(a, s)], edges: [] }
    const assignment = assignProjects(graph, s)
    const view = { ...defaultView(false), collapsed: { [boxNodeId('project:p2')]: true } }
    const out = assembleProjectGraph(graph, assignment, layoutProjects(graph, assignment, view, {}), s)
    assert.deepEqual(out.nodes.map((n) => n.id), [boxNodeId('project:p2')])
  })
})

describe('ProjectResolver: precise matching', () => {
  it('matches a worktree to its repository from the .git pointer', () => {
    const s = state()
    const r = new ProjectResolver(s)
    assert.equal(r.resolve('/home/me/orca/workspaces/orca-improve/eelpout', '/home/me/orca/projects/orca-improve').key, 'project:p2')
  })

  it('a project rooted at the home folder does not swallow everything under it', () => {
    const s = state()
    s.projects.home = { id: 'home', name: 'me', path: '/home/me', kind: 'folder', hostId: 'local', hidden: false }
    const r = new ProjectResolver(s)
    assert.equal(r.resolve('/home/me/Coding/elsewhere/wt').key, OTHER_PROJECT)
    assert.equal(r.resolve('/home/me').key, 'project:home')
    assert.equal(r.resolve('/home/me/orca/projects/orca-improve').key, 'project:p2')
  })
})

describe('ProjectResolver: removed worktrees', () => {
  it('uses the project id Orca gave a dispatch', () => {
    assert.equal(new ProjectResolver(state()).resolve('/somewhere/removed', null, 'p1').key, 'project:p1')
  })

  it('uses Orca’s <workspaces>/<project>/<worktree> layout learned from any listed worktree', () => {
    const s = state()
    s.worktrees = {
      w2: { id: 'w2', name: 'eelpout', path: '/home/me/orca/workspaces/orca-improve/eelpout', branch: 'x', project: 'orca-improve', projectId: 'p2', hostId: 'local', kind: 'worktree', status: null, terminalCount: null, lastActivityAt: null, version: 1 }
    }
    const r = new ProjectResolver(s)
    assert.equal(r.resolve('/home/me/orca/workspaces/demo-project-core-backend/team-b-gone').key, 'project:p1')
    assert.equal(r.resolve('/home/me/orca/workspaces/unknown-project/x').key, OTHER_PROJECT)
  })
})
