# feat(plugins): `agent.sendMessage` and `agent.readOptions` for Orca chats (host API 1.11)

## Motivation

Plugins can watch agents (`agents.list`, `agent.status.changed`) and type into terminals (`terminal.sendText`), but nothing in the plugin host API reaches Orca's own chat sessions (native chat). Dashboard plugins such as Agent Flow, which shows every running agent as a node a person can click and prompt, can't send a message to a chat agent, and can't show which model and effort it runs. Today a plugin's only options are bad ones: drive the UI, or call internal runtime RPC that has no result schema and no stability promise.

Orca already does this for its own clients. The mobile app sends through RPC `agentSession.send` and reads `agentSession.options`, and automations and connectors send through the chat host (`sendAgentTurn`). This PR adds a small, frozen, permission-gated facade over that path, following the host API conventions (strict zod params and results, capability gate, audit log, `Since` minor, generated reference and typings).

## API

Host API minor goes from 1.10 to **1.11** (release floor `1.4.261`, provisional like earlier floors).

### `agent.sendMessage` (worker only, mutation, capability `agent:message`)

```ts
(params: { chatSessionId: string; text: string; delivery?: "queue" | "now" }) => { status: "sent" | "queued" }
```

- `chatSessionId` is Orca's chat session id (`^[A-Za-z0-9_-]{8,128}$`). It is not the agent's own `sessionId`, which `agent.resume` takes.
- `text` is 1 to 32768 characters and must not be blank. No attachments or skills (open question 4).
- `delivery: "queue"` (default) works like a person's send: a busy chat holds the message as a queued card. `"now"` steers the running turn.
- `status: "sent"` means the chat took the message as a turn. `"queued"` means it is held until the current turn ends. Neither means the agent answered; the plugin watches `agent.status.changed` for that.
- Errors:
  - `action_failed`: unknown chat, group chat (`bot-group-…`), the chat refused, the agent rejected the message, a hook denied it (the message names the plugin and its reason), or a hook rewrote it into an invalid message.
  - `rate_limited` with `retryAfterMs`.
  - `unavailable`: no chat host runs.
  - `consent_required`: the plugin lost approval mid-call.

### `agent.readOptions` (all surfaces, read-only, capability `agent:read`)

```ts
(params: { chatSessionId: string }) => { agent: string; model: string | null; effort: string | null }
```

Returns the model and effort the chat's next turn uses, which is what its model picker shows. It reads the chat host's `readOptions` in process.

### How a plugin learns `chatSessionId` (additive result and event fields)

- `agents.list` rows gain `chatSessionId?: string | null`: the chat's id, or null for a terminal agent.
- `agent.status.changed` gains `chatSessionId?: string`.

Both are derived from the chat's status pane key (`structured-agent-session-<id>:<leaf>`) with the existing `structuredSessionIdFromNotificationPane`. Plugins no longer need to parse pane keys themselves.

### Hook: `agent.prompt.before` now covers plugin chat messages

The payload gains `chatSessionId?: string`. For a chat message, `terminalId` carries the chat's pane key, because the field is required and can't be narrowed within major 1 (open question 2). `inputKind` is `"driving"`. Guards can rewrite `prompt` (the rewrite is validated against the same text bounds) or `{ deny }` it. As for terminals, a person's own typed messages are never hooked; only plugin sends are.

## Security and permission model

- **New capability `agent:message`** (worker-only in `plugin-capability-reach`, `Since` 1.4.261). Consent copy: *"Send messages to your agents' chats in Orca, which the agent then acts on with its own tools and permissions; each shows in the chat as a message you sent."* I chose a new capability over reusing `terminal:send` or `agent:launch`. Consent binds the capability set, not its wording, so widening an existing capability would give already-approved plugins the power to drive chats with no new prompt. The renderer falls back to the English description, as it does for `history:read`.
- **Worker only.** A message runs the agent with the person's tools and permissions, so panels and editors get `not_permitted`. This matches `terminal.sendText` and `agent.launch`. `agent.readOptions` is harmless metadata under `agent:read`, so frames can call it too (Agent Flow's UI is a panel).
- **Audit log.** `agent.sendMessage` is a mutation, so the existing chokepoint records `attempt`/`ok`/`error` as `plugin:<key>`. The summary is `chat=<id> chars=<n> delivery=<queue|now>` and never contains the text.
- **Rate limit.** 10 messages per 60 s sliding window per plugin, across all chats, charged before the chat lookup so a loop over bad ids also stalls. Over the limit the call fails with `rate_limited` and `retryAfterMs`. This reuses `createPanelMessageBudget`.
- **Approval re-checks.** `scope.assertActive()` runs after the hook chain (which can take up to 2 s per plugin) and again synchronously at chat-host admission (`beforeRun`). A plugin disabled mid-call sends nothing.
- **Scope.** Only chats this Orca's chat host holds can be reached. A paired Orca server's chats aren't in the local store and are refused (`no Orca chat has this id`). Group chats are refused, as `agentSession.send` refuses them.
- **Provenance.** The message is sent like automation and connector messages: a fresh operation id, the chat's current fence, its own operation ledger (`trusted-local:plugin:<key>`), and no `typedBy`, `userSend` or `personsMessage`. It shows as a message the person sent (open question 3).

## Implementation

New files:

| File | What |
| --- | --- |
| `src/shared/plugins/workers/plugin-host-api-agent-chat.ts` | Specs and schemas for both methods, text and rate constants |
| `src/shared/plugins/workers/plugin-chat-session-id.ts` | `pluginChatSessionIdSchema`, kept light so plugin schemas don't import the chat record module |
| `src/shared/plugins/workers/plugin-host-api-1-11.ts` | Release floor |
| `src/main/plugins/workers/host-api/plugin-agent-chat-service.ts` | Structural service type, so the bindings stay electron-free and testable |
| `src/main/plugins/workers/host-api/plugin-host-agent-chat-bindings.ts` | Handlers: rate limit, chat lookup, `agent.prompt.before`, approval re-check |
| `src/main/plugins/workers/host-api/plugin-agent-message-budget.ts` | Per-plugin sliding window |
| `src/main/plugins/runtime/plugin-agent-chats.ts` | The real service over `getStructuredAgentSessionHost()` and `sendAgentTurn` (installs the chat host on first use) |
| `src/main/plugins/workers/host-api/plugin-host-agent-chat.test.ts`, `src/main/plugins/runtime/plugin-agent-chats.test.ts` | Tests |

Changed files:
- `plugin-host-api.ts` (spread the new specs)
- `plugin-host-api-releases.ts` (1.11 row)
- `plugin-host-api-panel-methods.ts` (`agents.list` row field)
- `plugin-events.ts` and `plugin-hook-payloads.ts` (optional `chatSessionId`)
- `plugin-capabilities.ts` and `plugin-capability-reach.ts`
- `plugin-host-method-bindings.ts` (service and handlers)
- `plugin-host-methods.ts` (audit summary)
- `plugin-host-service-bindings.ts` and `plugin-runtime-binding.ts` (wiring, event field)
- `plugin-workspace-projection.ts` (`pluginChatSessionId`)
- Hand-edited generated outputs: `docs/reference/plugin-host-api.md`, `docs/reference/plugin-manifest.md`, `docs/schemas/plugins/orca-plugin.v2.schema.json`, `resources/plugins/types/orca-host.d.ts`

## Test plan

Unit tests (vitest, following `plugin-host-agents-list.test.ts` / `plugin-host-agent-history.test.ts` and the `callPluginHost` fixture):

- [ ] `agent.sendMessage` sends with `delivery: "queue"` by default, and passes `"now"` through. It reports `queued`.
- [ ] The audit record carries `chat=… chars=… delivery=…` and never the text.
- [ ] `capability_denied` without `agent:message`. `not_permitted` from a panel.
- [ ] `invalid_params` for: empty or blank text, text over 32 KiB, bad id, unknown `delivery`, unknown field (strict).
- [ ] `action_failed` for an unknown chat and for a `bot-group-…` chat. `unavailable` without a chat host.
- [ ] `agent.prompt.before` receives `{ agent, terminalId: <pane key>, prompt, inputKind: "driving", chatSessionId }`, and the rewritten prompt is what gets sent.
- [ ] A deny sends nothing and names the plugin and its reason. A blank rewrite is refused.
- [ ] The 11th message in 60 s is `rate_limited` with `retryAfterMs = 60000`, and sending works again after the window.
- [ ] Losing approval while a hook runs gives `consent_required` and nothing is sent.
- [ ] `agent.readOptions` works from a panel, maps empty values to null, needs `agent:read`, and refuses unknown chats.
- [ ] `agents.list` gives `chatSessionId` for a chat row and null for a terminal row.
- [ ] `pluginAgentChats`:
  - [ ] installs the chat host lazily, and `unavailable` keeps the failure as log detail
  - [ ] sends with the plugin caller key, the current fence, an `<13 digits>-<32 hex>` operation id and a plain user body
  - [ ] maps `refused`, `queued`, `sent` and rejected outcomes
  - [ ] refuses a chat that vanished before the send
  - [ ] reads model and effort

Before merging (I couldn't run these: dependencies weren't installed in my checkout):

- [ ] `pnpm typecheck`, `pnpm test src/main/plugins src/shared/plugins`, lint
- [ ] `pnpm generate:plugin-schemas && pnpm generate:plugin-author-typings && pnpm generate:plugin-authoring-skill-references && pnpm generate:plugin-declarative-runtime`, then diff against my hand edits. The skill references (`skill-guides/orca-plugin-authoring/references/*.md`), `src/cli/skills/bundled-skill-guides.ts` and `resources/plugins/declarative/*.mjs` are **not** updated in this patch and need regenerating.
- [ ] Manual: a dev plugin with `agent:message` sends to a local chat (idle: `sent`, starts a turn; busy: `queued` card), to an SSH chat, and to a WSL chat. A guard plugin with `agent.prompt.before` denies it. `orca plugin logs` and the audit log show the call without the text.

## Open questions for maintainers

1. **Capability.** Is a new `agent:message` right, or would you rather fold this into `agent:launch` with a consent re-prompt? The wording of the consent copy is also open.
2. **Hook payload shape.** `agent.prompt.before.terminalId` is required, so for chats I put the chat's pane key in it and added `chatSessionId`. The alternatives are a separate `agent.chat.before` hook, or making `terminalId` optional in a new major.
3. **Sender label.** The message shows as the person's (like automations). Would you want a plugin provenance on the journal item (`from`/`origin: 'plugin'` with the plugin name) so the chat can label it? That touches the journal types, so I kept it out.
4. **Scope of v1.** I left out attachments, skills, `options` (model or effort per message), and setting the model. Should `agent.readOptions` also return the model list, or should a later `agent.setOptions` cover that?
5. **SSH, WSL and paired hosts.** I assumed the local chat host's `send` drives SSH and WSL chats it holds, as it does for automations. Please confirm. Paired-server chats are refused. Should they be relayed instead?
6. **Limits.** Is 32 KiB text (vs `PLUGIN_HOST_TEXT_MAX_LENGTH` 4096 for launch prompts) and 10 messages per minute per plugin OK? Should the budget be cleared when a plugin is disabled (it's tiny and keyed by plugin)?
7. **Proposed first?** Should these ship `proposed: true` (dev plugins only) for a release before freezing into 1.11? The release floor `1.4.261` is a placeholder.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
