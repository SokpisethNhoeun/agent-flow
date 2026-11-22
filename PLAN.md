# Agent Flow: architecture and implementation plan

An n8n-style visual view of multi-agent work in Orca, delivered as an open-source **Orca plugin**.
Verified against Orca **1.4.259** (host API 1.x, `pluginApi: 1`) on 2026-11-22.

## 1. Architecture decision

**Choice: `trusted-worker` plugin, no Orca core changes.**

| Option | Verdict |
| --- | --- |
| Native Orca plugin | **Chosen.** The worker is a full Node process. It gets live agent status, tool-call hooks (Claude subagent spawns), session history, terminal and launch controls through the documented host API, plus orchestration runs, tasks, dispatches, messages and gates through the documented `orca` CLI. It survives Orca updates and installs from Git. |
| Integrated workspace in Orca core | Only needed for gaps listed in section 9. Proposed upstream rather than patched locally. |
| Patched AppImage | Rejected: minified, hashed bundles break on every release. |

No competing runtime: the plugin only **observes** Orca and **asks Orca** to act through supported
APIs. It never launches agent processes or edits orchestration state directly.

## 2. Verified runtime data sources

| Need | Source (verified) | Evidence level |
| --- | --- | --- |
| Agents per workspace, live state | host `agents.list` + event `agent.status.changed` (state, terminalId, paneKey, sessionId, outcome) | live |
| All workspaces / worktrees / branches | host `workspace.list` (`includeStatus`) + `workspace.created/removed` | live |
| Claude subagents | hook `agent.tool.before/after` where `tool` is `Task`/`Agent` (callId, input.description, subagent_type) | live, per call |
| Tool-call activity | hook `agent.tool.after` | live |
| Orchestration runs | `orca orchestration run-list/run-show --json` | durable |
| Tasks + dependency DAG | `orca orchestration task-list --run <id> --json --full` (deps, parent_id, status, result, timestamps) | durable |
| Workers / dispatches | `orca orchestration worker-list` and `worker-show --full` (agent, model, effort, worktree, retryOf, depth, failures, liveness) | durable + live |
| Agent-to-agent messages / handoffs | `orca orchestration inbox --full --json` (from/to handle, type `worker_done`/`ask`/…, payload) | durable |
| Decision gates (blockers) | `orca orchestration gate-list` | durable |
| Accounts | `orca account list --json` (id, email, provider; active account) | durable |
| Session → account | `claude-profiles/<accountId>/home/sessions/<pid>.json` (sessionId) first; fallback hook `agent.launch.before` (`CLAUDE_CONFIG_DIR`/profile in env, recorded, never tokens) | live |
| Tokens / message counts | host `agent.listSessions` (`history:read`) | durable |
| Terminal output | host `terminal.read` (≤2000 lines) and `orchestration worker-read` | live |

CLI calls take about 0.2 s each, so polling every 3 s (adaptive: 1.5 s while anything runs, 10 s when idle) is cheap.

## 3. Surfaces

1. **Sidebar panel** (`contributes.panels`, right sidebar): compact live canvas plus an "Open full canvas" button.
2. **Full canvas editor** (`contributes.customEditors` for `.agentflow`, `frame: isolated`, plus a
   `newFiles` entry "New Agent Flow canvas"): the full-screen n8n-style workspace in an editor tab.
   The `.agentflow` file stores view settings and node positions.
3. **Standalone dashboard**: the worker serves the same UI bundle on `127.0.0.1:<port>`. A random
   token is kept in plugin secrets, and all `/api` calls and the SSE stream need it. Off by default,
   switched on in plugin settings. Control commands need the token plus same-origin checks.
4. **Status bar item**: "Agent Flow · N running". It also keeps the worker alive so history and the dashboard keep working.

All three UIs run one React app with a pluggable transport (Orca frame bridge vs HTTP+SSE).

## 4. Data flow

```
Orca runtime ──► adapters (agents · subagents · orchestration · accounts · sessions · worktrees)
                    │ normalized events {id, seq, ts, source, kind, entityId, data}
                    ▼
            authoritative store (worker)  ── persistence (storage:own, debounced, bounded)
                    │ snapshot + ordered deltas (batched 250 ms)
          ┌─────────┴───────────┐
   panel/editor (plugin.request + panels.post)   dashboard (HTTP snapshot + SSE)
                    │
          graph builders (hierarchy | workflow) ─► dagre layout ─► React Flow
```

- **Separate models**: `runtime` (agents/sessions), `tasks` (lifecycle), `presentation` (positions,
  collapsed groups, view mode, kept in the `.agentflow` file / UI storage).
- **Ordering & dedupe**: monotonically increasing `seq`, per-entity `version` with an observed-at
  timestamp, so older observations never overwrite newer ones. Event ids are deduped in a bounded LRU.
- **Recovery**: the UI tracks `seq`. On a gap or reconnect it re-fetches the snapshot. The worker persists
  a compact snapshot and history and reloads them on start, then re-syncs from live sources.

## 5. Event contract (normalized)

`agent.created|started|status_changed|completed|failed`, `subagent.spawned|completed`,
`task.created|assigned|started|updated|completed|failed|blocked|retried`, `review.*`, `test.*`,
`worktree.created|updated|removed`, `message.sent`, `orchestration.started|completed`, `tool.called`.
Each event names its source (`host-event`, `hook`, `cli-poll`, `session-file`) so the inspector can show evidence.

## 6. Command contract

Every command: `{ requestId, kind, params }`. The worker validates it with strict validators, checks
capability (`orca.host.has` / CLI availability), dedupes `requestId`, then runs **one** supported
operation and returns `{ ok, result | error }`. Destructive kinds need `confirmed: true`, which the UI
sends only after a confirmation dialog.

| Kind | Backend | Destructive |
| --- | --- | --- |
| `terminal.focus` | host `terminal.focus` | no |
| `terminal.read` | host `terminal.read` / CLI `worker-read` | no |
| `agent.launch` | host `agent.launch` | no |
| `agent.resume` | host `agent.resume` | no |
| `agent.stop` | CLI `worker-stop` (orchestration worker) / host `terminal.close` (own terminals only) | **yes** |
| `task.create` | CLI `task-create --run` | no |
| `task.update` (status) | CLI `task-update` (valid transitions only) | when failing/cancelling |
| `task.cancel` | CLI `worker-stop` + `task-update --status failed --result cancelled` | **yes** |
| `task.retry` | CLI `worker-start --task --retry-of` (+ agent/model/effort choice) | no |
| `task.dispatch` | CLI `worker-start --task` | no |
| `gate.resolve` | CLI `gate-resolve` | no |
| `worktree.create` | host `workspace.create` | no |
| `worktree.open` | host `workspace.open` | no |
| `message.send` | CLI `send` | no |
| `model.change` (running agent) | **not supported**, disabled with reason | — |

## 7. Folder structure

```
orca-plugin.json  package.json  build.mjs  tsconfig.json  README.md  PLAN.md  LICENSE
src/shared/        model, events, commands (+validation), task state machine, redaction, ids
src/worker/        main (activate), store, persistence, history,
                   adapters/ (agents, subagents, orchestration, accounts, sessions, worktrees),
                   cli/ (orca CLI runner), commands/ (router + handlers),
                   transport/ (panel bridge), dashboard/ (http server, auth)
src/ui/            main, App, transport/, state/, graph/ (builders, layout),
                   nodes/ (9 node types + shell), edges/, panels/ (toolbar, explorer,
                   inspector, bottom), components/ (shared primitives), styles/
ui/                panel.html, canvas.html (editor), dashboard.html
test/              unit tests (node:test) for shared/worker/graph code
dist/              built bundles (committed so Git installs need no build)
```

## 8. Visual design

- React Flow (`@xyflow/react`) canvas: dot background, minimap, controls, fit view, multi-select,
  search, context menu, keyboard navigation, persisted positions, collapsible groups.
- Layout: `@dagrejs/dagre` (synchronous, small), top-to-bottom for hierarchy and left-to-right for workflow.
- Edges: custom `FlowEdge` with smooth-step path, arrow marker, status color, and SVG particles
  (`animateMotion`) **only** while the edge is RUNNING/REVIEW/TESTING **and** has had verified
  activity recently. Respects `prefers-reduced-motion`. No particles past 150 animated edges.
- Theme: Orca `--orca-*` frame tokens with fallbacks, so light and dark follow Orca live.

## 9. Known gaps (documented, not faked)

- Changing a **running** agent's model/effort: no API. Disabled. Choosing model/effort on
  retry/dispatch **is** supported via `worker-start --model --effort`.
- Pause/resume: no API. Disabled.
- Subagents of non-Claude agents: no hook identity. Not drawn.
- Subagent transcripts / full conversations: not exposed. Inspector shows terminal output,
  tool calls, task spec/result and orchestration messages instead.
- Account per session: evidence-based (session files / launch capture). Otherwise "unknown".
- Git diff/commits: worker runs read-only `git` in the worktree path (`git status --porcelain`,
  `git log -n 20`, `git diff --stat`). No writes, merges or pushes from the plugin.
- Merge operations: not exposed by the plugin API. The UI links to Orca's own source-control view.

## 10. Phases

1. Audit and plan (this document). 2. Shared contracts and worker data layer. 3. Canvas UI.
4. Controls. 5. History, replay, dashboard. 6. Tests and live validation (`orca plugin check`,
`orca plugin dev load`, a real test orchestration run, `orca plugin shot`). 7. Review and deliver.
