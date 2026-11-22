// src/worker/runtime.ts
import { homedir as homedir7 } from "node:os";
import { fileURLToPath } from "node:url";

// src/shared/commands.ts
var DESTRUCTIVE_COMMANDS = /* @__PURE__ */ new Set(["agent.stop", "task.cancel"]);
var ALL_COMMANDS = [
  "terminal.focus",
  "terminal.read",
  "agent.launch",
  "agent.resume",
  "agent.stop",
  "agent.readOutput",
  "task.create",
  "task.update",
  "task.cancel",
  "task.retry",
  "task.dispatch",
  "gate.resolve",
  "worktree.create",
  "worktree.open",
  "worktree.inspect",
  "message.send",
  "model.change",
  "labels.update",
  "history.list",
  "history.load",
  "dashboard.info",
  "entity.detail",
  "dashboard.enable",
  "dashboard.controls",
  "agent.prompt",
  "agent.image",
  "viewer.ping",
  "agent.attach",
  "star.visit",
  "star.answer",
  "update.check",
  "update.run"
];
var READ_ONLY_COMMANDS = /* @__PURE__ */ new Set([
  "terminal.read",
  "agent.readOutput",
  "worktree.inspect",
  "history.list",
  "history.load",
  "dashboard.info",
  "entity.detail",
  "agent.image",
  "viewer.ping",
  // Only Agent Flow's own "star the project" prompt state; nothing in Orca changes.
  "star.visit",
  "star.answer",
  "update.check"
]);
var ValidationError = class extends Error {
  code = "invalid_params";
};
var ID = /^[A-Za-z0-9_:.\-/@]{1,400}$/;
var AGENT = /^[a-z0-9][a-z0-9-]{0,40}$/;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var MODEL = /^[A-Za-z0-9_.:@/\-[\]]{1,120}$/;
var EFFORT = /^[a-z]{1,20}$/;
var TASK_STATUS = ["pending", "ready", "dispatched", "completed", "failed", "blocked"];
var WORKTREE_MODES = ["new-child", "current"];
var COMMAND_PARAMS = {
  "terminal.focus": { terminalId: { type: "string", required: true, pattern: ID } },
  "terminal.read": { terminalId: { type: "string", required: true, pattern: ID } },
  "agent.launch": {
    workspaceId: { type: "string", required: true, pattern: ID },
    agent: { type: "string", required: true, pattern: AGENT },
    prompt: { type: "string", max: 2e4 }
  },
  "agent.resume": {
    workspaceId: { type: "string", required: true, pattern: ID },
    agent: { type: "string", required: true, pattern: AGENT },
    sessionId: { type: "string", required: true, pattern: ID }
  },
  "agent.stop": { agentId: { type: "string", required: true, pattern: ID } },
  "agent.readOutput": {
    agentId: { type: "string", required: true, pattern: ID },
    before: { type: "string", max: 200, pattern: /^[A-Za-z0-9_.:-]{1,200}$/ },
    /** The version the view already shows: an unchanged answer is then sent as `{ unchanged: true }`. */
    since: { type: "string", max: 64, pattern: /^[a-f0-9]{8,64}$/ }
  },
  "task.create": {
    runId: { type: "string", required: true, pattern: ID },
    title: { type: "string", required: true, max: 200 },
    spec: { type: "string", required: true, max: 6e4 },
    deps: { type: "stringArray", maxItems: 50, pattern: ID },
    parentId: { type: "string", pattern: ID }
  },
  "task.update": {
    taskId: { type: "string", required: true, pattern: ID },
    runId: { type: "string", required: true, pattern: ID },
    status: { type: "string", required: true, oneOf: TASK_STATUS },
    result: { type: "string", max: 4e3 }
  },
  "task.cancel": {
    taskId: { type: "string", required: true, pattern: ID },
    runId: { type: "string", required: true, pattern: ID }
  },
  "task.retry": {
    taskId: { type: "string", required: true, pattern: ID },
    runId: { type: "string", required: true, pattern: ID },
    agent: { type: "string", pattern: AGENT },
    model: { type: "string", pattern: MODEL },
    effort: { type: "string", pattern: EFFORT },
    worktree: { type: "string", oneOf: WORKTREE_MODES }
  },
  "task.dispatch": {
    taskId: { type: "string", required: true, pattern: ID },
    runId: { type: "string", required: true, pattern: ID },
    agent: { type: "string", pattern: AGENT },
    model: { type: "string", pattern: MODEL },
    effort: { type: "string", pattern: EFFORT },
    worktree: { type: "string", oneOf: WORKTREE_MODES }
  },
  "gate.resolve": {
    gateId: { type: "string", required: true, pattern: ID },
    runId: { type: "string", required: true, pattern: ID },
    resolution: { type: "string", required: true, max: 4e3 }
  },
  "worktree.create": {
    projectId: { type: "string", required: true, pattern: ID },
    name: { type: "string", max: 120 },
    baseBranch: { type: "string", max: 200 },
    agent: { type: "string", pattern: AGENT },
    prompt: { type: "string", max: 2e4 }
  },
  "worktree.open": { workspaceId: { type: "string", required: true, pattern: ID } },
  "worktree.inspect": { path: { type: "string", required: true, max: 1e3 } },
  "message.send": {
    runId: { type: "string", required: true, pattern: ID },
    to: { type: "string", required: true, pattern: ID },
    subject: { type: "string", required: true, max: 200 },
    body: { type: "string", required: true, max: 2e4 }
  },
  "model.change": {
    agentId: { type: "string", required: true, pattern: ID },
    model: { type: "string", pattern: MODEL },
    effort: { type: "string", pattern: EFFORT }
  },
  "labels.update": {
    accountTeams: { type: "record", maxKeys: 100 },
    agentRoles: { type: "record", maxKeys: 100 },
    projectNames: { type: "record", maxKeys: 200 },
    projectColors: { type: "record", maxKeys: 200 },
    projectRules: { type: "record", maxKeys: 100 },
    leadAccount: { type: "string", max: 300 }
  },
  "history.list": {},
  "history.load": { runId: { type: "string", required: true, pattern: ID } },
  "dashboard.info": {},
  /** A visible UI says it is still open, so the worker keeps its fast pace. */
  "viewer.ping": {},
  "agent.image": { agentId: { type: "string", required: true, pattern: ID }, ref: { type: "string", required: true, max: 200, pattern: /^[A-Za-z0-9_.:-]{1,120}\|\d{1,4}(\|\d{1,4})?$/ }, offset: { type: "string", pattern: /^\d{1,9}$/ } },
  "agent.prompt": {
    agentId: { type: "string", required: true, pattern: ID },
    text: { type: "string", max: 2e4 },
    /** Images uploaded with agent.attach (their ids, never paths). */
    attachments: { type: "stringArray", maxItems: 5, pattern: UUID }
  },
  /** Records today's visit; answers whether to show the "star on GitHub" prompt now. */
  /** Is a newer release out? (installed copies only; cached for 6 hours unless forced) */
  "update.check": { force: { type: "boolean" } },
  /** Runs `orca plugin update` for this plugin. */
  "update.run": {},
  "star.visit": {},
  "star.answer": { answer: { type: "string", required: true, oneOf: ["starred", "later", "never"] } },
  /** One base64 chunk of an image for the message box; the last one (`done`) saves it. */
  "agent.attach": {
    uploadId: { type: "string", required: true, pattern: UUID },
    mediaType: { type: "string", required: true, oneOf: ["image/png", "image/jpeg", "image/webp", "image/gif"] },
    chunk: { type: "string", required: true, max: 5e4, pattern: /^[A-Za-z0-9+/]*={0,2}$/ },
    offset: { type: "string", required: true, pattern: /^\d{1,9}$/ },
    done: { type: "boolean" }
  },
  "dashboard.controls": { enabled: { type: "boolean", required: true } },
  "dashboard.enable": { enabled: { type: "boolean", required: true } },
  "entity.detail": { key: { type: "string", required: true, max: 420, pattern: /^(task|message):[A-Za-z0-9_:.\-]{1,400}$/ } }
};
function validateCommand(input) {
  if (!isRecord(input)) throw new ValidationError("Command must be an object.");
  const { requestId, kind, params, confirmed } = input;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ValidationError("requestId is missing or malformed.");
  if (typeof kind !== "string" || !ALL_COMMANDS.includes(kind)) throw new ValidationError(`Unknown command "${String(kind)}".`);
  if (confirmed !== void 0 && typeof confirmed !== "boolean") throw new ValidationError("confirmed must be a boolean.");
  const spec = COMMAND_PARAMS[kind];
  const raw = params === void 0 ? {} : params;
  if (!isRecord(raw)) throw new ValidationError("params must be an object.");
  for (const key of Object.keys(raw)) if (!Object.hasOwn(spec, key)) throw new ValidationError(`Unknown field "${key}" for ${kind}.`);
  const clean2 = {};
  for (const [key, field] of Object.entries(spec)) {
    const value = raw[key];
    if (value === void 0 || value === null || value === "") {
      if (field.required) throw new ValidationError(`${key} is required for ${kind}.`);
      continue;
    }
    clean2[key] = checkField(kind, key, field, value);
  }
  return { requestId, kind, params: clean2, confirmed: confirmed === true };
}
function checkField(kind, key, field, value) {
  const where = `${key} for ${kind}`;
  switch (field.type) {
    case "string": {
      if (typeof value !== "string") throw new ValidationError(`${where} must be a string.`);
      if (field.max !== void 0 && value.length > field.max) throw new ValidationError(`${where} is longer than ${field.max} characters.`);
      if (field.pattern && !field.pattern.test(value)) throw new ValidationError(`${where} has characters that are not allowed.`);
      if (field.oneOf && !field.oneOf.includes(value)) throw new ValidationError(`${where} must be one of ${field.oneOf.join(", ")}.`);
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new ValidationError(`${where} must be true or false.`);
      return value;
    case "stringArray": {
      if (!Array.isArray(value)) throw new ValidationError(`${where} must be a list.`);
      if (field.maxItems !== void 0 && value.length > field.maxItems) throw new ValidationError(`${where} has too many items.`);
      for (const item of value) {
        if (typeof item !== "string" || field.pattern && !field.pattern.test(item)) throw new ValidationError(`${where} has an invalid item.`);
      }
      return [...new Set(value)];
    }
    case "record": {
      if (!isRecord(value)) throw new ValidationError(`${where} must be an object.`);
      const entries = Object.entries(value);
      if (field.maxKeys !== void 0 && entries.length > field.maxKeys) throw new ValidationError(`${where} has too many entries.`);
      const out = {};
      for (const [k, v] of entries) {
        if (typeof v !== "string" || k.length > 300 || v.length > 120) throw new ValidationError(`${where} entries must be short strings.`);
        out[k] = v;
      }
      return out;
    }
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/shared/model.ts
var EMPTY_LABELS = { accountTeams: {}, agentRoles: {}, leadAccount: null, projectNames: {}, projectColors: {}, projectRules: {} };
function emptyLabels() {
  return { accountTeams: {}, agentRoles: {}, leadAccount: null, projectNames: {}, projectColors: {}, projectRules: {} };
}
function emptyCapabilities() {
  return { hostMethods: {}, commands: {}, actAsCoordinator: false, cliAvailable: false, cliPath: null, hooks: false, dashboard: { enabled: false, url: null }, apiMinor: 0, homeDir: null };
}
function emptyState() {
  return {
    seq: 0,
    generatedAt: Date.now(),
    agents: {},
    tasks: {},
    runs: {},
    messages: [],
    gates: {},
    worktrees: {},
    toolCalls: [],
    accounts: {},
    projects: {},
    capabilities: emptyCapabilities(),
    // A fresh copy: a shared object would let one state's labels leak into another.
    labels: emptyLabels()
  };
}

// src/worker/adapters/accounts-adapter.ts
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// src/worker/context.ts
function newAgent(id, role, now) {
  return {
    id,
    role,
    agent: null,
    title: null,
    parentId: null,
    runId: null,
    dispatchId: null,
    taskId: null,
    terminalId: null,
    terminalHandle: null,
    paneKey: null,
    sessionId: null,
    workspaceId: null,
    worktreePath: null,
    branch: null,
    model: null,
    effort: null,
    account: null,
    state: "unknown",
    outcome: null,
    stateSince: null,
    startedAt: null,
    endedAt: null,
    lastSeenAt: now,
    live: false,
    tokens: null,
    messageCount: null,
    failureCount: 0,
    retryOfDispatchId: null,
    callId: null,
    subagentType: null,
    description: null,
    evidence: [],
    version: 0
  };
}
function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value || value === "None") return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}
function str(value) {
  return typeof value === "string" && value !== "" && value !== "None" ? value : null;
}

// src/worker/adapters/accounts-adapter.ts
var PROFILE_ENV_KEYS = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CONFIG_DIR", "OPENCODE_CONFIG_DIR"];
var MAX_SESSION_FILES = 400;
var AccountsAdapter = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  homes = /* @__PURE__ */ new Map();
  sessionAccount = /* @__PURE__ */ new Map();
  /** Session files also carry the agent CLI's pid and busy/idle status: live evidence. */
  sessionProcess = /* @__PURE__ */ new Map();
  terminalAccount = /* @__PURE__ */ new Map();
  /** Profile homes of Codex accounts (each may keep its own sessions/). */
  codexHomes() {
    return [...this.homes.entries()].filter(([, v]) => v.provider === "codex").map(([home]) => home);
  }
  /** Profile homes of Claude accounts (each has its own projects/ and sessions/). */
  claudeHomes() {
    return [...this.homes.entries()].filter(([, v]) => v.provider === "claude").map(([home]) => home);
  }
  async refresh() {
    await this.loadAccounts();
    this.sessionProcess.clear();
    await this.scanSessionFiles();
    this.applyToAgents();
    await this.applyLiveness();
  }
  /**
   * Live evidence for agents Orca's events have not reported since a restart: the agent CLI's
   * session file names its pid; if that process is running, the agent is live. Never overrides a
   * newer status event (the store orders state by observation time).
   */
  async applyLiveness() {
    for (const agent of Object.values(this.ctx.store.read().agents)) {
      if (!agent.sessionId || agent.role === "subagent") continue;
      const proc = this.sessionProcess.get(agent.sessionId);
      if (!proc) continue;
      const alive = await processAlive(proc.pid, proc.procStart);
      if (agent.live === alive && agent.state !== "unknown") continue;
      const state = !alive ? agent.state === "unknown" || agent.live ? "done" : agent.state : proc.status === "busy" ? "working" : "waiting";
      this.ctx.store.upsertAgent(agent.id, proc.updatedAt ?? 0, { live: alive, state, evidence: ["session-file"] }, () => agent);
    }
  }
  async loadAccounts() {
    const result = await this.ctx.cli.run(["account", "list"]);
    if (!result.ok) {
      this.ctx.log(`account list: ${result.code} ${result.message}`);
      return;
    }
    const labels = this.ctx.store.read().labels;
    const seen = /* @__PURE__ */ new Set();
    for (const [provider, info] of Object.entries(result.result)) {
      if (!info || !Array.isArray(info.accounts)) continue;
      for (const account of info.accounts) {
        seen.add(account.id);
        const email = str(account.email);
        const record = {
          id: account.id,
          provider,
          email,
          label: labels.accountTeams[account.id] ?? (email ? labels.accountTeams[email] : void 0) ?? null,
          active: info.activeAccountId === account.id
        };
        this.ctx.store.put({ entity: "account", id: account.id, value: record });
        const home = str(account.home);
        if (home) this.homes.set(resolve(home), { accountId: account.id, provider });
      }
    }
    for (const id of Object.keys(this.ctx.store.read().accounts)) if (!seen.has(id)) this.ctx.store.put({ entity: "account", id, value: null });
  }
  async scanSessionFiles() {
    let budget = MAX_SESSION_FILES;
    for (const [home, { accountId }] of this.homes) {
      const dir = join(home, "sessions");
      let names;
      try {
        names = (await readdir(dir)).filter((name) => /^\d+\.json$/.test(name));
      } catch {
        continue;
      }
      for (const name of names) {
        if (budget-- <= 0) return;
        try {
          const parsed = JSON.parse(await readFile(join(dir, name), "utf8"));
          const sessionId = str(parsed.sessionId);
          if (sessionId) {
            this.sessionAccount.set(sessionId, accountId);
            if (typeof parsed.pid === "number") this.sessionProcess.set(sessionId, { pid: parsed.pid, procStart: parsed.procStart == null ? null : String(parsed.procStart), status: str(parsed.status), updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null });
          }
        } catch {
        }
      }
    }
  }
  /** agent.launch.before: record the profile dir only. Returns nothing, so the launch goes on. */
  onLaunch(event) {
    if (!event.terminalId) return;
    for (const key of PROFILE_ENV_KEYS) {
      const value = event.env?.[key];
      if (!value) continue;
      const accountId = this.accountForProfileDir(value);
      if (accountId) {
        this.terminalAccount.set(event.terminalId, accountId);
        return;
      }
    }
  }
  accountForProfileDir(dir) {
    const target = resolve(dir);
    for (const [home, { accountId }] of this.homes) {
      if (target === home || target === dirname(home) || target.startsWith(home + "/")) return accountId;
    }
    return null;
  }
  applyToAgents() {
    const state = this.ctx.store.read();
    for (const agent of Object.values(state.agents)) {
      let ref = null;
      const fromSession = agent.sessionId ? this.sessionAccount.get(agent.sessionId) : void 0;
      const fromLaunch = agent.terminalId ? this.terminalAccount.get(agent.terminalId) : void 0;
      if (fromSession) ref = this.ref(fromSession, "session-file");
      else if (fromLaunch) ref = this.ref(fromLaunch, "launch-capture");
      else if (agent.role === "subagent" && agent.parentId) ref = state.agents[agent.parentId]?.account ?? null;
      if (!ref) continue;
      if (agent.account && agent.account.accountId === ref.accountId && agent.account.label === ref.label) continue;
      this.ctx.store.upsertAgent(agent.id, agent.lastSeenAt, { account: ref, evidence: [ref.source] }, () => agent);
    }
  }
  ref(accountId, source) {
    const account = this.ctx.store.read().accounts[accountId];
    const labels = this.ctx.store.read().labels;
    const label = labels.accountTeams[accountId] ?? (account?.email ? labels.accountTeams[account.email] : void 0) ?? account?.email ?? null;
    return { accountId, label, provider: account?.provider ?? null, source };
  }
};
async function processAlive(pid, procStart) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  if (procStart && process.platform === "linux") {
    try {
      const stat8 = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat8.slice(stat8.lastIndexOf(")") + 2).split(" ");
      return fields[19] === procStart;
    } catch {
      return false;
    }
  }
  return true;
}

// src/worker/state/identity-index.ts
var IdentityIndex = class {
  byKey = /* @__PURE__ */ new Map();
  link(agentId, keys) {
    for (const key of keyList(keys)) {
      const existing = this.byKey.get(key);
      if (existing && existing.startsWith("dispatch:") && !agentId.startsWith("dispatch:")) continue;
      this.byKey.set(key, agentId);
    }
  }
  resolve(keys) {
    for (const key of keyList(keys)) {
      const id = this.byKey.get(key);
      if (id) return id;
    }
    return null;
  }
  unlinkAgent(agentId) {
    for (const [key, id] of this.byKey) if (id === agentId) this.byKey.delete(key);
  }
};
function keyList(keys) {
  const out = [];
  if (keys.paneKey) out.push(`pane:${normalizePaneKey(keys.paneKey)}`);
  if (keys.terminalHandle) out.push(`handle:${keys.terminalHandle}`);
  if (keys.terminalId) out.push(`term:${keys.terminalId}`);
  if (keys.sessionId) out.push(`session:${keys.sessionId}`);
  return out;
}
function normalizePaneKey(paneKey) {
  if (paneKey.startsWith("structured-agent-session-")) return paneKey.split(":")[0];
  return paneKey;
}
function samePaneKey(a, b) {
  return Boolean(a && b && normalizePaneKey(a) === normalizePaneKey(b));
}

// src/worker/state/merge-agents.ts
var CARRY = ["sessionId", "terminalId", "account", "tokens", "messageCount", "agent", "model", "effort", "branch", "worktreePath", "workspaceId"];
function mergeAgentInto(store, identity, targetId, sourceId) {
  if (targetId === sourceId) return;
  const state = store.read();
  const target = state.agents[targetId];
  const source = state.agents[sourceId];
  if (!target || !source) return;
  const patch = { evidence: source.evidence };
  for (const key of CARRY) if (target[key] == null && source[key] != null) patch[key] = source[key];
  if (source.lastSeenAt > target.lastSeenAt) Object.assign(patch, { state: source.state, live: source.live, stateSince: source.stateSince });
  store.upsertAgent(targetId, Math.max(source.lastSeenAt, target.lastSeenAt), patch, () => target);
  for (const agent of Object.values(state.agents)) if (agent.parentId === sourceId) store.upsertAgent(agent.id, agent.lastSeenAt, { parentId: targetId }, () => agent);
  store.removeAgent(sourceId);
  identity.unlinkAgent(sourceId);
  identity.link(targetId, { terminalId: source.terminalId, sessionId: source.sessionId, paneKey: source.paneKey });
}
var rank = (agent) => agent.dispatchId ? 3 : agent.role === "lead" ? 2 : 1;
function dedupeAgent(store, identity, agentId) {
  const agent = store.read().agents[agentId];
  if (!agent || agent.role === "subagent") return agentId;
  let survivor = agent;
  for (const other of Object.values(store.read().agents)) {
    if (other.id === survivor.id || other.role === "subagent") continue;
    if (other.dispatchId && survivor.dispatchId) continue;
    const same = other.terminalId && other.terminalId === survivor.terminalId || other.sessionId && other.sessionId === survivor.sessionId || samePaneKey(other.paneKey, survivor.paneKey);
    if (!same) continue;
    const keepOther = rank(other) > rank(survivor) || rank(other) === rank(survivor) && other.lastSeenAt > survivor.lastSeenAt;
    const [target, source] = keepOther ? [other, survivor] : [survivor, other];
    mergeAgentInto(store, identity, target.id, source.id);
    survivor = store.read().agents[target.id] ?? target;
  }
  return survivor.id;
}
function mergeDuplicatesOf(store, identity, dispatchAgentId) {
  const target = store.read().agents[dispatchAgentId];
  if (!target?.paneKey) return;
  for (const agent of Object.values(store.read().agents)) {
    if (agent.id === dispatchAgentId || agent.dispatchId || agent.role === "lead" || agent.role === "subagent") continue;
    if (samePaneKey(agent.paneKey, target.paneKey)) mergeAgentInto(store, identity, dispatchAgentId, agent.id);
  }
}

// src/worker/adapters/agents-adapter.ts
var MAX_WORKSPACES_PER_SCAN = 40;
var AgentsAdapter = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  workspaceByPath = /* @__PURE__ */ new Map();
  scanning = false;
  worktreeForPath(path) {
    return path ? this.workspaceByPath.get(path) ?? null : null;
  }
  /** Full re-scan: every workspace and the agents in the active ones. */
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const { host } = this.ctx.orca;
      if (!host.has("workspace.list")) return;
      const listed = await host.call("workspace.list", { includeStatus: true });
      const seen = /* @__PURE__ */ new Set();
      for (const row of listed.workspaces) {
        const record = {
          id: row.id,
          name: row.name,
          path: row.path,
          branch: row.branch,
          project: row.project ?? null,
          projectId: row.projectId ?? null,
          hostId: row.hostId,
          kind: row.kind,
          status: row.status?.state ?? null,
          terminalCount: row.status?.terminalCount ?? null,
          lastActivityAt: row.status?.lastActivityAt ?? null,
          version: 0
        };
        seen.add(row.id);
        this.workspaceByPath.set(row.path, record);
        const previous = this.ctx.store.read().worktrees[row.id];
        this.ctx.store.put({ entity: "worktree", id: row.id, value: { ...record, version: (previous?.version ?? 0) + 1 } });
        if (!previous) {
          this.ctx.store.emit({ ts: this.ctx.now(), kind: "worktree.created", source: "host-call", entityId: row.id, summary: `Worktree ${row.name} (${row.branch ?? "no branch"})` });
        }
      }
      for (const id of Object.keys(this.ctx.store.read().worktrees)) {
        if (!seen.has(id) && !listed.truncated) this.ctx.store.put({ entity: "worktree", id, value: null });
      }
      await this.scanProjects();
      await this.scanAgents(listed.workspaces);
    } catch (error) {
      this.ctx.log(`agents scan failed: ${error.message}`);
    } finally {
      this.scanning = false;
    }
  }
  /** Orca's projects (name + root path) for grouping agents into project boxes. */
  async scanProjects() {
    const { host } = this.ctx.orca;
    if (!host.has("project.list")) return;
    try {
      const { projects, truncated } = await host.call("project.list", {});
      const seen = /* @__PURE__ */ new Set();
      for (const p of projects) {
        seen.add(p.id);
        this.ctx.store.put({ entity: "project", id: p.id, value: { id: p.id, name: p.name, path: p.path, kind: p.kind, hostId: p.hostId, hidden: p.hidden === true } });
      }
      if (!truncated) {
        for (const id of Object.keys(this.ctx.store.read().projects ?? {})) if (!seen.has(id)) this.ctx.store.put({ entity: "project", id, value: null });
      }
    } catch (error) {
      this.ctx.log(`project.list failed: ${error.message}`);
    }
  }
  async scanAgents(workspaces) {
    const { host } = this.ctx.orca;
    if (!host.has("agents.list")) return;
    const perWorkspace = (this.ctx.orca.api?.minor ?? 0) >= 10;
    const targets = perWorkspace ? workspaces.filter((w) => (w.status?.terminalCount ?? 0) > 0 || w.status && w.status.state !== "inactive").slice(0, MAX_WORKSPACES_PER_SCAN) : [];
    const calls = perWorkspace ? targets.map((w) => ({ workspace: w })) : [{ workspace: null }];
    for (const { workspace } of calls) {
      try {
        const result = await host.call("agents.list", workspace ? { workspaceId: workspace.id } : {});
        for (const row of result.agents) this.applyRow(row, workspace);
      } catch (error) {
        this.ctx.log(`agents.list failed for ${workspace?.id ?? "focused workspace"}: ${error.message}`);
      }
    }
  }
  applyRow(row, workspace) {
    const now = this.ctx.now();
    const existingId = this.ctx.identity.resolve({ terminalId: row.terminalId, sessionId: row.sessionId ?? null });
    const id = existingId ?? (row.terminalId ? `term:${row.terminalId}` : row.sessionId ? `session:${row.sessionId}` : null);
    if (!id) return;
    const previous = this.ctx.store.read().agents[id];
    const state = mapState(row.state);
    this.ctx.store.upsertAgent(
      id,
      row.stateStartedAt || now,
      {
        agent: row.agent ?? void 0,
        title: row.title ?? void 0,
        terminalId: row.terminalId ?? void 0,
        sessionId: row.sessionId ?? void 0,
        workspaceId: workspace?.id,
        worktreePath: workspace?.path,
        branch: workspace?.branch ?? void 0,
        description: row.task?.title ?? void 0,
        state,
        stateSince: row.stateStartedAt || void 0,
        live: state !== "done",
        startedAt: previous?.startedAt ?? row.stateStartedAt ?? now,
        evidence: ["host-call"]
      },
      () => newAgent(id, "agent", now)
    );
    this.ctx.identity.link(id, { terminalId: row.terminalId, sessionId: row.sessionId ?? null });
    dedupeAgent(this.ctx.store, this.ctx.identity, id);
    if (!previous) this.ctx.store.emit({ ts: now, kind: "agent.created", source: "host-call", entityId: id, summary: `${row.agent ?? "Agent"} ${row.title ?? ""} found (${row.state})`.trim() });
  }
  /** agent.status.changed: the most precise live signal Orca gives. */
  onStatus(event) {
    const now = this.ctx.now();
    const keys = { paneKey: event.paneKey, terminalId: event.terminalId ?? null, sessionId: event.sessionId ?? null };
    const id = this.ctx.identity.resolve(keys) ?? (event.terminalId ? `term:${event.terminalId}` : `pane:${event.paneKey}`);
    const previous = this.ctx.store.read().agents[id];
    const main = event.mainAgent;
    const state = mapState(main?.state ?? event.state, main?.outcome);
    const workspace = event.workspaceListId ? this.ctx.store.read().worktrees[event.workspaceListId] : void 0;
    const record = this.ctx.store.upsertAgent(
      id,
      event.receivedAt || now,
      {
        paneKey: event.paneKey,
        terminalId: event.terminalId,
        sessionId: event.sessionId,
        title: event.title,
        workspaceId: event.workspaceListId ?? event.workspaceId ?? void 0,
        worktreePath: workspace?.path,
        branch: workspace?.branch ?? void 0,
        state,
        outcome: main?.outcome ?? void 0,
        stateSince: main?.stateStartedAt ?? event.receivedAt,
        live: state === "working" || state === "blocked" || state === "waiting",
        startedAt: previous?.startedAt ?? event.receivedAt ?? now,
        endedAt: state === "done" || state === "failed" ? event.receivedAt : null,
        evidence: ["host-event"]
      },
      () => newAgent(id, "agent", now)
    );
    this.ctx.identity.link(id, keys);
    dedupeAgent(this.ctx.store, this.ctx.identity, id);
    if (!previous || previous.state !== record.state) {
      const kind = !previous ? "agent.started" : state === "failed" ? "agent.failed" : state === "done" ? "agent.completed" : "agent.status_changed";
      this.ctx.store.emit({
        ts: event.receivedAt || now,
        kind,
        source: "host-event",
        entityId: id,
        runId: record.runId,
        summary: `${record.title ?? record.agent ?? "Agent"}: ${previous?.state ?? "new"} \u2192 ${state}${main?.outcome ? ` (${main.outcome})` : ""}`
      });
    }
  }
};
function mapState(state, outcome) {
  if (state === "done" && outcome && (outcome === "failure" || outcome === "interruption")) return "failed";
  return state;
}

// src/shared/redact.ts
var REDACTED = "[redacted]";
var PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
  // Bearer before the key=value rules: they would otherwise eat the word "Bearer".
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g, "$1[redacted]"],
  [/\b(sk-ant-[A-Za-z0-9_-]{10,})/g, "[redacted-key]"],
  [/\b(sk-[A-Za-z0-9_-]{20,})/g, "[redacted-key]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, "[redacted-token]"],
  [/\b(github_pat_[A-Za-z0-9_]{20,})/g, "[redacted-token]"],
  [/\b(xox[abprs]-[A-Za-z0-9-]{10,})/g, "[redacted-token]"],
  [/\b(AKIA[0-9A-Z]{16})\b/g, "[redacted-aws-key]"],
  [/\b(AIza[0-9A-Za-z_-]{30,})/g, "[redacted-key]"],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "[redacted-jwt]"],
  // URL credentials: keep the user name, hide the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@?#]+:)[^\s@/?#]+@/gi, `$1${REDACTED}@`]
];
var STRONG_SEGMENTS = /* @__PURE__ */ new Set(["password", "passwd", "passphrase", "secret", "credential", "credentials", "authorization", "apikey", "privatekey"]);
var KEY_PREFIXES = /* @__PURE__ */ new Set(["api", "access", "private", "secret", "auth", "signing", "encryption", "master", "client", "license", "session"]);
function segments(key) {
  return key.split(/[_.-]+/).flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")).filter(Boolean).map((seg) => seg.toLowerCase());
}
function isSensitiveKey(key) {
  const segs = segments(key);
  if (segs.length === 0) return false;
  if (segs.some((seg) => STRONG_SEGMENTS.has(seg))) return true;
  const upper = /[A-Z]/.test(key) && key === key.toUpperCase();
  const last = segs[segs.length - 1];
  if (last === "token") return true;
  if (last === "key") return upper || segs.length > 1 && KEY_PREFIXES.has(segs[segs.length - 2]);
  if (last === "pass") return upper;
  return false;
}
function alreadyRedacted(value) {
  return value.startsWith("[redacted");
}
var KEY = String.raw`[A-Za-z][A-Za-z0-9_.-]*`;
var DQ = String.raw`"((?:\\.|[^"\\\n])*)"`;
var SQ = String.raw`'((?:\\.|[^'\\\n])*)'`;
function replaceEach(text, pattern, handler) {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let out = "";
  let copied = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const replacement = handler(m.slice(1));
    if (replacement === null) {
      re.lastIndex = m.index + 1;
      continue;
    }
    out += text.slice(copied, m.index) + replacement;
    copied = m.index + m[0].length;
    re.lastIndex = copied;
  }
  return out + text.slice(copied);
}
var QUOTED_KEY = new RegExp(String.raw`(["'])(${KEY})\1(\s*:\s*)(?:${DQ}|${SQ})`, "g");
function redactQuotedKeys(text) {
  return replaceEach(text, QUOTED_KEY, ([q, key, sep2, dq, sq]) => {
    const value = dq ?? sq ?? "";
    if (!value || alreadyRedacted(value) || !isSensitiveKey(key)) return null;
    const vq = dq !== void 0 ? '"' : "'";
    return `${q}${key}${q}${sep2}${vq}${REDACTED}${vq}`;
  });
}
var CLI_FLAG = new RegExp(String.raw`(?<![\w-])(--(${KEY}))(=|[ \t]+)(?:${DQ}|${SQ}|([^\s"'-][^\s"']*))`, "g");
function redactCliFlags(text) {
  return replaceEach(text, CLI_FLAG, ([flag2, name, sep2, dq, sq, bare]) => {
    const value = dq ?? sq ?? bare ?? "";
    if (!value || alreadyRedacted(value) || !isSensitiveKey(name)) return null;
    return `${flag2}${sep2}${REDACTED}`;
  });
}
var ASSIGNMENT = new RegExp(String.raw`(?<![\w.-])(${KEY})(\s*[:=]\s*)(?:${DQ}|${SQ}|([^\s"'&]+))`, "g");
var MIN_BARE_VALUE = 6;
function redactAssignments(text) {
  return replaceEach(text, ASSIGNMENT, ([key, sep2, dq, sq, bare]) => {
    if (!isSensitiveKey(key)) return null;
    if (bare !== void 0) {
      if (bare.length < MIN_BARE_VALUE || alreadyRedacted(bare) || /^(Bearer|Basic)$/i.test(bare)) return null;
    } else {
      const value = dq ?? sq ?? "";
      if (!value || alreadyRedacted(value)) return null;
    }
    return `${key}${sep2}${REDACTED}`;
  });
}
function redact(text) {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  out = redactQuotedKeys(out);
  out = redactCliFlags(out);
  out = redactAssignments(out);
  return out;
}
function redactNullable(text) {
  return text == null ? null : redact(text);
}
function redactAndTruncate(text, max) {
  return truncate(redact(text), max);
}
function stripAnsi(text) {
  return text.replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b[@-Z\\-_78=>]/g, "");
}
function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1) + "\u2026";
}

// src/shared/task-states.ts
var TERMINAL_TASK_STATES = ["DONE", "MERGED", "CANCELLED", "FAILED"];
function mapOrcaTaskStatus(input) {
  const status = input.orcaStatus.toLowerCase();
  if (input.hasOpenGate && status !== "completed" && status !== "failed") return "BLOCKED";
  switch (status) {
    case "pending":
      return "PENDING";
    case "ready":
      return input.retryCount > 0 ? "RETRYING" : "READY";
    case "dispatched":
      if (!input.dispatchActive && input.retryCount > 0) return "RETRYING";
      if (input.kind === "review") return "REVIEW";
      if (input.kind === "test") return "TESTING";
      return "RUNNING";
    case "completed": {
      const outcome = (input.resultOutcome ?? "").toLowerCase();
      if (outcome === "cancelled" || outcome === "cancellation") return "CANCELLED";
      if (outcome === "failed" || outcome === "failure") return "FAILED";
      if (input.kind === "merge") return "MERGED";
      return "DONE";
    }
    case "failed": {
      const outcome = (input.resultOutcome ?? "").toLowerCase();
      return outcome.includes("cancel") ? "CANCELLED" : "FAILED";
    }
    case "blocked":
      return "BLOCKED";
    default:
      return "PENDING";
  }
}
var KIND_PATTERNS = [
  ["merge", /\b(merge|integrat(e|ion)|deliver)\b/i],
  // "test" alone is too common in titles ("AF test: …"); require a testing phrase.
  ["test", /\b(tests|testing|qa|e2e|verify|verification|validation)\b|\b(run|write|add|fix|unit|integration|smoke)\s+tests?\b/i],
  ["review", /\b(review|audit|inspect|approve)\b/i],
  ["plan", /\b(plan|planning|design|architecture|analy[sz]e)\b/i]
];
function inferTaskKind(title) {
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(title)) return kind;
  return "task";
}

// src/worker/adapters/orchestration-adapter.ts
var STOPPED_STATES = /* @__PURE__ */ new Set(["stopped", "abandoned", "fenced", "cancelled"]);
var MAX_RUNS = 25;
var MAX_DETAIL_PER_CYCLE = 10;
var MAX_WORKER_PAGES = 3;
var SPEC_PREVIEW = 600;
var RESULT_PREVIEW = 600;
var SPEC_LIMIT = 6e4;
var BODY_PREVIEW = 600;
var FULL_TEXT_LIMIT = 1e3;
var OrchestrationAdapter = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  cycle = 0;
  polling = false;
  /** dispatchId → last worker-show fingerprint; settled ones are not re-fetched. */
  detailed = /* @__PURE__ */ new Map();
  dispatchRows = /* @__PURE__ */ new Map();
  /** Full task specs and message bodies, kept out of the shared state. */
  fullText = /* @__PURE__ */ new Map();
  runDetailCheckedAt = /* @__PURE__ */ new Map();
  /** Full spec / body for the inspector; null when not known. */
  fullTextFor(key) {
    return this.fullText.get(key) ?? null;
  }
  keepFull(key, text, preview) {
    this.fullText.set(key, text);
    if (this.fullText.size > FULL_TEXT_LIMIT) {
      const oldest = this.fullText.keys().next().value;
      if (oldest !== void 0) this.fullText.delete(oldest);
    }
    return truncate(text, preview);
  }
  get hasActiveWork() {
    const state = this.ctx.store.read();
    return Object.values(state.runs).some((run) => run.state === "active" && Object.values(state.agents).some((a) => a.runId === run.id && a.live));
  }
  async poll() {
    if (this.polling || !this.ctx.cli.path) return;
    this.polling = true;
    this.cycle++;
    try {
      const runs = await this.pollRuns();
      if (!runs) return;
      for (const run of runs) {
        const full = run.state === "active" || this.cycle % 6 === 1;
        if (full) await this.pollTasks(run.id);
        const lastCheck = this.runDetailCheckedAt.get(run.id);
        if (!run.coordinatorHandle && (lastCheck === void 0 || this.cycle - lastCheck >= 60)) {
          this.runDetailCheckedAt.set(run.id, this.cycle);
          await this.pollRunDetail(run.id);
        }
      }
      await this.pollWorkers();
      await this.pollMessages();
      this.refreshRunStates();
      const active = Object.values(this.ctx.store.read().runs).filter((run) => run.state === "active");
      for (const run of active) await this.pollGates(run.id);
      if (active.length) this.refreshRunStates();
    } catch (error) {
      this.ctx.log(`orchestration poll failed: ${error.message}`);
    } finally {
      this.polling = false;
    }
  }
  async pollRuns() {
    const result = await this.ctx.cli.run(["orchestration", "run-list"]);
    if (!result.ok) {
      this.ctx.log(`run-list: ${result.code} ${result.message}`);
      return null;
    }
    const out = [];
    for (const raw of result.result.runs.filter((run) => !run.legacy).slice(0, MAX_RUNS)) {
      const previous = this.ctx.store.read().runs[raw.id];
      const record = previous ? { ...previous, objective: raw.objective ?? previous.objective } : { id: raw.id, objective: raw.objective ?? raw.id, legacy: false, coordinatorHandle: null, state: "idle", startedAt: null, endedAt: null, taskCount: 0, version: 0 };
      this.ctx.store.put({ entity: "run", id: raw.id, value: record });
      this.ensureLead(record);
      if (!previous) this.ctx.store.emit({ id: `run:${raw.id}`, ts: this.ctx.now(), kind: "orchestration.started", source: "cli-poll", entityId: raw.id, runId: raw.id, summary: `Run: ${truncate(record.objective, 120)}` });
      out.push(this.ctx.store.read().runs[raw.id]);
    }
    return out;
  }
  /** run-show --full names the coordinator's terminal handle (null for chat coordinators) and creation time. */
  async pollRunDetail(runId) {
    const result = await this.ctx.cli.run(["orchestration", "run-show", "--id", runId, "--full"]);
    if (!result.ok || !result.result.run) return;
    const raw = result.result.run;
    const run = this.ctx.store.read().runs[runId];
    if (!run) return;
    const coordinatorHandle = str(raw.coordinator_handle) ?? run.coordinatorHandle;
    const startedAt = run.startedAt ?? parseTime(raw.created_at);
    if (coordinatorHandle === run.coordinatorHandle && startedAt === run.startedAt) return;
    const next = { ...run, coordinatorHandle, startedAt };
    this.ctx.store.put({ entity: "run", id: runId, value: next });
    this.ensureLead(next);
  }
  /** The coordinator of a run. Structural (every run has one); live only with runtime evidence. */
  ensureLead(run) {
    const id = `lead:${run.id}`;
    const now = this.ctx.now();
    this.ctx.store.upsertAgent(
      id,
      0,
      { role: "lead", runId: run.id, title: "Lead orchestrator", description: truncate(run.objective, 200), terminalHandle: run.coordinatorHandle ?? void 0, evidence: ["cli-poll"] },
      () => newAgent(id, "lead", now)
    );
    if (run.coordinatorHandle) this.ctx.identity.link(id, { terminalHandle: run.coordinatorHandle });
  }
  async pollTasks(runId) {
    const result = await this.ctx.cli.run(["orchestration", "task-list", "--run", runId, "--full"]);
    if (!result.ok) {
      this.ctx.log(`task-list ${runId}: ${result.code} ${result.message}`);
      return;
    }
    let coordinator = null;
    for (const raw of result.result.tasks) {
      coordinator ??= str(raw.created_by_terminal_handle);
      this.applyTask(runId, raw);
    }
    const run = this.ctx.store.read().runs[runId];
    if (run) {
      const tasks = result.result.tasks;
      const times = tasks.map((task) => parseTime(task.created_at)).filter((t) => t !== null);
      this.ctx.store.put({
        entity: "run",
        id: runId,
        value: { ...run, taskCount: tasks.length, coordinatorHandle: run.coordinatorHandle ?? coordinator, startedAt: times.length ? Math.min(...times) : run.startedAt }
      });
      if (coordinator && !run.coordinatorHandle) this.ensureLead({ ...run, coordinatorHandle: coordinator });
    }
  }
  applyTask(runId, raw) {
    const state = this.ctx.store.read();
    const previous = state.tasks[raw.id];
    const title = str(raw.task_title) ?? str(raw.display_name) ?? raw.id;
    const kind = inferTaskKind(`${title} ${str(raw.display_name) ?? ""}`);
    const parsedResult = parseResult(raw.result);
    const result = parsedResult?.message ? { ...parsedResult, message: this.keepFull(`result:${raw.id}`, parsedResult.message, RESULT_PREVIEW) } : parsedResult;
    const dispatchIds = previous?.dispatchIds ?? [];
    const latestDispatch = dispatchIds.length ? this.dispatchRows.get(dispatchIds[dispatchIds.length - 1]) : void 0;
    const gateIds = Object.values(state.gates).filter((gate) => gate.taskId === raw.id).map((gate) => gate.id);
    const hasOpenGate = gateIds.some((id) => state.gates[id]?.status === "pending");
    const taskState = mapOrcaTaskStatus({
      orcaStatus: str(raw.status) ?? "pending",
      kind,
      resultOutcome: result?.outcome ?? null,
      hasOpenGate,
      retryCount: Math.max(0, dispatchIds.length - 1),
      dispatchActive: latestDispatch ? isLiveWorker(latestDispatch) : false
    });
    const record = {
      id: raw.id,
      runId,
      parentId: str(raw.parent_id),
      title: redact(title),
      displayName: redactNullable(str(raw.display_name)),
      spec: raw.spec ? this.keepFull(`task:${raw.id}`, redact(truncate(String(raw.spec), SPEC_LIMIT)), SPEC_PREVIEW) : null,
      kind,
      orcaStatus: str(raw.status) ?? "pending",
      state: taskState,
      deps: parseDeps(raw.deps),
      assigneeAgentId: previous?.assigneeAgentId ?? null,
      dispatchIds,
      result,
      createdAt: parseTime(raw.created_at),
      completedAt: parseTime(raw.completed_at),
      retryCount: Math.max(0, dispatchIds.length - 1),
      gateIds,
      version: previous?.version ?? 0
    };
    this.ctx.store.upsertTask(record);
    if (!previous) {
      this.ctx.store.emit({ id: `task.created:${raw.id}`, ts: record.createdAt ?? this.ctx.now(), kind: "task.created", source: "cli-poll", entityId: raw.id, runId, summary: `Task created: ${truncate(record.title, 100)}` });
    } else if (previous.state !== record.state) {
      this.ctx.store.emit({ ts: this.ctx.now(), kind: taskEventKind(record.state, record.kind), source: "cli-poll", entityId: raw.id, runId, targetId: record.assigneeAgentId, summary: `${truncate(record.title, 80)}: ${previous.state} \u2192 ${record.state}` });
    }
  }
  async pollWorkers() {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < MAX_WORKER_PAGES; page++) {
      const args = ["orchestration", "worker-list"];
      if (cursor) args.push("--cursor", cursor);
      const result = await this.ctx.cli.run(args);
      if (!result.ok) {
        this.ctx.log(`worker-list: ${result.code} ${result.message}`);
        break;
      }
      rows.push(...result.result.workers);
      cursor = result.result.nextCursor ?? null;
      if (!cursor) break;
    }
    const tasks = this.ctx.store.read().tasks;
    let detailBudget = MAX_DETAIL_PER_CYCLE;
    const known = rows.filter((row) => tasks[row.taskId]);
    for (const row of known) {
      this.dispatchRows.set(row.dispatchId, row);
      this.applyWorkerRow(row);
    }
    const priority = (row) => isLiveWorker(row) ? 0 : mapWorkerState(row) === "failed" ? 1 : 2;
    for (const row of [...known].sort((a, b) => priority(a) - priority(b))) {
      if (detailBudget <= 0) break;
      const fingerprint = `${row.state}|${row.liveness ?? ""}|${row.terminal ?? ""}`;
      if (this.detailed.get(row.dispatchId) === fingerprint && !isLiveWorker(row)) continue;
      detailBudget--;
      await this.pollWorkerDetail(row.dispatchId);
      this.detailed.set(row.dispatchId, fingerprint);
    }
  }
  applyWorkerRow(row) {
    const id = `dispatch:${row.dispatchId}`;
    const now = this.ctx.now();
    const task = this.ctx.store.read().tasks[row.taskId];
    const previous = this.ctx.store.read().agents[id];
    const [projectId, worktreePath] = splitWorkspace(row.workspace);
    const polled = mapWorkerState(row);
    const hostDriven = previous?.evidence.includes("host-event") && polled !== "done" && polled !== "failed";
    const state = hostDriven ? previous.state : polled;
    const record = this.ctx.store.upsertAgent(
      id,
      now,
      {
        role: "worker",
        dispatchId: row.dispatchId,
        taskId: row.taskId,
        runId: task?.runId ?? void 0,
        parentId: previous?.parentId ?? (task ? `lead:${task.runId}` : null),
        terminalHandle: row.terminal ?? void 0,
        workspaceId: row.workspace ?? void 0,
        worktreePath: worktreePath ?? void 0,
        projectId: projectId ?? void 0,
        branch: Object.values(this.ctx.store.read().worktrees).find((w) => w.path === worktreePath)?.branch ?? void 0,
        title: previous?.title ?? task?.displayName ?? task?.title ?? "Worker",
        state,
        live: hostDriven ? previous.live : isLiveWorker(row),
        // A stopped/abandoned worker ended by request, not by finishing its task.
        outcome: STOPPED_STATES.has(row.state.toLowerCase()) ? "cancellation" : void 0,
        evidence: ["cli-poll"]
      },
      () => newAgent(id, "worker", now)
    );
    this.ctx.identity.link(id, { terminalHandle: row.terminal ?? null });
    if (task && !task.dispatchIds.includes(row.dispatchId)) {
      const dispatchIds = [...task.dispatchIds, row.dispatchId];
      this.ctx.store.upsertTask({ ...task, dispatchIds, assigneeAgentId: id, retryCount: Math.max(0, dispatchIds.length - 1) });
      this.ctx.store.emit({ id: `task.assigned:${row.dispatchId}`, ts: now, kind: dispatchIds.length > 1 ? "task.retried" : "task.assigned", source: "cli-poll", entityId: row.taskId, targetId: id, runId: task.runId, summary: `${truncate(task.title, 80)} \u2192 ${record.title}` });
    }
    if (previous && previous.state !== record.state) {
      this.ctx.store.emit({ ts: now, kind: state === "failed" ? "agent.failed" : state === "done" ? "agent.completed" : "agent.status_changed", source: "cli-poll", entityId: id, runId: record.runId, summary: `${record.title}: ${previous.state} \u2192 ${state}` });
    }
  }
  async pollWorkerDetail(dispatchId) {
    const result = await this.ctx.cli.run(["orchestration", "worker-show", "--dispatch", dispatchId, "--full"]);
    if (!result.ok) return;
    const detail = result.result;
    const dispatch = asRecord(detail.dispatch);
    const worker = asRecord(detail.worker);
    const start = asRecord(worker.startOptions);
    const launch = asRecord(asRecord(start.launch).effective);
    const requested = asRecord(asRecord(start.launch).requested);
    const id = `dispatch:${dispatchId}`;
    const creator = str(dispatch.creatorDispatchId);
    const task = this.ctx.store.read().tasks[str(dispatch.taskId) ?? ""];
    const record = this.ctx.store.upsertAgent(
      id,
      this.ctx.now(),
      {
        agent: str(launch.agent) ?? str(start.agent) ?? void 0,
        model: str(launch.model) ?? str(requested.model) ?? void 0,
        effort: str(launch.effort) ?? str(requested.effort) ?? void 0,
        paneKey: str(dispatch.assigneePaneKey) ?? void 0,
        terminalHandle: str(dispatch.assigneeHandle) ?? void 0,
        parentId: creator ? `dispatch:${creator}` : task ? `lead:${task.runId}` : void 0,
        retryOfDispatchId: str(dispatch.retryOfDispatchId),
        failureCount: typeof dispatch.failureCount === "number" ? dispatch.failureCount : 0,
        startedAt: parseTime(dispatch.dispatchedAt) ?? void 0,
        endedAt: parseTime(dispatch.completedAt),
        outcome: str(asRecord(detail.projection).outcome) ?? void 0,
        evidence: ["cli-poll"]
      },
      () => newAgent(id, "worker", this.ctx.now())
    );
    this.ctx.identity.link(id, { paneKey: record.paneKey, terminalHandle: record.terminalHandle });
    mergeDuplicatesOf(this.ctx.store, this.ctx.identity, id);
    dedupeAgent(this.ctx.store, this.ctx.identity, id);
    this.orderDispatches(record.taskId);
    if (str(dispatch.retryOfDispatchId)) {
      this.ctx.store.emit({ id: `retry:${dispatchId}`, ts: record.startedAt ?? this.ctx.now(), kind: "task.retried", source: "cli-poll", entityId: record.taskId ?? id, targetId: id, runId: record.runId, summary: `Retry of ${str(dispatch.retryOfDispatchId)} started` });
    }
  }
  /** Keeps a task's attempts in start order once start times are known; the last is the latest. */
  orderDispatches(taskId) {
    const task = taskId ? this.ctx.store.read().tasks[taskId] : void 0;
    if (!task || task.dispatchIds.length < 2) return;
    const agents = this.ctx.store.read().agents;
    const info = (id) => agents[`dispatch:${id}`];
    if (task.dispatchIds.some((id) => info(id)?.startedAt == null)) return;
    const sorted = [...task.dispatchIds].sort((a, b) => {
      if (info(b)?.retryOfDispatchId === a) return -1;
      if (info(a)?.retryOfDispatchId === b) return 1;
      return info(a).startedAt - info(b).startedAt;
    });
    if (sorted.join() === task.dispatchIds.join()) return;
    this.ctx.store.upsertTask({ ...task, dispatchIds: sorted, assigneeAgentId: `dispatch:${sorted[sorted.length - 1]}` });
  }
  async pollMessages() {
    const result = await this.ctx.cli.run(["orchestration", "inbox", "--limit", "150", "--full"]);
    if (!result.ok) return;
    const known = new Set(this.ctx.store.read().messages.map((message) => message.id));
    for (const raw of [...result.result.messages].reverse()) {
      if (known.has(raw.id)) continue;
      const payload = parseJson(raw.payload);
      const fromHandle = str(raw.from_handle);
      const toHandle = str(raw.to_handle);
      const fromAgentId = this.ctx.identity.resolve({ terminalHandle: fromHandle, paneKey: str(raw.sender_pane_key) }) ?? leadFor(fromHandle);
      const toAgentId = this.ctx.identity.resolve({ terminalHandle: toHandle }) ?? leadFor(toHandle);
      const message = {
        id: raw.id,
        runId: str(raw.run_id),
        fromHandle,
        toHandle,
        fromAgentId,
        toAgentId,
        type: str(raw.type) ?? "message",
        subject: redactNullable(str(raw.subject)),
        body: raw.body ? this.keepFull(`message:${raw.id}`, redact(truncate(String(raw.body), SPEC_LIMIT)), BODY_PREVIEW) : null,
        taskId: str(payload.taskId),
        createdAt: parseTime(raw.created_at) ?? this.ctx.now()
      };
      this.ctx.store.put({ entity: "message", id: raw.id, value: message });
      this.ctx.store.emit({
        id: `message:${raw.id}`,
        ts: message.createdAt,
        kind: "message.sent",
        source: "cli-poll",
        entityId: fromAgentId ?? fromHandle ?? "unknown",
        targetId: toAgentId,
        runId: message.runId,
        summary: `${message.type}: ${truncate(message.subject ?? message.body ?? "", 120)}`
      });
    }
  }
  async pollGates(runId) {
    const result = await this.ctx.cli.run(["orchestration", "gate-list", "--run", runId, "--full"]);
    if (!result.ok) return;
    for (const raw of result.result.gates ?? []) {
      const id = str(raw.id);
      if (!id) continue;
      const gate = {
        id,
        taskId: str(raw.task_id) ?? str(raw.taskId),
        question: redactNullable(str(raw.question) ?? str(raw.prompt)),
        status: str(raw.status) ?? "pending",
        resolution: redactNullable(str(raw.resolution)),
        createdAt: parseTime(raw.created_at ?? raw.createdAt)
      };
      const previous = this.ctx.store.read().gates[id];
      this.ctx.store.put({ entity: "gate", id, value: gate });
      if (!previous && gate.status === "pending" && gate.taskId) {
        this.ctx.store.emit({ id: `gate:${id}`, ts: gate.createdAt ?? this.ctx.now(), kind: "task.blocked", source: "cli-poll", entityId: gate.taskId, runId, summary: `Decision gate: ${truncate(gate.question ?? id, 100)}` });
      }
    }
  }
  refreshRunStates() {
    const state = this.ctx.store.read();
    for (const run of Object.values(state.runs)) {
      const tasks = Object.values(state.tasks).filter((task) => task.runId === run.id);
      if (!tasks.length) continue;
      const allDone = tasks.every((task) => TERMINAL_TASK_STATES.includes(task.state));
      const anyFailed = tasks.some((task) => task.state === "FAILED");
      const next = allDone ? anyFailed ? "failed" : "completed" : "active";
      const endedAt = allDone ? Math.max(...tasks.map((task) => task.completedAt ?? 0)) || null : null;
      if (next !== run.state || endedAt !== run.endedAt) {
        this.ctx.store.put({ entity: "run", id: run.id, value: { ...run, state: next, endedAt } });
        if (allDone && run.state === "active") {
          this.ctx.store.emit({ id: `run.done:${run.id}`, ts: endedAt ?? this.ctx.now(), kind: "orchestration.completed", source: "cli-poll", entityId: run.id, runId: run.id, summary: `Run ${next}: ${truncate(run.objective, 100)}` });
        }
      }
    }
  }
};
function mapWorkerState(row) {
  const state = row.state.toLowerCase();
  if (state === "succeeded" || state === "completed" || state === "settled") return "done";
  if (state === "failed" || state === "outcome_unknown") return "failed";
  if (state === "stopped" || state === "abandoned" || state === "fenced" || state === "cancelled") return "done";
  if (state === "blocked" || state === "permission") return "blocked";
  if (state === "ready") return isLiveWorker(row) ? "waiting" : "idle";
  if (state === "starting" || state === "running" || state === "working" || state === "dispatched") return "working";
  return "unknown";
}
function isLiveWorker(row) {
  const liveness = (row.liveness ?? "").toLowerCase();
  if (liveness === "exited" || liveness === "stopped") return false;
  if (liveness === "alive" || liveness === "running" || liveness === "live") return true;
  const state = row.state.toLowerCase();
  return liveness !== "unverifiable" && (state === "starting" || state === "running" || state === "working");
}
function taskEventKind(state, kind) {
  switch (state) {
    case "RUNNING":
      return "task.started";
    case "REVIEW":
      return "review.started";
    case "TESTING":
      return "test.started";
    case "DONE":
    case "MERGED":
    case "APPROVED":
      return kind === "review" ? "review.completed" : kind === "test" ? "test.completed" : "task.completed";
    case "FAILED":
      return "task.failed";
    case "BLOCKED":
      return "task.blocked";
    case "RETRYING":
      return "task.retried";
    default:
      return "task.updated";
  }
}
function parseResult(value) {
  if (value == null || value === "") return null;
  const parsed = parseJson(value);
  if (!Object.keys(parsed).length) {
    const text = String(value).trim();
    const outcome = /^(cancel(l)?ed|cancellation)$/i.test(text) ? "cancelled" : null;
    return { outcome, message: redact(truncate(text, 4e3)), filesModified: [], raw: null };
  }
  const files = Array.isArray(parsed.filesModified) ? parsed.filesModified.filter((f) => typeof f === "string").slice(0, 200) : [];
  return {
    outcome: str(parsed.outcome),
    message: parsed.message ? redact(truncate(String(parsed.message), 4e3)) : null,
    filesModified: files,
    // The raw JSON is never shown; leaving it out keeps snapshots and deltas small.
    raw: null
  };
}
function parseDeps(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
    } catch {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}
function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function splitWorkspace(value) {
  if (!value) return [null, null];
  const index = value.indexOf("::");
  return index >= 0 ? [value.slice(0, index), value.slice(index + 2)] : [null, value];
}
function leadFor(handle) {
  return handle?.startsWith("run:") ? `lead:${handle.slice(4)}` : null;
}

// src/worker/adapters/sessions-adapter.ts
var SessionsAdapter = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async refresh() {
    const { host } = this.ctx.orca;
    if (!host.has("agent.listSessions")) return;
    try {
      const { sessions } = await host.call("agent.listSessions", { limit: 200 });
      const bySession = new Map(sessions.map((session) => [session.sessionId, session]));
      for (const agent of Object.values(this.ctx.store.read().agents)) {
        if (!agent.sessionId) continue;
        const session = bySession.get(agent.sessionId);
        if (!session) continue;
        if (agent.tokens === session.totalTokens && agent.messageCount === session.messageCount) continue;
        this.ctx.store.upsertAgent(
          agent.id,
          agent.lastSeenAt,
          {
            tokens: session.totalTokens,
            messageCount: session.messageCount,
            agent: agent.agent ?? session.agent,
            title: agent.title ?? session.title,
            branch: agent.branch ?? session.branch ?? void 0,
            evidence: ["host-call"]
          },
          () => agent
        );
      }
    } catch (error) {
      this.ctx.log(`agent.listSessions failed: ${error.message}`);
    }
  }
};

// src/worker/adapters/subagent-adapter.ts
var SUBAGENT_TOOLS = /* @__PURE__ */ new Set(["Agent", "Task"]);
var SubagentAdapter = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  fallbackCounter = 0;
  /** Must return fast: Claude Code waits for this hook. Never denies. */
  onToolBefore(event) {
    const now = this.ctx.now();
    const parentId = this.resolveParent(event);
    const callKey = event.callId ?? `${event.terminalId ?? "na"}-${now}-${++this.fallbackCounter}`;
    this.recordToolCall(callKey, event, parentId, "started", now);
    if (!SUBAGENT_TOOLS.has(event.tool)) return;
    const input = asRecord2(event.input);
    const id = `sub:${callKey}`;
    const parent = parentId ? this.ctx.store.read().agents[parentId] : void 0;
    const description = str2(input.description) ?? str2(input.prompt)?.slice(0, 120) ?? null;
    this.ctx.store.upsertAgent(
      id,
      now,
      {
        role: "subagent",
        agent: event.agent,
        parentId,
        callId: event.callId ?? null,
        subagentType: str2(input.subagent_type) ?? "general-purpose",
        description: description ? redact(description) : null,
        title: str2(input.description) ?? str2(input.subagent_type) ?? "Subagent",
        model: str2(input.model),
        workspaceId: event.workspaceId ?? parent?.workspaceId ?? null,
        worktreePath: parent?.worktreePath ?? null,
        branch: parent?.branch ?? null,
        runId: parent?.runId ?? null,
        taskId: parent?.taskId ?? null,
        account: parent?.account ?? null,
        state: "working",
        live: true,
        startedAt: now,
        stateSince: now,
        evidence: ["hook"]
      },
      () => newAgent(id, "subagent", now)
    );
    this.ctx.store.emit({
      ts: now,
      kind: "subagent.spawned",
      source: "hook",
      entityId: id,
      targetId: parentId,
      runId: parent?.runId ?? null,
      summary: `${parent?.title ?? event.agent} spawned subagent: ${truncate(description ?? "subagent", 100)}`
    });
  }
  onToolAfter(event) {
    const now = this.ctx.now();
    const parentId = this.resolveParent(event);
    if (event.callId) this.recordToolCall(event.callId, event, parentId, "finished", now);
    if (!SUBAGENT_TOOLS.has(event.tool) || !event.callId) return;
    const id = `sub:${event.callId}`;
    const existing = this.ctx.store.read().agents[id];
    if (!existing) return;
    const failed = looksFailed(event.output);
    this.ctx.store.upsertAgent(id, now, { state: failed ? "failed" : "done", outcome: failed ? "failure" : "success", live: false, endedAt: now, stateSince: now, evidence: ["hook"] }, () => existing);
    this.ctx.store.emit({
      ts: now,
      kind: "subagent.completed",
      source: "hook",
      entityId: id,
      targetId: existing.parentId,
      runId: existing.runId,
      summary: `Subagent ${existing.title ?? ""} ${failed ? "failed" : "finished"}`.replace(/\s+/g, " ")
    });
  }
  resolveParent(event) {
    const direct = this.ctx.identity.resolve({ terminalId: event.terminalId ?? null });
    if (direct) return direct;
    if (!event.workspaceId) return null;
    const candidates = Object.values(this.ctx.store.read().agents).filter(
      (agent) => agent.role !== "subagent" && agent.live && agent.workspaceId === event.workspaceId && (agent.agent ?? event.agent) === event.agent
    );
    return candidates.length === 1 ? candidates[0].id : null;
  }
  recordToolCall(callKey, event, agentId, phase, now) {
    this.ctx.store.put({
      entity: "toolCall",
      id: callKey,
      value: { id: callKey, agentId, terminalId: event.terminalId ?? null, tool: event.tool, summary: summarizeInput(event.tool, event.input), at: now, phase }
    });
  }
};
function summarizeInput(tool, input) {
  const record = asRecord2(input);
  const pick = str2(record.description) ?? str2(record.command) ?? str2(record.file_path) ?? str2(record.pattern) ?? str2(record.url) ?? str2(record.prompt);
  return redact(truncate(pick ?? tool, 160));
}
function looksFailed(output) {
  const record = asRecord2(output);
  if (record.is_error === true || record.isError === true) return true;
  const status = str2(record.status);
  return status === "error" || status === "failed";
}
function asRecord2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function str2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/worker/adapters/subagent-files-adapter.ts
import { open, readdir as readdir2, readFile as readFile2, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var ACTIVE_WRITE_MS = 9e4;
var RECENT_SESSION_MS = 6 * 60 * 60 * 1e3;
var DIR_RETRY_MS = 6e4;
var MAX_SESSIONS_PER_SCAN = 40;
var MAX_META_CACHE = 2e3;
var SubagentFilesAdapter = class {
  constructor(ctx, claudeHomes) {
    this.ctx = ctx;
    this.claudeHomes = claudeHomes;
  }
  sessionDirs = /* @__PURE__ */ new Map();
  seenMtime = /* @__PURE__ */ new Map();
  metaCache = /* @__PURE__ */ new Map();
  /** subagent node id → its transcript file, for the Output tab. */
  transcripts = /* @__PURE__ */ new Map();
  sessionFiles = /* @__PURE__ */ new Map();
  transcriptFor(agentId) {
    return this.transcripts.get(agentId) ?? null;
  }
  /** The transcript of a subagent, or of a Claude session (chat or terminal) by its session id. */
  async transcriptPathFor(agent) {
    if (agent.role === "subagent") return this.transcriptFor(agent.id);
    if (!agent.sessionId || agent.agent !== "claude" && agent.agent !== null) return null;
    const cached = this.sessionFiles.get(agent.sessionId);
    if (cached !== void 0) return cached;
    let found = null;
    for (const root of await this.projectRoots()) {
      let projects = [];
      try {
        projects = await readdir2(root);
      } catch {
        continue;
      }
      for (const project of projects) {
        const file = join2(root, project, `${agent.sessionId}.jsonl`);
        try {
          if ((await stat(file)).isFile()) {
            found = file;
            break;
          }
        } catch {
        }
      }
      if (found) break;
    }
    if (found) this.sessionFiles.set(agent.sessionId, found);
    return found;
  }
  async scan() {
    const now = this.ctx.now();
    const roots = await this.projectRoots();
    if (!roots.length) return;
    const parents = Object.values(this.ctx.store.read().agents).filter((a) => a.sessionId && a.role !== "subagent" && (a.agent === "claude" || a.agent === null) && (a.live || now - a.lastSeenAt < RECENT_SESSION_MS)).sort((a, b) => Number(b.live) - Number(a.live) || b.lastSeenAt - a.lastSeenAt).slice(0, MAX_SESSIONS_PER_SCAN);
    for (const parent of parents) {
      const dir = await this.subagentDir(roots, parent.sessionId, now);
      if (dir) await this.scanDir(dir, parent, now);
    }
  }
  async projectRoots() {
    const candidates = [join2(homedir(), ".claude", "projects"), ...this.claudeHomes().map((home) => join2(home, "projects"))];
    const out = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      try {
        out.add(await realpath(candidate));
      } catch {
      }
    }
    return [...out];
  }
  async subagentDir(roots, sessionId, now) {
    const cached = this.sessionDirs.get(sessionId);
    if (cached && (cached.dir || now - cached.checkedAt < DIR_RETRY_MS)) return cached.dir;
    let found = null;
    for (const root of roots) {
      let projects;
      try {
        projects = await readdir2(root);
      } catch {
        continue;
      }
      for (const project of projects) {
        const dir = join2(root, project, sessionId, "subagents");
        try {
          if ((await stat(dir)).isDirectory()) {
            found = dir;
            break;
          }
        } catch {
        }
      }
      if (found) break;
    }
    this.sessionDirs.set(sessionId, { dir: found, checkedAt: now });
    return found;
  }
  async scanDir(dir, parent, now) {
    let names;
    try {
      names = (await readdir2(dir)).filter((name) => name.endsWith(".meta.json"));
    } catch {
      return;
    }
    for (const name of names) {
      const base = name.slice(0, -".meta.json".length);
      const metaPath = join2(dir, name);
      const transcriptPath = join2(dir, `${base}.jsonl`);
      let metaMtime = 0;
      let mtime = 0;
      try {
        metaMtime = (await stat(metaPath)).mtimeMs;
        mtime = Math.max(metaMtime, await stat(transcriptPath).then((s) => s.mtimeMs).catch(() => 0));
      } catch {
        continue;
      }
      let meta;
      const cachedMeta = this.metaCache.get(metaPath);
      if (cachedMeta && cachedMeta.mtime === metaMtime) meta = cachedMeta.meta;
      else {
        try {
          meta = JSON.parse(await readFile2(metaPath, "utf8"));
        } catch {
          continue;
        }
        this.metaCache.set(metaPath, { mtime: metaMtime, meta });
        if (this.metaCache.size > MAX_META_CACHE) this.metaCache.delete(this.metaCache.keys().next().value);
      }
      const id = meta.toolUseId ? `sub:${meta.toolUseId}` : `sub:file:${base}`;
      this.transcripts.set(id, transcriptPath);
      const existing = this.ctx.store.read().agents[id];
      const writing = now - mtime < ACTIVE_WRITE_MS;
      const finished = meta.finished === true;
      const live = !finished && writing && parent.live;
      if (this.seenMtime.get(id) === mtime && existing && existing.live === live) continue;
      this.seenMtime.set(id, mtime);
      const startedAt = existing?.startedAt ?? await firstTimestamp(transcriptPath) ?? mtime;
      this.ctx.store.upsertAgent(
        id,
        mtime,
        {
          role: "subagent",
          agent: "claude",
          parentId: existing?.parentId ?? parent.id,
          callId: meta.toolUseId ?? null,
          subagentType: meta.agentType ?? existing?.subagentType ?? "general-purpose",
          description: meta.description ? redactAndTruncate(meta.description, 300) : existing?.description ?? null,
          title: meta.description ? redactAndTruncate(meta.description, 120) : existing?.title ?? "Subagent",
          model: meta.model ?? existing?.model ?? null,
          runId: parent.runId,
          taskId: parent.taskId,
          workspaceId: parent.workspaceId,
          worktreePath: parent.worktreePath,
          branch: parent.branch,
          account: parent.account,
          state: finished ? "done" : live ? "working" : "unknown",
          outcome: finished ? "success" : null,
          live,
          startedAt,
          stateSince: mtime,
          endedAt: finished ? mtime : null,
          evidence: ["session-file"]
        },
        () => newAgent(id, "subagent", now)
      );
      if (!existing) {
        this.ctx.store.emit({ id: `subagent.file:${id}`, ts: startedAt, kind: "subagent.spawned", source: "session-file", entityId: id, targetId: parent.id, runId: parent.runId, summary: `${parent.title ?? "Claude"} spawned subagent: ${meta.description ?? meta.agentType ?? "subagent"}` });
      } else if (finished && existing.state !== "done") {
        this.ctx.store.emit({ id: `subagent.done:${id}`, ts: mtime, kind: "subagent.completed", source: "session-file", entityId: id, targetId: parent.id, runId: parent.runId, summary: `Subagent ${meta.description ?? ""} finished`.trim() });
      }
    }
  }
};
async function firstTimestamp(path) {
  try {
    const handle = await open(path, "r");
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(8192), 0, 8192, 0);
      const line = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
      const ts = JSON.parse(line).timestamp;
      const ms = ts ? Date.parse(ts) : NaN;
      return Number.isFinite(ms) ? ms : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

// src/worker/adapters/session-model-adapter.ts
import { open as open2, readdir as readdir3, stat as stat2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var TAIL_BYTES = 256 * 1024;
var RECENT_MS = 6 * 60 * 60 * 1e3;
var CODEX_INDEX_MS = 6e4;
var SessionModelAdapter = class {
  constructor(ctx, claudeFiles, codexHomes) {
    this.ctx = ctx;
    this.claudeFiles = claudeFiles;
    this.codexHomes = codexHomes;
  }
  codexIndex = /* @__PURE__ */ new Map();
  codexIndexedAt = 0;
  seen = /* @__PURE__ */ new Map();
  async refresh() {
    const now = this.ctx.now();
    const agents = Object.values(this.ctx.store.read().agents).filter((a) => (a.live || now - a.lastSeenAt < RECENT_MS) && (a.sessionId || a.role === "subagent"));
    for (const agent of agents) {
      const path = await this.fileFor(agent);
      if (!path) continue;
      let mtime = 0;
      try {
        mtime = (await stat2(path)).mtimeMs;
      } catch {
        continue;
      }
      if (this.seen.get(agent.id) === mtime) continue;
      this.seen.set(agent.id, mtime);
      const reading = agent.agent === "codex" ? readCodexModel(await tail(path)) : readClaudeModel(await tail(path));
      if (!reading.model && !reading.effort) continue;
      const current = this.ctx.store.read().agents[agent.id];
      if (!current || current.model === (reading.model ?? current.model) && current.effort === (reading.effort ?? current.effort)) continue;
      this.ctx.store.upsertAgent(agent.id, current.lastSeenAt, { model: reading.model ?? void 0, effort: reading.effort ?? void 0, evidence: ["session-file"] }, () => current);
    }
  }
  async fileFor(agent) {
    if (agent.agent === "codex") return agent.sessionId ? await this.codexFile(agent.sessionId) : null;
    if (agent.agent === "claude" || agent.agent === null || agent.role === "subagent") return await this.claudeFiles.transcriptPathFor(agent);
    return null;
  }
  async codexFile(sessionId) {
    const now = this.ctx.now();
    if (!this.codexIndex.has(sessionId) && now - this.codexIndexedAt > CODEX_INDEX_MS) {
      this.codexIndexedAt = now;
      for (const home of [join3(homedir2(), ".codex"), ...this.codexHomes()]) await indexCodexSessions(join3(home, "sessions"), this.codexIndex);
    }
    return this.codexIndex.get(sessionId) ?? null;
  }
};
async function indexCodexSessions(root, index) {
  const list = async (dir) => (await readdir3(dir).catch(() => [])).sort().reverse();
  let days = 0;
  for (const year of await list(root)) {
    for (const month of await list(join3(root, year))) {
      for (const day of await list(join3(root, year, month))) {
        if (++days > 45) return;
        for (const name of await list(join3(root, year, month, day))) {
          const match = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(name);
          if (match && !index.has(match[1])) index.set(match[1], join3(root, year, month, day, name));
        }
      }
    }
  }
}
async function tail(path) {
  const handle = await open2(path, "r");
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await handle.close();
  }
}
function readClaudeModel(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "assistant" || !entry.message?.model || entry.message.model === "<synthetic>") continue;
      return { model: entry.message.model, effort: entry.perTurnEffort ?? entry.effort ?? null };
    } catch {
    }
  }
  return { model: null, effort: null };
}
function readCodexModel(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("turn_context")) continue;
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "turn_context") continue;
      return { model: entry.payload?.model ?? null, effort: entry.payload?.effort ?? entry.payload?.reasoning_effort ?? null };
    } catch {
    }
  }
  return { model: null, effort: null };
}

// src/worker/cli/orca-cli.ts
import { execFile } from "node:child_process";
import { access, constants, readFile as readFile3 } from "node:fs/promises";
import { homedir as homedir3, platform } from "node:os";
import { delimiter, join as join4 } from "node:path";
var MAX_CONCURRENT = 3;
var MAX_OUTPUT = 8 * 1024 * 1024;
async function resolveCliPath(override) {
  const home = homedir3();
  const candidates = [];
  if (override) candidates.push(override);
  if (platform() === "linux") candidates.push(join4(home, ".config/orca/linux-orca-cli-shim/orca"));
  const exe = platform() === "win32" ? ["orca.cmd", "orca.exe", "orca"] : ["orca"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) for (const name of exe) if (dir) candidates.push(join4(dir, name));
  if (platform() === "darwin") candidates.push("/usr/local/bin/orca", "/opt/homebrew/bin/orca", "/Applications/Orca.app/Contents/Resources/bin/orca");
  if (platform() === "win32") candidates.push(join4(process.env.LOCALAPPDATA ?? join4(home, "AppData/Local"), "Programs/Orca/resources/bin/orca.cmd"));
  if (platform() === "linux") candidates.push("/usr/local/bin/orca");
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, platform() === "win32" ? constants.F_OK : constants.X_OK);
    } catch {
      continue;
    }
    if (await looksLikeScreenReader(candidate)) continue;
    if (await confirmsOrcaIde(candidate)) return candidate;
  }
  return null;
}
async function looksLikeScreenReader(path) {
  try {
    const head = (await readFile3(path)).subarray(0, 2048).toString("latin1");
    return /^#!.*python/.test(head) || /The Orca Team|GNOME|Igalia|orca\.orca_main/.test(head);
  } catch {
    return false;
  }
}
function confirmsOrcaIde(path) {
  return new Promise((resolve3) => {
    execFile(path, ["status", "--json"], { timeout: 6e3, maxBuffer: 1024 * 1024, windowsHide: true }, (_error, stdout) => {
      const parsed = parseCliOutput(stdout ?? "", null);
      resolve3(parsed.ok && typeof parsed.result === "object" && parsed.result !== null && "app" in parsed.result);
    });
  });
}
function createCliRunner(path) {
  let active = 0;
  const queue = [];
  const acquire = () => new Promise((resolve3) => {
    if (active < MAX_CONCURRENT) {
      active++;
      resolve3();
    } else queue.push(() => {
      active++;
      resolve3();
    });
  });
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return {
    path,
    async run(args, options = {}) {
      if (!path) return { ok: false, code: "cli_unavailable", message: "The orca CLI was not found. Set its path in Agent Flow settings." };
      await acquire();
      try {
        return await new Promise((resolve3) => {
          const child = execFile(
            path,
            [...args, "--json"],
            { timeout: options.timeoutMs ?? 15e3, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { ...process.env, NO_COLOR: "1" } },
            (error, stdout) => resolve3(parseCliOutput(stdout, error))
          );
          if (options.stdin !== void 0) {
            child.stdin?.end(options.stdin);
          } else child.stdin?.end();
        });
      } finally {
        release();
      }
    }
  };
}
function parseCliOutput(stdout, error) {
  const text = stdout.trim();
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed.ok === true) return { ok: true, result: parsed.result };
      if (parsed.ok === false) return { ok: false, code: parsed.error?.code ?? "action_failed", message: parsed.error?.message ?? "The orca CLI reported an error." };
    } catch {
    }
  }
  if (error?.killed) return { ok: false, code: "timeout", message: "The orca CLI did not answer in time." };
  return { ok: false, code: "action_failed", message: error?.message ?? "The orca CLI returned no JSON." };
}

// src/worker/commands/availability.ts
var COORDINATOR_REASON = "Orca only lets a Run\u2019s coordinator change its tasks. Agent Flow shows the exact command to run in the coordinator, or runs it as the coordinator if you turn that on in settings.";
function commandAvailability(kind, probe) {
  const host = (method, reason) => probe.hostHas(method) ? { available: true, mode: "direct", reason: null } : { available: false, mode: "unsupported", reason: reason ?? `This Orca does not offer ${method} to plugins.` };
  const cli = () => probe.cli ? { available: true, mode: "direct", reason: null } : { available: false, mode: "unsupported", reason: "The orca CLI was not found." };
  const coordinator = () => !probe.cli ? { available: false, mode: "unsupported", reason: "The orca CLI was not found." } : { available: true, mode: "coordinator", reason: probe.actAsCoordinator ? "Runs as the Run\u2019s coordinator (enabled in settings)." : COORDINATOR_REASON };
  switch (kind) {
    case "terminal.focus":
      return host("terminal.focus");
    case "terminal.read":
      return host("terminal.read");
    case "agent.launch":
      return host("agent.launch");
    case "agent.resume":
      return host("agent.resume");
    case "agent.stop":
      return cli();
    case "agent.readOutput":
      return probe.cli || probe.hostHas("terminal.read") ? { available: true, mode: "direct", reason: null } : { available: false, mode: "unsupported", reason: "Neither the orca CLI nor terminal.read is available." };
    case "task.create":
    case "task.update":
    case "task.retry":
    case "task.dispatch":
    case "gate.resolve":
    case "message.send":
      return coordinator();
    case "task.cancel":
      return probe.cli ? { available: true, mode: "direct", reason: "Stops the task\u2019s worker. Marking the task cancelled needs the coordinator." } : cli();
    case "worktree.create":
      return host("workspace.create");
    case "worktree.open":
      return host("workspace.open");
    case "worktree.inspect":
      return { available: true, mode: "direct", reason: null };
    case "agent.prompt":
      return probe.hostHas("terminal.sendText") || probe.cli ? { available: true, mode: "direct", reason: null } : { available: false, mode: "unsupported", reason: "This Orca offers no way for plugins to send text to agents." };
    case "model.change":
      return { available: false, mode: "unsupported", reason: "Orca has no API to change a running agent\u2019s model or effort. Pick a model when you retry or dispatch the task instead." };
    case "labels.update":
    case "history.list":
    case "history.load":
    case "viewer.ping":
    case "agent.attach":
    case "star.visit":
    case "update.check":
    case "update.run":
    case "star.answer":
    case "dashboard.info":
    case "entity.detail":
    case "agent.image":
    case "dashboard.enable":
    case "dashboard.controls":
      return { available: true, mode: "direct", reason: null };
  }
}

// src/worker/commands/attachments.ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir as homedir4, platform as platform2 } from "node:os";
import { join as join5 } from "node:path";
var MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
var UPLOAD_TTL_MS = 5 * 60 * 1e3;
var MAX_PENDING_UPLOADS = 10;
var EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
function attachmentsRoot(fallback) {
  const home = homedir4();
  const orcaDir = platform2() === "darwin" ? join5(home, "Library/Application Support/orca") : platform2() === "win32" ? join5(process.env.APPDATA ?? join5(home, "AppData/Roaming"), "orca") : join5(process.env.XDG_CONFIG_HOME ?? join5(home, ".config"), "orca");
  return existsSync(orcaDir) ? join5(orcaDir, "agent-session-attachments") : join5(fallback, "agent-session-attachments");
}
function looksLike(type, bytes2) {
  switch (type) {
    case "image/png":
      return bytes2.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
      return bytes2[0] === 255 && bytes2[1] === 216 && bytes2[2] === 255;
    case "image/gif":
      return bytes2.subarray(0, 4).toString("latin1") === "GIF8";
    case "image/webp":
      return bytes2.subarray(0, 4).toString("latin1") === "RIFF" && bytes2.subarray(8, 12).toString("latin1") === "WEBP";
  }
}
var AttachmentStore = class {
  constructor(root, now = Date.now) {
    this.root = root;
    this.now = now;
  }
  uploads = /* @__PURE__ */ new Map();
  /** attachment id → saved file. */
  saved = /* @__PURE__ */ new Map();
  /**
   * One chunk of an upload. `offset` must equal what was received so far (chunks in order, retries
   * of the same chunk are harmless). The last chunk (`done`) checks and saves the file.
   */
  async append(uploadId, type, chunk, offset, done) {
    this.sweep();
    let upload = this.uploads.get(uploadId);
    if (!upload) {
      if (offset !== 0) throw codeError("invalid_params", "This upload expired; attach the image again.");
      if (this.uploads.size >= MAX_PENDING_UPLOADS) throw codeError("busy", "Too many images uploading at once.");
      upload = { type, chunks: [], length: 0, startedAt: this.now() };
      this.uploads.set(uploadId, upload);
    }
    if (upload.type !== type) throw codeError("invalid_params", "The image type changed during the upload.");
    if (offset === upload.length) {
      upload.chunks.push(chunk);
      upload.length += chunk.length;
    } else if (offset + chunk.length !== upload.length) {
      throw codeError("invalid_params", "Image chunks arrived out of order; attach the image again.");
    }
    if (upload.length * 0.75 > MAX_ATTACHMENT_BYTES + 3) {
      this.uploads.delete(uploadId);
      throw codeError("too_large", `Images can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    }
    if (!done) return { received: upload.length };
    this.uploads.delete(uploadId);
    const bytes2 = Buffer.from(upload.chunks.join(""), "base64");
    if (!bytes2.length || bytes2.length > MAX_ATTACHMENT_BYTES) throw codeError("too_large", `Images can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    if (!looksLike(type, bytes2)) throw codeError("invalid_params", "That file is not the image type it claims to be.");
    const attachmentId = randomUUID();
    const dir = join5(this.root, attachmentId);
    await mkdir(dir, { recursive: true, mode: 448 });
    const path = join5(dir, `agent-flow-paste-${this.now()}.${EXTENSION[type]}`);
    await writeFile(path, bytes2, { mode: 384 });
    this.saved.set(attachmentId, path);
    if (this.saved.size > 200) this.saved.delete(this.saved.keys().next().value);
    return { attachmentId, bytes: bytes2.length };
  }
  /** The saved file for an attachment id, or null when this store did not save it. */
  pathFor(attachmentId) {
    return this.saved.get(attachmentId) ?? null;
  }
  sweep() {
    const now = this.now();
    for (const [id, upload] of this.uploads) if (now - upload.startedAt > UPLOAD_TTL_MS) this.uploads.delete(id);
  }
};
function mentionFor(path, route) {
  return route === "other" ? path : `@"${path.replace(/"/g, '\\"')}"`;
}
function codeError(code, message) {
  return Object.assign(new Error(message), { code });
}

// src/worker/commands/router.ts
import { createHash as createHash2 } from "node:crypto";

// src/worker/git/git-inspect.ts
import { execFile as execFile2 } from "node:child_process";
function git(cwd, args) {
  return new Promise((resolve3, reject) => {
    execFile2(
      "git",
      ["-C", cwd, "--no-optional-locks", ...args],
      { timeout: 8e3, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
      (error, stdout) => error ? reject(error) : resolve3(stdout)
    );
  });
}
async function inspectWorktree(path) {
  const [branch, head, status, diffStat, log, upstream] = await Promise.all([
    git(path, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
    git(path, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    git(path, ["status", "--porcelain=v1", "-uall"]).catch(() => ""),
    git(path, ["diff", "--stat", "HEAD"]).catch(() => ""),
    git(path, ["log", "-n", "20", "--format=%h%x1f%s%x1f%an%x1f%ct"]).catch(() => ""),
    git(path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).catch(() => "")
  ]);
  const changedFiles = status.split("\n").filter(Boolean).slice(0, 500).map((line) => ({ status: line.slice(0, 2).trim() || "?", path: line.slice(3) }));
  const conflicts = changedFiles.filter((file) => ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].includes(file.status)).map((file) => file.path);
  const commits = log.split("\n").filter(Boolean).map((line) => {
    const [hash, subject, author, ct] = line.split("");
    return { hash, subject: redact(subject ?? ""), author: author ?? "", at: Number(ct) * 1e3 };
  });
  const [ahead, behind] = upstream.trim() ? upstream.trim().split(/\s+/).map(Number) : [null, null];
  return {
    path,
    branch: branch.trim() || null,
    head: head.trim() || null,
    changedFiles,
    diffStat: truncate(diffStat.trim(), 8e3),
    commits,
    conflicts,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  };
}

// src/worker/commands/coordinator-commands.ts
function flag(name, value) {
  return `--${name}=${value}`;
}
function coordinatorArgs(request, state) {
  const p = request.params;
  const runId = typeof p.runId === "string" ? p.runId : null;
  if (!runId || !state.runs[runId]) return null;
  const s = (key) => typeof p[key] === "string" ? p[key] : null;
  switch (request.kind) {
    case "task.create": {
      const args = ["orchestration", "task-create", flag("run", runId), flag("task-title", s("title") ?? "Task"), flag("spec", s("spec") ?? "")];
      const deps = Array.isArray(p.deps) ? p.deps : [];
      if (deps.length) args.push(flag("deps", JSON.stringify(deps)));
      if (s("parentId")) args.push(flag("parent", s("parentId")));
      return args;
    }
    case "task.update": {
      const taskId = s("taskId");
      if (!taskId || state.tasks[taskId]?.runId !== runId) return null;
      const args = ["orchestration", "task-update", flag("run", runId), flag("id", taskId), flag("status", s("status") ?? "pending")];
      if (s("result")) args.push(flag("result", s("result")));
      return args;
    }
    case "task.retry":
    case "task.dispatch": {
      const taskId = s("taskId");
      const task = taskId ? state.tasks[taskId] : void 0;
      if (!task || task.runId !== runId) return null;
      const args = ["orchestration", "worker-start", flag("run", runId), flag("task", task.id)];
      if (request.kind === "task.retry") {
        const last = task.dispatchIds[task.dispatchIds.length - 1];
        if (last) args.push(flag("retry-of", last));
      }
      if (s("agent")) args.push(flag("agent", s("agent")));
      if (s("model")) args.push(flag("model", s("model")));
      if (s("model") && s("effort")) args.push(flag("effort", s("effort")));
      args.push(flag("worktree", s("worktree") ?? "new-child"));
      return args;
    }
    case "gate.resolve": {
      const gateId = s("gateId");
      if (!gateId) return null;
      const taskId = state.gates[gateId]?.taskId;
      if (!taskId || state.tasks[taskId]?.runId !== runId) return null;
      return ["orchestration", "gate-resolve", flag("id", gateId), flag("resolution", s("resolution") ?? "")];
    }
    case "message.send":
      return [
        "orchestration",
        "send",
        flag("run", runId),
        flag("to", s("to") ?? `run:${runId}`),
        flag("subject", s("subject") ?? ""),
        flag("body", s("body") ?? ""),
        flag("type", "status")
      ];
    default:
      return null;
  }
}
function shellQuote(arg) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

// src/worker/commands/transcript.ts
var PAGE_LIMIT = 100;
var MAX_PAGES = 8;
var KEEP_MESSAGES = 160;
var TEXT_LIMIT = 4e3;
var TOOL_LIMIT = 1500;
async function readWorkerOutput(cli, dispatchId) {
  const messages = [];
  let cursor = null;
  let first = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ["orchestration", "worker-read", "--dispatch", dispatchId, "--limit", String(PAGE_LIMIT), "--full"];
    if (cursor) args.push("--cursor", cursor);
    const result = await cli.run(args, { timeoutMs: 2e4 });
    if (!result.ok) {
      if (!first) return null;
      break;
    }
    first ??= result.result;
    const transcript = result.result.transcript;
    if (!transcript?.messages) break;
    for (const raw of transcript.messages) {
      const message = normalizeMessage(raw);
      if (message) messages.push(message);
    }
    if (messages.length > KEEP_MESSAGES) {
      messages.splice(0, messages.length - KEEP_MESSAGES);
      truncated = true;
    }
    cursor = transcript.nextCursor ?? null;
    if (!cursor) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  if (!first) return null;
  if (first.transcript) return { kind: "conversation", source: first.source ?? "transcript", provider: first.provider ?? null, messages, truncated };
  return { kind: "lines", source: first.source ?? "terminal", lines: flattenLines(first), truncated: false };
}
function normalizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const m = raw;
  const blocks = [];
  const rawBlocks = Array.isArray(m.blocks) ? m.blocks : typeof m.text === "string" ? [{ type: "text", text: m.text }] : [];
  for (const b of rawBlocks) {
    const type = String(b?.type ?? "");
    if (type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: clean(b.text, TEXT_LIMIT) });
    else if ((type === "thinking" || type === "reasoning") && typeof b.text === "string") blocks.push({ type: "thinking", text: clean(b.text, TEXT_LIMIT) });
    else if (type === "tool-call") blocks.push({ type: "tool-call", name: String(b.name ?? "tool"), input: clean(typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}), TOOL_LIMIT) });
    else if (type === "tool-result") blocks.push({ type: "tool-result", output: clean(typeof b.output === "string" ? b.output : JSON.stringify(b.output ?? ""), TOOL_LIMIT), isError: b.isError === true || b.is_error === true });
  }
  if (!blocks.length) return null;
  return { id: String(m.id ?? Math.random()), role: String(m.role ?? "assistant"), ts: typeof m.timestamp === "number" ? m.timestamp : null, blocks };
}
function flattenLines(result) {
  const rows = Array.isArray(result.rows) ? result.rows : Array.isArray(result.lines) ? result.lines : [];
  const lines = [];
  for (const row of rows) {
    if (typeof row === "string") lines.push(row);
    else if (row && typeof row === "object") {
      const r = row;
      const text = r.text ?? r.content ?? r.line ?? r.message;
      lines.push(typeof text === "string" ? text : JSON.stringify(row));
    }
  }
  if (!lines.length && typeof result.text === "string") lines.push(...result.text.split("\n"));
  return lines.slice(-1e3).map((line) => clean(line, TEXT_LIMIT));
}
function clean(text, max) {
  return redact(stripAnsi(truncate(text, max)));
}

// src/worker/runtime-rpc/chat-send.ts
import { createHash, randomUUID as randomUUID3 } from "node:crypto";

// src/worker/runtime-rpc/orca-runtime-client.ts
import { createConnection } from "node:net";
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFile as readFile4, stat as stat3 } from "node:fs/promises";
import { homedir as homedir5, platform as platform3 } from "node:os";
import { join as join6 } from "node:path";
var ALLOWED = /* @__PURE__ */ new Set(["agentSession.history", "agentSession.send"]);
var MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
var METADATA_FILE = "orca-runtime.json";
var RuntimeRpcError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function orcaUserDataDir() {
  const home = homedir5();
  if (process.env.ORCA_USER_DATA_PATH) return process.env.ORCA_USER_DATA_PATH;
  if (platform3() === "darwin") return join6(home, "Library/Application Support/orca");
  if (platform3() === "win32") return join6(process.env.APPDATA ?? join6(home, "AppData/Roaming"), "orca");
  return join6(process.env.XDG_CONFIG_HOME ?? join6(home, ".config"), "orca");
}
async function readMetadata(dir) {
  const path = join6(dir, METADATA_FILE);
  try {
    const info = await stat3(path);
    if (platform3() !== "win32" && typeof process.getuid === "function" && info.uid !== process.getuid()) throw new RuntimeRpcError("runtime_untrusted", "Orca runtime metadata is not owned by this user.");
    const parsed = JSON.parse(await readFile4(path, "utf8"));
    if (!parsed.authToken || !Array.isArray(parsed.transports)) throw new RuntimeRpcError("runtime_unavailable", "Orca runtime metadata is incomplete.");
    return parsed;
  } catch (error) {
    if (error instanceof RuntimeRpcError) throw error;
    throw new RuntimeRpcError("runtime_unavailable", "Could not read Orca runtime metadata. Is Orca running?");
  }
}
async function callOrcaRuntime(method, params, options = {}) {
  if (!ALLOWED.has(method)) throw new RuntimeRpcError("not_permitted", `Agent Flow does not call ${method}.`);
  const metadata = await readMetadata(options.userDataDir ?? orcaUserDataDir());
  const transport = metadata.transports.find((t) => t.kind === "unix" || t.kind === "named-pipe");
  if (!transport) throw new RuntimeRpcError("runtime_unavailable", "Orca exposes no local runtime socket.");
  const id = randomUUID2();
  return await new Promise((resolve3, reject) => {
    const socket = createConnection(transport.endpoint);
    let buffer = "";
    let size = 0;
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new RuntimeRpcError("timeout", "Orca did not answer in time."))), options.timeoutMs ?? 15e3);
    socket.on("error", () => finish(() => reject(new RuntimeRpcError("runtime_unavailable", "Could not reach Orca\u2019s runtime."))));
    socket.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) return finish(() => reject(new RuntimeRpcError("too_large", "Orca\u2019s answer was too large.")));
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          return finish(() => reject(new RuntimeRpcError("invalid_response", "Orca sent an unreadable answer.")));
        }
        if (frame._keepalive !== void 0) {
          timer.refresh();
          continue;
        }
        if (frame.id !== id) return finish(() => reject(new RuntimeRpcError("invalid_response", "Orca answered a different request.")));
        if (frame.ok) return finish(() => resolve3(frame.result));
        return finish(() => reject(new RuntimeRpcError(frame.error?.code ?? "action_failed", frame.error?.message ?? "Orca refused the request.")));
      }
    });
    socket.write(JSON.stringify({ id, authToken: metadata.authToken, method, params }) + "\n");
  });
}

// src/worker/runtime-rpc/chat-send.ts
var STRUCTURED_PREFIX = "structured-agent-session-";
function chatSessionIdFromPaneKey(paneKey) {
  if (!paneKey?.startsWith(STRUCTURED_PREFIX)) return null;
  const id = paneKey.slice(STRUCTURED_PREFIX.length).split(":")[0];
  return /^[A-Za-z0-9_-]{4,200}$/.test(id) ? id : null;
}
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
}
function payloadFingerprint(method, sessionId, fields) {
  return createHash("sha256").update(canonicalize({ method, sessionId, fields }), "utf8").digest("hex");
}
function operationId(now = Date.now()) {
  return `${Math.trunc(now)}-${randomUUID3().replaceAll("-", "").toLowerCase()}`;
}
async function sendChatMessage(sessionId, text) {
  const history = await callOrcaRuntime("agentSession.history", { sessionId, direction: "tail", limit: 1 });
  const fence = history.page?.fence;
  if (typeof fence !== "number") throw new Error("Orca did not report this chat session\u2019s state.");
  const fields = { body: { kind: "message", role: "user", blocks: [{ type: "text", text }] }, delivery: "queue-if-active" };
  await callOrcaRuntime("agentSession.send", {
    envelope: { sessionId, clientOperationId: operationId(), expectedRuntimeFence: fence, payloadFingerprint: payloadFingerprint("agentSession.send", sessionId, fields) },
    ...fields
  });
  return { accepted: true };
}

// src/worker/commands/claude-transcript.ts
import { open as open3, stat as stat4 } from "node:fs/promises";
var READ_WINDOWS = [3 * 1024 * 1024, 12 * 1024 * 1024, 48 * 1024 * 1024];
var IMAGE_SCAN_BYTES = 24 * 1024 * 1024;
var KEEP_MESSAGES2 = 160;
var TEXT_LIMIT2 = 4e3;
var TOOL_LIMIT2 = 1500;
var tails = /* @__PURE__ */ new Map();
var MAX_TAILS = 24;
function remember(path, tail2) {
  tails.delete(path);
  tails.set(path, tail2);
  if (tails.size > MAX_TAILS) tails.delete(tails.keys().next().value);
  return tail2.output;
}
function conversation(messages, truncated) {
  return { kind: "conversation", source: "claude transcript", provider: "claude", messages, truncated };
}
async function readClaudeTranscript(path, options = {}) {
  let info;
  try {
    info = await stat4(path);
  } catch {
    tails.delete(path);
    return null;
  }
  const { size, mtimeMs } = info;
  if (!options.beforeId) {
    const tail2 = tails.get(path);
    if (tail2 && tail2.size === size && tail2.mtimeMs === mtimeMs) return tail2.output;
    if (tail2 && size > tail2.size && size >= tail2.end) {
      const read2 = await readMessages(path, tail2.end, size, false);
      if (!read2.messages.length) return remember(path, { ...tail2, size, mtimeMs, end: read2.end });
      const all = [...tail2.messages, ...read2.messages];
      const messages = all.slice(-KEEP_MESSAGES2);
      const truncated = tail2.truncated || all.length > messages.length;
      return remember(path, { size, mtimeMs, end: read2.end, messages, truncated, output: conversation(messages, truncated) });
    }
  }
  for (const window of READ_WINDOWS) {
    const start = Math.max(0, size - window);
    const read2 = await readMessages(path, start, size, start > 0);
    const messages = read2.messages;
    let end = messages.length;
    if (options.beforeId) {
      end = messages.findIndex((m) => m.id === options.beforeId);
      if (end < 0) {
        if (start === 0) return conversation([], false);
        continue;
      }
    }
    const from = Math.max(0, end - KEEP_MESSAGES2);
    if (from === 0 && start > 0 && end < KEEP_MESSAGES2 && window !== READ_WINDOWS[READ_WINDOWS.length - 1]) continue;
    const kept = messages.slice(from, end);
    const truncated = from > 0 || start > 0;
    if (options.beforeId) return conversation(kept, truncated);
    return remember(path, { size, mtimeMs, end: read2.end, messages: kept, truncated, output: conversation(kept, truncated) });
  }
  return null;
}
async function readMessages(path, start, size, firstLineCut) {
  const handle = await open3(path, "r");
  const buffer = Buffer.alloc(size - start);
  try {
    await handle.read(buffer, 0, buffer.length, start);
  } finally {
    await handle.close();
  }
  const lastNewline = buffer.lastIndexOf(10);
  const lines = buffer.toString("utf8", 0, lastNewline + 1).split("\n");
  if (firstLineCut) lines.shift();
  const messages = [];
  const take = (line) => {
    if (!line.trim()) return true;
    try {
      const message = toMessage(JSON.parse(line));
      if (message) messages.push(message);
      return true;
    } catch {
      return false;
    }
  };
  for (const line of lines) take(line);
  let end = start + lastNewline + 1;
  const rest = buffer.toString("utf8", lastNewline + 1);
  if (rest.trim() && !(firstLineCut && lastNewline < 0) && take(rest)) end = size;
  return { messages, end };
}
function toMessage(entry) {
  if (entry.type !== "user" && entry.type !== "assistant") return null;
  const message = entry.message;
  if (!message) return null;
  const blocks = [];
  const content = message.content;
  if (typeof content === "string") blocks.push({ type: "text", text: redactAndTruncate(content, TEXT_LIMIT2) });
  else if (Array.isArray(content)) {
    ;
    content.forEach((raw, index) => {
      switch (raw?.type) {
        case "image": {
          const image = imageRef(raw, `${entry.uuid}|${index}`);
          if (image) blocks.push({ type: "image", image });
          break;
        }
        case "text":
          if (typeof raw.text === "string" && raw.text.trim()) blocks.push({ type: "text", text: redactAndTruncate(raw.text, TEXT_LIMIT2) });
          break;
        case "thinking":
          if (typeof raw.thinking === "string" && raw.thinking.trim()) blocks.push({ type: "thinking", text: redactAndTruncate(raw.thinking, TEXT_LIMIT2) });
          break;
        case "tool_use":
          blocks.push({ type: "tool-call", name: String(raw.name ?? "tool"), input: redactAndTruncate(JSON.stringify(raw.input ?? {}), TOOL_LIMIT2) });
          break;
        case "tool_result": {
          const parts = Array.isArray(raw.content) ? raw.content : null;
          const out = typeof raw.content === "string" ? raw.content : parts ? parts.map((c) => typeof c?.text === "string" ? c.text : "").filter(Boolean).join("\n") : JSON.stringify(raw.content ?? "");
          const images2 = parts ? parts.map((c, j) => c?.type === "image" ? imageRef(c, `${entry.uuid}|${index}|${j}`) : null).filter((x) => Boolean(x)) : [];
          blocks.push({ type: "tool-result", output: redactAndTruncate(out, TOOL_LIMIT2), isError: raw.is_error === true, ...images2.length ? { images: images2 } : {} });
          break;
        }
      }
    });
  }
  if (!blocks.length) return null;
  const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  const rawModel = message.model;
  const model = entry.type === "assistant" && typeof rawModel === "string" && rawModel !== "<synthetic>" ? rawModel : null;
  const effort = typeof entry.perTurnEffort === "string" ? entry.perTurnEffort : typeof entry.effort === "string" ? entry.effort : null;
  return { id: String(entry.uuid ?? Math.random()), role: message.role ?? String(entry.type), ts: Number.isFinite(ts) ? ts : null, blocks, ...model ? { model, effort } : {} };
}
var IMAGE_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function imageRef(raw, ref) {
  const source = raw.source;
  if (source?.type !== "base64" || typeof source.data !== "string" || !IMAGE_TYPES.has(source.media_type ?? "")) return null;
  return { ref, mediaType: source.media_type, bytes: Math.floor(source.data.length * 3 / 4) };
}
var images = /* @__PURE__ */ new Map();
var imageBytes = 0;
var IMAGE_CACHE_BYTES = 24 * 1024 * 1024;
function cacheImage(key, image) {
  images.set(key, image);
  imageBytes += image.data.length;
  while (imageBytes > IMAGE_CACHE_BYTES && images.size > 1) {
    const [oldest, value] = images.entries().next().value;
    images.delete(oldest);
    imageBytes -= value.data.length;
  }
}
async function readClaudeImage(path, ref) {
  const [uuid, blockText, partText] = ref.split("|");
  if (!uuid || blockText === void 0) return null;
  const key = `${path}\0${ref}`;
  const cached = images.get(key);
  if (cached) return cached;
  const handle = await open3(path, "r");
  let buffer;
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - IMAGE_SCAN_BYTES);
    buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
  } finally {
    await handle.close();
  }
  const needle = Buffer.from(uuid);
  for (let at = buffer.indexOf(needle); at >= 0; at = buffer.indexOf(needle, at + needle.length)) {
    const lineStart = buffer.lastIndexOf(10, at) + 1;
    const newline = buffer.indexOf(10, at);
    const lineEnd = newline < 0 ? buffer.length : newline;
    try {
      const entry = JSON.parse(buffer.toString("utf8", lineStart, lineEnd));
      if (entry.uuid !== uuid || !Array.isArray(entry.message?.content)) continue;
      let block = entry.message.content[Number(blockText)];
      if (partText !== void 0) block = (Array.isArray(block?.content) ? block.content : [])[Number(partText)];
      const source = block?.source;
      if (source?.type === "base64" && typeof source.data === "string" && IMAGE_TYPES.has(source.media_type ?? "")) {
        const image = { mediaType: source.media_type, data: source.data };
        cacheImage(key, image);
        return image;
      }
    } catch {
    }
    at = Math.max(at, lineEnd - needle.length);
  }
  return null;
}

// src/worker/commands/router.ts
var CACHE_LIMIT = 500;
var OUTPUT_CACHE_MS = 2500;
var IMAGE_CHUNK = 6e5;
var OUTPUT_BUDGET = 850 * 1024;
var CommandRouter = class {
  constructor(deps) {
    this.deps = deps;
  }
  results = /* @__PURE__ */ new Map();
  /** Entry point for every transport. `allowed` narrows what a caller may run. */
  handle(input, allowed = () => true) {
    let request;
    try {
      request = validateCommand(input);
    } catch (error) {
      return Promise.resolve(fail(error instanceof ValidationError ? "invalid_params" : "action_failed", error.message));
    }
    if (!allowed(request.kind)) return Promise.resolve(fail("not_permitted", "This view may not run that command."));
    const cached = this.results.get(request.requestId);
    if (cached) return cached;
    const promise = this.execute(request);
    this.results.set(request.requestId, promise);
    if (this.results.size > CACHE_LIMIT) {
      const oldest = this.results.keys().next().value;
      if (oldest !== void 0) this.results.delete(oldest);
    }
    return promise;
  }
  async execute(request) {
    const { ctx } = this.deps;
    const availability = commandAvailability(request.kind, { hostHas: (m) => ctx.orca.host.has(m), cli: Boolean(ctx.cli.path), actAsCoordinator: this.deps.settings().actAsCoordinator });
    if (!availability.available) return fail("unsupported", availability.reason ?? "Not supported by this Orca.");
    if (DESTRUCTIVE_COMMANDS.has(request.kind) && !request.confirmed) return fail("confirmation_required", "Confirm this action first.");
    try {
      const response = await this.run(request);
      if (!READ_ONLY_COMMANDS.has(request.kind) && request.kind !== "entity.detail") ctx.store.emit({
        ts: ctx.now(),
        kind: response.ok ? "command.executed" : "command.failed",
        source: "command",
        entityId: String(request.params.agentId ?? request.params.taskId ?? request.params.terminalId ?? request.params.workspaceId ?? request.kind),
        summary: `${request.kind}: ${response.ok ? "done" : response.error.message}`
      });
      if (response.ok && !READ_ONLY_COMMANDS.has(request.kind)) this.deps.refresh();
      return response;
    } catch (error) {
      const err = error;
      ctx.log(`command ${request.kind} failed: ${err.message}`);
      return fail(typeof err.code === "string" ? err.code : "action_failed", redact(err.message));
    }
  }
  async run(request) {
    const { ctx } = this.deps;
    const p = request.params;
    const host = ctx.orca.host;
    switch (request.kind) {
      case "terminal.focus":
        return ok(await host.call("terminal.focus", { terminalId: p.terminalId }));
      case "terminal.read": {
        const result = await host.call("terminal.read", { terminalId: p.terminalId, maxLines: 400 });
        return ok({ kind: "lines", source: "terminal", lines: result.lines.map((line) => redact(stripAnsi(line))), truncated: result.truncated });
      }
      case "agent.readOutput":
        return p.before ? this.readEarlier(p.agentId, p.before) : this.readOutputSince(p.agentId, p.since);
      case "agent.prompt":
        return this.prompt(p.agentId, p.text ?? "", request.params.attachments ?? []);
      case "update.check":
        return this.deps.updates ? ok(await this.deps.updates.check(request.params.force === true)) : fail("unsupported", "Update checks are not available here.");
      case "update.run":
        return this.deps.updates ? ok(await this.deps.updates.update(this.deps.ctx.cli)) : fail("unsupported", "Updating is not available here.");
      case "star.visit":
        return this.deps.starPrompt ? ok(await this.deps.starPrompt.visit()) : ok({ show: false });
      case "star.answer":
        await this.deps.starPrompt?.answer(p.answer);
        return ok({ saved: true });
      case "agent.attach": {
        if (!this.deps.attachments) return fail("unsupported", "Attaching images is not available here.");
        const result = await this.deps.attachments.append(p.uploadId, p.mediaType, p.chunk, Number(p.offset), request.params.done === true);
        return ok(result);
      }
      case "agent.image":
        return this.image(p.agentId, p.ref, Number(p.offset ?? 0));
      case "agent.launch": {
        const result = await host.call("agent.launch", { workspaceId: p.workspaceId, agent: p.agent, ...p.prompt ? { prompt: p.prompt } : {} });
        this.deps.ownTerminals.add(result.terminalId);
        return ok(result);
      }
      case "agent.resume": {
        const result = await host.call("agent.resume", { workspaceId: p.workspaceId, agent: p.agent, sessionId: p.sessionId });
        this.deps.ownTerminals.add(result.terminalId);
        return ok(result);
      }
      case "agent.stop":
        return this.stopAgent(p.agentId);
      case "task.cancel":
        return this.cancelTask(p.taskId, p.runId);
      case "task.create":
      case "task.update":
      case "task.retry":
      case "task.dispatch":
      case "gate.resolve":
      case "message.send":
        return this.coordinatorCommand(request);
      case "worktree.create": {
        const result = await host.call("workspace.create", {
          projectId: p.projectId,
          ...p.name ? { name: p.name } : {},
          ...p.baseBranch ? { baseBranch: p.baseBranch } : {},
          ...p.agent ? { agent: p.agent } : {},
          ...p.prompt ? { prompt: p.prompt } : {}
        });
        if (result.terminalId) this.deps.ownTerminals.add(result.terminalId);
        return ok(result);
      }
      case "worktree.open":
        return ok(await host.call("workspace.open", { workspaceId: p.workspaceId }));
      case "worktree.inspect":
        return this.inspect(p.path);
      case "model.change":
        return fail("unsupported", "Orca has no API to change a running agent\u2019s model or effort.");
      case "labels.update": {
        const current = ctx.store.read().labels;
        const next = {
          accountTeams: p.accountTeams ?? current.accountTeams,
          agentRoles: p.agentRoles ?? current.agentRoles,
          leadAccount: p.leadAccount ?? current.leadAccount,
          projectNames: p.projectNames ?? current.projectNames ?? {},
          projectColors: sanitizeColors(p.projectColors ?? current.projectColors ?? {}),
          projectRules: p.projectRules ?? current.projectRules ?? {}
        };
        await this.deps.updateLabels(next);
        return ok(next);
      }
      case "history.list":
        return ok(await this.deps.persistence.listRuns());
      case "history.load": {
        const record = await this.deps.persistence.loadRun(p.runId);
        return record ? ok(record) : fail("not_found", "No saved history for that run.");
      }
      case "viewer.ping":
        return ok({ alive: true });
      case "dashboard.info":
        return ok(this.deps.dashboardInfo());
      case "dashboard.controls":
        return this.deps.setDashboardControls ? ok(await this.deps.setDashboardControls(request.params.enabled === true)) : fail("unsupported", "Not available.");
      case "dashboard.enable":
        return ok(await this.deps.setDashboard(request.params.enabled === true));
      case "entity.detail": {
        const text = this.deps.fullText(p.key);
        return text === null ? fail("not_found", "Full text is no longer cached; it is refreshed on the next poll.") : ok({ text });
      }
    }
  }
  /** Several open views ask for the same output; share one read for a few seconds. */
  outputCache = /* @__PURE__ */ new Map();
  /** Live views poll every few seconds; when nothing changed, answer with a few bytes only. */
  /** The transcript changed: the next read must not get the short-lived cached answer. */
  invalidateOutput(agentId) {
    this.outputCache.delete(agentId);
  }
  async readOutputSince(agentId, since) {
    const response = await this.readOutput(agentId);
    if (!since || !response.ok) return response;
    const version = response.result.version;
    return version === since ? ok({ unchanged: true, version }) : response;
  }
  readOutput(agentId) {
    const now = Date.now();
    const cached = this.outputCache.get(agentId);
    if (cached && now - cached.at < OUTPUT_CACHE_MS) return cached.promise;
    const promise = this.readOutputNow(agentId).then(fitOutput).then(withVersion);
    this.outputCache.set(agentId, { at: now, promise });
    if (this.outputCache.size > 50) this.outputCache.delete(this.outputCache.keys().next().value);
    return promise;
  }
  /** Older messages of a Claude transcript, the batch before `before` (a message id). */
  async readEarlier(agentId, before) {
    const agent = this.deps.ctx.store.read().agents[agentId];
    if (!agent) return fail("not_found", "That agent is no longer known.");
    const path = await this.deps.claudeTranscriptPath(agent);
    if (!path) return fail("unavailable", "Earlier messages are available for Claude conversations only.");
    const output = await readClaudeTranscript(path, { beforeId: before });
    return output ? fitOutput(ok(output)) : fail("unavailable", "Could not read the transcript.");
  }
  async readOutputNow(agentId) {
    const { ctx } = this.deps;
    const agent = ctx.store.read().agents[agentId];
    if (!agent) return fail("not_found", "That agent is no longer known.");
    if (agent.dispatchId && ctx.cli.path) {
      const output = await readWorkerOutput(ctx.cli, agent.dispatchId);
      if (output) {
        this.deps.noteOutputInterest?.(agentId);
        return ok({ ...output, events: Boolean(this.deps.noteOutputInterest) });
      }
    }
    const transcript = await this.deps.claudeTranscriptPath(agent);
    if (transcript) {
      const output = await readClaudeTranscript(transcript);
      if (output) return ok({ ...output, push: this.deps.watchOutput?.(agentId, transcript) ?? false });
    }
    if (agent.terminalId && ctx.orca.host.has("terminal.read")) {
      const result = await ctx.orca.host.call("terminal.read", { terminalId: agent.terminalId, maxLines: 400 });
      this.deps.noteOutputInterest?.(agentId);
      return ok({ kind: "lines", source: "terminal", lines: result.lines.map((line) => redact(stripAnsi(line))), truncated: result.truncated, events: Boolean(this.deps.noteOutputInterest) });
    }
    return fail("unavailable", "Orca exposes no output for this agent.");
  }
  /**
   * Sends a prompt where Orca allows it: typed into the agent's terminal, or as an orchestration
   * message to a worker (coordinator rules apply). Chat sessions and subagents have no API.
   */
  async prompt(agentId, rawText, attachmentIds = []) {
    const { ctx } = this.deps;
    const agent = ctx.store.read().agents[agentId];
    if (!agent) return fail("not_found", "That agent is no longer known.");
    if (!rawText.trim() && !attachmentIds.length) return fail("invalid_params", "The message is empty.");
    if (agent.role === "subagent") return fail("unsupported", "A subagent only takes its brief from its parent. Send your message to the parent agent instead.");
    const paths = [];
    for (const id of attachmentIds) {
      const path = this.deps.attachments?.pathFor(id);
      if (!path) return fail("not_found", "An attached image is no longer available; attach it again.");
      paths.push(path);
    }
    const route = chatSessionIdFromPaneKey(agent.paneKey) && !agent.terminalId ? "chat" : agent.agent === "claude" || agent.agent === null ? "claude-terminal" : "other";
    const text = [rawText.trim(), ...paths.map((path) => mentionFor(path, route))].filter(Boolean).join(" ");
    if (agent.terminalId && ctx.orca.host.has("terminal.sendText")) {
      const result = await ctx.orca.host.call("terminal.sendText", { terminalId: agent.terminalId, text, enter: true });
      return result.accepted ? ok({ via: "terminal", delivered: true }) : fail("action_failed", "Orca did not accept the text for that terminal.");
    }
    const chatSession = chatSessionIdFromPaneKey(agent.paneKey);
    if (chatSession) {
      if (!this.deps.settings().chatSend || !this.deps.sendChat) return fail("unsupported", "Sending into chat sessions is turned off in Agent Flow settings.");
      try {
        await this.deps.sendChat(chatSession, text);
        return ok({ via: "chat-session", delivered: true });
      } catch (error) {
        const err = error;
        return fail(err.code ?? "action_failed", `Orca did not take the message: ${redact(err.message)}`);
      }
    }
    if (agent.dispatchId && agent.runId) {
      const response = await this.coordinatorCommand({ requestId: "internal-prompt", kind: "message.send", params: { runId: agent.runId, to: `dispatch:${agent.dispatchId}`, subject: "Message from Agent Flow", body: text } });
      return response.ok ? ok({ via: "orchestration-message", delivered: true }) : response;
    }
    return fail("unsupported", "Orca has no API for plugins to send a message into a chat session. Open the session in Orca and type there.");
  }
  /** One image from a Claude transcript, in chunks that fit Orca's panel answer limit. */
  async image(agentId, ref, offset) {
    const agent = this.deps.ctx.store.read().agents[agentId];
    if (!agent) return fail("not_found", "That agent is no longer known.");
    const path = await this.deps.claudeTranscriptPath(agent);
    if (!path) return fail("unavailable", "No transcript with images for this agent.");
    const image = await readClaudeImage(path, ref);
    if (!image) return fail("not_found", "That image is no longer in the transcript.");
    const chunk = image.data.slice(offset, offset + IMAGE_CHUNK);
    return ok({ mediaType: image.mediaType, total: image.data.length, offset, chunk });
  }
  async stopAgent(agentId) {
    const { ctx } = this.deps;
    const agent = ctx.store.read().agents[agentId];
    if (!agent) return fail("not_found", "That agent is no longer known.");
    if (agent.dispatchId) {
      const result = await ctx.cli.run(["orchestration", "worker-stop", "--dispatch", agent.dispatchId]);
      return result.ok ? ok(result.result) : fail(result.code, result.message);
    }
    if (agent.terminalId && this.deps.ownTerminals.has(agent.terminalId) && ctx.orca.host.has("terminal.close")) {
      return ok(await ctx.orca.host.call("terminal.close", { terminalId: agent.terminalId }));
    }
    return fail("not_permitted", "Orca lets plugins stop orchestration workers and terminals Agent Flow opened. Stop this agent from its own tab.");
  }
  async cancelTask(taskId, runId) {
    const { ctx } = this.deps;
    const task = ctx.store.read().tasks[taskId];
    if (!task || task.runId !== runId) return fail("not_found", "That task is not in this run.");
    const live = task.dispatchIds.map((id) => ctx.store.read().agents[`dispatch:${id}`]).filter((agent) => agent?.live);
    const stopped = [];
    for (const agent of live) {
      const result = await ctx.cli.run(["orchestration", "worker-stop", "--dispatch", agent.dispatchId]);
      if (!result.ok) return fail(result.code, `Could not stop ${agent.title ?? agent.dispatchId}: ${result.message}`);
      stopped.push(agent.dispatchId);
    }
    const update = await this.coordinatorCommand({ requestId: "internal", kind: "task.update", params: { taskId, runId, status: "failed", result: "cancelled" } });
    if (update.ok) return ok({ stopped, marked: true });
    return { ok: false, error: { code: update.error.code, message: `Stopped ${stopped.length} worker(s). ${update.error.message}` }, manual: update.manual };
  }
  async coordinatorCommand(request) {
    const { ctx } = this.deps;
    const runId = String(request.params.runId ?? "");
    const run = runId ? ctx.store.read().runs[runId] : void 0;
    const args = coordinatorArgs(request, ctx.store.read());
    if (!args) return fail("invalid_params", "That command needs a known run and task.");
    const display = `orca ${args.map(shellQuote).join(" ")}`;
    if (!this.deps.settings().actAsCoordinator || !run?.coordinatorHandle) {
      const reason = run?.coordinatorHandle ? "Orca only lets a Run\u2019s coordinator do this. Run this in the coordinator, or turn on \u201CAct as coordinator\u201D in Agent Flow settings." : "Orca only lets a Run\u2019s coordinator do this. This Run\u2019s coordinator has no terminal handle (it is a chat session, or Orca did not record one), so paste this command into the coordinator.";
      return { ok: false, error: { code: "coordinator_required", message: reason }, manual: { command: display, reason } };
    }
    const result = await ctx.cli.run([...args, `--from=${run.coordinatorHandle}`], { timeoutMs: 9e4 });
    return result.ok ? ok(result.result) : { ok: false, error: { code: result.code, message: result.message }, manual: { command: display, reason: result.message } };
  }
  async inspect(path) {
    const state = this.deps.ctx.store.read();
    const known = Object.values(state.worktrees).some((w) => w.path === path) || Object.values(state.agents).some((a) => a.worktreePath === path);
    if (!known) return fail("not_permitted", "Agent Flow only inspects worktrees Orca knows about.");
    return ok(await inspectWorktree(path));
  }
};
function sanitizeColors(colors) {
  return Object.fromEntries(Object.entries(colors).filter(([, v]) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)));
}
function fitOutput(response, budget = OUTPUT_BUDGET) {
  if (!response.ok) return response;
  const result = response.result;
  if (result?.kind !== "conversation" || !Array.isArray(result.messages)) return response;
  let messages = result.messages;
  while (messages.length > 1 && Buffer.byteLength(JSON.stringify({ ...result, messages })) > budget) messages = messages.slice(Math.ceil(messages.length / 8));
  return messages === result.messages ? response : { ok: true, result: { ...result, messages, truncated: true } };
}
function withVersion(response) {
  if (!response.ok || !response.result || typeof response.result !== "object") return response;
  const version = createHash2("sha1").update(JSON.stringify(response.result)).digest("hex").slice(0, 16);
  return { ok: true, result: { ...response.result, version } };
}
function ok(result) {
  return { ok: true, result };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

// src/worker/dashboard/auth.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir as mkdir2, readFile as readFile5, writeFile as writeFile2 } from "node:fs/promises";
import { join as join7 } from "node:path";
var SECRET_KEY = "dashboardToken";
async function loadOrCreateToken(secrets, protection, dir) {
  const existing = useKeyring(secrets, protection) ? await secrets.get(SECRET_KEY).catch(() => null) : await readTokenFile(dir);
  if (existing && existing.length >= 32) return existing;
  return storeToken(secrets, protection, dir, newToken());
}
async function rotateToken(secrets, protection, dir) {
  return storeToken(secrets, protection, dir, newToken());
}
function useKeyring(secrets, protection) {
  return Boolean(secrets) && protection === "os-keyring";
}
function tokenFile(dir) {
  return join7(dir, "dashboard-token");
}
async function readTokenFile(dir) {
  try {
    return (await readFile5(tokenFile(dir), "utf8")).trim();
  } catch {
    return null;
  }
}
async function storeToken(secrets, protection, dir, token) {
  if (useKeyring(secrets, protection)) {
    await secrets.set(SECRET_KEY, token);
    return token;
  }
  await mkdir2(dir, { recursive: true, mode: 448 });
  await writeFile2(tokenFile(dir), token, { mode: 384 });
  await chmod(tokenFile(dir), 384);
  return token;
}
function newToken() {
  return randomBytes(32).toString("hex");
}
function tokensMatch(expected, given) {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
function hostAllowed(hostHeader, port) {
  if (!hostHeader) return false;
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}` || hostHeader === `[::1]:${port}`;
}

// src/worker/dashboard/server.ts
import { createServer } from "node:http";
import { readFile as readFile6, stat as stat5 } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants as constants2 } from "node:zlib";
import { extname, resolve as resolve2, sep } from "node:path";
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
var STATIC_FILES = /* @__PURE__ */ new Set(["dashboard.html", "app.js", "app.css", "icon.svg", "layout-worker.js"]);
var CHUNK_FILE = /^chunks\/[A-Za-z0-9_-]{1,80}\.js$/;
var MAX_BODY = 128 * 1024;
var MAX_DRAIN = 4 * 1024 * 1024;
var MAX_CLIENTS = 8;
var brotli = promisify(brotliCompress);
var DashboardServer = class {
  constructor(deps) {
    this.deps = deps;
  }
  server = null;
  clients = /* @__PURE__ */ new Set();
  unsubscribe = null;
  unsubscribeOutput = null;
  boundPort = null;
  get url() {
    return this.boundPort ? `http://127.0.0.1:${this.boundPort}/#token=${this.deps.token}` : null;
  }
  async start() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = this.deps.port + attempt;
      try {
        await this.listen(port);
        this.boundPort = port;
        this.unsubscribe = this.deps.subscribe((delta) => this.broadcast("delta", delta));
        this.unsubscribeOutput = this.deps.subscribeOutput?.((agentId) => this.broadcast("output", { agentId })) ?? null;
        this.deps.log(`dashboard listening on 127.0.0.1:${port}`);
        return;
      } catch (error) {
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw new Error(`No free port from ${this.deps.port} to ${this.deps.port + 9}.`);
  }
  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeOutput?.();
    this.unsubscribeOutput = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
    await new Promise((resolve3) => this.server ? this.server.close(() => resolve3()) : resolve3());
    this.server = null;
    this.boundPort = null;
  }
  listen(port) {
    return new Promise((resolve3, reject) => {
      const server = createServer((req, res) => void this.route(req, res, port));
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve3();
      });
    });
  }
  async route(req, res, port) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    if (!hostAllowed(req.headers.host, port)) return send(res, 421, "Wrong host");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (url.pathname.startsWith("/api/")) return await this.api(req, res, url, port);
      if (req.method !== "GET") return send(res, 405, "Method not allowed");
      return await this.serveStatic(res, url.pathname, acceptsBrotli(req.headers["accept-encoding"]));
    } catch (error) {
      this.deps.log(`dashboard error: ${error.message}`);
      if (!res.headersSent) send(res, 500, "Internal error");
    }
  }
  async api(req, res, url, port) {
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!tokensMatch(this.deps.token, auth)) return sendJson(res, 401, { ok: false, error: { code: "unauthorized", message: "Missing or wrong token." } });
    if (url.pathname === "/api/snapshot" && req.method === "GET") return sendJson(res, 200, this.deps.snapshot());
    if (url.pathname === "/api/events" && req.method === "GET") return this.openStream(req, res);
    if (url.pathname === "/api/command" && req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return sendJson(res, 403, { ok: false, error: { code: "forbidden", message: "Cross-origin request refused." } });
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return sendJson(res, 415, { ok: false, error: { code: "unsupported_media", message: "Send JSON." } });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return sendJson(res, 413, { ok: false, error: { code: "too_large", message: "Request body too large." } });
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { ok: false, error: { code: "invalid_params", message: "Body is not JSON." } });
      }
      const controls = this.deps.allowControls();
      const result = await this.deps.command(parsed, (kind) => kind !== "dashboard.enable" && kind !== "dashboard.controls" && (controls || READ_ONLY_COMMANDS.has(kind)));
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { ok: false, error: { code: "not_found", message: "No such endpoint." } });
  }
  openStream(req, res) {
    if (this.clients.size >= MAX_CLIENTS) return sendJson(res, 429, { ok: false, error: { code: "too_many_clients", message: "Too many dashboards open." } });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`event: hello
data: {}

`);
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(`: ping

`), 15e3);
    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }
  broadcast(event, data) {
    if (!this.clients.size) return;
    const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
    for (const client of this.clients) client.write(payload);
  }
  brotliCache = /* @__PURE__ */ new Map();
  /** Brotli copy of a text file, made on first request and reused until the file changes. */
  async compressed(file) {
    if (!/\.(js|css|html|svg)$/.test(file)) return null;
    const mtime = (await stat5(file)).mtimeMs;
    const hit = this.brotliCache.get(file);
    if (hit && hit.mtime === mtime) return hit.data;
    const data = readFile6(file).then((raw) => brotli(raw, { params: { [constants2.BROTLI_PARAM_QUALITY]: 9, [constants2.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
    this.brotliCache.set(file, { mtime, data });
    data.catch(() => this.brotliCache.delete(file));
    return data;
  }
  async serveStatic(res, pathname, brotli2) {
    const name = pathname === "/" ? "dashboard.html" : pathname.replace(/^\/+/, "");
    if (!STATIC_FILES.has(name) && !CHUNK_FILE.test(name)) return send(res, 404, "Not found");
    const root = resolve2(this.deps.uiDir);
    const file = resolve2(root, name);
    if (!file.startsWith(root + sep)) return send(res, 404, "Not found");
    let data;
    let encoded = false;
    try {
      const compressed = brotli2 ? await this.compressed(file) : null;
      if (compressed) {
        data = compressed;
        encoded = true;
      } else data = await readFile6(file);
    } catch {
      return send(res, 404, "Not found");
    }
    res.writeHead(200, {
      ...encoded ? { "Content-Encoding": "br" } : {},
      Vary: "Accept-Encoding",
      "Content-Type": MIME[extname(name)] ?? "application/octet-stream",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Frame-Options": "DENY",
      // Hashed chunks never change; everything else is re-checked so a rebuild shows up on reload.
      "Cache-Control": CHUNK_FILE.test(name) ? "public, max-age=31536000, immutable" : "no-cache"
    });
    res.end(data);
  }
};
function acceptsBrotli(header) {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return value.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    if (name.trim().toLowerCase() !== "br") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}
function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
function readBody(req) {
  return new Promise((resolve3, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_DRAIN) req.destroy();
      else if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => size > MAX_BODY ? reject(new Error("Body too large")) : resolve3(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// src/worker/state/history-recorder.ts
var HistoryRecorder = class {
  constructor(store, persistence, log) {
    this.store = store;
    this.persistence = persistence;
    this.log = log;
  }
  savedVersion = /* @__PURE__ */ new Map();
  async saveChangedRuns() {
    const state = this.store.read();
    for (const run of Object.values(state.runs)) {
      const tasks = Object.values(state.tasks).filter((task) => task.runId === run.id);
      if (!tasks.length) continue;
      const agents = Object.values(state.agents).filter((agent) => agent.runId === run.id);
      const fingerprint = `${run.version}|${run.state}|${tasks.map((t) => t.version).join(",")}|${agents.map((a) => a.version).join(",")}`;
      if (this.savedVersion.get(run.id) === fingerprint) continue;
      const ids = /* @__PURE__ */ new Set([run.id, ...tasks.map((t) => t.id), ...agents.map((a) => a.id)]);
      const record = {
        version: 1,
        savedAt: Date.now(),
        run,
        tasks,
        agents,
        messages: state.messages.filter((message) => message.runId === run.id),
        events: this.store.events().filter((event) => event.runId === run.id || ids.has(event.entityId))
      };
      try {
        await this.persistence.saveRun(record);
        this.savedVersion.set(run.id, fingerprint);
      } catch (error) {
        this.log(`history save failed for ${run.id}: ${error.message}`);
      }
    }
  }
};

// src/worker/git/repo-root.ts
import { readFile as readFile7, stat as stat6 } from "node:fs/promises";
import { join as join8 } from "node:path";
var cache = /* @__PURE__ */ new Map();
async function repoRootOf(worktreePath) {
  if (cache.has(worktreePath)) return cache.get(worktreePath);
  let root = null;
  try {
    const dotGit = join8(worktreePath, ".git");
    const info = await stat6(dotGit);
    if (info.isDirectory()) root = worktreePath;
    else {
      const text = await readFile7(dotGit, "utf8");
      const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim();
      const marker = gitdir ? gitdir.lastIndexOf("/.git/") : -1;
      if (gitdir && marker > 0) root = gitdir.slice(0, marker);
    }
  } catch {
    root = null;
  }
  cache.set(worktreePath, root);
  if (cache.size > 2e3) cache.delete(cache.keys().next().value);
  return root;
}

// src/worker/state/persistence.ts
import { mkdir as mkdir3, readdir as readdir4, readFile as readFile8, rename, rm, stat as stat7, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir6, platform as platform4 } from "node:os";
import { join as join9 } from "node:path";
var MAX_RUNS2 = 60;
var MAX_RUN_EVENTS = 2e3;
var SNAPSHOT_FILE = "snapshot.json";
var PRUNE_EVERY = 10;
function stateDir() {
  const home = homedir6();
  if (platform4() === "darwin") return join9(home, "Library/Application Support/orca-agent-flow");
  if (platform4() === "win32") return join9(process.env.APPDATA ?? join9(home, "AppData/Roaming"), "orca-agent-flow");
  return join9(process.env.XDG_STATE_HOME ?? join9(home, ".local/state"), "orca-agent-flow");
}
var Persistence = class {
  constructor(dir = stateDir()) {
    this.dir = dir;
    this.historyDir = join9(dir, "history");
  }
  historyDir;
  savesSincePrune = 0;
  async init() {
    await mkdir3(this.historyDir, { recursive: true, mode: 448 });
  }
  async loadSnapshot() {
    try {
      const parsed = JSON.parse(await readFile8(join9(this.dir, SNAPSHOT_FILE), "utf8"));
      return parsed?.state && typeof parsed.state.seq === "number" ? parsed : null;
    } catch {
      return null;
    }
  }
  async saveSnapshot(snapshot) {
    await atomicWrite(join9(this.dir, SNAPSHOT_FILE), JSON.stringify(snapshot));
  }
  async saveRun(record) {
    const trimmed = { ...record, events: record.events.slice(-MAX_RUN_EVENTS) };
    await atomicWrite(join9(this.historyDir, `${safeName(record.run.id)}.json`), JSON.stringify(trimmed));
    if (this.savesSincePrune++ % PRUNE_EVERY === 0) await this.prune();
  }
  async listRuns() {
    const out = [];
    for (const name of await this.files()) {
      try {
        const record = JSON.parse(await readFile8(join9(this.historyDir, name), "utf8"));
        const { id, objective, state, startedAt, endedAt, taskCount } = record.run;
        out.push({ id, objective, state, startedAt, endedAt, taskCount, savedAt: record.savedAt });
      } catch {
      }
    }
    return out.sort((a, b) => (b.startedAt ?? b.savedAt) - (a.startedAt ?? a.savedAt)).slice(0, MAX_RUNS2);
  }
  async loadRun(runId) {
    try {
      return JSON.parse(await readFile8(join9(this.historyDir, `${safeName(runId)}.json`), "utf8"));
    } catch {
      return null;
    }
  }
  async files() {
    try {
      return (await readdir4(this.historyDir)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }
  async prune() {
    const names = await this.files();
    if (names.length <= MAX_RUNS2) return;
    const withTimes = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat7(join9(this.historyDir, name))).mtimeMs })));
    withTimes.sort((a, b) => a.mtime - b.mtime);
    for (const { name } of withTimes.slice(0, names.length - MAX_RUNS2)) await rm(join9(this.historyDir, name), { force: true });
  }
};
function safeName(id) {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}
async function atomicWrite(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile3(tmp, data, { mode: 384 });
  await rename(tmp, path);
}

// src/shared/events.ts
var MAX_MESSAGES = 300;
var MAX_TOOL_CALLS = 300;
var MAX_TIMELINE = 1e3;
function applyPatch(state, patch) {
  switch (patch.entity) {
    case "agent":
      setOrDelete(state.agents, patch.id, patch.value);
      break;
    case "task":
      setOrDelete(state.tasks, patch.id, patch.value);
      break;
    case "run":
      setOrDelete(state.runs, patch.id, patch.value);
      break;
    case "gate":
      setOrDelete(state.gates, patch.id, patch.value);
      break;
    case "worktree":
      setOrDelete(state.worktrees, patch.id, patch.value);
      break;
    case "account":
      setOrDelete(state.accounts, patch.id, patch.value);
      break;
    case "project":
      state.projects ??= {};
      setOrDelete(state.projects, patch.id, patch.value);
      break;
    case "message": {
      const index = state.messages.findIndex((message) => message.id === patch.id);
      if (index >= 0) state.messages[index] = patch.value;
      else state.messages.push(patch.value);
      if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
      break;
    }
    case "toolCall": {
      const index = state.toolCalls.findIndex((call) => call.id === patch.id);
      if (index >= 0) state.toolCalls[index] = patch.value;
      else state.toolCalls.push(patch.value);
      if (state.toolCalls.length > MAX_TOOL_CALLS) state.toolCalls.splice(0, state.toolCalls.length - MAX_TOOL_CALLS);
      break;
    }
    case "capabilities":
      state.capabilities = patch.value;
      break;
    case "labels":
      state.labels = patch.value;
      break;
  }
}
function setOrDelete(map, id, value) {
  if (value === null) delete map[id];
  else map[id] = value;
}

// src/worker/state/store.ts
var DEDUPE_LIMIT = 5e3;
var STATE_KEYS = /* @__PURE__ */ new Set(["state", "live", "outcome", "stateSince", "endedAt"]);
var FlowStore = class {
  constructor(flushMs = 250) {
    this.flushMs = flushMs;
  }
  state = emptyState();
  timeline = [];
  pendingPatches = /* @__PURE__ */ new Map();
  pendingEvents = [];
  pendingFromSeq = 0;
  listeners = /* @__PURE__ */ new Set();
  seenEventIds = /* @__PURE__ */ new Set();
  /** observedAt of the last accepted state per agent, so an older poll never overwrites a newer event. */
  agentObservedAt = /* @__PURE__ */ new Map();
  flushTimer = null;
  eventCounter = 0;
  get seq() {
    return this.state.seq;
  }
  read() {
    return this.state;
  }
  snapshot() {
    this.flushNow();
    return { state: structuredClone(this.state), events: this.timeline.slice(-MAX_TIMELINE) };
  }
  events() {
    return this.timeline;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Restores a persisted snapshot; live adapters re-confirm everything afterwards. */
  restore(snapshot) {
    const restored = snapshot.state;
    for (const agent of Object.values(restored.agents)) {
      agent.live = false;
      if (agent.state === "working" || agent.state === "blocked" || agent.state === "waiting") agent.state = "unknown";
    }
    this.state = { ...restored, projects: restored.projects ?? {}, labels: { ...EMPTY_LABELS, ...restored.labels }, seq: Math.max(restored.seq, this.state.seq) + 1 };
    this.timeline = snapshot.events.slice(-MAX_TIMELINE);
    for (const event of this.timeline) this.seenEventIds.add(event.id);
    this.emitReset();
  }
  /** Merges an agent observation. `observedAt` orders competing sources. */
  upsertAgent(id, observedAt, partial, create) {
    const existing = this.state.agents[id];
    const base = existing ?? create();
    const next = { ...base };
    const touchesState = Object.keys(partial).some((key) => STATE_KEYS.has(key) && partial[key] !== void 0);
    const lastObserved = this.agentObservedAt.get(id) ?? 0;
    const stale = touchesState && observedAt < lastObserved;
    for (const [key, value] of Object.entries(partial)) {
      if (value === void 0 || key === "evidence") continue;
      if (stale && STATE_KEYS.has(key)) continue;
      next[key] = value;
    }
    if (partial.evidence) next.evidence = [.../* @__PURE__ */ new Set([...base.evidence ?? [], ...partial.evidence])];
    next.lastSeenAt = Math.max(base.lastSeenAt ?? 0, observedAt);
    if (touchesState && !stale) this.agentObservedAt.set(id, observedAt);
    if (existing && sameRecord(existing, next)) return existing;
    next.version = (base.version ?? 0) + 1;
    this.patch({ entity: "agent", id, value: next });
    return next;
  }
  upsertTask(task) {
    const existing = this.state.tasks[task.id];
    if (existing && sameRecord(existing, { ...task, version: existing.version })) return existing;
    const next = { ...task, version: (existing?.version ?? 0) + 1 };
    this.patch({ entity: "task", id: task.id, value: next });
    return next;
  }
  /** Generic upsert for records compared by content. */
  put(patch) {
    const current = this.currentValue(patch);
    if (current !== void 0 && patch.value !== null && sameRecord(current, patch.value)) return;
    if (current === void 0 && patch.value === null) return;
    this.patch(patch);
  }
  removeAgent(id) {
    if (!this.state.agents[id]) return;
    this.agentObservedAt.delete(id);
    this.patch({ entity: "agent", id, value: null });
  }
  emit(input) {
    const id = input.id ?? `${input.kind}:${input.entityId}:${input.ts}:${++this.eventCounter}`;
    if (this.seenEventIds.has(id)) return null;
    this.seenEventIds.add(id);
    if (this.seenEventIds.size > DEDUPE_LIMIT) {
      const first = this.seenEventIds.values().next().value;
      if (first !== void 0) this.seenEventIds.delete(first);
    }
    const event = { ...input, id, seq: this.bumpSeq() };
    this.timeline.push(event);
    if (this.timeline.length > MAX_TIMELINE * 2) this.timeline.splice(0, this.timeline.length - MAX_TIMELINE);
    this.pendingEvents.push(event);
    this.scheduleFlush();
    return event;
  }
  hasEvent(kind, entityId) {
    return this.timeline.some((event) => event.kind === kind && event.entityId === entityId);
  }
  flushNow() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingPatches.size === 0 && this.pendingEvents.length === 0) return;
    const delta = {
      fromSeq: this.pendingFromSeq,
      toSeq: this.state.seq,
      patches: [...this.pendingPatches.values()],
      events: this.pendingEvents
    };
    this.pendingPatches = /* @__PURE__ */ new Map();
    this.pendingEvents = [];
    this.pendingFromSeq = this.state.seq;
    for (const listener of this.listeners) {
      try {
        listener(delta);
      } catch {
      }
    }
  }
  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listeners.clear();
  }
  patch(patch) {
    applyPatch(this.state, patch);
    this.bumpSeq();
    this.pendingPatches.set(`${patch.entity}:${patch.id}`, patch);
    this.scheduleFlush();
  }
  bumpSeq() {
    if (this.pendingPatches.size === 0 && this.pendingEvents.length === 0 && !this.flushTimer) this.pendingFromSeq = this.state.seq;
    this.state.seq += 1;
    this.state.generatedAt = Date.now();
    return this.state.seq;
  }
  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, this.flushMs);
  }
  /** Tells every client to re-snapshot (fromSeq that can never match). */
  emitReset() {
    const delta = { fromSeq: -1, toSeq: this.state.seq, patches: [], events: [] };
    this.pendingFromSeq = this.state.seq;
    for (const listener of this.listeners) listener(delta);
  }
  currentValue(patch) {
    switch (patch.entity) {
      case "agent":
        return this.state.agents[patch.id];
      case "task":
        return this.state.tasks[patch.id];
      case "run":
        return this.state.runs[patch.id];
      case "gate":
        return this.state.gates[patch.id];
      case "worktree":
        return this.state.worktrees[patch.id];
      case "account":
        return this.state.accounts[patch.id];
      case "project":
        return this.state.projects?.[patch.id];
      case "message":
        return this.state.messages.find((message) => message.id === patch.id);
      case "toolCall":
        return this.state.toolCalls.find((call) => call.id === patch.id);
      case "capabilities":
        return this.state.capabilities;
      case "labels":
        return this.state.labels;
    }
  }
};
function sameRecord(a, b) {
  const strip = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { version: _version, lastSeenAt: _lastSeen, ...rest } = value;
      return rest;
    }
    return value;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// src/worker/state/viewers.ts
var VIEWER_IDLE_MS = 75e3;
var ViewerTracker = class {
  constructor(now, idleAfterMs = VIEWER_IDLE_MS) {
    this.now = now;
    this.idleAfterMs = idleAfterMs;
  }
  lastSeen = Number.NEGATIVE_INFINITY;
  /** Records activity. Returns true when this ends an idle stretch (time to refresh right away). */
  touch() {
    const wasIdle = this.idle;
    this.lastSeen = this.now();
    return wasIdle;
  }
  get idle() {
    return this.now() - this.lastSeen > this.idleAfterMs;
  }
  /** The fast interval while watched, the slow one otherwise. */
  pace(watchedMs, idleMs) {
    return this.idle ? idleMs : watchedMs;
  }
};

// src/worker/commands/output-watcher.ts
import { watch } from "node:fs";
var nodeWatch = (path, onChange) => watch(path, { persistent: false }, onChange);
var OutputWatcher = class {
  constructor(options = {}) {
    this.options = options;
  }
  watches = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  /** Agents without a transcript file (terminal output): when a view last read them. */
  interested = /* @__PURE__ */ new Map();
  get now() {
    return this.options.now ?? Date.now;
  }
  /** A view read this agent's transcript. Returns true when changes will be pushed. */
  track(agentId, path) {
    const now = this.now();
    this.sweep(now);
    const existing = this.watches.get(agentId);
    if (existing && existing.path === path) {
      existing.lastRead = now;
      return true;
    }
    if (existing) this.untrack(agentId);
    const max = this.options.max ?? 8;
    while (this.watches.size >= max) {
      const oldest = [...this.watches.entries()].sort((a, b) => a[1].lastRead - b[1].lastRead)[0];
      this.untrack(oldest[0]);
    }
    let watcher;
    try {
      watcher = (this.options.watchFile ?? nodeWatch)(path, () => this.changed(agentId));
    } catch {
      return false;
    }
    watcher.on?.("error", () => this.untrack(agentId));
    this.watches.set(agentId, { path, watcher, lastRead: now, timer: null });
    return true;
  }
  /** A view read output that has no file to watch (a terminal); events can still announce changes. */
  noteInterest(agentId) {
    const entry = this.interested.get(agentId);
    if (entry) entry.lastRead = this.now();
    else this.interested.set(agentId, { lastRead: this.now(), timer: null });
    if (this.interested.size > (this.options.max ?? 8) * 4) {
      const oldest = [...this.interested.entries()].sort((a, b) => a[1].lastRead - b[1].lastRead)[0];
      this.dropInterest(oldest[0]);
    }
  }
  /** Something happened to this agent (status change, tool call): tell views showing it. */
  poke(agentId) {
    const entry = this.interested.get(agentId);
    if (!entry) return;
    if (this.now() - entry.lastRead > (this.options.idleMs ?? 6e4)) {
      this.dropInterest(agentId);
      return;
    }
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!this.interested.has(agentId)) return;
      for (const listener of this.listeners) listener(agentId);
    }, this.options.debounceMs ?? 250);
  }
  dropInterest(agentId) {
    const entry = this.interested.get(agentId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.interested.delete(agentId);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get size() {
    return this.watches.size;
  }
  dispose() {
    for (const id of [...this.watches.keys()]) this.untrack(id);
    for (const id of [...this.interested.keys()]) this.dropInterest(id);
    this.listeners.clear();
  }
  changed(agentId) {
    const entry = this.watches.get(agentId);
    if (!entry) return;
    if (this.now() - entry.lastRead > (this.options.idleMs ?? 6e4)) {
      this.untrack(agentId);
      return;
    }
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!this.watches.has(agentId)) return;
      for (const listener of this.listeners) listener(agentId);
    }, this.options.debounceMs ?? 250);
  }
  sweep(now) {
    const idleMs = this.options.idleMs ?? 6e4;
    for (const [id, entry] of this.watches) if (now - entry.lastRead > idleMs) this.untrack(id);
  }
  untrack(agentId) {
    const entry = this.watches.get(agentId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch {
    }
    this.watches.delete(agentId);
  }
};

// src/worker/state/star-prompt.ts
import { mkdir as mkdir4, readFile as readFile9, rename as rename2, writeFile as writeFile4 } from "node:fs/promises";
import { join as join10 } from "node:path";
var STAR_REPO_URL = "https://github.com/SokpisethNhoeun/agent-flow";
var DAY_MS = 24 * 60 * 60 * 1e3;
var MIN_DAYS_USED = 3;
var MIN_AGE_MS = 3 * DAY_MS;
var SNOOZE_MS = 30 * DAY_MS;
var freshStarState = (now) => ({ firstSeen: now, days: [], snoozeUntil: 0, done: false });
function dayOf(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function recordVisit(state, now) {
  const day = dayOf(now);
  return state.days.includes(day) ? state : { ...state, days: [...state.days, day].slice(-10) };
}
function shouldAsk(state, now) {
  return !state.done && now >= state.snoozeUntil && state.days.length >= MIN_DAYS_USED && now - state.firstSeen >= MIN_AGE_MS;
}
function applyAnswer(state, answer, now) {
  return answer === "later" ? { ...state, snoozeUntil: now + SNOOZE_MS } : { ...state, done: true };
}
var StarPromptStore = class {
  constructor(dir, now = Date.now) {
    this.dir = dir;
    this.now = now;
    this.file = join10(dir, "star-prompt.json");
  }
  state = null;
  file;
  /** Records today's visit and says whether to show the prompt now. */
  async visit() {
    const state = recordVisit(await this.load(), this.now());
    await this.save(state);
    return { show: shouldAsk(state, this.now()), url: STAR_REPO_URL };
  }
  async answer(answer) {
    await this.save(applyAnswer(await this.load(), answer, this.now()));
  }
  async load() {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(await readFile9(this.file, "utf8"));
      this.state = {
        firstSeen: typeof raw.firstSeen === "number" ? raw.firstSeen : this.now(),
        days: Array.isArray(raw.days) ? raw.days.filter((d) => typeof d === "string").slice(-10) : [],
        snoozeUntil: typeof raw.snoozeUntil === "number" ? raw.snoozeUntil : 0,
        done: raw.done === true
      };
    } catch {
      this.state = freshStarState(this.now());
    }
    return this.state;
  }
  async save(state) {
    if (JSON.stringify(state) === JSON.stringify(this.state) && this.state) return;
    this.state = state;
    await mkdir4(this.dir, { recursive: true, mode: 448 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile4(tmp, JSON.stringify(state), { mode: 384 });
    await rename2(tmp, this.file);
  }
};

// src/worker/update/update-check.ts
import { readFile as readFile10 } from "node:fs/promises";
import { join as join11 } from "node:path";
var CHECK_EVERY_MS = 6 * 60 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 8e3;
function installedKey(rootDir) {
  const match = rootDir.match(/[\\/]plugins[\\/]([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*)(?:[\\/]|$)/i);
  return match && !match[1].startsWith("local.") ? match[1] : null;
}
function githubRepo(url) {
  const match = url?.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = v.replace(/^v/i, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  return x.pre === null ? 1 : y.pre === null ? -1 : x.pre < y.pre ? -1 : 1;
}
var UpdateChecker = class {
  constructor(rootDir, enabled, fetcher = fetch, now = Date.now) {
    this.rootDir = rootDir;
    this.enabled = enabled;
    this.fetcher = fetcher;
    this.now = now;
  }
  cached = null;
  manifest = null;
  async readManifest() {
    this.manifest ??= JSON.parse(await readFile10(join11(this.rootDir, "orca-plugin.json"), "utf8"));
    return this.manifest;
  }
  async check(force = false) {
    const manifest = await this.readManifest();
    const pluginKey = installedKey(this.rootDir);
    const base = { current: manifest.version, latest: null, newer: false, releaseUrl: null, pluginKey };
    const repo = githubRepo(manifest.repository);
    if (!pluginKey || !repo || !this.enabled()) return base;
    if (!force && this.cached && this.now() - this.cached.at < CHECK_EVERY_MS) return this.cached.info;
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "orca-agent-flow-update-check" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const release = await response.json();
      const tag = typeof release.tag_name === "string" && /^v?\d+\.\d+\.\d+/.test(release.tag_name) ? release.tag_name.replace(/^v/i, "") : null;
      const url = typeof release.html_url === "string" && release.html_url.startsWith(`https://github.com/${repo}/`) ? release.html_url : null;
      const info = { ...base, latest: tag, newer: Boolean(tag) && release.draft !== true && release.prerelease !== true && compareVersions(tag, manifest.version) > 0, releaseUrl: url };
      this.cached = { at: this.now(), info };
      return info;
    } catch {
      this.cached = { at: this.now() - CHECK_EVERY_MS + 30 * 60 * 1e3, info: base };
      return base;
    }
  }
  /** Runs `orca plugin update <key>`. A version that needs new access returns Orca's approve command instead. */
  async update(cli) {
    const key = installedKey(this.rootDir);
    if (!key) return { updated: false, approveCommand: null, reason: "This is a development copy; update it from its folder." };
    const result = await cli.run(["plugin", "update", key], { timeoutMs: 12e4 });
    if (result.ok) {
      this.cached = null;
      return { updated: true, version: typeof result.result?.version === "string" ? result.result.version : null };
    }
    const fingerprint = result.message.match(/--approve\s+(ap\d-[a-f0-9]{16,64})/)?.[1] ?? null;
    return {
      updated: false,
      approveCommand: fingerprint ? `orca plugin update ${key} --approve ${fingerprint}` : null,
      reason: result.code === "approval_required" || fingerprint ? "The new version asks for more access, so Orca needs your approval." : result.message
    };
  }
};

// src/worker/transport/snapshot-budget.ts
var PANEL_SNAPSHOT_BUDGET = 900 * 1024;
var bytes = (value) => Buffer.byteLength(JSON.stringify(value));
var read = (s, part) => part === "events" ? s.events : s.state[part];
var STEPS = [
  { part: "events", apply: (s) => ({ ...s, events: s.events.slice(-300) }) },
  { part: "toolCalls", apply: (s) => ({ ...s, state: { ...s.state, toolCalls: s.state.toolCalls.slice(-80) } }) },
  { part: "messages", apply: (s) => ({ ...s, state: { ...s.state, messages: s.state.messages.slice(-120).map((m) => ({ ...m, body: m.body ? truncate(m.body, 200) : null })) } }) },
  {
    part: "tasks",
    apply: (s) => ({
      ...s,
      state: {
        ...s.state,
        tasks: Object.fromEntries(
          Object.entries(s.state.tasks).map(([id, t]) => [id, { ...t, spec: t.spec ? truncate(t.spec, 300) : null, result: t.result ? { ...t.result, raw: null, message: t.result.message ? truncate(t.result.message, 400) : null } : null }])
        )
      }
    })
  },
  { part: "events", apply: (s) => ({ ...s, events: s.events.slice(-80) }) }
];
function fitSnapshot(snapshot, budget = PANEL_SNAPSHOT_BUDGET) {
  let total = bytes(snapshot);
  if (total <= budget) return snapshot;
  const sizes = /* @__PURE__ */ new Map();
  const sizeOf = (s, part) => {
    if (!sizes.has(part)) sizes.set(part, bytes(read(s, part)));
    return sizes.get(part);
  };
  let current = snapshot;
  for (const step of STEPS) {
    const before = sizeOf(current, step.part);
    current = step.apply(current);
    const after = bytes(read(current, step.part));
    sizes.set(step.part, after);
    total += after - before;
    if (total <= budget) return current;
  }
  return current;
}

// src/worker/transport/panel-bridge.ts
var MAX_POST_BYTES = 200 * 1024;
function connectPanels(panels, deps) {
  const disposers = [
    panels.handle("flow.snapshot", () => fitSnapshot(deps.snapshot())),
    panels.handle("flow.command", (input) => deps.command(input))
  ];
  const unsubscribe = deps.subscribe((delta) => {
    try {
      const json = JSON.stringify(delta);
      if (Buffer.byteLength(json) > MAX_POST_BYTES) panels.post("flow.resync", { toSeq: delta.toSeq });
      else panels.post("flow.delta", delta);
    } catch (error) {
      deps.log(`panel post failed: ${error.message}`);
    }
  });
  const unsubscribeOutput = deps.subscribeOutput?.((agentId) => {
    try {
      panels.post("flow.output", { agentId });
    } catch (error) {
      deps.log(`panel post failed: ${error.message}`);
    }
  });
  return () => {
    unsubscribe();
    unsubscribeOutput?.();
    for (const disposer of disposers) disposer.dispose();
  };
}

// src/worker/runtime.ts
var DEFAULT_SETTINGS = { dashboardEnabled: true, dashboardPort: 4790, dashboardControls: true, actAsCoordinator: true, cliPath: "", chatSend: true, checkUpdates: true };
var DASHBOARD_RETRIES = 5;
var PERSIST_MS = 12e3;
var SUBAGENT_ORPHAN_MS = 5 * 60 * 1e3;
var SUBAGENT_RETENTION_MS = 24 * 60 * 60 * 1e3;
var STANDALONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
var HOST_METHODS = ["workspace.list", "agents.list", "agent.listSessions", "terminal.read", "terminal.focus", "terminal.close", "terminal.sendText", "agent.launch", "agent.resume", "workspace.create", "workspace.open", "statusBar.update"];
var AgentFlowRuntime = class {
  constructor(orca) {
    this.orca = orca;
  }
  store = new FlowStore();
  identity = new IdentityIndex();
  persistence = new Persistence();
  viewers = new ViewerTracker(Date.now);
  outputWatcher = new OutputWatcher();
  settings = DEFAULT_SETTINGS;
  ownTerminals = /* @__PURE__ */ new Set();
  /** One pending timer per named loop, so nothing accumulates and stop() clears everything. */
  timers = /* @__PURE__ */ new Map();
  dashboardOp = Promise.resolve();
  disposers = [];
  dashboard = null;
  dashboardRetries = 0;
  ctx;
  agents;
  subagents;
  orchestration;
  accounts;
  sessions;
  subagentFiles;
  sessionModels;
  router;
  history;
  persistedSeq = -1;
  statusKey = "";
  stopped = false;
  async start() {
    const log = (message) => this.orca.log(`[agent-flow] ${message}`);
    this.settings = await this.readSettings();
    const cli = createCliRunner(await resolveCliPath(this.settings.cliPath || null));
    if (!cli.path) log("orca CLI not found; orchestration data and controls are off");
    this.ctx = { orca: this.orca, store: this.store, cli, identity: this.identity, now: Date.now, log };
    await this.persistence.init().catch((error) => log(`state folder: ${error.message}`));
    const saved = await this.persistence.loadSnapshot();
    if (saved) {
      this.store.restore(saved);
      const bySession = /* @__PURE__ */ new Map();
      for (const agent of Object.values(this.store.read().agents).sort((a, b) => b.lastSeenAt - a.lastSeenAt)) {
        if (!agent.sessionId || agent.role === "subagent") continue;
        if (bySession.has(agent.sessionId)) this.store.removeAgent(agent.id);
        else bySession.set(agent.sessionId, agent.id);
      }
      for (const agent of Object.values(this.store.read().agents)) {
        this.identity.link(agent.id, { terminalId: agent.terminalId, paneKey: agent.paneKey, sessionId: agent.sessionId, terminalHandle: agent.terminalHandle });
      }
      for (const agent of Object.values(this.store.read().agents)) if (agent.dispatchId) mergeDuplicatesOf(this.store, this.identity, agent.id);
    }
    await this.loadLabels();
    this.agents = new AgentsAdapter(this.ctx);
    this.subagents = new SubagentAdapter(this.ctx);
    this.orchestration = new OrchestrationAdapter(this.ctx);
    this.accounts = new AccountsAdapter(this.ctx);
    this.sessions = new SessionsAdapter(this.ctx);
    this.subagentFiles = new SubagentFilesAdapter(this.ctx, () => this.accounts.claudeHomes());
    this.sessionModels = new SessionModelAdapter(this.ctx, this.subagentFiles, () => this.accounts.codexHomes());
    this.history = new HistoryRecorder(this.store, this.persistence, log);
    this.router = new CommandRouter({
      ctx: this.ctx,
      persistence: this.persistence,
      ownTerminals: this.ownTerminals,
      settings: () => ({ actAsCoordinator: this.settings.actAsCoordinator, chatSend: this.settings.chatSend }),
      sendChat: (sessionId, text) => sendChatMessage(sessionId, text),
      updateLabels: (labels) => this.saveLabels(labels),
      dashboardInfo: () => ({ enabled: Boolean(this.dashboard), url: this.dashboard?.url ?? null }),
      refresh: () => this.kick(),
      fullText: (key) => this.orchestration.fullTextFor(key),
      claudeTranscriptPath: (agent) => this.subagentFiles.transcriptPathFor(agent),
      watchOutput: (agentId, path) => this.outputWatcher.track(agentId, path),
      noteOutputInterest: (agentId) => this.outputWatcher.noteInterest(agentId),
      attachments: new AttachmentStore(attachmentsRoot(stateDir())),
      starPrompt: new StarPromptStore(stateDir()),
      // The plugin folder is one level above dist/worker.mjs.
      updates: new UpdateChecker(fileURLToPath(new URL("..", import.meta.url)), () => this.settings.checkUpdates),
      setDashboardControls: async (enabled) => {
        await this.orca.settings.set("dashboardControls", enabled);
        this.settings = await this.readSettings();
        this.publishCapabilities();
        return { controls: this.settings.dashboardControls };
      },
      setDashboard: async (enabled) => {
        await this.orca.settings.set("dashboardEnabled", enabled);
        this.settings = await this.readSettings();
        await this.syncDashboard(enabled);
        return { enabled: Boolean(this.dashboard), url: this.dashboard?.url ?? null };
      }
    });
    this.disposers.push(this.outputWatcher.subscribe((agentId) => this.router.invalidateOutput(agentId)));
    const outputSignature = /* @__PURE__ */ new Map();
    this.disposers.push(
      this.store.subscribe((delta) => {
        for (const patch of delta.patches) {
          if (patch.entity === "agent" && patch.value) {
            const v = patch.value;
            const signature = `${v.state}|${v.live}|${v.outcome}|${v.messageCount}|${v.tokens}|${v.stateSince}`;
            if (outputSignature.get(v.id) === signature) continue;
            outputSignature.set(v.id, signature);
            if (outputSignature.size > 2e3) outputSignature.delete(outputSignature.keys().next().value);
            this.outputWatcher.poke(v.id);
          } else if (patch.entity === "toolCall" && patch.value.agentId) this.outputWatcher.poke(patch.value.agentId);
        }
      })
    );
    this.subscribeRuntime();
    this.disposers.push(
      connectPanels(this.orca.panels, {
        snapshot: () => {
          this.seen();
          return this.store.snapshot();
        },
        subscribe: (listener) => this.store.subscribe(listener),
        subscribeOutput: (listener) => this.outputWatcher.subscribe(listener),
        command: (input) => {
          this.seen();
          return this.router.handle(input);
        },
        log
      })
    );
    this.disposers.push(this.orca.settings.onDidChange(() => void this.onSettingsChanged()).dispose);
    this.disposers.push(this.orca.commands.register("agent-flow.showPanel", () => this.showPanel()).dispose);
    this.disposers.push(
      this.orca.commands.register(
        "agent-flow.dashboardLink",
        () => this.dashboard?.url ? `Open in your browser (keep the link private): ${this.dashboard.url}` : "The browser dashboard is off. Turn on \u201CBrowser dashboard\u201D under Agent Flow in Orca Settings."
      ).dispose
    );
    this.publishCapabilities();
    void this.initialPass();
  }
  async initialPass() {
    await this.syncDashboard(false);
    await this.agents.scan();
    await this.accounts.refresh();
    await this.orchestration.poll();
    await this.sessions.refresh();
    await this.subagentFiles.scan();
    await this.resolveRepoRoots();
    await this.sessionModels.refresh();
    this.accounts.applyToAgents();
    if (this.stopped) return;
    const pace = (watched, idle) => () => this.viewers.pace(watched, idle);
    this.loop("orchestration", async () => {
      await this.orchestration.poll();
      this.accounts.applyToAgents();
    }, () => this.orchestration.hasActiveWork ? this.viewers.pace(1500, 5e3) : this.viewers.pace(6e3, 3e4));
    this.loop("agents", () => this.agents.scan(), pace(1e4, 6e4));
    this.loop("accounts", async () => {
      await this.accounts.refresh();
      await this.sessions.refresh();
    }, pace(2e4, 12e4));
    this.loop("subagent-files", async () => {
      await this.subagentFiles.scan();
      await this.sessionModels.refresh();
    }, pace(5e3, 3e4));
    this.loop("repo-roots", () => this.resolveRepoRoots(), pace(15e3, 12e4));
    this.loop("persist", async () => {
      this.prune();
      await this.persist();
    }, () => PERSIST_MS);
    this.loop("status-bar", async () => this.updateStatusBar(), () => 3e3);
  }
  async stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.dashboardOp.catch(() => void 0);
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
      }
    }
    await this.dashboard?.stop();
    this.outputWatcher.dispose();
    await this.persist(true);
    this.store.dispose();
  }
  subscribeRuntime() {
    const { events, hooks } = this.orca;
    this.disposers.push(events.on("agent.status.changed", (event) => this.agents.onStatus(event)).dispose);
    this.disposers.push(events.on("workspace.created", () => void this.agents.scan()).dispose);
    this.disposers.push(events.on("workspace.removed", () => void this.agents.scan()).dispose);
    this.disposers.push(events.on("workspace.changed", () => void this.agents.scan()).dispose);
    this.disposers.push(
      hooks.on("agent.tool.before", (event) => {
        try {
          this.subagents.onToolBefore(event);
        } catch (error) {
          this.ctx.log(`tool.before: ${error.message}`);
        }
      }).dispose
    );
    this.disposers.push(
      hooks.on("agent.tool.after", (event) => {
        try {
          this.subagents.onToolAfter(event);
        } catch (error) {
          this.ctx.log(`tool.after: ${error.message}`);
        }
      }).dispose
    );
    this.disposers.push(
      hooks.on("agent.launch.before", (event) => {
        try {
          this.accounts.onLaunch(event);
        } catch (error) {
          this.ctx.log(`launch.before: ${error.message}`);
        }
      }).dispose
    );
  }
  loop(name, task, interval) {
    const tick = async () => {
      this.timers.delete(name);
      if (this.stopped) return;
      try {
        await task();
      } catch (error) {
        this.ctx.log(`${name} failed: ${error.message}`);
      }
      if (!this.stopped) this.timers.set(name, setTimeout(tick, interval()));
    };
    this.timers.set(name, setTimeout(tick, interval()));
  }
  /** A one-shot timer that stop() also clears; re-scheduling the same name replaces it. */
  once(name, ms, task) {
    const existing = this.timers.get(name);
    if (existing) clearTimeout(existing);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.stopped) void task().catch((error) => this.ctx.log(`${name} failed: ${error.message}`));
      }, ms)
    );
  }
  /** Which repository each agent's worktree belongs to, for exact project boxes. */
  async resolveRepoRoots() {
    for (const agent of Object.values(this.store.read().agents)) {
      if (!agent.worktreePath || agent.repoRoot !== void 0) continue;
      const repoRoot = await repoRootOf(agent.worktreePath);
      const current = this.store.read().agents[agent.id];
      if (current) this.store.upsertAgent(agent.id, current.lastSeenAt, { repoRoot }, () => current);
    }
  }
  /** Bounded memory: drop long-finished subagents and standalone agents (runs keep theirs in history). */
  prune() {
    const now = Date.now();
    for (const agent of Object.values(this.store.read().agents)) {
      if (agent.live) {
        const parent = agent.role === "subagent" && agent.parentId ? this.store.read().agents[agent.parentId] : void 0;
        const orphaned = agent.role === "subagent" && (!parent || !parent.live) && now - agent.lastSeenAt > SUBAGENT_ORPHAN_MS;
        if (orphaned) this.store.upsertAgent(agent.id, now, { live: false, state: "unknown", evidence: ["host-event"] }, () => agent);
        continue;
      }
      const age = now - agent.lastSeenAt;
      const stale = agent.role === "subagent" && age > SUBAGENT_RETENTION_MS || agent.role === "agent" && !agent.runId && age > STANDALONE_RETENTION_MS;
      if (stale) {
        this.store.removeAgent(agent.id);
        this.identity.unlinkAgent(agent.id);
      }
    }
  }
  /** After a command, look again soon so its effect shows up quickly. */
  /** A panel or the dashboard asked for something. After a quiet stretch, catch up at once. */
  seen() {
    if (!this.viewers.touch() || this.stopped) return;
    this.kick();
    this.once("wake-subagents", 800, async () => {
      await this.subagentFiles.scan();
      await this.sessionModels.refresh();
    });
    this.once("wake-accounts", 1200, async () => {
      await this.accounts.refresh();
      await this.sessions.refresh();
    });
  }
  kick() {
    this.once("kick-orchestration", 400, () => this.orchestration.poll());
    this.once("kick-agents", 600, () => this.agents.scan());
  }
  async persist(force = false) {
    if (!force && this.store.seq === this.persistedSeq) return;
    try {
      await this.persistence.saveSnapshot(this.store.snapshot());
      this.persistedSeq = this.store.seq;
      await this.history.saveChangedRuns();
    } catch (error) {
      this.ctx.log(`persist failed: ${error.message}`);
    }
  }
  /** Uses the documented `orca plugin open` to show this plugin's panel. */
  async showPanel() {
    const list = await this.ctx.cli.run(["plugin", "list"], { timeoutMs: 8e3 });
    if (!list.ok) return `Could not find the Agent Flow panel: ${list.message}`;
    const rows = Array.isArray(list.result) ? list.result : list.result.plugins ?? [];
    const key = rows.find((row) => row.id === "agent-flow" || row.key?.endsWith(".agent-flow"))?.key;
    if (!key) return "Agent Flow is not listed as installed.";
    const opened = await this.ctx.cli.run(["plugin", "open", key, "--panel", "flow"], { timeoutMs: 8e3 });
    return opened.ok ? "Agent Flow panel opened." : `Could not open the panel: ${opened.message}`;
  }
  updateStatusBar() {
    if (!this.orca.host.has("statusBar.update")) return;
    const agents = Object.values(this.store.read().agents);
    const running = agents.filter((agent) => agent.live && (agent.state === "working" || agent.state === "blocked" || agent.state === "waiting")).length;
    const blocked = agents.filter((agent) => agent.live && agent.state === "blocked").length;
    const key = `${running}|${blocked}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    void this.orca.host.call("statusBar.update", {
      id: "agent-flow-status",
      text: running ? `Agent Flow \xB7 ${running} running${blocked ? ` \xB7 ${blocked} blocked` : ""}` : "Agent Flow \xB7 idle",
      tone: blocked ? "warning" : running ? "accent" : "neutral",
      tooltip: "Live agents seen by Agent Flow"
    }).catch(() => {
      this.statusKey = "";
    });
  }
  publishCapabilities() {
    const hostMethods = {};
    for (const method of HOST_METHODS) hostMethods[method] = this.orca.host.has(method);
    const probe = { hostHas: (m) => this.orca.host.has(m), cli: Boolean(this.ctx.cli.path), actAsCoordinator: this.settings.actAsCoordinator };
    const commands = {};
    for (const kind of ALL_COMMANDS) commands[kind] = commandAvailability(kind, probe);
    this.store.put({
      entity: "capabilities",
      id: "capabilities",
      value: {
        hostMethods,
        commands,
        actAsCoordinator: this.settings.actAsCoordinator,
        chatSend: this.settings.chatSend,
        dashboardControls: this.settings.dashboardControls,
        cliAvailable: Boolean(this.ctx.cli.path),
        cliPath: this.ctx.cli.path,
        hooks: true,
        dashboard: { enabled: Boolean(this.dashboard), url: this.dashboard ? "running" : null },
        apiMinor: this.orca.api.minor,
        homeDir: homedir7()
      }
    });
  }
  async readSettings() {
    try {
      const raw = await this.orca.settings.get();
      return {
        // Unset means the default (on); only an explicit false turns a setting off.
        dashboardEnabled: raw.dashboardEnabled !== false,
        dashboardPort: typeof raw.dashboardPort === "number" && raw.dashboardPort >= 1024 && raw.dashboardPort <= 65e3 ? raw.dashboardPort : 4790,
        dashboardControls: raw.dashboardControls !== false,
        actAsCoordinator: raw.actAsCoordinator !== false,
        cliPath: typeof raw.cliPath === "string" ? raw.cliPath.trim() : "",
        chatSend: raw.chatSend !== false,
        checkUpdates: raw.checkUpdates !== false
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  async onSettingsChanged() {
    const before = this.settings;
    this.settings = await this.readSettings();
    if (before.cliPath !== this.settings.cliPath) {
      this.ctx.cli = createCliRunner(await resolveCliPath(this.settings.cliPath || null));
    }
    await this.syncDashboard(false);
    this.publishCapabilities();
  }
  /** Serialized: overlapping on/off requests can never leave a stray server running. */
  syncDashboard(rotateToken2) {
    this.dashboardOp = this.dashboardOp.catch(() => void 0).then(() => this.syncDashboardNow(rotateToken2));
    return this.dashboardOp;
  }
  async syncDashboardNow(rotateToken2) {
    const want = this.settings.dashboardEnabled && !this.stopped;
    if (this.dashboard && (!want || rotateToken2)) {
      await this.dashboard.stop();
      this.dashboard = null;
    }
    if (!want || this.dashboard) {
      this.publishCapabilities();
      return;
    }
    try {
      const protection = this.orca.host.has("secrets.protection") ? (await this.orca.host.call("secrets.protection", {})).status : "unavailable";
      const token = rotateToken2 ? await rotateToken(this.orca.secrets, protection, stateDir()) : await loadOrCreateToken(this.orca.secrets, protection, stateDir());
      const server = new DashboardServer({
        uiDir: fileURLToPath(new URL("./ui/", import.meta.url)),
        token,
        port: this.settings.dashboardPort,
        allowControls: () => this.settings.dashboardControls,
        snapshot: () => {
          this.seen();
          return this.store.snapshot();
        },
        subscribe: (listener) => this.store.subscribe(listener),
        subscribeOutput: (listener) => this.outputWatcher.subscribe(listener),
        command: (input, allowed) => {
          this.seen();
          return this.router.handle(input, allowed);
        },
        log: this.ctx.log
      });
      await server.start();
      if (!this.settings.dashboardEnabled || this.stopped) await server.stop();
      else this.dashboard = server;
      this.dashboardRetries = 0;
    } catch (error) {
      this.ctx.log(`dashboard could not start: ${error.message}`);
      if (this.dashboardRetries < DASHBOARD_RETRIES) {
        const delay = 2e3 * 2 ** this.dashboardRetries++;
        this.once("dashboard-retry", delay, () => this.syncDashboard(false));
      }
    }
    this.publishCapabilities();
  }
  async loadLabels() {
    try {
      const raw = await this.orca.storage.get("labels");
      if (raw && typeof raw === "object") {
        this.store.put({ entity: "labels", id: "labels", value: { ...EMPTY_LABELS, ...raw } });
      }
    } catch {
    }
  }
  async saveLabels(labels) {
    await this.orca.storage.set("labels", labels);
    this.store.put({ entity: "labels", id: "labels", value: labels });
    await this.accounts.refresh();
  }
};

// src/worker/main.ts
var runtime = null;
async function activate(orca) {
  runtime = new AgentFlowRuntime(orca);
  await runtime.start();
}
async function deactivate() {
  await runtime?.stop();
  runtime = null;
}
export {
  deactivate,
  activate as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3dvcmtlci9ydW50aW1lLnRzIiwgIi4uL3NyYy9zaGFyZWQvY29tbWFuZHMudHMiLCAiLi4vc3JjL3NoYXJlZC9tb2RlbC50cyIsICIuLi9zcmMvd29ya2VyL2FkYXB0ZXJzL2FjY291bnRzLWFkYXB0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9jb250ZXh0LnRzIiwgIi4uL3NyYy93b3JrZXIvc3RhdGUvaWRlbnRpdHktaW5kZXgudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9tZXJnZS1hZ2VudHMudHMiLCAiLi4vc3JjL3dvcmtlci9hZGFwdGVycy9hZ2VudHMtYWRhcHRlci50cyIsICIuLi9zcmMvc2hhcmVkL3JlZGFjdC50cyIsICIuLi9zcmMvc2hhcmVkL3Rhc2stc3RhdGVzLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvb3JjaGVzdHJhdGlvbi1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvc2Vzc2lvbnMtYWRhcHRlci50cyIsICIuLi9zcmMvd29ya2VyL2FkYXB0ZXJzL3N1YmFnZW50LWFkYXB0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9hZGFwdGVycy9zdWJhZ2VudC1maWxlcy1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvc2Vzc2lvbi1tb2RlbC1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvY2xpL29yY2EtY2xpLnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvYXZhaWxhYmlsaXR5LnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvYXR0YWNobWVudHMudHMiLCAiLi4vc3JjL3dvcmtlci9jb21tYW5kcy9yb3V0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9naXQvZ2l0LWluc3BlY3QudHMiLCAiLi4vc3JjL3dvcmtlci9jb21tYW5kcy9jb29yZGluYXRvci1jb21tYW5kcy50cyIsICIuLi9zcmMvd29ya2VyL2NvbW1hbmRzL3RyYW5zY3JpcHQudHMiLCAiLi4vc3JjL3dvcmtlci9ydW50aW1lLXJwYy9jaGF0LXNlbmQudHMiLCAiLi4vc3JjL3dvcmtlci9ydW50aW1lLXJwYy9vcmNhLXJ1bnRpbWUtY2xpZW50LnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvY2xhdWRlLXRyYW5zY3JpcHQudHMiLCAiLi4vc3JjL3dvcmtlci9kYXNoYm9hcmQvYXV0aC50cyIsICIuLi9zcmMvd29ya2VyL2Rhc2hib2FyZC9zZXJ2ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9oaXN0b3J5LXJlY29yZGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvZ2l0L3JlcG8tcm9vdC50cyIsICIuLi9zcmMvd29ya2VyL3N0YXRlL3BlcnNpc3RlbmNlLnRzIiwgIi4uL3NyYy9zaGFyZWQvZXZlbnRzLnRzIiwgIi4uL3NyYy93b3JrZXIvc3RhdGUvc3RvcmUudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS92aWV3ZXJzLnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvb3V0cHV0LXdhdGNoZXIudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9zdGFyLXByb21wdC50cyIsICIuLi9zcmMvd29ya2VyL3VwZGF0ZS91cGRhdGUtY2hlY2sudHMiLCAiLi4vc3JjL3dvcmtlci90cmFuc3BvcnQvc25hcHNob3QtYnVkZ2V0LnRzIiwgIi4uL3NyYy93b3JrZXIvdHJhbnNwb3J0L3BhbmVsLWJyaWRnZS50cyIsICIuLi9zcmMvd29ya2VyL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFdpcmVzIGFkYXB0ZXJzLCBzdG9yZSwgcGVyc2lzdGVuY2UsIGNvbW1hbmRzIGFuZCB0cmFuc3BvcnRzLCBhbmQgcGFjZXMgdGhlIHBvbGxpbmcuXG5pbXBvcnQgeyBob21lZGlyIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCdcbmltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHsgQUxMX0NPTU1BTkRTIH0gZnJvbSAnLi4vc2hhcmVkL2NvbW1hbmRzLnRzJ1xuaW1wb3J0IHsgRU1QVFlfTEFCRUxTLCB0eXBlIExhYmVsQ29uZmlnIH0gZnJvbSAnLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgQWNjb3VudHNBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9hY2NvdW50cy1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgQWdlbnRzQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvYWdlbnRzLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBPcmNoZXN0cmF0aW9uQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb3JjaGVzdHJhdGlvbi1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU2Vzc2lvbnNBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zZXNzaW9ucy1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU3ViYWdlbnRBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zdWJhZ2VudC1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU3ViYWdlbnRGaWxlc0FkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzL3N1YmFnZW50LWZpbGVzLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBTZXNzaW9uTW9kZWxBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zZXNzaW9uLW1vZGVsLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBjcmVhdGVDbGlSdW5uZXIsIHJlc29sdmVDbGlQYXRoIH0gZnJvbSAnLi9jbGkvb3JjYS1jbGkudHMnXG5pbXBvcnQgeyBjb21tYW5kQXZhaWxhYmlsaXR5IH0gZnJvbSAnLi9jb21tYW5kcy9hdmFpbGFiaWxpdHkudHMnXG5pbXBvcnQgeyBDb21tYW5kUm91dGVyIH0gZnJvbSAnLi9jb21tYW5kcy9yb3V0ZXIudHMnXG5pbXBvcnQgdHlwZSB7IFdvcmtlckNvbnRleHQgfSBmcm9tICcuL2NvbnRleHQudHMnXG5pbXBvcnQgeyBsb2FkT3JDcmVhdGVUb2tlbiwgcm90YXRlVG9rZW4gYXMgcm90YXRlRGFzaGJvYXJkVG9rZW4gfSBmcm9tICcuL2Rhc2hib2FyZC9hdXRoLnRzJ1xuaW1wb3J0IHsgRGFzaGJvYXJkU2VydmVyIH0gZnJvbSAnLi9kYXNoYm9hcmQvc2VydmVyLnRzJ1xuaW1wb3J0IHsgSGlzdG9yeVJlY29yZGVyIH0gZnJvbSAnLi9zdGF0ZS9oaXN0b3J5LXJlY29yZGVyLnRzJ1xuaW1wb3J0IHsgcmVwb1Jvb3RPZiB9IGZyb20gJy4vZ2l0L3JlcG8tcm9vdC50cydcbmltcG9ydCB7IHNlbmRDaGF0TWVzc2FnZSB9IGZyb20gJy4vcnVudGltZS1ycGMvY2hhdC1zZW5kLnRzJ1xuaW1wb3J0IHsgSWRlbnRpdHlJbmRleCB9IGZyb20gJy4vc3RhdGUvaWRlbnRpdHktaW5kZXgudHMnXG5pbXBvcnQgeyBtZXJnZUR1cGxpY2F0ZXNPZiB9IGZyb20gJy4vc3RhdGUvbWVyZ2UtYWdlbnRzLnRzJ1xuaW1wb3J0IHsgUGVyc2lzdGVuY2UsIHN0YXRlRGlyIH0gZnJvbSAnLi9zdGF0ZS9wZXJzaXN0ZW5jZS50cydcbmltcG9ydCB7IEZsb3dTdG9yZSB9IGZyb20gJy4vc3RhdGUvc3RvcmUudHMnXG5pbXBvcnQgeyBWaWV3ZXJUcmFja2VyIH0gZnJvbSAnLi9zdGF0ZS92aWV3ZXJzLnRzJ1xuaW1wb3J0IHsgT3V0cHV0V2F0Y2hlciB9IGZyb20gJy4vY29tbWFuZHMvb3V0cHV0LXdhdGNoZXIudHMnXG5pbXBvcnQgeyBBdHRhY2htZW50U3RvcmUsIGF0dGFjaG1lbnRzUm9vdCB9IGZyb20gJy4vY29tbWFuZHMvYXR0YWNobWVudHMudHMnXG5pbXBvcnQgeyBTdGFyUHJvbXB0U3RvcmUgfSBmcm9tICcuL3N0YXRlL3N0YXItcHJvbXB0LnRzJ1xuaW1wb3J0IHsgVXBkYXRlQ2hlY2tlciB9IGZyb20gJy4vdXBkYXRlL3VwZGF0ZS1jaGVjay50cydcbmltcG9ydCB7IGNvbm5lY3RQYW5lbHMgfSBmcm9tICcuL3RyYW5zcG9ydC9wYW5lbC1icmlkZ2UudHMnXG5cbnR5cGUgU2V0dGluZ3MgPSB7XG4gIGRhc2hib2FyZEVuYWJsZWQ6IGJvb2xlYW5cbiAgZGFzaGJvYXJkUG9ydDogbnVtYmVyXG4gIGRhc2hib2FyZENvbnRyb2xzOiBib29sZWFuXG4gIGFjdEFzQ29vcmRpbmF0b3I6IGJvb2xlYW5cbiAgY2xpUGF0aDogc3RyaW5nXG4gIGNoYXRTZW5kOiBib29sZWFuXG4gIGNoZWNrVXBkYXRlczogYm9vbGVhblxufVxuXG4vKiogRXZlcnl0aGluZyBvbiBieSBkZWZhdWx0ICh0aGUgbWFuaWZlc3QncyBkZWZhdWx0cyBtYXRjaCk7IGVhY2ggc2V0dGluZyBjYW4gYmUgdHVybmVkIG9mZiBpbiBPcmNhLiAqL1xuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogU2V0dGluZ3MgPSB7IGRhc2hib2FyZEVuYWJsZWQ6IHRydWUsIGRhc2hib2FyZFBvcnQ6IDQ3OTAsIGRhc2hib2FyZENvbnRyb2xzOiB0cnVlLCBhY3RBc0Nvb3JkaW5hdG9yOiB0cnVlLCBjbGlQYXRoOiAnJywgY2hhdFNlbmQ6IHRydWUsIGNoZWNrVXBkYXRlczogdHJ1ZSB9XG4vKiogU3RhcnQgYXR0ZW1wdHMgYWZ0ZXIgYSBmYWlsdXJlOiAyIHMsIDQgcywgOCBzLCAxNiBzLCAzMiBzLiAqL1xuY29uc3QgREFTSEJPQVJEX1JFVFJJRVMgPSA1XG4vKiogSG93IG9mdGVuIHN0YXRlIGlzIHNhdmVkIGZvciBjcmFzaCByZWNvdmVyeSAob25seSB3aGVuIHNvbWV0aGluZyBjaGFuZ2VkKS4gKi9cbmNvbnN0IFBFUlNJU1RfTVMgPSAxMl8wMDBcbmNvbnN0IFNVQkFHRU5UX09SUEhBTl9NUyA9IDUgKiA2MCAqIDEwMDBcbmNvbnN0IFNVQkFHRU5UX1JFVEVOVElPTl9NUyA9IDI0ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IFNUQU5EQUxPTkVfUkVURU5USU9OX01TID0gNyAqIDI0ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IEhPU1RfTUVUSE9EUyA9IFsnd29ya3NwYWNlLmxpc3QnLCAnYWdlbnRzLmxpc3QnLCAnYWdlbnQubGlzdFNlc3Npb25zJywgJ3Rlcm1pbmFsLnJlYWQnLCAndGVybWluYWwuZm9jdXMnLCAndGVybWluYWwuY2xvc2UnLCAndGVybWluYWwuc2VuZFRleHQnLCAnYWdlbnQubGF1bmNoJywgJ2FnZW50LnJlc3VtZScsICd3b3Jrc3BhY2UuY3JlYXRlJywgJ3dvcmtzcGFjZS5vcGVuJywgJ3N0YXR1c0Jhci51cGRhdGUnXVxuXG5leHBvcnQgY2xhc3MgQWdlbnRGbG93UnVudGltZSB7XG4gIHByaXZhdGUgc3RvcmUgPSBuZXcgRmxvd1N0b3JlKClcbiAgcHJpdmF0ZSBpZGVudGl0eSA9IG5ldyBJZGVudGl0eUluZGV4KClcbiAgcHJpdmF0ZSBwZXJzaXN0ZW5jZSA9IG5ldyBQZXJzaXN0ZW5jZSgpXG4gIHByaXZhdGUgdmlld2VycyA9IG5ldyBWaWV3ZXJUcmFja2VyKERhdGUubm93KVxuICBwcml2YXRlIG91dHB1dFdhdGNoZXIgPSBuZXcgT3V0cHV0V2F0Y2hlcigpXG4gIHByaXZhdGUgc2V0dGluZ3M6IFNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HU1xuICBwcml2YXRlIG93blRlcm1pbmFscyA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIC8qKiBPbmUgcGVuZGluZyB0aW1lciBwZXIgbmFtZWQgbG9vcCwgc28gbm90aGluZyBhY2N1bXVsYXRlcyBhbmQgc3RvcCgpIGNsZWFycyBldmVyeXRoaW5nLiAqL1xuICBwcml2YXRlIHRpbWVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pj4oKVxuICBwcml2YXRlIGRhc2hib2FyZE9wOiBQcm9taXNlPHZvaWQ+ID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgcHJpdmF0ZSBkaXNwb3NlcnM6ICgoKSA9PiB2b2lkKVtdID0gW11cbiAgcHJpdmF0ZSBkYXNoYm9hcmQ6IERhc2hib2FyZFNlcnZlciB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgZGFzaGJvYXJkUmV0cmllcyA9IDBcbiAgcHJpdmF0ZSBjdHghOiBXb3JrZXJDb250ZXh0XG4gIHByaXZhdGUgYWdlbnRzITogQWdlbnRzQWRhcHRlclxuICBwcml2YXRlIHN1YmFnZW50cyE6IFN1YmFnZW50QWRhcHRlclxuICBwcml2YXRlIG9yY2hlc3RyYXRpb24hOiBPcmNoZXN0cmF0aW9uQWRhcHRlclxuICBwcml2YXRlIGFjY291bnRzITogQWNjb3VudHNBZGFwdGVyXG4gIHByaXZhdGUgc2Vzc2lvbnMhOiBTZXNzaW9uc0FkYXB0ZXJcbiAgcHJpdmF0ZSBzdWJhZ2VudEZpbGVzITogU3ViYWdlbnRGaWxlc0FkYXB0ZXJcbiAgcHJpdmF0ZSBzZXNzaW9uTW9kZWxzITogU2Vzc2lvbk1vZGVsQWRhcHRlclxuICBwcml2YXRlIHJvdXRlciE6IENvbW1hbmRSb3V0ZXJcbiAgcHJpdmF0ZSBoaXN0b3J5ITogSGlzdG9yeVJlY29yZGVyXG4gIHByaXZhdGUgcGVyc2lzdGVkU2VxID0gLTFcbiAgcHJpdmF0ZSBzdGF0dXNLZXkgPSAnJ1xuICBwcml2YXRlIHN0b3BwZWQgPSBmYWxzZVxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgb3JjYTogT3JjYVdvcmtlckFwaSkge31cblxuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBsb2cgPSAobWVzc2FnZTogc3RyaW5nKSA9PiB0aGlzLm9yY2EubG9nKGBbYWdlbnQtZmxvd10gJHttZXNzYWdlfWApXG4gICAgdGhpcy5zZXR0aW5ncyA9IGF3YWl0IHRoaXMucmVhZFNldHRpbmdzKClcbiAgICBjb25zdCBjbGkgPSBjcmVhdGVDbGlSdW5uZXIoYXdhaXQgcmVzb2x2ZUNsaVBhdGgodGhpcy5zZXR0aW5ncy5jbGlQYXRoIHx8IG51bGwpKVxuICAgIGlmICghY2xpLnBhdGgpIGxvZygnb3JjYSBDTEkgbm90IGZvdW5kOyBvcmNoZXN0cmF0aW9uIGRhdGEgYW5kIGNvbnRyb2xzIGFyZSBvZmYnKVxuICAgIHRoaXMuY3R4ID0geyBvcmNhOiB0aGlzLm9yY2EsIHN0b3JlOiB0aGlzLnN0b3JlLCBjbGksIGlkZW50aXR5OiB0aGlzLmlkZW50aXR5LCBub3c6IERhdGUubm93LCBsb2cgfVxuXG4gICAgYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZS5pbml0KCkuY2F0Y2goKGVycm9yKSA9PiBsb2coYHN0YXRlIGZvbGRlcjogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YCkpXG4gICAgY29uc3Qgc2F2ZWQgPSBhd2FpdCB0aGlzLnBlcnNpc3RlbmNlLmxvYWRTbmFwc2hvdCgpXG4gICAgaWYgKHNhdmVkKSB7XG4gICAgICB0aGlzLnN0b3JlLnJlc3RvcmUoc2F2ZWQpXG4gICAgICAvLyBPbGRlciB2ZXJzaW9ucyBjb3VsZCBzdG9yZSBvbmUgc2Vzc2lvbiB0d2ljZTsga2VlcCB0aGUgbW9zdCByZWNlbnRseSBzZWVuIHJlY29yZC5cbiAgICAgIGNvbnN0IGJ5U2Vzc2lvbiA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpLnNvcnQoKGEsIGIpID0+IGIubGFzdFNlZW5BdCAtIGEubGFzdFNlZW5BdCkpIHtcbiAgICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICAgICAgaWYgKGJ5U2Vzc2lvbi5oYXMoYWdlbnQuc2Vzc2lvbklkKSkgdGhpcy5zdG9yZS5yZW1vdmVBZ2VudChhZ2VudC5pZClcbiAgICAgICAgZWxzZSBieVNlc3Npb24uc2V0KGFnZW50LnNlc3Npb25JZCwgYWdlbnQuaWQpXG4gICAgICB9XG4gICAgICAvLyBSZS1saW5rIHJlc3RvcmVkIGFnZW50cyBzbyBsaXZlIGV2ZW50cyBsYW5kIG9uIHRoZSBzYW1lIG5vZGUgaW5zdGVhZCBvZiBhIGR1cGxpY2F0ZS5cbiAgICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgICAgIHRoaXMuaWRlbnRpdHkubGluayhhZ2VudC5pZCwgeyB0ZXJtaW5hbElkOiBhZ2VudC50ZXJtaW5hbElkLCBwYW5lS2V5OiBhZ2VudC5wYW5lS2V5LCBzZXNzaW9uSWQ6IGFnZW50LnNlc3Npb25JZCwgdGVybWluYWxIYW5kbGU6IGFnZW50LnRlcm1pbmFsSGFuZGxlIH0pXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXModGhpcy5zdG9yZS5yZWFkKCkuYWdlbnRzKSkgaWYgKGFnZW50LmRpc3BhdGNoSWQpIG1lcmdlRHVwbGljYXRlc09mKHRoaXMuc3RvcmUsIHRoaXMuaWRlbnRpdHksIGFnZW50LmlkKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLmxvYWRMYWJlbHMoKVxuXG4gICAgdGhpcy5hZ2VudHMgPSBuZXcgQWdlbnRzQWRhcHRlcih0aGlzLmN0eClcbiAgICB0aGlzLnN1YmFnZW50cyA9IG5ldyBTdWJhZ2VudEFkYXB0ZXIodGhpcy5jdHgpXG4gICAgdGhpcy5vcmNoZXN0cmF0aW9uID0gbmV3IE9yY2hlc3RyYXRpb25BZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuYWNjb3VudHMgPSBuZXcgQWNjb3VudHNBZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuc2Vzc2lvbnMgPSBuZXcgU2Vzc2lvbnNBZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuc3ViYWdlbnRGaWxlcyA9IG5ldyBTdWJhZ2VudEZpbGVzQWRhcHRlcih0aGlzLmN0eCwgKCkgPT4gdGhpcy5hY2NvdW50cy5jbGF1ZGVIb21lcygpKVxuICAgIHRoaXMuc2Vzc2lvbk1vZGVscyA9IG5ldyBTZXNzaW9uTW9kZWxBZGFwdGVyKHRoaXMuY3R4LCB0aGlzLnN1YmFnZW50RmlsZXMsICgpID0+IHRoaXMuYWNjb3VudHMuY29kZXhIb21lcygpKVxuICAgIHRoaXMuaGlzdG9yeSA9IG5ldyBIaXN0b3J5UmVjb3JkZXIodGhpcy5zdG9yZSwgdGhpcy5wZXJzaXN0ZW5jZSwgbG9nKVxuICAgIHRoaXMucm91dGVyID0gbmV3IENvbW1hbmRSb3V0ZXIoe1xuICAgICAgY3R4OiB0aGlzLmN0eCxcbiAgICAgIHBlcnNpc3RlbmNlOiB0aGlzLnBlcnNpc3RlbmNlLFxuICAgICAgb3duVGVybWluYWxzOiB0aGlzLm93blRlcm1pbmFscyxcbiAgICAgIHNldHRpbmdzOiAoKSA9PiAoeyBhY3RBc0Nvb3JkaW5hdG9yOiB0aGlzLnNldHRpbmdzLmFjdEFzQ29vcmRpbmF0b3IsIGNoYXRTZW5kOiB0aGlzLnNldHRpbmdzLmNoYXRTZW5kIH0pLFxuICAgICAgc2VuZENoYXQ6IChzZXNzaW9uSWQsIHRleHQpID0+IHNlbmRDaGF0TWVzc2FnZShzZXNzaW9uSWQsIHRleHQpLFxuICAgICAgdXBkYXRlTGFiZWxzOiAobGFiZWxzKSA9PiB0aGlzLnNhdmVMYWJlbHMobGFiZWxzKSxcbiAgICAgIGRhc2hib2FyZEluZm86ICgpID0+ICh7IGVuYWJsZWQ6IEJvb2xlYW4odGhpcy5kYXNoYm9hcmQpLCB1cmw6IHRoaXMuZGFzaGJvYXJkPy51cmwgPz8gbnVsbCB9KSxcbiAgICAgIHJlZnJlc2g6ICgpID0+IHRoaXMua2ljaygpLFxuICAgICAgZnVsbFRleHQ6IChrZXkpID0+IHRoaXMub3JjaGVzdHJhdGlvbi5mdWxsVGV4dEZvcihrZXkpLFxuICAgICAgY2xhdWRlVHJhbnNjcmlwdFBhdGg6IChhZ2VudCkgPT4gdGhpcy5zdWJhZ2VudEZpbGVzLnRyYW5zY3JpcHRQYXRoRm9yKGFnZW50KSxcbiAgICAgIHdhdGNoT3V0cHV0OiAoYWdlbnRJZCwgcGF0aCkgPT4gdGhpcy5vdXRwdXRXYXRjaGVyLnRyYWNrKGFnZW50SWQsIHBhdGgpLFxuICAgICAgbm90ZU91dHB1dEludGVyZXN0OiAoYWdlbnRJZCkgPT4gdGhpcy5vdXRwdXRXYXRjaGVyLm5vdGVJbnRlcmVzdChhZ2VudElkKSxcbiAgICAgIGF0dGFjaG1lbnRzOiBuZXcgQXR0YWNobWVudFN0b3JlKGF0dGFjaG1lbnRzUm9vdChzdGF0ZURpcigpKSksXG4gICAgICBzdGFyUHJvbXB0OiBuZXcgU3RhclByb21wdFN0b3JlKHN0YXRlRGlyKCkpLFxuICAgICAgLy8gVGhlIHBsdWdpbiBmb2xkZXIgaXMgb25lIGxldmVsIGFib3ZlIGRpc3Qvd29ya2VyLm1qcy5cbiAgICAgIHVwZGF0ZXM6IG5ldyBVcGRhdGVDaGVja2VyKGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4nLCBpbXBvcnQubWV0YS51cmwpKSwgKCkgPT4gdGhpcy5zZXR0aW5ncy5jaGVja1VwZGF0ZXMpLFxuICAgICAgc2V0RGFzaGJvYXJkQ29udHJvbHM6IGFzeW5jIChlbmFibGVkKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5zZXQoJ2Rhc2hib2FyZENvbnRyb2xzJywgZW5hYmxlZClcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IGF3YWl0IHRoaXMucmVhZFNldHRpbmdzKClcbiAgICAgICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgICAgICAgcmV0dXJuIHsgY29udHJvbHM6IHRoaXMuc2V0dGluZ3MuZGFzaGJvYXJkQ29udHJvbHMgfVxuICAgICAgfSxcbiAgICAgIHNldERhc2hib2FyZDogYXN5bmMgKGVuYWJsZWQpID0+IHtcbiAgICAgICAgLy8gVGhlIHBsdWdpbidzIG93biBzZXR0aW5nOyBPcmNhJ3MgU2V0dGluZ3MgcGFnZSBzaG93cyB0aGUgc2FtZSBzd2l0Y2guXG4gICAgICAgIGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5zZXQoJ2Rhc2hib2FyZEVuYWJsZWQnLCBlbmFibGVkKVxuICAgICAgICB0aGlzLnNldHRpbmdzID0gYXdhaXQgdGhpcy5yZWFkU2V0dGluZ3MoKVxuICAgICAgICBhd2FpdCB0aGlzLnN5bmNEYXNoYm9hcmQoZW5hYmxlZClcbiAgICAgICAgcmV0dXJuIHsgZW5hYmxlZDogQm9vbGVhbih0aGlzLmRhc2hib2FyZCksIHVybDogdGhpcy5kYXNoYm9hcmQ/LnVybCA/PyBudWxsIH1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm91dHB1dFdhdGNoZXIuc3Vic2NyaWJlKChhZ2VudElkKSA9PiB0aGlzLnJvdXRlci5pbnZhbGlkYXRlT3V0cHV0KGFnZW50SWQpKSlcbiAgICAvLyBBZ2VudHMgd2l0aG91dCBhIHRyYW5zY3JpcHQgZmlsZTogYSBzdGF0dXMgY2hhbmdlIG9yIGEgdG9vbCBjYWxsIHVzdWFsbHkgbWVhbnMgbmV3IG91dHB1dC5cbiAgICAvLyBPbmx5IHJlYWwgY2hhbmdlcyBjb3VudDogYSByZWNvcmQgYWxzbyBjaGFuZ2VzIHdoZW4ganVzdCBpdHMgbGFzdC1zZWVuIHRpbWUgbW92ZXMuXG4gICAgY29uc3Qgb3V0cHV0U2lnbmF0dXJlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICB0aGlzLnN0b3JlLnN1YnNjcmliZSgoZGVsdGEpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBwYXRjaCBvZiBkZWx0YS5wYXRjaGVzKSB7XG4gICAgICAgICAgaWYgKHBhdGNoLmVudGl0eSA9PT0gJ2FnZW50JyAmJiBwYXRjaC52YWx1ZSkge1xuICAgICAgICAgICAgY29uc3QgdiA9IHBhdGNoLnZhbHVlXG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBgJHt2LnN0YXRlfXwke3YubGl2ZX18JHt2Lm91dGNvbWV9fCR7di5tZXNzYWdlQ291bnR9fCR7di50b2tlbnN9fCR7di5zdGF0ZVNpbmNlfWBcbiAgICAgICAgICAgIGlmIChvdXRwdXRTaWduYXR1cmUuZ2V0KHYuaWQpID09PSBzaWduYXR1cmUpIGNvbnRpbnVlXG4gICAgICAgICAgICBvdXRwdXRTaWduYXR1cmUuc2V0KHYuaWQsIHNpZ25hdHVyZSlcbiAgICAgICAgICAgIGlmIChvdXRwdXRTaWduYXR1cmUuc2l6ZSA+IDIwMDApIG91dHB1dFNpZ25hdHVyZS5kZWxldGUob3V0cHV0U2lnbmF0dXJlLmtleXMoKS5uZXh0KCkudmFsdWUhKVxuICAgICAgICAgICAgdGhpcy5vdXRwdXRXYXRjaGVyLnBva2Uodi5pZClcbiAgICAgICAgICB9IGVsc2UgaWYgKHBhdGNoLmVudGl0eSA9PT0gJ3Rvb2xDYWxsJyAmJiBwYXRjaC52YWx1ZS5hZ2VudElkKSB0aGlzLm91dHB1dFdhdGNoZXIucG9rZShwYXRjaC52YWx1ZS5hZ2VudElkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIClcbiAgICB0aGlzLnN1YnNjcmliZVJ1bnRpbWUoKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICBjb25uZWN0UGFuZWxzKHRoaXMub3JjYS5wYW5lbHMsIHtcbiAgICAgICAgc25hcHNob3Q6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnN0b3JlLnNuYXBzaG90KClcbiAgICAgICAgfSxcbiAgICAgICAgc3Vic2NyaWJlOiAobGlzdGVuZXIpID0+IHRoaXMuc3RvcmUuc3Vic2NyaWJlKGxpc3RlbmVyKSxcbiAgICAgICAgc3Vic2NyaWJlT3V0cHV0OiAobGlzdGVuZXIpID0+IHRoaXMub3V0cHV0V2F0Y2hlci5zdWJzY3JpYmUobGlzdGVuZXIpLFxuICAgICAgICBjb21tYW5kOiAoaW5wdXQpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnJvdXRlci5oYW5kbGUoaW5wdXQpXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ1xuICAgICAgfSlcbiAgICApXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm9yY2Euc2V0dGluZ3Mub25EaWRDaGFuZ2UoKCkgPT4gdm9pZCB0aGlzLm9uU2V0dGluZ3NDaGFuZ2VkKCkpLmRpc3Bvc2UpXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm9yY2EuY29tbWFuZHMucmVnaXN0ZXIoJ2FnZW50LWZsb3cuc2hvd1BhbmVsJywgKCkgPT4gdGhpcy5zaG93UGFuZWwoKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKFxuICAgICAgdGhpcy5vcmNhLmNvbW1hbmRzLnJlZ2lzdGVyKCdhZ2VudC1mbG93LmRhc2hib2FyZExpbmsnLCAoKSA9PlxuICAgICAgICB0aGlzLmRhc2hib2FyZD8udXJsXG4gICAgICAgICAgPyBgT3BlbiBpbiB5b3VyIGJyb3dzZXIgKGtlZXAgdGhlIGxpbmsgcHJpdmF0ZSk6ICR7dGhpcy5kYXNoYm9hcmQudXJsfWBcbiAgICAgICAgICA6ICdUaGUgYnJvd3NlciBkYXNoYm9hcmQgaXMgb2ZmLiBUdXJuIG9uIFx1MjAxQ0Jyb3dzZXIgZGFzaGJvYXJkXHUyMDFEIHVuZGVyIEFnZW50IEZsb3cgaW4gT3JjYSBTZXR0aW5ncy4nXG4gICAgICApLmRpc3Bvc2VcbiAgICApXG4gICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgICAvLyBEbyBub3QgaG9sZCB1cCBhY3RpdmF0aW9uIChPcmNhIGhhcyBhIHdvcmtlci1yZWFkeSB0aW1lb3V0KTogZmlyc3QgcGFzcyBydW5zIGluIHRoZSBiYWNrZ3JvdW5kLlxuICAgIHZvaWQgdGhpcy5pbml0aWFsUGFzcygpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxQYXNzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3luY0Rhc2hib2FyZChmYWxzZSlcbiAgICBhd2FpdCB0aGlzLmFnZW50cy5zY2FuKClcbiAgICBhd2FpdCB0aGlzLmFjY291bnRzLnJlZnJlc2goKVxuICAgIGF3YWl0IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKClcbiAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICBhd2FpdCB0aGlzLnJlc29sdmVSZXBvUm9vdHMoKVxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB0aGlzLmFjY291bnRzLmFwcGx5VG9BZ2VudHMoKVxuICAgIGlmICh0aGlzLnN0b3BwZWQpIHJldHVyblxuICAgIC8vIEZhc3Qgd2hpbGUgc29tZW9uZSBpcyBsb29raW5nOyBzbG93IHdoZW4gbm9ib2R5IGlzIChPcmNhJ3Mgb3duIGV2ZW50cyBzdGlsbCB0cmlnZ2VyIHNjYW5zKS5cbiAgICBjb25zdCBwYWNlID0gKHdhdGNoZWQ6IG51bWJlciwgaWRsZTogbnVtYmVyKSA9PiAoKSA9PiB0aGlzLnZpZXdlcnMucGFjZSh3YXRjaGVkLCBpZGxlKVxuICAgIHRoaXMubG9vcCgnb3JjaGVzdHJhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKClcbiAgICAgIHRoaXMuYWNjb3VudHMuYXBwbHlUb0FnZW50cygpXG4gICAgfSwgKCkgPT4gKHRoaXMub3JjaGVzdHJhdGlvbi5oYXNBY3RpdmVXb3JrID8gdGhpcy52aWV3ZXJzLnBhY2UoMTUwMCwgNTAwMCkgOiB0aGlzLnZpZXdlcnMucGFjZSg2MDAwLCAzMDAwMCkpKVxuICAgIHRoaXMubG9vcCgnYWdlbnRzJywgKCkgPT4gdGhpcy5hZ2VudHMuc2NhbigpLCBwYWNlKDEwMDAwLCA2MDAwMCkpXG4gICAgdGhpcy5sb29wKCdhY2NvdW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIH0sIHBhY2UoMjAwMDAsIDEyMDAwMCkpXG4gICAgdGhpcy5sb29wKCdzdWJhZ2VudC1maWxlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB9LCBwYWNlKDUwMDAsIDMwMDAwKSlcbiAgICB0aGlzLmxvb3AoJ3JlcG8tcm9vdHMnLCAoKSA9PiB0aGlzLnJlc29sdmVSZXBvUm9vdHMoKSwgcGFjZSgxNTAwMCwgMTIwMDAwKSlcbiAgICB0aGlzLmxvb3AoJ3BlcnNpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnBydW5lKClcbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdCgpXG4gICAgfSwgKCkgPT4gUEVSU0lTVF9NUylcbiAgICB0aGlzLmxvb3AoJ3N0YXR1cy1iYXInLCBhc3luYyAoKSA9PiB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpLCAoKSA9PiAzMDAwKVxuICB9XG5cbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0b3BwZWQgPSB0cnVlXG4gICAgZm9yIChjb25zdCB0aW1lciBvZiB0aGlzLnRpbWVycy52YWx1ZXMoKSkgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIHRoaXMudGltZXJzLmNsZWFyKClcbiAgICBhd2FpdCB0aGlzLmRhc2hib2FyZE9wLmNhdGNoKCgpID0+IHVuZGVmaW5lZClcbiAgICBmb3IgKGNvbnN0IGRpc3Bvc2Ugb2YgdGhpcy5kaXNwb3NlcnMuc3BsaWNlKDApKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkaXNwb3NlKClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBrZWVwIGRpc3Bvc2luZ1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLmRhc2hib2FyZD8uc3RvcCgpXG4gICAgdGhpcy5vdXRwdXRXYXRjaGVyLmRpc3Bvc2UoKVxuICAgIGF3YWl0IHRoaXMucGVyc2lzdCh0cnVlKVxuICAgIHRoaXMuc3RvcmUuZGlzcG9zZSgpXG4gIH1cblxuICBwcml2YXRlIHN1YnNjcmliZVJ1bnRpbWUoKTogdm9pZCB7XG4gICAgY29uc3QgeyBldmVudHMsIGhvb2tzIH0gPSB0aGlzLm9yY2FcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignYWdlbnQuc3RhdHVzLmNoYW5nZWQnLCAoZXZlbnQpID0+IHRoaXMuYWdlbnRzLm9uU3RhdHVzKGV2ZW50KSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLmNyZWF0ZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLnJlbW92ZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLmNoYW5nZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICAvLyBPYnNlcnZlLW9ubHkgaG9va3M6IHJldHVybiBub3RoaW5nIHNvIE9yY2EgY2FycmllcyBvbiB3aXRob3V0IHdhaXRpbmcgb24gdXMuXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaChcbiAgICAgIGhvb2tzLm9uKCdhZ2VudC50b29sLmJlZm9yZScsIChldmVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMuc3ViYWdlbnRzLm9uVG9vbEJlZm9yZShldmVudClcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmN0eC5sb2coYHRvb2wuYmVmb3JlOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgICAgICB9XG4gICAgICB9KS5kaXNwb3NlXG4gICAgKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICBob29rcy5vbignYWdlbnQudG9vbC5hZnRlcicsIChldmVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMuc3ViYWdlbnRzLm9uVG9vbEFmdGVyKGV2ZW50KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMuY3R4LmxvZyhgdG9vbC5hZnRlcjogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgICAgfVxuICAgICAgfSkuZGlzcG9zZVxuICAgIClcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKFxuICAgICAgaG9va3Mub24oJ2FnZW50LmxhdW5jaC5iZWZvcmUnLCAoZXZlbnQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLmFjY291bnRzLm9uTGF1bmNoKGV2ZW50KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMuY3R4LmxvZyhgbGF1bmNoLmJlZm9yZTogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgICAgfVxuICAgICAgfSkuZGlzcG9zZVxuICAgIClcbiAgfVxuXG4gIHByaXZhdGUgbG9vcChuYW1lOiBzdHJpbmcsIHRhc2s6ICgpID0+IFByb21pc2U8dm9pZD4sIGludGVydmFsOiAoKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCB0aWNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy50aW1lcnMuZGVsZXRlKG5hbWUpXG4gICAgICBpZiAodGhpcy5zdG9wcGVkKSByZXR1cm5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRhc2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5jdHgubG9nKGAke25hbWV9IGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5zdG9wcGVkKSB0aGlzLnRpbWVycy5zZXQobmFtZSwgc2V0VGltZW91dCh0aWNrLCBpbnRlcnZhbCgpKSlcbiAgICB9XG4gICAgdGhpcy50aW1lcnMuc2V0KG5hbWUsIHNldFRpbWVvdXQodGljaywgaW50ZXJ2YWwoKSkpXG4gIH1cblxuICAvKiogQSBvbmUtc2hvdCB0aW1lciB0aGF0IHN0b3AoKSBhbHNvIGNsZWFyczsgcmUtc2NoZWR1bGluZyB0aGUgc2FtZSBuYW1lIHJlcGxhY2VzIGl0LiAqL1xuICBwcml2YXRlIG9uY2UobmFtZTogc3RyaW5nLCBtczogbnVtYmVyLCB0YXNrOiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogdm9pZCB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnRpbWVycy5nZXQobmFtZSlcbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFyVGltZW91dChleGlzdGluZylcbiAgICB0aGlzLnRpbWVycy5zZXQoXG4gICAgICBuYW1lLFxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMudGltZXJzLmRlbGV0ZShuYW1lKVxuICAgICAgICBpZiAoIXRoaXMuc3RvcHBlZCkgdm9pZCB0YXNrKCkuY2F0Y2goKGVycm9yKSA9PiB0aGlzLmN0eC5sb2coYCR7bmFtZX0gZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKSlcbiAgICAgIH0sIG1zKVxuICAgIClcbiAgfVxuXG4gIC8qKiBXaGljaCByZXBvc2l0b3J5IGVhY2ggYWdlbnQncyB3b3JrdHJlZSBiZWxvbmdzIHRvLCBmb3IgZXhhY3QgcHJvamVjdCBib3hlcy4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlUmVwb1Jvb3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgICBpZiAoIWFnZW50Lndvcmt0cmVlUGF0aCB8fCBhZ2VudC5yZXBvUm9vdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgICAgY29uc3QgcmVwb1Jvb3QgPSBhd2FpdCByZXBvUm9vdE9mKGFnZW50Lndvcmt0cmVlUGF0aClcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnQuaWRdXG4gICAgICBpZiAoY3VycmVudCkgdGhpcy5zdG9yZS51cHNlcnRBZ2VudChhZ2VudC5pZCwgY3VycmVudC5sYXN0U2VlbkF0LCB7IHJlcG9Sb290IH0sICgpID0+IGN1cnJlbnQpXG4gICAgfVxuICB9XG5cbiAgLyoqIEJvdW5kZWQgbWVtb3J5OiBkcm9wIGxvbmctZmluaXNoZWQgc3ViYWdlbnRzIGFuZCBzdGFuZGFsb25lIGFnZW50cyAocnVucyBrZWVwIHRoZWlycyBpbiBoaXN0b3J5KS4gKi9cbiAgcHJpdmF0ZSBwcnVuZSgpOiB2b2lkIHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgZm9yIChjb25zdCBhZ2VudCBvZiBPYmplY3QudmFsdWVzKHRoaXMuc3RvcmUucmVhZCgpLmFnZW50cykpIHtcbiAgICAgIGlmIChhZ2VudC5saXZlKSB7XG4gICAgICAgIC8vIEEgc3ViYWdlbnQgY2Fubm90IG91dGxpdmUgaXRzIHBhcmVudDsgaG9va3MgY2FuIG1pc3MgdGhlIGVuZCAoaW50ZXJydXB0LCBjcmFzaCkuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcgJiYgYWdlbnQucGFyZW50SWQgPyB0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnQucGFyZW50SWRdIDogdW5kZWZpbmVkXG4gICAgICAgIGNvbnN0IG9ycGhhbmVkID0gYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JyAmJiAoIXBhcmVudCB8fCAhcGFyZW50LmxpdmUpICYmIG5vdyAtIGFnZW50Lmxhc3RTZWVuQXQgPiBTVUJBR0VOVF9PUlBIQU5fTVNcbiAgICAgICAgaWYgKG9ycGhhbmVkKSB0aGlzLnN0b3JlLnVwc2VydEFnZW50KGFnZW50LmlkLCBub3csIHsgbGl2ZTogZmFsc2UsIHN0YXRlOiAndW5rbm93bicsIGV2aWRlbmNlOiBbJ2hvc3QtZXZlbnQnXSB9LCAoKSA9PiBhZ2VudClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFnZSA9IG5vdyAtIGFnZW50Lmxhc3RTZWVuQXRcbiAgICAgIGNvbnN0IHN0YWxlID0gKGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcgJiYgYWdlID4gU1VCQUdFTlRfUkVURU5USU9OX01TKSB8fCAoYWdlbnQucm9sZSA9PT0gJ2FnZW50JyAmJiAhYWdlbnQucnVuSWQgJiYgYWdlID4gU1RBTkRBTE9ORV9SRVRFTlRJT05fTVMpXG4gICAgICBpZiAoc3RhbGUpIHtcbiAgICAgICAgdGhpcy5zdG9yZS5yZW1vdmVBZ2VudChhZ2VudC5pZClcbiAgICAgICAgdGhpcy5pZGVudGl0eS51bmxpbmtBZ2VudChhZ2VudC5pZClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogQWZ0ZXIgYSBjb21tYW5kLCBsb29rIGFnYWluIHNvb24gc28gaXRzIGVmZmVjdCBzaG93cyB1cCBxdWlja2x5LiAqL1xuICAvKiogQSBwYW5lbCBvciB0aGUgZGFzaGJvYXJkIGFza2VkIGZvciBzb21ldGhpbmcuIEFmdGVyIGEgcXVpZXQgc3RyZXRjaCwgY2F0Y2ggdXAgYXQgb25jZS4gKi9cbiAgcHJpdmF0ZSBzZWVuKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy52aWV3ZXJzLnRvdWNoKCkgfHwgdGhpcy5zdG9wcGVkKSByZXR1cm5cbiAgICB0aGlzLmtpY2soKVxuICAgIHRoaXMub25jZSgnd2FrZS1zdWJhZ2VudHMnLCA4MDAsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB9KVxuICAgIHRoaXMub25jZSgnd2FrZS1hY2NvdW50cycsIDEyMDAsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGtpY2soKTogdm9pZCB7XG4gICAgdGhpcy5vbmNlKCdraWNrLW9yY2hlc3RyYXRpb24nLCA0MDAsICgpID0+IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKCkpXG4gICAgdGhpcy5vbmNlKCdraWNrLWFnZW50cycsIDYwMCwgKCkgPT4gdGhpcy5hZ2VudHMuc2NhbigpKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwZXJzaXN0KGZvcmNlID0gZmFsc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWZvcmNlICYmIHRoaXMuc3RvcmUuc2VxID09PSB0aGlzLnBlcnNpc3RlZFNlcSkgcmV0dXJuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdGVuY2Uuc2F2ZVNuYXBzaG90KHRoaXMuc3RvcmUuc25hcHNob3QoKSlcbiAgICAgIHRoaXMucGVyc2lzdGVkU2VxID0gdGhpcy5zdG9yZS5zZXFcbiAgICAgIGF3YWl0IHRoaXMuaGlzdG9yeS5zYXZlQ2hhbmdlZFJ1bnMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYHBlcnNpc3QgZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKiBVc2VzIHRoZSBkb2N1bWVudGVkIGBvcmNhIHBsdWdpbiBvcGVuYCB0byBzaG93IHRoaXMgcGx1Z2luJ3MgcGFuZWwuICovXG4gIHByaXZhdGUgYXN5bmMgc2hvd1BhbmVsKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgbGlzdCA9IGF3YWl0IHRoaXMuY3R4LmNsaS5ydW48eyBwbHVnaW5zPzogeyBrZXk/OiBzdHJpbmc7IGlkPzogc3RyaW5nIH1bXSB9IHwgeyBrZXk/OiBzdHJpbmc7IGlkPzogc3RyaW5nIH1bXT4oWydwbHVnaW4nLCAnbGlzdCddLCB7IHRpbWVvdXRNczogODAwMCB9KVxuICAgIGlmICghbGlzdC5vaykgcmV0dXJuIGBDb3VsZCBub3QgZmluZCB0aGUgQWdlbnQgRmxvdyBwYW5lbDogJHtsaXN0Lm1lc3NhZ2V9YFxuICAgIGNvbnN0IHJvd3MgPSBBcnJheS5pc0FycmF5KGxpc3QucmVzdWx0KSA/IGxpc3QucmVzdWx0IDogKGxpc3QucmVzdWx0LnBsdWdpbnMgPz8gW10pXG4gICAgY29uc3Qga2V5ID0gcm93cy5maW5kKChyb3cpID0+IHJvdy5pZCA9PT0gJ2FnZW50LWZsb3cnIHx8IHJvdy5rZXk/LmVuZHNXaXRoKCcuYWdlbnQtZmxvdycpKT8ua2V5XG4gICAgaWYgKCFrZXkpIHJldHVybiAnQWdlbnQgRmxvdyBpcyBub3QgbGlzdGVkIGFzIGluc3RhbGxlZC4nXG4gICAgY29uc3Qgb3BlbmVkID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bihbJ3BsdWdpbicsICdvcGVuJywga2V5LCAnLS1wYW5lbCcsICdmbG93J10sIHsgdGltZW91dE1zOiA4MDAwIH0pXG4gICAgcmV0dXJuIG9wZW5lZC5vayA/ICdBZ2VudCBGbG93IHBhbmVsIG9wZW5lZC4nIDogYENvdWxkIG5vdCBvcGVuIHRoZSBwYW5lbDogJHtvcGVuZWQubWVzc2FnZX1gXG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMub3JjYS5ob3N0Lmhhcygnc3RhdHVzQmFyLnVwZGF0ZScpKSByZXR1cm5cbiAgICBjb25zdCBhZ2VudHMgPSBPYmplY3QudmFsdWVzKHRoaXMuc3RvcmUucmVhZCgpLmFnZW50cylcbiAgICBjb25zdCBydW5uaW5nID0gYWdlbnRzLmZpbHRlcigoYWdlbnQpID0+IGFnZW50LmxpdmUgJiYgKGFnZW50LnN0YXRlID09PSAnd29ya2luZycgfHwgYWdlbnQuc3RhdGUgPT09ICdibG9ja2VkJyB8fCBhZ2VudC5zdGF0ZSA9PT0gJ3dhaXRpbmcnKSkubGVuZ3RoXG4gICAgY29uc3QgYmxvY2tlZCA9IGFnZW50cy5maWx0ZXIoKGFnZW50KSA9PiBhZ2VudC5saXZlICYmIGFnZW50LnN0YXRlID09PSAnYmxvY2tlZCcpLmxlbmd0aFxuICAgIGNvbnN0IGtleSA9IGAke3J1bm5pbmd9fCR7YmxvY2tlZH1gXG4gICAgaWYgKGtleSA9PT0gdGhpcy5zdGF0dXNLZXkpIHJldHVyblxuICAgIHRoaXMuc3RhdHVzS2V5ID0ga2V5XG4gICAgdm9pZCB0aGlzLm9yY2EuaG9zdFxuICAgICAgLmNhbGwoJ3N0YXR1c0Jhci51cGRhdGUnLCB7XG4gICAgICAgIGlkOiAnYWdlbnQtZmxvdy1zdGF0dXMnLFxuICAgICAgICB0ZXh0OiBydW5uaW5nID8gYEFnZW50IEZsb3cgXHUwMEI3ICR7cnVubmluZ30gcnVubmluZyR7YmxvY2tlZCA/IGAgXHUwMEI3ICR7YmxvY2tlZH0gYmxvY2tlZGAgOiAnJ31gIDogJ0FnZW50IEZsb3cgXHUwMEI3IGlkbGUnLFxuICAgICAgICB0b25lOiBibG9ja2VkID8gJ3dhcm5pbmcnIDogcnVubmluZyA/ICdhY2NlbnQnIDogJ25ldXRyYWwnLFxuICAgICAgICB0b29sdGlwOiAnTGl2ZSBhZ2VudHMgc2VlbiBieSBBZ2VudCBGbG93J1xuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIHRoaXMuc3RhdHVzS2V5ID0gJydcbiAgICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHB1Ymxpc2hDYXBhYmlsaXRpZXMoKTogdm9pZCB7XG4gICAgY29uc3QgaG9zdE1ldGhvZHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+ID0ge31cbiAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBIT1NUX01FVEhPRFMpIGhvc3RNZXRob2RzW21ldGhvZF0gPSB0aGlzLm9yY2EuaG9zdC5oYXMobWV0aG9kKVxuICAgIGNvbnN0IHByb2JlID0geyBob3N0SGFzOiAobTogc3RyaW5nKSA9PiB0aGlzLm9yY2EuaG9zdC5oYXMobSksIGNsaTogQm9vbGVhbih0aGlzLmN0eC5jbGkucGF0aCksIGFjdEFzQ29vcmRpbmF0b3I6IHRoaXMuc2V0dGluZ3MuYWN0QXNDb29yZGluYXRvciB9XG4gICAgY29uc3QgY29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIGNvbW1hbmRBdmFpbGFiaWxpdHk+PiA9IHt9XG4gICAgZm9yIChjb25zdCBraW5kIG9mIEFMTF9DT01NQU5EUykgY29tbWFuZHNba2luZF0gPSBjb21tYW5kQXZhaWxhYmlsaXR5KGtpbmQsIHByb2JlKVxuICAgIHRoaXMuc3RvcmUucHV0KHtcbiAgICAgIGVudGl0eTogJ2NhcGFiaWxpdGllcycsXG4gICAgICBpZDogJ2NhcGFiaWxpdGllcycsXG4gICAgICB2YWx1ZToge1xuICAgICAgICBob3N0TWV0aG9kcyxcbiAgICAgICAgY29tbWFuZHMsXG4gICAgICAgIGFjdEFzQ29vcmRpbmF0b3I6IHRoaXMuc2V0dGluZ3MuYWN0QXNDb29yZGluYXRvcixcbiAgICAgICAgY2hhdFNlbmQ6IHRoaXMuc2V0dGluZ3MuY2hhdFNlbmQsXG4gICAgICAgIGRhc2hib2FyZENvbnRyb2xzOiB0aGlzLnNldHRpbmdzLmRhc2hib2FyZENvbnRyb2xzLFxuICAgICAgICBjbGlBdmFpbGFibGU6IEJvb2xlYW4odGhpcy5jdHguY2xpLnBhdGgpLFxuICAgICAgICBjbGlQYXRoOiB0aGlzLmN0eC5jbGkucGF0aCxcbiAgICAgICAgaG9va3M6IHRydWUsXG4gICAgICAgIGRhc2hib2FyZDogeyBlbmFibGVkOiBCb29sZWFuKHRoaXMuZGFzaGJvYXJkKSwgdXJsOiB0aGlzLmRhc2hib2FyZCA/ICdydW5uaW5nJyA6IG51bGwgfSxcbiAgICAgICAgYXBpTWlub3I6IHRoaXMub3JjYS5hcGkubWlub3IsXG4gICAgICAgIGhvbWVEaXI6IGhvbWVkaXIoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRTZXR0aW5ncygpOiBQcm9taXNlPFNldHRpbmdzPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhdyA9IGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5nZXQoKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLy8gVW5zZXQgbWVhbnMgdGhlIGRlZmF1bHQgKG9uKTsgb25seSBhbiBleHBsaWNpdCBmYWxzZSB0dXJucyBhIHNldHRpbmcgb2ZmLlxuICAgICAgICBkYXNoYm9hcmRFbmFibGVkOiByYXcuZGFzaGJvYXJkRW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICAgIGRhc2hib2FyZFBvcnQ6IHR5cGVvZiByYXcuZGFzaGJvYXJkUG9ydCA9PT0gJ251bWJlcicgJiYgcmF3LmRhc2hib2FyZFBvcnQgPj0gMTAyNCAmJiByYXcuZGFzaGJvYXJkUG9ydCA8PSA2NTAwMCA/IHJhdy5kYXNoYm9hcmRQb3J0IDogNDc5MCxcbiAgICAgICAgZGFzaGJvYXJkQ29udHJvbHM6IHJhdy5kYXNoYm9hcmRDb250cm9scyAhPT0gZmFsc2UsXG4gICAgICAgIGFjdEFzQ29vcmRpbmF0b3I6IHJhdy5hY3RBc0Nvb3JkaW5hdG9yICE9PSBmYWxzZSxcbiAgICAgICAgY2xpUGF0aDogdHlwZW9mIHJhdy5jbGlQYXRoID09PSAnc3RyaW5nJyA/IHJhdy5jbGlQYXRoLnRyaW0oKSA6ICcnLFxuICAgICAgICBjaGF0U2VuZDogcmF3LmNoYXRTZW5kICE9PSBmYWxzZSxcbiAgICAgICAgY2hlY2tVcGRhdGVzOiByYXcuY2hlY2tVcGRhdGVzICE9PSBmYWxzZVxuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIERFRkFVTFRfU0VUVElOR1NcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG9uU2V0dGluZ3NDaGFuZ2VkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJlZm9yZSA9IHRoaXMuc2V0dGluZ3NcbiAgICB0aGlzLnNldHRpbmdzID0gYXdhaXQgdGhpcy5yZWFkU2V0dGluZ3MoKVxuICAgIGlmIChiZWZvcmUuY2xpUGF0aCAhPT0gdGhpcy5zZXR0aW5ncy5jbGlQYXRoKSB7XG4gICAgICB0aGlzLmN0eC5jbGkgPSBjcmVhdGVDbGlSdW5uZXIoYXdhaXQgcmVzb2x2ZUNsaVBhdGgodGhpcy5zZXR0aW5ncy5jbGlQYXRoIHx8IG51bGwpKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnN5bmNEYXNoYm9hcmQoZmFsc2UpXG4gICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgfVxuXG4gIC8qKiBTZXJpYWxpemVkOiBvdmVybGFwcGluZyBvbi9vZmYgcmVxdWVzdHMgY2FuIG5ldmVyIGxlYXZlIGEgc3RyYXkgc2VydmVyIHJ1bm5pbmcuICovXG4gIHByaXZhdGUgc3luY0Rhc2hib2FyZChyb3RhdGVUb2tlbjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGFzaGJvYXJkT3AgPSB0aGlzLmRhc2hib2FyZE9wLmNhdGNoKCgpID0+IHVuZGVmaW5lZCkudGhlbigoKSA9PiB0aGlzLnN5bmNEYXNoYm9hcmROb3cocm90YXRlVG9rZW4pKVxuICAgIHJldHVybiB0aGlzLmRhc2hib2FyZE9wXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN5bmNEYXNoYm9hcmROb3cocm90YXRlVG9rZW46IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB3YW50ID0gdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRFbmFibGVkICYmICF0aGlzLnN0b3BwZWRcbiAgICBpZiAodGhpcy5kYXNoYm9hcmQgJiYgKCF3YW50IHx8IHJvdGF0ZVRva2VuKSkge1xuICAgICAgYXdhaXQgdGhpcy5kYXNoYm9hcmQuc3RvcCgpXG4gICAgICB0aGlzLmRhc2hib2FyZCA9IG51bGxcbiAgICB9XG4gICAgaWYgKCF3YW50IHx8IHRoaXMuZGFzaGJvYXJkKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hDYXBhYmlsaXRpZXMoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm90ZWN0aW9uID0gdGhpcy5vcmNhLmhvc3QuaGFzKCdzZWNyZXRzLnByb3RlY3Rpb24nKSA/IChhd2FpdCB0aGlzLm9yY2EuaG9zdC5jYWxsKCdzZWNyZXRzLnByb3RlY3Rpb24nLCB7fSkpLnN0YXR1cyA6ICd1bmF2YWlsYWJsZSdcbiAgICAgIC8vIFR1cm5pbmcgdGhlIGRhc2hib2FyZCBvbiBpc3N1ZXMgYSBuZXcgdG9rZW4sIHNvIGFuIG9sZCBsaW5rIHN0b3BzIHdvcmtpbmcuXG4gICAgICBjb25zdCB0b2tlbiA9IHJvdGF0ZVRva2VuID8gYXdhaXQgcm90YXRlRGFzaGJvYXJkVG9rZW4odGhpcy5vcmNhLnNlY3JldHMsIHByb3RlY3Rpb24sIHN0YXRlRGlyKCkpIDogYXdhaXQgbG9hZE9yQ3JlYXRlVG9rZW4odGhpcy5vcmNhLnNlY3JldHMsIHByb3RlY3Rpb24sIHN0YXRlRGlyKCkpXG4gICAgICBjb25zdCBzZXJ2ZXIgPSBuZXcgRGFzaGJvYXJkU2VydmVyKHtcbiAgICAgICAgdWlEaXI6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi91aS8nLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICAgdG9rZW4sXG4gICAgICAgIHBvcnQ6IHRoaXMuc2V0dGluZ3MuZGFzaGJvYXJkUG9ydCxcbiAgICAgICAgYWxsb3dDb250cm9sczogKCkgPT4gdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRDb250cm9scyxcbiAgICAgICAgc25hcHNob3Q6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnN0b3JlLnNuYXBzaG90KClcbiAgICAgICAgfSxcbiAgICAgICAgc3Vic2NyaWJlOiAobGlzdGVuZXIpID0+IHRoaXMuc3RvcmUuc3Vic2NyaWJlKGxpc3RlbmVyKSxcbiAgICAgICAgc3Vic2NyaWJlT3V0cHV0OiAobGlzdGVuZXIpID0+IHRoaXMub3V0cHV0V2F0Y2hlci5zdWJzY3JpYmUobGlzdGVuZXIpLFxuICAgICAgICBjb21tYW5kOiAoaW5wdXQsIGFsbG93ZWQpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnJvdXRlci5oYW5kbGUoaW5wdXQsIGFsbG93ZWQpXG4gICAgICAgIH0sXG4gICAgICAgIGxvZzogdGhpcy5jdHgubG9nXG4gICAgICB9KVxuICAgICAgYXdhaXQgc2VydmVyLnN0YXJ0KClcbiAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRFbmFibGVkIHx8IHRoaXMuc3RvcHBlZCkgYXdhaXQgc2VydmVyLnN0b3AoKVxuICAgICAgZWxzZSB0aGlzLmRhc2hib2FyZCA9IHNlcnZlclxuICAgICAgdGhpcy5kYXNoYm9hcmRSZXRyaWVzID0gMFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGRhc2hib2FyZCBjb3VsZCBub3Qgc3RhcnQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgICAvLyBPZnRlbiB0cmFuc2llbnQgKE9yY2EgcmUtY2hlY2tpbmcgYXBwcm92YWwgZHVyaW5nIGEgcmVsb2FkLCB0aGUgcG9ydCBzdGlsbCBjbG9zaW5nKTpcbiAgICAgIC8vIHRyeSBhZ2FpbiB3aXRoIGJhY2tvZmYgaW5zdGVhZCBvZiBzdGF5aW5nIG9mZiB1bnRpbCB0aGUgbmV4dCBzZXR0aW5ncyBjaGFuZ2UuXG4gICAgICBpZiAodGhpcy5kYXNoYm9hcmRSZXRyaWVzIDwgREFTSEJPQVJEX1JFVFJJRVMpIHtcbiAgICAgICAgY29uc3QgZGVsYXkgPSAyMDAwICogMiAqKiB0aGlzLmRhc2hib2FyZFJldHJpZXMrK1xuICAgICAgICB0aGlzLm9uY2UoJ2Rhc2hib2FyZC1yZXRyeScsIGRlbGF5LCAoKSA9PiB0aGlzLnN5bmNEYXNoYm9hcmQoZmFsc2UpKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnB1Ymxpc2hDYXBhYmlsaXRpZXMoKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkTGFiZWxzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByYXcgPSAoYXdhaXQgdGhpcy5vcmNhLnN0b3JhZ2UuZ2V0KCdsYWJlbHMnKSkgYXMgUGFydGlhbDxMYWJlbENvbmZpZz4gfCBudWxsXG4gICAgICBpZiAocmF3ICYmIHR5cGVvZiByYXcgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIHRoaXMuc3RvcmUucHV0KHsgZW50aXR5OiAnbGFiZWxzJywgaWQ6ICdsYWJlbHMnLCB2YWx1ZTogeyAuLi5FTVBUWV9MQUJFTFMsIC4uLnJhdyB9IGFzIExhYmVsQ29uZmlnIH0pXG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBsYWJlbHMgYXJlIG9wdGlvbmFsXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlTGFiZWxzKGxhYmVsczogTGFiZWxDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLm9yY2Euc3RvcmFnZS5zZXQoJ2xhYmVscycsIGxhYmVscyBhcyBuZXZlcilcbiAgICB0aGlzLnN0b3JlLnB1dCh7IGVudGl0eTogJ2xhYmVscycsIGlkOiAnbGFiZWxzJywgdmFsdWU6IGxhYmVscyB9KVxuICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gIH1cbn1cbiIsICIvLyBDb21tYW5kIGNvbnRyYWN0IGJldHdlZW4gZXZlcnkgVUkgYW5kIHRoZSB3b3JrZXIuIFRoZSB3b3JrZXIgcmUtdmFsaWRhdGVzIGV2ZXJ5IGZpZWxkO1xuLy8gVUlzIHVzZSB0aGUgc2FtZSB2YWxpZGF0b3JzIHRvIGRpc2FibGUgaW52YWxpZCBhY3Rpb25zIGVhcmx5LlxuXG5leHBvcnQgdHlwZSBDb21tYW5kS2luZCA9XG4gIHwgJ3Rlcm1pbmFsLmZvY3VzJ1xuICB8ICd0ZXJtaW5hbC5yZWFkJ1xuICB8ICdhZ2VudC5sYXVuY2gnXG4gIHwgJ2FnZW50LnJlc3VtZSdcbiAgfCAnYWdlbnQuc3RvcCdcbiAgfCAnYWdlbnQucmVhZE91dHB1dCdcbiAgfCAndGFzay5jcmVhdGUnXG4gIHwgJ3Rhc2sudXBkYXRlJ1xuICB8ICd0YXNrLmNhbmNlbCdcbiAgfCAndGFzay5yZXRyeSdcbiAgfCAndGFzay5kaXNwYXRjaCdcbiAgfCAnZ2F0ZS5yZXNvbHZlJ1xuICB8ICd3b3JrdHJlZS5jcmVhdGUnXG4gIHwgJ3dvcmt0cmVlLm9wZW4nXG4gIHwgJ3dvcmt0cmVlLmluc3BlY3QnXG4gIHwgJ21lc3NhZ2Uuc2VuZCdcbiAgfCAnbW9kZWwuY2hhbmdlJ1xuICB8ICdsYWJlbHMudXBkYXRlJ1xuICB8ICdoaXN0b3J5Lmxpc3QnXG4gIHwgJ2hpc3RvcnkubG9hZCdcbiAgfCAnZGFzaGJvYXJkLmluZm8nXG4gIHwgJ2VudGl0eS5kZXRhaWwnXG4gIHwgJ2Rhc2hib2FyZC5lbmFibGUnXG4gIHwgJ2Rhc2hib2FyZC5jb250cm9scydcbiAgfCAnYWdlbnQucHJvbXB0J1xuICB8ICdhZ2VudC5pbWFnZSdcbiAgfCAndmlld2VyLnBpbmcnXG4gIHwgJ2FnZW50LmF0dGFjaCdcbiAgfCAnc3Rhci52aXNpdCdcbiAgfCAnc3Rhci5hbnN3ZXInXG4gIHwgJ3VwZGF0ZS5jaGVjaydcbiAgfCAndXBkYXRlLnJ1bidcblxuZXhwb3J0IHR5cGUgQ29tbWFuZFJlcXVlc3QgPSB7XG4gIHJlcXVlc3RJZDogc3RyaW5nXG4gIGtpbmQ6IENvbW1hbmRLaW5kXG4gIHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgLyoqIFNldCBieSB0aGUgVUkgb25seSBhZnRlciBhIGNvbmZpcm1hdGlvbiBkaWFsb2cgZm9yIGRlc3RydWN0aXZlIGNvbW1hbmRzLiAqL1xuICBjb25maXJtZWQ/OiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIENvbW1hbmRFcnJvciA9IHsgY29kZTogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfVxuXG4vKiogRm9yIGNvb3JkaW5hdG9yLW9ubHkgb3JjaGVzdHJhdGlvbiBhY3Rpb25zOiB0aGUgZXhhY3QgQ0xJIGNvbW1hbmQgdGhlIGNvb3JkaW5hdG9yIGNhbiBydW4uICovXG5leHBvcnQgdHlwZSBNYW51YWxTdGVwID0geyBjb21tYW5kOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cblxuZXhwb3J0IHR5cGUgQ29tbWFuZFJlc3BvbnNlID0geyBvazogdHJ1ZTsgcmVzdWx0OiB1bmtub3duIH0gfCB7IG9rOiBmYWxzZTsgZXJyb3I6IENvbW1hbmRFcnJvcjsgbWFudWFsPzogTWFudWFsU3RlcCB9XG5cbi8qKiBIb3cgYSBjb21tYW5kIHJlYWNoZXMgT3JjYSwgcmVwb3J0ZWQgdG8gdGhlIFVJIHNvIGl0IGNhbiBlbmFibGUvZGlzYWJsZSBjb250cm9scyBob25lc3RseS4gKi9cbmV4cG9ydCB0eXBlIENvbW1hbmRBdmFpbGFiaWxpdHkgPSB7XG4gIGF2YWlsYWJsZTogYm9vbGVhblxuICBtb2RlOiAnZGlyZWN0JyB8ICdjb29yZGluYXRvcicgfCAndW5zdXBwb3J0ZWQnXG4gIHJlYXNvbjogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgREVTVFJVQ1RJVkVfQ09NTUFORFM6IFJlYWRvbmx5U2V0PENvbW1hbmRLaW5kPiA9IG5ldyBTZXQoWydhZ2VudC5zdG9wJywgJ3Rhc2suY2FuY2VsJ10pXG5cbmV4cG9ydCBjb25zdCBBTExfQ09NTUFORFM6IHJlYWRvbmx5IENvbW1hbmRLaW5kW10gPSBbXG4gICd0ZXJtaW5hbC5mb2N1cycsICd0ZXJtaW5hbC5yZWFkJywgJ2FnZW50LmxhdW5jaCcsICdhZ2VudC5yZXN1bWUnLCAnYWdlbnQuc3RvcCcsICdhZ2VudC5yZWFkT3V0cHV0JyxcbiAgJ3Rhc2suY3JlYXRlJywgJ3Rhc2sudXBkYXRlJywgJ3Rhc2suY2FuY2VsJywgJ3Rhc2sucmV0cnknLCAndGFzay5kaXNwYXRjaCcsICdnYXRlLnJlc29sdmUnLFxuICAnd29ya3RyZWUuY3JlYXRlJywgJ3dvcmt0cmVlLm9wZW4nLCAnd29ya3RyZWUuaW5zcGVjdCcsICdtZXNzYWdlLnNlbmQnLCAnbW9kZWwuY2hhbmdlJyxcbiAgJ2xhYmVscy51cGRhdGUnLCAnaGlzdG9yeS5saXN0JywgJ2hpc3RvcnkubG9hZCcsICdkYXNoYm9hcmQuaW5mbycsICdlbnRpdHkuZGV0YWlsJywgJ2Rhc2hib2FyZC5lbmFibGUnLCAnZGFzaGJvYXJkLmNvbnRyb2xzJywgJ2FnZW50LnByb21wdCcsICdhZ2VudC5pbWFnZScsICd2aWV3ZXIucGluZycsICdhZ2VudC5hdHRhY2gnLCAnc3Rhci52aXNpdCcsICdzdGFyLmFuc3dlcicsICd1cGRhdGUuY2hlY2snLCAndXBkYXRlLnJ1bidcbl1cblxuLyoqIENvbW1hbmRzIHRoYXQgb25seSByZWFkIHN0YXRlOyBzYWZlIGZvciB0aGUgZGFzaGJvYXJkIHdpdGhvdXQgY29udHJvbCByaWdodHMuICovXG5leHBvcnQgY29uc3QgUkVBRF9PTkxZX0NPTU1BTkRTOiBSZWFkb25seVNldDxDb21tYW5kS2luZD4gPSBuZXcgU2V0KFtcbiAgJ3Rlcm1pbmFsLnJlYWQnLCAnYWdlbnQucmVhZE91dHB1dCcsICd3b3JrdHJlZS5pbnNwZWN0JywgJ2hpc3RvcnkubGlzdCcsICdoaXN0b3J5LmxvYWQnLCAnZGFzaGJvYXJkLmluZm8nLCAnZW50aXR5LmRldGFpbCcsICdhZ2VudC5pbWFnZScsICd2aWV3ZXIucGluZycsXG4gIC8vIE9ubHkgQWdlbnQgRmxvdydzIG93biBcInN0YXIgdGhlIHByb2plY3RcIiBwcm9tcHQgc3RhdGU7IG5vdGhpbmcgaW4gT3JjYSBjaGFuZ2VzLlxuICAnc3Rhci52aXNpdCcsICdzdGFyLmFuc3dlcicsICd1cGRhdGUuY2hlY2snXG5dKVxuXG5leHBvcnQgY2xhc3MgVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb2RlID0gJ2ludmFsaWRfcGFyYW1zJ1xufVxuXG50eXBlIEZpZWxkU3BlYyA9XG4gIHwgeyB0eXBlOiAnc3RyaW5nJzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXg/OiBudW1iZXI7IHBhdHRlcm4/OiBSZWdFeHA7IG9uZU9mPzogcmVhZG9ubHkgc3RyaW5nW10gfVxuICB8IHsgdHlwZTogJ2Jvb2xlYW4nOyByZXF1aXJlZD86IGJvb2xlYW4gfVxuICB8IHsgdHlwZTogJ3N0cmluZ0FycmF5JzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXhJdGVtcz86IG51bWJlcjsgcGF0dGVybj86IFJlZ0V4cCB9XG4gIHwgeyB0eXBlOiAncmVjb3JkJzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXhLZXlzPzogbnVtYmVyIH1cblxuY29uc3QgSUQgPSAvXltBLVphLXowLTlfOi5cXC0vQF17MSw0MDB9JC9cbmNvbnN0IEFHRU5UID0gL15bYS16MC05XVthLXowLTktXXswLDQwfSQvXG5jb25zdCBVVUlEID0gL15bMC05YS1mXXs4fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXsxMn0kL1xuY29uc3QgTU9ERUwgPSAvXltBLVphLXowLTlfLjpAL1xcLVtcXF1dezEsMTIwfSQvXG5jb25zdCBFRkZPUlQgPSAvXlthLXpdezEsMjB9JC9cbmNvbnN0IFRBU0tfU1RBVFVTID0gWydwZW5kaW5nJywgJ3JlYWR5JywgJ2Rpc3BhdGNoZWQnLCAnY29tcGxldGVkJywgJ2ZhaWxlZCcsICdibG9ja2VkJ10gYXMgY29uc3RcbmV4cG9ydCBjb25zdCBXT1JLVFJFRV9NT0RFUyA9IFsnbmV3LWNoaWxkJywgJ2N1cnJlbnQnXSBhcyBjb25zdFxuXG5leHBvcnQgY29uc3QgQ09NTUFORF9QQVJBTVM6IFJlY29yZDxDb21tYW5kS2luZCwgUmVjb3JkPHN0cmluZywgRmllbGRTcGVjPj4gPSB7XG4gICd0ZXJtaW5hbC5mb2N1cyc6IHsgdGVybWluYWxJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ3Rlcm1pbmFsLnJlYWQnOiB7IHRlcm1pbmFsSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9IH0sXG4gICdhZ2VudC5sYXVuY2gnOiB7XG4gICAgd29ya3NwYWNlSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIGFnZW50OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogQUdFTlQgfSxcbiAgICBwcm9tcHQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogMjAwMDAgfVxuICB9LFxuICAnYWdlbnQucmVzdW1lJzoge1xuICAgIHdvcmtzcGFjZUlkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IEFHRU5UIH0sXG4gICAgc2Vzc2lvbklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfVxuICB9LFxuICAnYWdlbnQuc3RvcCc6IHsgYWdlbnRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ2FnZW50LnJlYWRPdXRwdXQnOiB7XG4gICAgYWdlbnRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgYmVmb3JlOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMCwgcGF0dGVybjogL15bQS1aYS16MC05Xy46LV17MSwyMDB9JC8gfSxcbiAgICAvKiogVGhlIHZlcnNpb24gdGhlIHZpZXcgYWxyZWFkeSBzaG93czogYW4gdW5jaGFuZ2VkIGFuc3dlciBpcyB0aGVuIHNlbnQgYXMgYHsgdW5jaGFuZ2VkOiB0cnVlIH1gLiAqL1xuICAgIHNpbmNlOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDY0LCBwYXR0ZXJuOiAvXlthLWYwLTldezgsNjR9JC8gfVxuICB9LFxuICAndGFzay5jcmVhdGUnOiB7XG4gICAgcnVuSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHRpdGxlOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgbWF4OiAyMDAgfSxcbiAgICBzcGVjOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgbWF4OiA2MDAwMCB9LFxuICAgIGRlcHM6IHsgdHlwZTogJ3N0cmluZ0FycmF5JywgbWF4SXRlbXM6IDUwLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHBhcmVudElkOiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBJRCB9XG4gIH0sXG4gICd0YXNrLnVwZGF0ZSc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBvbmVPZjogVEFTS19TVEFUVVMgfSxcbiAgICByZXN1bHQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogNDAwMCB9XG4gIH0sXG4gICd0YXNrLmNhbmNlbCc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfVxuICB9LFxuICAndGFzay5yZXRyeSc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogQUdFTlQgfSxcbiAgICBtb2RlbDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogTU9ERUwgfSxcbiAgICBlZmZvcnQ6IHsgdHlwZTogJ3N0cmluZycsIHBhdHRlcm46IEVGRk9SVCB9LFxuICAgIHdvcmt0cmVlOiB7IHR5cGU6ICdzdHJpbmcnLCBvbmVPZjogV09SS1RSRUVfTU9ERVMgfVxuICB9LFxuICAndGFzay5kaXNwYXRjaCc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogQUdFTlQgfSxcbiAgICBtb2RlbDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogTU9ERUwgfSxcbiAgICBlZmZvcnQ6IHsgdHlwZTogJ3N0cmluZycsIHBhdHRlcm46IEVGRk9SVCB9LFxuICAgIHdvcmt0cmVlOiB7IHR5cGU6ICdzdHJpbmcnLCBvbmVPZjogV09SS1RSRUVfTU9ERVMgfVxuICB9LFxuICAnZ2F0ZS5yZXNvbHZlJzoge1xuICAgIGdhdGVJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgcnVuSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJlc29sdXRpb246IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDQwMDAgfVxuICB9LFxuICAnd29ya3RyZWUuY3JlYXRlJzoge1xuICAgIHByb2plY3RJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJywgbWF4OiAxMjAgfSxcbiAgICBiYXNlQnJhbmNoOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMCB9LFxuICAgIGFnZW50OiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBBR0VOVCB9LFxuICAgIHByb21wdDogeyB0eXBlOiAnc3RyaW5nJywgbWF4OiAyMDAwMCB9XG4gIH0sXG4gICd3b3JrdHJlZS5vcGVuJzogeyB3b3Jrc3BhY2VJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ3dvcmt0cmVlLmluc3BlY3QnOiB7IHBhdGg6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDEwMDAgfSB9LFxuICAnbWVzc2FnZS5zZW5kJzoge1xuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICB0bzogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgc3ViamVjdDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogMjAwIH0sXG4gICAgYm9keTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogMjAwMDAgfVxuICB9LFxuICAnbW9kZWwuY2hhbmdlJzoge1xuICAgIGFnZW50SWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIG1vZGVsOiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBNT0RFTCB9LFxuICAgIGVmZm9ydDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogRUZGT1JUIH1cbiAgfSxcbiAgJ2xhYmVscy51cGRhdGUnOiB7XG4gICAgYWNjb3VudFRlYW1zOiB7IHR5cGU6ICdyZWNvcmQnLCBtYXhLZXlzOiAxMDAgfSxcbiAgICBhZ2VudFJvbGVzOiB7IHR5cGU6ICdyZWNvcmQnLCBtYXhLZXlzOiAxMDAgfSxcbiAgICBwcm9qZWN0TmFtZXM6IHsgdHlwZTogJ3JlY29yZCcsIG1heEtleXM6IDIwMCB9LFxuICAgIHByb2plY3RDb2xvcnM6IHsgdHlwZTogJ3JlY29yZCcsIG1heEtleXM6IDIwMCB9LFxuICAgIHByb2plY3RSdWxlczogeyB0eXBlOiAncmVjb3JkJywgbWF4S2V5czogMTAwIH0sXG4gICAgbGVhZEFjY291bnQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogMzAwIH1cbiAgfSxcbiAgJ2hpc3RvcnkubGlzdCc6IHt9LFxuICAnaGlzdG9yeS5sb2FkJzogeyBydW5JZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ2Rhc2hib2FyZC5pbmZvJzoge30sXG4gIC8qKiBBIHZpc2libGUgVUkgc2F5cyBpdCBpcyBzdGlsbCBvcGVuLCBzbyB0aGUgd29ya2VyIGtlZXBzIGl0cyBmYXN0IHBhY2UuICovXG4gICd2aWV3ZXIucGluZyc6IHt9LFxuICAnYWdlbnQuaW1hZ2UnOiB7IGFnZW50SWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LCByZWY6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDIwMCwgcGF0dGVybjogL15bQS1aYS16MC05Xy46LV17MSwxMjB9XFx8XFxkezEsNH0oXFx8XFxkezEsNH0pPyQvIH0sIG9mZnNldDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogL15cXGR7MSw5fSQvIH0gfSxcbiAgJ2FnZW50LnByb21wdCc6IHtcbiAgICBhZ2VudElkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICB0ZXh0OiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMDAwIH0sXG4gICAgLyoqIEltYWdlcyB1cGxvYWRlZCB3aXRoIGFnZW50LmF0dGFjaCAodGhlaXIgaWRzLCBuZXZlciBwYXRocykuICovXG4gICAgYXR0YWNobWVudHM6IHsgdHlwZTogJ3N0cmluZ0FycmF5JywgbWF4SXRlbXM6IDUsIHBhdHRlcm46IFVVSUQgfVxuICB9LFxuICAvKiogUmVjb3JkcyB0b2RheSdzIHZpc2l0OyBhbnN3ZXJzIHdoZXRoZXIgdG8gc2hvdyB0aGUgXCJzdGFyIG9uIEdpdEh1YlwiIHByb21wdCBub3cuICovXG4gIC8qKiBJcyBhIG5ld2VyIHJlbGVhc2Ugb3V0PyAoaW5zdGFsbGVkIGNvcGllcyBvbmx5OyBjYWNoZWQgZm9yIDYgaG91cnMgdW5sZXNzIGZvcmNlZCkgKi9cbiAgJ3VwZGF0ZS5jaGVjayc6IHsgZm9yY2U6IHsgdHlwZTogJ2Jvb2xlYW4nIH0gfSxcbiAgLyoqIFJ1bnMgYG9yY2EgcGx1Z2luIHVwZGF0ZWAgZm9yIHRoaXMgcGx1Z2luLiAqL1xuICAndXBkYXRlLnJ1bic6IHt9LFxuICAnc3Rhci52aXNpdCc6IHt9LFxuICAnc3Rhci5hbnN3ZXInOiB7IGFuc3dlcjogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG9uZU9mOiBbJ3N0YXJyZWQnLCAnbGF0ZXInLCAnbmV2ZXInXSB9IH0sXG4gIC8qKiBPbmUgYmFzZTY0IGNodW5rIG9mIGFuIGltYWdlIGZvciB0aGUgbWVzc2FnZSBib3g7IHRoZSBsYXN0IG9uZSAoYGRvbmVgKSBzYXZlcyBpdC4gKi9cbiAgJ2FnZW50LmF0dGFjaCc6IHtcbiAgICB1cGxvYWRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IFVVSUQgfSxcbiAgICBtZWRpYVR5cGU6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBvbmVPZjogWydpbWFnZS9wbmcnLCAnaW1hZ2UvanBlZycsICdpbWFnZS93ZWJwJywgJ2ltYWdlL2dpZiddIH0sXG4gICAgY2h1bms6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDUwXzAwMCwgcGF0dGVybjogL15bQS1aYS16MC05Ky9dKj17MCwyfSQvIH0sXG4gICAgb2Zmc2V0OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogL15cXGR7MSw5fSQvIH0sXG4gICAgZG9uZTogeyB0eXBlOiAnYm9vbGVhbicgfVxuICB9LFxuICAnZGFzaGJvYXJkLmNvbnRyb2xzJzogeyBlbmFibGVkOiB7IHR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IHRydWUgfSB9LFxuICAnZGFzaGJvYXJkLmVuYWJsZSc6IHsgZW5hYmxlZDogeyB0eXBlOiAnYm9vbGVhbicsIHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgJ2VudGl0eS5kZXRhaWwnOiB7IGtleTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogNDIwLCBwYXR0ZXJuOiAvXih0YXNrfG1lc3NhZ2UpOltBLVphLXowLTlfOi5cXC1dezEsNDAwfSQvIH0gfVxufVxuXG4vKiogU3RyaWN0OiB1bmtub3duIGZpZWxkcyBhcmUgcmVmdXNlZCwgbGlrZSBPcmNhJ3Mgb3duIGhvc3QgQVBJLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29tbWFuZChpbnB1dDogdW5rbm93bik6IENvbW1hbmRSZXF1ZXN0IHtcbiAgaWYgKCFpc1JlY29yZChpbnB1dCkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoJ0NvbW1hbmQgbXVzdCBiZSBhbiBvYmplY3QuJylcbiAgY29uc3QgeyByZXF1ZXN0SWQsIGtpbmQsIHBhcmFtcywgY29uZmlybWVkIH0gPSBpbnB1dFxuICBpZiAodHlwZW9mIHJlcXVlc3RJZCAhPT0gJ3N0cmluZycgfHwgIS9eW0EtWmEtejAtOV8tXXs4LDgwfSQvLnRlc3QocmVxdWVzdElkKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcigncmVxdWVzdElkIGlzIG1pc3Npbmcgb3IgbWFsZm9ybWVkLicpXG4gIGlmICh0eXBlb2Yga2luZCAhPT0gJ3N0cmluZycgfHwgIShBTExfQ09NTUFORFMgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmluY2x1ZGVzKGtpbmQpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGBVbmtub3duIGNvbW1hbmQgXCIke1N0cmluZyhraW5kKX1cIi5gKVxuICBpZiAoY29uZmlybWVkICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNvbmZpcm1lZCAhPT0gJ2Jvb2xlYW4nKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdjb25maXJtZWQgbXVzdCBiZSBhIGJvb2xlYW4uJylcbiAgY29uc3Qgc3BlYyA9IENPTU1BTkRfUEFSQU1TW2tpbmQgYXMgQ29tbWFuZEtpbmRdXG4gIGNvbnN0IHJhdyA9IHBhcmFtcyA9PT0gdW5kZWZpbmVkID8ge30gOiBwYXJhbXNcbiAgaWYgKCFpc1JlY29yZChyYXcpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdwYXJhbXMgbXVzdCBiZSBhbiBvYmplY3QuJylcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3KSkgaWYgKCFPYmplY3QuaGFzT3duKHNwZWMsIGtleSkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoYFVua25vd24gZmllbGQgXCIke2tleX1cIiBmb3IgJHtraW5kfS5gKVxuICBjb25zdCBjbGVhbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fVxuICBmb3IgKGNvbnN0IFtrZXksIGZpZWxkXSBvZiBPYmplY3QuZW50cmllcyhzcGVjKSkge1xuICAgIGNvbnN0IHZhbHVlID0gcmF3W2tleV1cbiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gJycpIHtcbiAgICAgIGlmIChmaWVsZC5yZXF1aXJlZCkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHtrZXl9IGlzIHJlcXVpcmVkIGZvciAke2tpbmR9LmApXG4gICAgICBjb250aW51ZVxuICAgIH1cbiAgICBjbGVhbltrZXldID0gY2hlY2tGaWVsZChraW5kLCBrZXksIGZpZWxkLCB2YWx1ZSlcbiAgfVxuICByZXR1cm4geyByZXF1ZXN0SWQsIGtpbmQ6IGtpbmQgYXMgQ29tbWFuZEtpbmQsIHBhcmFtczogY2xlYW4sIGNvbmZpcm1lZDogY29uZmlybWVkID09PSB0cnVlIH1cbn1cblxuZnVuY3Rpb24gY2hlY2tGaWVsZChraW5kOiBzdHJpbmcsIGtleTogc3RyaW5nLCBmaWVsZDogRmllbGRTcGVjLCB2YWx1ZTogdW5rbm93bik6IHVua25vd24ge1xuICBjb25zdCB3aGVyZSA9IGAke2tleX0gZm9yICR7a2luZH1gXG4gIHN3aXRjaCAoZmllbGQudHlwZSkge1xuICAgIGNhc2UgJ3N0cmluZyc6IHtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBtdXN0IGJlIGEgc3RyaW5nLmApXG4gICAgICBpZiAoZmllbGQubWF4ICE9PSB1bmRlZmluZWQgJiYgdmFsdWUubGVuZ3RoID4gZmllbGQubWF4KSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBpcyBsb25nZXIgdGhhbiAke2ZpZWxkLm1heH0gY2hhcmFjdGVycy5gKVxuICAgICAgaWYgKGZpZWxkLnBhdHRlcm4gJiYgIWZpZWxkLnBhdHRlcm4udGVzdCh2YWx1ZSkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoYCR7d2hlcmV9IGhhcyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBhbGxvd2VkLmApXG4gICAgICBpZiAoZmllbGQub25lT2YgJiYgIWZpZWxkLm9uZU9mLmluY2x1ZGVzKHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBvbmUgb2YgJHtmaWVsZC5vbmVPZi5qb2luKCcsICcpfS5gKVxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfVxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ2Jvb2xlYW4nKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBtdXN0IGJlIHRydWUgb3IgZmFsc2UuYClcbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIGNhc2UgJ3N0cmluZ0FycmF5Jzoge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhIGxpc3QuYClcbiAgICAgIGlmIChmaWVsZC5tYXhJdGVtcyAhPT0gdW5kZWZpbmVkICYmIHZhbHVlLmxlbmd0aCA+IGZpZWxkLm1heEl0ZW1zKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgdG9vIG1hbnkgaXRlbXMuYClcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB2YWx1ZSkge1xuICAgICAgICBpZiAodHlwZW9mIGl0ZW0gIT09ICdzdHJpbmcnIHx8IChmaWVsZC5wYXR0ZXJuICYmICFmaWVsZC5wYXR0ZXJuLnRlc3QoaXRlbSkpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgYW4gaW52YWxpZCBpdGVtLmApXG4gICAgICB9XG4gICAgICByZXR1cm4gWy4uLm5ldyBTZXQodmFsdWUgYXMgc3RyaW5nW10pXVxuICAgIH1cbiAgICBjYXNlICdyZWNvcmQnOiB7XG4gICAgICBpZiAoIWlzUmVjb3JkKHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyh2YWx1ZSlcbiAgICAgIGlmIChmaWVsZC5tYXhLZXlzICE9PSB1bmRlZmluZWQgJiYgZW50cmllcy5sZW5ndGggPiBmaWVsZC5tYXhLZXlzKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgdG9vIG1hbnkgZW50cmllcy5gKVxuICAgICAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2ICE9PSAnc3RyaW5nJyB8fCBrLmxlbmd0aCA+IDMwMCB8fCB2Lmxlbmd0aCA+IDEyMCkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gZW50cmllcyBtdXN0IGJlIHNob3J0IHN0cmluZ3MuYClcbiAgICAgICAgb3V0W2tdID0gdlxuICAgICAgfVxuICAgICAgcmV0dXJuIG91dFxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNSZWNvcmQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3UmVxdWVzdElkKCk6IHN0cmluZyB7XG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoMTIpXG4gIGdsb2JhbFRoaXMuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhieXRlcylcbiAgcmV0dXJuICdyZXFfJyArIEFycmF5LmZyb20oYnl0ZXMsIChiKSA9PiBiLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpKS5qb2luKCcnKVxufVxuIiwgIi8vIE5vcm1hbGl6ZWQsIGF1dGhvcml0YXRpdmUgQWdlbnQgRmxvdyBzdGF0ZSBzaGFyZWQgYnkgdGhlIHdvcmtlciBhbmQgZXZlcnkgVUkuXG4vLyBWYWx1ZXMgdGhlIHJ1bnRpbWUgZG9lcyBub3QgcHJvdmlkZSBzdGF5IG51bGw7IHRoZSBVSSBzaG93cyB0aGVtIGFzIHVuYXZhaWxhYmxlLlxuXG5leHBvcnQgdHlwZSBFdmlkZW5jZVNvdXJjZSA9ICdob3N0LWV2ZW50JyB8ICdob3N0LWNhbGwnIHwgJ2hvb2snIHwgJ2NsaS1wb2xsJyB8ICdzZXNzaW9uLWZpbGUnIHwgJ2xhdW5jaC1jYXB0dXJlJyB8ICdjb25maWcnXG5cbmV4cG9ydCB0eXBlIEFnZW50UnVudGltZVN0YXRlID0gJ3dvcmtpbmcnIHwgJ2Jsb2NrZWQnIHwgJ3dhaXRpbmcnIHwgJ2RvbmUnIHwgJ2ZhaWxlZCcgfCAnaWRsZScgfCAndW5rbm93bidcblxuZXhwb3J0IHR5cGUgQWdlbnRSb2xlID0gJ2xlYWQnIHwgJ3dvcmtlcicgfCAnYWdlbnQnIHwgJ3N1YmFnZW50J1xuXG5leHBvcnQgdHlwZSBBY2NvdW50UmVmID0ge1xuICBhY2NvdW50SWQ6IHN0cmluZyB8IG51bGxcbiAgLyoqIERpc3BsYXkgbGFiZWw6IHRoZSBwZXJzb24ncyBvd24gbGFiZWwgZnJvbSBzZXR0aW5ncywgZWxzZSB0aGUgYWNjb3VudCBlbWFpbC4gKi9cbiAgbGFiZWw6IHN0cmluZyB8IG51bGxcbiAgcHJvdmlkZXI6IHN0cmluZyB8IG51bGxcbiAgc291cmNlOiBFdmlkZW5jZVNvdXJjZVxufVxuXG5leHBvcnQgdHlwZSBBZ2VudFJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICByb2xlOiBBZ2VudFJvbGVcbiAgLyoqIE9yY2EgYWdlbnQga2luZDogY2xhdWRlLCBjb2RleCwgYW50aWdyYXZpdHksIGdlbWluaSwgb3BlbmNvZGVcdTIwMjYgKi9cbiAgYWdlbnQ6IHN0cmluZyB8IG51bGxcbiAgdGl0bGU6IHN0cmluZyB8IG51bGxcbiAgcGFyZW50SWQ6IHN0cmluZyB8IG51bGxcbiAgcnVuSWQ6IHN0cmluZyB8IG51bGxcbiAgZGlzcGF0Y2hJZDogc3RyaW5nIHwgbnVsbFxuICB0YXNrSWQ6IHN0cmluZyB8IG51bGxcbiAgdGVybWluYWxJZDogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbEhhbmRsZTogc3RyaW5nIHwgbnVsbFxuICBwYW5lS2V5OiBzdHJpbmcgfCBudWxsXG4gIHNlc3Npb25JZDogc3RyaW5nIHwgbnVsbFxuICB3b3Jrc3BhY2VJZDogc3RyaW5nIHwgbnVsbFxuICB3b3JrdHJlZVBhdGg6IHN0cmluZyB8IG51bGxcbiAgLyoqIFJlcG9zaXRvcnkgdGhlIHdvcmt0cmVlIGJlbG9uZ3MgdG8gKGZyb20gaXRzIC5naXQgcG9pbnRlciksIHdoZW4ga25vd24uICovXG4gIHJlcG9Sb290Pzogc3RyaW5nIHwgbnVsbFxuICAvKiogT3JjYSBwcm9qZWN0IGlkLCB3aGVuIE9yY2EgbmFtZWQgaXQgZm9yIHRoaXMgYWdlbnQgKG9yY2hlc3RyYXRpb24gZGlzcGF0Y2hlcyBkbykuICovXG4gIHByb2plY3RJZD86IHN0cmluZyB8IG51bGxcbiAgYnJhbmNoOiBzdHJpbmcgfCBudWxsXG4gIG1vZGVsOiBzdHJpbmcgfCBudWxsXG4gIGVmZm9ydDogc3RyaW5nIHwgbnVsbFxuICBhY2NvdW50OiBBY2NvdW50UmVmIHwgbnVsbFxuICBzdGF0ZTogQWdlbnRSdW50aW1lU3RhdGVcbiAgb3V0Y29tZTogc3RyaW5nIHwgbnVsbFxuICBzdGF0ZVNpbmNlOiBudW1iZXIgfCBudWxsXG4gIHN0YXJ0ZWRBdDogbnVtYmVyIHwgbnVsbFxuICBlbmRlZEF0OiBudW1iZXIgfCBudWxsXG4gIC8qKiBMYXN0IHRpbWUgYW55IHJ1bnRpbWUgZXZpZGVuY2UgdG91Y2hlZCB0aGlzIGFnZW50LiAqL1xuICBsYXN0U2VlbkF0OiBudW1iZXJcbiAgLyoqIFRydWUgb25seSB3aGVuIGxpdmUgZXZpZGVuY2UgKHN0YXR1cyBldmVudCwgcnVubmluZyBkaXNwYXRjaCwgbGl2ZSBzZXNzaW9uKSBzYXlzIGl0IHJ1bnMuICovXG4gIGxpdmU6IGJvb2xlYW5cbiAgdG9rZW5zOiBudW1iZXIgfCBudWxsXG4gIG1lc3NhZ2VDb3VudDogbnVtYmVyIHwgbnVsbFxuICBmYWlsdXJlQ291bnQ6IG51bWJlclxuICByZXRyeU9mRGlzcGF0Y2hJZDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3ViYWdlbnQgb25seTogdGhlIHRvb2wgY2FsbCB0aGF0IGNyZWF0ZWQgaXQuICovXG4gIGNhbGxJZDogc3RyaW5nIHwgbnVsbFxuICBzdWJhZ2VudFR5cGU6IHN0cmluZyB8IG51bGxcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgZXZpZGVuY2U6IEV2aWRlbmNlU291cmNlW11cbiAgdmVyc2lvbjogbnVtYmVyXG59XG5cbmV4cG9ydCB0eXBlIFRhc2tTdGF0ZSA9XG4gIHwgJ1BFTkRJTkcnXG4gIHwgJ1JFQURZJ1xuICB8ICdSVU5OSU5HJ1xuICB8ICdSRVZJRVcnXG4gIHwgJ1RFU1RJTkcnXG4gIHwgJ0FQUFJPVkVEJ1xuICB8ICdNRVJHRUQnXG4gIHwgJ0RPTkUnXG4gIHwgJ0JMT0NLRUQnXG4gIHwgJ0ZBSUxFRCdcbiAgfCAnUkVUUllJTkcnXG4gIHwgJ0NBTkNFTExFRCdcblxuLyoqIEluZmVycmVkIGZyb20gdGhlIHRpdGxlL3NwZWM7IHNob3duIGFzIFwiaW5mZXJyZWRcIiBpbiB0aGUgaW5zcGVjdG9yLiAqL1xuZXhwb3J0IHR5cGUgVGFza0tpbmQgPSAndGFzaycgfCAncmV2aWV3JyB8ICd0ZXN0JyB8ICdtZXJnZScgfCAncGxhbidcblxuZXhwb3J0IHR5cGUgVGFza1JlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBydW5JZDogc3RyaW5nXG4gIHBhcmVudElkOiBzdHJpbmcgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGlzcGxheU5hbWU6IHN0cmluZyB8IG51bGxcbiAgc3BlYzogc3RyaW5nIHwgbnVsbFxuICBraW5kOiBUYXNrS2luZFxuICAvKiogUmF3IE9yY2Egc3RhdHVzOiBwZW5kaW5nLCByZWFkeSwgZGlzcGF0Y2hlZCwgY29tcGxldGVkLCBmYWlsZWQsIGJsb2NrZWQuICovXG4gIG9yY2FTdGF0dXM6IHN0cmluZ1xuICBzdGF0ZTogVGFza1N0YXRlXG4gIGRlcHM6IHN0cmluZ1tdXG4gIGFzc2lnbmVlQWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICBkaXNwYXRjaElkczogc3RyaW5nW11cbiAgcmVzdWx0OiBUYXNrUmVzdWx0IHwgbnVsbFxuICBjcmVhdGVkQXQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGVkQXQ6IG51bWJlciB8IG51bGxcbiAgcmV0cnlDb3VudDogbnVtYmVyXG4gIGdhdGVJZHM6IHN0cmluZ1tdXG4gIHZlcnNpb246IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBUYXNrUmVzdWx0ID0ge1xuICBvdXRjb21lOiBzdHJpbmcgfCBudWxsXG4gIG1lc3NhZ2U6IHN0cmluZyB8IG51bGxcbiAgZmlsZXNNb2RpZmllZDogc3RyaW5nW11cbiAgcmF3OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCB0eXBlIFJ1blJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBvYmplY3RpdmU6IHN0cmluZ1xuICBsZWdhY3k6IGJvb2xlYW5cbiAgY29vcmRpbmF0b3JIYW5kbGU6IHN0cmluZyB8IG51bGxcbiAgc3RhdGU6ICdhY3RpdmUnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyB8ICdpZGxlJ1xuICBzdGFydGVkQXQ6IG51bWJlciB8IG51bGxcbiAgZW5kZWRBdDogbnVtYmVyIHwgbnVsbFxuICB0YXNrQ291bnQ6IG51bWJlclxuICB2ZXJzaW9uOiBudW1iZXJcbn1cblxuZXhwb3J0IHR5cGUgTWVzc2FnZVJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBydW5JZDogc3RyaW5nIHwgbnVsbFxuICBmcm9tSGFuZGxlOiBzdHJpbmcgfCBudWxsXG4gIHRvSGFuZGxlOiBzdHJpbmcgfCBudWxsXG4gIGZyb21BZ2VudElkOiBzdHJpbmcgfCBudWxsXG4gIHRvQWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICB0eXBlOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nIHwgbnVsbFxuICBib2R5OiBzdHJpbmcgfCBudWxsXG4gIHRhc2tJZDogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkQXQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBHYXRlUmVjb3JkID0ge1xuICBpZDogc3RyaW5nXG4gIHRhc2tJZDogc3RyaW5nIHwgbnVsbFxuICBxdWVzdGlvbjogc3RyaW5nIHwgbnVsbFxuICBzdGF0dXM6IHN0cmluZ1xuICByZXNvbHV0aW9uOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRBdDogbnVtYmVyIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBXb3JrdHJlZVJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBuYW1lOiBzdHJpbmdcbiAgcGF0aDogc3RyaW5nXG4gIGJyYW5jaDogc3RyaW5nIHwgbnVsbFxuICBwcm9qZWN0OiBzdHJpbmcgfCBudWxsXG4gIHByb2plY3RJZDogc3RyaW5nIHwgbnVsbFxuICBob3N0SWQ6IHN0cmluZyB8IG51bGxcbiAga2luZDogJ3dvcmt0cmVlJyB8ICdmb2xkZXInXG4gIHN0YXR1czogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbENvdW50OiBudW1iZXIgfCBudWxsXG4gIGxhc3RBY3Rpdml0eUF0OiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxufVxuXG4vKiogQW4gT3JjYSBwcm9qZWN0IChyZXBvc2l0b3J5IG9yIGZvbGRlcikgYXMgYHByb2plY3QubGlzdGAgcmVwb3J0cyBpdC4gKi9cbmV4cG9ydCB0eXBlIFByb2plY3RSZWNvcmQgPSB7XG4gIGlkOiBzdHJpbmdcbiAgbmFtZTogc3RyaW5nXG4gIHBhdGg6IHN0cmluZ1xuICBraW5kOiAnZ2l0JyB8ICdmb2xkZXInXG4gIGhvc3RJZDogc3RyaW5nIHwgbnVsbFxuICBoaWRkZW46IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgVG9vbENhbGxSZWNvcmQgPSB7XG4gIGlkOiBzdHJpbmdcbiAgYWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbElkOiBzdHJpbmcgfCBudWxsXG4gIHRvb2w6IHN0cmluZ1xuICBzdW1tYXJ5OiBzdHJpbmdcbiAgYXQ6IG51bWJlclxuICBwaGFzZTogJ3N0YXJ0ZWQnIHwgJ2ZpbmlzaGVkJ1xufVxuXG5leHBvcnQgdHlwZSBBY2NvdW50UmVjb3JkID0ge1xuICBpZDogc3RyaW5nXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgZW1haWw6IHN0cmluZyB8IG51bGxcbiAgbGFiZWw6IHN0cmluZyB8IG51bGxcbiAgYWN0aXZlOiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIENvbW1hbmRBdmFpbGFiaWxpdHlNYXAgPSBSZWNvcmQ8c3RyaW5nLCB7IGF2YWlsYWJsZTogYm9vbGVhbjsgbW9kZTogJ2RpcmVjdCcgfCAnY29vcmRpbmF0b3InIHwgJ3Vuc3VwcG9ydGVkJzsgcmVhc29uOiBzdHJpbmcgfCBudWxsIH0+XG5cbmV4cG9ydCB0eXBlIENhcGFiaWxpdGllcyA9IHtcbiAgaG9zdE1ldGhvZHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+XG4gIGNvbW1hbmRzOiBDb21tYW5kQXZhaWxhYmlsaXR5TWFwXG4gIGFjdEFzQ29vcmRpbmF0b3I6IGJvb2xlYW5cbiAgLyoqIEV4cGVyaW1lbnRhbCBjaGF0LXNlc3Npb24gc2VuZGluZyBpcyBvbi4gKi9cbiAgY2hhdFNlbmQ/OiBib29sZWFuXG4gIC8qKiBUaGUgYnJvd3NlciBkYXNoYm9hcmQgbWF5IHJ1biBjb250cm9scyAoc2V0dGluZyk7IE9yY2EncyBvd24gcGFuZWxzIGFsd2F5cyBtYXkuICovXG4gIGRhc2hib2FyZENvbnRyb2xzPzogYm9vbGVhblxuICBjbGlBdmFpbGFibGU6IGJvb2xlYW5cbiAgY2xpUGF0aDogc3RyaW5nIHwgbnVsbFxuICBob29rczogYm9vbGVhblxuICBkYXNoYm9hcmQ6IHsgZW5hYmxlZDogYm9vbGVhbjsgdXJsOiBzdHJpbmcgfCBudWxsIH1cbiAgYXBpTWlub3I6IG51bWJlclxuICAvKiogVGhlIHBlcnNvbidzIGhvbWUgZm9sZGVyLCBzbyBgfmAgaW4gcHJvamVjdCBydWxlcyBjYW4gYmUgcmVzb2x2ZWQuICovXG4gIGhvbWVEaXI6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IHR5cGUgRmxvd1N0YXRlID0ge1xuICBzZXE6IG51bWJlclxuICBnZW5lcmF0ZWRBdDogbnVtYmVyXG4gIGFnZW50czogUmVjb3JkPHN0cmluZywgQWdlbnRSZWNvcmQ+XG4gIHRhc2tzOiBSZWNvcmQ8c3RyaW5nLCBUYXNrUmVjb3JkPlxuICBydW5zOiBSZWNvcmQ8c3RyaW5nLCBSdW5SZWNvcmQ+XG4gIG1lc3NhZ2VzOiBNZXNzYWdlUmVjb3JkW11cbiAgZ2F0ZXM6IFJlY29yZDxzdHJpbmcsIEdhdGVSZWNvcmQ+XG4gIHdvcmt0cmVlczogUmVjb3JkPHN0cmluZywgV29ya3RyZWVSZWNvcmQ+XG4gIHRvb2xDYWxsczogVG9vbENhbGxSZWNvcmRbXVxuICBhY2NvdW50czogUmVjb3JkPHN0cmluZywgQWNjb3VudFJlY29yZD5cbiAgcHJvamVjdHM6IFJlY29yZDxzdHJpbmcsIFByb2plY3RSZWNvcmQ+XG4gIGNhcGFiaWxpdGllczogQ2FwYWJpbGl0aWVzXG4gIGxhYmVsczogTGFiZWxDb25maWdcbn1cblxuLyoqIE9wdGlvbmFsIHBlcnNvbi1kZWZpbmVkIGxhYmVsczsgbmV2ZXIgcmVxdWlyZWQgZm9yIHRoZSBncmFwaCB0byB3b3JrLiAqL1xuZXhwb3J0IHR5cGUgTGFiZWxDb25maWcgPSB7XG4gIC8qKiBhY2NvdW50SWQgb3IgZW1haWwgXHUyMTkyIHRlYW0gbmFtZSAoXCJUZWFtIEFcIikuICovXG4gIGFjY291bnRUZWFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICAvKiogYWdlbnQga2luZCwgZGlzcGF0Y2ggZGlzcGxheSBuYW1lIG9yIG1vZGVsIFx1MjE5MiByb2xlIGxhYmVsIChcIlJldmlld2VyXCIpLiAqL1xuICBhZ2VudFJvbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIGxlYWRBY2NvdW50OiBzdHJpbmcgfCBudWxsXG4gIC8qKiBQcm9qZWN0IGJveCBrZXkgXHUyMTkyIGRpc3BsYXkgbmFtZSB0aGUgcGVyc29uIGNob3NlLiAqL1xuICBwcm9qZWN0TmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgLyoqIFByb2plY3QgYm94IGtleSBcdTIxOTIgY29sb3IgKCNycmdnYmIpLiAqL1xuICBwcm9qZWN0Q29sb3JzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIC8qKiBQYXRoIHBhdHRlcm4gKGdsb2IsIH4gYWxsb3dlZCkgXHUyMTkyIGdyb3VwIG5hbWUuIFJ1bGVzIHdpbiBvdmVyIE9yY2EncyBwcm9qZWN0cy4gKi9cbiAgcHJvamVjdFJ1bGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBjb25zdCBFTVBUWV9MQUJFTFM6IExhYmVsQ29uZmlnID0geyBhY2NvdW50VGVhbXM6IHt9LCBhZ2VudFJvbGVzOiB7fSwgbGVhZEFjY291bnQ6IG51bGwsIHByb2plY3ROYW1lczoge30sIHByb2plY3RDb2xvcnM6IHt9LCBwcm9qZWN0UnVsZXM6IHt9IH1cblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5TGFiZWxzKCk6IExhYmVsQ29uZmlnIHtcbiAgcmV0dXJuIHsgYWNjb3VudFRlYW1zOiB7fSwgYWdlbnRSb2xlczoge30sIGxlYWRBY2NvdW50OiBudWxsLCBwcm9qZWN0TmFtZXM6IHt9LCBwcm9qZWN0Q29sb3JzOiB7fSwgcHJvamVjdFJ1bGVzOiB7fSB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUNhcGFiaWxpdGllcygpOiBDYXBhYmlsaXRpZXMge1xuICByZXR1cm4geyBob3N0TWV0aG9kczoge30sIGNvbW1hbmRzOiB7fSwgYWN0QXNDb29yZGluYXRvcjogZmFsc2UsIGNsaUF2YWlsYWJsZTogZmFsc2UsIGNsaVBhdGg6IG51bGwsIGhvb2tzOiBmYWxzZSwgZGFzaGJvYXJkOiB7IGVuYWJsZWQ6IGZhbHNlLCB1cmw6IG51bGwgfSwgYXBpTWlub3I6IDAsIGhvbWVEaXI6IG51bGwgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlTdGF0ZSgpOiBGbG93U3RhdGUge1xuICByZXR1cm4ge1xuICAgIHNlcTogMCxcbiAgICBnZW5lcmF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICBhZ2VudHM6IHt9LFxuICAgIHRhc2tzOiB7fSxcbiAgICBydW5zOiB7fSxcbiAgICBtZXNzYWdlczogW10sXG4gICAgZ2F0ZXM6IHt9LFxuICAgIHdvcmt0cmVlczoge30sXG4gICAgdG9vbENhbGxzOiBbXSxcbiAgICBhY2NvdW50czoge30sXG4gICAgcHJvamVjdHM6IHt9LFxuICAgIGNhcGFiaWxpdGllczogZW1wdHlDYXBhYmlsaXRpZXMoKSxcbiAgICAvLyBBIGZyZXNoIGNvcHk6IGEgc2hhcmVkIG9iamVjdCB3b3VsZCBsZXQgb25lIHN0YXRlJ3MgbGFiZWxzIGxlYWsgaW50byBhbm90aGVyLlxuICAgIGxhYmVsczogZW1wdHlMYWJlbHMoKVxuICB9XG59XG4iLCAiLy8gQWNjb3VudCBpZGVudGl0eSBwZXIgYWdlbnQsIGV2aWRlbmNlIGZpcnN0OlxuLy8gIDEuIGBvcmNhIGFjY291bnQgbGlzdGAgZm9yIHRoZSBhY2NvdW50cyB0aGVtc2VsdmVzIChpZHMsIHByb3ZpZGVyLCBlbWFpbCwgYWN0aXZlIG9uZSk7XG4vLyAgMi4gZWFjaCBhY2NvdW50IGhvbWUncyBgc2Vzc2lvbnMvPHBpZD4uanNvbmAgKHdyaXR0ZW4gYnkgdGhlIGFnZW50IENMSSkgbWFwcyBzZXNzaW9uSWQgXHUyMTkyIGFjY291bnQ7XG4vLyAgMy4gZmFsbGJhY2s6IHRoZSBhZ2VudC5sYXVuY2guYmVmb3JlIGhvb2sgcmVjb3JkcyB3aGljaCBhY2NvdW50IHByb2ZpbGUgYSB0ZXJtaW5hbCBsYXVuY2hlZCB3aXRoLlxuLy8gVG9rZW5zIGFuZCBjcmVkZW50aWFscyBhcmUgbmV2ZXIgcmVhZCBvciBzdG9yZWQuXG5pbXBvcnQgeyByZWFkZGlyLCByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHR5cGUgeyBBY2NvdW50UmVjb3JkLCBBY2NvdW50UmVmIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgc3RyLCB0eXBlIFdvcmtlckNvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0LnRzJ1xuXG50eXBlIENsaUFjY291bnQgPSB7IGlkOiBzdHJpbmc7IGVtYWlsPzogc3RyaW5nIHwgbnVsbDsgaG9tZT86IHN0cmluZyB8IG51bGwgfVxudHlwZSBDbGlQcm92aWRlciA9IHsgYWNjb3VudHM/OiBDbGlBY2NvdW50W107IGFjdGl2ZUFjY291bnRJZD86IHN0cmluZyB8IG51bGwgfVxuXG4vKiogRW52IHZhcnMgYWdlbnQgQ0xJcyByZWFkIHRoZWlyIHByb2ZpbGUgZGlyZWN0b3J5IGZyb20uICovXG5jb25zdCBQUk9GSUxFX0VOVl9LRVlTID0gWydDTEFVREVfQ09ORklHX0RJUicsICdDT0RFWF9IT01FJywgJ0dFTUlOSV9DT05GSUdfRElSJywgJ09QRU5DT0RFX0NPTkZJR19ESVInXVxuY29uc3QgTUFYX1NFU1NJT05fRklMRVMgPSA0MDBcblxuZXhwb3J0IGNsYXNzIEFjY291bnRzQWRhcHRlciB7XG4gIHByaXZhdGUgaG9tZXMgPSBuZXcgTWFwPHN0cmluZywgeyBhY2NvdW50SWQ6IHN0cmluZzsgcHJvdmlkZXI6IHN0cmluZyB9PigpXG4gIHByaXZhdGUgc2Vzc2lvbkFjY291bnQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG4gIC8qKiBTZXNzaW9uIGZpbGVzIGFsc28gY2FycnkgdGhlIGFnZW50IENMSSdzIHBpZCBhbmQgYnVzeS9pZGxlIHN0YXR1czogbGl2ZSBldmlkZW5jZS4gKi9cbiAgcHJpdmF0ZSBzZXNzaW9uUHJvY2VzcyA9IG5ldyBNYXA8c3RyaW5nLCB7IHBpZDogbnVtYmVyOyBwcm9jU3RhcnQ6IHN0cmluZyB8IG51bGw7IHN0YXR1czogc3RyaW5nIHwgbnVsbDsgdXBkYXRlZEF0OiBudW1iZXIgfCBudWxsIH0+KClcbiAgcHJpdmF0ZSB0ZXJtaW5hbEFjY291bnQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjdHg6IFdvcmtlckNvbnRleHQpIHt9XG5cbiAgLyoqIFByb2ZpbGUgaG9tZXMgb2YgQ29kZXggYWNjb3VudHMgKGVhY2ggbWF5IGtlZXAgaXRzIG93biBzZXNzaW9ucy8pLiAqL1xuICBjb2RleEhvbWVzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuaG9tZXMuZW50cmllcygpXS5maWx0ZXIoKFssIHZdKSA9PiB2LnByb3ZpZGVyID09PSAnY29kZXgnKS5tYXAoKFtob21lXSkgPT4gaG9tZSlcbiAgfVxuXG4gIC8qKiBQcm9maWxlIGhvbWVzIG9mIENsYXVkZSBhY2NvdW50cyAoZWFjaCBoYXMgaXRzIG93biBwcm9qZWN0cy8gYW5kIHNlc3Npb25zLykuICovXG4gIGNsYXVkZUhvbWVzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuaG9tZXMuZW50cmllcygpXS5maWx0ZXIoKFssIHZdKSA9PiB2LnByb3ZpZGVyID09PSAnY2xhdWRlJykubWFwKChbaG9tZV0pID0+IGhvbWUpXG4gIH1cblxuICBhc3luYyByZWZyZXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZEFjY291bnRzKClcbiAgICB0aGlzLnNlc3Npb25Qcm9jZXNzLmNsZWFyKClcbiAgICBhd2FpdCB0aGlzLnNjYW5TZXNzaW9uRmlsZXMoKVxuICAgIHRoaXMuYXBwbHlUb0FnZW50cygpXG4gICAgYXdhaXQgdGhpcy5hcHBseUxpdmVuZXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXZlIGV2aWRlbmNlIGZvciBhZ2VudHMgT3JjYSdzIGV2ZW50cyBoYXZlIG5vdCByZXBvcnRlZCBzaW5jZSBhIHJlc3RhcnQ6IHRoZSBhZ2VudCBDTEknc1xuICAgKiBzZXNzaW9uIGZpbGUgbmFtZXMgaXRzIHBpZDsgaWYgdGhhdCBwcm9jZXNzIGlzIHJ1bm5pbmcsIHRoZSBhZ2VudCBpcyBsaXZlLiBOZXZlciBvdmVycmlkZXMgYVxuICAgKiBuZXdlciBzdGF0dXMgZXZlbnQgKHRoZSBzdG9yZSBvcmRlcnMgc3RhdGUgYnkgb2JzZXJ2YXRpb24gdGltZSkuXG4gICAqL1xuICBhc3luYyBhcHBseUxpdmVuZXNzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzKSkge1xuICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICAgIGNvbnN0IHByb2MgPSB0aGlzLnNlc3Npb25Qcm9jZXNzLmdldChhZ2VudC5zZXNzaW9uSWQpXG4gICAgICBpZiAoIXByb2MpIGNvbnRpbnVlXG4gICAgICBjb25zdCBhbGl2ZSA9IGF3YWl0IHByb2Nlc3NBbGl2ZShwcm9jLnBpZCwgcHJvYy5wcm9jU3RhcnQpXG4gICAgICBpZiAoYWdlbnQubGl2ZSA9PT0gYWxpdmUgJiYgYWdlbnQuc3RhdGUgIT09ICd1bmtub3duJykgY29udGludWVcbiAgICAgIGNvbnN0IHN0YXRlID0gIWFsaXZlID8gKGFnZW50LnN0YXRlID09PSAndW5rbm93bicgfHwgYWdlbnQubGl2ZSA/ICdkb25lJyA6IGFnZW50LnN0YXRlKSA6IHByb2Muc3RhdHVzID09PSAnYnVzeScgPyAnd29ya2luZycgOiAnd2FpdGluZydcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KGFnZW50LmlkLCBwcm9jLnVwZGF0ZWRBdCA/PyAwLCB7IGxpdmU6IGFsaXZlLCBzdGF0ZSwgZXZpZGVuY2U6IFsnc2Vzc2lvbi1maWxlJ10gfSwgKCkgPT4gYWdlbnQpXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkQWNjb3VudHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjxSZWNvcmQ8c3RyaW5nLCBDbGlQcm92aWRlcj4+KFsnYWNjb3VudCcsICdsaXN0J10pXG4gICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgIHRoaXMuY3R4LmxvZyhgYWNjb3VudCBsaXN0OiAke3Jlc3VsdC5jb2RlfSAke3Jlc3VsdC5tZXNzYWdlfWApXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgbGFiZWxzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmxhYmVsc1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgW3Byb3ZpZGVyLCBpbmZvXSBvZiBPYmplY3QuZW50cmllcyhyZXN1bHQucmVzdWx0KSkge1xuICAgICAgaWYgKCFpbmZvIHx8ICFBcnJheS5pc0FycmF5KGluZm8uYWNjb3VudHMpKSBjb250aW51ZVxuICAgICAgZm9yIChjb25zdCBhY2NvdW50IG9mIGluZm8uYWNjb3VudHMpIHtcbiAgICAgICAgc2Vlbi5hZGQoYWNjb3VudC5pZClcbiAgICAgICAgY29uc3QgZW1haWwgPSBzdHIoYWNjb3VudC5lbWFpbClcbiAgICAgICAgY29uc3QgcmVjb3JkOiBBY2NvdW50UmVjb3JkID0ge1xuICAgICAgICAgIGlkOiBhY2NvdW50LmlkLFxuICAgICAgICAgIHByb3ZpZGVyLFxuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIGxhYmVsOiBsYWJlbHMuYWNjb3VudFRlYW1zW2FjY291bnQuaWRdID8/IChlbWFpbCA/IGxhYmVscy5hY2NvdW50VGVhbXNbZW1haWxdIDogdW5kZWZpbmVkKSA/PyBudWxsLFxuICAgICAgICAgIGFjdGl2ZTogaW5mby5hY3RpdmVBY2NvdW50SWQgPT09IGFjY291bnQuaWRcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdhY2NvdW50JywgaWQ6IGFjY291bnQuaWQsIHZhbHVlOiByZWNvcmQgfSlcbiAgICAgICAgY29uc3QgaG9tZSA9IHN0cihhY2NvdW50LmhvbWUpXG4gICAgICAgIGlmIChob21lKSB0aGlzLmhvbWVzLnNldChyZXNvbHZlKGhvbWUpLCB7IGFjY291bnRJZDogYWNjb3VudC5pZCwgcHJvdmlkZXIgfSlcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWNjb3VudHMpKSBpZiAoIXNlZW4uaGFzKGlkKSkgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnYWNjb3VudCcsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuU2Vzc2lvbkZpbGVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBidWRnZXQgPSBNQVhfU0VTU0lPTl9GSUxFU1xuICAgIGZvciAoY29uc3QgW2hvbWUsIHsgYWNjb3VudElkIH1dIG9mIHRoaXMuaG9tZXMpIHtcbiAgICAgIGNvbnN0IGRpciA9IGpvaW4oaG9tZSwgJ3Nlc3Npb25zJylcbiAgICAgIGxldCBuYW1lczogc3RyaW5nW11cbiAgICAgIHRyeSB7XG4gICAgICAgIG5hbWVzID0gKGF3YWl0IHJlYWRkaXIoZGlyKSkuZmlsdGVyKChuYW1lKSA9PiAvXlxcZCtcXC5qc29uJC8udGVzdChuYW1lKSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7XG4gICAgICAgIGlmIChidWRnZXQtLSA8PSAwKSByZXR1cm5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGpvaW4oZGlyLCBuYW1lKSwgJ3V0ZjgnKSkgYXMgeyBzZXNzaW9uSWQ/OiB1bmtub3duOyBwaWQ/OiB1bmtub3duOyBwcm9jU3RhcnQ/OiB1bmtub3duOyBzdGF0dXM/OiB1bmtub3duOyB1cGRhdGVkQXQ/OiB1bmtub3duIH1cbiAgICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSBzdHIocGFyc2VkLnNlc3Npb25JZClcbiAgICAgICAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICB0aGlzLnNlc3Npb25BY2NvdW50LnNldChzZXNzaW9uSWQsIGFjY291bnRJZClcbiAgICAgICAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBpZCA9PT0gJ251bWJlcicpIHRoaXMuc2Vzc2lvblByb2Nlc3Muc2V0KHNlc3Npb25JZCwgeyBwaWQ6IHBhcnNlZC5waWQsIHByb2NTdGFydDogcGFyc2VkLnByb2NTdGFydCA9PSBudWxsID8gbnVsbCA6IFN0cmluZyhwYXJzZWQucHJvY1N0YXJ0KSwgc3RhdHVzOiBzdHIocGFyc2VkLnN0YXR1cyksIHVwZGF0ZWRBdDogdHlwZW9mIHBhcnNlZC51cGRhdGVkQXQgPT09ICdudW1iZXInID8gcGFyc2VkLnVwZGF0ZWRBdCA6IG51bGwgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIGEgZmlsZSBiZWluZyB3cml0dGVuIHJpZ2h0IG5vdzsgbmV4dCBzY2FuIHBpY2tzIGl0IHVwXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogYWdlbnQubGF1bmNoLmJlZm9yZTogcmVjb3JkIHRoZSBwcm9maWxlIGRpciBvbmx5LiBSZXR1cm5zIG5vdGhpbmcsIHNvIHRoZSBsYXVuY2ggZ29lcyBvbi4gKi9cbiAgb25MYXVuY2goZXZlbnQ6IHsgYWdlbnQ6IHN0cmluZzsgdGVybWluYWxJZD86IHN0cmluZzsgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0pOiB2b2lkIHtcbiAgICBpZiAoIWV2ZW50LnRlcm1pbmFsSWQpIHJldHVyblxuICAgIGZvciAoY29uc3Qga2V5IG9mIFBST0ZJTEVfRU5WX0tFWVMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZXZlbnQuZW52Py5ba2V5XVxuICAgICAgaWYgKCF2YWx1ZSkgY29udGludWVcbiAgICAgIGNvbnN0IGFjY291bnRJZCA9IHRoaXMuYWNjb3VudEZvclByb2ZpbGVEaXIodmFsdWUpXG4gICAgICBpZiAoYWNjb3VudElkKSB7XG4gICAgICAgIHRoaXMudGVybWluYWxBY2NvdW50LnNldChldmVudC50ZXJtaW5hbElkLCBhY2NvdW50SWQpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFjY291bnRGb3JQcm9maWxlRGlyKGRpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZShkaXIpXG4gICAgZm9yIChjb25zdCBbaG9tZSwgeyBhY2NvdW50SWQgfV0gb2YgdGhpcy5ob21lcykge1xuICAgICAgLy8gRXhhY3QgcHJvZmlsZSBkaXIsIGl0cyBob21lLCBvciBpbnNpZGUgaXQuIE5ldmVyIGEgYnJvYWQgYW5jZXN0b3IgZm9sZGVyLlxuICAgICAgaWYgKHRhcmdldCA9PT0gaG9tZSB8fCB0YXJnZXQgPT09IGRpcm5hbWUoaG9tZSkgfHwgdGFyZ2V0LnN0YXJ0c1dpdGgoaG9tZSArICcvJykpIHJldHVybiBhY2NvdW50SWRcbiAgICB9XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGFwcGx5VG9BZ2VudHMoKTogdm9pZCB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKClcbiAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXMoc3RhdGUuYWdlbnRzKSkge1xuICAgICAgbGV0IHJlZjogQWNjb3VudFJlZiB8IG51bGwgPSBudWxsXG4gICAgICBjb25zdCBmcm9tU2Vzc2lvbiA9IGFnZW50LnNlc3Npb25JZCA/IHRoaXMuc2Vzc2lvbkFjY291bnQuZ2V0KGFnZW50LnNlc3Npb25JZCkgOiB1bmRlZmluZWRcbiAgICAgIGNvbnN0IGZyb21MYXVuY2ggPSBhZ2VudC50ZXJtaW5hbElkID8gdGhpcy50ZXJtaW5hbEFjY291bnQuZ2V0KGFnZW50LnRlcm1pbmFsSWQpIDogdW5kZWZpbmVkXG4gICAgICBpZiAoZnJvbVNlc3Npb24pIHJlZiA9IHRoaXMucmVmKGZyb21TZXNzaW9uLCAnc2Vzc2lvbi1maWxlJylcbiAgICAgIGVsc2UgaWYgKGZyb21MYXVuY2gpIHJlZiA9IHRoaXMucmVmKGZyb21MYXVuY2gsICdsYXVuY2gtY2FwdHVyZScpXG4gICAgICBlbHNlIGlmIChhZ2VudC5yb2xlID09PSAnc3ViYWdlbnQnICYmIGFnZW50LnBhcmVudElkKSByZWYgPSBzdGF0ZS5hZ2VudHNbYWdlbnQucGFyZW50SWRdPy5hY2NvdW50ID8/IG51bGxcbiAgICAgIGlmICghcmVmKSBjb250aW51ZVxuICAgICAgaWYgKGFnZW50LmFjY291bnQgJiYgYWdlbnQuYWNjb3VudC5hY2NvdW50SWQgPT09IHJlZi5hY2NvdW50SWQgJiYgYWdlbnQuYWNjb3VudC5sYWJlbCA9PT0gcmVmLmxhYmVsKSBjb250aW51ZVxuICAgICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoYWdlbnQuaWQsIGFnZW50Lmxhc3RTZWVuQXQsIHsgYWNjb3VudDogcmVmLCBldmlkZW5jZTogW3JlZi5zb3VyY2VdIH0sICgpID0+IGFnZW50KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVmKGFjY291bnRJZDogc3RyaW5nLCBzb3VyY2U6IEFjY291bnRSZWZbJ3NvdXJjZSddKTogQWNjb3VudFJlZiB7XG4gICAgY29uc3QgYWNjb3VudCA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hY2NvdW50c1thY2NvdW50SWRdXG4gICAgY29uc3QgbGFiZWxzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmxhYmVsc1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxzLmFjY291bnRUZWFtc1thY2NvdW50SWRdID8/IChhY2NvdW50Py5lbWFpbCA/IGxhYmVscy5hY2NvdW50VGVhbXNbYWNjb3VudC5lbWFpbF0gOiB1bmRlZmluZWQpID8/IGFjY291bnQ/LmVtYWlsID8/IG51bGxcbiAgICByZXR1cm4geyBhY2NvdW50SWQsIGxhYmVsLCBwcm92aWRlcjogYWNjb3VudD8ucHJvdmlkZXIgPz8gbnVsbCwgc291cmNlIH1cbiAgfVxufVxuXG4vKipcbiAqIElzIHRoZSBhZ2VudCBDTEkgdGhhdCB3cm90ZSB0aGUgc2Vzc2lvbiBmaWxlIHN0aWxsIHJ1bm5pbmc/IEEgcGlkIGNhbiBiZSByZXVzZWQgYnkgYW5vdGhlclxuICogcHJvY2Vzcywgc28gb24gTGludXggdGhlIHByb2Nlc3Mgc3RhcnQgdGltZSBtdXN0IGFsc28gbWF0Y2ggdGhlIGZpbGUncyBgcHJvY1N0YXJ0YC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NBbGl2ZShwaWQ6IG51bWJlciwgcHJvY1N0YXJ0OiBzdHJpbmcgfCBudWxsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgcHJvY2Vzcy5raWxsKHBpZCwgMClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSAhPT0gJ0VQRVJNJykgcmV0dXJuIGZhbHNlXG4gIH1cbiAgaWYgKHByb2NTdGFydCAmJiBwcm9jZXNzLnBsYXRmb3JtID09PSAnbGludXgnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCByZWFkRmlsZShgL3Byb2MvJHtwaWR9L3N0YXRgLCAndXRmOCcpXG4gICAgICBjb25zdCBmaWVsZHMgPSBzdGF0LnNsaWNlKHN0YXQubGFzdEluZGV4T2YoJyknKSArIDIpLnNwbGl0KCcgJylcbiAgICAgIHJldHVybiBmaWVsZHNbMTldID09PSBwcm9jU3RhcnRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuIiwgImltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJlY29yZCwgQWdlbnRSb2xlIH0gZnJvbSAnLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHR5cGUgeyBDbGlSdW5uZXIgfSBmcm9tICcuL2NsaS9vcmNhLWNsaS50cydcbmltcG9ydCB0eXBlIHsgRmxvd1N0b3JlIH0gZnJvbSAnLi9zdGF0ZS9zdG9yZS50cydcbmltcG9ydCB0eXBlIHsgSWRlbnRpdHlJbmRleCB9IGZyb20gJy4vc3RhdGUvaWRlbnRpdHktaW5kZXgudHMnXG5cbi8qKiBFdmVyeXRoaW5nIGFuIGFkYXB0ZXIgb3IgY29tbWFuZCBoYW5kbGVyIG5lZWRzOyB0ZXN0cyBwYXNzIGZha2VzLiAqL1xuZXhwb3J0IHR5cGUgV29ya2VyQ29udGV4dCA9IHtcbiAgb3JjYTogUGljazxPcmNhV29ya2VyQXBpLCAnaG9zdCcgfCAnbG9nJz4gJiBQYXJ0aWFsPFBpY2s8T3JjYVdvcmtlckFwaSwgJ3BhbmVscycgfCAnc3RvcmFnZScgfCAnc2V0dGluZ3MnIHwgJ3NlY3JldHMnIHwgJ2V2ZW50cycgfCAnaG9va3MnIHwgJ2FwaSc+PlxuICBzdG9yZTogRmxvd1N0b3JlXG4gIGNsaTogQ2xpUnVubmVyXG4gIGlkZW50aXR5OiBJZGVudGl0eUluZGV4XG4gIG5vdzogKCkgPT4gbnVtYmVyXG4gIGxvZzogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3QWdlbnQoaWQ6IHN0cmluZywgcm9sZTogQWdlbnRSb2xlLCBub3c6IG51bWJlcik6IEFnZW50UmVjb3JkIHtcbiAgcmV0dXJuIHtcbiAgICBpZCxcbiAgICByb2xlLFxuICAgIGFnZW50OiBudWxsLFxuICAgIHRpdGxlOiBudWxsLFxuICAgIHBhcmVudElkOiBudWxsLFxuICAgIHJ1bklkOiBudWxsLFxuICAgIGRpc3BhdGNoSWQ6IG51bGwsXG4gICAgdGFza0lkOiBudWxsLFxuICAgIHRlcm1pbmFsSWQ6IG51bGwsXG4gICAgdGVybWluYWxIYW5kbGU6IG51bGwsXG4gICAgcGFuZUtleTogbnVsbCxcbiAgICBzZXNzaW9uSWQ6IG51bGwsXG4gICAgd29ya3NwYWNlSWQ6IG51bGwsXG4gICAgd29ya3RyZWVQYXRoOiBudWxsLFxuICAgIGJyYW5jaDogbnVsbCxcbiAgICBtb2RlbDogbnVsbCxcbiAgICBlZmZvcnQ6IG51bGwsXG4gICAgYWNjb3VudDogbnVsbCxcbiAgICBzdGF0ZTogJ3Vua25vd24nLFxuICAgIG91dGNvbWU6IG51bGwsXG4gICAgc3RhdGVTaW5jZTogbnVsbCxcbiAgICBzdGFydGVkQXQ6IG51bGwsXG4gICAgZW5kZWRBdDogbnVsbCxcbiAgICBsYXN0U2VlbkF0OiBub3csXG4gICAgbGl2ZTogZmFsc2UsXG4gICAgdG9rZW5zOiBudWxsLFxuICAgIG1lc3NhZ2VDb3VudDogbnVsbCxcbiAgICBmYWlsdXJlQ291bnQ6IDAsXG4gICAgcmV0cnlPZkRpc3BhdGNoSWQ6IG51bGwsXG4gICAgY2FsbElkOiBudWxsLFxuICAgIHN1YmFnZW50VHlwZTogbnVsbCxcbiAgICBkZXNjcmlwdGlvbjogbnVsbCxcbiAgICBldmlkZW5jZTogW10sXG4gICAgdmVyc2lvbjogMFxuICB9XG59XG5cbi8qKiBQYXJzZXMgT3JjYSB0aW1lc3RhbXBzOiBJU08gc3RyaW5ncywgXCJZWVlZLU1NLUREIEhIOk1NOlNTXCIgKFVUQykgb3IgZXBvY2ggbXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUaW1lKHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJyB8fCAhdmFsdWUgfHwgdmFsdWUgPT09ICdOb25lJykgcmV0dXJuIG51bGxcbiAgY29uc3Qgbm9ybWFsaXplZCA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0gXFxkezJ9OlxcZHsyfTpcXGR7Mn0kLy50ZXN0KHZhbHVlKSA/IHZhbHVlLnJlcGxhY2UoJyAnLCAnVCcpICsgJ1onIDogdmFsdWVcbiAgY29uc3QgbXMgPSBEYXRlLnBhcnNlKG5vcm1hbGl6ZWQpXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobXMpID8gbXMgOiBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdHIodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUgIT09ICcnICYmIHZhbHVlICE9PSAnTm9uZScgPyB2YWx1ZSA6IG51bGxcbn1cbiIsICIvLyBMaW5rcyB0aGUgZGlmZmVyZW50IGlkcyBPcmNhIHVzZXMgZm9yIG9uZSBhZ2VudCAodGVybWluYWwgaWQsIG9yY2hlc3RyYXRpb24gdGVybWluYWwgaGFuZGxlLFxuLy8gcGFuZSBrZXksIHNlc3Npb24gaWQpIHNvIGEgc3RhdHVzIGV2ZW50IGFuZCBhbiBvcmNoZXN0cmF0aW9uIGRpc3BhdGNoIGxhbmQgb24gdGhlIHNhbWUgbm9kZS5cblxuZXhwb3J0IHR5cGUgQWdlbnRLZXlzID0ge1xuICB0ZXJtaW5hbElkPzogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbEhhbmRsZT86IHN0cmluZyB8IG51bGxcbiAgcGFuZUtleT86IHN0cmluZyB8IG51bGxcbiAgc2Vzc2lvbklkPzogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY2xhc3MgSWRlbnRpdHlJbmRleCB7XG4gIHByaXZhdGUgYnlLZXkgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgbGluayhhZ2VudElkOiBzdHJpbmcsIGtleXM6IEFnZW50S2V5cyk6IHZvaWQge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleUxpc3Qoa2V5cykpIHtcbiAgICAgIC8vIE9yY2hlc3RyYXRpb24gZGlzcGF0Y2ggaWRzIHdpbiBvdmVyIHBsYWluIHRlcm1pbmFsIGlkczogdGhleSBjYXJyeSBtb3JlIGNvbnRleHQuXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuYnlLZXkuZ2V0KGtleSlcbiAgICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZy5zdGFydHNXaXRoKCdkaXNwYXRjaDonKSAmJiAhYWdlbnRJZC5zdGFydHNXaXRoKCdkaXNwYXRjaDonKSkgY29udGludWVcbiAgICAgIHRoaXMuYnlLZXkuc2V0KGtleSwgYWdlbnRJZClcbiAgICB9XG4gIH1cblxuICByZXNvbHZlKGtleXM6IEFnZW50S2V5cyk6IHN0cmluZyB8IG51bGwge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleUxpc3Qoa2V5cykpIHtcbiAgICAgIGNvbnN0IGlkID0gdGhpcy5ieUtleS5nZXQoa2V5KVxuICAgICAgaWYgKGlkKSByZXR1cm4gaWRcbiAgICB9XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHVubGlua0FnZW50KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgW2tleSwgaWRdIG9mIHRoaXMuYnlLZXkpIGlmIChpZCA9PT0gYWdlbnRJZCkgdGhpcy5ieUtleS5kZWxldGUoa2V5KVxuICB9XG59XG5cbmZ1bmN0aW9uIGtleUxpc3Qoa2V5czogQWdlbnRLZXlzKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW11cbiAgaWYgKGtleXMucGFuZUtleSkgb3V0LnB1c2goYHBhbmU6JHtub3JtYWxpemVQYW5lS2V5KGtleXMucGFuZUtleSl9YClcbiAgaWYgKGtleXMudGVybWluYWxIYW5kbGUpIG91dC5wdXNoKGBoYW5kbGU6JHtrZXlzLnRlcm1pbmFsSGFuZGxlfWApXG4gIGlmIChrZXlzLnRlcm1pbmFsSWQpIG91dC5wdXNoKGB0ZXJtOiR7a2V5cy50ZXJtaW5hbElkfWApXG4gIGlmIChrZXlzLnNlc3Npb25JZCkgb3V0LnB1c2goYHNlc3Npb246JHtrZXlzLnNlc3Npb25JZH1gKVxuICByZXR1cm4gb3V0XG59XG5cbi8qKlxuICogU3RydWN0dXJlZCAoY2hhdCkgc2Vzc2lvbnMgdXNlIGBzdHJ1Y3R1cmVkLWFnZW50LXNlc3Npb24tPHNlc3Npb24+OjxwYW5lIGluc3RhbmNlPmA7IHN0YXR1cyBldmVudHNcbiAqIGFuZCBvcmNoZXN0cmF0aW9uIGRpc3BhdGNoZXMgbmFtZSBkaWZmZXJlbnQgaW5zdGFuY2VzIG9mIHRoZSBzYW1lIHNlc3Npb24sIHNvIG1hdGNoIG9uIHRoZVxuICogc2Vzc2lvbiBwYXJ0LiBUZXJtaW5hbCBwYW5lIGtleXMgKGA8dGFiIGdyb3VwPjo8cGFuZT5gKSBzdGF5IGV4YWN0OiB0aGUgZ3JvdXAgaXMgc2hhcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGFuZUtleShwYW5lS2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAocGFuZUtleS5zdGFydHNXaXRoKCdzdHJ1Y3R1cmVkLWFnZW50LXNlc3Npb24tJykpIHJldHVybiBwYW5lS2V5LnNwbGl0KCc6JylbMF1cbiAgcmV0dXJuIHBhbmVLZXlcbn1cblxuLyoqIEFnZW50cyAob3RoZXIgdGhhbiBgZXhjZXB0YCkgd2hvc2UgcGFuZSBrZXkgbmFtZXMgdGhlIHNhbWUgcGFuZSBvciBzdHJ1Y3R1cmVkIHNlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gc2FtZVBhbmVLZXkoYTogc3RyaW5nIHwgbnVsbCwgYjogc3RyaW5nIHwgbnVsbCk6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihhICYmIGIgJiYgbm9ybWFsaXplUGFuZUtleShhKSA9PT0gbm9ybWFsaXplUGFuZUtleShiKSlcbn1cbiIsICIvLyBGb2xkcyBhIGR1cGxpY2F0ZSBhZ2VudCByZWNvcmQgaW50byB0aGUgY2Fub25pY2FsIG9uZSAoYW4gb3JjaGVzdHJhdGlvbiBkaXNwYXRjaCB3aW5zKSwga2VlcGluZ1xuLy8gZXZlcnl0aGluZyB0aGUgZHVwbGljYXRlIGxlYXJuZWQgKHNlc3Npb24sIGFjY291bnQsIHRva2VucywgdGVybWluYWwpIGFuZCByZW1vdmluZyBpdC5cbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgdHlwZSB7IElkZW50aXR5SW5kZXggfSBmcm9tICcuL2lkZW50aXR5LWluZGV4LnRzJ1xuaW1wb3J0IHsgc2FtZVBhbmVLZXkgfSBmcm9tICcuL2lkZW50aXR5LWluZGV4LnRzJ1xuaW1wb3J0IHR5cGUgeyBGbG93U3RvcmUgfSBmcm9tICcuL3N0b3JlLnRzJ1xuXG5jb25zdCBDQVJSWTogKGtleW9mIEFnZW50UmVjb3JkKVtdID0gWydzZXNzaW9uSWQnLCAndGVybWluYWxJZCcsICdhY2NvdW50JywgJ3Rva2VucycsICdtZXNzYWdlQ291bnQnLCAnYWdlbnQnLCAnbW9kZWwnLCAnZWZmb3J0JywgJ2JyYW5jaCcsICd3b3JrdHJlZVBhdGgnLCAnd29ya3NwYWNlSWQnXVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VBZ2VudEludG8oc3RvcmU6IEZsb3dTdG9yZSwgaWRlbnRpdHk6IElkZW50aXR5SW5kZXgsIHRhcmdldElkOiBzdHJpbmcsIHNvdXJjZUlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKHRhcmdldElkID09PSBzb3VyY2VJZCkgcmV0dXJuXG4gIGNvbnN0IHN0YXRlID0gc3RvcmUucmVhZCgpXG4gIGNvbnN0IHRhcmdldCA9IHN0YXRlLmFnZW50c1t0YXJnZXRJZF1cbiAgY29uc3Qgc291cmNlID0gc3RhdGUuYWdlbnRzW3NvdXJjZUlkXVxuICBpZiAoIXRhcmdldCB8fCAhc291cmNlKSByZXR1cm5cbiAgY29uc3QgcGF0Y2g6IFBhcnRpYWw8QWdlbnRSZWNvcmQ+ID0geyBldmlkZW5jZTogc291cmNlLmV2aWRlbmNlIH1cbiAgZm9yIChjb25zdCBrZXkgb2YgQ0FSUlkpIGlmICh0YXJnZXRba2V5XSA9PSBudWxsICYmIHNvdXJjZVtrZXldICE9IG51bGwpIChwYXRjaCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilba2V5XSA9IHNvdXJjZVtrZXldXG4gIC8vIExpdmUgc3RhdHVzIGZyb20gaG9zdCBldmVudHMgaXMgbW9yZSBwcmVjaXNlIHRoYW4gdGhlIGR1cmFibGUgcG9sbDsga2VlcCB0aGUgbmV3ZXIgb25lLlxuICBpZiAoc291cmNlLmxhc3RTZWVuQXQgPiB0YXJnZXQubGFzdFNlZW5BdCkgT2JqZWN0LmFzc2lnbihwYXRjaCwgeyBzdGF0ZTogc291cmNlLnN0YXRlLCBsaXZlOiBzb3VyY2UubGl2ZSwgc3RhdGVTaW5jZTogc291cmNlLnN0YXRlU2luY2UgfSlcbiAgc3RvcmUudXBzZXJ0QWdlbnQodGFyZ2V0SWQsIE1hdGgubWF4KHNvdXJjZS5sYXN0U2VlbkF0LCB0YXJnZXQubGFzdFNlZW5BdCksIHBhdGNoLCAoKSA9PiB0YXJnZXQpXG4gIC8vIENoaWxkcmVuIChzdWJhZ2VudHMpIGZvbGxvdyB0aGVpciBwYXJlbnQuXG4gIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyhzdGF0ZS5hZ2VudHMpKSBpZiAoYWdlbnQucGFyZW50SWQgPT09IHNvdXJjZUlkKSBzdG9yZS51cHNlcnRBZ2VudChhZ2VudC5pZCwgYWdlbnQubGFzdFNlZW5BdCwgeyBwYXJlbnRJZDogdGFyZ2V0SWQgfSwgKCkgPT4gYWdlbnQpXG4gIHN0b3JlLnJlbW92ZUFnZW50KHNvdXJjZUlkKVxuICBpZGVudGl0eS51bmxpbmtBZ2VudChzb3VyY2VJZClcbiAgaWRlbnRpdHkubGluayh0YXJnZXRJZCwgeyB0ZXJtaW5hbElkOiBzb3VyY2UudGVybWluYWxJZCwgc2Vzc2lvbklkOiBzb3VyY2Uuc2Vzc2lvbklkLCBwYW5lS2V5OiBzb3VyY2UucGFuZUtleSB9KVxufVxuXG5jb25zdCByYW5rID0gKGFnZW50OiBBZ2VudFJlY29yZCkgPT4gKGFnZW50LmRpc3BhdGNoSWQgPyAzIDogYWdlbnQucm9sZSA9PT0gJ2xlYWQnID8gMiA6IDEpXG5cbi8qKlxuICogQWZ0ZXIgYW55IG9ic2VydmF0aW9uOiBpZiBhbm90aGVyIHJlY29yZCBuYW1lcyB0aGUgc2FtZSBhZ2VudCAoc2FtZSB0ZXJtaW5hbCwgc2Vzc2lvbiBvclxuICogc3RydWN0dXJlZC1zZXNzaW9uIHBhbmUpLCBmb2xkIHRoZSB3ZWFrZXIgb25lIGludG8gdGhlIHN0cm9uZ2VyIG9uZSAoZGlzcGF0Y2ggPiBsZWFkID4gcGxhaW4pLFxuICogc28gb25lIGFnZW50IGlzIG5ldmVyIGRyYXduIHR3aWNlIGFuZCBubyBvcnBoYW4gc3RheXMgXCJsaXZlXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWR1cGVBZ2VudChzdG9yZTogRmxvd1N0b3JlLCBpZGVudGl0eTogSWRlbnRpdHlJbmRleCwgYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYWdlbnQgPSBzdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50SWRdXG4gIGlmICghYWdlbnQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgcmV0dXJuIGFnZW50SWRcbiAgbGV0IHN1cnZpdm9yID0gYWdlbnRcbiAgZm9yIChjb25zdCBvdGhlciBvZiBPYmplY3QudmFsdWVzKHN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgaWYgKG90aGVyLmlkID09PSBzdXJ2aXZvci5pZCB8fCBvdGhlci5yb2xlID09PSAnc3ViYWdlbnQnKSBjb250aW51ZVxuICAgIC8vIFR3byBkaWZmZXJlbnQgZGlzcGF0Y2hlcyBhcmUgdHdvIGF0dGVtcHRzLCBuZXZlciB0aGUgc2FtZSBhZ2VudC5cbiAgICBpZiAob3RoZXIuZGlzcGF0Y2hJZCAmJiBzdXJ2aXZvci5kaXNwYXRjaElkKSBjb250aW51ZVxuICAgIGNvbnN0IHNhbWUgPVxuICAgICAgKG90aGVyLnRlcm1pbmFsSWQgJiYgb3RoZXIudGVybWluYWxJZCA9PT0gc3Vydml2b3IudGVybWluYWxJZCkgfHxcbiAgICAgIChvdGhlci5zZXNzaW9uSWQgJiYgb3RoZXIuc2Vzc2lvbklkID09PSBzdXJ2aXZvci5zZXNzaW9uSWQpIHx8XG4gICAgICBzYW1lUGFuZUtleShvdGhlci5wYW5lS2V5LCBzdXJ2aXZvci5wYW5lS2V5KVxuICAgIGlmICghc2FtZSkgY29udGludWVcbiAgICBjb25zdCBrZWVwT3RoZXIgPSByYW5rKG90aGVyKSA+IHJhbmsoc3Vydml2b3IpIHx8IChyYW5rKG90aGVyKSA9PT0gcmFuayhzdXJ2aXZvcikgJiYgb3RoZXIubGFzdFNlZW5BdCA+IHN1cnZpdm9yLmxhc3RTZWVuQXQpXG4gICAgY29uc3QgW3RhcmdldCwgc291cmNlXSA9IGtlZXBPdGhlciA/IFtvdGhlciwgc3Vydml2b3JdIDogW3N1cnZpdm9yLCBvdGhlcl1cbiAgICBtZXJnZUFnZW50SW50byhzdG9yZSwgaWRlbnRpdHksIHRhcmdldC5pZCwgc291cmNlLmlkKVxuICAgIHN1cnZpdm9yID0gc3RvcmUucmVhZCgpLmFnZW50c1t0YXJnZXQuaWRdID8/IHRhcmdldFxuICB9XG4gIHJldHVybiBzdXJ2aXZvci5pZFxufVxuXG4vKiogTWVyZ2VzIGV2ZXJ5IG5vbi1kaXNwYXRjaCByZWNvcmQgdGhhdCBzaGFyZXMgYSBwYW5lL3Nlc3Npb24gd2l0aCBhIGRpc3BhdGNoIHJlY29yZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUR1cGxpY2F0ZXNPZihzdG9yZTogRmxvd1N0b3JlLCBpZGVudGl0eTogSWRlbnRpdHlJbmRleCwgZGlzcGF0Y2hBZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdGFyZ2V0ID0gc3RvcmUucmVhZCgpLmFnZW50c1tkaXNwYXRjaEFnZW50SWRdXG4gIGlmICghdGFyZ2V0Py5wYW5lS2V5KSByZXR1cm5cbiAgZm9yIChjb25zdCBhZ2VudCBvZiBPYmplY3QudmFsdWVzKHN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgaWYgKGFnZW50LmlkID09PSBkaXNwYXRjaEFnZW50SWQgfHwgYWdlbnQuZGlzcGF0Y2hJZCB8fCBhZ2VudC5yb2xlID09PSAnbGVhZCcgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICBpZiAoc2FtZVBhbmVLZXkoYWdlbnQucGFuZUtleSwgdGFyZ2V0LnBhbmVLZXkpKSBtZXJnZUFnZW50SW50byhzdG9yZSwgaWRlbnRpdHksIGRpc3BhdGNoQWdlbnRJZCwgYWdlbnQuaWQpXG4gIH1cbn1cbiIsICIvLyBMaXZlIGFnZW50cyBmcm9tIE9yY2EncyBob3N0IEFQSTogd29ya3NwYWNlLmxpc3QgKyBhZ2VudHMubGlzdCwgdGhlbiBhZ2VudC5zdGF0dXMuY2hhbmdlZC5cbmltcG9ydCB0eXBlIHsgQWdlbnRSdW50aW1lU3RhdGUsIFdvcmt0cmVlUmVjb3JkIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgbmV3QWdlbnQsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgeyBkZWR1cGVBZ2VudCB9IGZyb20gJy4uL3N0YXRlL21lcmdlLWFnZW50cy50cydcblxudHlwZSBIb3N0QWdlbnRSb3cgPSB7XG4gIHRlcm1pbmFsSWQ6IHN0cmluZyB8IG51bGxcbiAgdGl0bGU6IHN0cmluZyB8IG51bGxcbiAgYWdlbnQ6IHN0cmluZyB8IG51bGxcbiAgc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJ1xuICBzdGF0ZVN0YXJ0ZWRBdDogbnVtYmVyXG4gIHNlc3Npb25JZD86IHN0cmluZyB8IG51bGxcbiAgdGFzaz86IHsgdGl0bGU6IHN0cmluZyB9IHwgbnVsbFxufVxuXG50eXBlIFN0YXR1c0V2ZW50ID0ge1xuICB3b3Jrc3BhY2VJZDogc3RyaW5nIHwgbnVsbFxuICB3b3Jrc3BhY2VMaXN0SWQ/OiBzdHJpbmdcbiAgcGFuZUtleTogc3RyaW5nXG4gIHRlcm1pbmFsSWQ/OiBzdHJpbmdcbiAgdGl0bGU/OiBzdHJpbmdcbiAgc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJ1xuICByZWNlaXZlZEF0OiBudW1iZXJcbiAgbWFpbkFnZW50PzogeyBzdGF0ZTogc3RyaW5nOyBvdXRjb21lPzogc3RyaW5nOyBzdGF0ZVN0YXJ0ZWRBdDogbnVtYmVyIH1cbiAgc2Vzc2lvbklkPzogc3RyaW5nXG59XG5cbmNvbnN0IE1BWF9XT1JLU1BBQ0VTX1BFUl9TQ0FOID0gNDBcblxuZXhwb3J0IGNsYXNzIEFnZW50c0FkYXB0ZXIge1xuICBwcml2YXRlIHdvcmtzcGFjZUJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBXb3JrdHJlZVJlY29yZD4oKVxuICBwcml2YXRlIHNjYW5uaW5nID0gZmFsc2VcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICB3b3JrdHJlZUZvclBhdGgocGF0aDogc3RyaW5nIHwgbnVsbCk6IFdvcmt0cmVlUmVjb3JkIHwgbnVsbCB7XG4gICAgcmV0dXJuIHBhdGggPyB0aGlzLndvcmtzcGFjZUJ5UGF0aC5nZXQocGF0aCkgPz8gbnVsbCA6IG51bGxcbiAgfVxuXG4gIC8qKiBGdWxsIHJlLXNjYW46IGV2ZXJ5IHdvcmtzcGFjZSBhbmQgdGhlIGFnZW50cyBpbiB0aGUgYWN0aXZlIG9uZXMuICovXG4gIGFzeW5jIHNjYW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc2Nhbm5pbmcpIHJldHVyblxuICAgIHRoaXMuc2Nhbm5pbmcgPSB0cnVlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgaG9zdCB9ID0gdGhpcy5jdHgub3JjYVxuICAgICAgaWYgKCFob3N0Lmhhcygnd29ya3NwYWNlLmxpc3QnKSkgcmV0dXJuXG4gICAgICBjb25zdCBsaXN0ZWQgPSBhd2FpdCBob3N0LmNhbGwoJ3dvcmtzcGFjZS5saXN0JywgeyBpbmNsdWRlU3RhdHVzOiB0cnVlIH0pXG4gICAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIGxpc3RlZC53b3Jrc3BhY2VzKSB7XG4gICAgICAgIGNvbnN0IHJlY29yZDogV29ya3RyZWVSZWNvcmQgPSB7XG4gICAgICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgICAgICBuYW1lOiByb3cubmFtZSxcbiAgICAgICAgICBwYXRoOiByb3cucGF0aCxcbiAgICAgICAgICBicmFuY2g6IHJvdy5icmFuY2gsXG4gICAgICAgICAgcHJvamVjdDogcm93LnByb2plY3QgPz8gbnVsbCxcbiAgICAgICAgICBwcm9qZWN0SWQ6IHJvdy5wcm9qZWN0SWQgPz8gbnVsbCxcbiAgICAgICAgICBob3N0SWQ6IHJvdy5ob3N0SWQsXG4gICAgICAgICAga2luZDogcm93LmtpbmQsXG4gICAgICAgICAgc3RhdHVzOiByb3cuc3RhdHVzPy5zdGF0ZSA/PyBudWxsLFxuICAgICAgICAgIHRlcm1pbmFsQ291bnQ6IHJvdy5zdGF0dXM/LnRlcm1pbmFsQ291bnQgPz8gbnVsbCxcbiAgICAgICAgICBsYXN0QWN0aXZpdHlBdDogcm93LnN0YXR1cz8ubGFzdEFjdGl2aXR5QXQgPz8gbnVsbCxcbiAgICAgICAgICB2ZXJzaW9uOiAwXG4gICAgICAgIH1cbiAgICAgICAgc2Vlbi5hZGQocm93LmlkKVxuICAgICAgICB0aGlzLndvcmtzcGFjZUJ5UGF0aC5zZXQocm93LnBhdGgsIHJlY29yZClcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkud29ya3RyZWVzW3Jvdy5pZF1cbiAgICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnd29ya3RyZWUnLCBpZDogcm93LmlkLCB2YWx1ZTogeyAuLi5yZWNvcmQsIHZlcnNpb246IChwcmV2aW91cz8udmVyc2lvbiA/PyAwKSArIDEgfSB9KVxuICAgICAgICBpZiAoIXByZXZpb3VzKSB7XG4gICAgICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IHRzOiB0aGlzLmN0eC5ub3coKSwga2luZDogJ3dvcmt0cmVlLmNyZWF0ZWQnLCBzb3VyY2U6ICdob3N0LWNhbGwnLCBlbnRpdHlJZDogcm93LmlkLCBzdW1tYXJ5OiBgV29ya3RyZWUgJHtyb3cubmFtZX0gKCR7cm93LmJyYW5jaCA/PyAnbm8gYnJhbmNoJ30pYCB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGlkIG9mIE9iamVjdC5rZXlzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXMpKSB7XG4gICAgICAgIGlmICghc2Vlbi5oYXMoaWQpICYmICFsaXN0ZWQudHJ1bmNhdGVkKSB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICd3b3JrdHJlZScsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5zY2FuUHJvamVjdHMoKVxuICAgICAgYXdhaXQgdGhpcy5zY2FuQWdlbnRzKGxpc3RlZC53b3Jrc3BhY2VzKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGFnZW50cyBzY2FuIGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zY2FubmluZyA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqIE9yY2EncyBwcm9qZWN0cyAobmFtZSArIHJvb3QgcGF0aCkgZm9yIGdyb3VwaW5nIGFnZW50cyBpbnRvIHByb2plY3QgYm94ZXMuICovXG4gIHByaXZhdGUgYXN5bmMgc2NhblByb2plY3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgaG9zdCB9ID0gdGhpcy5jdHgub3JjYVxuICAgIGlmICghaG9zdC5oYXMoJ3Byb2plY3QubGlzdCcpKSByZXR1cm5cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBwcm9qZWN0cywgdHJ1bmNhdGVkIH0gPSBhd2FpdCBob3N0LmNhbGwoJ3Byb2plY3QubGlzdCcsIHt9KVxuICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICBmb3IgKGNvbnN0IHAgb2YgcHJvamVjdHMpIHtcbiAgICAgICAgc2Vlbi5hZGQocC5pZClcbiAgICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAncHJvamVjdCcsIGlkOiBwLmlkLCB2YWx1ZTogeyBpZDogcC5pZCwgbmFtZTogcC5uYW1lLCBwYXRoOiBwLnBhdGgsIGtpbmQ6IHAua2luZCwgaG9zdElkOiBwLmhvc3RJZCwgaGlkZGVuOiBwLmhpZGRlbiA9PT0gdHJ1ZSB9IH0pXG4gICAgICB9XG4gICAgICBpZiAoIXRydW5jYXRlZCkgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkucHJvamVjdHMgPz8ge30pKSBpZiAoIXNlZW4uaGFzKGlkKSkgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAncHJvamVjdCcsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYHByb2plY3QubGlzdCBmYWlsZWQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuQWdlbnRzKHdvcmtzcGFjZXM6IHsgaWQ6IHN0cmluZzsgcGF0aDogc3RyaW5nOyBicmFuY2g6IHN0cmluZyB8IG51bGw7IHN0YXR1cz86IHsgc3RhdGU6IHN0cmluZzsgdGVybWluYWxDb3VudDogbnVtYmVyIH0gfVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBob3N0IH0gPSB0aGlzLmN0eC5vcmNhXG4gICAgaWYgKCFob3N0LmhhcygnYWdlbnRzLmxpc3QnKSkgcmV0dXJuXG4gICAgY29uc3QgcGVyV29ya3NwYWNlID0gKHRoaXMuY3R4Lm9yY2EuYXBpPy5taW5vciA/PyAwKSA+PSAxMFxuICAgIGNvbnN0IHRhcmdldHMgPSBwZXJXb3Jrc3BhY2VcbiAgICAgID8gd29ya3NwYWNlcy5maWx0ZXIoKHcpID0+ICh3LnN0YXR1cz8udGVybWluYWxDb3VudCA/PyAwKSA+IDAgfHwgKHcuc3RhdHVzICYmIHcuc3RhdHVzLnN0YXRlICE9PSAnaW5hY3RpdmUnKSkuc2xpY2UoMCwgTUFYX1dPUktTUEFDRVNfUEVSX1NDQU4pXG4gICAgICA6IFtdXG4gICAgY29uc3QgY2FsbHMgPSBwZXJXb3Jrc3BhY2UgPyB0YXJnZXRzLm1hcCgodykgPT4gKHsgd29ya3NwYWNlOiB3IGFzIHR5cGVvZiB3IHwgbnVsbCB9KSkgOiBbeyB3b3Jrc3BhY2U6IG51bGwgfV1cbiAgICBmb3IgKGNvbnN0IHsgd29ya3NwYWNlIH0gb2YgY2FsbHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIGB3b3Jrc3BhY2VJZGAgZXhpc3RzIGZyb20gaG9zdCBBUEkgMS4xMDsgb2xkZXIgT3JjYSBsaXN0cyB0aGUgZm9jdXNlZCB3b3Jrc3BhY2Ugb25seS5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9zdC5jYWxsKCdhZ2VudHMubGlzdCcsICh3b3Jrc3BhY2UgPyB7IHdvcmtzcGFjZUlkOiB3b3Jrc3BhY2UuaWQgfSA6IHt9KSBhcyBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pXG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdC5hZ2VudHMgYXMgSG9zdEFnZW50Um93W10pIHRoaXMuYXBwbHlSb3cocm93LCB3b3Jrc3BhY2UpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmN0eC5sb2coYGFnZW50cy5saXN0IGZhaWxlZCBmb3IgJHt3b3Jrc3BhY2U/LmlkID8/ICdmb2N1c2VkIHdvcmtzcGFjZSd9OiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlSb3cocm93OiBIb3N0QWdlbnRSb3csIHdvcmtzcGFjZTogeyBpZDogc3RyaW5nOyBwYXRoOiBzdHJpbmc7IGJyYW5jaDogc3RyaW5nIHwgbnVsbCB9IHwgbnVsbCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3QgZXhpc3RpbmdJZCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoeyB0ZXJtaW5hbElkOiByb3cudGVybWluYWxJZCwgc2Vzc2lvbklkOiByb3cuc2Vzc2lvbklkID8/IG51bGwgfSlcbiAgICBjb25zdCBpZCA9IGV4aXN0aW5nSWQgPz8gKHJvdy50ZXJtaW5hbElkID8gYHRlcm06JHtyb3cudGVybWluYWxJZH1gIDogcm93LnNlc3Npb25JZCA/IGBzZXNzaW9uOiR7cm93LnNlc3Npb25JZH1gIDogbnVsbClcbiAgICBpZiAoIWlkKSByZXR1cm5cbiAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbaWRdXG4gICAgY29uc3Qgc3RhdGUgPSBtYXBTdGF0ZShyb3cuc3RhdGUpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIHJvdy5zdGF0ZVN0YXJ0ZWRBdCB8fCBub3csXG4gICAgICB7XG4gICAgICAgIGFnZW50OiByb3cuYWdlbnQgPz8gdW5kZWZpbmVkLFxuICAgICAgICB0aXRsZTogcm93LnRpdGxlID8/IHVuZGVmaW5lZCxcbiAgICAgICAgdGVybWluYWxJZDogcm93LnRlcm1pbmFsSWQgPz8gdW5kZWZpbmVkLFxuICAgICAgICBzZXNzaW9uSWQ6IHJvdy5zZXNzaW9uSWQgPz8gdW5kZWZpbmVkLFxuICAgICAgICB3b3Jrc3BhY2VJZDogd29ya3NwYWNlPy5pZCxcbiAgICAgICAgd29ya3RyZWVQYXRoOiB3b3Jrc3BhY2U/LnBhdGgsXG4gICAgICAgIGJyYW5jaDogd29ya3NwYWNlPy5icmFuY2ggPz8gdW5kZWZpbmVkLFxuICAgICAgICBkZXNjcmlwdGlvbjogcm93LnRhc2s/LnRpdGxlID8/IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIHN0YXRlU2luY2U6IHJvdy5zdGF0ZVN0YXJ0ZWRBdCB8fCB1bmRlZmluZWQsXG4gICAgICAgIGxpdmU6IHN0YXRlICE9PSAnZG9uZScsXG4gICAgICAgIHN0YXJ0ZWRBdDogcHJldmlvdXM/LnN0YXJ0ZWRBdCA/PyByb3cuc3RhdGVTdGFydGVkQXQgPz8gbm93LFxuICAgICAgICBldmlkZW5jZTogWydob3N0LWNhbGwnXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnYWdlbnQnLCBub3cpXG4gICAgKVxuICAgIHRoaXMuY3R4LmlkZW50aXR5LmxpbmsoaWQsIHsgdGVybWluYWxJZDogcm93LnRlcm1pbmFsSWQsIHNlc3Npb25JZDogcm93LnNlc3Npb25JZCA/PyBudWxsIH0pXG4gICAgZGVkdXBlQWdlbnQodGhpcy5jdHguc3RvcmUsIHRoaXMuY3R4LmlkZW50aXR5LCBpZClcbiAgICBpZiAoIXByZXZpb3VzKSB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgdHM6IG5vdywga2luZDogJ2FnZW50LmNyZWF0ZWQnLCBzb3VyY2U6ICdob3N0LWNhbGwnLCBlbnRpdHlJZDogaWQsIHN1bW1hcnk6IGAke3Jvdy5hZ2VudCA/PyAnQWdlbnQnfSAke3Jvdy50aXRsZSA/PyAnJ30gZm91bmQgKCR7cm93LnN0YXRlfSlgLnRyaW0oKSB9KVxuICB9XG5cbiAgLyoqIGFnZW50LnN0YXR1cy5jaGFuZ2VkOiB0aGUgbW9zdCBwcmVjaXNlIGxpdmUgc2lnbmFsIE9yY2EgZ2l2ZXMuICovXG4gIG9uU3RhdHVzKGV2ZW50OiBTdGF0dXNFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3Qga2V5cyA9IHsgcGFuZUtleTogZXZlbnQucGFuZUtleSwgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCA/PyBudWxsLCBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCA/PyBudWxsIH1cbiAgICBjb25zdCBpZCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoa2V5cykgPz8gKGV2ZW50LnRlcm1pbmFsSWQgPyBgdGVybToke2V2ZW50LnRlcm1pbmFsSWR9YCA6IGBwYW5lOiR7ZXZlbnQucGFuZUtleX1gKVxuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1tpZF1cbiAgICBjb25zdCBtYWluID0gZXZlbnQubWFpbkFnZW50XG4gICAgY29uc3Qgc3RhdGUgPSBtYXBTdGF0ZSgobWFpbj8uc3RhdGUgYXMgU3RhdHVzRXZlbnRbJ3N0YXRlJ10pID8/IGV2ZW50LnN0YXRlLCBtYWluPy5vdXRjb21lKVxuICAgIGNvbnN0IHdvcmtzcGFjZSA9IGV2ZW50LndvcmtzcGFjZUxpc3RJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXNbZXZlbnQud29ya3NwYWNlTGlzdElkXSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgaWQsXG4gICAgICBldmVudC5yZWNlaXZlZEF0IHx8IG5vdyxcbiAgICAgIHtcbiAgICAgICAgcGFuZUtleTogZXZlbnQucGFuZUtleSxcbiAgICAgICAgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgIHRpdGxlOiBldmVudC50aXRsZSxcbiAgICAgICAgd29ya3NwYWNlSWQ6IGV2ZW50LndvcmtzcGFjZUxpc3RJZCA/PyBldmVudC53b3Jrc3BhY2VJZCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHdvcmt0cmVlUGF0aDogd29ya3NwYWNlPy5wYXRoLFxuICAgICAgICBicmFuY2g6IHdvcmtzcGFjZT8uYnJhbmNoID8/IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIG91dGNvbWU6IG1haW4/Lm91dGNvbWUgPz8gdW5kZWZpbmVkLFxuICAgICAgICBzdGF0ZVNpbmNlOiBtYWluPy5zdGF0ZVN0YXJ0ZWRBdCA/PyBldmVudC5yZWNlaXZlZEF0LFxuICAgICAgICBsaXZlOiBzdGF0ZSA9PT0gJ3dvcmtpbmcnIHx8IHN0YXRlID09PSAnYmxvY2tlZCcgfHwgc3RhdGUgPT09ICd3YWl0aW5nJyxcbiAgICAgICAgc3RhcnRlZEF0OiBwcmV2aW91cz8uc3RhcnRlZEF0ID8/IGV2ZW50LnJlY2VpdmVkQXQgPz8gbm93LFxuICAgICAgICBlbmRlZEF0OiBzdGF0ZSA9PT0gJ2RvbmUnIHx8IHN0YXRlID09PSAnZmFpbGVkJyA/IGV2ZW50LnJlY2VpdmVkQXQgOiBudWxsLFxuICAgICAgICBldmlkZW5jZTogWydob3N0LWV2ZW50J11cbiAgICAgIH0sXG4gICAgICAoKSA9PiBuZXdBZ2VudChpZCwgJ2FnZW50Jywgbm93KVxuICAgIClcbiAgICB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCBrZXlzKVxuICAgIGRlZHVwZUFnZW50KHRoaXMuY3R4LnN0b3JlLCB0aGlzLmN0eC5pZGVudGl0eSwgaWQpXG4gICAgaWYgKCFwcmV2aW91cyB8fCBwcmV2aW91cy5zdGF0ZSAhPT0gcmVjb3JkLnN0YXRlKSB7XG4gICAgICBjb25zdCBraW5kID0gIXByZXZpb3VzID8gJ2FnZW50LnN0YXJ0ZWQnIDogc3RhdGUgPT09ICdmYWlsZWQnID8gJ2FnZW50LmZhaWxlZCcgOiBzdGF0ZSA9PT0gJ2RvbmUnID8gJ2FnZW50LmNvbXBsZXRlZCcgOiAnYWdlbnQuc3RhdHVzX2NoYW5nZWQnXG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHtcbiAgICAgICAgdHM6IGV2ZW50LnJlY2VpdmVkQXQgfHwgbm93LFxuICAgICAgICBraW5kLFxuICAgICAgICBzb3VyY2U6ICdob3N0LWV2ZW50JyxcbiAgICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgICBydW5JZDogcmVjb3JkLnJ1bklkLFxuICAgICAgICBzdW1tYXJ5OiBgJHtyZWNvcmQudGl0bGUgPz8gcmVjb3JkLmFnZW50ID8/ICdBZ2VudCd9OiAke3ByZXZpb3VzPy5zdGF0ZSA/PyAnbmV3J30gXHUyMTkyICR7c3RhdGV9JHttYWluPy5vdXRjb21lID8gYCAoJHttYWluLm91dGNvbWV9KWAgOiAnJ31gXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFwU3RhdGUoc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJywgb3V0Y29tZT86IHN0cmluZyk6IEFnZW50UnVudGltZVN0YXRlIHtcbiAgaWYgKHN0YXRlID09PSAnZG9uZScgJiYgb3V0Y29tZSAmJiAob3V0Y29tZSA9PT0gJ2ZhaWx1cmUnIHx8IG91dGNvbWUgPT09ICdpbnRlcnJ1cHRpb24nKSkgcmV0dXJuICdmYWlsZWQnXG4gIHJldHVybiBzdGF0ZVxufVxuIiwgIi8vIFJlbW92ZXMgc2VjcmV0cyBmcm9tIGFueSB0ZXh0IGJlZm9yZSBpdCByZWFjaGVzIGEgVUksIHRoZSBkYXNoYm9hcmQgb3IgaGlzdG9yeS5cblxuY29uc3QgUkVEQUNURUQgPSAnW3JlZGFjdGVkXSdcblxuLyoqIFdlbGwta25vd24gdG9rZW4gc2hhcGVzLCByZXBsYWNlZCB3aGVyZXZlciB0aGV5IGFwcGVhci4gT3JkZXIgbWF0dGVycy4gKi9cbmNvbnN0IFBBVFRFUk5TOiBbUmVnRXhwLCBzdHJpbmddW10gPSBbXG4gIFsvLS0tLS1CRUdJTiBbQS1aIF0qUFJJVkFURSBLRVktLS0tLVtcXHNcXFNdKj8tLS0tLUVORCBbQS1aIF0qUFJJVkFURSBLRVktLS0tLS9nLCAnW3JlZGFjdGVkLXByaXZhdGUta2V5XSddLFxuICAvLyBCZWFyZXIgYmVmb3JlIHRoZSBrZXk9dmFsdWUgcnVsZXM6IHRoZXkgd291bGQgb3RoZXJ3aXNlIGVhdCB0aGUgd29yZCBcIkJlYXJlclwiLlxuICBbLyhCZWFyZXJcXHMrKVtBLVphLXowLTkuX34rLy1dezEyLH09Ki9nLCAnJDFbcmVkYWN0ZWRdJ10sXG4gIFsvXFxiKHNrLWFudC1bQS1aYS16MC05Xy1dezEwLH0pL2csICdbcmVkYWN0ZWQta2V5XSddLFxuICBbL1xcYihzay1bQS1aYS16MC05Xy1dezIwLH0pL2csICdbcmVkYWN0ZWQta2V5XSddLFxuICBbL1xcYihnaFtwb3Vzcl1fW0EtWmEtejAtOV17MjAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoZ2l0aHViX3BhdF9bQS1aYS16MC05X117MjAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoeG94W2FicHJzXS1bQS1aYS16MC05LV17MTAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoQUtJQVswLTlBLVpdezE2fSlcXGIvZywgJ1tyZWRhY3RlZC1hd3Mta2V5XSddLFxuICBbL1xcYihBSXphWzAtOUEtWmEtel8tXXszMCx9KS9nLCAnW3JlZGFjdGVkLWtleV0nXSxcbiAgWy9cXGIoZXlKW0EtWmEtejAtOV8tXXsxMCx9XFwuW0EtWmEtejAtOV8tXXsxMCx9XFwuW0EtWmEtejAtOV8tXXsxMCx9KS9nLCAnW3JlZGFjdGVkLWp3dF0nXSxcbiAgLy8gVVJMIGNyZWRlbnRpYWxzOiBrZWVwIHRoZSB1c2VyIG5hbWUsIGhpZGUgdGhlIHBhc3N3b3JkLlxuICBbL1xcYihbYS16XVthLXowLTkrLi1dKjpcXC9cXC9bXlxcczovQD8jXSs6KVteXFxzQC8/I10rQC9naSwgYCQxJHtSRURBQ1RFRH1AYF1cbl1cblxuLy8gXHUyNTAwXHUyNTAwIFNlbnNpdGl2ZSBrZXkgbmFtZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbi8qKiBBbnkgb2YgdGhlc2Ugd29yZCBzZWdtZW50cyBtYWtlcyBhIGtleSBzZW5zaXRpdmUgKGBjbGllbnRfc2VjcmV0YCwgYGRiUGFzc3dvcmRgKS4gKi9cbmNvbnN0IFNUUk9OR19TRUdNRU5UUyA9IG5ldyBTZXQoWydwYXNzd29yZCcsICdwYXNzd2QnLCAncGFzc3BocmFzZScsICdzZWNyZXQnLCAnY3JlZGVudGlhbCcsICdjcmVkZW50aWFscycsICdhdXRob3JpemF0aW9uJywgJ2FwaWtleScsICdwcml2YXRla2V5J10pXG4vKiogYGtleWAgYXMgdGhlIGxhc3Qgc2VnbWVudCBpcyBzZW5zaXRpdmUgb25seSBhZnRlciBvbmUgb2YgdGhlc2UgKGBhcGlfa2V5YCwgYHByaXZhdGVLZXlgKSBvciBpbiBhbiBVUFBFUl9DQVNFIGVudiBuYW1lLiAqL1xuY29uc3QgS0VZX1BSRUZJWEVTID0gbmV3IFNldChbJ2FwaScsICdhY2Nlc3MnLCAncHJpdmF0ZScsICdzZWNyZXQnLCAnYXV0aCcsICdzaWduaW5nJywgJ2VuY3J5cHRpb24nLCAnbWFzdGVyJywgJ2NsaWVudCcsICdsaWNlbnNlJywgJ3Nlc3Npb24nXSlcblxuZnVuY3Rpb24gc2VnbWVudHMoa2V5OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBrZXlcbiAgICAuc3BsaXQoL1tfLi1dKy8pXG4gICAgLmZsYXRNYXAoKHBhcnQpID0+IHBhcnQucmVwbGFjZSgvKFthLXowLTldKShbQS1aXSkvZywgJyQxICQyJykuc3BsaXQoJyAnKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLm1hcCgoc2VnKSA9PiBzZWcudG9Mb3dlckNhc2UoKSlcbn1cblxuLyoqIFRydWUgZm9yIG5hbWVzIGxpa2UgYHBhc3N3b3JkYCwgYEdJVEhVQl9UT0tFTmAsIGBBV1NfU0VDUkVUX0FDQ0VTU19LRVlgLCBgYXBpLWtleWAsIGBhY2Nlc3NUb2tlbmA7IGZhbHNlIGZvciBga2V5Ym9hcmRgLCBgdG9rZW5fY291bnRgLCBgbWF4X3Rva2Vuc2AuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTZW5zaXRpdmVLZXkoa2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgc2VncyA9IHNlZ21lbnRzKGtleSlcbiAgaWYgKHNlZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgaWYgKHNlZ3Muc29tZSgoc2VnKSA9PiBTVFJPTkdfU0VHTUVOVFMuaGFzKHNlZykpKSByZXR1cm4gdHJ1ZVxuICBjb25zdCB1cHBlciA9IC9bQS1aXS8udGVzdChrZXkpICYmIGtleSA9PT0ga2V5LnRvVXBwZXJDYXNlKClcbiAgY29uc3QgbGFzdCA9IHNlZ3Nbc2Vncy5sZW5ndGggLSAxXVxuICBpZiAobGFzdCA9PT0gJ3Rva2VuJykgcmV0dXJuIHRydWVcbiAgaWYgKGxhc3QgPT09ICdrZXknKSByZXR1cm4gdXBwZXIgfHwgKHNlZ3MubGVuZ3RoID4gMSAmJiBLRVlfUFJFRklYRVMuaGFzKHNlZ3Nbc2Vncy5sZW5ndGggLSAyXSkpXG4gIGlmIChsYXN0ID09PSAncGFzcycpIHJldHVybiB1cHBlclxuICByZXR1cm4gZmFsc2Vcbn1cblxuZnVuY3Rpb24gYWxyZWFkeVJlZGFjdGVkKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ1tyZWRhY3RlZCcpXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBLZXkvdmFsdWUgcnVsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbmNvbnN0IEtFWSA9IFN0cmluZy5yYXdgW0EtWmEtel1bQS1aYS16MC05Xy4tXSpgXG5jb25zdCBEUSA9IFN0cmluZy5yYXdgXCIoKD86XFxcXC58W15cIlxcXFxcXG5dKSopXCJgXG5jb25zdCBTUSA9IFN0cmluZy5yYXdgJygoPzpcXFxcLnxbXidcXFxcXFxuXSkqKSdgXG5cbnR5cGUgSGFuZGxlciA9IChncm91cHM6IChzdHJpbmcgfCB1bmRlZmluZWQpW10pID0+IHN0cmluZyB8IG51bGxcblxuLyoqXG4gKiBMaWtlIFN0cmluZy5yZXBsYWNlLCBidXQgd2hlbiB0aGUgaGFuZGxlciBkZWNsaW5lcyAocmV0dXJucyBudWxsKSB0aGUgc2NhbiByZXN1bWVzIG9uZSBjaGFyYWN0ZXJcbiAqIGxhdGVyIGluc3RlYWQgb2YgYWZ0ZXIgdGhlIHdob2xlIG1hdGNoLCBzbyBhIG5vbi1zZWNyZXQgdmFsdWUgY2FuIG5ldmVyIHN3YWxsb3cgYSBmb2xsb3dpbmdcbiAqIGB0b2tlbj1cdTIwMjZgIChgYT1iLHRva2VuPVx1MjAyNmAsIGBodHRwczovL3gvP3Rva2VuPVx1MjAyNmApLlxuICovXG5mdW5jdGlvbiByZXBsYWNlRWFjaCh0ZXh0OiBzdHJpbmcsIHBhdHRlcm46IFJlZ0V4cCwgaGFuZGxlcjogSGFuZGxlcik6IHN0cmluZyB7XG4gIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChwYXR0ZXJuLnNvdXJjZSwgcGF0dGVybi5mbGFncy5pbmNsdWRlcygnZycpID8gcGF0dGVybi5mbGFncyA6IHBhdHRlcm4uZmxhZ3MgKyAnZycpXG4gIGxldCBvdXQgPSAnJ1xuICBsZXQgY29waWVkID0gMFxuICBsZXQgbTogUmVnRXhwRXhlY0FycmF5IHwgbnVsbFxuICB3aGlsZSAoKG0gPSByZS5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IHJlcGxhY2VtZW50ID0gaGFuZGxlcihtLnNsaWNlKDEpKVxuICAgIGlmIChyZXBsYWNlbWVudCA9PT0gbnVsbCkge1xuICAgICAgcmUubGFzdEluZGV4ID0gbS5pbmRleCArIDFcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICAgIG91dCArPSB0ZXh0LnNsaWNlKGNvcGllZCwgbS5pbmRleCkgKyByZXBsYWNlbWVudFxuICAgIGNvcGllZCA9IG0uaW5kZXggKyBtWzBdLmxlbmd0aFxuICAgIHJlLmxhc3RJbmRleCA9IGNvcGllZFxuICB9XG4gIHJldHVybiBvdXQgKyB0ZXh0LnNsaWNlKGNvcGllZClcbn1cblxuLyoqIGBcInBhc3N3b3JkXCI6IFwiXHUyMDI2XCJgIC8gYCdhcGlfa2V5JzogJ1x1MjAyNidgIChKU09OLCBQeXRob24gZGljdHMpLiBRdW90ZXMgYXJlIGtlcHQgc28gSlNPTiBzdGF5cyB2YWxpZC4gKi9cbmNvbnN0IFFVT1RFRF9LRVkgPSBuZXcgUmVnRXhwKFN0cmluZy5yYXdgKFtcIiddKSgke0tFWX0pXFwxKFxccyo6XFxzKikoPzoke0RRfXwke1NRfSlgLCAnZycpXG5cbmZ1bmN0aW9uIHJlZGFjdFF1b3RlZEtleXModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJlcGxhY2VFYWNoKHRleHQsIFFVT1RFRF9LRVksIChbcSwga2V5LCBzZXAsIGRxLCBzcV0pID0+IHtcbiAgICBjb25zdCB2YWx1ZSA9IGRxID8/IHNxID8/ICcnXG4gICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpIHx8ICFpc1NlbnNpdGl2ZUtleShrZXkhKSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB2cSA9IGRxICE9PSB1bmRlZmluZWQgPyAnXCInIDogXCInXCJcbiAgICByZXR1cm4gYCR7cX0ke2tleX0ke3F9JHtzZXB9JHt2cX0ke1JFREFDVEVEfSR7dnF9YFxuICB9KVxufVxuXG4vKiogYC0tcGFzc3dvcmQgeGAsIGAtLWFwaS1rZXk9eGAsIGAtLXRva2VuIFwiYSBiXCJgLiAqL1xuY29uc3QgQ0xJX0ZMQUcgPSBuZXcgUmVnRXhwKFN0cmluZy5yYXdgKD88IVtcXHctXSkoLS0oJHtLRVl9KSkoPXxbIFxcdF0rKSg/OiR7RFF9fCR7U1F9fChbXlxcc1wiJy1dW15cXHNcIiddKikpYCwgJ2cnKVxuXG5mdW5jdGlvbiByZWRhY3RDbGlGbGFncyh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcmVwbGFjZUVhY2godGV4dCwgQ0xJX0ZMQUcsIChbZmxhZywgbmFtZSwgc2VwLCBkcSwgc3EsIGJhcmVdKSA9PiB7XG4gICAgY29uc3QgdmFsdWUgPSBkcSA/PyBzcSA/PyBiYXJlID8/ICcnXG4gICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpIHx8ICFpc1NlbnNpdGl2ZUtleShuYW1lISkpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGAke2ZsYWd9JHtzZXB9JHtSRURBQ1RFRH1gXG4gIH0pXG59XG5cbi8qKiBgcGFzc3dvcmQ9XHUyMDI2YCwgYHNlY3JldDogXCJhIGIgY1wiYCwgYGV4cG9ydCBPUEVOQUlfQVBJX0tFWT1cIlx1MjAyNlwiYCwgYD90b2tlbj1cdTIwMjZgLiAqL1xuY29uc3QgQVNTSUdOTUVOVCA9IG5ldyBSZWdFeHAoU3RyaW5nLnJhd2AoPzwhW1xcdy4tXSkoJHtLRVl9KShcXHMqWzo9XVxccyopKD86JHtEUX18JHtTUX18KFteXFxzXCInJl0rKSlgLCAnZycpXG5jb25zdCBNSU5fQkFSRV9WQUxVRSA9IDZcblxuZnVuY3Rpb24gcmVkYWN0QXNzaWdubWVudHModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJlcGxhY2VFYWNoKHRleHQsIEFTU0lHTk1FTlQsIChba2V5LCBzZXAsIGRxLCBzcSwgYmFyZV0pID0+IHtcbiAgICBpZiAoIWlzU2Vuc2l0aXZlS2V5KGtleSEpKSByZXR1cm4gbnVsbFxuICAgIGlmIChiYXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFNob3J0IGJhcmUgdmFsdWVzIGFyZSB1c3VhbGx5IHByb3NlIChcInBhc3N3b3JkOiB5ZXNcIik7IGF1dGggc2NoZW1lcyBrZWVwIHRoZWlyIG93biBydWxlLlxuICAgICAgaWYgKGJhcmUubGVuZ3RoIDwgTUlOX0JBUkVfVkFMVUUgfHwgYWxyZWFkeVJlZGFjdGVkKGJhcmUpIHx8IC9eKEJlYXJlcnxCYXNpYykkL2kudGVzdChiYXJlKSkgcmV0dXJuIG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgdmFsdWUgPSBkcSA/PyBzcSA/PyAnJ1xuICAgICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpKSByZXR1cm4gbnVsbFxuICAgIH1cbiAgICByZXR1cm4gYCR7a2V5fSR7c2VwfSR7UkVEQUNURUR9YFxuICB9KVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgUHVibGljIEFQSSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gdGV4dFxuICBmb3IgKGNvbnN0IFtwYXR0ZXJuLCByZXBsYWNlbWVudF0gb2YgUEFUVEVSTlMpIG91dCA9IG91dC5yZXBsYWNlKHBhdHRlcm4sIHJlcGxhY2VtZW50KVxuICBvdXQgPSByZWRhY3RRdW90ZWRLZXlzKG91dClcbiAgb3V0ID0gcmVkYWN0Q2xpRmxhZ3Mob3V0KVxuICBvdXQgPSByZWRhY3RBc3NpZ25tZW50cyhvdXQpXG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdE51bGxhYmxlKHRleHQ6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHRleHQgPT0gbnVsbCA/IG51bGwgOiByZWRhY3QodGV4dClcbn1cblxuLyoqIFJlZGFjdHMgZmlyc3QsIHRoZW4gdHJ1bmNhdGVzLCBzbyBhIGN1dCBjYW4gbmV2ZXIgbGVhdmUgYSBwYXJ0aWFsIHNlY3JldCBiZWhpbmQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkYWN0QW5kVHJ1bmNhdGUodGV4dDogc3RyaW5nLCBtYXg6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiB0cnVuY2F0ZShyZWRhY3QodGV4dCksIG1heClcbn1cblxuLyoqIFJlZGFjdHMgbGluZXMgYXMgb25lIHRleHQsIHNvIHNlY3JldHMgdGhhdCBzcGFuIGxpbmVzIChwcml2YXRlIGtleSBibG9ja3MpIGFyZSBjYXVnaHQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkYWN0TGluZXMobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cbiAgcmV0dXJuIHJlZGFjdChsaW5lcy5qb2luKCdcXG4nKSkuc3BsaXQoJ1xcbicpXG59XG5cbi8qKiBTdHJpcHMgQU5TSS9PU0MgZXNjYXBlIHNlcXVlbmNlcyBmcm9tIHRlcm1pbmFsIG91dHB1dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcEFuc2kodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnRyb2wtcmVnZXhcbiAgcmV0dXJuIHRleHQucmVwbGFjZSgvXFx1MDAxYlxcXVteXFx1MDAwN1xcdTAwMWJdKihcXHUwMDA3fFxcdTAwMWJcXFxcKS9nLCAnJykucmVwbGFjZSgvXFx1MDAxYlxcW1swLTk7P10qWyAtL10qW0Atfl0vZywgJycpLnJlcGxhY2UoL1xcdTAwMWJbQC1aXFxcXC1fNzg9Pl0vZywgJycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZSh0ZXh0OiBzdHJpbmcsIG1heDogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHQubGVuZ3RoIDw9IG1heCA/IHRleHQgOiB0ZXh0LnNsaWNlKDAsIG1heCAtIDEpICsgJ1x1MjAyNidcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFRhc2tLaW5kLCBUYXNrU3RhdGUgfSBmcm9tICcuL21vZGVsLnRzJ1xuXG4vKiogQWxsb3dlZCBsaWZlY3ljbGUgdHJhbnNpdGlvbnMuIEFueXRoaW5nIGVsc2UgaXMgcmVqZWN0ZWQgYnkgdGhlIHN0b3JlIGFuZCBieSBjb21tYW5kcy4gKi9cbmV4cG9ydCBjb25zdCBUQVNLX1RSQU5TSVRJT05TOiBSZWNvcmQ8VGFza1N0YXRlLCByZWFkb25seSBUYXNrU3RhdGVbXT4gPSB7XG4gIFBFTkRJTkc6IFsnUkVBRFknLCAnUlVOTklORycsICdCTE9DS0VEJywgJ0NBTkNFTExFRCcsICdGQUlMRUQnXSxcbiAgUkVBRFk6IFsnUlVOTklORycsICdCTE9DS0VEJywgJ0NBTkNFTExFRCcsICdQRU5ESU5HJywgJ0ZBSUxFRCddLFxuICBSVU5OSU5HOiBbJ1JFVklFVycsICdURVNUSU5HJywgJ0FQUFJPVkVEJywgJ0RPTkUnLCAnRkFJTEVEJywgJ0JMT0NLRUQnLCAnQ0FOQ0VMTEVEJ10sXG4gIFJFVklFVzogWydURVNUSU5HJywgJ0FQUFJPVkVEJywgJ1JVTk5JTkcnLCAnRkFJTEVEJywgJ0RPTkUnLCAnQ0FOQ0VMTEVEJ10sXG4gIFRFU1RJTkc6IFsnQVBQUk9WRUQnLCAnUlVOTklORycsICdGQUlMRUQnLCAnRE9ORScsICdDQU5DRUxMRUQnXSxcbiAgQVBQUk9WRUQ6IFsnTUVSR0VEJywgJ0RPTkUnLCAnRkFJTEVEJ10sXG4gIE1FUkdFRDogWydET05FJ10sXG4gIERPTkU6IFsnUkVUUllJTkcnXSxcbiAgQkxPQ0tFRDogWydSRUFEWScsICdSVU5OSU5HJywgJ1BFTkRJTkcnLCAnQ0FOQ0VMTEVEJywgJ0ZBSUxFRCddLFxuICBGQUlMRUQ6IFsnUkVUUllJTkcnLCAnQ0FOQ0VMTEVEJ10sXG4gIFJFVFJZSU5HOiBbJ1JVTk5JTkcnLCAnRkFJTEVEJywgJ0NBTkNFTExFRCcsICdSRUFEWSddLFxuICBDQU5DRUxMRUQ6IFsnUkVUUllJTkcnXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuVHJhbnNpdGlvbihmcm9tOiBUYXNrU3RhdGUsIHRvOiBUYXNrU3RhdGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZyb20gPT09IHRvIHx8IFRBU0tfVFJBTlNJVElPTlNbZnJvbV0uaW5jbHVkZXModG8pXG59XG5cbmV4cG9ydCBjb25zdCBURVJNSU5BTF9UQVNLX1NUQVRFUzogcmVhZG9ubHkgVGFza1N0YXRlW10gPSBbJ0RPTkUnLCAnTUVSR0VEJywgJ0NBTkNFTExFRCcsICdGQUlMRUQnXVxuXG4vKipcbiAqIE1hcHMgT3JjYSdzIHJhdyB0YXNrIHN0YXR1cyAoKyBsaXZlIGRpc3BhdGNoIGluZm8pIG9udG8gdGhlIEFnZW50IEZsb3cgbGlmZWN5Y2xlLlxuICogT3JjYSBzdGF0dXNlczogcGVuZGluZywgcmVhZHksIGRpc3BhdGNoZWQsIGNvbXBsZXRlZCwgZmFpbGVkLCBibG9ja2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFwT3JjYVRhc2tTdGF0dXMoaW5wdXQ6IHtcbiAgb3JjYVN0YXR1czogc3RyaW5nXG4gIGtpbmQ6IFRhc2tLaW5kXG4gIHJlc3VsdE91dGNvbWU6IHN0cmluZyB8IG51bGxcbiAgaGFzT3BlbkdhdGU6IGJvb2xlYW5cbiAgcmV0cnlDb3VudDogbnVtYmVyXG4gIGRpc3BhdGNoQWN0aXZlOiBib29sZWFuXG59KTogVGFza1N0YXRlIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQub3JjYVN0YXR1cy50b0xvd2VyQ2FzZSgpXG4gIGlmIChpbnB1dC5oYXNPcGVuR2F0ZSAmJiBzdGF0dXMgIT09ICdjb21wbGV0ZWQnICYmIHN0YXR1cyAhPT0gJ2ZhaWxlZCcpIHJldHVybiAnQkxPQ0tFRCdcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdwZW5kaW5nJzpcbiAgICAgIHJldHVybiAnUEVORElORydcbiAgICBjYXNlICdyZWFkeSc6XG4gICAgICByZXR1cm4gaW5wdXQucmV0cnlDb3VudCA+IDAgPyAnUkVUUllJTkcnIDogJ1JFQURZJ1xuICAgIGNhc2UgJ2Rpc3BhdGNoZWQnOlxuICAgICAgaWYgKCFpbnB1dC5kaXNwYXRjaEFjdGl2ZSAmJiBpbnB1dC5yZXRyeUNvdW50ID4gMCkgcmV0dXJuICdSRVRSWUlORydcbiAgICAgIGlmIChpbnB1dC5raW5kID09PSAncmV2aWV3JykgcmV0dXJuICdSRVZJRVcnXG4gICAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3Rlc3QnKSByZXR1cm4gJ1RFU1RJTkcnXG4gICAgICByZXR1cm4gJ1JVTk5JTkcnXG4gICAgY2FzZSAnY29tcGxldGVkJzoge1xuICAgICAgY29uc3Qgb3V0Y29tZSA9IChpbnB1dC5yZXN1bHRPdXRjb21lID8/ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICBpZiAob3V0Y29tZSA9PT0gJ2NhbmNlbGxlZCcgfHwgb3V0Y29tZSA9PT0gJ2NhbmNlbGxhdGlvbicpIHJldHVybiAnQ0FOQ0VMTEVEJ1xuICAgICAgaWYgKG91dGNvbWUgPT09ICdmYWlsZWQnIHx8IG91dGNvbWUgPT09ICdmYWlsdXJlJykgcmV0dXJuICdGQUlMRUQnXG4gICAgICBpZiAoaW5wdXQua2luZCA9PT0gJ21lcmdlJykgcmV0dXJuICdNRVJHRUQnXG4gICAgICByZXR1cm4gJ0RPTkUnXG4gICAgfVxuICAgIGNhc2UgJ2ZhaWxlZCc6IHtcbiAgICAgIGNvbnN0IG91dGNvbWUgPSAoaW5wdXQucmVzdWx0T3V0Y29tZSA/PyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgcmV0dXJuIG91dGNvbWUuaW5jbHVkZXMoJ2NhbmNlbCcpID8gJ0NBTkNFTExFRCcgOiAnRkFJTEVEJ1xuICAgIH1cbiAgICBjYXNlICdibG9ja2VkJzpcbiAgICAgIHJldHVybiAnQkxPQ0tFRCdcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICdQRU5ESU5HJ1xuICB9XG59XG5cbmNvbnN0IEtJTkRfUEFUVEVSTlM6IFtUYXNrS2luZCwgUmVnRXhwXVtdID0gW1xuICBbJ21lcmdlJywgL1xcYihtZXJnZXxpbnRlZ3JhdChlfGlvbil8ZGVsaXZlcilcXGIvaV0sXG4gIC8vIFwidGVzdFwiIGFsb25lIGlzIHRvbyBjb21tb24gaW4gdGl0bGVzIChcIkFGIHRlc3Q6IFx1MjAyNlwiKTsgcmVxdWlyZSBhIHRlc3RpbmcgcGhyYXNlLlxuICBbJ3Rlc3QnLCAvXFxiKHRlc3RzfHRlc3Rpbmd8cWF8ZTJlfHZlcmlmeXx2ZXJpZmljYXRpb258dmFsaWRhdGlvbilcXGJ8XFxiKHJ1bnx3cml0ZXxhZGR8Zml4fHVuaXR8aW50ZWdyYXRpb258c21va2UpXFxzK3Rlc3RzP1xcYi9pXSxcbiAgWydyZXZpZXcnLCAvXFxiKHJldmlld3xhdWRpdHxpbnNwZWN0fGFwcHJvdmUpXFxiL2ldLFxuICBbJ3BsYW4nLCAvXFxiKHBsYW58cGxhbm5pbmd8ZGVzaWdufGFyY2hpdGVjdHVyZXxhbmFseVtzel1lKVxcYi9pXVxuXVxuXG4vKiogVGl0bGUtYmFzZWQgaW5mZXJlbmNlOyB0aGUgaW5zcGVjdG9yIG1hcmtzIHRoZSBraW5kIGFzIGluZmVycmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluZmVyVGFza0tpbmQodGl0bGU6IHN0cmluZyk6IFRhc2tLaW5kIHtcbiAgZm9yIChjb25zdCBba2luZCwgcGF0dGVybl0gb2YgS0lORF9QQVRURVJOUykgaWYgKHBhdHRlcm4udGVzdCh0aXRsZSkpIHJldHVybiBraW5kXG4gIHJldHVybiAndGFzaydcbn1cbiIsICIvLyBPcmNoZXN0cmF0aW9uIHJ1bnMsIHRhc2tzLCBkaXNwYXRjaGVkIHdvcmtlcnMsIG1lc3NhZ2VzIGFuZCBnYXRlcyBmcm9tIHRoZSBkb2N1bWVudGVkXG4vLyBgb3JjYSBvcmNoZXN0cmF0aW9uIFx1MjAyNiAtLWpzb25gIGNvbW1hbmRzLiBQb2xsZWQgYWRhcHRpdmVseTsgZXZlcnkgcmVjb3JkIGtlZXBzIGl0cyBzb3VyY2UuXG5pbXBvcnQgdHlwZSB7IEZsb3dFdmVudEtpbmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvZXZlbnRzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJ1bnRpbWVTdGF0ZSwgR2F0ZVJlY29yZCwgTWVzc2FnZVJlY29yZCwgUnVuUmVjb3JkLCBUYXNrUmVjb3JkLCBUYXNrU3RhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgeyByZWRhY3QsIHJlZGFjdE51bGxhYmxlLCB0cnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5pbXBvcnQgeyBpbmZlclRhc2tLaW5kLCBtYXBPcmNhVGFza1N0YXR1cywgVEVSTUlOQUxfVEFTS19TVEFURVMgfSBmcm9tICcuLi8uLi9zaGFyZWQvdGFzay1zdGF0ZXMudHMnXG5pbXBvcnQgeyBuZXdBZ2VudCwgcGFyc2VUaW1lLCBzdHIsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgeyBkZWR1cGVBZ2VudCwgbWVyZ2VEdXBsaWNhdGVzT2YgfSBmcm9tICcuLi9zdGF0ZS9tZXJnZS1hZ2VudHMudHMnXG5cbnR5cGUgUmF3VGFzayA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBpZDogc3RyaW5nIH1cbnR5cGUgUmF3V29ya2VyUm93ID0geyBkaXNwYXRjaElkOiBzdHJpbmc7IHRhc2tJZDogc3RyaW5nOyBzdGF0ZTogc3RyaW5nOyBsaXZlbmVzcz86IHN0cmluZzsgdGVybWluYWw/OiBzdHJpbmc7IHdvcmtzcGFjZT86IHN0cmluZzsgaG9zdD86IHN0cmluZyB9XG50eXBlIFJhd01lc3NhZ2UgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHsgaWQ6IHN0cmluZyB9XG5cbmNvbnN0IFNUT1BQRURfU1RBVEVTID0gbmV3IFNldChbJ3N0b3BwZWQnLCAnYWJhbmRvbmVkJywgJ2ZlbmNlZCcsICdjYW5jZWxsZWQnXSlcbmNvbnN0IE1BWF9SVU5TID0gMjVcbmNvbnN0IE1BWF9ERVRBSUxfUEVSX0NZQ0xFID0gMTBcbmNvbnN0IE1BWF9XT1JLRVJfUEFHRVMgPSAzXG4vKiogTGl2ZSBzdGF0ZSBjYXJyaWVzIHByZXZpZXdzIG9ubHk7IGZ1bGwgdGV4dCBpcyBmZXRjaGVkIG9uIGRlbWFuZCAocGFuZWwgYW5zd2VycyBhcmUgY2FwcGVkIGF0IDEgTWlCKS4gKi9cbmNvbnN0IFNQRUNfUFJFVklFVyA9IDYwMFxuLyoqIFJlc3VsdCB0ZXh0IGtlcHQgaW4gdGhlIHNoYXJlZCBzdGF0ZTsgdGhlIGluc3BlY3RvciBmZXRjaGVzIHRoZSByZXN0IG9uIGRlbWFuZC4gKi9cbmNvbnN0IFJFU1VMVF9QUkVWSUVXID0gNjAwXG5jb25zdCBTUEVDX0xJTUlUID0gNjAwMDBcbmNvbnN0IEJPRFlfUFJFVklFVyA9IDYwMFxuY29uc3QgRlVMTF9URVhUX0xJTUlUID0gMTAwMFxuXG5leHBvcnQgY2xhc3MgT3JjaGVzdHJhdGlvbkFkYXB0ZXIge1xuICBwcml2YXRlIGN5Y2xlID0gMFxuICBwcml2YXRlIHBvbGxpbmcgPSBmYWxzZVxuICAvKiogZGlzcGF0Y2hJZCBcdTIxOTIgbGFzdCB3b3JrZXItc2hvdyBmaW5nZXJwcmludDsgc2V0dGxlZCBvbmVzIGFyZSBub3QgcmUtZmV0Y2hlZC4gKi9cbiAgcHJpdmF0ZSBkZXRhaWxlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgcHJpdmF0ZSBkaXNwYXRjaFJvd3MgPSBuZXcgTWFwPHN0cmluZywgUmF3V29ya2VyUm93PigpXG4gIC8qKiBGdWxsIHRhc2sgc3BlY3MgYW5kIG1lc3NhZ2UgYm9kaWVzLCBrZXB0IG91dCBvZiB0aGUgc2hhcmVkIHN0YXRlLiAqL1xuICBwcml2YXRlIGZ1bGxUZXh0ID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICBwcml2YXRlIHJ1bkRldGFpbENoZWNrZWRBdCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KClcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICAvKiogRnVsbCBzcGVjIC8gYm9keSBmb3IgdGhlIGluc3BlY3RvcjsgbnVsbCB3aGVuIG5vdCBrbm93bi4gKi9cbiAgZnVsbFRleHRGb3Ioa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5mdWxsVGV4dC5nZXQoa2V5KSA/PyBudWxsXG4gIH1cblxuICBwcml2YXRlIGtlZXBGdWxsKGtleTogc3RyaW5nLCB0ZXh0OiBzdHJpbmcsIHByZXZpZXc6IG51bWJlcik6IHN0cmluZyB7XG4gICAgdGhpcy5mdWxsVGV4dC5zZXQoa2V5LCB0ZXh0KVxuICAgIGlmICh0aGlzLmZ1bGxUZXh0LnNpemUgPiBGVUxMX1RFWFRfTElNSVQpIHtcbiAgICAgIGNvbnN0IG9sZGVzdCA9IHRoaXMuZnVsbFRleHQua2V5cygpLm5leHQoKS52YWx1ZVxuICAgICAgaWYgKG9sZGVzdCAhPT0gdW5kZWZpbmVkKSB0aGlzLmZ1bGxUZXh0LmRlbGV0ZShvbGRlc3QpXG4gICAgfVxuICAgIHJldHVybiB0cnVuY2F0ZSh0ZXh0LCBwcmV2aWV3KVxuICB9XG5cbiAgZ2V0IGhhc0FjdGl2ZVdvcmsoKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKClcbiAgICAvLyBPbmx5IG9yY2hlc3RyYXRpb24gd29yayBzcGVlZHMgdXAgb3JjaGVzdHJhdGlvbiBwb2xsaW5nOyBsaXZlIGNoYXQgYWdlbnRzIGRvIG5vdCBuZWVkIGl0LlxuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHN0YXRlLnJ1bnMpLnNvbWUoKHJ1bikgPT4gcnVuLnN0YXRlID09PSAnYWN0aXZlJyAmJiBPYmplY3QudmFsdWVzKHN0YXRlLmFnZW50cykuc29tZSgoYSkgPT4gYS5ydW5JZCA9PT0gcnVuLmlkICYmIGEubGl2ZSkpXG4gIH1cblxuICBhc3luYyBwb2xsKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnBvbGxpbmcgfHwgIXRoaXMuY3R4LmNsaS5wYXRoKSByZXR1cm5cbiAgICB0aGlzLnBvbGxpbmcgPSB0cnVlXG4gICAgdGhpcy5jeWNsZSsrXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJ1bnMgPSBhd2FpdCB0aGlzLnBvbGxSdW5zKClcbiAgICAgIGlmICghcnVucykgcmV0dXJuXG4gICAgICBmb3IgKGNvbnN0IHJ1biBvZiBydW5zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGwgPSBydW4uc3RhdGUgPT09ICdhY3RpdmUnIHx8IHRoaXMuY3ljbGUgJSA2ID09PSAxXG4gICAgICAgIGlmIChmdWxsKSBhd2FpdCB0aGlzLnBvbGxUYXNrcyhydW4uaWQpXG4gICAgICAgIC8vIENoYXQtY29vcmRpbmF0ZWQgcnVucyBuZXZlciBnZXQgYSBoYW5kbGU6IGxvb2sgb25jZSwgdGhlbiByYXJlbHkuXG4gICAgICAgIGNvbnN0IGxhc3RDaGVjayA9IHRoaXMucnVuRGV0YWlsQ2hlY2tlZEF0LmdldChydW4uaWQpXG4gICAgICAgIGlmICghcnVuLmNvb3JkaW5hdG9ySGFuZGxlICYmIChsYXN0Q2hlY2sgPT09IHVuZGVmaW5lZCB8fCB0aGlzLmN5Y2xlIC0gbGFzdENoZWNrID49IDYwKSkge1xuICAgICAgICAgIHRoaXMucnVuRGV0YWlsQ2hlY2tlZEF0LnNldChydW4uaWQsIHRoaXMuY3ljbGUpXG4gICAgICAgICAgYXdhaXQgdGhpcy5wb2xsUnVuRGV0YWlsKHJ1bi5pZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5wb2xsV29ya2VycygpXG4gICAgICBhd2FpdCB0aGlzLnBvbGxNZXNzYWdlcygpXG4gICAgICB0aGlzLnJlZnJlc2hSdW5TdGF0ZXMoKVxuICAgICAgLy8gVXNlIHRoZSBzdGF0ZSBjb21wdXRlZCBmcm9tIHRoaXMgY3ljbGUncyB0YXNrcywgc28gZ2F0ZXMgc2hvdyB1cCBvbiB0aGUgZmlyc3QgcG9sbCB0b28uXG4gICAgICBjb25zdCBhY3RpdmUgPSBPYmplY3QudmFsdWVzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zKS5maWx0ZXIoKHJ1bikgPT4gcnVuLnN0YXRlID09PSAnYWN0aXZlJylcbiAgICAgIGZvciAoY29uc3QgcnVuIG9mIGFjdGl2ZSkgYXdhaXQgdGhpcy5wb2xsR2F0ZXMocnVuLmlkKVxuICAgICAgaWYgKGFjdGl2ZS5sZW5ndGgpIHRoaXMucmVmcmVzaFJ1blN0YXRlcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuY3R4LmxvZyhgb3JjaGVzdHJhdGlvbiBwb2xsIGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5wb2xsaW5nID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxSdW5zKCk6IFByb21pc2U8UnVuUmVjb3JkW10gfCBudWxsPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IHJ1bnM6IHsgaWQ6IHN0cmluZzsgb2JqZWN0aXZlPzogc3RyaW5nOyBsZWdhY3k/OiBib29sZWFuIH1bXSB9PihbJ29yY2hlc3RyYXRpb24nLCAncnVuLWxpc3QnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgdGhpcy5jdHgubG9nKGBydW4tbGlzdDogJHtyZXN1bHQuY29kZX0gJHtyZXN1bHQubWVzc2FnZX1gKVxuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgY29uc3Qgb3V0OiBSdW5SZWNvcmRbXSA9IFtdXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC5ydW5zLmZpbHRlcigocnVuKSA9PiAhcnVuLmxlZ2FjeSkuc2xpY2UoMCwgTUFYX1JVTlMpKSB7XG4gICAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zW3Jhdy5pZF1cbiAgICAgIGNvbnN0IHJlY29yZDogUnVuUmVjb3JkID0gcHJldmlvdXNcbiAgICAgICAgPyB7IC4uLnByZXZpb3VzLCBvYmplY3RpdmU6IHJhdy5vYmplY3RpdmUgPz8gcHJldmlvdXMub2JqZWN0aXZlIH1cbiAgICAgICAgOiB7IGlkOiByYXcuaWQsIG9iamVjdGl2ZTogcmF3Lm9iamVjdGl2ZSA/PyByYXcuaWQsIGxlZ2FjeTogZmFsc2UsIGNvb3JkaW5hdG9ySGFuZGxlOiBudWxsLCBzdGF0ZTogJ2lkbGUnLCBzdGFydGVkQXQ6IG51bGwsIGVuZGVkQXQ6IG51bGwsIHRhc2tDb3VudDogMCwgdmVyc2lvbjogMCB9XG4gICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdydW4nLCBpZDogcmF3LmlkLCB2YWx1ZTogcmVjb3JkIH0pXG4gICAgICB0aGlzLmVuc3VyZUxlYWQocmVjb3JkKVxuICAgICAgaWYgKCFwcmV2aW91cykgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcnVuOiR7cmF3LmlkfWAsIHRzOiB0aGlzLmN0eC5ub3coKSwga2luZDogJ29yY2hlc3RyYXRpb24uc3RhcnRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQ6IHJhdy5pZCwgc3VtbWFyeTogYFJ1bjogJHt0cnVuY2F0ZShyZWNvcmQub2JqZWN0aXZlLCAxMjApfWAgfSlcbiAgICAgIG91dC5wdXNoKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zW3Jhdy5pZF0pXG4gICAgfVxuICAgIHJldHVybiBvdXRcbiAgfVxuXG4gIC8qKiBydW4tc2hvdyAtLWZ1bGwgbmFtZXMgdGhlIGNvb3JkaW5hdG9yJ3MgdGVybWluYWwgaGFuZGxlIChudWxsIGZvciBjaGF0IGNvb3JkaW5hdG9ycykgYW5kIGNyZWF0aW9uIHRpbWUuICovXG4gIHByaXZhdGUgYXN5bmMgcG9sbFJ1bkRldGFpbChydW5JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IHJ1bj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0+KFsnb3JjaGVzdHJhdGlvbicsICdydW4tc2hvdycsICctLWlkJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vayB8fCAhcmVzdWx0LnJlc3VsdC5ydW4pIHJldHVyblxuICAgIGNvbnN0IHJhdyA9IHJlc3VsdC5yZXN1bHQucnVuXG4gICAgY29uc3QgcnVuID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnJ1bnNbcnVuSWRdXG4gICAgaWYgKCFydW4pIHJldHVyblxuICAgIGNvbnN0IGNvb3JkaW5hdG9ySGFuZGxlID0gc3RyKHJhdy5jb29yZGluYXRvcl9oYW5kbGUpID8/IHJ1bi5jb29yZGluYXRvckhhbmRsZVxuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IHJ1bi5zdGFydGVkQXQgPz8gcGFyc2VUaW1lKHJhdy5jcmVhdGVkX2F0KVxuICAgIGlmIChjb29yZGluYXRvckhhbmRsZSA9PT0gcnVuLmNvb3JkaW5hdG9ySGFuZGxlICYmIHN0YXJ0ZWRBdCA9PT0gcnVuLnN0YXJ0ZWRBdCkgcmV0dXJuXG4gICAgY29uc3QgbmV4dCA9IHsgLi4ucnVuLCBjb29yZGluYXRvckhhbmRsZSwgc3RhcnRlZEF0IH1cbiAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdydW4nLCBpZDogcnVuSWQsIHZhbHVlOiBuZXh0IH0pXG4gICAgdGhpcy5lbnN1cmVMZWFkKG5leHQpXG4gIH1cblxuICAvKiogVGhlIGNvb3JkaW5hdG9yIG9mIGEgcnVuLiBTdHJ1Y3R1cmFsIChldmVyeSBydW4gaGFzIG9uZSk7IGxpdmUgb25seSB3aXRoIHJ1bnRpbWUgZXZpZGVuY2UuICovXG4gIHByaXZhdGUgZW5zdXJlTGVhZChydW46IFJ1blJlY29yZCk6IHZvaWQge1xuICAgIGNvbnN0IGlkID0gYGxlYWQ6JHtydW4uaWR9YFxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIDAsXG4gICAgICB7IHJvbGU6ICdsZWFkJywgcnVuSWQ6IHJ1bi5pZCwgdGl0bGU6ICdMZWFkIG9yY2hlc3RyYXRvcicsIGRlc2NyaXB0aW9uOiB0cnVuY2F0ZShydW4ub2JqZWN0aXZlLCAyMDApLCB0ZXJtaW5hbEhhbmRsZTogcnVuLmNvb3JkaW5hdG9ySGFuZGxlID8/IHVuZGVmaW5lZCwgZXZpZGVuY2U6IFsnY2xpLXBvbGwnXSB9LFxuICAgICAgKCkgPT4gbmV3QWdlbnQoaWQsICdsZWFkJywgbm93KVxuICAgIClcbiAgICBpZiAocnVuLmNvb3JkaW5hdG9ySGFuZGxlKSB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCB7IHRlcm1pbmFsSGFuZGxlOiBydW4uY29vcmRpbmF0b3JIYW5kbGUgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcG9sbFRhc2tzKHJ1bklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPHsgdGFza3M6IFJhd1Rhc2tbXSB9PihbJ29yY2hlc3RyYXRpb24nLCAndGFzay1saXN0JywgJy0tcnVuJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgdGhpcy5jdHgubG9nKGB0YXNrLWxpc3QgJHtydW5JZH06ICR7cmVzdWx0LmNvZGV9ICR7cmVzdWx0Lm1lc3NhZ2V9YClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBsZXQgY29vcmRpbmF0b3I6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC50YXNrcykge1xuICAgICAgY29vcmRpbmF0b3IgPz89IHN0cihyYXcuY3JlYXRlZF9ieV90ZXJtaW5hbF9oYW5kbGUpXG4gICAgICB0aGlzLmFwcGx5VGFzayhydW5JZCwgcmF3KVxuICAgIH1cbiAgICBjb25zdCBydW4gPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkucnVuc1tydW5JZF1cbiAgICBpZiAocnVuKSB7XG4gICAgICBjb25zdCB0YXNrcyA9IHJlc3VsdC5yZXN1bHQudGFza3NcbiAgICAgIGNvbnN0IHRpbWVzID0gdGFza3MubWFwKCh0YXNrKSA9PiBwYXJzZVRpbWUodGFzay5jcmVhdGVkX2F0KSkuZmlsdGVyKCh0KTogdCBpcyBudW1iZXIgPT4gdCAhPT0gbnVsbClcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnB1dCh7XG4gICAgICAgIGVudGl0eTogJ3J1bicsXG4gICAgICAgIGlkOiBydW5JZCxcbiAgICAgICAgdmFsdWU6IHsgLi4ucnVuLCB0YXNrQ291bnQ6IHRhc2tzLmxlbmd0aCwgY29vcmRpbmF0b3JIYW5kbGU6IHJ1bi5jb29yZGluYXRvckhhbmRsZSA/PyBjb29yZGluYXRvciwgc3RhcnRlZEF0OiB0aW1lcy5sZW5ndGggPyBNYXRoLm1pbiguLi50aW1lcykgOiBydW4uc3RhcnRlZEF0IH1cbiAgICAgIH0pXG4gICAgICBpZiAoY29vcmRpbmF0b3IgJiYgIXJ1bi5jb29yZGluYXRvckhhbmRsZSkgdGhpcy5lbnN1cmVMZWFkKHsgLi4ucnVuLCBjb29yZGluYXRvckhhbmRsZTogY29vcmRpbmF0b3IgfSlcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5VGFzayhydW5JZDogc3RyaW5nLCByYXc6IFJhd1Rhc2spOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKVxuICAgIGNvbnN0IHByZXZpb3VzID0gc3RhdGUudGFza3NbcmF3LmlkXVxuICAgIGNvbnN0IHRpdGxlID0gc3RyKHJhdy50YXNrX3RpdGxlKSA/PyBzdHIocmF3LmRpc3BsYXlfbmFtZSkgPz8gcmF3LmlkXG4gICAgY29uc3Qga2luZCA9IGluZmVyVGFza0tpbmQoYCR7dGl0bGV9ICR7c3RyKHJhdy5kaXNwbGF5X25hbWUpID8/ICcnfWApXG4gICAgY29uc3QgcGFyc2VkUmVzdWx0ID0gcGFyc2VSZXN1bHQocmF3LnJlc3VsdClcbiAgICAvLyBLZWVwIHRoZSBzaGFyZWQgc3RhdGUgc21hbGwgKGl0IGlzIHNlbnQgdG8gZXZlcnkgdmlldyk6IGxvbmcgcmVzdWx0IHRleHQgc3RheXMgaGVyZS5cbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZWRSZXN1bHQ/Lm1lc3NhZ2UgPyB7IC4uLnBhcnNlZFJlc3VsdCwgbWVzc2FnZTogdGhpcy5rZWVwRnVsbChgcmVzdWx0OiR7cmF3LmlkfWAsIHBhcnNlZFJlc3VsdC5tZXNzYWdlLCBSRVNVTFRfUFJFVklFVykgfSA6IHBhcnNlZFJlc3VsdFxuICAgIGNvbnN0IGRpc3BhdGNoSWRzID0gcHJldmlvdXM/LmRpc3BhdGNoSWRzID8/IFtdXG4gICAgY29uc3QgbGF0ZXN0RGlzcGF0Y2ggPSBkaXNwYXRjaElkcy5sZW5ndGggPyB0aGlzLmRpc3BhdGNoUm93cy5nZXQoZGlzcGF0Y2hJZHNbZGlzcGF0Y2hJZHMubGVuZ3RoIC0gMV0pIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZ2F0ZUlkcyA9IE9iamVjdC52YWx1ZXMoc3RhdGUuZ2F0ZXMpLmZpbHRlcigoZ2F0ZSkgPT4gZ2F0ZS50YXNrSWQgPT09IHJhdy5pZCkubWFwKChnYXRlKSA9PiBnYXRlLmlkKVxuICAgIGNvbnN0IGhhc09wZW5HYXRlID0gZ2F0ZUlkcy5zb21lKChpZCkgPT4gc3RhdGUuZ2F0ZXNbaWRdPy5zdGF0dXMgPT09ICdwZW5kaW5nJylcbiAgICBjb25zdCB0YXNrU3RhdGUgPSBtYXBPcmNhVGFza1N0YXR1cyh7XG4gICAgICBvcmNhU3RhdHVzOiBzdHIocmF3LnN0YXR1cykgPz8gJ3BlbmRpbmcnLFxuICAgICAga2luZCxcbiAgICAgIHJlc3VsdE91dGNvbWU6IHJlc3VsdD8ub3V0Y29tZSA/PyBudWxsLFxuICAgICAgaGFzT3BlbkdhdGUsXG4gICAgICByZXRyeUNvdW50OiBNYXRoLm1heCgwLCBkaXNwYXRjaElkcy5sZW5ndGggLSAxKSxcbiAgICAgIGRpc3BhdGNoQWN0aXZlOiBsYXRlc3REaXNwYXRjaCA/IGlzTGl2ZVdvcmtlcihsYXRlc3REaXNwYXRjaCkgOiBmYWxzZVxuICAgIH0pXG4gICAgY29uc3QgcmVjb3JkOiBUYXNrUmVjb3JkID0ge1xuICAgICAgaWQ6IHJhdy5pZCxcbiAgICAgIHJ1bklkLFxuICAgICAgcGFyZW50SWQ6IHN0cihyYXcucGFyZW50X2lkKSxcbiAgICAgIHRpdGxlOiByZWRhY3QodGl0bGUpLFxuICAgICAgZGlzcGxheU5hbWU6IHJlZGFjdE51bGxhYmxlKHN0cihyYXcuZGlzcGxheV9uYW1lKSksXG4gICAgICBzcGVjOiByYXcuc3BlYyA/IHRoaXMua2VlcEZ1bGwoYHRhc2s6JHtyYXcuaWR9YCwgcmVkYWN0KHRydW5jYXRlKFN0cmluZyhyYXcuc3BlYyksIFNQRUNfTElNSVQpKSwgU1BFQ19QUkVWSUVXKSA6IG51bGwsXG4gICAgICBraW5kLFxuICAgICAgb3JjYVN0YXR1czogc3RyKHJhdy5zdGF0dXMpID8/ICdwZW5kaW5nJyxcbiAgICAgIHN0YXRlOiB0YXNrU3RhdGUsXG4gICAgICBkZXBzOiBwYXJzZURlcHMocmF3LmRlcHMpLFxuICAgICAgYXNzaWduZWVBZ2VudElkOiBwcmV2aW91cz8uYXNzaWduZWVBZ2VudElkID8/IG51bGwsXG4gICAgICBkaXNwYXRjaElkcyxcbiAgICAgIHJlc3VsdCxcbiAgICAgIGNyZWF0ZWRBdDogcGFyc2VUaW1lKHJhdy5jcmVhdGVkX2F0KSxcbiAgICAgIGNvbXBsZXRlZEF0OiBwYXJzZVRpbWUocmF3LmNvbXBsZXRlZF9hdCksXG4gICAgICByZXRyeUNvdW50OiBNYXRoLm1heCgwLCBkaXNwYXRjaElkcy5sZW5ndGggLSAxKSxcbiAgICAgIGdhdGVJZHMsXG4gICAgICB2ZXJzaW9uOiBwcmV2aW91cz8udmVyc2lvbiA/PyAwXG4gICAgfVxuICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydFRhc2socmVjb3JkKVxuICAgIGlmICghcHJldmlvdXMpIHtcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyBpZDogYHRhc2suY3JlYXRlZDoke3Jhdy5pZH1gLCB0czogcmVjb3JkLmNyZWF0ZWRBdCA/PyB0aGlzLmN0eC5ub3coKSwga2luZDogJ3Rhc2suY3JlYXRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQsIHN1bW1hcnk6IGBUYXNrIGNyZWF0ZWQ6ICR7dHJ1bmNhdGUocmVjb3JkLnRpdGxlLCAxMDApfWAgfSlcbiAgICB9IGVsc2UgaWYgKHByZXZpb3VzLnN0YXRlICE9PSByZWNvcmQuc3RhdGUpIHtcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyB0czogdGhpcy5jdHgubm93KCksIGtpbmQ6IHRhc2tFdmVudEtpbmQocmVjb3JkLnN0YXRlLCByZWNvcmQua2luZCksIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQsIHRhcmdldElkOiByZWNvcmQuYXNzaWduZWVBZ2VudElkLCBzdW1tYXJ5OiBgJHt0cnVuY2F0ZShyZWNvcmQudGl0bGUsIDgwKX06ICR7cHJldmlvdXMuc3RhdGV9IFx1MjE5MiAke3JlY29yZC5zdGF0ZX1gIH0pXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwb2xsV29ya2VycygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb3dzOiBSYXdXb3JrZXJSb3dbXSA9IFtdXG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGxldCBwYWdlID0gMDsgcGFnZSA8IE1BWF9XT1JLRVJfUEFHRVM7IHBhZ2UrKykge1xuICAgICAgY29uc3QgYXJncyA9IFsnb3JjaGVzdHJhdGlvbicsICd3b3JrZXItbGlzdCddXG4gICAgICBpZiAoY3Vyc29yKSBhcmdzLnB1c2goJy0tY3Vyc29yJywgY3Vyc29yKVxuICAgICAgY29uc3QgcmVzdWx0OiBBd2FpdGVkPFJldHVyblR5cGU8dHlwZW9mIHRoaXMuY3R4LmNsaS5ydW48eyB3b3JrZXJzOiBSYXdXb3JrZXJSb3dbXTsgbmV4dEN1cnNvcj86IHN0cmluZyB8IG51bGwgfT4+PiA9IGF3YWl0IHRoaXMuY3R4LmNsaS5ydW4oYXJncylcbiAgICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAgIHRoaXMuY3R4LmxvZyhgd29ya2VyLWxpc3Q6ICR7cmVzdWx0LmNvZGV9ICR7cmVzdWx0Lm1lc3NhZ2V9YClcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICAgIHJvd3MucHVzaCguLi5yZXN1bHQucmVzdWx0LndvcmtlcnMpXG4gICAgICBjdXJzb3IgPSByZXN1bHQucmVzdWx0Lm5leHRDdXJzb3IgPz8gbnVsbFxuICAgICAgaWYgKCFjdXJzb3IpIGJyZWFrXG4gICAgfVxuICAgIGNvbnN0IHRhc2tzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzXG4gICAgbGV0IGRldGFpbEJ1ZGdldCA9IE1BWF9ERVRBSUxfUEVSX0NZQ0xFXG4gICAgY29uc3Qga25vd24gPSByb3dzLmZpbHRlcigocm93KSA9PiB0YXNrc1tyb3cudGFza0lkXSlcbiAgICAvLyBBcHBseSBpbiBPcmNhJ3Mgb3JkZXIsIHNvIGEgdGFzaydzIGRpc3BhdGNoIGhpc3RvcnkgKHJldHJpZXMpIHN0YXlzIGNocm9ub2xvZ2ljYWwuXG4gICAgZm9yIChjb25zdCByb3cgb2Yga25vd24pIHtcbiAgICAgIHRoaXMuZGlzcGF0Y2hSb3dzLnNldChyb3cuZGlzcGF0Y2hJZCwgcm93KVxuICAgICAgdGhpcy5hcHBseVdvcmtlclJvdyhyb3cpXG4gICAgfVxuICAgIC8vIERldGFpbHMgKGFnZW50LCBtb2RlbCwgZWZmb3J0LCBwYW5lKSBmb3IgbGl2ZSBhbmQgZmFpbGVkIHdvcmtlcnMgZmlyc3QsIHRoZW4gdGhlIHJlc3QuXG4gICAgY29uc3QgcHJpb3JpdHkgPSAocm93OiBSYXdXb3JrZXJSb3cpID0+IChpc0xpdmVXb3JrZXIocm93KSA/IDAgOiBtYXBXb3JrZXJTdGF0ZShyb3cpID09PSAnZmFpbGVkJyA/IDEgOiAyKVxuICAgIGZvciAoY29uc3Qgcm93IG9mIFsuLi5rbm93bl0uc29ydCgoYSwgYikgPT4gcHJpb3JpdHkoYSkgLSBwcmlvcml0eShiKSkpIHtcbiAgICAgIGlmIChkZXRhaWxCdWRnZXQgPD0gMCkgYnJlYWtcbiAgICAgIGNvbnN0IGZpbmdlcnByaW50ID0gYCR7cm93LnN0YXRlfXwke3Jvdy5saXZlbmVzcyA/PyAnJ318JHtyb3cudGVybWluYWwgPz8gJyd9YFxuICAgICAgaWYgKHRoaXMuZGV0YWlsZWQuZ2V0KHJvdy5kaXNwYXRjaElkKSA9PT0gZmluZ2VycHJpbnQgJiYgIWlzTGl2ZVdvcmtlcihyb3cpKSBjb250aW51ZVxuICAgICAgZGV0YWlsQnVkZ2V0LS1cbiAgICAgIGF3YWl0IHRoaXMucG9sbFdvcmtlckRldGFpbChyb3cuZGlzcGF0Y2hJZClcbiAgICAgIHRoaXMuZGV0YWlsZWQuc2V0KHJvdy5kaXNwYXRjaElkLCBmaW5nZXJwcmludClcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5V29ya2VyUm93KHJvdzogUmF3V29ya2VyUm93KTogdm9pZCB7XG4gICAgY29uc3QgaWQgPSBgZGlzcGF0Y2g6JHtyb3cuZGlzcGF0Y2hJZH1gXG4gICAgY29uc3Qgbm93ID0gdGhpcy5jdHgubm93KClcbiAgICBjb25zdCB0YXNrID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzW3Jvdy50YXNrSWRdXG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2lkXVxuICAgIGNvbnN0IFtwcm9qZWN0SWQsIHdvcmt0cmVlUGF0aF0gPSBzcGxpdFdvcmtzcGFjZShyb3cud29ya3NwYWNlKVxuICAgIGNvbnN0IHBvbGxlZCA9IG1hcFdvcmtlclN0YXRlKHJvdylcbiAgICAvLyBIb3N0IHN0YXR1cyBldmVudHMgYXJlIHRoZSBwcmVjaXNlIGxpdmUgc2lnbmFsOyBhIGR1cmFibGUgcG9sbCBvbmx5IG92ZXJyaWRlcyB0aGVtIHRvIHNldHRsZS5cbiAgICBjb25zdCBob3N0RHJpdmVuID0gcHJldmlvdXM/LmV2aWRlbmNlLmluY2x1ZGVzKCdob3N0LWV2ZW50JykgJiYgcG9sbGVkICE9PSAnZG9uZScgJiYgcG9sbGVkICE9PSAnZmFpbGVkJ1xuICAgIGNvbnN0IHN0YXRlID0gaG9zdERyaXZlbiA/IHByZXZpb3VzLnN0YXRlIDogcG9sbGVkXG4gICAgY29uc3QgcmVjb3JkID0gdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIG5vdyxcbiAgICAgIHtcbiAgICAgICAgcm9sZTogJ3dvcmtlcicsXG4gICAgICAgIGRpc3BhdGNoSWQ6IHJvdy5kaXNwYXRjaElkLFxuICAgICAgICB0YXNrSWQ6IHJvdy50YXNrSWQsXG4gICAgICAgIHJ1bklkOiB0YXNrPy5ydW5JZCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHBhcmVudElkOiBwcmV2aW91cz8ucGFyZW50SWQgPz8gKHRhc2sgPyBgbGVhZDoke3Rhc2sucnVuSWR9YCA6IG51bGwpLFxuICAgICAgICB0ZXJtaW5hbEhhbmRsZTogcm93LnRlcm1pbmFsID8/IHVuZGVmaW5lZCxcbiAgICAgICAgd29ya3NwYWNlSWQ6IHJvdy53b3Jrc3BhY2UgPz8gdW5kZWZpbmVkLFxuICAgICAgICB3b3JrdHJlZVBhdGg6IHdvcmt0cmVlUGF0aCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHByb2plY3RJZDogcHJvamVjdElkID8/IHVuZGVmaW5lZCxcbiAgICAgICAgYnJhbmNoOiBPYmplY3QudmFsdWVzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXMpLmZpbmQoKHcpID0+IHcucGF0aCA9PT0gd29ya3RyZWVQYXRoKT8uYnJhbmNoID8/IHVuZGVmaW5lZCxcbiAgICAgICAgdGl0bGU6IHByZXZpb3VzPy50aXRsZSA/PyB0YXNrPy5kaXNwbGF5TmFtZSA/PyB0YXNrPy50aXRsZSA/PyAnV29ya2VyJyxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGxpdmU6IGhvc3REcml2ZW4gPyBwcmV2aW91cy5saXZlIDogaXNMaXZlV29ya2VyKHJvdyksXG4gICAgICAgIC8vIEEgc3RvcHBlZC9hYmFuZG9uZWQgd29ya2VyIGVuZGVkIGJ5IHJlcXVlc3QsIG5vdCBieSBmaW5pc2hpbmcgaXRzIHRhc2suXG4gICAgICAgIG91dGNvbWU6IFNUT1BQRURfU1RBVEVTLmhhcyhyb3cuc3RhdGUudG9Mb3dlckNhc2UoKSkgPyAnY2FuY2VsbGF0aW9uJyA6IHVuZGVmaW5lZCxcbiAgICAgICAgZXZpZGVuY2U6IFsnY2xpLXBvbGwnXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnd29ya2VyJywgbm93KVxuICAgIClcbiAgICB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCB7IHRlcm1pbmFsSGFuZGxlOiByb3cudGVybWluYWwgPz8gbnVsbCB9KVxuICAgIGlmICh0YXNrICYmICF0YXNrLmRpc3BhdGNoSWRzLmluY2x1ZGVzKHJvdy5kaXNwYXRjaElkKSkge1xuICAgICAgY29uc3QgZGlzcGF0Y2hJZHMgPSBbLi4udGFzay5kaXNwYXRjaElkcywgcm93LmRpc3BhdGNoSWRdXG4gICAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRUYXNrKHsgLi4udGFzaywgZGlzcGF0Y2hJZHMsIGFzc2lnbmVlQWdlbnRJZDogaWQsIHJldHJ5Q291bnQ6IE1hdGgubWF4KDAsIGRpc3BhdGNoSWRzLmxlbmd0aCAtIDEpIH0pXG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgaWQ6IGB0YXNrLmFzc2lnbmVkOiR7cm93LmRpc3BhdGNoSWR9YCwgdHM6IG5vdywga2luZDogZGlzcGF0Y2hJZHMubGVuZ3RoID4gMSA/ICd0YXNrLnJldHJpZWQnIDogJ3Rhc2suYXNzaWduZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiByb3cudGFza0lkLCB0YXJnZXRJZDogaWQsIHJ1bklkOiB0YXNrLnJ1bklkLCBzdW1tYXJ5OiBgJHt0cnVuY2F0ZSh0YXNrLnRpdGxlLCA4MCl9IFx1MjE5MiAke3JlY29yZC50aXRsZX1gIH0pXG4gICAgfVxuICAgIGlmIChwcmV2aW91cyAmJiBwcmV2aW91cy5zdGF0ZSAhPT0gcmVjb3JkLnN0YXRlKSB7XG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgdHM6IG5vdywga2luZDogc3RhdGUgPT09ICdmYWlsZWQnID8gJ2FnZW50LmZhaWxlZCcgOiBzdGF0ZSA9PT0gJ2RvbmUnID8gJ2FnZW50LmNvbXBsZXRlZCcgOiAnYWdlbnQuc3RhdHVzX2NoYW5nZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiBpZCwgcnVuSWQ6IHJlY29yZC5ydW5JZCwgc3VtbWFyeTogYCR7cmVjb3JkLnRpdGxlfTogJHtwcmV2aW91cy5zdGF0ZX0gXHUyMTkyICR7c3RhdGV9YCB9KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcG9sbFdvcmtlckRldGFpbChkaXNwYXRjaElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPFJlY29yZDxzdHJpbmcsIHVua25vd24+PihbJ29yY2hlc3RyYXRpb24nLCAnd29ya2VyLXNob3cnLCAnLS1kaXNwYXRjaCcsIGRpc3BhdGNoSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuXG4gICAgY29uc3QgZGV0YWlsID0gcmVzdWx0LnJlc3VsdFxuICAgIGNvbnN0IGRpc3BhdGNoID0gYXNSZWNvcmQoZGV0YWlsLmRpc3BhdGNoKVxuICAgIGNvbnN0IHdvcmtlciA9IGFzUmVjb3JkKGRldGFpbC53b3JrZXIpXG4gICAgY29uc3Qgc3RhcnQgPSBhc1JlY29yZCh3b3JrZXIuc3RhcnRPcHRpb25zKVxuICAgIGNvbnN0IGxhdW5jaCA9IGFzUmVjb3JkKGFzUmVjb3JkKHN0YXJ0LmxhdW5jaCkuZWZmZWN0aXZlKVxuICAgIGNvbnN0IHJlcXVlc3RlZCA9IGFzUmVjb3JkKGFzUmVjb3JkKHN0YXJ0LmxhdW5jaCkucmVxdWVzdGVkKVxuICAgIGNvbnN0IGlkID0gYGRpc3BhdGNoOiR7ZGlzcGF0Y2hJZH1gXG4gICAgY29uc3QgY3JlYXRvciA9IHN0cihkaXNwYXRjaC5jcmVhdG9yRGlzcGF0Y2hJZClcbiAgICBjb25zdCB0YXNrID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzW3N0cihkaXNwYXRjaC50YXNrSWQpID8/ICcnXVxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgaWQsXG4gICAgICB0aGlzLmN0eC5ub3coKSxcbiAgICAgIHtcbiAgICAgICAgYWdlbnQ6IHN0cihsYXVuY2guYWdlbnQpID8/IHN0cihzdGFydC5hZ2VudCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBtb2RlbDogc3RyKGxhdW5jaC5tb2RlbCkgPz8gc3RyKHJlcXVlc3RlZC5tb2RlbCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBlZmZvcnQ6IHN0cihsYXVuY2guZWZmb3J0KSA/PyBzdHIocmVxdWVzdGVkLmVmZm9ydCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBwYW5lS2V5OiBzdHIoZGlzcGF0Y2guYXNzaWduZWVQYW5lS2V5KSA/PyB1bmRlZmluZWQsXG4gICAgICAgIHRlcm1pbmFsSGFuZGxlOiBzdHIoZGlzcGF0Y2guYXNzaWduZWVIYW5kbGUpID8/IHVuZGVmaW5lZCxcbiAgICAgICAgcGFyZW50SWQ6IGNyZWF0b3IgPyBgZGlzcGF0Y2g6JHtjcmVhdG9yfWAgOiB0YXNrID8gYGxlYWQ6JHt0YXNrLnJ1bklkfWAgOiB1bmRlZmluZWQsXG4gICAgICAgIHJldHJ5T2ZEaXNwYXRjaElkOiBzdHIoZGlzcGF0Y2gucmV0cnlPZkRpc3BhdGNoSWQpLFxuICAgICAgICBmYWlsdXJlQ291bnQ6IHR5cGVvZiBkaXNwYXRjaC5mYWlsdXJlQ291bnQgPT09ICdudW1iZXInID8gZGlzcGF0Y2guZmFpbHVyZUNvdW50IDogMCxcbiAgICAgICAgc3RhcnRlZEF0OiBwYXJzZVRpbWUoZGlzcGF0Y2guZGlzcGF0Y2hlZEF0KSA/PyB1bmRlZmluZWQsXG4gICAgICAgIGVuZGVkQXQ6IHBhcnNlVGltZShkaXNwYXRjaC5jb21wbGV0ZWRBdCksXG4gICAgICAgIG91dGNvbWU6IHN0cihhc1JlY29yZChkZXRhaWwucHJvamVjdGlvbikub3V0Y29tZSkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBldmlkZW5jZTogWydjbGktcG9sbCddXG4gICAgICB9LFxuICAgICAgKCkgPT4gbmV3QWdlbnQoaWQsICd3b3JrZXInLCB0aGlzLmN0eC5ub3coKSlcbiAgICApXG4gICAgdGhpcy5jdHguaWRlbnRpdHkubGluayhpZCwgeyBwYW5lS2V5OiByZWNvcmQucGFuZUtleSwgdGVybWluYWxIYW5kbGU6IHJlY29yZC50ZXJtaW5hbEhhbmRsZSB9KVxuICAgIC8vIFN0YXR1cyBldmVudHMgbWF5IGhhdmUgY3JlYXRlZCBhIHJlY29yZCBmb3IgdGhpcyBzZXNzaW9uIGJlZm9yZSBPcmNhIG5hbWVkIHRoZSBkaXNwYXRjaC5cbiAgICBtZXJnZUR1cGxpY2F0ZXNPZih0aGlzLmN0eC5zdG9yZSwgdGhpcy5jdHguaWRlbnRpdHksIGlkKVxuICAgIGRlZHVwZUFnZW50KHRoaXMuY3R4LnN0b3JlLCB0aGlzLmN0eC5pZGVudGl0eSwgaWQpXG4gICAgdGhpcy5vcmRlckRpc3BhdGNoZXMocmVjb3JkLnRhc2tJZClcbiAgICBpZiAoc3RyKGRpc3BhdGNoLnJldHJ5T2ZEaXNwYXRjaElkKSkge1xuICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcmV0cnk6JHtkaXNwYXRjaElkfWAsIHRzOiByZWNvcmQuc3RhcnRlZEF0ID8/IHRoaXMuY3R4Lm5vdygpLCBraW5kOiAndGFzay5yZXRyaWVkJywgc291cmNlOiAnY2xpLXBvbGwnLCBlbnRpdHlJZDogcmVjb3JkLnRhc2tJZCA/PyBpZCwgdGFyZ2V0SWQ6IGlkLCBydW5JZDogcmVjb3JkLnJ1bklkLCBzdW1tYXJ5OiBgUmV0cnkgb2YgJHtzdHIoZGlzcGF0Y2gucmV0cnlPZkRpc3BhdGNoSWQpfSBzdGFydGVkYCB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKiBLZWVwcyBhIHRhc2sncyBhdHRlbXB0cyBpbiBzdGFydCBvcmRlciBvbmNlIHN0YXJ0IHRpbWVzIGFyZSBrbm93bjsgdGhlIGxhc3QgaXMgdGhlIGxhdGVzdC4gKi9cbiAgcHJpdmF0ZSBvcmRlckRpc3BhdGNoZXModGFza0lkOiBzdHJpbmcgfCBudWxsKTogdm9pZCB7XG4gICAgY29uc3QgdGFzayA9IHRhc2tJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS50YXNrc1t0YXNrSWRdIDogdW5kZWZpbmVkXG4gICAgaWYgKCF0YXNrIHx8IHRhc2suZGlzcGF0Y2hJZHMubGVuZ3RoIDwgMikgcmV0dXJuXG4gICAgY29uc3QgYWdlbnRzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1xuICAgIGNvbnN0IGluZm8gPSAoaWQ6IHN0cmluZykgPT4gYWdlbnRzW2BkaXNwYXRjaDoke2lkfWBdXG4gICAgLy8gUmVvcmRlciBvbmx5IHdpdGggZnVsbCBpbmZvcm1hdGlvbjsgb3RoZXJ3aXNlIGtlZXAgT3JjYSdzIG9yZGVyLlxuICAgIGlmICh0YXNrLmRpc3BhdGNoSWRzLnNvbWUoKGlkKSA9PiBpbmZvKGlkKT8uc3RhcnRlZEF0ID09IG51bGwpKSByZXR1cm5cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGFzay5kaXNwYXRjaElkc10uc29ydCgoYSwgYikgPT4ge1xuICAgICAgaWYgKGluZm8oYik/LnJldHJ5T2ZEaXNwYXRjaElkID09PSBhKSByZXR1cm4gLTFcbiAgICAgIGlmIChpbmZvKGEpPy5yZXRyeU9mRGlzcGF0Y2hJZCA9PT0gYikgcmV0dXJuIDFcbiAgICAgIHJldHVybiAoaW5mbyhhKSEuc3RhcnRlZEF0IGFzIG51bWJlcikgLSAoaW5mbyhiKSEuc3RhcnRlZEF0IGFzIG51bWJlcilcbiAgICB9KVxuICAgIGlmIChzb3J0ZWQuam9pbigpID09PSB0YXNrLmRpc3BhdGNoSWRzLmpvaW4oKSkgcmV0dXJuXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0VGFzayh7IC4uLnRhc2ssIGRpc3BhdGNoSWRzOiBzb3J0ZWQsIGFzc2lnbmVlQWdlbnRJZDogYGRpc3BhdGNoOiR7c29ydGVkW3NvcnRlZC5sZW5ndGggLSAxXX1gIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxNZXNzYWdlcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPHsgbWVzc2FnZXM6IFJhd01lc3NhZ2VbXSB9PihbJ29yY2hlc3RyYXRpb24nLCAnaW5ib3gnLCAnLS1saW1pdCcsICcxNTAnLCAnLS1mdWxsJ10pXG4gICAgaWYgKCFyZXN1bHQub2spIHJldHVyblxuICAgIGNvbnN0IGtub3duID0gbmV3IFNldCh0aGlzLmN0eC5zdG9yZS5yZWFkKCkubWVzc2FnZXMubWFwKChtZXNzYWdlKSA9PiBtZXNzYWdlLmlkKSlcbiAgICBmb3IgKGNvbnN0IHJhdyBvZiBbLi4ucmVzdWx0LnJlc3VsdC5tZXNzYWdlc10ucmV2ZXJzZSgpKSB7XG4gICAgICBpZiAoa25vd24uaGFzKHJhdy5pZCkpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwYXlsb2FkID0gcGFyc2VKc29uKHJhdy5wYXlsb2FkKVxuICAgICAgY29uc3QgZnJvbUhhbmRsZSA9IHN0cihyYXcuZnJvbV9oYW5kbGUpXG4gICAgICBjb25zdCB0b0hhbmRsZSA9IHN0cihyYXcudG9faGFuZGxlKVxuICAgICAgY29uc3QgZnJvbUFnZW50SWQgPSB0aGlzLmN0eC5pZGVudGl0eS5yZXNvbHZlKHsgdGVybWluYWxIYW5kbGU6IGZyb21IYW5kbGUsIHBhbmVLZXk6IHN0cihyYXcuc2VuZGVyX3BhbmVfa2V5KSB9KSA/PyBsZWFkRm9yKGZyb21IYW5kbGUpXG4gICAgICBjb25zdCB0b0FnZW50SWQgPSB0aGlzLmN0eC5pZGVudGl0eS5yZXNvbHZlKHsgdGVybWluYWxIYW5kbGU6IHRvSGFuZGxlIH0pID8/IGxlYWRGb3IodG9IYW5kbGUpXG4gICAgICBjb25zdCBtZXNzYWdlOiBNZXNzYWdlUmVjb3JkID0ge1xuICAgICAgICBpZDogcmF3LmlkLFxuICAgICAgICBydW5JZDogc3RyKHJhdy5ydW5faWQpLFxuICAgICAgICBmcm9tSGFuZGxlLFxuICAgICAgICB0b0hhbmRsZSxcbiAgICAgICAgZnJvbUFnZW50SWQsXG4gICAgICAgIHRvQWdlbnRJZCxcbiAgICAgICAgdHlwZTogc3RyKHJhdy50eXBlKSA/PyAnbWVzc2FnZScsXG4gICAgICAgIHN1YmplY3Q6IHJlZGFjdE51bGxhYmxlKHN0cihyYXcuc3ViamVjdCkpLFxuICAgICAgICBib2R5OiByYXcuYm9keSA/IHRoaXMua2VlcEZ1bGwoYG1lc3NhZ2U6JHtyYXcuaWR9YCwgcmVkYWN0KHRydW5jYXRlKFN0cmluZyhyYXcuYm9keSksIFNQRUNfTElNSVQpKSwgQk9EWV9QUkVWSUVXKSA6IG51bGwsXG4gICAgICAgIHRhc2tJZDogc3RyKHBheWxvYWQudGFza0lkKSxcbiAgICAgICAgY3JlYXRlZEF0OiBwYXJzZVRpbWUocmF3LmNyZWF0ZWRfYXQpID8/IHRoaXMuY3R4Lm5vdygpXG4gICAgICB9XG4gICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdtZXNzYWdlJywgaWQ6IHJhdy5pZCwgdmFsdWU6IG1lc3NhZ2UgfSlcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoe1xuICAgICAgICBpZDogYG1lc3NhZ2U6JHtyYXcuaWR9YCxcbiAgICAgICAgdHM6IG1lc3NhZ2UuY3JlYXRlZEF0LFxuICAgICAgICBraW5kOiAnbWVzc2FnZS5zZW50JyxcbiAgICAgICAgc291cmNlOiAnY2xpLXBvbGwnLFxuICAgICAgICBlbnRpdHlJZDogZnJvbUFnZW50SWQgPz8gZnJvbUhhbmRsZSA/PyAndW5rbm93bicsXG4gICAgICAgIHRhcmdldElkOiB0b0FnZW50SWQsXG4gICAgICAgIHJ1bklkOiBtZXNzYWdlLnJ1bklkLFxuICAgICAgICBzdW1tYXJ5OiBgJHttZXNzYWdlLnR5cGV9OiAke3RydW5jYXRlKG1lc3NhZ2Uuc3ViamVjdCA/PyBtZXNzYWdlLmJvZHkgPz8gJycsIDEyMCl9YFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxHYXRlcyhydW5JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IGdhdGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSB9PihbJ29yY2hlc3RyYXRpb24nLCAnZ2F0ZS1saXN0JywgJy0tcnVuJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC5nYXRlcyA/PyBbXSkge1xuICAgICAgY29uc3QgaWQgPSBzdHIocmF3LmlkKVxuICAgICAgaWYgKCFpZCkgY29udGludWVcbiAgICAgIGNvbnN0IGdhdGU6IEdhdGVSZWNvcmQgPSB7XG4gICAgICAgIGlkLFxuICAgICAgICB0YXNrSWQ6IHN0cihyYXcudGFza19pZCkgPz8gc3RyKHJhdy50YXNrSWQpLFxuICAgICAgICBxdWVzdGlvbjogcmVkYWN0TnVsbGFibGUoc3RyKHJhdy5xdWVzdGlvbikgPz8gc3RyKHJhdy5wcm9tcHQpKSxcbiAgICAgICAgc3RhdHVzOiBzdHIocmF3LnN0YXR1cykgPz8gJ3BlbmRpbmcnLFxuICAgICAgICByZXNvbHV0aW9uOiByZWRhY3ROdWxsYWJsZShzdHIocmF3LnJlc29sdXRpb24pKSxcbiAgICAgICAgY3JlYXRlZEF0OiBwYXJzZVRpbWUocmF3LmNyZWF0ZWRfYXQgPz8gcmF3LmNyZWF0ZWRBdClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmdhdGVzW2lkXVxuICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnZ2F0ZScsIGlkLCB2YWx1ZTogZ2F0ZSB9KVxuICAgICAgaWYgKCFwcmV2aW91cyAmJiBnYXRlLnN0YXR1cyA9PT0gJ3BlbmRpbmcnICYmIGdhdGUudGFza0lkKSB7XG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyBpZDogYGdhdGU6JHtpZH1gLCB0czogZ2F0ZS5jcmVhdGVkQXQgPz8gdGhpcy5jdHgubm93KCksIGtpbmQ6ICd0YXNrLmJsb2NrZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiBnYXRlLnRhc2tJZCwgcnVuSWQsIHN1bW1hcnk6IGBEZWNpc2lvbiBnYXRlOiAke3RydW5jYXRlKGdhdGUucXVlc3Rpb24gPz8gaWQsIDEwMCl9YCB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVmcmVzaFJ1blN0YXRlcygpOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKVxuICAgIGZvciAoY29uc3QgcnVuIG9mIE9iamVjdC52YWx1ZXMoc3RhdGUucnVucykpIHtcbiAgICAgIGNvbnN0IHRhc2tzID0gT2JqZWN0LnZhbHVlcyhzdGF0ZS50YXNrcykuZmlsdGVyKCh0YXNrKSA9PiB0YXNrLnJ1bklkID09PSBydW4uaWQpXG4gICAgICBpZiAoIXRhc2tzLmxlbmd0aCkgY29udGludWVcbiAgICAgIGNvbnN0IGFsbERvbmUgPSB0YXNrcy5ldmVyeSgodGFzaykgPT4gVEVSTUlOQUxfVEFTS19TVEFURVMuaW5jbHVkZXModGFzay5zdGF0ZSkpXG4gICAgICBjb25zdCBhbnlGYWlsZWQgPSB0YXNrcy5zb21lKCh0YXNrKSA9PiB0YXNrLnN0YXRlID09PSAnRkFJTEVEJylcbiAgICAgIGNvbnN0IG5leHQ6IFJ1blJlY29yZFsnc3RhdGUnXSA9IGFsbERvbmUgPyAoYW55RmFpbGVkID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJykgOiAnYWN0aXZlJ1xuICAgICAgY29uc3QgZW5kZWRBdCA9IGFsbERvbmUgPyBNYXRoLm1heCguLi50YXNrcy5tYXAoKHRhc2spID0+IHRhc2suY29tcGxldGVkQXQgPz8gMCkpIHx8IG51bGwgOiBudWxsXG4gICAgICBpZiAobmV4dCAhPT0gcnVuLnN0YXRlIHx8IGVuZGVkQXQgIT09IHJ1bi5lbmRlZEF0KSB7XG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLnB1dCh7IGVudGl0eTogJ3J1bicsIGlkOiBydW4uaWQsIHZhbHVlOiB7IC4uLnJ1biwgc3RhdGU6IG5leHQsIGVuZGVkQXQgfSB9KVxuICAgICAgICBpZiAoYWxsRG9uZSAmJiBydW4uc3RhdGUgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcnVuLmRvbmU6JHtydW4uaWR9YCwgdHM6IGVuZGVkQXQgPz8gdGhpcy5jdHgubm93KCksIGtpbmQ6ICdvcmNoZXN0cmF0aW9uLmNvbXBsZXRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJ1bi5pZCwgcnVuSWQ6IHJ1bi5pZCwgc3VtbWFyeTogYFJ1biAke25leHR9OiAke3RydW5jYXRlKHJ1bi5vYmplY3RpdmUsIDEwMCl9YCB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXBXb3JrZXJTdGF0ZShyb3c6IHsgc3RhdGU6IHN0cmluZzsgbGl2ZW5lc3M/OiBzdHJpbmcgfSk6IEFnZW50UnVudGltZVN0YXRlIHtcbiAgY29uc3Qgc3RhdGUgPSByb3cuc3RhdGUudG9Mb3dlckNhc2UoKVxuICBpZiAoc3RhdGUgPT09ICdzdWNjZWVkZWQnIHx8IHN0YXRlID09PSAnY29tcGxldGVkJyB8fCBzdGF0ZSA9PT0gJ3NldHRsZWQnKSByZXR1cm4gJ2RvbmUnXG4gIGlmIChzdGF0ZSA9PT0gJ2ZhaWxlZCcgfHwgc3RhdGUgPT09ICdvdXRjb21lX3Vua25vd24nKSByZXR1cm4gJ2ZhaWxlZCdcbiAgaWYgKHN0YXRlID09PSAnc3RvcHBlZCcgfHwgc3RhdGUgPT09ICdhYmFuZG9uZWQnIHx8IHN0YXRlID09PSAnZmVuY2VkJyB8fCBzdGF0ZSA9PT0gJ2NhbmNlbGxlZCcpIHJldHVybiAnZG9uZSdcbiAgaWYgKHN0YXRlID09PSAnYmxvY2tlZCcgfHwgc3RhdGUgPT09ICdwZXJtaXNzaW9uJykgcmV0dXJuICdibG9ja2VkJ1xuICBpZiAoc3RhdGUgPT09ICdyZWFkeScpIHJldHVybiBpc0xpdmVXb3JrZXIocm93KSA/ICd3YWl0aW5nJyA6ICdpZGxlJ1xuICBpZiAoc3RhdGUgPT09ICdzdGFydGluZycgfHwgc3RhdGUgPT09ICdydW5uaW5nJyB8fCBzdGF0ZSA9PT0gJ3dvcmtpbmcnIHx8IHN0YXRlID09PSAnZGlzcGF0Y2hlZCcpIHJldHVybiAnd29ya2luZydcbiAgcmV0dXJuICd1bmtub3duJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNMaXZlV29ya2VyKHJvdzogeyBzdGF0ZTogc3RyaW5nOyBsaXZlbmVzcz86IHN0cmluZyB9KTogYm9vbGVhbiB7XG4gIGNvbnN0IGxpdmVuZXNzID0gKHJvdy5saXZlbmVzcyA/PyAnJykudG9Mb3dlckNhc2UoKVxuICBpZiAobGl2ZW5lc3MgPT09ICdleGl0ZWQnIHx8IGxpdmVuZXNzID09PSAnc3RvcHBlZCcpIHJldHVybiBmYWxzZVxuICBpZiAobGl2ZW5lc3MgPT09ICdhbGl2ZScgfHwgbGl2ZW5lc3MgPT09ICdydW5uaW5nJyB8fCBsaXZlbmVzcyA9PT0gJ2xpdmUnKSByZXR1cm4gdHJ1ZVxuICBjb25zdCBzdGF0ZSA9IHJvdy5zdGF0ZS50b0xvd2VyQ2FzZSgpXG4gIHJldHVybiBsaXZlbmVzcyAhPT0gJ3VudmVyaWZpYWJsZScgJiYgKHN0YXRlID09PSAnc3RhcnRpbmcnIHx8IHN0YXRlID09PSAncnVubmluZycgfHwgc3RhdGUgPT09ICd3b3JraW5nJylcbn1cblxuZnVuY3Rpb24gdGFza0V2ZW50S2luZChzdGF0ZTogVGFza1N0YXRlLCBraW5kOiBzdHJpbmcpOiBGbG93RXZlbnRLaW5kIHtcbiAgc3dpdGNoIChzdGF0ZSkge1xuICAgIGNhc2UgJ1JVTk5JTkcnOlxuICAgICAgcmV0dXJuICd0YXNrLnN0YXJ0ZWQnXG4gICAgY2FzZSAnUkVWSUVXJzpcbiAgICAgIHJldHVybiAncmV2aWV3LnN0YXJ0ZWQnXG4gICAgY2FzZSAnVEVTVElORyc6XG4gICAgICByZXR1cm4gJ3Rlc3Quc3RhcnRlZCdcbiAgICBjYXNlICdET05FJzpcbiAgICBjYXNlICdNRVJHRUQnOlxuICAgIGNhc2UgJ0FQUFJPVkVEJzpcbiAgICAgIHJldHVybiBraW5kID09PSAncmV2aWV3JyA/ICdyZXZpZXcuY29tcGxldGVkJyA6IGtpbmQgPT09ICd0ZXN0JyA/ICd0ZXN0LmNvbXBsZXRlZCcgOiAndGFzay5jb21wbGV0ZWQnXG4gICAgY2FzZSAnRkFJTEVEJzpcbiAgICAgIHJldHVybiAndGFzay5mYWlsZWQnXG4gICAgY2FzZSAnQkxPQ0tFRCc6XG4gICAgICByZXR1cm4gJ3Rhc2suYmxvY2tlZCdcbiAgICBjYXNlICdSRVRSWUlORyc6XG4gICAgICByZXR1cm4gJ3Rhc2sucmV0cmllZCdcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICd0YXNrLnVwZGF0ZWQnXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VSZXN1bHQodmFsdWU6IHVua25vd24pOiBUYXNrUmVjb3JkWydyZXN1bHQnXSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsIHx8IHZhbHVlID09PSAnJykgcmV0dXJuIG51bGxcbiAgY29uc3QgcGFyc2VkID0gcGFyc2VKc29uKHZhbHVlKVxuICBpZiAoIU9iamVjdC5rZXlzKHBhcnNlZCkubGVuZ3RoKSB7XG4gICAgLy8gT3JjYSdzIGRvY3VtZW50ZWQgY2FuY2VsIGlzIGAtLXN0YXR1cyBmYWlsZWQgLS1yZXN1bHQgY2FuY2VsbGVkYDogYSBwbGFpbi10ZXh0IHJlc3VsdC5cbiAgICBjb25zdCB0ZXh0ID0gU3RyaW5nKHZhbHVlKS50cmltKClcbiAgICBjb25zdCBvdXRjb21lID0gL14oY2FuY2VsKGwpP2VkfGNhbmNlbGxhdGlvbikkL2kudGVzdCh0ZXh0KSA/ICdjYW5jZWxsZWQnIDogbnVsbFxuICAgIHJldHVybiB7IG91dGNvbWUsIG1lc3NhZ2U6IHJlZGFjdCh0cnVuY2F0ZSh0ZXh0LCA0MDAwKSksIGZpbGVzTW9kaWZpZWQ6IFtdLCByYXc6IG51bGwgfVxuICB9XG4gIGNvbnN0IGZpbGVzID0gQXJyYXkuaXNBcnJheShwYXJzZWQuZmlsZXNNb2RpZmllZCkgPyBwYXJzZWQuZmlsZXNNb2RpZmllZC5maWx0ZXIoKGYpOiBmIGlzIHN0cmluZyA9PiB0eXBlb2YgZiA9PT0gJ3N0cmluZycpLnNsaWNlKDAsIDIwMCkgOiBbXVxuICByZXR1cm4ge1xuICAgIG91dGNvbWU6IHN0cihwYXJzZWQub3V0Y29tZSksXG4gICAgbWVzc2FnZTogcGFyc2VkLm1lc3NhZ2UgPyByZWRhY3QodHJ1bmNhdGUoU3RyaW5nKHBhcnNlZC5tZXNzYWdlKSwgNDAwMCkpIDogbnVsbCxcbiAgICBmaWxlc01vZGlmaWVkOiBmaWxlcyxcbiAgICAvLyBUaGUgcmF3IEpTT04gaXMgbmV2ZXIgc2hvd247IGxlYXZpbmcgaXQgb3V0IGtlZXBzIHNuYXBzaG90cyBhbmQgZGVsdGFzIHNtYWxsLlxuICAgIHJhdzogbnVsbFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRGVwcyh2YWx1ZTogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuZmlsdGVyKCh2KTogdiBpcyBzdHJpbmcgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHZhbHVlKVxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFyc2VkKSA/IHBhcnNlZC5maWx0ZXIoKHYpOiB2IGlzIHN0cmluZyA9PiB0eXBlb2YgdiA9PT0gJ3N0cmluZycpIDogW11cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zcGxpdCgnLCcpLm1hcCgocykgPT4gcy50cmltKCkpLmZpbHRlcihCb29sZWFuKVxuICAgIH1cbiAgfVxuICByZXR1cm4gW11cbn1cblxuZnVuY3Rpb24gcGFyc2VKc29uKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIHt9XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZSh2YWx1ZSlcbiAgICByZXR1cm4gcGFyc2VkICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQgOiB7fVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4ge31cbiAgfVxufVxuXG5mdW5jdGlvbiBhc1JlY29yZCh2YWx1ZTogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA6IHt9XG59XG5cbmZ1bmN0aW9uIHNwbGl0V29ya3NwYWNlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBbc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbF0ge1xuICBpZiAoIXZhbHVlKSByZXR1cm4gW251bGwsIG51bGxdXG4gIGNvbnN0IGluZGV4ID0gdmFsdWUuaW5kZXhPZignOjonKVxuICByZXR1cm4gaW5kZXggPj0gMCA/IFt2YWx1ZS5zbGljZSgwLCBpbmRleCksIHZhbHVlLnNsaWNlKGluZGV4ICsgMildIDogW251bGwsIHZhbHVlXVxufVxuXG5mdW5jdGlvbiBsZWFkRm9yKGhhbmRsZTogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICByZXR1cm4gaGFuZGxlPy5zdGFydHNXaXRoKCdydW46JykgPyBgbGVhZDoke2hhbmRsZS5zbGljZSg0KX1gIDogbnVsbFxufVxuIiwgIi8vIFRva2VuIGFuZCBtZXNzYWdlIGNvdW50cyBmcm9tIE9yY2EncyBBZ2VudCBTZXNzaW9uIEhpc3RvcnkgKGhpc3Rvcnk6cmVhZCkuXG5pbXBvcnQgdHlwZSB7IFdvcmtlckNvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0LnRzJ1xuXG5leHBvcnQgY2xhc3MgU2Vzc2lvbnNBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjdHg6IFdvcmtlckNvbnRleHQpIHt9XG5cbiAgYXN5bmMgcmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGhvc3QgfSA9IHRoaXMuY3R4Lm9yY2FcbiAgICBpZiAoIWhvc3QuaGFzKCdhZ2VudC5saXN0U2Vzc2lvbnMnKSkgcmV0dXJuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgc2Vzc2lvbnMgfSA9IGF3YWl0IGhvc3QuY2FsbCgnYWdlbnQubGlzdFNlc3Npb25zJywgeyBsaW1pdDogMjAwIH0pXG4gICAgICBjb25zdCBieVNlc3Npb24gPSBuZXcgTWFwKHNlc3Npb25zLm1hcCgoc2Vzc2lvbikgPT4gW3Nlc3Npb24uc2Vzc2lvbklkLCBzZXNzaW9uXSkpXG4gICAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXModGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50cykpIHtcbiAgICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IHNlc3Npb24gPSBieVNlc3Npb24uZ2V0KGFnZW50LnNlc3Npb25JZClcbiAgICAgICAgaWYgKCFzZXNzaW9uKSBjb250aW51ZVxuICAgICAgICBpZiAoYWdlbnQudG9rZW5zID09PSBzZXNzaW9uLnRvdGFsVG9rZW5zICYmIGFnZW50Lm1lc3NhZ2VDb3VudCA9PT0gc2Vzc2lvbi5tZXNzYWdlQ291bnQpIGNvbnRpbnVlXG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgICAgIGFnZW50LmlkLFxuICAgICAgICAgIGFnZW50Lmxhc3RTZWVuQXQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgdG9rZW5zOiBzZXNzaW9uLnRvdGFsVG9rZW5zLFxuICAgICAgICAgICAgbWVzc2FnZUNvdW50OiBzZXNzaW9uLm1lc3NhZ2VDb3VudCxcbiAgICAgICAgICAgIGFnZW50OiBhZ2VudC5hZ2VudCA/PyBzZXNzaW9uLmFnZW50LFxuICAgICAgICAgICAgdGl0bGU6IGFnZW50LnRpdGxlID8/IHNlc3Npb24udGl0bGUsXG4gICAgICAgICAgICBicmFuY2g6IGFnZW50LmJyYW5jaCA/PyBzZXNzaW9uLmJyYW5jaCA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICBldmlkZW5jZTogWydob3N0LWNhbGwnXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgKCkgPT4gYWdlbnRcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGFnZW50Lmxpc3RTZXNzaW9ucyBmYWlsZWQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgfVxuICB9XG59XG4iLCAiLy8gQ2xhdWRlIHN1YmFnZW50cyBmcm9tIHRoZSBhZ2VudC50b29sLmJlZm9yZS9hZnRlciBob29rcy4gQ2xhdWRlIENvZGUgc3Bhd25zIHN1YmFnZW50cyB3aXRoIGl0c1xuLy8gYEFnZW50YCB0b29sIChvbGRlciB2ZXJzaW9uczogYFRhc2tgKTsgdGhlIGhvb2sgY2FycmllcyB0aGUgY2FsbCBpZCBhbmQgdGhlIHN1YmFnZW50J3MgYnJpZWYuXG4vLyBPdGhlciBhZ2VudHMgZG8gbm90IHJlcG9ydCBzdWJhZ2VudCBpZGVudGl0eSwgc28gbm90aGluZyBpcyBkcmF3biBmb3IgdGhlbS5cbmltcG9ydCB7IHJlZGFjdCwgdHJ1bmNhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuaW1wb3J0IHsgbmV3QWdlbnQsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5cbmV4cG9ydCBjb25zdCBTVUJBR0VOVF9UT09MUyA9IG5ldyBTZXQoWydBZ2VudCcsICdUYXNrJ10pXG5cbnR5cGUgVG9vbEV2ZW50ID0ge1xuICBhZ2VudDogc3RyaW5nXG4gIHdvcmtzcGFjZUlkOiBzdHJpbmcgfCBudWxsXG4gIHRlcm1pbmFsSWQ/OiBzdHJpbmdcbiAgdG9vbDogc3RyaW5nXG4gIGlucHV0OiB1bmtub3duXG4gIGNhbGxJZD86IHN0cmluZ1xuICBvdXRwdXQ/OiB1bmtub3duXG59XG5cbmV4cG9ydCBjbGFzcyBTdWJhZ2VudEFkYXB0ZXIge1xuICBwcml2YXRlIGZhbGxiYWNrQ291bnRlciA9IDBcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICAvKiogTXVzdCByZXR1cm4gZmFzdDogQ2xhdWRlIENvZGUgd2FpdHMgZm9yIHRoaXMgaG9vay4gTmV2ZXIgZGVuaWVzLiAqL1xuICBvblRvb2xCZWZvcmUoZXZlbnQ6IFRvb2xFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3QgcGFyZW50SWQgPSB0aGlzLnJlc29sdmVQYXJlbnQoZXZlbnQpXG4gICAgY29uc3QgY2FsbEtleSA9IGV2ZW50LmNhbGxJZCA/PyBgJHtldmVudC50ZXJtaW5hbElkID8/ICduYSd9LSR7bm93fS0keysrdGhpcy5mYWxsYmFja0NvdW50ZXJ9YFxuICAgIHRoaXMucmVjb3JkVG9vbENhbGwoY2FsbEtleSwgZXZlbnQsIHBhcmVudElkLCAnc3RhcnRlZCcsIG5vdylcbiAgICBpZiAoIVNVQkFHRU5UX1RPT0xTLmhhcyhldmVudC50b29sKSkgcmV0dXJuXG4gICAgY29uc3QgaW5wdXQgPSBhc1JlY29yZChldmVudC5pbnB1dClcbiAgICBjb25zdCBpZCA9IGBzdWI6JHtjYWxsS2V5fWBcbiAgICBjb25zdCBwYXJlbnQgPSBwYXJlbnRJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbcGFyZW50SWRdIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBzdHIoaW5wdXQuZGVzY3JpcHRpb24pID8/IHN0cihpbnB1dC5wcm9tcHQpPy5zbGljZSgwLCAxMjApID8/IG51bGxcbiAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRBZ2VudChcbiAgICAgIGlkLFxuICAgICAgbm93LFxuICAgICAge1xuICAgICAgICByb2xlOiAnc3ViYWdlbnQnLFxuICAgICAgICBhZ2VudDogZXZlbnQuYWdlbnQsXG4gICAgICAgIHBhcmVudElkLFxuICAgICAgICBjYWxsSWQ6IGV2ZW50LmNhbGxJZCA/PyBudWxsLFxuICAgICAgICBzdWJhZ2VudFR5cGU6IHN0cihpbnB1dC5zdWJhZ2VudF90eXBlKSA/PyAnZ2VuZXJhbC1wdXJwb3NlJyxcbiAgICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uID8gcmVkYWN0KGRlc2NyaXB0aW9uKSA6IG51bGwsXG4gICAgICAgIHRpdGxlOiBzdHIoaW5wdXQuZGVzY3JpcHRpb24pID8/IHN0cihpbnB1dC5zdWJhZ2VudF90eXBlKSA/PyAnU3ViYWdlbnQnLFxuICAgICAgICBtb2RlbDogc3RyKGlucHV0Lm1vZGVsKSxcbiAgICAgICAgd29ya3NwYWNlSWQ6IGV2ZW50LndvcmtzcGFjZUlkID8/IHBhcmVudD8ud29ya3NwYWNlSWQgPz8gbnVsbCxcbiAgICAgICAgd29ya3RyZWVQYXRoOiBwYXJlbnQ/Lndvcmt0cmVlUGF0aCA/PyBudWxsLFxuICAgICAgICBicmFuY2g6IHBhcmVudD8uYnJhbmNoID8/IG51bGwsXG4gICAgICAgIHJ1bklkOiBwYXJlbnQ/LnJ1bklkID8/IG51bGwsXG4gICAgICAgIHRhc2tJZDogcGFyZW50Py50YXNrSWQgPz8gbnVsbCxcbiAgICAgICAgYWNjb3VudDogcGFyZW50Py5hY2NvdW50ID8/IG51bGwsXG4gICAgICAgIHN0YXRlOiAnd29ya2luZycsXG4gICAgICAgIGxpdmU6IHRydWUsXG4gICAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgICBzdGF0ZVNpbmNlOiBub3csXG4gICAgICAgIGV2aWRlbmNlOiBbJ2hvb2snXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnc3ViYWdlbnQnLCBub3cpXG4gICAgKVxuICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoe1xuICAgICAgdHM6IG5vdyxcbiAgICAgIGtpbmQ6ICdzdWJhZ2VudC5zcGF3bmVkJyxcbiAgICAgIHNvdXJjZTogJ2hvb2snLFxuICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgdGFyZ2V0SWQ6IHBhcmVudElkLFxuICAgICAgcnVuSWQ6IHBhcmVudD8ucnVuSWQgPz8gbnVsbCxcbiAgICAgIHN1bW1hcnk6IGAke3BhcmVudD8udGl0bGUgPz8gZXZlbnQuYWdlbnR9IHNwYXduZWQgc3ViYWdlbnQ6ICR7dHJ1bmNhdGUoZGVzY3JpcHRpb24gPz8gJ3N1YmFnZW50JywgMTAwKX1gXG4gICAgfSlcbiAgfVxuXG4gIG9uVG9vbEFmdGVyKGV2ZW50OiBUb29sRXZlbnQpOiB2b2lkIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmN0eC5ub3coKVxuICAgIGNvbnN0IHBhcmVudElkID0gdGhpcy5yZXNvbHZlUGFyZW50KGV2ZW50KVxuICAgIGlmIChldmVudC5jYWxsSWQpIHRoaXMucmVjb3JkVG9vbENhbGwoZXZlbnQuY2FsbElkLCBldmVudCwgcGFyZW50SWQsICdmaW5pc2hlZCcsIG5vdylcbiAgICBpZiAoIVNVQkFHRU5UX1RPT0xTLmhhcyhldmVudC50b29sKSB8fCAhZXZlbnQuY2FsbElkKSByZXR1cm5cbiAgICBjb25zdCBpZCA9IGBzdWI6JHtldmVudC5jYWxsSWR9YFxuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1tpZF1cbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm5cbiAgICBjb25zdCBmYWlsZWQgPSBsb29rc0ZhaWxlZChldmVudC5vdXRwdXQpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoaWQsIG5vdywgeyBzdGF0ZTogZmFpbGVkID8gJ2ZhaWxlZCcgOiAnZG9uZScsIG91dGNvbWU6IGZhaWxlZCA/ICdmYWlsdXJlJyA6ICdzdWNjZXNzJywgbGl2ZTogZmFsc2UsIGVuZGVkQXQ6IG5vdywgc3RhdGVTaW5jZTogbm93LCBldmlkZW5jZTogWydob29rJ10gfSwgKCkgPT4gZXhpc3RpbmcpXG4gICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7XG4gICAgICB0czogbm93LFxuICAgICAga2luZDogJ3N1YmFnZW50LmNvbXBsZXRlZCcsXG4gICAgICBzb3VyY2U6ICdob29rJyxcbiAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgIHRhcmdldElkOiBleGlzdGluZy5wYXJlbnRJZCxcbiAgICAgIHJ1bklkOiBleGlzdGluZy5ydW5JZCxcbiAgICAgIHN1bW1hcnk6IGBTdWJhZ2VudCAke2V4aXN0aW5nLnRpdGxlID8/ICcnfSAke2ZhaWxlZCA/ICdmYWlsZWQnIDogJ2ZpbmlzaGVkJ31gLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVQYXJlbnQoZXZlbnQ6IFRvb2xFdmVudCk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGRpcmVjdCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoeyB0ZXJtaW5hbElkOiBldmVudC50ZXJtaW5hbElkID8/IG51bGwgfSlcbiAgICBpZiAoZGlyZWN0KSByZXR1cm4gZGlyZWN0XG4gICAgaWYgKCFldmVudC53b3Jrc3BhY2VJZCkgcmV0dXJuIG51bGxcbiAgICAvLyBPbmx5IGF0dHJpYnV0ZSBieSB3b3Jrc3BhY2Ugd2hlbiBleGFjdGx5IG9uZSBsaXZlIGFnZW50IG9mIHRoYXQga2luZCBpcyB0aGVyZS5cbiAgICBjb25zdCBjYW5kaWRhdGVzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzKS5maWx0ZXIoXG4gICAgICAoYWdlbnQpID0+IGFnZW50LnJvbGUgIT09ICdzdWJhZ2VudCcgJiYgYWdlbnQubGl2ZSAmJiBhZ2VudC53b3Jrc3BhY2VJZCA9PT0gZXZlbnQud29ya3NwYWNlSWQgJiYgKGFnZW50LmFnZW50ID8/IGV2ZW50LmFnZW50KSA9PT0gZXZlbnQuYWdlbnRcbiAgICApXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMubGVuZ3RoID09PSAxID8gY2FuZGlkYXRlc1swXS5pZCA6IG51bGxcbiAgfVxuXG4gIHByaXZhdGUgcmVjb3JkVG9vbENhbGwoY2FsbEtleTogc3RyaW5nLCBldmVudDogVG9vbEV2ZW50LCBhZ2VudElkOiBzdHJpbmcgfCBudWxsLCBwaGFzZTogJ3N0YXJ0ZWQnIHwgJ2ZpbmlzaGVkJywgbm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmN0eC5zdG9yZS5wdXQoe1xuICAgICAgZW50aXR5OiAndG9vbENhbGwnLFxuICAgICAgaWQ6IGNhbGxLZXksXG4gICAgICB2YWx1ZTogeyBpZDogY2FsbEtleSwgYWdlbnRJZCwgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCA/PyBudWxsLCB0b29sOiBldmVudC50b29sLCBzdW1tYXJ5OiBzdW1tYXJpemVJbnB1dChldmVudC50b29sLCBldmVudC5pbnB1dCksIGF0OiBub3csIHBoYXNlIH1cbiAgICB9KVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdW1tYXJpemVJbnB1dCh0b29sOiBzdHJpbmcsIGlucHV0OiB1bmtub3duKTogc3RyaW5nIHtcbiAgY29uc3QgcmVjb3JkID0gYXNSZWNvcmQoaW5wdXQpXG4gIGNvbnN0IHBpY2sgPSBzdHIocmVjb3JkLmRlc2NyaXB0aW9uKSA/PyBzdHIocmVjb3JkLmNvbW1hbmQpID8/IHN0cihyZWNvcmQuZmlsZV9wYXRoKSA/PyBzdHIocmVjb3JkLnBhdHRlcm4pID8/IHN0cihyZWNvcmQudXJsKSA/PyBzdHIocmVjb3JkLnByb21wdClcbiAgcmV0dXJuIHJlZGFjdCh0cnVuY2F0ZShwaWNrID8/IHRvb2wsIDE2MCkpXG59XG5cbmZ1bmN0aW9uIGxvb2tzRmFpbGVkKG91dHB1dDogdW5rbm93bik6IGJvb2xlYW4ge1xuICBjb25zdCByZWNvcmQgPSBhc1JlY29yZChvdXRwdXQpXG4gIGlmIChyZWNvcmQuaXNfZXJyb3IgPT09IHRydWUgfHwgcmVjb3JkLmlzRXJyb3IgPT09IHRydWUpIHJldHVybiB0cnVlXG4gIGNvbnN0IHN0YXR1cyA9IHN0cihyZWNvcmQuc3RhdHVzKVxuICByZXR1cm4gc3RhdHVzID09PSAnZXJyb3InIHx8IHN0YXR1cyA9PT0gJ2ZhaWxlZCdcbn1cblxuZnVuY3Rpb24gYXNSZWNvcmQodmFsdWU6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgOiB7fVxufVxuXG5mdW5jdGlvbiBzdHIodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbFxufVxuIiwgIi8vIENsYXVkZSBzdWJhZ2VudHMgZm9yIGV2ZXJ5IENsYXVkZSBzZXNzaW9uICh0ZXJtaW5hbCBvciBjaGF0KSwgZnJvbSB0aGUgZmlsZXMgQ2xhdWRlIENvZGUgaXRzZWxmXG4vLyB3cml0ZXM6IDxwcm9qZWN0cz4vPHByb2plY3Q+LzxzZXNzaW9uPi9zdWJhZ2VudHMvYWdlbnQtPGlkPi5tZXRhLmpzb24gKCsgLmpzb25sIHRyYW5zY3JpcHQpLlxuLy8gVGhlIG1ldGEgZmlsZSBuYW1lcyB0aGUgc3Bhd25pbmcgdG9vbCBjYWxsIChgdG9vbFVzZUlkYCksIHRoZSBzYW1lIGlkIE9yY2EncyB0b29sIGhvb2sgcmVwb3J0cyxcbi8vIHNvIGEgc3ViYWdlbnQgc2VlbiBieSBib3RoIHNvdXJjZXMgaXMgb25lIG5vZGUuIFJlYWQtb25seTsgbm90aGluZyBpcyB3cml0dGVuLlxuaW1wb3J0IHsgb3BlbiwgcmVhZGRpciwgcmVhZEZpbGUsIHJlYWxwYXRoLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgeyByZWRhY3RBbmRUcnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5pbXBvcnQgeyBuZXdBZ2VudCwgdHlwZSBXb3JrZXJDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dC50cydcblxudHlwZSBNZXRhID0geyBhZ2VudFR5cGU/OiBzdHJpbmc7IGRlc2NyaXB0aW9uPzogc3RyaW5nOyB0b29sVXNlSWQ/OiBzdHJpbmc7IG1vZGVsPzogc3RyaW5nOyBmaW5pc2hlZD86IGJvb2xlYW47IHNwYXduRGVwdGg/OiBudW1iZXIgfVxuXG4vKiogQSBzdWJhZ2VudCBzdGlsbCB3cml0aW5nIHdpdGhpbiB0aGlzIHdpbmRvdyBjb3VudHMgYXMgd29ya2luZyAod2l0aCBhIGxpdmUgcGFyZW50KS4gKi9cbmNvbnN0IEFDVElWRV9XUklURV9NUyA9IDkwXzAwMFxuY29uc3QgUkVDRU5UX1NFU1NJT05fTVMgPSA2ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IERJUl9SRVRSWV9NUyA9IDYwXzAwMFxuY29uc3QgTUFYX1NFU1NJT05TX1BFUl9TQ0FOID0gNDBcbmNvbnN0IE1BWF9NRVRBX0NBQ0hFID0gMjAwMFxuXG5leHBvcnQgY2xhc3MgU3ViYWdlbnRGaWxlc0FkYXB0ZXIge1xuICBwcml2YXRlIHNlc3Npb25EaXJzID0gbmV3IE1hcDxzdHJpbmcsIHsgZGlyOiBzdHJpbmcgfCBudWxsOyBjaGVja2VkQXQ6IG51bWJlciB9PigpXG4gIHByaXZhdGUgc2Vlbk10aW1lID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKVxuICBwcml2YXRlIG1ldGFDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB7IG10aW1lOiBudW1iZXI7IG1ldGE6IE1ldGEgfT4oKVxuICAvKiogc3ViYWdlbnQgbm9kZSBpZCBcdTIxOTIgaXRzIHRyYW5zY3JpcHQgZmlsZSwgZm9yIHRoZSBPdXRwdXQgdGFiLiAqL1xuICBwcml2YXRlIHRyYW5zY3JpcHRzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICBwcml2YXRlIHNlc3Npb25GaWxlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNsYXVkZUhvbWVzOiAoKSA9PiBzdHJpbmdbXVxuICApIHt9XG5cbiAgdHJhbnNjcmlwdEZvcihhZ2VudElkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2NyaXB0cy5nZXQoYWdlbnRJZCkgPz8gbnVsbFxuICB9XG5cbiAgLyoqIFRoZSB0cmFuc2NyaXB0IG9mIGEgc3ViYWdlbnQsIG9yIG9mIGEgQ2xhdWRlIHNlc3Npb24gKGNoYXQgb3IgdGVybWluYWwpIGJ5IGl0cyBzZXNzaW9uIGlkLiAqL1xuICBhc3luYyB0cmFuc2NyaXB0UGF0aEZvcihhZ2VudDogQWdlbnRSZWNvcmQpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBpZiAoYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgcmV0dXJuIHRoaXMudHJhbnNjcmlwdEZvcihhZ2VudC5pZClcbiAgICBpZiAoIWFnZW50LnNlc3Npb25JZCB8fCAoYWdlbnQuYWdlbnQgIT09ICdjbGF1ZGUnICYmIGFnZW50LmFnZW50ICE9PSBudWxsKSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLnNlc3Npb25GaWxlcy5nZXQoYWdlbnQuc2Vzc2lvbklkKVxuICAgIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZFxuICAgIGxldCBmb3VuZDogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IHJvb3Qgb2YgYXdhaXQgdGhpcy5wcm9qZWN0Um9vdHMoKSkge1xuICAgICAgbGV0IHByb2plY3RzOiBzdHJpbmdbXSA9IFtdXG4gICAgICB0cnkge1xuICAgICAgICBwcm9qZWN0cyA9IGF3YWl0IHJlYWRkaXIocm9vdClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwcm9qZWN0IG9mIHByb2plY3RzKSB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSBqb2luKHJvb3QsIHByb2plY3QsIGAke2FnZW50LnNlc3Npb25JZH0uanNvbmxgKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmICgoYXdhaXQgc3RhdChmaWxlKSkuaXNGaWxlKCkpIHtcbiAgICAgICAgICAgIGZvdW5kID0gZmlsZVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG5vdCBoZXJlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChmb3VuZCkgYnJlYWtcbiAgICB9XG4gICAgaWYgKGZvdW5kKSB0aGlzLnNlc3Npb25GaWxlcy5zZXQoYWdlbnQuc2Vzc2lvbklkLCBmb3VuZClcbiAgICByZXR1cm4gZm91bmRcbiAgfVxuXG4gIGFzeW5jIHNjYW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jdHgubm93KClcbiAgICBjb25zdCByb290cyA9IGF3YWl0IHRoaXMucHJvamVjdFJvb3RzKClcbiAgICBpZiAoIXJvb3RzLmxlbmd0aCkgcmV0dXJuXG4gICAgY29uc3QgcGFyZW50cyA9IE9iamVjdC52YWx1ZXModGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50cylcbiAgICAgIC5maWx0ZXIoKGEpID0+IGEuc2Vzc2lvbklkICYmIGEucm9sZSAhPT0gJ3N1YmFnZW50JyAmJiAoYS5hZ2VudCA9PT0gJ2NsYXVkZScgfHwgYS5hZ2VudCA9PT0gbnVsbCkgJiYgKGEubGl2ZSB8fCBub3cgLSBhLmxhc3RTZWVuQXQgPCBSRUNFTlRfU0VTU0lPTl9NUykpXG4gICAgICAuc29ydCgoYSwgYikgPT4gTnVtYmVyKGIubGl2ZSkgLSBOdW1iZXIoYS5saXZlKSB8fCBiLmxhc3RTZWVuQXQgLSBhLmxhc3RTZWVuQXQpXG4gICAgICAuc2xpY2UoMCwgTUFYX1NFU1NJT05TX1BFUl9TQ0FOKVxuICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudHMpIHtcbiAgICAgIGNvbnN0IGRpciA9IGF3YWl0IHRoaXMuc3ViYWdlbnREaXIocm9vdHMsIHBhcmVudC5zZXNzaW9uSWQhLCBub3cpXG4gICAgICBpZiAoZGlyKSBhd2FpdCB0aGlzLnNjYW5EaXIoZGlyLCBwYXJlbnQsIG5vdylcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2plY3RSb290cygpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IFtqb2luKGhvbWVkaXIoKSwgJy5jbGF1ZGUnLCAncHJvamVjdHMnKSwgLi4udGhpcy5jbGF1ZGVIb21lcygpLm1hcCgoaG9tZSkgPT4gam9pbihob21lLCAncHJvamVjdHMnKSldXG4gICAgY29uc3Qgb3V0ID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQuYWRkKGF3YWl0IHJlYWxwYXRoKGNhbmRpZGF0ZSkpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gbm90IHRoZXJlXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBbLi4ub3V0XVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdWJhZ2VudERpcihyb290czogc3RyaW5nW10sIHNlc3Npb25JZDogc3RyaW5nLCBub3c6IG51bWJlcik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMuc2Vzc2lvbkRpcnMuZ2V0KHNlc3Npb25JZClcbiAgICBpZiAoY2FjaGVkICYmIChjYWNoZWQuZGlyIHx8IG5vdyAtIGNhY2hlZC5jaGVja2VkQXQgPCBESVJfUkVUUllfTVMpKSByZXR1cm4gY2FjaGVkLmRpclxuICAgIGxldCBmb3VuZDogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdHMpIHtcbiAgICAgIGxldCBwcm9qZWN0czogc3RyaW5nW11cbiAgICAgIHRyeSB7XG4gICAgICAgIHByb2plY3RzID0gYXdhaXQgcmVhZGRpcihyb290KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHByb2plY3Qgb2YgcHJvamVjdHMpIHtcbiAgICAgICAgY29uc3QgZGlyID0gam9pbihyb290LCBwcm9qZWN0LCBzZXNzaW9uSWQsICdzdWJhZ2VudHMnKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmICgoYXdhaXQgc3RhdChkaXIpKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBmb3VuZCA9IGRpclxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG5vdCB0aGlzIHByb2plY3RcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGZvdW5kKSBicmVha1xuICAgIH1cbiAgICB0aGlzLnNlc3Npb25EaXJzLnNldChzZXNzaW9uSWQsIHsgZGlyOiBmb3VuZCwgY2hlY2tlZEF0OiBub3cgfSlcbiAgICByZXR1cm4gZm91bmRcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2NhbkRpcihkaXI6IHN0cmluZywgcGFyZW50OiBBZ2VudFJlY29yZCwgbm93OiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbmFtZXM6IHN0cmluZ1tdXG4gICAgdHJ5IHtcbiAgICAgIG5hbWVzID0gKGF3YWl0IHJlYWRkaXIoZGlyKSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lLmVuZHNXaXRoKCcubWV0YS5qc29uJykpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7XG4gICAgICBjb25zdCBiYXNlID0gbmFtZS5zbGljZSgwLCAtJy5tZXRhLmpzb24nLmxlbmd0aClcbiAgICAgIGNvbnN0IG1ldGFQYXRoID0gam9pbihkaXIsIG5hbWUpXG4gICAgICBjb25zdCB0cmFuc2NyaXB0UGF0aCA9IGpvaW4oZGlyLCBgJHtiYXNlfS5qc29ubGApXG4gICAgICBsZXQgbWV0YU10aW1lID0gMFxuICAgICAgbGV0IG10aW1lID0gMFxuICAgICAgdHJ5IHtcbiAgICAgICAgbWV0YU10aW1lID0gKGF3YWl0IHN0YXQobWV0YVBhdGgpKS5tdGltZU1zXG4gICAgICAgIG10aW1lID0gTWF0aC5tYXgobWV0YU10aW1lLCBhd2FpdCBzdGF0KHRyYW5zY3JpcHRQYXRoKS50aGVuKChzKSA9PiBzLm10aW1lTXMpLmNhdGNoKCgpID0+IDApKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICAvLyBUaGUgbWV0YSBmaWxlIHJhcmVseSBjaGFuZ2VzIChvbmNlIGF0IHNwYXduLCBvbmNlIGF0IGZpbmlzaCk6IHBhcnNlIGl0IG9ubHkgd2hlbiBpdCBkb2VzLlxuICAgICAgbGV0IG1ldGE6IE1ldGFcbiAgICAgIGNvbnN0IGNhY2hlZE1ldGEgPSB0aGlzLm1ldGFDYWNoZS5nZXQobWV0YVBhdGgpXG4gICAgICBpZiAoY2FjaGVkTWV0YSAmJiBjYWNoZWRNZXRhLm10aW1lID09PSBtZXRhTXRpbWUpIG1ldGEgPSBjYWNoZWRNZXRhLm1ldGFcbiAgICAgIGVsc2Uge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIG1ldGEgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKG1ldGFQYXRoLCAndXRmOCcpKSBhcyBNZXRhXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5tZXRhQ2FjaGUuc2V0KG1ldGFQYXRoLCB7IG10aW1lOiBtZXRhTXRpbWUsIG1ldGEgfSlcbiAgICAgICAgaWYgKHRoaXMubWV0YUNhY2hlLnNpemUgPiBNQVhfTUVUQV9DQUNIRSkgdGhpcy5tZXRhQ2FjaGUuZGVsZXRlKHRoaXMubWV0YUNhY2hlLmtleXMoKS5uZXh0KCkudmFsdWUhKVxuICAgICAgfVxuICAgICAgY29uc3QgaWQgPSBtZXRhLnRvb2xVc2VJZCA/IGBzdWI6JHttZXRhLnRvb2xVc2VJZH1gIDogYHN1YjpmaWxlOiR7YmFzZX1gXG4gICAgICB0aGlzLnRyYW5zY3JpcHRzLnNldChpZCwgdHJhbnNjcmlwdFBhdGgpXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbaWRdXG4gICAgICBjb25zdCB3cml0aW5nID0gbm93IC0gbXRpbWUgPCBBQ1RJVkVfV1JJVEVfTVNcbiAgICAgIGNvbnN0IGZpbmlzaGVkID0gbWV0YS5maW5pc2hlZCA9PT0gdHJ1ZVxuICAgICAgY29uc3QgbGl2ZSA9ICFmaW5pc2hlZCAmJiB3cml0aW5nICYmIHBhcmVudC5saXZlXG4gICAgICAvLyBVbmNoYW5nZWQgZmlsZXMgb25seSBuZWVkIGEgbGl2ZW5lc3MgcmVmcmVzaCAoYSBzdWJhZ2VudCBnb2VzIHF1aWV0IHdoZW4gaXRzIHBhcmVudCBzdG9wcykuXG4gICAgICBpZiAodGhpcy5zZWVuTXRpbWUuZ2V0KGlkKSA9PT0gbXRpbWUgJiYgZXhpc3RpbmcgJiYgZXhpc3RpbmcubGl2ZSA9PT0gbGl2ZSkgY29udGludWVcbiAgICAgIHRoaXMuc2Vlbk10aW1lLnNldChpZCwgbXRpbWUpXG4gICAgICBjb25zdCBzdGFydGVkQXQgPSBleGlzdGluZz8uc3RhcnRlZEF0ID8/IChhd2FpdCBmaXJzdFRpbWVzdGFtcCh0cmFuc2NyaXB0UGF0aCkpID8/IG10aW1lXG4gICAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRBZ2VudChcbiAgICAgICAgaWQsXG4gICAgICAgIG10aW1lLFxuICAgICAgICB7XG4gICAgICAgICAgcm9sZTogJ3N1YmFnZW50JyxcbiAgICAgICAgICBhZ2VudDogJ2NsYXVkZScsXG4gICAgICAgICAgcGFyZW50SWQ6IGV4aXN0aW5nPy5wYXJlbnRJZCA/PyBwYXJlbnQuaWQsXG4gICAgICAgICAgY2FsbElkOiBtZXRhLnRvb2xVc2VJZCA/PyBudWxsLFxuICAgICAgICAgIHN1YmFnZW50VHlwZTogbWV0YS5hZ2VudFR5cGUgPz8gZXhpc3Rpbmc/LnN1YmFnZW50VHlwZSA/PyAnZ2VuZXJhbC1wdXJwb3NlJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogbWV0YS5kZXNjcmlwdGlvbiA/IHJlZGFjdEFuZFRydW5jYXRlKG1ldGEuZGVzY3JpcHRpb24sIDMwMCkgOiBleGlzdGluZz8uZGVzY3JpcHRpb24gPz8gbnVsbCxcbiAgICAgICAgICB0aXRsZTogbWV0YS5kZXNjcmlwdGlvbiA/IHJlZGFjdEFuZFRydW5jYXRlKG1ldGEuZGVzY3JpcHRpb24sIDEyMCkgOiBleGlzdGluZz8udGl0bGUgPz8gJ1N1YmFnZW50JyxcbiAgICAgICAgICBtb2RlbDogbWV0YS5tb2RlbCA/PyBleGlzdGluZz8ubW9kZWwgPz8gbnVsbCxcbiAgICAgICAgICBydW5JZDogcGFyZW50LnJ1bklkLFxuICAgICAgICAgIHRhc2tJZDogcGFyZW50LnRhc2tJZCxcbiAgICAgICAgICB3b3Jrc3BhY2VJZDogcGFyZW50LndvcmtzcGFjZUlkLFxuICAgICAgICAgIHdvcmt0cmVlUGF0aDogcGFyZW50Lndvcmt0cmVlUGF0aCxcbiAgICAgICAgICBicmFuY2g6IHBhcmVudC5icmFuY2gsXG4gICAgICAgICAgYWNjb3VudDogcGFyZW50LmFjY291bnQsXG4gICAgICAgICAgc3RhdGU6IGZpbmlzaGVkID8gJ2RvbmUnIDogbGl2ZSA/ICd3b3JraW5nJyA6ICd1bmtub3duJyxcbiAgICAgICAgICBvdXRjb21lOiBmaW5pc2hlZCA/ICdzdWNjZXNzJyA6IG51bGwsXG4gICAgICAgICAgbGl2ZSxcbiAgICAgICAgICBzdGFydGVkQXQsXG4gICAgICAgICAgc3RhdGVTaW5jZTogbXRpbWUsXG4gICAgICAgICAgZW5kZWRBdDogZmluaXNoZWQgPyBtdGltZSA6IG51bGwsXG4gICAgICAgICAgZXZpZGVuY2U6IFsnc2Vzc2lvbi1maWxlJ11cbiAgICAgICAgfSxcbiAgICAgICAgKCkgPT4gbmV3QWdlbnQoaWQsICdzdWJhZ2VudCcsIG5vdylcbiAgICAgIClcbiAgICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgc3ViYWdlbnQuZmlsZToke2lkfWAsIHRzOiBzdGFydGVkQXQsIGtpbmQ6ICdzdWJhZ2VudC5zcGF3bmVkJywgc291cmNlOiAnc2Vzc2lvbi1maWxlJywgZW50aXR5SWQ6IGlkLCB0YXJnZXRJZDogcGFyZW50LmlkLCBydW5JZDogcGFyZW50LnJ1bklkLCBzdW1tYXJ5OiBgJHtwYXJlbnQudGl0bGUgPz8gJ0NsYXVkZSd9IHNwYXduZWQgc3ViYWdlbnQ6ICR7bWV0YS5kZXNjcmlwdGlvbiA/PyBtZXRhLmFnZW50VHlwZSA/PyAnc3ViYWdlbnQnfWAgfSlcbiAgICAgIH0gZWxzZSBpZiAoZmluaXNoZWQgJiYgZXhpc3Rpbmcuc3RhdGUgIT09ICdkb25lJykge1xuICAgICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgaWQ6IGBzdWJhZ2VudC5kb25lOiR7aWR9YCwgdHM6IG10aW1lLCBraW5kOiAnc3ViYWdlbnQuY29tcGxldGVkJywgc291cmNlOiAnc2Vzc2lvbi1maWxlJywgZW50aXR5SWQ6IGlkLCB0YXJnZXRJZDogcGFyZW50LmlkLCBydW5JZDogcGFyZW50LnJ1bklkLCBzdW1tYXJ5OiBgU3ViYWdlbnQgJHttZXRhLmRlc2NyaXB0aW9uID8/ICcnfSBmaW5pc2hlZGAudHJpbSgpIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpcnN0VGltZXN0YW1wKHBhdGg6IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIGNvbnN0IGhhbmRsZSA9IGF3YWl0IG9wZW4ocGF0aCwgJ3InKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGJ1ZmZlciwgYnl0ZXNSZWFkIH0gPSBhd2FpdCBoYW5kbGUucmVhZChCdWZmZXIuYWxsb2MoODE5MiksIDAsIDgxOTIsIDApXG4gICAgICBjb25zdCBsaW5lID0gYnVmZmVyLnN1YmFycmF5KDAsIGJ5dGVzUmVhZCkudG9TdHJpbmcoJ3V0ZjgnKS5zcGxpdCgnXFxuJylbMF1cbiAgICAgIGNvbnN0IHRzID0gKEpTT04ucGFyc2UobGluZSkgYXMgeyB0aW1lc3RhbXA/OiBzdHJpbmcgfSkudGltZXN0YW1wXG4gICAgICBjb25zdCBtcyA9IHRzID8gRGF0ZS5wYXJzZSh0cykgOiBOYU5cbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobXMpID8gbXMgOiBudWxsXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGhhbmRsZS5jbG9zZSgpXG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG4iLCAiLy8gVGhlIG1vZGVsIGFuZCBlZmZvcnQgYW4gYWdlbnQgaXMgYWN0dWFsbHkgdXNpbmcsIHJlYWQgZnJvbSB0aGUgYWdlbnQgQ0xJJ3Mgb3duIHNlc3Npb24gZmlsZVxuLy8gKHRoZSBuZXdlc3QgdHVybiB3aW5zLCBzbyBhIG1pZC1zZXNzaW9uIC9tb2RlbCBjaGFuZ2Ugc2hvd3MgdXApOlxuLy8gIC0gQ2xhdWRlOiBhc3Npc3RhbnQgZW50cmllcyBjYXJyeSBgbWVzc2FnZS5tb2RlbGAsIHBsdXMgYGVmZm9ydGAgLyBgcGVyVHVybkVmZm9ydGA7XG4vLyAgLSBDb2RleDogYHR1cm5fY29udGV4dGAgZW50cmllcyBjYXJyeSBgbW9kZWxgIGFuZCBgZWZmb3J0YDsgdGhlIGZpbGUgbmFtZSBob2xkcyB0aGUgc2Vzc2lvbiBpZC5cbmltcG9ydCB7IG9wZW4sIHJlYWRkaXIsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJlY29yZCB9IGZyb20gJy4uLy4uL3NoYXJlZC9tb2RlbC50cydcbmltcG9ydCB0eXBlIHsgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgdHlwZSB7IFN1YmFnZW50RmlsZXNBZGFwdGVyIH0gZnJvbSAnLi9zdWJhZ2VudC1maWxlcy1hZGFwdGVyLnRzJ1xuXG5jb25zdCBUQUlMX0JZVEVTID0gMjU2ICogMTAyNFxuY29uc3QgUkVDRU5UX01TID0gNiAqIDYwICogNjAgKiAxMDAwXG5jb25zdCBDT0RFWF9JTkRFWF9NUyA9IDYwXzAwMFxuXG5leHBvcnQgdHlwZSBNb2RlbFJlYWRpbmcgPSB7IG1vZGVsOiBzdHJpbmcgfCBudWxsOyBlZmZvcnQ6IHN0cmluZyB8IG51bGwgfVxuXG5leHBvcnQgY2xhc3MgU2Vzc2lvbk1vZGVsQWRhcHRlciB7XG4gIHByaXZhdGUgY29kZXhJbmRleCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgcHJpdmF0ZSBjb2RleEluZGV4ZWRBdCA9IDBcbiAgcHJpdmF0ZSBzZWVuID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3R4OiBXb3JrZXJDb250ZXh0LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY2xhdWRlRmlsZXM6IFN1YmFnZW50RmlsZXNBZGFwdGVyLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29kZXhIb21lczogKCkgPT4gc3RyaW5nW11cbiAgKSB7fVxuXG4gIGFzeW5jIHJlZnJlc2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jdHgubm93KClcbiAgICBjb25zdCBhZ2VudHMgPSBPYmplY3QudmFsdWVzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHMpLmZpbHRlcigoYSkgPT4gKGEubGl2ZSB8fCBub3cgLSBhLmxhc3RTZWVuQXQgPCBSRUNFTlRfTVMpICYmIChhLnNlc3Npb25JZCB8fCBhLnJvbGUgPT09ICdzdWJhZ2VudCcpKVxuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgYWdlbnRzKSB7XG4gICAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy5maWxlRm9yKGFnZW50KVxuICAgICAgaWYgKCFwYXRoKSBjb250aW51ZVxuICAgICAgbGV0IG10aW1lID0gMFxuICAgICAgdHJ5IHtcbiAgICAgICAgbXRpbWUgPSAoYXdhaXQgc3RhdChwYXRoKSkubXRpbWVNc1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5zZWVuLmdldChhZ2VudC5pZCkgPT09IG10aW1lKSBjb250aW51ZVxuICAgICAgdGhpcy5zZWVuLnNldChhZ2VudC5pZCwgbXRpbWUpXG4gICAgICBjb25zdCByZWFkaW5nID0gYWdlbnQuYWdlbnQgPT09ICdjb2RleCcgPyByZWFkQ29kZXhNb2RlbChhd2FpdCB0YWlsKHBhdGgpKSA6IHJlYWRDbGF1ZGVNb2RlbChhd2FpdCB0YWlsKHBhdGgpKVxuICAgICAgaWYgKCFyZWFkaW5nLm1vZGVsICYmICFyZWFkaW5nLmVmZm9ydCkgY29udGludWVcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50LmlkXVxuICAgICAgaWYgKCFjdXJyZW50IHx8IChjdXJyZW50Lm1vZGVsID09PSAocmVhZGluZy5tb2RlbCA/PyBjdXJyZW50Lm1vZGVsKSAmJiBjdXJyZW50LmVmZm9ydCA9PT0gKHJlYWRpbmcuZWZmb3J0ID8/IGN1cnJlbnQuZWZmb3J0KSkpIGNvbnRpbnVlXG4gICAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRBZ2VudChhZ2VudC5pZCwgY3VycmVudC5sYXN0U2VlbkF0LCB7IG1vZGVsOiByZWFkaW5nLm1vZGVsID8/IHVuZGVmaW5lZCwgZWZmb3J0OiByZWFkaW5nLmVmZm9ydCA/PyB1bmRlZmluZWQsIGV2aWRlbmNlOiBbJ3Nlc3Npb24tZmlsZSddIH0sICgpID0+IGN1cnJlbnQpXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmaWxlRm9yKGFnZW50OiBBZ2VudFJlY29yZCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGlmIChhZ2VudC5hZ2VudCA9PT0gJ2NvZGV4JykgcmV0dXJuIGFnZW50LnNlc3Npb25JZCA/IGF3YWl0IHRoaXMuY29kZXhGaWxlKGFnZW50LnNlc3Npb25JZCkgOiBudWxsXG4gICAgaWYgKGFnZW50LmFnZW50ID09PSAnY2xhdWRlJyB8fCBhZ2VudC5hZ2VudCA9PT0gbnVsbCB8fCBhZ2VudC5yb2xlID09PSAnc3ViYWdlbnQnKSByZXR1cm4gYXdhaXQgdGhpcy5jbGF1ZGVGaWxlcy50cmFuc2NyaXB0UGF0aEZvcihhZ2VudClcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb2RleEZpbGUoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmN0eC5ub3coKVxuICAgIGlmICghdGhpcy5jb2RleEluZGV4LmhhcyhzZXNzaW9uSWQpICYmIG5vdyAtIHRoaXMuY29kZXhJbmRleGVkQXQgPiBDT0RFWF9JTkRFWF9NUykge1xuICAgICAgdGhpcy5jb2RleEluZGV4ZWRBdCA9IG5vd1xuICAgICAgZm9yIChjb25zdCBob21lIG9mIFtqb2luKGhvbWVkaXIoKSwgJy5jb2RleCcpLCAuLi50aGlzLmNvZGV4SG9tZXMoKV0pIGF3YWl0IGluZGV4Q29kZXhTZXNzaW9ucyhqb2luKGhvbWUsICdzZXNzaW9ucycpLCB0aGlzLmNvZGV4SW5kZXgpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvZGV4SW5kZXguZ2V0KHNlc3Npb25JZCkgPz8gbnVsbFxuICB9XG59XG5cbi8qKiBzZXNzaW9ucy9ZWVlZL01NL0REL3JvbGxvdXQtPHRpbWU+LTxzZXNzaW9uIGlkPi5qc29ubCwgbmV3ZXN0IGRheXMgZmlyc3QsIGJvdW5kZWQuICovXG5hc3luYyBmdW5jdGlvbiBpbmRleENvZGV4U2Vzc2lvbnMocm9vdDogc3RyaW5nLCBpbmRleDogTWFwPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBsaXN0ID0gYXN5bmMgKGRpcjogc3RyaW5nKSA9PiAoYXdhaXQgcmVhZGRpcihkaXIpLmNhdGNoKCgpID0+IFtdIGFzIHN0cmluZ1tdKSkuc29ydCgpLnJldmVyc2UoKVxuICBsZXQgZGF5cyA9IDBcbiAgZm9yIChjb25zdCB5ZWFyIG9mIGF3YWl0IGxpc3Qocm9vdCkpIHtcbiAgICBmb3IgKGNvbnN0IG1vbnRoIG9mIGF3YWl0IGxpc3Qoam9pbihyb290LCB5ZWFyKSkpIHtcbiAgICAgIGZvciAoY29uc3QgZGF5IG9mIGF3YWl0IGxpc3Qoam9pbihyb290LCB5ZWFyLCBtb250aCkpKSB7XG4gICAgICAgIGlmICgrK2RheXMgPiA0NSkgcmV0dXJuXG4gICAgICAgIGZvciAoY29uc3QgbmFtZSBvZiBhd2FpdCBsaXN0KGpvaW4ocm9vdCwgeWVhciwgbW9udGgsIGRheSkpKSB7XG4gICAgICAgICAgY29uc3QgbWF0Y2ggPSAvXnJvbGxvdXQtLiotKFswLTlhLWZdezh9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezEyfSlcXC5qc29ubCQvLmV4ZWMobmFtZSlcbiAgICAgICAgICBpZiAobWF0Y2ggJiYgIWluZGV4LmhhcyhtYXRjaFsxXSkpIGluZGV4LnNldChtYXRjaFsxXSwgam9pbihyb290LCB5ZWFyLCBtb250aCwgZGF5LCBuYW1lKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB0YWlsKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgaGFuZGxlID0gYXdhaXQgb3BlbihwYXRoLCAncicpXG4gIHRyeSB7XG4gICAgY29uc3Qgc2l6ZSA9IChhd2FpdCBoYW5kbGUuc3RhdCgpKS5zaXplXG4gICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1heCgwLCBzaXplIC0gVEFJTF9CWVRFUylcbiAgICBjb25zdCBidWZmZXIgPSBCdWZmZXIuYWxsb2Moc2l6ZSAtIHN0YXJ0KVxuICAgIGF3YWl0IGhhbmRsZS5yZWFkKGJ1ZmZlciwgMCwgYnVmZmVyLmxlbmd0aCwgc3RhcnQpXG4gICAgY29uc3QgbGluZXMgPSBidWZmZXIudG9TdHJpbmcoJ3V0ZjgnKS5zcGxpdCgnXFxuJylcbiAgICBpZiAoc3RhcnQgPiAwKSBsaW5lcy5zaGlmdCgpXG4gICAgcmV0dXJuIGxpbmVzXG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgaGFuZGxlLmNsb3NlKClcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZENsYXVkZU1vZGVsKGxpbmVzOiBzdHJpbmdbXSk6IE1vZGVsUmVhZGluZyB7XG4gIGZvciAobGV0IGkgPSBsaW5lcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmICghbGluZXNbaV0uaW5jbHVkZXMoJ1wiYXNzaXN0YW50XCInKSkgY29udGludWVcbiAgICB0cnkge1xuICAgICAgY29uc3QgZW50cnkgPSBKU09OLnBhcnNlKGxpbmVzW2ldKSBhcyB7IHR5cGU/OiBzdHJpbmc7IG1lc3NhZ2U/OiB7IG1vZGVsPzogc3RyaW5nIH07IGVmZm9ydD86IHN0cmluZzsgcGVyVHVybkVmZm9ydD86IHN0cmluZyB9XG4gICAgICBpZiAoZW50cnkudHlwZSAhPT0gJ2Fzc2lzdGFudCcgfHwgIWVudHJ5Lm1lc3NhZ2U/Lm1vZGVsIHx8IGVudHJ5Lm1lc3NhZ2UubW9kZWwgPT09ICc8c3ludGhldGljPicpIGNvbnRpbnVlXG4gICAgICByZXR1cm4geyBtb2RlbDogZW50cnkubWVzc2FnZS5tb2RlbCwgZWZmb3J0OiBlbnRyeS5wZXJUdXJuRWZmb3J0ID8/IGVudHJ5LmVmZm9ydCA/PyBudWxsIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIHBhcnRpYWwgbGluZVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtb2RlbDogbnVsbCwgZWZmb3J0OiBudWxsIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRDb2RleE1vZGVsKGxpbmVzOiBzdHJpbmdbXSk6IE1vZGVsUmVhZGluZyB7XG4gIGZvciAobGV0IGkgPSBsaW5lcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmICghbGluZXNbaV0uaW5jbHVkZXMoJ3R1cm5fY29udGV4dCcpKSBjb250aW51ZVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlbnRyeSA9IEpTT04ucGFyc2UobGluZXNbaV0pIGFzIHsgdHlwZT86IHN0cmluZzsgcGF5bG9hZD86IHsgbW9kZWw/OiBzdHJpbmc7IGVmZm9ydD86IHN0cmluZzsgcmVhc29uaW5nX2VmZm9ydD86IHN0cmluZyB9IH1cbiAgICAgIGlmIChlbnRyeS50eXBlICE9PSAndHVybl9jb250ZXh0JykgY29udGludWVcbiAgICAgIHJldHVybiB7IG1vZGVsOiBlbnRyeS5wYXlsb2FkPy5tb2RlbCA/PyBudWxsLCBlZmZvcnQ6IGVudHJ5LnBheWxvYWQ/LmVmZm9ydCA/PyBlbnRyeS5wYXlsb2FkPy5yZWFzb25pbmdfZWZmb3J0ID8/IG51bGwgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gcGFydGlhbCBsaW5lXG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1vZGVsOiBudWxsLCBlZmZvcnQ6IG51bGwgfVxufVxuIiwgIi8vIFJ1bnMgdGhlIGRvY3VtZW50ZWQgYG9yY2FgIENMSSB3aXRoIC0tanNvbi4gTmV2ZXIgYSBzaGVsbDogYXJndW1lbnRzIGdvIHN0cmFpZ2h0IHRvIGV4ZWNGaWxlLFxuLy8gc28gdGFzayB0aXRsZXMgYW5kIHNwZWNzIGNhbm5vdCBpbmplY3QgY29tbWFuZHMuXG5pbXBvcnQgeyBleGVjRmlsZSB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IGFjY2VzcywgY29uc3RhbnRzLCByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBob21lZGlyLCBwbGF0Zm9ybSB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgeyBkZWxpbWl0ZXIsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5cbmV4cG9ydCB0eXBlIENsaVJlc3VsdDxUPiA9IHsgb2s6IHRydWU7IHJlc3VsdDogVCB9IHwgeyBvazogZmFsc2U7IGNvZGU6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH1cblxuZXhwb3J0IHR5cGUgQ2xpUnVubmVyID0ge1xuICByZWFkb25seSBwYXRoOiBzdHJpbmcgfCBudWxsXG4gIHJ1bjxUID0gdW5rbm93bj4oYXJnczogc3RyaW5nW10sIG9wdGlvbnM/OiB7IHRpbWVvdXRNcz86IG51bWJlcjsgc3RkaW4/OiBzdHJpbmcgfSk6IFByb21pc2U8Q2xpUmVzdWx0PFQ+PlxufVxuXG5jb25zdCBNQVhfQ09OQ1VSUkVOVCA9IDNcbmNvbnN0IE1BWF9PVVRQVVQgPSA4ICogMTAyNCAqIDEwMjRcblxuLyoqXG4gKiBGaW5kcyB0aGUgT3JjYSBJREUgQ0xJLiBPbiBtYW55IExpbnV4IGRlc2t0b3BzIGAvdXNyL2Jpbi9vcmNhYCBpcyB0aGUgR05PTUUgKnNjcmVlbiByZWFkZXIqLFxuICogc28gZXZlcnkgY2FuZGlkYXRlIGlzIGNoZWNrZWQgYnkgY29udGVudCBhbmQgdGhlbiBjb25maXJtZWQgd2l0aCBgb3JjYSBzdGF0dXMgLS1qc29uYC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVDbGlQYXRoKG92ZXJyaWRlOiBzdHJpbmcgfCBudWxsKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGhvbWUgPSBob21lZGlyKClcbiAgY29uc3QgY2FuZGlkYXRlczogc3RyaW5nW10gPSBbXVxuICBpZiAob3ZlcnJpZGUpIGNhbmRpZGF0ZXMucHVzaChvdmVycmlkZSlcbiAgaWYgKHBsYXRmb3JtKCkgPT09ICdsaW51eCcpIGNhbmRpZGF0ZXMucHVzaChqb2luKGhvbWUsICcuY29uZmlnL29yY2EvbGludXgtb3JjYS1jbGktc2hpbS9vcmNhJykpXG4gIGNvbnN0IGV4ZSA9IHBsYXRmb3JtKCkgPT09ICd3aW4zMicgPyBbJ29yY2EuY21kJywgJ29yY2EuZXhlJywgJ29yY2EnXSA6IFsnb3JjYSddXG4gIGZvciAoY29uc3QgZGlyIG9mIChwcm9jZXNzLmVudi5QQVRIID8/ICcnKS5zcGxpdChkZWxpbWl0ZXIpKSBmb3IgKGNvbnN0IG5hbWUgb2YgZXhlKSBpZiAoZGlyKSBjYW5kaWRhdGVzLnB1c2goam9pbihkaXIsIG5hbWUpKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ2RhcndpbicpIGNhbmRpZGF0ZXMucHVzaCgnL3Vzci9sb2NhbC9iaW4vb3JjYScsICcvb3B0L2hvbWVicmV3L2Jpbi9vcmNhJywgJy9BcHBsaWNhdGlvbnMvT3JjYS5hcHAvQ29udGVudHMvUmVzb3VyY2VzL2Jpbi9vcmNhJylcbiAgaWYgKHBsYXRmb3JtKCkgPT09ICd3aW4zMicpIGNhbmRpZGF0ZXMucHVzaChqb2luKHByb2Nlc3MuZW52LkxPQ0FMQVBQREFUQSA/PyBqb2luKGhvbWUsICdBcHBEYXRhL0xvY2FsJyksICdQcm9ncmFtcy9PcmNhL3Jlc291cmNlcy9iaW4vb3JjYS5jbWQnKSlcbiAgaWYgKHBsYXRmb3JtKCkgPT09ICdsaW51eCcpIGNhbmRpZGF0ZXMucHVzaCgnL3Vzci9sb2NhbC9iaW4vb3JjYScpXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIFsuLi5uZXcgU2V0KGNhbmRpZGF0ZXMpXSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBhY2Nlc3MoY2FuZGlkYXRlLCBwbGF0Zm9ybSgpID09PSAnd2luMzInID8gY29uc3RhbnRzLkZfT0sgOiBjb25zdGFudHMuWF9PSylcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICAgIGlmIChhd2FpdCBsb29rc0xpa2VTY3JlZW5SZWFkZXIoY2FuZGlkYXRlKSkgY29udGludWVcbiAgICBpZiAoYXdhaXQgY29uZmlybXNPcmNhSWRlKGNhbmRpZGF0ZSkpIHJldHVybiBjYW5kaWRhdGVcbiAgfVxuICByZXR1cm4gbnVsbFxufVxuXG4vKiogVGhlIEdOT01FIHNjcmVlbiByZWFkZXIgaXMgYSBQeXRob24gc2NyaXB0OyBuZXZlciBleGVjdXRlIGl0LiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvb2tzTGlrZVNjcmVlblJlYWRlcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBoZWFkID0gKGF3YWl0IHJlYWRGaWxlKHBhdGgpKS5zdWJhcnJheSgwLCAyMDQ4KS50b1N0cmluZygnbGF0aW4xJylcbiAgICByZXR1cm4gL14jIS4qcHl0aG9uLy50ZXN0KGhlYWQpIHx8IC9UaGUgT3JjYSBUZWFtfEdOT01FfElnYWxpYXxvcmNhXFwub3JjYV9tYWluLy50ZXN0KGhlYWQpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmZ1bmN0aW9uIGNvbmZpcm1zT3JjYUlkZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgZXhlY0ZpbGUocGF0aCwgWydzdGF0dXMnLCAnLS1qc29uJ10sIHsgdGltZW91dDogNjAwMCwgbWF4QnVmZmVyOiAxMDI0ICogMTAyNCwgd2luZG93c0hpZGU6IHRydWUgfSwgKF9lcnJvciwgc3Rkb3V0KSA9PiB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUNsaU91dHB1dDx7IGFwcD86IHVua25vd24gfT4oc3Rkb3V0ID8/ICcnLCBudWxsKVxuICAgICAgcmVzb2x2ZShwYXJzZWQub2sgJiYgdHlwZW9mIHBhcnNlZC5yZXN1bHQgPT09ICdvYmplY3QnICYmIHBhcnNlZC5yZXN1bHQgIT09IG51bGwgJiYgJ2FwcCcgaW4gcGFyc2VkLnJlc3VsdClcbiAgICB9KVxuICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ2xpUnVubmVyKHBhdGg6IHN0cmluZyB8IG51bGwpOiBDbGlSdW5uZXIge1xuICBsZXQgYWN0aXZlID0gMFxuICBjb25zdCBxdWV1ZTogKCgpID0+IHZvaWQpW10gPSBbXVxuICBjb25zdCBhY3F1aXJlID0gKCkgPT5cbiAgICBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgaWYgKGFjdGl2ZSA8IE1BWF9DT05DVVJSRU5UKSB7XG4gICAgICAgIGFjdGl2ZSsrXG4gICAgICAgIHJlc29sdmUoKVxuICAgICAgfSBlbHNlIHF1ZXVlLnB1c2goKCkgPT4geyBhY3RpdmUrKzsgcmVzb2x2ZSgpIH0pXG4gICAgfSlcbiAgY29uc3QgcmVsZWFzZSA9ICgpID0+IHtcbiAgICBhY3RpdmUtLVxuICAgIHF1ZXVlLnNoaWZ0KCk/LigpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHBhdGgsXG4gICAgYXN5bmMgcnVuPFQ+KGFyZ3M6IHN0cmluZ1tdLCBvcHRpb25zOiB7IHRpbWVvdXRNcz86IG51bWJlcjsgc3RkaW4/OiBzdHJpbmcgfSA9IHt9KTogUHJvbWlzZTxDbGlSZXN1bHQ8VD4+IHtcbiAgICAgIGlmICghcGF0aCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBjb2RlOiAnY2xpX3VuYXZhaWxhYmxlJywgbWVzc2FnZTogJ1RoZSBvcmNhIENMSSB3YXMgbm90IGZvdW5kLiBTZXQgaXRzIHBhdGggaW4gQWdlbnQgRmxvdyBzZXR0aW5ncy4nIH1cbiAgICAgIGF3YWl0IGFjcXVpcmUoKVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlPENsaVJlc3VsdDxUPj4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgICBjb25zdCBjaGlsZCA9IGV4ZWNGaWxlKFxuICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIFsuLi5hcmdzLCAnLS1qc29uJ10sXG4gICAgICAgICAgICB7IHRpbWVvdXQ6IG9wdGlvbnMudGltZW91dE1zID8/IDE1MDAwLCBtYXhCdWZmZXI6IE1BWF9PVVRQVVQsIHdpbmRvd3NIaWRlOiB0cnVlLCBlbnY6IHsgLi4ucHJvY2Vzcy5lbnYsIE5PX0NPTE9SOiAnMScgfSB9LFxuICAgICAgICAgICAgKGVycm9yLCBzdGRvdXQpID0+IHJlc29sdmUocGFyc2VDbGlPdXRwdXQ8VD4oc3Rkb3V0LCBlcnJvcikpXG4gICAgICAgICAgKVxuICAgICAgICAgIGlmIChvcHRpb25zLnN0ZGluICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNoaWxkLnN0ZGluPy5lbmQob3B0aW9ucy5zdGRpbilcbiAgICAgICAgICB9IGVsc2UgY2hpbGQuc3RkaW4/LmVuZCgpXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICByZWxlYXNlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqIFRoZSBDTEkgcHJpbnRzIGB7IG9rLCByZXN1bHQgfWAgb3IgYHsgb2s6ZmFsc2UsIGVycm9yOnsgY29kZSwgbWVzc2FnZSB9IH1gIGV2ZW4gb24gbm9uLXplcm8gZXhpdHMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDbGlPdXRwdXQ8VD4oc3Rkb3V0OiBzdHJpbmcsIGVycm9yOiAoRXJyb3IgJiB7IGNvZGU/OiB1bmtub3duOyBraWxsZWQ/OiBib29sZWFuIH0pIHwgbnVsbCk6IENsaVJlc3VsdDxUPiB7XG4gIGNvbnN0IHRleHQgPSBzdGRvdXQudHJpbSgpXG4gIGNvbnN0IHN0YXJ0ID0gdGV4dC5pbmRleE9mKCd7JylcbiAgaWYgKHN0YXJ0ID49IDApIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZSh0ZXh0LnNsaWNlKHN0YXJ0KSkgYXMgeyBvaz86IGJvb2xlYW47IHJlc3VsdD86IFQ7IGVycm9yPzogeyBjb2RlPzogc3RyaW5nOyBtZXNzYWdlPzogc3RyaW5nIH0gfVxuICAgICAgaWYgKHBhcnNlZC5vayA9PT0gdHJ1ZSkgcmV0dXJuIHsgb2s6IHRydWUsIHJlc3VsdDogcGFyc2VkLnJlc3VsdCBhcyBUIH1cbiAgICAgIGlmIChwYXJzZWQub2sgPT09IGZhbHNlKSByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6IHBhcnNlZC5lcnJvcj8uY29kZSA/PyAnYWN0aW9uX2ZhaWxlZCcsIG1lc3NhZ2U6IHBhcnNlZC5lcnJvcj8ubWVzc2FnZSA/PyAnVGhlIG9yY2EgQ0xJIHJlcG9ydGVkIGFuIGVycm9yLicgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gZmFsbCB0aHJvdWdoXG4gICAgfVxuICB9XG4gIGlmIChlcnJvcj8ua2lsbGVkKSByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICd0aW1lb3V0JywgbWVzc2FnZTogJ1RoZSBvcmNhIENMSSBkaWQgbm90IGFuc3dlciBpbiB0aW1lLicgfVxuICByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICdhY3Rpb25fZmFpbGVkJywgbWVzc2FnZTogZXJyb3I/Lm1lc3NhZ2UgPz8gJ1RoZSBvcmNhIENMSSByZXR1cm5lZCBubyBKU09OLicgfVxufVxuIiwgIi8vIFdoYXQgZWFjaCBjb21tYW5kIGNhbiBhY3R1YWxseSBkbyBvbiB0aGlzIE9yY2EsIHNvIHRoZSBVSSBuZXZlciBzaG93cyBhIGZha2UgY29udHJvbC5cbmltcG9ydCB0eXBlIHsgQ29tbWFuZEF2YWlsYWJpbGl0eSwgQ29tbWFuZEtpbmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvY29tbWFuZHMudHMnXG5cbnR5cGUgUHJvYmUgPSB7IGhvc3RIYXM6IChtZXRob2Q6IHN0cmluZykgPT4gYm9vbGVhbjsgY2xpOiBib29sZWFuOyBhY3RBc0Nvb3JkaW5hdG9yOiBib29sZWFuIH1cblxuY29uc3QgQ09PUkRJTkFUT1JfUkVBU09OID1cbiAgJ09yY2Egb25seSBsZXRzIGEgUnVuXHUyMDE5cyBjb29yZGluYXRvciBjaGFuZ2UgaXRzIHRhc2tzLiBBZ2VudCBGbG93IHNob3dzIHRoZSBleGFjdCBjb21tYW5kIHRvIHJ1biBpbiB0aGUgY29vcmRpbmF0b3IsIG9yIHJ1bnMgaXQgYXMgdGhlIGNvb3JkaW5hdG9yIGlmIHlvdSB0dXJuIHRoYXQgb24gaW4gc2V0dGluZ3MuJ1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWFuZEF2YWlsYWJpbGl0eShraW5kOiBDb21tYW5kS2luZCwgcHJvYmU6IFByb2JlKTogQ29tbWFuZEF2YWlsYWJpbGl0eSB7XG4gIGNvbnN0IGhvc3QgPSAobWV0aG9kOiBzdHJpbmcsIHJlYXNvbj86IHN0cmluZyk6IENvbW1hbmRBdmFpbGFiaWxpdHkgPT5cbiAgICBwcm9iZS5ob3N0SGFzKG1ldGhvZCkgPyB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2RpcmVjdCcsIHJlYXNvbjogbnVsbCB9IDogeyBhdmFpbGFibGU6IGZhbHNlLCBtb2RlOiAndW5zdXBwb3J0ZWQnLCByZWFzb246IHJlYXNvbiA/PyBgVGhpcyBPcmNhIGRvZXMgbm90IG9mZmVyICR7bWV0aG9kfSB0byBwbHVnaW5zLmAgfVxuICBjb25zdCBjbGkgPSAoKTogQ29tbWFuZEF2YWlsYWJpbGl0eSA9PlxuICAgIHByb2JlLmNsaSA/IHsgYXZhaWxhYmxlOiB0cnVlLCBtb2RlOiAnZGlyZWN0JywgcmVhc29uOiBudWxsIH0gOiB7IGF2YWlsYWJsZTogZmFsc2UsIG1vZGU6ICd1bnN1cHBvcnRlZCcsIHJlYXNvbjogJ1RoZSBvcmNhIENMSSB3YXMgbm90IGZvdW5kLicgfVxuICBjb25zdCBjb29yZGluYXRvciA9ICgpOiBDb21tYW5kQXZhaWxhYmlsaXR5ID0+XG4gICAgIXByb2JlLmNsaVxuICAgICAgPyB7IGF2YWlsYWJsZTogZmFsc2UsIG1vZGU6ICd1bnN1cHBvcnRlZCcsIHJlYXNvbjogJ1RoZSBvcmNhIENMSSB3YXMgbm90IGZvdW5kLicgfVxuICAgICAgOiB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2Nvb3JkaW5hdG9yJywgcmVhc29uOiBwcm9iZS5hY3RBc0Nvb3JkaW5hdG9yID8gJ1J1bnMgYXMgdGhlIFJ1blx1MjAxOXMgY29vcmRpbmF0b3IgKGVuYWJsZWQgaW4gc2V0dGluZ3MpLicgOiBDT09SRElOQVRPUl9SRUFTT04gfVxuICBzd2l0Y2ggKGtpbmQpIHtcbiAgICBjYXNlICd0ZXJtaW5hbC5mb2N1cyc6XG4gICAgICByZXR1cm4gaG9zdCgndGVybWluYWwuZm9jdXMnKVxuICAgIGNhc2UgJ3Rlcm1pbmFsLnJlYWQnOlxuICAgICAgcmV0dXJuIGhvc3QoJ3Rlcm1pbmFsLnJlYWQnKVxuICAgIGNhc2UgJ2FnZW50LmxhdW5jaCc6XG4gICAgICByZXR1cm4gaG9zdCgnYWdlbnQubGF1bmNoJylcbiAgICBjYXNlICdhZ2VudC5yZXN1bWUnOlxuICAgICAgcmV0dXJuIGhvc3QoJ2FnZW50LnJlc3VtZScpXG4gICAgY2FzZSAnYWdlbnQuc3RvcCc6XG4gICAgICByZXR1cm4gY2xpKClcbiAgICBjYXNlICdhZ2VudC5yZWFkT3V0cHV0JzpcbiAgICAgIHJldHVybiBwcm9iZS5jbGkgfHwgcHJvYmUuaG9zdEhhcygndGVybWluYWwucmVhZCcpID8geyBhdmFpbGFibGU6IHRydWUsIG1vZGU6ICdkaXJlY3QnLCByZWFzb246IG51bGwgfSA6IHsgYXZhaWxhYmxlOiBmYWxzZSwgbW9kZTogJ3Vuc3VwcG9ydGVkJywgcmVhc29uOiAnTmVpdGhlciB0aGUgb3JjYSBDTEkgbm9yIHRlcm1pbmFsLnJlYWQgaXMgYXZhaWxhYmxlLicgfVxuICAgIGNhc2UgJ3Rhc2suY3JlYXRlJzpcbiAgICBjYXNlICd0YXNrLnVwZGF0ZSc6XG4gICAgY2FzZSAndGFzay5yZXRyeSc6XG4gICAgY2FzZSAndGFzay5kaXNwYXRjaCc6XG4gICAgY2FzZSAnZ2F0ZS5yZXNvbHZlJzpcbiAgICBjYXNlICdtZXNzYWdlLnNlbmQnOlxuICAgICAgcmV0dXJuIGNvb3JkaW5hdG9yKClcbiAgICBjYXNlICd0YXNrLmNhbmNlbCc6XG4gICAgICByZXR1cm4gcHJvYmUuY2xpID8geyBhdmFpbGFibGU6IHRydWUsIG1vZGU6ICdkaXJlY3QnLCByZWFzb246ICdTdG9wcyB0aGUgdGFza1x1MjAxOXMgd29ya2VyLiBNYXJraW5nIHRoZSB0YXNrIGNhbmNlbGxlZCBuZWVkcyB0aGUgY29vcmRpbmF0b3IuJyB9IDogY2xpKClcbiAgICBjYXNlICd3b3JrdHJlZS5jcmVhdGUnOlxuICAgICAgcmV0dXJuIGhvc3QoJ3dvcmtzcGFjZS5jcmVhdGUnKVxuICAgIGNhc2UgJ3dvcmt0cmVlLm9wZW4nOlxuICAgICAgcmV0dXJuIGhvc3QoJ3dvcmtzcGFjZS5vcGVuJylcbiAgICBjYXNlICd3b3JrdHJlZS5pbnNwZWN0JzpcbiAgICAgIHJldHVybiB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2RpcmVjdCcsIHJlYXNvbjogbnVsbCB9XG4gICAgY2FzZSAnYWdlbnQucHJvbXB0JzpcbiAgICAgIHJldHVybiBwcm9iZS5ob3N0SGFzKCd0ZXJtaW5hbC5zZW5kVGV4dCcpIHx8IHByb2JlLmNsaVxuICAgICAgICA/IHsgYXZhaWxhYmxlOiB0cnVlLCBtb2RlOiAnZGlyZWN0JywgcmVhc29uOiBudWxsIH1cbiAgICAgICAgOiB7IGF2YWlsYWJsZTogZmFsc2UsIG1vZGU6ICd1bnN1cHBvcnRlZCcsIHJlYXNvbjogJ1RoaXMgT3JjYSBvZmZlcnMgbm8gd2F5IGZvciBwbHVnaW5zIHRvIHNlbmQgdGV4dCB0byBhZ2VudHMuJyB9XG4gICAgY2FzZSAnbW9kZWwuY2hhbmdlJzpcbiAgICAgIHJldHVybiB7IGF2YWlsYWJsZTogZmFsc2UsIG1vZGU6ICd1bnN1cHBvcnRlZCcsIHJlYXNvbjogJ09yY2EgaGFzIG5vIEFQSSB0byBjaGFuZ2UgYSBydW5uaW5nIGFnZW50XHUyMDE5cyBtb2RlbCBvciBlZmZvcnQuIFBpY2sgYSBtb2RlbCB3aGVuIHlvdSByZXRyeSBvciBkaXNwYXRjaCB0aGUgdGFzayBpbnN0ZWFkLicgfVxuICAgIGNhc2UgJ2xhYmVscy51cGRhdGUnOlxuICAgIGNhc2UgJ2hpc3RvcnkubGlzdCc6XG4gICAgY2FzZSAnaGlzdG9yeS5sb2FkJzpcbiAgICBjYXNlICd2aWV3ZXIucGluZyc6XG4gICAgY2FzZSAnYWdlbnQuYXR0YWNoJzpcbiAgICBjYXNlICdzdGFyLnZpc2l0JzpcbiAgICBjYXNlICd1cGRhdGUuY2hlY2snOlxuICAgIGNhc2UgJ3VwZGF0ZS5ydW4nOlxuICAgIGNhc2UgJ3N0YXIuYW5zd2VyJzpcbiAgICBjYXNlICdkYXNoYm9hcmQuaW5mbyc6XG4gICAgY2FzZSAnZW50aXR5LmRldGFpbCc6XG4gICAgY2FzZSAnYWdlbnQuaW1hZ2UnOlxuICAgIGNhc2UgJ2Rhc2hib2FyZC5lbmFibGUnOlxuICAgIGNhc2UgJ2Rhc2hib2FyZC5jb250cm9scyc6XG4gICAgICByZXR1cm4geyBhdmFpbGFibGU6IHRydWUsIG1vZGU6ICdkaXJlY3QnLCByZWFzb246IG51bGwgfVxuICB9XG59XG4iLCAiLy8gSW1hZ2VzIHRoZSBwZXJzb24gYXR0YWNoZXMgaW4gQWdlbnQgRmxvdydzIG1lc3NhZ2UgYm94LiBUaGV5IGFycml2ZSBpbiBiYXNlNjQgY2h1bmtzIChPcmNhIGNhcHNcbi8vIGVhY2ggcGFuZWwgcmVxdWVzdCksIGFyZSBjaGVja2VkIHRvIHJlYWxseSBiZSB0aGUgaW1hZ2UgdHlwZSB0aGV5IGNsYWltLCBhbmQgYXJlIHNhdmVkIHdoZXJlXG4vLyBPcmNhJ3Mgb3duIGNoYXQga2VlcHMgYXR0YWNobWVudHMgKGBhZ2VudC1zZXNzaW9uLWF0dGFjaG1lbnRzLzx1dWlkPi88ZmlsZT5gKSwgc28gT3JjYSB0dXJucyBhblxuLy8gYEBcIjxwYXRoPlwiYCBtZW50aW9uIGludG8gYSByZWFsIGF0dGFjaG1lbnQuIE9ubHkgZmlsZXMgdGhpcyBzdG9yZSBzYXZlZCBjYW4gYmUgc2VudC5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBob21lZGlyLCBwbGF0Zm9ybSB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5leHBvcnQgY29uc3QgQVRUQUNITUVOVF9UWVBFUyA9IFsnaW1hZ2UvcG5nJywgJ2ltYWdlL2pwZWcnLCAnaW1hZ2Uvd2VicCcsICdpbWFnZS9naWYnXSBhcyBjb25zdFxuZXhwb3J0IHR5cGUgQXR0YWNobWVudFR5cGUgPSAodHlwZW9mIEFUVEFDSE1FTlRfVFlQRVMpW251bWJlcl1cbmV4cG9ydCBjb25zdCBNQVhfQVRUQUNITUVOVF9CWVRFUyA9IDEwICogMTAyNCAqIDEwMjRcbmV4cG9ydCBjb25zdCBNQVhfQVRUQUNITUVOVFNfUEVSX01FU1NBR0UgPSA1XG5jb25zdCBVUExPQURfVFRMX01TID0gNSAqIDYwICogMTAwMFxuY29uc3QgTUFYX1BFTkRJTkdfVVBMT0FEUyA9IDEwXG5jb25zdCBFWFRFTlNJT046IFJlY29yZDxBdHRhY2htZW50VHlwZSwgc3RyaW5nPiA9IHsgJ2ltYWdlL3BuZyc6ICdwbmcnLCAnaW1hZ2UvanBlZyc6ICdqcGcnLCAnaW1hZ2Uvd2VicCc6ICd3ZWJwJywgJ2ltYWdlL2dpZic6ICdnaWYnIH1cblxuLyoqIE9yY2EncyBvd24gYXR0YWNobWVudHMgZm9sZGVyIHdoZW4gT3JjYSdzIGRhdGEgZm9sZGVyIGV4aXN0cywgZWxzZSBBZ2VudCBGbG93J3Mgc3RhdGUgZm9sZGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGF0dGFjaG1lbnRzUm9vdChmYWxsYmFjazogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgaG9tZSA9IGhvbWVkaXIoKVxuICBjb25zdCBvcmNhRGlyID1cbiAgICBwbGF0Zm9ybSgpID09PSAnZGFyd2luJ1xuICAgICAgPyBqb2luKGhvbWUsICdMaWJyYXJ5L0FwcGxpY2F0aW9uIFN1cHBvcnQvb3JjYScpXG4gICAgICA6IHBsYXRmb3JtKCkgPT09ICd3aW4zMidcbiAgICAgICAgPyBqb2luKHByb2Nlc3MuZW52LkFQUERBVEEgPz8gam9pbihob21lLCAnQXBwRGF0YS9Sb2FtaW5nJyksICdvcmNhJylcbiAgICAgICAgOiBqb2luKHByb2Nlc3MuZW52LlhER19DT05GSUdfSE9NRSA/PyBqb2luKGhvbWUsICcuY29uZmlnJyksICdvcmNhJylcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3JjYURpcikgPyBqb2luKG9yY2FEaXIsICdhZ2VudC1zZXNzaW9uLWF0dGFjaG1lbnRzJykgOiBqb2luKGZhbGxiYWNrLCAnYWdlbnQtc2Vzc2lvbi1hdHRhY2htZW50cycpXG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIGJ5dGVzIHN0YXJ0IGxpa2UgdGhlIGNsYWltZWQgaW1hZ2UgdHlwZSAoYSByZW5hbWVkIGZpbGUgaXMgcmVmdXNlZCkuICovXG5leHBvcnQgZnVuY3Rpb24gbG9va3NMaWtlKHR5cGU6IEF0dGFjaG1lbnRUeXBlLCBieXRlczogQnVmZmVyKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ2ltYWdlL3BuZyc6XG4gICAgICByZXR1cm4gYnl0ZXMuc3ViYXJyYXkoMCwgOCkuZXF1YWxzKEJ1ZmZlci5mcm9tKFsweDg5LCAweDUwLCAweDRlLCAweDQ3LCAweDBkLCAweDBhLCAweDFhLCAweDBhXSkpXG4gICAgY2FzZSAnaW1hZ2UvanBlZyc6XG4gICAgICByZXR1cm4gYnl0ZXNbMF0gPT09IDB4ZmYgJiYgYnl0ZXNbMV0gPT09IDB4ZDggJiYgYnl0ZXNbMl0gPT09IDB4ZmZcbiAgICBjYXNlICdpbWFnZS9naWYnOlxuICAgICAgcmV0dXJuIGJ5dGVzLnN1YmFycmF5KDAsIDQpLnRvU3RyaW5nKCdsYXRpbjEnKSA9PT0gJ0dJRjgnXG4gICAgY2FzZSAnaW1hZ2Uvd2VicCc6XG4gICAgICByZXR1cm4gYnl0ZXMuc3ViYXJyYXkoMCwgNCkudG9TdHJpbmcoJ2xhdGluMScpID09PSAnUklGRicgJiYgYnl0ZXMuc3ViYXJyYXkoOCwgMTIpLnRvU3RyaW5nKCdsYXRpbjEnKSA9PT0gJ1dFQlAnXG4gIH1cbn1cblxudHlwZSBVcGxvYWQgPSB7IHR5cGU6IEF0dGFjaG1lbnRUeXBlOyBjaHVua3M6IHN0cmluZ1tdOyBsZW5ndGg6IG51bWJlcjsgc3RhcnRlZEF0OiBudW1iZXIgfVxuXG5leHBvcnQgY2xhc3MgQXR0YWNobWVudFN0b3JlIHtcbiAgcHJpdmF0ZSB1cGxvYWRzID0gbmV3IE1hcDxzdHJpbmcsIFVwbG9hZD4oKVxuICAvKiogYXR0YWNobWVudCBpZCBcdTIxOTIgc2F2ZWQgZmlsZS4gKi9cbiAgcHJpdmF0ZSBzYXZlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJvb3Q6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG5vdzogKCkgPT4gbnVtYmVyID0gRGF0ZS5ub3dcbiAgKSB7fVxuXG4gIC8qKlxuICAgKiBPbmUgY2h1bmsgb2YgYW4gdXBsb2FkLiBgb2Zmc2V0YCBtdXN0IGVxdWFsIHdoYXQgd2FzIHJlY2VpdmVkIHNvIGZhciAoY2h1bmtzIGluIG9yZGVyLCByZXRyaWVzXG4gICAqIG9mIHRoZSBzYW1lIGNodW5rIGFyZSBoYXJtbGVzcykuIFRoZSBsYXN0IGNodW5rIChgZG9uZWApIGNoZWNrcyBhbmQgc2F2ZXMgdGhlIGZpbGUuXG4gICAqL1xuICBhc3luYyBhcHBlbmQodXBsb2FkSWQ6IHN0cmluZywgdHlwZTogQXR0YWNobWVudFR5cGUsIGNodW5rOiBzdHJpbmcsIG9mZnNldDogbnVtYmVyLCBkb25lOiBib29sZWFuKTogUHJvbWlzZTx7IHJlY2VpdmVkOiBudW1iZXIgfSB8IHsgYXR0YWNobWVudElkOiBzdHJpbmc7IGJ5dGVzOiBudW1iZXIgfT4ge1xuICAgIHRoaXMuc3dlZXAoKVxuICAgIGxldCB1cGxvYWQgPSB0aGlzLnVwbG9hZHMuZ2V0KHVwbG9hZElkKVxuICAgIGlmICghdXBsb2FkKSB7XG4gICAgICBpZiAob2Zmc2V0ICE9PSAwKSB0aHJvdyBjb2RlRXJyb3IoJ2ludmFsaWRfcGFyYW1zJywgJ1RoaXMgdXBsb2FkIGV4cGlyZWQ7IGF0dGFjaCB0aGUgaW1hZ2UgYWdhaW4uJylcbiAgICAgIGlmICh0aGlzLnVwbG9hZHMuc2l6ZSA+PSBNQVhfUEVORElOR19VUExPQURTKSB0aHJvdyBjb2RlRXJyb3IoJ2J1c3knLCAnVG9vIG1hbnkgaW1hZ2VzIHVwbG9hZGluZyBhdCBvbmNlLicpXG4gICAgICB1cGxvYWQgPSB7IHR5cGUsIGNodW5rczogW10sIGxlbmd0aDogMCwgc3RhcnRlZEF0OiB0aGlzLm5vdygpIH1cbiAgICAgIHRoaXMudXBsb2Fkcy5zZXQodXBsb2FkSWQsIHVwbG9hZClcbiAgICB9XG4gICAgaWYgKHVwbG9hZC50eXBlICE9PSB0eXBlKSB0aHJvdyBjb2RlRXJyb3IoJ2ludmFsaWRfcGFyYW1zJywgJ1RoZSBpbWFnZSB0eXBlIGNoYW5nZWQgZHVyaW5nIHRoZSB1cGxvYWQuJylcbiAgICBpZiAob2Zmc2V0ID09PSB1cGxvYWQubGVuZ3RoKSB7XG4gICAgICB1cGxvYWQuY2h1bmtzLnB1c2goY2h1bmspXG4gICAgICB1cGxvYWQubGVuZ3RoICs9IGNodW5rLmxlbmd0aFxuICAgIH0gZWxzZSBpZiAob2Zmc2V0ICsgY2h1bmsubGVuZ3RoICE9PSB1cGxvYWQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBjb2RlRXJyb3IoJ2ludmFsaWRfcGFyYW1zJywgJ0ltYWdlIGNodW5rcyBhcnJpdmVkIG91dCBvZiBvcmRlcjsgYXR0YWNoIHRoZSBpbWFnZSBhZ2Fpbi4nKVxuICAgIH1cbiAgICBpZiAodXBsb2FkLmxlbmd0aCAqIDAuNzUgPiBNQVhfQVRUQUNITUVOVF9CWVRFUyArIDMpIHtcbiAgICAgIHRoaXMudXBsb2Fkcy5kZWxldGUodXBsb2FkSWQpXG4gICAgICB0aHJvdyBjb2RlRXJyb3IoJ3Rvb19sYXJnZScsIGBJbWFnZXMgY2FuIGJlIGF0IG1vc3QgJHtNQVhfQVRUQUNITUVOVF9CWVRFUyAvIDEwMjQgLyAxMDI0fSBNQi5gKVxuICAgIH1cbiAgICBpZiAoIWRvbmUpIHJldHVybiB7IHJlY2VpdmVkOiB1cGxvYWQubGVuZ3RoIH1cbiAgICB0aGlzLnVwbG9hZHMuZGVsZXRlKHVwbG9hZElkKVxuICAgIGNvbnN0IGJ5dGVzID0gQnVmZmVyLmZyb20odXBsb2FkLmNodW5rcy5qb2luKCcnKSwgJ2Jhc2U2NCcpXG4gICAgaWYgKCFieXRlcy5sZW5ndGggfHwgYnl0ZXMubGVuZ3RoID4gTUFYX0FUVEFDSE1FTlRfQllURVMpIHRocm93IGNvZGVFcnJvcigndG9vX2xhcmdlJywgYEltYWdlcyBjYW4gYmUgYXQgbW9zdCAke01BWF9BVFRBQ0hNRU5UX0JZVEVTIC8gMTAyNCAvIDEwMjR9IE1CLmApXG4gICAgaWYgKCFsb29rc0xpa2UodHlwZSwgYnl0ZXMpKSB0aHJvdyBjb2RlRXJyb3IoJ2ludmFsaWRfcGFyYW1zJywgJ1RoYXQgZmlsZSBpcyBub3QgdGhlIGltYWdlIHR5cGUgaXQgY2xhaW1zIHRvIGJlLicpXG4gICAgY29uc3QgYXR0YWNobWVudElkID0gcmFuZG9tVVVJRCgpXG4gICAgY29uc3QgZGlyID0gam9pbih0aGlzLnJvb3QsIGF0dGFjaG1lbnRJZClcbiAgICBhd2FpdCBta2RpcihkaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzcwMCB9KVxuICAgIGNvbnN0IHBhdGggPSBqb2luKGRpciwgYGFnZW50LWZsb3ctcGFzdGUtJHt0aGlzLm5vdygpfS4ke0VYVEVOU0lPTlt0eXBlXX1gKVxuICAgIGF3YWl0IHdyaXRlRmlsZShwYXRoLCBieXRlcywgeyBtb2RlOiAwbzYwMCB9KVxuICAgIHRoaXMuc2F2ZWQuc2V0KGF0dGFjaG1lbnRJZCwgcGF0aClcbiAgICBpZiAodGhpcy5zYXZlZC5zaXplID4gMjAwKSB0aGlzLnNhdmVkLmRlbGV0ZSh0aGlzLnNhdmVkLmtleXMoKS5uZXh0KCkudmFsdWUhKVxuICAgIHJldHVybiB7IGF0dGFjaG1lbnRJZCwgYnl0ZXM6IGJ5dGVzLmxlbmd0aCB9XG4gIH1cblxuICAvKiogVGhlIHNhdmVkIGZpbGUgZm9yIGFuIGF0dGFjaG1lbnQgaWQsIG9yIG51bGwgd2hlbiB0aGlzIHN0b3JlIGRpZCBub3Qgc2F2ZSBpdC4gKi9cbiAgcGF0aEZvcihhdHRhY2htZW50SWQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnNhdmVkLmdldChhdHRhY2htZW50SWQpID8/IG51bGxcbiAgfVxuXG4gIHByaXZhdGUgc3dlZXAoKTogdm9pZCB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5ub3coKVxuICAgIGZvciAoY29uc3QgW2lkLCB1cGxvYWRdIG9mIHRoaXMudXBsb2FkcykgaWYgKG5vdyAtIHVwbG9hZC5zdGFydGVkQXQgPiBVUExPQURfVFRMX01TKSB0aGlzLnVwbG9hZHMuZGVsZXRlKGlkKVxuICB9XG59XG5cbi8qKiBIb3cgYW4gYXR0YWNobWVudCBpcyBtZW50aW9uZWQgaW4gdGhlIG1lc3NhZ2UgdGV4dCwgcGVyIGRlbGl2ZXJ5IHJvdXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lbnRpb25Gb3IocGF0aDogc3RyaW5nLCByb3V0ZTogJ2NoYXQnIHwgJ2NsYXVkZS10ZXJtaW5hbCcgfCAnb3RoZXInKTogc3RyaW5nIHtcbiAgLy8gT3JjYSdzIGNoYXQgYW5kIENsYXVkZSBDb2RlIGJvdGggcmVhZCBgQFwiPHBhdGg+XCJgIGFzIGFuIGF0dGFjaGVkIGZpbGU7IG90aGVycyBnZXQgdGhlIHBsYWluIHBhdGguXG4gIHJldHVybiByb3V0ZSA9PT0gJ290aGVyJyA/IHBhdGggOiBgQFwiJHtwYXRoLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKX1cImBcbn1cblxuZnVuY3Rpb24gY29kZUVycm9yKGNvZGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKTogRXJyb3IgJiB7IGNvZGU6IHN0cmluZyB9IHtcbiAgcmV0dXJuIE9iamVjdC5hc3NpZ24obmV3IEVycm9yKG1lc3NhZ2UpLCB7IGNvZGUgfSlcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFVwZGF0ZUNoZWNrZXIgfSBmcm9tICcuLi91cGRhdGUvdXBkYXRlLWNoZWNrLnRzJ1xuaW1wb3J0IHR5cGUgeyBTdGFyQW5zd2VyLCBTdGFyUHJvbXB0U3RvcmUgfSBmcm9tICcuLi9zdGF0ZS9zdGFyLXByb21wdC50cydcbi8vIFJ1bnMgdmFsaWRhdGVkIGNvbW1hbmRzIGFnYWluc3QgcmVhbCBPcmNhIG9wZXJhdGlvbnMuIEVhY2ggcmVxdWVzdCBpZCBydW5zIGF0IG1vc3Qgb25jZTtcbi8vIGRlc3RydWN0aXZlIGNvbW1hbmRzIG5lZWQgdGhlIFVJJ3MgY29uZmlybWF0aW9uIGZsYWc7IHJlc3VsdHMgYXJlIHJlcG9ydGVkIGFzIHRoZXkgaGFwcGVuZWQuXG5pbXBvcnQgeyBtZW50aW9uRm9yLCB0eXBlIEF0dGFjaG1lbnRTdG9yZSwgdHlwZSBBdHRhY2htZW50VHlwZSB9IGZyb20gJy4vYXR0YWNobWVudHMudHMnXG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyBERVNUUlVDVElWRV9DT01NQU5EUywgUkVBRF9PTkxZX0NPTU1BTkRTLCB2YWxpZGF0ZUNvbW1hbmQsIFZhbGlkYXRpb25FcnJvciwgdHlwZSBDb21tYW5kS2luZCwgdHlwZSBDb21tYW5kUmVxdWVzdCwgdHlwZSBDb21tYW5kUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9zaGFyZWQvY29tbWFuZHMudHMnXG5pbXBvcnQgdHlwZSB7IEFnZW50UmVjb3JkLCBMYWJlbENvbmZpZyB9IGZyb20gJy4uLy4uL3NoYXJlZC9tb2RlbC50cydcbmltcG9ydCB7IHJlZGFjdCwgc3RyaXBBbnNpIH0gZnJvbSAnLi4vLi4vc2hhcmVkL3JlZGFjdC50cydcbmltcG9ydCB0eXBlIHsgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgeyBpbnNwZWN0V29ya3RyZWUgfSBmcm9tICcuLi9naXQvZ2l0LWluc3BlY3QudHMnXG5pbXBvcnQgdHlwZSB7IFBlcnNpc3RlbmNlIH0gZnJvbSAnLi4vc3RhdGUvcGVyc2lzdGVuY2UudHMnXG5pbXBvcnQgeyBjb21tYW5kQXZhaWxhYmlsaXR5IH0gZnJvbSAnLi9hdmFpbGFiaWxpdHkudHMnXG5pbXBvcnQgeyBjb29yZGluYXRvckFyZ3MsIHNoZWxsUXVvdGUgfSBmcm9tICcuL2Nvb3JkaW5hdG9yLWNvbW1hbmRzLnRzJ1xuaW1wb3J0IHsgcmVhZFdvcmtlck91dHB1dCB9IGZyb20gJy4vdHJhbnNjcmlwdC50cydcbmltcG9ydCB7IGNoYXRTZXNzaW9uSWRGcm9tUGFuZUtleSB9IGZyb20gJy4uL3J1bnRpbWUtcnBjL2NoYXQtc2VuZC50cydcbmltcG9ydCB7IHJlYWRDbGF1ZGVJbWFnZSwgcmVhZENsYXVkZVRyYW5zY3JpcHQgfSBmcm9tICcuL2NsYXVkZS10cmFuc2NyaXB0LnRzJ1xuXG5leHBvcnQgdHlwZSBSb3V0ZXJEZXBzID0ge1xuICBjdHg6IFdvcmtlckNvbnRleHRcbiAgcGVyc2lzdGVuY2U6IFBlcnNpc3RlbmNlXG4gIG93blRlcm1pbmFsczogU2V0PHN0cmluZz5cbiAgc2V0dGluZ3M6ICgpID0+IHsgYWN0QXNDb29yZGluYXRvcjogYm9vbGVhbjsgY2hhdFNlbmQ6IGJvb2xlYW4gfVxuICAvKiogRXhwZXJpbWVudGFsOiBPcmNhIHJ1bnRpbWUgUlBDIHNlbmQgaW50byBhIGNoYXQgc2Vzc2lvbi4gSW5qZWN0ZWQgc28gdGVzdHMgbmV2ZXIgdG91Y2ggYSByZWFsIHNvY2tldC4gKi9cbiAgc2VuZENoYXQ/OiAoc2Vzc2lvbklkOiBzdHJpbmcsIHRleHQ6IHN0cmluZykgPT4gUHJvbWlzZTx1bmtub3duPlxuICB1cGRhdGVMYWJlbHM6IChsYWJlbHM6IExhYmVsQ29uZmlnKSA9PiBQcm9taXNlPHZvaWQ+XG4gIGRhc2hib2FyZEluZm86ICgpID0+IHsgZW5hYmxlZDogYm9vbGVhbjsgdXJsOiBzdHJpbmcgfCBudWxsIH1cbiAgcmVmcmVzaDogKCkgPT4gdm9pZFxuICBmdWxsVGV4dDogKGtleTogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsXG4gIC8qKiBQYXRoIG9mIGEgQ2xhdWRlIHRyYW5zY3JpcHQgZm9yIHRoaXMgYWdlbnQsIHdoZW4gb25lIGV4aXN0cy4gKi9cbiAgY2xhdWRlVHJhbnNjcmlwdFBhdGg6IChhZ2VudDogQWdlbnRSZWNvcmQpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD5cbiAgLyoqIFN0YXJ0cyBwdXNoaW5nIGNoYW5nZXMgb2YgdGhpcyB0cmFuc2NyaXB0IHRvIHZpZXdzOyB0cnVlIHdoZW4gaXQgd2lsbC4gKi9cbiAgd2F0Y2hPdXRwdXQ/OiAoYWdlbnRJZDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+IGJvb2xlYW5cbiAgLyoqIE91dHB1dCB3aXRob3V0IGEgZmlsZTogdmlld3MgYXJlIHRvbGQgb24gdGhlIGFnZW50J3Mgc3RhdHVzIGNoYW5nZXMgYW5kIHRvb2wgY2FsbHMgaW5zdGVhZC4gKi9cbiAgbm90ZU91dHB1dEludGVyZXN0PzogKGFnZW50SWQ6IHN0cmluZykgPT4gdm9pZFxuICAvKiogSW1hZ2VzIGF0dGFjaGVkIGluIHRoZSBtZXNzYWdlIGJveCAoYWdlbnQuYXR0YWNoKS4gKi9cbiAgYXR0YWNobWVudHM/OiBBdHRhY2htZW50U3RvcmVcbiAgLyoqIFRoZSBvY2Nhc2lvbmFsIFwic3RhciB0aGUgcHJvamVjdFwiIHByb21wdC4gKi9cbiAgc3RhclByb21wdD86IFN0YXJQcm9tcHRTdG9yZVxuICAvKiogTmV3LXZlcnNpb24gY2hlY2tzIGFuZCBgb3JjYSBwbHVnaW4gdXBkYXRlYC4gKi9cbiAgdXBkYXRlcz86IFVwZGF0ZUNoZWNrZXJcbiAgLyoqIFRoZSBwbHVnaW4ncyBvd24gYGRhc2hib2FyZENvbnRyb2xzYCBzZXR0aW5nIChzYW1lIHN3aXRjaCBhcyBpbiBPcmNhIFNldHRpbmdzKS4gKi9cbiAgc2V0RGFzaGJvYXJkQ29udHJvbHM/OiAoZW5hYmxlZDogYm9vbGVhbikgPT4gUHJvbWlzZTx7IGNvbnRyb2xzOiBib29sZWFuIH0+XG4gIHNldERhc2hib2FyZDogKGVuYWJsZWQ6IGJvb2xlYW4pID0+IFByb21pc2U8eyBlbmFibGVkOiBib29sZWFuOyB1cmw6IHN0cmluZyB8IG51bGwgfT5cbiAgLyoqIENvbW1hbmRzIGFsbG93ZWQgZnJvbSB0aGlzIGNhbGxlciAodGhlIGRhc2hib2FyZCB3aXRob3V0IGNvbnRyb2wgcmlnaHRzIGdldHMgcmVhZC1vbmx5KS4gKi9cbn1cblxuY29uc3QgQ0FDSEVfTElNSVQgPSA1MDBcbmNvbnN0IE9VVFBVVF9DQUNIRV9NUyA9IDI1MDBcbi8qKiBCYXNlNjQgY2hhcmFjdGVycyBwZXIgaW1hZ2UgY2h1bms7IHdlbGwgdW5kZXIgT3JjYSdzIDEgTWlCIHBhbmVsIGFuc3dlciBsaW1pdC4gKi9cbmNvbnN0IElNQUdFX0NIVU5LID0gNjAwXzAwMFxuY29uc3QgT1VUUFVUX0JVREdFVCA9IDg1MCAqIDEwMjRcblxuZXhwb3J0IGNsYXNzIENvbW1hbmRSb3V0ZXIge1xuICBwcml2YXRlIHJlc3VsdHMgPSBuZXcgTWFwPHN0cmluZywgUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+PigpXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkZXBzOiBSb3V0ZXJEZXBzKSB7fVxuXG4gIC8qKiBFbnRyeSBwb2ludCBmb3IgZXZlcnkgdHJhbnNwb3J0LiBgYWxsb3dlZGAgbmFycm93cyB3aGF0IGEgY2FsbGVyIG1heSBydW4uICovXG4gIGhhbmRsZShpbnB1dDogdW5rbm93biwgYWxsb3dlZDogKGtpbmQ6IENvbW1hbmRLaW5kKSA9PiBib29sZWFuID0gKCkgPT4gdHJ1ZSk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgbGV0IHJlcXVlc3Q6IENvbW1hbmRSZXF1ZXN0XG4gICAgdHJ5IHtcbiAgICAgIHJlcXVlc3QgPSB2YWxpZGF0ZUNvbW1hbmQoaW5wdXQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmFpbChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvciA/ICdpbnZhbGlkX3BhcmFtcycgOiAnYWN0aW9uX2ZhaWxlZCcsIChlcnJvciBhcyBFcnJvcikubWVzc2FnZSkpXG4gICAgfVxuICAgIGlmICghYWxsb3dlZChyZXF1ZXN0LmtpbmQpKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZhaWwoJ25vdF9wZXJtaXR0ZWQnLCAnVGhpcyB2aWV3IG1heSBub3QgcnVuIHRoYXQgY29tbWFuZC4nKSlcbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLnJlc3VsdHMuZ2V0KHJlcXVlc3QucmVxdWVzdElkKVxuICAgIGlmIChjYWNoZWQpIHJldHVybiBjYWNoZWRcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5leGVjdXRlKHJlcXVlc3QpXG4gICAgdGhpcy5yZXN1bHRzLnNldChyZXF1ZXN0LnJlcXVlc3RJZCwgcHJvbWlzZSlcbiAgICBpZiAodGhpcy5yZXN1bHRzLnNpemUgPiBDQUNIRV9MSU1JVCkge1xuICAgICAgY29uc3Qgb2xkZXN0ID0gdGhpcy5yZXN1bHRzLmtleXMoKS5uZXh0KCkudmFsdWVcbiAgICAgIGlmIChvbGRlc3QgIT09IHVuZGVmaW5lZCkgdGhpcy5yZXN1bHRzLmRlbGV0ZShvbGRlc3QpXG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGUocmVxdWVzdDogQ29tbWFuZFJlcXVlc3QpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBhdmFpbGFiaWxpdHkgPSBjb21tYW5kQXZhaWxhYmlsaXR5KHJlcXVlc3Qua2luZCwgeyBob3N0SGFzOiAobSkgPT4gY3R4Lm9yY2EuaG9zdC5oYXMobSksIGNsaTogQm9vbGVhbihjdHguY2xpLnBhdGgpLCBhY3RBc0Nvb3JkaW5hdG9yOiB0aGlzLmRlcHMuc2V0dGluZ3MoKS5hY3RBc0Nvb3JkaW5hdG9yIH0pXG4gICAgaWYgKCFhdmFpbGFiaWxpdHkuYXZhaWxhYmxlKSByZXR1cm4gZmFpbCgndW5zdXBwb3J0ZWQnLCBhdmFpbGFiaWxpdHkucmVhc29uID8/ICdOb3Qgc3VwcG9ydGVkIGJ5IHRoaXMgT3JjYS4nKVxuICAgIGlmIChERVNUUlVDVElWRV9DT01NQU5EUy5oYXMocmVxdWVzdC5raW5kKSAmJiAhcmVxdWVzdC5jb25maXJtZWQpIHJldHVybiBmYWlsKCdjb25maXJtYXRpb25fcmVxdWlyZWQnLCAnQ29uZmlybSB0aGlzIGFjdGlvbiBmaXJzdC4nKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucnVuKHJlcXVlc3QpXG4gICAgICBpZiAoIVJFQURfT05MWV9DT01NQU5EUy5oYXMocmVxdWVzdC5raW5kKSAmJiByZXF1ZXN0LmtpbmQgIT09ICdlbnRpdHkuZGV0YWlsJykgY3R4LnN0b3JlLmVtaXQoe1xuICAgICAgICB0czogY3R4Lm5vdygpLFxuICAgICAgICBraW5kOiByZXNwb25zZS5vayA/ICdjb21tYW5kLmV4ZWN1dGVkJyA6ICdjb21tYW5kLmZhaWxlZCcsXG4gICAgICAgIHNvdXJjZTogJ2NvbW1hbmQnLFxuICAgICAgICBlbnRpdHlJZDogU3RyaW5nKHJlcXVlc3QucGFyYW1zLmFnZW50SWQgPz8gcmVxdWVzdC5wYXJhbXMudGFza0lkID8/IHJlcXVlc3QucGFyYW1zLnRlcm1pbmFsSWQgPz8gcmVxdWVzdC5wYXJhbXMud29ya3NwYWNlSWQgPz8gcmVxdWVzdC5raW5kKSxcbiAgICAgICAgc3VtbWFyeTogYCR7cmVxdWVzdC5raW5kfTogJHtyZXNwb25zZS5vayA/ICdkb25lJyA6IHJlc3BvbnNlLmVycm9yLm1lc3NhZ2V9YFxuICAgICAgfSlcbiAgICAgIC8vIFJlYWRzIGNoYW5nZSBub3RoaW5nIGluIE9yY2EsIHNvIHRoZXkgbXVzdCBub3QgdHJpZ2dlciBhIHJlLXNjYW4gKHRoZSBvdXRwdXQgdmlldyBwb2xscykuXG4gICAgICBpZiAocmVzcG9uc2Uub2sgJiYgIVJFQURfT05MWV9DT01NQU5EUy5oYXMocmVxdWVzdC5raW5kKSkgdGhpcy5kZXBzLnJlZnJlc2goKVxuICAgICAgcmV0dXJuIHJlc3BvbnNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIEVycm9yICYgeyBjb2RlPzogc3RyaW5nIH1cbiAgICAgIGN0eC5sb2coYGNvbW1hbmQgJHtyZXF1ZXN0LmtpbmR9IGZhaWxlZDogJHtlcnIubWVzc2FnZX1gKVxuICAgICAgcmV0dXJuIGZhaWwodHlwZW9mIGVyci5jb2RlID09PSAnc3RyaW5nJyA/IGVyci5jb2RlIDogJ2FjdGlvbl9mYWlsZWQnLCByZWRhY3QoZXJyLm1lc3NhZ2UpKVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuKHJlcXVlc3Q6IENvbW1hbmRSZXF1ZXN0KTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5kZXBzXG4gICAgY29uc3QgcCA9IHJlcXVlc3QucGFyYW1zIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZyAmIHN0cmluZ1tdICYgUmVjb3JkPHN0cmluZywgc3RyaW5nPj5cbiAgICBjb25zdCBob3N0ID0gY3R4Lm9yY2EuaG9zdFxuICAgIHN3aXRjaCAocmVxdWVzdC5raW5kKSB7XG4gICAgICBjYXNlICd0ZXJtaW5hbC5mb2N1cyc6XG4gICAgICAgIHJldHVybiBvayhhd2FpdCBob3N0LmNhbGwoJ3Rlcm1pbmFsLmZvY3VzJywgeyB0ZXJtaW5hbElkOiBwLnRlcm1pbmFsSWQgfSkpXG4gICAgICBjYXNlICd0ZXJtaW5hbC5yZWFkJzoge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob3N0LmNhbGwoJ3Rlcm1pbmFsLnJlYWQnLCB7IHRlcm1pbmFsSWQ6IHAudGVybWluYWxJZCwgbWF4TGluZXM6IDQwMCB9KVxuICAgICAgICByZXR1cm4gb2soeyBraW5kOiAnbGluZXMnLCBzb3VyY2U6ICd0ZXJtaW5hbCcsIGxpbmVzOiByZXN1bHQubGluZXMubWFwKChsaW5lKSA9PiByZWRhY3Qoc3RyaXBBbnNpKGxpbmUpKSksIHRydW5jYXRlZDogcmVzdWx0LnRydW5jYXRlZCB9KVxuICAgICAgfVxuICAgICAgY2FzZSAnYWdlbnQucmVhZE91dHB1dCc6XG4gICAgICAgIHJldHVybiBwLmJlZm9yZSA/IHRoaXMucmVhZEVhcmxpZXIocC5hZ2VudElkLCBwLmJlZm9yZSkgOiB0aGlzLnJlYWRPdXRwdXRTaW5jZShwLmFnZW50SWQsIHAuc2luY2UpXG4gICAgICBjYXNlICdhZ2VudC5wcm9tcHQnOlxuICAgICAgICByZXR1cm4gdGhpcy5wcm9tcHQocC5hZ2VudElkLCBwLnRleHQgPz8gJycsIChyZXF1ZXN0LnBhcmFtcy5hdHRhY2htZW50cyBhcyBzdHJpbmdbXSB8IHVuZGVmaW5lZCkgPz8gW10pXG4gICAgICBjYXNlICd1cGRhdGUuY2hlY2snOlxuICAgICAgICByZXR1cm4gdGhpcy5kZXBzLnVwZGF0ZXMgPyBvayhhd2FpdCB0aGlzLmRlcHMudXBkYXRlcy5jaGVjayhyZXF1ZXN0LnBhcmFtcy5mb3JjZSA9PT0gdHJ1ZSkpIDogZmFpbCgndW5zdXBwb3J0ZWQnLCAnVXBkYXRlIGNoZWNrcyBhcmUgbm90IGF2YWlsYWJsZSBoZXJlLicpXG4gICAgICBjYXNlICd1cGRhdGUucnVuJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVwcy51cGRhdGVzID8gb2soYXdhaXQgdGhpcy5kZXBzLnVwZGF0ZXMudXBkYXRlKHRoaXMuZGVwcy5jdHguY2xpKSkgOiBmYWlsKCd1bnN1cHBvcnRlZCcsICdVcGRhdGluZyBpcyBub3QgYXZhaWxhYmxlIGhlcmUuJylcbiAgICAgIGNhc2UgJ3N0YXIudmlzaXQnOlxuICAgICAgICByZXR1cm4gdGhpcy5kZXBzLnN0YXJQcm9tcHQgPyBvayhhd2FpdCB0aGlzLmRlcHMuc3RhclByb21wdC52aXNpdCgpKSA6IG9rKHsgc2hvdzogZmFsc2UgfSlcbiAgICAgIGNhc2UgJ3N0YXIuYW5zd2VyJzpcbiAgICAgICAgYXdhaXQgdGhpcy5kZXBzLnN0YXJQcm9tcHQ/LmFuc3dlcihwLmFuc3dlciBhcyBTdGFyQW5zd2VyKVxuICAgICAgICByZXR1cm4gb2soeyBzYXZlZDogdHJ1ZSB9KVxuICAgICAgY2FzZSAnYWdlbnQuYXR0YWNoJzoge1xuICAgICAgICBpZiAoIXRoaXMuZGVwcy5hdHRhY2htZW50cykgcmV0dXJuIGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ0F0dGFjaGluZyBpbWFnZXMgaXMgbm90IGF2YWlsYWJsZSBoZXJlLicpXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGVwcy5hdHRhY2htZW50cy5hcHBlbmQocC51cGxvYWRJZCwgcC5tZWRpYVR5cGUgYXMgQXR0YWNobWVudFR5cGUsIHAuY2h1bmssIE51bWJlcihwLm9mZnNldCksIHJlcXVlc3QucGFyYW1zLmRvbmUgPT09IHRydWUpXG4gICAgICAgIHJldHVybiBvayhyZXN1bHQpXG4gICAgICB9XG4gICAgICBjYXNlICdhZ2VudC5pbWFnZSc6XG4gICAgICAgIHJldHVybiB0aGlzLmltYWdlKHAuYWdlbnRJZCwgcC5yZWYsIE51bWJlcihwLm9mZnNldCA/PyAwKSlcbiAgICAgIGNhc2UgJ2FnZW50LmxhdW5jaCc6IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9zdC5jYWxsKCdhZ2VudC5sYXVuY2gnLCB7IHdvcmtzcGFjZUlkOiBwLndvcmtzcGFjZUlkLCBhZ2VudDogcC5hZ2VudCwgLi4uKHAucHJvbXB0ID8geyBwcm9tcHQ6IHAucHJvbXB0IH0gOiB7fSkgfSlcbiAgICAgICAgdGhpcy5kZXBzLm93blRlcm1pbmFscy5hZGQocmVzdWx0LnRlcm1pbmFsSWQpXG4gICAgICAgIHJldHVybiBvayhyZXN1bHQpXG4gICAgICB9XG4gICAgICBjYXNlICdhZ2VudC5yZXN1bWUnOiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvc3QuY2FsbCgnYWdlbnQucmVzdW1lJywgeyB3b3Jrc3BhY2VJZDogcC53b3Jrc3BhY2VJZCwgYWdlbnQ6IHAuYWdlbnQgYXMgbmV2ZXIsIHNlc3Npb25JZDogcC5zZXNzaW9uSWQgfSlcbiAgICAgICAgdGhpcy5kZXBzLm93blRlcm1pbmFscy5hZGQocmVzdWx0LnRlcm1pbmFsSWQpXG4gICAgICAgIHJldHVybiBvayhyZXN1bHQpXG4gICAgICB9XG4gICAgICBjYXNlICdhZ2VudC5zdG9wJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RvcEFnZW50KHAuYWdlbnRJZClcbiAgICAgIGNhc2UgJ3Rhc2suY2FuY2VsJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuY2FuY2VsVGFzayhwLnRhc2tJZCwgcC5ydW5JZClcbiAgICAgIGNhc2UgJ3Rhc2suY3JlYXRlJzpcbiAgICAgIGNhc2UgJ3Rhc2sudXBkYXRlJzpcbiAgICAgIGNhc2UgJ3Rhc2sucmV0cnknOlxuICAgICAgY2FzZSAndGFzay5kaXNwYXRjaCc6XG4gICAgICBjYXNlICdnYXRlLnJlc29sdmUnOlxuICAgICAgY2FzZSAnbWVzc2FnZS5zZW5kJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuY29vcmRpbmF0b3JDb21tYW5kKHJlcXVlc3QpXG4gICAgICBjYXNlICd3b3JrdHJlZS5jcmVhdGUnOiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvc3QuY2FsbCgnd29ya3NwYWNlLmNyZWF0ZScsIHtcbiAgICAgICAgICBwcm9qZWN0SWQ6IHAucHJvamVjdElkLFxuICAgICAgICAgIC4uLihwLm5hbWUgPyB7IG5hbWU6IHAubmFtZSB9IDoge30pLFxuICAgICAgICAgIC4uLihwLmJhc2VCcmFuY2ggPyB7IGJhc2VCcmFuY2g6IHAuYmFzZUJyYW5jaCB9IDoge30pLFxuICAgICAgICAgIC4uLihwLmFnZW50ID8geyBhZ2VudDogcC5hZ2VudCB9IDoge30pLFxuICAgICAgICAgIC4uLihwLnByb21wdCA/IHsgcHJvbXB0OiBwLnByb21wdCB9IDoge30pXG4gICAgICAgIH0pXG4gICAgICAgIGlmIChyZXN1bHQudGVybWluYWxJZCkgdGhpcy5kZXBzLm93blRlcm1pbmFscy5hZGQocmVzdWx0LnRlcm1pbmFsSWQpXG4gICAgICAgIHJldHVybiBvayhyZXN1bHQpXG4gICAgICB9XG4gICAgICBjYXNlICd3b3JrdHJlZS5vcGVuJzpcbiAgICAgICAgcmV0dXJuIG9rKGF3YWl0IGhvc3QuY2FsbCgnd29ya3NwYWNlLm9wZW4nLCB7IHdvcmtzcGFjZUlkOiBwLndvcmtzcGFjZUlkIH0pKVxuICAgICAgY2FzZSAnd29ya3RyZWUuaW5zcGVjdCc6XG4gICAgICAgIHJldHVybiB0aGlzLmluc3BlY3QocC5wYXRoKVxuICAgICAgY2FzZSAnbW9kZWwuY2hhbmdlJzpcbiAgICAgICAgcmV0dXJuIGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ09yY2EgaGFzIG5vIEFQSSB0byBjaGFuZ2UgYSBydW5uaW5nIGFnZW50XHUyMDE5cyBtb2RlbCBvciBlZmZvcnQuJylcbiAgICAgIGNhc2UgJ2xhYmVscy51cGRhdGUnOiB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnQgPSBjdHguc3RvcmUucmVhZCgpLmxhYmVsc1xuICAgICAgICBjb25zdCBuZXh0OiBMYWJlbENvbmZpZyA9IHtcbiAgICAgICAgICBhY2NvdW50VGVhbXM6IChwLmFjY291bnRUZWFtcyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkKSA/PyBjdXJyZW50LmFjY291bnRUZWFtcyxcbiAgICAgICAgICBhZ2VudFJvbGVzOiAocC5hZ2VudFJvbGVzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQpID8/IGN1cnJlbnQuYWdlbnRSb2xlcyxcbiAgICAgICAgICBsZWFkQWNjb3VudDogKHAubGVhZEFjY291bnQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/PyBjdXJyZW50LmxlYWRBY2NvdW50LFxuICAgICAgICAgIHByb2plY3ROYW1lczogKHAucHJvamVjdE5hbWVzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQpID8/IGN1cnJlbnQucHJvamVjdE5hbWVzID8/IHt9LFxuICAgICAgICAgIHByb2plY3RDb2xvcnM6IHNhbml0aXplQ29sb3JzKChwLnByb2plY3RDb2xvcnMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCkgPz8gY3VycmVudC5wcm9qZWN0Q29sb3JzID8/IHt9KSxcbiAgICAgICAgICBwcm9qZWN0UnVsZXM6IChwLnByb2plY3RSdWxlcyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkKSA/PyBjdXJyZW50LnByb2plY3RSdWxlcyA/PyB7fVxuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMuZGVwcy51cGRhdGVMYWJlbHMobmV4dClcbiAgICAgICAgcmV0dXJuIG9rKG5leHQpXG4gICAgICB9XG4gICAgICBjYXNlICdoaXN0b3J5Lmxpc3QnOlxuICAgICAgICByZXR1cm4gb2soYXdhaXQgdGhpcy5kZXBzLnBlcnNpc3RlbmNlLmxpc3RSdW5zKCkpXG4gICAgICBjYXNlICdoaXN0b3J5LmxvYWQnOiB7XG4gICAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuZGVwcy5wZXJzaXN0ZW5jZS5sb2FkUnVuKHAucnVuSWQpXG4gICAgICAgIHJldHVybiByZWNvcmQgPyBvayhyZWNvcmQpIDogZmFpbCgnbm90X2ZvdW5kJywgJ05vIHNhdmVkIGhpc3RvcnkgZm9yIHRoYXQgcnVuLicpXG4gICAgICB9XG4gICAgICBjYXNlICd2aWV3ZXIucGluZyc6XG4gICAgICAgIHJldHVybiBvayh7IGFsaXZlOiB0cnVlIH0pXG4gICAgICBjYXNlICdkYXNoYm9hcmQuaW5mbyc6XG4gICAgICAgIHJldHVybiBvayh0aGlzLmRlcHMuZGFzaGJvYXJkSW5mbygpKVxuICAgICAgY2FzZSAnZGFzaGJvYXJkLmNvbnRyb2xzJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuZGVwcy5zZXREYXNoYm9hcmRDb250cm9scyA/IG9rKGF3YWl0IHRoaXMuZGVwcy5zZXREYXNoYm9hcmRDb250cm9scyhyZXF1ZXN0LnBhcmFtcy5lbmFibGVkID09PSB0cnVlKSkgOiBmYWlsKCd1bnN1cHBvcnRlZCcsICdOb3QgYXZhaWxhYmxlLicpXG4gICAgICBjYXNlICdkYXNoYm9hcmQuZW5hYmxlJzpcbiAgICAgICAgcmV0dXJuIG9rKGF3YWl0IHRoaXMuZGVwcy5zZXREYXNoYm9hcmQocmVxdWVzdC5wYXJhbXMuZW5hYmxlZCA9PT0gdHJ1ZSkpXG4gICAgICBjYXNlICdlbnRpdHkuZGV0YWlsJzoge1xuICAgICAgICBjb25zdCB0ZXh0ID0gdGhpcy5kZXBzLmZ1bGxUZXh0KHAua2V5KVxuICAgICAgICByZXR1cm4gdGV4dCA9PT0gbnVsbCA/IGZhaWwoJ25vdF9mb3VuZCcsICdGdWxsIHRleHQgaXMgbm8gbG9uZ2VyIGNhY2hlZDsgaXQgaXMgcmVmcmVzaGVkIG9uIHRoZSBuZXh0IHBvbGwuJykgOiBvayh7IHRleHQgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogU2V2ZXJhbCBvcGVuIHZpZXdzIGFzayBmb3IgdGhlIHNhbWUgb3V0cHV0OyBzaGFyZSBvbmUgcmVhZCBmb3IgYSBmZXcgc2Vjb25kcy4gKi9cbiAgcHJpdmF0ZSBvdXRwdXRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB7IGF0OiBudW1iZXI7IHByb21pc2U6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB9PigpXG5cbiAgLyoqIExpdmUgdmlld3MgcG9sbCBldmVyeSBmZXcgc2Vjb25kczsgd2hlbiBub3RoaW5nIGNoYW5nZWQsIGFuc3dlciB3aXRoIGEgZmV3IGJ5dGVzIG9ubHkuICovXG4gIC8qKiBUaGUgdHJhbnNjcmlwdCBjaGFuZ2VkOiB0aGUgbmV4dCByZWFkIG11c3Qgbm90IGdldCB0aGUgc2hvcnQtbGl2ZWQgY2FjaGVkIGFuc3dlci4gKi9cbiAgaW52YWxpZGF0ZU91dHB1dChhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dENhY2hlLmRlbGV0ZShhZ2VudElkKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkT3V0cHV0U2luY2UoYWdlbnRJZDogc3RyaW5nLCBzaW5jZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucmVhZE91dHB1dChhZ2VudElkKVxuICAgIGlmICghc2luY2UgfHwgIXJlc3BvbnNlLm9rKSByZXR1cm4gcmVzcG9uc2VcbiAgICBjb25zdCB2ZXJzaW9uID0gKHJlc3BvbnNlLnJlc3VsdCBhcyB7IHZlcnNpb24/OiBzdHJpbmcgfSkudmVyc2lvblxuICAgIHJldHVybiB2ZXJzaW9uID09PSBzaW5jZSA/IG9rKHsgdW5jaGFuZ2VkOiB0cnVlLCB2ZXJzaW9uIH0pIDogcmVzcG9uc2VcbiAgfVxuXG4gIHByaXZhdGUgcmVhZE91dHB1dChhZ2VudElkOiBzdHJpbmcpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLm91dHB1dENhY2hlLmdldChhZ2VudElkKVxuICAgIGlmIChjYWNoZWQgJiYgbm93IC0gY2FjaGVkLmF0IDwgT1VUUFVUX0NBQ0hFX01TKSByZXR1cm4gY2FjaGVkLnByb21pc2VcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5yZWFkT3V0cHV0Tm93KGFnZW50SWQpLnRoZW4oZml0T3V0cHV0KS50aGVuKHdpdGhWZXJzaW9uKVxuICAgIHRoaXMub3V0cHV0Q2FjaGUuc2V0KGFnZW50SWQsIHsgYXQ6IG5vdywgcHJvbWlzZSB9KVxuICAgIGlmICh0aGlzLm91dHB1dENhY2hlLnNpemUgPiA1MCkgdGhpcy5vdXRwdXRDYWNoZS5kZWxldGUodGhpcy5vdXRwdXRDYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlIGFzIHN0cmluZylcbiAgICByZXR1cm4gcHJvbWlzZVxuICB9XG5cbiAgLyoqIE9sZGVyIG1lc3NhZ2VzIG9mIGEgQ2xhdWRlIHRyYW5zY3JpcHQsIHRoZSBiYXRjaCBiZWZvcmUgYGJlZm9yZWAgKGEgbWVzc2FnZSBpZCkuICovXG4gIHByaXZhdGUgYXN5bmMgcmVhZEVhcmxpZXIoYWdlbnRJZDogc3RyaW5nLCBiZWZvcmU6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgYWdlbnQgPSB0aGlzLmRlcHMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnRJZF1cbiAgICBpZiAoIWFnZW50KSByZXR1cm4gZmFpbCgnbm90X2ZvdW5kJywgJ1RoYXQgYWdlbnQgaXMgbm8gbG9uZ2VyIGtub3duLicpXG4gICAgY29uc3QgcGF0aCA9IGF3YWl0IHRoaXMuZGVwcy5jbGF1ZGVUcmFuc2NyaXB0UGF0aChhZ2VudClcbiAgICBpZiAoIXBhdGgpIHJldHVybiBmYWlsKCd1bmF2YWlsYWJsZScsICdFYXJsaWVyIG1lc3NhZ2VzIGFyZSBhdmFpbGFibGUgZm9yIENsYXVkZSBjb252ZXJzYXRpb25zIG9ubHkuJylcbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCByZWFkQ2xhdWRlVHJhbnNjcmlwdChwYXRoLCB7IGJlZm9yZUlkOiBiZWZvcmUgfSlcbiAgICByZXR1cm4gb3V0cHV0ID8gZml0T3V0cHV0KG9rKG91dHB1dCkpIDogZmFpbCgndW5hdmFpbGFibGUnLCAnQ291bGQgbm90IHJlYWQgdGhlIHRyYW5zY3JpcHQuJylcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZE91dHB1dE5vdyhhZ2VudElkOiBzdHJpbmcpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBhZ2VudCA9IGN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50SWRdXG4gICAgaWYgKCFhZ2VudCkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdUaGF0IGFnZW50IGlzIG5vIGxvbmdlciBrbm93bi4nKVxuICAgIC8vIDEuIE9yY2hlc3RyYXRpb24gd29ya2VyczogT3JjYSdzIG93biB0cmFuc2NyaXB0IC8gbGFiZWxsZWQgb3V0cHV0LlxuICAgIGlmIChhZ2VudC5kaXNwYXRjaElkICYmIGN0eC5jbGkucGF0aCkge1xuICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcmVhZFdvcmtlck91dHB1dChjdHguY2xpLCBhZ2VudC5kaXNwYXRjaElkKVxuICAgICAgaWYgKG91dHB1dCkge1xuICAgICAgICB0aGlzLmRlcHMubm90ZU91dHB1dEludGVyZXN0Py4oYWdlbnRJZClcbiAgICAgICAgcmV0dXJuIG9rKHsgLi4ub3V0cHV0LCBldmVudHM6IEJvb2xlYW4odGhpcy5kZXBzLm5vdGVPdXRwdXRJbnRlcmVzdCkgfSlcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gMi4gQ2xhdWRlIHN1YmFnZW50cyBhbmQgQ2xhdWRlIHNlc3Npb25zIChjaGF0IG9yIHRlcm1pbmFsKTogQ2xhdWRlIENvZGUncyBvd24gdHJhbnNjcmlwdCBmaWxlLlxuICAgIGNvbnN0IHRyYW5zY3JpcHQgPSBhd2FpdCB0aGlzLmRlcHMuY2xhdWRlVHJhbnNjcmlwdFBhdGgoYWdlbnQpXG4gICAgaWYgKHRyYW5zY3JpcHQpIHtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJlYWRDbGF1ZGVUcmFuc2NyaXB0KHRyYW5zY3JpcHQpXG4gICAgICAvLyBgcHVzaGA6IHRoZSB2aWV3IGhlYXJzIGFib3V0IG5ldyBtZXNzYWdlcyBhbmQgb25seSBuZWVkcyBhIHNsb3cgc2FmZXR5IHBvbGwuXG4gICAgICBpZiAob3V0cHV0KSByZXR1cm4gb2soeyAuLi5vdXRwdXQsIHB1c2g6IHRoaXMuZGVwcy53YXRjaE91dHB1dD8uKGFnZW50SWQsIHRyYW5zY3JpcHQpID8/IGZhbHNlIH0pXG4gICAgfVxuICAgIC8vIDMuIFRlcm1pbmFsIG91dHB1dC5cbiAgICBpZiAoYWdlbnQudGVybWluYWxJZCAmJiBjdHgub3JjYS5ob3N0LmhhcygndGVybWluYWwucmVhZCcpKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjdHgub3JjYS5ob3N0LmNhbGwoJ3Rlcm1pbmFsLnJlYWQnLCB7IHRlcm1pbmFsSWQ6IGFnZW50LnRlcm1pbmFsSWQsIG1heExpbmVzOiA0MDAgfSlcbiAgICAgIHRoaXMuZGVwcy5ub3RlT3V0cHV0SW50ZXJlc3Q/LihhZ2VudElkKVxuICAgICAgLy8gYGV2ZW50c2A6IHN0YXR1cyBjaGFuZ2VzIGFuZCB0b29sIGNhbGxzIGFubm91bmNlIG5ldyBvdXRwdXQ7IHBvbGxpbmcgY2FuIGJlIHNsb3dlci5cbiAgICAgIHJldHVybiBvayh7IGtpbmQ6ICdsaW5lcycsIHNvdXJjZTogJ3Rlcm1pbmFsJywgbGluZXM6IHJlc3VsdC5saW5lcy5tYXAoKGxpbmUpID0+IHJlZGFjdChzdHJpcEFuc2kobGluZSkpKSwgdHJ1bmNhdGVkOiByZXN1bHQudHJ1bmNhdGVkLCBldmVudHM6IEJvb2xlYW4odGhpcy5kZXBzLm5vdGVPdXRwdXRJbnRlcmVzdCkgfSlcbiAgICB9XG4gICAgcmV0dXJuIGZhaWwoJ3VuYXZhaWxhYmxlJywgJ09yY2EgZXhwb3NlcyBubyBvdXRwdXQgZm9yIHRoaXMgYWdlbnQuJylcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIHByb21wdCB3aGVyZSBPcmNhIGFsbG93cyBpdDogdHlwZWQgaW50byB0aGUgYWdlbnQncyB0ZXJtaW5hbCwgb3IgYXMgYW4gb3JjaGVzdHJhdGlvblxuICAgKiBtZXNzYWdlIHRvIGEgd29ya2VyIChjb29yZGluYXRvciBydWxlcyBhcHBseSkuIENoYXQgc2Vzc2lvbnMgYW5kIHN1YmFnZW50cyBoYXZlIG5vIEFQSS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcHJvbXB0KGFnZW50SWQ6IHN0cmluZywgcmF3VGV4dDogc3RyaW5nLCBhdHRhY2htZW50SWRzOiBzdHJpbmdbXSA9IFtdKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5kZXBzXG4gICAgY29uc3QgYWdlbnQgPSBjdHguc3RvcmUucmVhZCgpLmFnZW50c1thZ2VudElkXVxuICAgIGlmICghYWdlbnQpIHJldHVybiBmYWlsKCdub3RfZm91bmQnLCAnVGhhdCBhZ2VudCBpcyBubyBsb25nZXIga25vd24uJylcbiAgICBpZiAoIXJhd1RleHQudHJpbSgpICYmICFhdHRhY2htZW50SWRzLmxlbmd0aCkgcmV0dXJuIGZhaWwoJ2ludmFsaWRfcGFyYW1zJywgJ1RoZSBtZXNzYWdlIGlzIGVtcHR5LicpXG4gICAgaWYgKGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcpIHJldHVybiBmYWlsKCd1bnN1cHBvcnRlZCcsICdBIHN1YmFnZW50IG9ubHkgdGFrZXMgaXRzIGJyaWVmIGZyb20gaXRzIHBhcmVudC4gU2VuZCB5b3VyIG1lc3NhZ2UgdG8gdGhlIHBhcmVudCBhZ2VudCBpbnN0ZWFkLicpXG4gICAgLy8gQXR0YWNoZWQgaW1hZ2VzOiBvbmx5IGZpbGVzIEFnZW50IEZsb3cgaXRzZWxmIHNhdmVkIChieSBpZCksIG1lbnRpb25lZCB0aGUgd2F5IGVhY2ggcm91dGUgcmVhZHMgdGhlbS5cbiAgICBjb25zdCBwYXRoczogc3RyaW5nW10gPSBbXVxuICAgIGZvciAoY29uc3QgaWQgb2YgYXR0YWNobWVudElkcykge1xuICAgICAgY29uc3QgcGF0aCA9IHRoaXMuZGVwcy5hdHRhY2htZW50cz8ucGF0aEZvcihpZClcbiAgICAgIGlmICghcGF0aCkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdBbiBhdHRhY2hlZCBpbWFnZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlOyBhdHRhY2ggaXQgYWdhaW4uJylcbiAgICAgIHBhdGhzLnB1c2gocGF0aClcbiAgICB9XG4gICAgY29uc3Qgcm91dGUgPSBjaGF0U2Vzc2lvbklkRnJvbVBhbmVLZXkoYWdlbnQucGFuZUtleSkgJiYgIWFnZW50LnRlcm1pbmFsSWQgPyAnY2hhdCcgOiBhZ2VudC5hZ2VudCA9PT0gJ2NsYXVkZScgfHwgYWdlbnQuYWdlbnQgPT09IG51bGwgPyAnY2xhdWRlLXRlcm1pbmFsJyA6ICdvdGhlcidcbiAgICBjb25zdCB0ZXh0ID0gW3Jhd1RleHQudHJpbSgpLCAuLi5wYXRocy5tYXAoKHBhdGgpID0+IG1lbnRpb25Gb3IocGF0aCwgcm91dGUpKV0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKVxuICAgIGlmIChhZ2VudC50ZXJtaW5hbElkICYmIGN0eC5vcmNhLmhvc3QuaGFzKCd0ZXJtaW5hbC5zZW5kVGV4dCcpKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjdHgub3JjYS5ob3N0LmNhbGwoJ3Rlcm1pbmFsLnNlbmRUZXh0JywgeyB0ZXJtaW5hbElkOiBhZ2VudC50ZXJtaW5hbElkLCB0ZXh0LCBlbnRlcjogdHJ1ZSB9KVxuICAgICAgcmV0dXJuIHJlc3VsdC5hY2NlcHRlZCA/IG9rKHsgdmlhOiAndGVybWluYWwnLCBkZWxpdmVyZWQ6IHRydWUgfSkgOiBmYWlsKCdhY3Rpb25fZmFpbGVkJywgJ09yY2EgZGlkIG5vdCBhY2NlcHQgdGhlIHRleHQgZm9yIHRoYXQgdGVybWluYWwuJylcbiAgICB9XG4gICAgY29uc3QgY2hhdFNlc3Npb24gPSBjaGF0U2Vzc2lvbklkRnJvbVBhbmVLZXkoYWdlbnQucGFuZUtleSlcbiAgICBpZiAoY2hhdFNlc3Npb24pIHtcbiAgICAgIGlmICghdGhpcy5kZXBzLnNldHRpbmdzKCkuY2hhdFNlbmQgfHwgIXRoaXMuZGVwcy5zZW5kQ2hhdCkgcmV0dXJuIGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ1NlbmRpbmcgaW50byBjaGF0IHNlc3Npb25zIGlzIHR1cm5lZCBvZmYgaW4gQWdlbnQgRmxvdyBzZXR0aW5ncy4nKVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZXBzLnNlbmRDaGF0KGNoYXRTZXNzaW9uLCB0ZXh0KVxuICAgICAgICByZXR1cm4gb2soeyB2aWE6ICdjaGF0LXNlc3Npb24nLCBkZWxpdmVyZWQ6IHRydWUgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIEVycm9yICYgeyBjb2RlPzogc3RyaW5nIH1cbiAgICAgICAgcmV0dXJuIGZhaWwoZXJyLmNvZGUgPz8gJ2FjdGlvbl9mYWlsZWQnLCBgT3JjYSBkaWQgbm90IHRha2UgdGhlIG1lc3NhZ2U6ICR7cmVkYWN0KGVyci5tZXNzYWdlKX1gKVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoYWdlbnQuZGlzcGF0Y2hJZCAmJiBhZ2VudC5ydW5JZCkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNvb3JkaW5hdG9yQ29tbWFuZCh7IHJlcXVlc3RJZDogJ2ludGVybmFsLXByb21wdCcsIGtpbmQ6ICdtZXNzYWdlLnNlbmQnLCBwYXJhbXM6IHsgcnVuSWQ6IGFnZW50LnJ1bklkLCB0bzogYGRpc3BhdGNoOiR7YWdlbnQuZGlzcGF0Y2hJZH1gLCBzdWJqZWN0OiAnTWVzc2FnZSBmcm9tIEFnZW50IEZsb3cnLCBib2R5OiB0ZXh0IH0gfSlcbiAgICAgIHJldHVybiByZXNwb25zZS5vayA/IG9rKHsgdmlhOiAnb3JjaGVzdHJhdGlvbi1tZXNzYWdlJywgZGVsaXZlcmVkOiB0cnVlIH0pIDogcmVzcG9uc2VcbiAgICB9XG4gICAgcmV0dXJuIGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ09yY2EgaGFzIG5vIEFQSSBmb3IgcGx1Z2lucyB0byBzZW5kIGEgbWVzc2FnZSBpbnRvIGEgY2hhdCBzZXNzaW9uLiBPcGVuIHRoZSBzZXNzaW9uIGluIE9yY2EgYW5kIHR5cGUgdGhlcmUuJylcbiAgfVxuXG4gIC8qKiBPbmUgaW1hZ2UgZnJvbSBhIENsYXVkZSB0cmFuc2NyaXB0LCBpbiBjaHVua3MgdGhhdCBmaXQgT3JjYSdzIHBhbmVsIGFuc3dlciBsaW1pdC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBpbWFnZShhZ2VudElkOiBzdHJpbmcsIHJlZjogc3RyaW5nLCBvZmZzZXQ6IG51bWJlcik6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgYWdlbnQgPSB0aGlzLmRlcHMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnRJZF1cbiAgICBpZiAoIWFnZW50KSByZXR1cm4gZmFpbCgnbm90X2ZvdW5kJywgJ1RoYXQgYWdlbnQgaXMgbm8gbG9uZ2VyIGtub3duLicpXG4gICAgY29uc3QgcGF0aCA9IGF3YWl0IHRoaXMuZGVwcy5jbGF1ZGVUcmFuc2NyaXB0UGF0aChhZ2VudClcbiAgICBpZiAoIXBhdGgpIHJldHVybiBmYWlsKCd1bmF2YWlsYWJsZScsICdObyB0cmFuc2NyaXB0IHdpdGggaW1hZ2VzIGZvciB0aGlzIGFnZW50LicpXG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCByZWFkQ2xhdWRlSW1hZ2UocGF0aCwgcmVmKVxuICAgIGlmICghaW1hZ2UpIHJldHVybiBmYWlsKCdub3RfZm91bmQnLCAnVGhhdCBpbWFnZSBpcyBubyBsb25nZXIgaW4gdGhlIHRyYW5zY3JpcHQuJylcbiAgICBjb25zdCBjaHVuayA9IGltYWdlLmRhdGEuc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBJTUFHRV9DSFVOSylcbiAgICByZXR1cm4gb2soeyBtZWRpYVR5cGU6IGltYWdlLm1lZGlhVHlwZSwgdG90YWw6IGltYWdlLmRhdGEubGVuZ3RoLCBvZmZzZXQsIGNodW5rIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3BBZ2VudChhZ2VudElkOiBzdHJpbmcpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBhZ2VudCA9IGN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50SWRdXG4gICAgaWYgKCFhZ2VudCkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdUaGF0IGFnZW50IGlzIG5vIGxvbmdlciBrbm93bi4nKVxuICAgIGlmIChhZ2VudC5kaXNwYXRjaElkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjdHguY2xpLnJ1bihbJ29yY2hlc3RyYXRpb24nLCAnd29ya2VyLXN0b3AnLCAnLS1kaXNwYXRjaCcsIGFnZW50LmRpc3BhdGNoSWRdKVxuICAgICAgcmV0dXJuIHJlc3VsdC5vayA/IG9rKHJlc3VsdC5yZXN1bHQpIDogZmFpbChyZXN1bHQuY29kZSwgcmVzdWx0Lm1lc3NhZ2UpXG4gICAgfVxuICAgIGlmIChhZ2VudC50ZXJtaW5hbElkICYmIHRoaXMuZGVwcy5vd25UZXJtaW5hbHMuaGFzKGFnZW50LnRlcm1pbmFsSWQpICYmIGN0eC5vcmNhLmhvc3QuaGFzKCd0ZXJtaW5hbC5jbG9zZScpKSB7XG4gICAgICByZXR1cm4gb2soYXdhaXQgY3R4Lm9yY2EuaG9zdC5jYWxsKCd0ZXJtaW5hbC5jbG9zZScsIHsgdGVybWluYWxJZDogYWdlbnQudGVybWluYWxJZCB9KSlcbiAgICB9XG4gICAgcmV0dXJuIGZhaWwoJ25vdF9wZXJtaXR0ZWQnLCAnT3JjYSBsZXRzIHBsdWdpbnMgc3RvcCBvcmNoZXN0cmF0aW9uIHdvcmtlcnMgYW5kIHRlcm1pbmFscyBBZ2VudCBGbG93IG9wZW5lZC4gU3RvcCB0aGlzIGFnZW50IGZyb20gaXRzIG93biB0YWIuJylcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2FuY2VsVGFzayh0YXNrSWQ6IHN0cmluZywgcnVuSWQ6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgeyBjdHggfSA9IHRoaXMuZGVwc1xuICAgIGNvbnN0IHRhc2sgPSBjdHguc3RvcmUucmVhZCgpLnRhc2tzW3Rhc2tJZF1cbiAgICBpZiAoIXRhc2sgfHwgdGFzay5ydW5JZCAhPT0gcnVuSWQpIHJldHVybiBmYWlsKCdub3RfZm91bmQnLCAnVGhhdCB0YXNrIGlzIG5vdCBpbiB0aGlzIHJ1bi4nKVxuICAgIGNvbnN0IGxpdmUgPSB0YXNrLmRpc3BhdGNoSWRzLm1hcCgoaWQpID0+IGN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2BkaXNwYXRjaDoke2lkfWBdKS5maWx0ZXIoKGFnZW50KSA9PiBhZ2VudD8ubGl2ZSlcbiAgICBjb25zdCBzdG9wcGVkOiBzdHJpbmdbXSA9IFtdXG4gICAgZm9yIChjb25zdCBhZ2VudCBvZiBsaXZlKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjdHguY2xpLnJ1bihbJ29yY2hlc3RyYXRpb24nLCAnd29ya2VyLXN0b3AnLCAnLS1kaXNwYXRjaCcsIGFnZW50IS5kaXNwYXRjaElkIV0pXG4gICAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuIGZhaWwocmVzdWx0LmNvZGUsIGBDb3VsZCBub3Qgc3RvcCAke2FnZW50IS50aXRsZSA/PyBhZ2VudCEuZGlzcGF0Y2hJZH06ICR7cmVzdWx0Lm1lc3NhZ2V9YClcbiAgICAgIHN0b3BwZWQucHVzaChhZ2VudCEuZGlzcGF0Y2hJZCEpXG4gICAgfVxuICAgIC8vIE9yY2E6IFwiVG8gY2FuY2VsIGEgVGFzaywgc3RvcCBpdHMgd29ya2VyLCB0aGVuIHNldCAtLXN0YXR1cyBmYWlsZWQgLS1yZXN1bHQgY2FuY2VsbGVkXCIuXG4gICAgY29uc3QgdXBkYXRlID0gYXdhaXQgdGhpcy5jb29yZGluYXRvckNvbW1hbmQoeyByZXF1ZXN0SWQ6ICdpbnRlcm5hbCcsIGtpbmQ6ICd0YXNrLnVwZGF0ZScsIHBhcmFtczogeyB0YXNrSWQsIHJ1bklkLCBzdGF0dXM6ICdmYWlsZWQnLCByZXN1bHQ6ICdjYW5jZWxsZWQnIH0gfSlcbiAgICBpZiAodXBkYXRlLm9rKSByZXR1cm4gb2soeyBzdG9wcGVkLCBtYXJrZWQ6IHRydWUgfSlcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6IHVwZGF0ZS5lcnJvci5jb2RlLCBtZXNzYWdlOiBgU3RvcHBlZCAke3N0b3BwZWQubGVuZ3RofSB3b3JrZXIocykuICR7dXBkYXRlLmVycm9yLm1lc3NhZ2V9YCB9LCBtYW51YWw6IHVwZGF0ZS5tYW51YWwgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb29yZGluYXRvckNvbW1hbmQocmVxdWVzdDogQ29tbWFuZFJlcXVlc3QpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBydW5JZCA9IFN0cmluZyhyZXF1ZXN0LnBhcmFtcy5ydW5JZCA/PyAnJylcbiAgICBjb25zdCBydW4gPSBydW5JZCA/IGN0eC5zdG9yZS5yZWFkKCkucnVuc1tydW5JZF0gOiB1bmRlZmluZWRcbiAgICBjb25zdCBhcmdzID0gY29vcmRpbmF0b3JBcmdzKHJlcXVlc3QsIGN0eC5zdG9yZS5yZWFkKCkpXG4gICAgaWYgKCFhcmdzKSByZXR1cm4gZmFpbCgnaW52YWxpZF9wYXJhbXMnLCAnVGhhdCBjb21tYW5kIG5lZWRzIGEga25vd24gcnVuIGFuZCB0YXNrLicpXG4gICAgY29uc3QgZGlzcGxheSA9IGBvcmNhICR7YXJncy5tYXAoc2hlbGxRdW90ZSkuam9pbignICcpfWBcbiAgICBpZiAoIXRoaXMuZGVwcy5zZXR0aW5ncygpLmFjdEFzQ29vcmRpbmF0b3IgfHwgIXJ1bj8uY29vcmRpbmF0b3JIYW5kbGUpIHtcbiAgICAgIGNvbnN0IHJlYXNvbiA9IHJ1bj8uY29vcmRpbmF0b3JIYW5kbGVcbiAgICAgICAgPyAnT3JjYSBvbmx5IGxldHMgYSBSdW5cdTIwMTlzIGNvb3JkaW5hdG9yIGRvIHRoaXMuIFJ1biB0aGlzIGluIHRoZSBjb29yZGluYXRvciwgb3IgdHVybiBvbiBcdTIwMUNBY3QgYXMgY29vcmRpbmF0b3JcdTIwMUQgaW4gQWdlbnQgRmxvdyBzZXR0aW5ncy4nXG4gICAgICAgIDogJ09yY2Egb25seSBsZXRzIGEgUnVuXHUyMDE5cyBjb29yZGluYXRvciBkbyB0aGlzLiBUaGlzIFJ1blx1MjAxOXMgY29vcmRpbmF0b3IgaGFzIG5vIHRlcm1pbmFsIGhhbmRsZSAoaXQgaXMgYSBjaGF0IHNlc3Npb24sIG9yIE9yY2EgZGlkIG5vdCByZWNvcmQgb25lKSwgc28gcGFzdGUgdGhpcyBjb21tYW5kIGludG8gdGhlIGNvb3JkaW5hdG9yLidcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogJ2Nvb3JkaW5hdG9yX3JlcXVpcmVkJywgbWVzc2FnZTogcmVhc29uIH0sIG1hbnVhbDogeyBjb21tYW5kOiBkaXNwbGF5LCByZWFzb24gfSB9XG4gICAgfVxuICAgIC8vIE9uZSBhcmd2IGVsZW1lbnQsIGxpa2UgZXZlcnkgb3RoZXIgdmFsdWU6IGEgaGFuZGxlIGNhbiBuZXZlciBiZSByZWFkIGFzIGFub3RoZXIgZmxhZy5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjdHguY2xpLnJ1bihbLi4uYXJncywgYC0tZnJvbT0ke3J1bi5jb29yZGluYXRvckhhbmRsZX1gXSwgeyB0aW1lb3V0TXM6IDkwMDAwIH0pXG4gICAgcmV0dXJuIHJlc3VsdC5vayA/IG9rKHJlc3VsdC5yZXN1bHQpIDogeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6IHJlc3VsdC5jb2RlLCBtZXNzYWdlOiByZXN1bHQubWVzc2FnZSB9LCBtYW51YWw6IHsgY29tbWFuZDogZGlzcGxheSwgcmVhc29uOiByZXN1bHQubWVzc2FnZSB9IH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaW5zcGVjdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5kZXBzLmN0eC5zdG9yZS5yZWFkKClcbiAgICBjb25zdCBrbm93biA9IE9iamVjdC52YWx1ZXMoc3RhdGUud29ya3RyZWVzKS5zb21lKCh3KSA9PiB3LnBhdGggPT09IHBhdGgpIHx8IE9iamVjdC52YWx1ZXMoc3RhdGUuYWdlbnRzKS5zb21lKChhKSA9PiBhLndvcmt0cmVlUGF0aCA9PT0gcGF0aClcbiAgICBpZiAoIWtub3duKSByZXR1cm4gZmFpbCgnbm90X3Blcm1pdHRlZCcsICdBZ2VudCBGbG93IG9ubHkgaW5zcGVjdHMgd29ya3RyZWVzIE9yY2Ega25vd3MgYWJvdXQuJylcbiAgICByZXR1cm4gb2soYXdhaXQgaW5zcGVjdFdvcmt0cmVlKHBhdGgpKVxuICB9XG59XG5cbi8qKiBDb2xvcnMgZW5kIHVwIGluIENTUzogb25seSAjcmdiIC8gI3JyZ2diYiBzdXJ2aXZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplQ29sb3JzKGNvbG9yczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKGNvbG9ycykuZmlsdGVyKChbLCB2XSkgPT4gL14jKFswLTlhLWZdezN9fFswLTlhLWZdezZ9KSQvaS50ZXN0KHYpKSlcbn1cblxuLyoqIEtlZXBzIGEgY29udmVyc2F0aW9uIGFuc3dlciB1bmRlciBPcmNhJ3MgMSBNaUIgcGFuZWwgbGltaXQgYnkgZHJvcHBpbmcgdGhlIG9sZGVzdCBtZXNzYWdlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaXRPdXRwdXQocmVzcG9uc2U6IENvbW1hbmRSZXNwb25zZSwgYnVkZ2V0ID0gT1VUUFVUX0JVREdFVCk6IENvbW1hbmRSZXNwb25zZSB7XG4gIGlmICghcmVzcG9uc2Uub2spIHJldHVybiByZXNwb25zZVxuICBjb25zdCByZXN1bHQgPSByZXNwb25zZS5yZXN1bHQgYXMgeyBraW5kPzogc3RyaW5nOyBtZXNzYWdlcz86IHVua25vd25bXTsgdHJ1bmNhdGVkPzogYm9vbGVhbiB9XG4gIGlmIChyZXN1bHQ/LmtpbmQgIT09ICdjb252ZXJzYXRpb24nIHx8ICFBcnJheS5pc0FycmF5KHJlc3VsdC5tZXNzYWdlcykpIHJldHVybiByZXNwb25zZVxuICBsZXQgbWVzc2FnZXMgPSByZXN1bHQubWVzc2FnZXNcbiAgd2hpbGUgKG1lc3NhZ2VzLmxlbmd0aCA+IDEgJiYgQnVmZmVyLmJ5dGVMZW5ndGgoSlNPTi5zdHJpbmdpZnkoeyAuLi5yZXN1bHQsIG1lc3NhZ2VzIH0pKSA+IGJ1ZGdldCkgbWVzc2FnZXMgPSBtZXNzYWdlcy5zbGljZShNYXRoLmNlaWwobWVzc2FnZXMubGVuZ3RoIC8gOCkpXG4gIHJldHVybiBtZXNzYWdlcyA9PT0gcmVzdWx0Lm1lc3NhZ2VzID8gcmVzcG9uc2UgOiB7IG9rOiB0cnVlLCByZXN1bHQ6IHsgLi4ucmVzdWx0LCBtZXNzYWdlcywgdHJ1bmNhdGVkOiB0cnVlIH0gfVxufVxuXG4vKiogQWRkcyBhIHNob3J0IGNvbnRlbnQgaGFzaCwgc28gYSB2aWV3IGNhbiBhc2sgXCJhbnl0aGluZyBuZXcgc2luY2UgdGhpcyB2ZXJzaW9uP1wiLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhWZXJzaW9uKHJlc3BvbnNlOiBDb21tYW5kUmVzcG9uc2UpOiBDb21tYW5kUmVzcG9uc2Uge1xuICBpZiAoIXJlc3BvbnNlLm9rIHx8ICFyZXNwb25zZS5yZXN1bHQgfHwgdHlwZW9mIHJlc3BvbnNlLnJlc3VsdCAhPT0gJ29iamVjdCcpIHJldHVybiByZXNwb25zZVxuICBjb25zdCB2ZXJzaW9uID0gY3JlYXRlSGFzaCgnc2hhMScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShyZXNwb25zZS5yZXN1bHQpKS5kaWdlc3QoJ2hleCcpLnNsaWNlKDAsIDE2KVxuICByZXR1cm4geyBvazogdHJ1ZSwgcmVzdWx0OiB7IC4uLihyZXNwb25zZS5yZXN1bHQgYXMgb2JqZWN0KSwgdmVyc2lvbiB9IH1cbn1cblxuZnVuY3Rpb24gb2socmVzdWx0OiB1bmtub3duKTogQ29tbWFuZFJlc3BvbnNlIHtcbiAgcmV0dXJuIHsgb2s6IHRydWUsIHJlc3VsdCB9XG59XG5cbmZ1bmN0aW9uIGZhaWwoY29kZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcpOiBDb21tYW5kUmVzcG9uc2Uge1xuICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGUsIG1lc3NhZ2UgfSB9XG59XG4iLCAiLy8gUmVhZC1vbmx5IEdpdCBpbnNwZWN0aW9uIG9mIGEgd29ya3RyZWUgT3JjYSBhbHJlYWR5IGtub3dzIGFib3V0LiBOZXZlciB3cml0ZXMsIG1lcmdlcyBvciBwdXNoZXMuXG5pbXBvcnQgeyBleGVjRmlsZSB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IHJlZGFjdCwgdHJ1bmNhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuXG5leHBvcnQgdHlwZSBHaXRJbnNwZWN0aW9uID0ge1xuICBwYXRoOiBzdHJpbmdcbiAgYnJhbmNoOiBzdHJpbmcgfCBudWxsXG4gIGhlYWQ6IHN0cmluZyB8IG51bGxcbiAgY2hhbmdlZEZpbGVzOiB7IHN0YXR1czogc3RyaW5nOyBwYXRoOiBzdHJpbmcgfVtdXG4gIGRpZmZTdGF0OiBzdHJpbmdcbiAgY29tbWl0czogeyBoYXNoOiBzdHJpbmc7IHN1YmplY3Q6IHN0cmluZzsgYXV0aG9yOiBzdHJpbmc7IGF0OiBudW1iZXIgfVtdXG4gIGNvbmZsaWN0czogc3RyaW5nW11cbiAgYWhlYWQ6IG51bWJlciB8IG51bGxcbiAgYmVoaW5kOiBudW1iZXIgfCBudWxsXG59XG5cbmZ1bmN0aW9uIGdpdChjd2Q6IHN0cmluZywgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGV4ZWNGaWxlKCdnaXQnLCBbJy1DJywgY3dkLCAnLS1uby1vcHRpb25hbC1sb2NrcycsIC4uLmFyZ3NdLCB7IHRpbWVvdXQ6IDgwMDAsIG1heEJ1ZmZlcjogNCAqIDEwMjQgKiAxMDI0LCBlbnY6IHsgLi4ucHJvY2Vzcy5lbnYsIEdJVF9URVJNSU5BTF9QUk9NUFQ6ICcwJywgR0lUX09QVElPTkFMX0xPQ0tTOiAnMCcgfSB9LCAoZXJyb3IsIHN0ZG91dCkgPT5cbiAgICAgIGVycm9yID8gcmVqZWN0KGVycm9yKSA6IHJlc29sdmUoc3Rkb3V0KVxuICAgIClcbiAgfSlcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGluc3BlY3RXb3JrdHJlZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPEdpdEluc3BlY3Rpb24+IHtcbiAgY29uc3QgW2JyYW5jaCwgaGVhZCwgc3RhdHVzLCBkaWZmU3RhdCwgbG9nLCB1cHN0cmVhbV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgZ2l0KHBhdGgsIFsncmV2LXBhcnNlJywgJy0tYWJicmV2LXJlZicsICdIRUFEJ10pLmNhdGNoKCgpID0+ICcnKSxcbiAgICBnaXQocGF0aCwgWydyZXYtcGFyc2UnLCAnLS1zaG9ydCcsICdIRUFEJ10pLmNhdGNoKCgpID0+ICcnKSxcbiAgICBnaXQocGF0aCwgWydzdGF0dXMnLCAnLS1wb3JjZWxhaW49djEnLCAnLXVhbGwnXSkuY2F0Y2goKCkgPT4gJycpLFxuICAgIGdpdChwYXRoLCBbJ2RpZmYnLCAnLS1zdGF0JywgJ0hFQUQnXSkuY2F0Y2goKCkgPT4gJycpLFxuICAgIGdpdChwYXRoLCBbJ2xvZycsICctbicsICcyMCcsICctLWZvcm1hdD0laCV4MWYlcyV4MWYlYW4leDFmJWN0J10pLmNhdGNoKCgpID0+ICcnKSxcbiAgICBnaXQocGF0aCwgWydyZXYtbGlzdCcsICctLWxlZnQtcmlnaHQnLCAnLS1jb3VudCcsICdIRUFELi4uQHt1cHN0cmVhbX0nXSkuY2F0Y2goKCkgPT4gJycpXG4gIF0pXG4gIGNvbnN0IGNoYW5nZWRGaWxlcyA9IHN0YXR1c1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLnNsaWNlKDAsIDUwMClcbiAgICAubWFwKChsaW5lKSA9PiAoeyBzdGF0dXM6IGxpbmUuc2xpY2UoMCwgMikudHJpbSgpIHx8ICc/JywgcGF0aDogbGluZS5zbGljZSgzKSB9KSlcbiAgY29uc3QgY29uZmxpY3RzID0gY2hhbmdlZEZpbGVzLmZpbHRlcigoZmlsZSkgPT4gWydVVScsICdBQScsICdERCcsICdBVScsICdVQScsICdEVScsICdVRCddLmluY2x1ZGVzKGZpbGUuc3RhdHVzKSkubWFwKChmaWxlKSA9PiBmaWxlLnBhdGgpXG4gIGNvbnN0IGNvbW1pdHMgPSBsb2dcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLmZpbHRlcihCb29sZWFuKVxuICAgIC5tYXAoKGxpbmUpID0+IHtcbiAgICAgIGNvbnN0IFtoYXNoLCBzdWJqZWN0LCBhdXRob3IsIGN0XSA9IGxpbmUuc3BsaXQoJ1xceDFmJylcbiAgICAgIHJldHVybiB7IGhhc2gsIHN1YmplY3Q6IHJlZGFjdChzdWJqZWN0ID8/ICcnKSwgYXV0aG9yOiBhdXRob3IgPz8gJycsIGF0OiBOdW1iZXIoY3QpICogMTAwMCB9XG4gICAgfSlcbiAgY29uc3QgW2FoZWFkLCBiZWhpbmRdID0gdXBzdHJlYW0udHJpbSgpID8gdXBzdHJlYW0udHJpbSgpLnNwbGl0KC9cXHMrLykubWFwKE51bWJlcikgOiBbbnVsbCwgbnVsbF1cbiAgcmV0dXJuIHtcbiAgICBwYXRoLFxuICAgIGJyYW5jaDogYnJhbmNoLnRyaW0oKSB8fCBudWxsLFxuICAgIGhlYWQ6IGhlYWQudHJpbSgpIHx8IG51bGwsXG4gICAgY2hhbmdlZEZpbGVzLFxuICAgIGRpZmZTdGF0OiB0cnVuY2F0ZShkaWZmU3RhdC50cmltKCksIDgwMDApLFxuICAgIGNvbW1pdHMsXG4gICAgY29uZmxpY3RzLFxuICAgIGFoZWFkOiBOdW1iZXIuaXNGaW5pdGUoYWhlYWQpID8gYWhlYWQgOiBudWxsLFxuICAgIGJlaGluZDogTnVtYmVyLmlzRmluaXRlKGJlaGluZCkgPyBiZWhpbmQgOiBudWxsXG4gIH1cbn1cbiIsICIvLyBCdWlsZHMgdGhlIGV4YWN0IGBvcmNhIG9yY2hlc3RyYXRpb24gXHUyMDI2YCBhcmd1bWVudHMgZm9yIGNvb3JkaW5hdG9yLW9ubHkgYWN0aW9ucy5cbmltcG9ydCB0eXBlIHsgQ29tbWFuZFJlcXVlc3QgfSBmcm9tICcuLi8uLi9zaGFyZWQvY29tbWFuZHMudHMnXG5pbXBvcnQgdHlwZSB7IEZsb3dTdGF0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9tb2RlbC50cydcblxuLyoqXG4gKiBPcmNhJ3MgQ0xJIHBhcnNlciB0cmVhdHMgYW55IGFyZ3YgZWxlbWVudCBzdGFydGluZyB3aXRoIGAtLWAgYXMgYSBuZXcgZmxhZywgc28gYSB2YWx1ZSBpc1xuICogYWx3YXlzIHBhc3NlZCBpbiB0aGUgc2FtZSBlbGVtZW50IGFzIGl0cyBmbGFnIChgLS1zcGVjPVx1MjAyNmApLiBGcmVlIHRleHQgdGhhdCBoYXBwZW5zIHRvIHN0YXJ0XG4gKiB3aXRoIGAtLWAgY2FuIHRoZW4gbmV2ZXIgYmUgcmVhZCBhcyBhbm90aGVyIGZsYWcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmbGFnKG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgLS0ke25hbWV9PSR7dmFsdWV9YFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29vcmRpbmF0b3JBcmdzKHJlcXVlc3Q6IENvbW1hbmRSZXF1ZXN0LCBzdGF0ZTogRmxvd1N0YXRlKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3QgcCA9IHJlcXVlc3QucGFyYW1zIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbnN0IHJ1bklkID0gdHlwZW9mIHAucnVuSWQgPT09ICdzdHJpbmcnID8gcC5ydW5JZCA6IG51bGxcbiAgaWYgKCFydW5JZCB8fCAhc3RhdGUucnVuc1tydW5JZF0pIHJldHVybiBudWxsXG4gIGNvbnN0IHMgPSAoa2V5OiBzdHJpbmcpID0+ICh0eXBlb2YgcFtrZXldID09PSAnc3RyaW5nJyA/IChwW2tleV0gYXMgc3RyaW5nKSA6IG51bGwpXG4gIHN3aXRjaCAocmVxdWVzdC5raW5kKSB7XG4gICAgY2FzZSAndGFzay5jcmVhdGUnOiB7XG4gICAgICBjb25zdCBhcmdzID0gWydvcmNoZXN0cmF0aW9uJywgJ3Rhc2stY3JlYXRlJywgZmxhZygncnVuJywgcnVuSWQpLCBmbGFnKCd0YXNrLXRpdGxlJywgcygndGl0bGUnKSA/PyAnVGFzaycpLCBmbGFnKCdzcGVjJywgcygnc3BlYycpID8/ICcnKV1cbiAgICAgIGNvbnN0IGRlcHMgPSBBcnJheS5pc0FycmF5KHAuZGVwcykgPyAocC5kZXBzIGFzIHN0cmluZ1tdKSA6IFtdXG4gICAgICBpZiAoZGVwcy5sZW5ndGgpIGFyZ3MucHVzaChmbGFnKCdkZXBzJywgSlNPTi5zdHJpbmdpZnkoZGVwcykpKVxuICAgICAgaWYgKHMoJ3BhcmVudElkJykpIGFyZ3MucHVzaChmbGFnKCdwYXJlbnQnLCBzKCdwYXJlbnRJZCcpISkpXG4gICAgICByZXR1cm4gYXJnc1xuICAgIH1cbiAgICBjYXNlICd0YXNrLnVwZGF0ZSc6IHtcbiAgICAgIGNvbnN0IHRhc2tJZCA9IHMoJ3Rhc2tJZCcpXG4gICAgICBpZiAoIXRhc2tJZCB8fCBzdGF0ZS50YXNrc1t0YXNrSWRdPy5ydW5JZCAhPT0gcnVuSWQpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhcmdzID0gWydvcmNoZXN0cmF0aW9uJywgJ3Rhc2stdXBkYXRlJywgZmxhZygncnVuJywgcnVuSWQpLCBmbGFnKCdpZCcsIHRhc2tJZCksIGZsYWcoJ3N0YXR1cycsIHMoJ3N0YXR1cycpID8/ICdwZW5kaW5nJyldXG4gICAgICBpZiAocygncmVzdWx0JykpIGFyZ3MucHVzaChmbGFnKCdyZXN1bHQnLCBzKCdyZXN1bHQnKSEpKVxuICAgICAgcmV0dXJuIGFyZ3NcbiAgICB9XG4gICAgY2FzZSAndGFzay5yZXRyeSc6XG4gICAgY2FzZSAndGFzay5kaXNwYXRjaCc6IHtcbiAgICAgIGNvbnN0IHRhc2tJZCA9IHMoJ3Rhc2tJZCcpXG4gICAgICBjb25zdCB0YXNrID0gdGFza0lkID8gc3RhdGUudGFza3NbdGFza0lkXSA6IHVuZGVmaW5lZFxuICAgICAgaWYgKCF0YXNrIHx8IHRhc2sucnVuSWQgIT09IHJ1bklkKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgYXJncyA9IFsnb3JjaGVzdHJhdGlvbicsICd3b3JrZXItc3RhcnQnLCBmbGFnKCdydW4nLCBydW5JZCksIGZsYWcoJ3Rhc2snLCB0YXNrLmlkKV1cbiAgICAgIGlmIChyZXF1ZXN0LmtpbmQgPT09ICd0YXNrLnJldHJ5Jykge1xuICAgICAgICBjb25zdCBsYXN0ID0gdGFzay5kaXNwYXRjaElkc1t0YXNrLmRpc3BhdGNoSWRzLmxlbmd0aCAtIDFdXG4gICAgICAgIGlmIChsYXN0KSBhcmdzLnB1c2goZmxhZygncmV0cnktb2YnLCBsYXN0KSlcbiAgICAgIH1cbiAgICAgIGlmIChzKCdhZ2VudCcpKSBhcmdzLnB1c2goZmxhZygnYWdlbnQnLCBzKCdhZ2VudCcpISkpXG4gICAgICBpZiAocygnbW9kZWwnKSkgYXJncy5wdXNoKGZsYWcoJ21vZGVsJywgcygnbW9kZWwnKSEpKVxuICAgICAgaWYgKHMoJ21vZGVsJykgJiYgcygnZWZmb3J0JykpIGFyZ3MucHVzaChmbGFnKCdlZmZvcnQnLCBzKCdlZmZvcnQnKSEpKVxuICAgICAgYXJncy5wdXNoKGZsYWcoJ3dvcmt0cmVlJywgcygnd29ya3RyZWUnKSA/PyAnbmV3LWNoaWxkJykpXG4gICAgICByZXR1cm4gYXJnc1xuICAgIH1cbiAgICBjYXNlICdnYXRlLnJlc29sdmUnOiB7XG4gICAgICBjb25zdCBnYXRlSWQgPSBzKCdnYXRlSWQnKVxuICAgICAgaWYgKCFnYXRlSWQpIHJldHVybiBudWxsXG4gICAgICAvLyBUaGUgZ2F0ZSBtdXN0IGJlbG9uZyB0byBhIHRhc2sgb2YgdGhpcyBydW47IG90aGVyd2lzZSBhIHJ1bidzIGNvbnRyb2xzIGNvdWxkIHJlc29sdmUgYW5vdGhlciBydW4ncyBnYXRlLlxuICAgICAgY29uc3QgdGFza0lkID0gc3RhdGUuZ2F0ZXNbZ2F0ZUlkXT8udGFza0lkXG4gICAgICBpZiAoIXRhc2tJZCB8fCBzdGF0ZS50YXNrc1t0YXNrSWRdPy5ydW5JZCAhPT0gcnVuSWQpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4gWydvcmNoZXN0cmF0aW9uJywgJ2dhdGUtcmVzb2x2ZScsIGZsYWcoJ2lkJywgZ2F0ZUlkKSwgZmxhZygncmVzb2x1dGlvbicsIHMoJ3Jlc29sdXRpb24nKSA/PyAnJyldXG4gICAgfVxuICAgIGNhc2UgJ21lc3NhZ2Uuc2VuZCc6XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnb3JjaGVzdHJhdGlvbicsICdzZW5kJywgZmxhZygncnVuJywgcnVuSWQpLCBmbGFnKCd0bycsIHMoJ3RvJykgPz8gYHJ1bjoke3J1bklkfWApLFxuICAgICAgICBmbGFnKCdzdWJqZWN0Jywgcygnc3ViamVjdCcpID8/ICcnKSwgZmxhZygnYm9keScsIHMoJ2JvZHknKSA/PyAnJyksIGZsYWcoJ3R5cGUnLCAnc3RhdHVzJylcbiAgICAgIF1cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG4vKiogUE9TSVggc2hlbGwgcXVvdGluZyBmb3IgdGhlIGNvcHlhYmxlIGNvbW1hbmQgc2hvd24gdG8gdGhlIHBlcnNvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaGVsbFF1b3RlKGFyZzogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIC9eW0EtWmEtejAtOV9AJSs9OiwuLy1dKyQvLnRlc3QoYXJnKSA/IGFyZyA6IGAnJHthcmcucmVwbGFjZSgvJy9nLCBgJ1xcXFwnJ2ApfSdgXG59XG4iLCAiLy8gUmVhZHMgYSB3b3JrZXIncyBjb252ZXJzYXRpb24gd2l0aCBgb3JjYSBvcmNoZXN0cmF0aW9uIHdvcmtlci1yZWFkYCAodHJhbnNjcmlwdCB3aGVuIE9yY2EgaGFzXG4vLyBvbmUsIGxhYmVsbGVkIHRlcm1pbmFsIG91dHB1dCBvdGhlcndpc2UpIGFuZCBub3JtYWxpemVzIGl0IGZvciB0aGUgaW5zcGVjdG9yLlxuaW1wb3J0IHsgcmVkYWN0LCBzdHJpcEFuc2ksIHRydW5jYXRlIH0gZnJvbSAnLi4vLi4vc2hhcmVkL3JlZGFjdC50cydcbmltcG9ydCB0eXBlIHsgQ2xpUnVubmVyIH0gZnJvbSAnLi4vY2xpL29yY2EtY2xpLnRzJ1xuXG5leHBvcnQgdHlwZSBDb252ZXJzYXRpb25CbG9jayA9XG4gIHwgeyB0eXBlOiAndGV4dCc7IHRleHQ6IHN0cmluZyB9XG4gIHwgeyB0eXBlOiAndGhpbmtpbmcnOyB0ZXh0OiBzdHJpbmcgfVxuICB8IHsgdHlwZTogJ3Rvb2wtY2FsbCc7IG5hbWU6IHN0cmluZzsgaW5wdXQ6IHN0cmluZyB9XG4gIHwgeyB0eXBlOiAndG9vbC1yZXN1bHQnOyBvdXRwdXQ6IHN0cmluZzsgaXNFcnJvcjogYm9vbGVhbjsgaW1hZ2VzPzogSW1hZ2VSZWZbXSB9XG4gIHwgeyB0eXBlOiAnaW1hZ2UnOyBpbWFnZTogSW1hZ2VSZWYgfVxuXG4vKiogQW4gaW1hZ2Uga2VwdCBpbiB0aGUgdHJhbnNjcmlwdDsgaXRzIGJ5dGVzIGFyZSBmZXRjaGVkIG9uIGRlbWFuZCB3aXRoIGBhZ2VudC5pbWFnZWAuICovXG5leHBvcnQgdHlwZSBJbWFnZVJlZiA9IHsgcmVmOiBzdHJpbmc7IG1lZGlhVHlwZTogc3RyaW5nOyBieXRlczogbnVtYmVyIH1cblxuZXhwb3J0IHR5cGUgQ29udmVyc2F0aW9uTWVzc2FnZSA9IHsgaWQ6IHN0cmluZzsgcm9sZTogc3RyaW5nOyB0czogbnVtYmVyIHwgbnVsbDsgYmxvY2tzOiBDb252ZXJzYXRpb25CbG9ja1tdOyBtb2RlbD86IHN0cmluZyB8IG51bGw7IGVmZm9ydD86IHN0cmluZyB8IG51bGwgfVxuXG5leHBvcnQgdHlwZSBBZ2VudE91dHB1dCA9XG4gIHwgeyBraW5kOiAnY29udmVyc2F0aW9uJzsgc291cmNlOiBzdHJpbmc7IHByb3ZpZGVyOiBzdHJpbmcgfCBudWxsOyBtZXNzYWdlczogQ29udmVyc2F0aW9uTWVzc2FnZVtdOyB0cnVuY2F0ZWQ6IGJvb2xlYW4gfVxuICB8IHsga2luZDogJ2xpbmVzJzsgc291cmNlOiBzdHJpbmc7IGxpbmVzOiBzdHJpbmdbXTsgdHJ1bmNhdGVkOiBib29sZWFuIH1cblxuY29uc3QgUEFHRV9MSU1JVCA9IDEwMFxuY29uc3QgTUFYX1BBR0VTID0gOFxuY29uc3QgS0VFUF9NRVNTQUdFUyA9IDE2MFxuY29uc3QgVEVYVF9MSU1JVCA9IDQwMDBcbmNvbnN0IFRPT0xfTElNSVQgPSAxNTAwXG5cbnR5cGUgUmF3UmVhZCA9IHtcbiAgc291cmNlPzogc3RyaW5nXG4gIHByb3ZpZGVyPzogc3RyaW5nIHwgbnVsbFxuICB0cmFuc2NyaXB0PzogeyBtZXNzYWdlcz86IHVua25vd25bXTsgbmV4dEN1cnNvcj86IHN0cmluZyB8IG51bGwgfSB8IG51bGxcbiAgY3Vyc29yPzogc3RyaW5nIHwgbnVsbFxuICByb3dzPzogdW5rbm93bltdXG4gIGxpbmVzPzogdW5rbm93bltdXG4gIHRleHQ/OiBzdHJpbmdcbn1cblxuLyoqIFBhZ2VzIGZvcndhcmQgdGhyb3VnaCB0aGUgdHJhbnNjcmlwdCBhbmQga2VlcHMgdGhlIG5ld2VzdCBtZXNzYWdlcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkV29ya2VyT3V0cHV0KGNsaTogQ2xpUnVubmVyLCBkaXNwYXRjaElkOiBzdHJpbmcpOiBQcm9taXNlPEFnZW50T3V0cHV0IHwgbnVsbD4ge1xuICBjb25zdCBtZXNzYWdlczogQ29udmVyc2F0aW9uTWVzc2FnZVtdID0gW11cbiAgbGV0IGN1cnNvcjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgbGV0IGZpcnN0OiBSYXdSZWFkIHwgbnVsbCA9IG51bGxcbiAgbGV0IHRydW5jYXRlZCA9IGZhbHNlXG4gIGZvciAobGV0IHBhZ2UgPSAwOyBwYWdlIDwgTUFYX1BBR0VTOyBwYWdlKyspIHtcbiAgICBjb25zdCBhcmdzID0gWydvcmNoZXN0cmF0aW9uJywgJ3dvcmtlci1yZWFkJywgJy0tZGlzcGF0Y2gnLCBkaXNwYXRjaElkLCAnLS1saW1pdCcsIFN0cmluZyhQQUdFX0xJTUlUKSwgJy0tZnVsbCddXG4gICAgaWYgKGN1cnNvcikgYXJncy5wdXNoKCctLWN1cnNvcicsIGN1cnNvcilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGkucnVuPFJhd1JlYWQ+KGFyZ3MsIHsgdGltZW91dE1zOiAyMDAwMCB9KVxuICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICBpZiAoIWZpcnN0KSByZXR1cm4gbnVsbFxuICAgICAgYnJlYWtcbiAgICB9XG4gICAgZmlyc3QgPz89IHJlc3VsdC5yZXN1bHRcbiAgICBjb25zdCB0cmFuc2NyaXB0ID0gcmVzdWx0LnJlc3VsdC50cmFuc2NyaXB0XG4gICAgaWYgKCF0cmFuc2NyaXB0Py5tZXNzYWdlcykgYnJlYWtcbiAgICBmb3IgKGNvbnN0IHJhdyBvZiB0cmFuc2NyaXB0Lm1lc3NhZ2VzKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gbm9ybWFsaXplTWVzc2FnZShyYXcpXG4gICAgICBpZiAobWVzc2FnZSkgbWVzc2FnZXMucHVzaChtZXNzYWdlKVxuICAgIH1cbiAgICBpZiAobWVzc2FnZXMubGVuZ3RoID4gS0VFUF9NRVNTQUdFUykge1xuICAgICAgbWVzc2FnZXMuc3BsaWNlKDAsIG1lc3NhZ2VzLmxlbmd0aCAtIEtFRVBfTUVTU0FHRVMpXG4gICAgICB0cnVuY2F0ZWQgPSB0cnVlXG4gICAgfVxuICAgIGN1cnNvciA9IHRyYW5zY3JpcHQubmV4dEN1cnNvciA/PyBudWxsXG4gICAgaWYgKCFjdXJzb3IpIGJyZWFrXG4gICAgaWYgKHBhZ2UgPT09IE1BWF9QQUdFUyAtIDEpIHRydW5jYXRlZCA9IHRydWVcbiAgfVxuICBpZiAoIWZpcnN0KSByZXR1cm4gbnVsbFxuICBpZiAoZmlyc3QudHJhbnNjcmlwdCkgcmV0dXJuIHsga2luZDogJ2NvbnZlcnNhdGlvbicsIHNvdXJjZTogZmlyc3Quc291cmNlID8/ICd0cmFuc2NyaXB0JywgcHJvdmlkZXI6IGZpcnN0LnByb3ZpZGVyID8/IG51bGwsIG1lc3NhZ2VzLCB0cnVuY2F0ZWQgfVxuICByZXR1cm4geyBraW5kOiAnbGluZXMnLCBzb3VyY2U6IGZpcnN0LnNvdXJjZSA/PyAndGVybWluYWwnLCBsaW5lczogZmxhdHRlbkxpbmVzKGZpcnN0KSwgdHJ1bmNhdGVkOiBmYWxzZSB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVNZXNzYWdlKHJhdzogdW5rbm93bik6IENvbnZlcnNhdGlvbk1lc3NhZ2UgfCBudWxsIHtcbiAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcpIHJldHVybiBudWxsXG4gIGNvbnN0IG0gPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3QgYmxvY2tzOiBDb252ZXJzYXRpb25CbG9ja1tdID0gW11cbiAgY29uc3QgcmF3QmxvY2tzID0gQXJyYXkuaXNBcnJheShtLmJsb2NrcykgPyBtLmJsb2NrcyA6IHR5cGVvZiBtLnRleHQgPT09ICdzdHJpbmcnID8gW3sgdHlwZTogJ3RleHQnLCB0ZXh0OiBtLnRleHQgfV0gOiBbXVxuICBmb3IgKGNvbnN0IGIgb2YgcmF3QmxvY2tzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10pIHtcbiAgICBjb25zdCB0eXBlID0gU3RyaW5nKGI/LnR5cGUgPz8gJycpXG4gICAgaWYgKHR5cGUgPT09ICd0ZXh0JyAmJiB0eXBlb2YgYi50ZXh0ID09PSAnc3RyaW5nJykgYmxvY2tzLnB1c2goeyB0eXBlOiAndGV4dCcsIHRleHQ6IGNsZWFuKGIudGV4dCwgVEVYVF9MSU1JVCkgfSlcbiAgICBlbHNlIGlmICgodHlwZSA9PT0gJ3RoaW5raW5nJyB8fCB0eXBlID09PSAncmVhc29uaW5nJykgJiYgdHlwZW9mIGIudGV4dCA9PT0gJ3N0cmluZycpIGJsb2Nrcy5wdXNoKHsgdHlwZTogJ3RoaW5raW5nJywgdGV4dDogY2xlYW4oYi50ZXh0LCBURVhUX0xJTUlUKSB9KVxuICAgIGVsc2UgaWYgKHR5cGUgPT09ICd0b29sLWNhbGwnKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0b29sLWNhbGwnLCBuYW1lOiBTdHJpbmcoYi5uYW1lID8/ICd0b29sJyksIGlucHV0OiBjbGVhbih0eXBlb2YgYi5pbnB1dCA9PT0gJ3N0cmluZycgPyBiLmlucHV0IDogSlNPTi5zdHJpbmdpZnkoYi5pbnB1dCA/PyB7fSksIFRPT0xfTElNSVQpIH0pXG4gICAgZWxzZSBpZiAodHlwZSA9PT0gJ3Rvb2wtcmVzdWx0JykgYmxvY2tzLnB1c2goeyB0eXBlOiAndG9vbC1yZXN1bHQnLCBvdXRwdXQ6IGNsZWFuKHR5cGVvZiBiLm91dHB1dCA9PT0gJ3N0cmluZycgPyBiLm91dHB1dCA6IEpTT04uc3RyaW5naWZ5KGIub3V0cHV0ID8/ICcnKSwgVE9PTF9MSU1JVCksIGlzRXJyb3I6IGIuaXNFcnJvciA9PT0gdHJ1ZSB8fCBiLmlzX2Vycm9yID09PSB0cnVlIH0pXG4gIH1cbiAgaWYgKCFibG9ja3MubGVuZ3RoKSByZXR1cm4gbnVsbFxuICByZXR1cm4geyBpZDogU3RyaW5nKG0uaWQgPz8gTWF0aC5yYW5kb20oKSksIHJvbGU6IFN0cmluZyhtLnJvbGUgPz8gJ2Fzc2lzdGFudCcpLCB0czogdHlwZW9mIG0udGltZXN0YW1wID09PSAnbnVtYmVyJyA/IG0udGltZXN0YW1wIDogbnVsbCwgYmxvY2tzIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZsYXR0ZW5MaW5lcyhyZXN1bHQ6IFJhd1JlYWQpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSAoQXJyYXkuaXNBcnJheShyZXN1bHQucm93cykgPyByZXN1bHQucm93cyA6IEFycmF5LmlzQXJyYXkocmVzdWx0LmxpbmVzKSA/IHJlc3VsdC5saW5lcyA6IFtdKSBhcyB1bmtub3duW11cbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW11cbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGlmICh0eXBlb2Ygcm93ID09PSAnc3RyaW5nJykgbGluZXMucHVzaChyb3cpXG4gICAgZWxzZSBpZiAocm93ICYmIHR5cGVvZiByb3cgPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCByID0gcm93IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICAgICBjb25zdCB0ZXh0ID0gci50ZXh0ID8/IHIuY29udGVudCA/PyByLmxpbmUgPz8gci5tZXNzYWdlXG4gICAgICBsaW5lcy5wdXNoKHR5cGVvZiB0ZXh0ID09PSAnc3RyaW5nJyA/IHRleHQgOiBKU09OLnN0cmluZ2lmeShyb3cpKVxuICAgIH1cbiAgfVxuICBpZiAoIWxpbmVzLmxlbmd0aCAmJiB0eXBlb2YgcmVzdWx0LnRleHQgPT09ICdzdHJpbmcnKSBsaW5lcy5wdXNoKC4uLnJlc3VsdC50ZXh0LnNwbGl0KCdcXG4nKSlcbiAgcmV0dXJuIGxpbmVzLnNsaWNlKC0xMDAwKS5tYXAoKGxpbmUpID0+IGNsZWFuKGxpbmUsIFRFWFRfTElNSVQpKVxufVxuXG5mdW5jdGlvbiBjbGVhbih0ZXh0OiBzdHJpbmcsIG1heDogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJlZGFjdChzdHJpcEFuc2kodHJ1bmNhdGUodGV4dCwgbWF4KSkpXG59XG4iLCAiLy8gU2VuZHMgYSB1c2VyIG1lc3NhZ2UgaW50byBhbiBPcmNhIGNoYXQgc2Vzc2lvbiBleGFjdGx5IGFzIE9yY2EncyBvd24gY2hhdCBjb21wb3NlciBkb2VzOlxuLy8gcmVhZCB0aGUgc2Vzc2lvbidzIGN1cnJlbnQgZmVuY2UsIGZpbmdlcnByaW50IHRoZSBwYXlsb2FkLCB0aGVuIGBhZ2VudFNlc3Npb24uc2VuZGAuXG5pbXBvcnQgeyBjcmVhdGVIYXNoLCByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyBjYWxsT3JjYVJ1bnRpbWUgfSBmcm9tICcuL29yY2EtcnVudGltZS1jbGllbnQudHMnXG5cbmNvbnN0IFNUUlVDVFVSRURfUFJFRklYID0gJ3N0cnVjdHVyZWQtYWdlbnQtc2Vzc2lvbi0nXG5cbi8qKiBBIGNoYXQgdGFiJ3MgcGFuZSBrZXkgaXMgYHN0cnVjdHVyZWQtYWdlbnQtc2Vzc2lvbi08T3JjYSBzZXNzaW9uIGlkPjo8dGFiPmAuICovXG5leHBvcnQgZnVuY3Rpb24gY2hhdFNlc3Npb25JZEZyb21QYW5lS2V5KHBhbmVLZXk6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFwYW5lS2V5Py5zdGFydHNXaXRoKFNUUlVDVFVSRURfUFJFRklYKSkgcmV0dXJuIG51bGxcbiAgY29uc3QgaWQgPSBwYW5lS2V5LnNsaWNlKFNUUlVDVFVSRURfUFJFRklYLmxlbmd0aCkuc3BsaXQoJzonKVswXVxuICByZXR1cm4gL15bQS1aYS16MC05Xy1dezQsMjAwfSQvLnRlc3QoaWQpID8gaWQgOiBudWxsXG59XG5cbi8qKiBPcmNhJ3MgY2Fub25pY2FsIEpTT04gKHNvcnRlZCBrZXlzLCB1bmRlZmluZWQgZHJvcHBlZCksIG1hdGNoaW5nIGl0cyBwYXlsb2FkIGZpbmdlcnByaW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZSh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUgPz8gbnVsbClcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gYFske3ZhbHVlLm1hcChjYW5vbmljYWxpemUpLmpvaW4oJywnKX1dYFxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKVxuICAgIC5zb3J0KChbYV0sIFtiXSkgPT4gKGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwKSlcbiAgcmV0dXJuIGB7JHtlbnRyaWVzLm1hcCgoW2tleSwgZW50cnldKSA9PiBgJHtKU09OLnN0cmluZ2lmeShrZXkpfToke2Nhbm9uaWNhbGl6ZShlbnRyeSl9YCkuam9pbignLCcpfX1gXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXlsb2FkRmluZ2VycHJpbnQobWV0aG9kOiBzdHJpbmcsIHNlc3Npb25JZDogc3RyaW5nLCBmaWVsZHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShjYW5vbmljYWxpemUoeyBtZXRob2QsIHNlc3Npb25JZCwgZmllbGRzIH0pLCAndXRmOCcpLmRpZ2VzdCgnaGV4Jylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9wZXJhdGlvbklkKG5vdyA9IERhdGUubm93KCkpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7TWF0aC50cnVuYyhub3cpfS0ke3JhbmRvbVVVSUQoKS5yZXBsYWNlQWxsKCctJywgJycpLnRvTG93ZXJDYXNlKCl9YFxufVxuXG50eXBlIEhpc3RvcnlQYWdlID0geyBwYWdlPzogeyBmZW5jZT86IG51bWJlciB9IH1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlbmRDaGF0TWVzc2FnZShzZXNzaW9uSWQ6IHN0cmluZywgdGV4dDogc3RyaW5nKTogUHJvbWlzZTx7IGFjY2VwdGVkOiB0cnVlIH0+IHtcbiAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IGNhbGxPcmNhUnVudGltZTxIaXN0b3J5UGFnZT4oJ2FnZW50U2Vzc2lvbi5oaXN0b3J5JywgeyBzZXNzaW9uSWQsIGRpcmVjdGlvbjogJ3RhaWwnLCBsaW1pdDogMSB9KVxuICBjb25zdCBmZW5jZSA9IGhpc3RvcnkucGFnZT8uZmVuY2VcbiAgaWYgKHR5cGVvZiBmZW5jZSAhPT0gJ251bWJlcicpIHRocm93IG5ldyBFcnJvcignT3JjYSBkaWQgbm90IHJlcG9ydCB0aGlzIGNoYXQgc2Vzc2lvblx1MjAxOXMgc3RhdGUuJylcbiAgLy8gUXVldWUgYmVoaW5kIGEgcnVubmluZyB0dXJuLCBhcyBPcmNhJ3MgY29tcG9zZXIgZG9lcywgaW5zdGVhZCBvZiBiZWluZyByZWZ1c2VkLlxuICBjb25zdCBmaWVsZHMgPSB7IGJvZHk6IHsga2luZDogJ21lc3NhZ2UnLCByb2xlOiAndXNlcicsIGJsb2NrczogW3sgdHlwZTogJ3RleHQnLCB0ZXh0IH1dIH0sIGRlbGl2ZXJ5OiAncXVldWUtaWYtYWN0aXZlJyBhcyBjb25zdCB9XG4gIGF3YWl0IGNhbGxPcmNhUnVudGltZSgnYWdlbnRTZXNzaW9uLnNlbmQnLCB7XG4gICAgZW52ZWxvcGU6IHsgc2Vzc2lvbklkLCBjbGllbnRPcGVyYXRpb25JZDogb3BlcmF0aW9uSWQoKSwgZXhwZWN0ZWRSdW50aW1lRmVuY2U6IGZlbmNlLCBwYXlsb2FkRmluZ2VycHJpbnQ6IHBheWxvYWRGaW5nZXJwcmludCgnYWdlbnRTZXNzaW9uLnNlbmQnLCBzZXNzaW9uSWQsIGZpZWxkcykgfSxcbiAgICAuLi5maWVsZHNcbiAgfSlcbiAgcmV0dXJuIHsgYWNjZXB0ZWQ6IHRydWUgfVxufVxuIiwgIi8vIEVYUEVSSU1FTlRBTDogYSBtaW5pbWFsIGNsaWVudCBvZiBPcmNhJ3MgbG9jYWwgcnVudGltZSBSUEMsIHRoZSBzYW1lIHByaXZhdGUgVW5peCBzb2NrZXQgYW5kXG4vLyBsaW5lIHByb3RvY29sIHRoZSBgb3JjYWAgQ0xJIHVzZXMuIEl0IGV4aXN0cyBvbmx5IGJlY2F1c2UgT3JjYSdzIHBsdWdpbiBBUEkgY2Fubm90IHlldCBzZW5kIGFcbi8vIG1lc3NhZ2UgaW50byBhIGNoYXQgc2Vzc2lvbiAoc2VlIHVwc3RyZWFtL1BSLm1kIGZvciB0aGUgb2ZmaWNpYWwgQVBJIHRoaXMgc2hvdWxkIGJlY29tZSkuXG4vL1xuLy8gSGFyZCBsaW1pdHM6IG9ubHkgdGhlIG1ldGhvZHMgaW4gQUxMT1dFRCBjYW4gYmUgY2FsbGVkOyB0aGUgYXV0aCB0b2tlbiBpcyByZWFkIGZyb20gT3JjYSdzIG93blxuLy8gcnVudGltZSBtZXRhZGF0YSBmaWxlLCBrZXB0IGluIG1lbW9yeSBvbmx5LCBhbmQgbmV2ZXIgbG9nZ2VkLCByZXR1cm5lZCBvciBzZW50IGFueXdoZXJlIGVsc2UuXG4vLyBFdmVyeSBmYWlsdXJlIGlzIHJlcG9ydGVkIGFzIHN1Y2g7IG5vdGhpbmcgaXMgcmV0cmllZCBibGluZGx5LlxuaW1wb3J0IHsgY3JlYXRlQ29ubmVjdGlvbiB9IGZyb20gJ25vZGU6bmV0J1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0IHsgcmVhZEZpbGUsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgaG9tZWRpciwgcGxhdGZvcm0gfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcblxuY29uc3QgQUxMT1dFRCA9IG5ldyBTZXQoWydhZ2VudFNlc3Npb24uaGlzdG9yeScsICdhZ2VudFNlc3Npb24uc2VuZCddKVxuY29uc3QgTUFYX1JFU1BPTlNFX0JZVEVTID0gOCAqIDEwMjQgKiAxMDI0XG5jb25zdCBNRVRBREFUQV9GSUxFID0gJ29yY2EtcnVudGltZS5qc29uJ1xuXG5leHBvcnQgY2xhc3MgUnVudGltZVJwY0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICByZWFkb25seSBjb2RlOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogc3RyaW5nXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gIH1cbn1cblxudHlwZSBNZXRhZGF0YSA9IHsgYXV0aFRva2VuOiBzdHJpbmc7IHRyYW5zcG9ydHM6IHsga2luZDogc3RyaW5nOyBlbmRwb2ludDogc3RyaW5nIH1bXSB9XG5cbmV4cG9ydCBmdW5jdGlvbiBvcmNhVXNlckRhdGFEaXIoKTogc3RyaW5nIHtcbiAgY29uc3QgaG9tZSA9IGhvbWVkaXIoKVxuICBpZiAocHJvY2Vzcy5lbnYuT1JDQV9VU0VSX0RBVEFfUEFUSCkgcmV0dXJuIHByb2Nlc3MuZW52Lk9SQ0FfVVNFUl9EQVRBX1BBVEhcbiAgaWYgKHBsYXRmb3JtKCkgPT09ICdkYXJ3aW4nKSByZXR1cm4gam9pbihob21lLCAnTGlicmFyeS9BcHBsaWNhdGlvbiBTdXBwb3J0L29yY2EnKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ3dpbjMyJykgcmV0dXJuIGpvaW4ocHJvY2Vzcy5lbnYuQVBQREFUQSA/PyBqb2luKGhvbWUsICdBcHBEYXRhL1JvYW1pbmcnKSwgJ29yY2EnKVxuICByZXR1cm4gam9pbihwcm9jZXNzLmVudi5YREdfQ09ORklHX0hPTUUgPz8gam9pbihob21lLCAnLmNvbmZpZycpLCAnb3JjYScpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRNZXRhZGF0YShkaXI6IHN0cmluZyk6IFByb21pc2U8TWV0YWRhdGE+IHtcbiAgY29uc3QgcGF0aCA9IGpvaW4oZGlyLCBNRVRBREFUQV9GSUxFKVxuICB0cnkge1xuICAgIC8vIFJlZnVzZSBhIG1ldGFkYXRhIGZpbGUgb3RoZXIgdXNlcnMgY291bGQgaGF2ZSB3cml0dGVuLlxuICAgIGNvbnN0IGluZm8gPSBhd2FpdCBzdGF0KHBhdGgpXG4gICAgaWYgKHBsYXRmb3JtKCkgIT09ICd3aW4zMicgJiYgdHlwZW9mIHByb2Nlc3MuZ2V0dWlkID09PSAnZnVuY3Rpb24nICYmIGluZm8udWlkICE9PSBwcm9jZXNzLmdldHVpZCgpKSB0aHJvdyBuZXcgUnVudGltZVJwY0Vycm9yKCdydW50aW1lX3VudHJ1c3RlZCcsICdPcmNhIHJ1bnRpbWUgbWV0YWRhdGEgaXMgbm90IG93bmVkIGJ5IHRoaXMgdXNlci4nKVxuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0ZjgnKSkgYXMgUGFydGlhbDxNZXRhZGF0YT5cbiAgICBpZiAoIXBhcnNlZC5hdXRoVG9rZW4gfHwgIUFycmF5LmlzQXJyYXkocGFyc2VkLnRyYW5zcG9ydHMpKSB0aHJvdyBuZXcgUnVudGltZVJwY0Vycm9yKCdydW50aW1lX3VuYXZhaWxhYmxlJywgJ09yY2EgcnVudGltZSBtZXRhZGF0YSBpcyBpbmNvbXBsZXRlLicpXG4gICAgcmV0dXJuIHBhcnNlZCBhcyBNZXRhZGF0YVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFJ1bnRpbWVScGNFcnJvcikgdGhyb3cgZXJyb3JcbiAgICB0aHJvdyBuZXcgUnVudGltZVJwY0Vycm9yKCdydW50aW1lX3VuYXZhaWxhYmxlJywgJ0NvdWxkIG5vdCByZWFkIE9yY2EgcnVudGltZSBtZXRhZGF0YS4gSXMgT3JjYSBydW5uaW5nPycpXG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhbGxPcmNhUnVudGltZTxUPihtZXRob2Q6IHN0cmluZywgcGFyYW1zOiB1bmtub3duLCBvcHRpb25zOiB7IHRpbWVvdXRNcz86IG51bWJlcjsgdXNlckRhdGFEaXI/OiBzdHJpbmcgfSA9IHt9KTogUHJvbWlzZTxUPiB7XG4gIGlmICghQUxMT1dFRC5oYXMobWV0aG9kKSkgdGhyb3cgbmV3IFJ1bnRpbWVScGNFcnJvcignbm90X3Blcm1pdHRlZCcsIGBBZ2VudCBGbG93IGRvZXMgbm90IGNhbGwgJHttZXRob2R9LmApXG4gIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgcmVhZE1ldGFkYXRhKG9wdGlvbnMudXNlckRhdGFEaXIgPz8gb3JjYVVzZXJEYXRhRGlyKCkpXG4gIGNvbnN0IHRyYW5zcG9ydCA9IG1ldGFkYXRhLnRyYW5zcG9ydHMuZmluZCgodCkgPT4gdC5raW5kID09PSAndW5peCcgfHwgdC5raW5kID09PSAnbmFtZWQtcGlwZScpXG4gIGlmICghdHJhbnNwb3J0KSB0aHJvdyBuZXcgUnVudGltZVJwY0Vycm9yKCdydW50aW1lX3VuYXZhaWxhYmxlJywgJ09yY2EgZXhwb3NlcyBubyBsb2NhbCBydW50aW1lIHNvY2tldC4nKVxuICBjb25zdCBpZCA9IHJhbmRvbVVVSUQoKVxuICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8VD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHNvY2tldCA9IGNyZWF0ZUNvbm5lY3Rpb24odHJhbnNwb3J0LmVuZHBvaW50KVxuICAgIGxldCBidWZmZXIgPSAnJ1xuICAgIGxldCBzaXplID0gMFxuICAgIGxldCBkb25lID0gZmFsc2VcbiAgICBjb25zdCBmaW5pc2ggPSAoZm46ICgpID0+IHZvaWQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm5cbiAgICAgIGRvbmUgPSB0cnVlXG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgICBzb2NrZXQuZGVzdHJveSgpXG4gICAgICBmbigpXG4gICAgfVxuICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiBmaW5pc2goKCkgPT4gcmVqZWN0KG5ldyBSdW50aW1lUnBjRXJyb3IoJ3RpbWVvdXQnLCAnT3JjYSBkaWQgbm90IGFuc3dlciBpbiB0aW1lLicpKSksIG9wdGlvbnMudGltZW91dE1zID8/IDE1MDAwKVxuICAgIHNvY2tldC5vbignZXJyb3InLCAoKSA9PiBmaW5pc2goKCkgPT4gcmVqZWN0KG5ldyBSdW50aW1lUnBjRXJyb3IoJ3J1bnRpbWVfdW5hdmFpbGFibGUnLCAnQ291bGQgbm90IHJlYWNoIE9yY2FcdTIwMTlzIHJ1bnRpbWUuJykpKSlcbiAgICBzb2NrZXQub24oJ2RhdGEnLCAoY2h1bms6IEJ1ZmZlcikgPT4ge1xuICAgICAgc2l6ZSArPSBjaHVuay5sZW5ndGhcbiAgICAgIGlmIChzaXplID4gTUFYX1JFU1BPTlNFX0JZVEVTKSByZXR1cm4gZmluaXNoKCgpID0+IHJlamVjdChuZXcgUnVudGltZVJwY0Vycm9yKCd0b29fbGFyZ2UnLCAnT3JjYVx1MjAxOXMgYW5zd2VyIHdhcyB0b28gbGFyZ2UuJykpKVxuICAgICAgYnVmZmVyICs9IGNodW5rLnRvU3RyaW5nKCd1dGY4JylcbiAgICAgIGxldCBpbmRleDogbnVtYmVyXG4gICAgICB3aGlsZSAoKGluZGV4ID0gYnVmZmVyLmluZGV4T2YoJ1xcbicpKSA+PSAwKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBidWZmZXIuc2xpY2UoMCwgaW5kZXgpXG4gICAgICAgIGJ1ZmZlciA9IGJ1ZmZlci5zbGljZShpbmRleCArIDEpXG4gICAgICAgIGlmICghbGluZS50cmltKCkpIGNvbnRpbnVlXG4gICAgICAgIGxldCBmcmFtZTogeyBpZD86IHN0cmluZzsgb2s/OiBib29sZWFuOyByZXN1bHQ/OiBUOyBlcnJvcj86IHsgY29kZT86IHN0cmluZzsgbWVzc2FnZT86IHN0cmluZyB9OyBfa2VlcGFsaXZlPzogdW5rbm93biB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZnJhbWUgPSBKU09OLnBhcnNlKGxpbmUpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHJldHVybiBmaW5pc2goKCkgPT4gcmVqZWN0KG5ldyBSdW50aW1lUnBjRXJyb3IoJ2ludmFsaWRfcmVzcG9uc2UnLCAnT3JjYSBzZW50IGFuIHVucmVhZGFibGUgYW5zd2VyLicpKSlcbiAgICAgICAgfVxuICAgICAgICBpZiAoZnJhbWUuX2tlZXBhbGl2ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGltZXIucmVmcmVzaCgpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICBpZiAoZnJhbWUuaWQgIT09IGlkKSByZXR1cm4gZmluaXNoKCgpID0+IHJlamVjdChuZXcgUnVudGltZVJwY0Vycm9yKCdpbnZhbGlkX3Jlc3BvbnNlJywgJ09yY2EgYW5zd2VyZWQgYSBkaWZmZXJlbnQgcmVxdWVzdC4nKSkpXG4gICAgICAgIGlmIChmcmFtZS5vaykgcmV0dXJuIGZpbmlzaCgoKSA9PiByZXNvbHZlKGZyYW1lLnJlc3VsdCBhcyBUKSlcbiAgICAgICAgcmV0dXJuIGZpbmlzaCgoKSA9PiByZWplY3QobmV3IFJ1bnRpbWVScGNFcnJvcihmcmFtZS5lcnJvcj8uY29kZSA/PyAnYWN0aW9uX2ZhaWxlZCcsIGZyYW1lLmVycm9yPy5tZXNzYWdlID8/ICdPcmNhIHJlZnVzZWQgdGhlIHJlcXVlc3QuJykpKVxuICAgICAgfVxuICAgIH0pXG4gICAgc29ja2V0LndyaXRlKEpTT04uc3RyaW5naWZ5KHsgaWQsIGF1dGhUb2tlbjogbWV0YWRhdGEuYXV0aFRva2VuLCBtZXRob2QsIHBhcmFtcyB9KSArICdcXG4nKVxuICB9KVxufVxuIiwgIi8vIFJlYWRzIGEgQ2xhdWRlIENvZGUgdHJhbnNjcmlwdCAoLmpzb25sKSBpbnRvIHRoZSBpbnNwZWN0b3IncyBjb252ZXJzYXRpb24gc2hhcGUuIE9ubHkgdGhlIHRhaWxcbi8vIG9mIGxhcmdlIGZpbGVzIGlzIHJlYWQ7IGV2ZXJ5IHRleHQgaXMgcmVkYWN0ZWQgYmVmb3JlIGl0IGxlYXZlcyB0aGUgd29ya2VyLlxuaW1wb3J0IHsgb3Blbiwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyByZWRhY3RBbmRUcnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5pbXBvcnQgdHlwZSB7IEFnZW50T3V0cHV0LCBDb252ZXJzYXRpb25CbG9jaywgQ29udmVyc2F0aW9uTWVzc2FnZSwgSW1hZ2VSZWYgfSBmcm9tICcuL3RyYW5zY3JpcHQudHMnXG5cbi8qKiBHcm93aW5nIHJlYWQgd2luZG93cyBmcm9tIHRoZSBlbmQgb2YgdGhlIHRyYW5zY3JpcHQuICovXG5jb25zdCBSRUFEX1dJTkRPV1MgPSBbMyAqIDEwMjQgKiAxMDI0LCAxMiAqIDEwMjQgKiAxMDI0LCA0OCAqIDEwMjQgKiAxMDI0XVxuY29uc3QgSU1BR0VfU0NBTl9CWVRFUyA9IDI0ICogMTAyNCAqIDEwMjRcbmNvbnN0IEtFRVBfTUVTU0FHRVMgPSAxNjBcbmNvbnN0IFRFWFRfTElNSVQgPSA0MDAwXG5jb25zdCBUT09MX0xJTUlUID0gMTUwMFxuXG4vKiogV2hhdCB3YXMgbGFzdCByZWFkIGZyb20gYSB0cmFuc2NyaXB0J3MgdGFpbCwgc28gdGhlIG5leHQgcG9sbCByZWFkcyBvbmx5IHdoYXQgd2FzIGFwcGVuZGVkLiAqL1xudHlwZSBUYWlsID0geyBzaXplOiBudW1iZXI7IG10aW1lTXM6IG51bWJlcjsgZW5kOiBudW1iZXI7IG1lc3NhZ2VzOiBDb252ZXJzYXRpb25NZXNzYWdlW107IHRydW5jYXRlZDogYm9vbGVhbjsgb3V0cHV0OiBBZ2VudE91dHB1dCB9XG5jb25zdCB0YWlscyA9IG5ldyBNYXA8c3RyaW5nLCBUYWlsPigpXG5jb25zdCBNQVhfVEFJTFMgPSAyNFxuXG5mdW5jdGlvbiByZW1lbWJlcihwYXRoOiBzdHJpbmcsIHRhaWw6IFRhaWwpOiBBZ2VudE91dHB1dCB7XG4gIHRhaWxzLmRlbGV0ZShwYXRoKVxuICB0YWlscy5zZXQocGF0aCwgdGFpbClcbiAgaWYgKHRhaWxzLnNpemUgPiBNQVhfVEFJTFMpIHRhaWxzLmRlbGV0ZSh0YWlscy5rZXlzKCkubmV4dCgpLnZhbHVlIGFzIHN0cmluZylcbiAgcmV0dXJuIHRhaWwub3V0cHV0XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnNhdGlvbihtZXNzYWdlczogQ29udmVyc2F0aW9uTWVzc2FnZVtdLCB0cnVuY2F0ZWQ6IGJvb2xlYW4pOiBBZ2VudE91dHB1dCB7XG4gIHJldHVybiB7IGtpbmQ6ICdjb252ZXJzYXRpb24nLCBzb3VyY2U6ICdjbGF1ZGUgdHJhbnNjcmlwdCcsIHByb3ZpZGVyOiAnY2xhdWRlJywgbWVzc2FnZXMsIHRydW5jYXRlZCB9XG59XG5cbi8qKiBGb3JnZXRzIGNhY2hlZCB0YWlscyAodGVzdHMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyVHJhbnNjcmlwdENhY2hlKCk6IHZvaWQge1xuICB0YWlscy5jbGVhcigpXG4gIGltYWdlcy5jbGVhcigpXG4gIGltYWdlQnl0ZXMgPSAwXG59XG5cbi8qKlxuICogVGhlIG5ld2VzdCBtZXNzYWdlcywgb3Igd2l0aCBgYmVmb3JlSWRgIHRoZSBiYXRjaCBqdXN0IGJlZm9yZSB0aGF0IG1lc3NhZ2UuIFJlYWRzIGEgZ3Jvd2luZ1xuICogd2luZG93IGZyb20gdGhlIGVuZCBvZiB0aGUgZmlsZSBvbmx5IGFzIGZhciBiYWNrIGFzIG5lZWRlZCAodGhlIGZpbGUgY2FuIGJlIGh1Z2UpLiBQb2xsaW5nIHRoZVxuICogbmV3ZXN0IG1lc3NhZ2VzIGFnYWluIHJlYWRzIG9ubHkgdGhlIGJ5dGVzIGFwcGVuZGVkIHNpbmNlIHRoZSBsYXN0IGNhbGwsIGFuZCBub3RoaW5nIGF0IGFsbFxuICogKHRoZSBzYW1lIGFuc3dlciBvYmplY3QpIHdoZW4gdGhlIGZpbGUgZGlkIG5vdCBjaGFuZ2UuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkQ2xhdWRlVHJhbnNjcmlwdChwYXRoOiBzdHJpbmcsIG9wdGlvbnM6IHsgYmVmb3JlSWQ/OiBzdHJpbmcgfSA9IHt9KTogUHJvbWlzZTxBZ2VudE91dHB1dCB8IG51bGw+IHtcbiAgbGV0IGluZm86IHsgc2l6ZTogbnVtYmVyOyBtdGltZU1zOiBudW1iZXIgfVxuICB0cnkge1xuICAgIGluZm8gPSBhd2FpdCBzdGF0KHBhdGgpXG4gIH0gY2F0Y2gge1xuICAgIHRhaWxzLmRlbGV0ZShwYXRoKVxuICAgIHJldHVybiBudWxsXG4gIH1cbiAgY29uc3QgeyBzaXplLCBtdGltZU1zIH0gPSBpbmZvXG4gIGlmICghb3B0aW9ucy5iZWZvcmVJZCkge1xuICAgIGNvbnN0IHRhaWwgPSB0YWlscy5nZXQocGF0aClcbiAgICBpZiAodGFpbCAmJiB0YWlsLnNpemUgPT09IHNpemUgJiYgdGFpbC5tdGltZU1zID09PSBtdGltZU1zKSByZXR1cm4gdGFpbC5vdXRwdXRcbiAgICBpZiAodGFpbCAmJiBzaXplID4gdGFpbC5zaXplICYmIHNpemUgPj0gdGFpbC5lbmQpIHtcbiAgICAgIGNvbnN0IHJlYWQgPSBhd2FpdCByZWFkTWVzc2FnZXMocGF0aCwgdGFpbC5lbmQsIHNpemUsIGZhbHNlKVxuICAgICAgaWYgKCFyZWFkLm1lc3NhZ2VzLmxlbmd0aCkgcmV0dXJuIHJlbWVtYmVyKHBhdGgsIHsgLi4udGFpbCwgc2l6ZSwgbXRpbWVNcywgZW5kOiByZWFkLmVuZCB9KVxuICAgICAgY29uc3QgYWxsID0gWy4uLnRhaWwubWVzc2FnZXMsIC4uLnJlYWQubWVzc2FnZXNdXG4gICAgICBjb25zdCBtZXNzYWdlcyA9IGFsbC5zbGljZSgtS0VFUF9NRVNTQUdFUylcbiAgICAgIGNvbnN0IHRydW5jYXRlZCA9IHRhaWwudHJ1bmNhdGVkIHx8IGFsbC5sZW5ndGggPiBtZXNzYWdlcy5sZW5ndGhcbiAgICAgIHJldHVybiByZW1lbWJlcihwYXRoLCB7IHNpemUsIG10aW1lTXMsIGVuZDogcmVhZC5lbmQsIG1lc3NhZ2VzLCB0cnVuY2F0ZWQsIG91dHB1dDogY29udmVyc2F0aW9uKG1lc3NhZ2VzLCB0cnVuY2F0ZWQpIH0pXG4gICAgfVxuICB9XG4gIGZvciAoY29uc3Qgd2luZG93IG9mIFJFQURfV0lORE9XUykge1xuICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoMCwgc2l6ZSAtIHdpbmRvdylcbiAgICBjb25zdCByZWFkID0gYXdhaXQgcmVhZE1lc3NhZ2VzKHBhdGgsIHN0YXJ0LCBzaXplLCBzdGFydCA+IDApXG4gICAgY29uc3QgbWVzc2FnZXMgPSByZWFkLm1lc3NhZ2VzXG4gICAgbGV0IGVuZCA9IG1lc3NhZ2VzLmxlbmd0aFxuICAgIGlmIChvcHRpb25zLmJlZm9yZUlkKSB7XG4gICAgICBlbmQgPSBtZXNzYWdlcy5maW5kSW5kZXgoKG0pID0+IG0uaWQgPT09IG9wdGlvbnMuYmVmb3JlSWQpXG4gICAgICAvLyBOb3QgaW4gdGhpcyB3aW5kb3cgeWV0IChvciB0aGUgY3V0IGxpbmUgaGlkIGl0KTogcmVhZCBmdXJ0aGVyIGJhY2suXG4gICAgICBpZiAoZW5kIDwgMCkge1xuICAgICAgICBpZiAoc3RhcnQgPT09IDApIHJldHVybiBjb252ZXJzYXRpb24oW10sIGZhbHNlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgoMCwgZW5kIC0gS0VFUF9NRVNTQUdFUylcbiAgICAvLyBOb3QgZW5vdWdoIG9sZGVyIG1lc3NhZ2VzIGluIHRoaXMgd2luZG93IGFuZCB0aGUgZmlsZSBnb2VzIGZ1cnRoZXIgYmFjazogd2lkZW4gaXQuXG4gICAgaWYgKGZyb20gPT09IDAgJiYgc3RhcnQgPiAwICYmIGVuZCA8IEtFRVBfTUVTU0FHRVMgJiYgd2luZG93ICE9PSBSRUFEX1dJTkRPV1NbUkVBRF9XSU5ET1dTLmxlbmd0aCAtIDFdKSBjb250aW51ZVxuICAgIGNvbnN0IGtlcHQgPSBtZXNzYWdlcy5zbGljZShmcm9tLCBlbmQpXG4gICAgY29uc3QgdHJ1bmNhdGVkID0gZnJvbSA+IDAgfHwgc3RhcnQgPiAwXG4gICAgaWYgKG9wdGlvbnMuYmVmb3JlSWQpIHJldHVybiBjb252ZXJzYXRpb24oa2VwdCwgdHJ1bmNhdGVkKVxuICAgIHJldHVybiByZW1lbWJlcihwYXRoLCB7IHNpemUsIG10aW1lTXMsIGVuZDogcmVhZC5lbmQsIG1lc3NhZ2VzOiBrZXB0LCB0cnVuY2F0ZWQsIG91dHB1dDogY29udmVyc2F0aW9uKGtlcHQsIHRydW5jYXRlZCkgfSlcbiAgfVxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIE1lc3NhZ2VzIGluIFtzdGFydCwgc2l6ZSkuIGBlbmRgIGlzIHdoZXJlIHRoZSBuZXh0IGluY3JlbWVudGFsIHJlYWQgbXVzdCBzdGFydDoganVzdCBhZnRlciB0aGVcbiAqIGxhc3QgY29tcGxldGUgbGluZSAoYSB0cmFpbGluZyBsaW5lIHRoYXQgaXMgbm90IHZhbGlkIEpTT04geWV0IGlzIHJlYWQgYWdhaW4gbmV4dCB0aW1lKS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVhZE1lc3NhZ2VzKHBhdGg6IHN0cmluZywgc3RhcnQ6IG51bWJlciwgc2l6ZTogbnVtYmVyLCBmaXJzdExpbmVDdXQ6IGJvb2xlYW4pOiBQcm9taXNlPHsgbWVzc2FnZXM6IENvbnZlcnNhdGlvbk1lc3NhZ2VbXTsgZW5kOiBudW1iZXIgfT4ge1xuICBjb25zdCBoYW5kbGUgPSBhd2FpdCBvcGVuKHBhdGgsICdyJylcbiAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmFsbG9jKHNpemUgLSBzdGFydClcbiAgdHJ5IHtcbiAgICBhd2FpdCBoYW5kbGUucmVhZChidWZmZXIsIDAsIGJ1ZmZlci5sZW5ndGgsIHN0YXJ0KVxuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGhhbmRsZS5jbG9zZSgpXG4gIH1cbiAgY29uc3QgbGFzdE5ld2xpbmUgPSBidWZmZXIubGFzdEluZGV4T2YoMHgwYSlcbiAgY29uc3QgbGluZXMgPSBidWZmZXIudG9TdHJpbmcoJ3V0ZjgnLCAwLCBsYXN0TmV3bGluZSArIDEpLnNwbGl0KCdcXG4nKVxuICBpZiAoZmlyc3RMaW5lQ3V0KSBsaW5lcy5zaGlmdCgpIC8vIHRoZSBmaXJzdCBsaW5lIG1heSBiZSBjdXRcbiAgY29uc3QgbWVzc2FnZXM6IENvbnZlcnNhdGlvbk1lc3NhZ2VbXSA9IFtdXG4gIGNvbnN0IHRha2UgPSAobGluZTogc3RyaW5nKTogYm9vbGVhbiA9PiB7XG4gICAgaWYgKCFsaW5lLnRyaW0oKSkgcmV0dXJuIHRydWVcbiAgICB0cnkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IHRvTWVzc2FnZShKU09OLnBhcnNlKGxpbmUpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgaWYgKG1lc3NhZ2UpIG1lc3NhZ2VzLnB1c2gobWVzc2FnZSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2UgLy8gcGFydGlhbCBsaW5lXG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykgdGFrZShsaW5lKVxuICBsZXQgZW5kID0gc3RhcnQgKyBsYXN0TmV3bGluZSArIDFcbiAgLy8gQSBjb21wbGV0ZSBsYXN0IGVudHJ5IHdpdGhvdXQgaXRzIG5ld2xpbmUgeWV0IHN0aWxsIGNvdW50cy5cbiAgY29uc3QgcmVzdCA9IGJ1ZmZlci50b1N0cmluZygndXRmOCcsIGxhc3ROZXdsaW5lICsgMSlcbiAgaWYgKHJlc3QudHJpbSgpICYmICEoZmlyc3RMaW5lQ3V0ICYmIGxhc3ROZXdsaW5lIDwgMCkgJiYgdGFrZShyZXN0KSkgZW5kID0gc2l6ZVxuICByZXR1cm4geyBtZXNzYWdlcywgZW5kIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvTWVzc2FnZShlbnRyeTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBDb252ZXJzYXRpb25NZXNzYWdlIHwgbnVsbCB7XG4gIGlmIChlbnRyeS50eXBlICE9PSAndXNlcicgJiYgZW50cnkudHlwZSAhPT0gJ2Fzc2lzdGFudCcpIHJldHVybiBudWxsXG4gIGNvbnN0IG1lc3NhZ2UgPSBlbnRyeS5tZXNzYWdlIGFzIHsgcm9sZT86IHN0cmluZzsgY29udGVudD86IHVua25vd24gfSB8IHVuZGVmaW5lZFxuICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxsXG4gIGNvbnN0IGJsb2NrczogQ29udmVyc2F0aW9uQmxvY2tbXSA9IFtdXG4gIGNvbnN0IGNvbnRlbnQgPSBtZXNzYWdlLmNvbnRlbnRcbiAgaWYgKHR5cGVvZiBjb250ZW50ID09PSAnc3RyaW5nJykgYmxvY2tzLnB1c2goeyB0eXBlOiAndGV4dCcsIHRleHQ6IHJlZGFjdEFuZFRydW5jYXRlKGNvbnRlbnQsIFRFWFRfTElNSVQpIH0pXG4gIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoY29udGVudCkpIHtcbiAgICA7KGNvbnRlbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSkuZm9yRWFjaCgocmF3LCBpbmRleCkgPT4ge1xuICAgICAgc3dpdGNoIChyYXc/LnR5cGUpIHtcbiAgICAgICAgY2FzZSAnaW1hZ2UnOiB7XG4gICAgICAgICAgY29uc3QgaW1hZ2UgPSBpbWFnZVJlZihyYXcsIGAke2VudHJ5LnV1aWR9fCR7aW5kZXh9YClcbiAgICAgICAgICBpZiAoaW1hZ2UpIGJsb2Nrcy5wdXNoKHsgdHlwZTogJ2ltYWdlJywgaW1hZ2UgfSlcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJ3RleHQnOlxuICAgICAgICAgIGlmICh0eXBlb2YgcmF3LnRleHQgPT09ICdzdHJpbmcnICYmIHJhdy50ZXh0LnRyaW0oKSkgYmxvY2tzLnB1c2goeyB0eXBlOiAndGV4dCcsIHRleHQ6IHJlZGFjdEFuZFRydW5jYXRlKHJhdy50ZXh0LCBURVhUX0xJTUlUKSB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3RoaW5raW5nJzpcbiAgICAgICAgICBpZiAodHlwZW9mIHJhdy50aGlua2luZyA9PT0gJ3N0cmluZycgJiYgcmF3LnRoaW5raW5nLnRyaW0oKSkgYmxvY2tzLnB1c2goeyB0eXBlOiAndGhpbmtpbmcnLCB0ZXh0OiByZWRhY3RBbmRUcnVuY2F0ZShyYXcudGhpbmtpbmcsIFRFWFRfTElNSVQpIH0pXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAndG9vbF91c2UnOlxuICAgICAgICAgIGJsb2Nrcy5wdXNoKHsgdHlwZTogJ3Rvb2wtY2FsbCcsIG5hbWU6IFN0cmluZyhyYXcubmFtZSA/PyAndG9vbCcpLCBpbnB1dDogcmVkYWN0QW5kVHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkocmF3LmlucHV0ID8/IHt9KSwgVE9PTF9MSU1JVCkgfSlcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICd0b29sX3Jlc3VsdCc6IHtcbiAgICAgICAgICBjb25zdCBwYXJ0cyA9IEFycmF5LmlzQXJyYXkocmF3LmNvbnRlbnQpID8gKHJhdy5jb250ZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10pIDogbnVsbFxuICAgICAgICAgIGNvbnN0IG91dCA9IHR5cGVvZiByYXcuY29udGVudCA9PT0gJ3N0cmluZycgPyByYXcuY29udGVudCA6IHBhcnRzID8gcGFydHMubWFwKChjKSA9PiAodHlwZW9mIGM/LnRleHQgPT09ICdzdHJpbmcnID8gYy50ZXh0IDogJycpKS5maWx0ZXIoQm9vbGVhbikuam9pbignXFxuJykgOiBKU09OLnN0cmluZ2lmeShyYXcuY29udGVudCA/PyAnJylcbiAgICAgICAgICAvLyBTY3JlZW5zaG90cyBhbmQgb3RoZXIgaW1hZ2VzIGEgdG9vbCByZXR1cm5lZC5cbiAgICAgICAgICBjb25zdCBpbWFnZXMgPSBwYXJ0cyA/IHBhcnRzLm1hcCgoYywgaikgPT4gKGM/LnR5cGUgPT09ICdpbWFnZScgPyBpbWFnZVJlZihjLCBgJHtlbnRyeS51dWlkfXwke2luZGV4fXwke2p9YCkgOiBudWxsKSkuZmlsdGVyKCh4KTogeCBpcyBJbWFnZVJlZiA9PiBCb29sZWFuKHgpKSA6IFtdXG4gICAgICAgICAgYmxvY2tzLnB1c2goeyB0eXBlOiAndG9vbC1yZXN1bHQnLCBvdXRwdXQ6IHJlZGFjdEFuZFRydW5jYXRlKG91dCwgVE9PTF9MSU1JVCksIGlzRXJyb3I6IHJhdy5pc19lcnJvciA9PT0gdHJ1ZSwgLi4uKGltYWdlcy5sZW5ndGggPyB7IGltYWdlcyB9IDoge30pIH0pXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cbiAgaWYgKCFibG9ja3MubGVuZ3RoKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cyA9IHR5cGVvZiBlbnRyeS50aW1lc3RhbXAgPT09ICdzdHJpbmcnID8gRGF0ZS5wYXJzZShlbnRyeS50aW1lc3RhbXApIDogTmFOXG4gIGNvbnN0IHJhd01vZGVsID0gKG1lc3NhZ2UgYXMgeyBtb2RlbD86IHVua25vd24gfSkubW9kZWxcbiAgY29uc3QgbW9kZWwgPSBlbnRyeS50eXBlID09PSAnYXNzaXN0YW50JyAmJiB0eXBlb2YgcmF3TW9kZWwgPT09ICdzdHJpbmcnICYmIHJhd01vZGVsICE9PSAnPHN5bnRoZXRpYz4nID8gcmF3TW9kZWwgOiBudWxsXG4gIGNvbnN0IGVmZm9ydCA9IHR5cGVvZiBlbnRyeS5wZXJUdXJuRWZmb3J0ID09PSAnc3RyaW5nJyA/IGVudHJ5LnBlclR1cm5FZmZvcnQgOiB0eXBlb2YgZW50cnkuZWZmb3J0ID09PSAnc3RyaW5nJyA/IGVudHJ5LmVmZm9ydCA6IG51bGxcbiAgcmV0dXJuIHsgaWQ6IFN0cmluZyhlbnRyeS51dWlkID8/IE1hdGgucmFuZG9tKCkpLCByb2xlOiBtZXNzYWdlLnJvbGUgPz8gU3RyaW5nKGVudHJ5LnR5cGUpLCB0czogTnVtYmVyLmlzRmluaXRlKHRzKSA/IHRzIDogbnVsbCwgYmxvY2tzLCAuLi4obW9kZWwgPyB7IG1vZGVsLCBlZmZvcnQgfSA6IHt9KSB9XG59XG5cbmNvbnN0IElNQUdFX1RZUEVTID0gbmV3IFNldChbJ2ltYWdlL3BuZycsICdpbWFnZS9qcGVnJywgJ2ltYWdlL2dpZicsICdpbWFnZS93ZWJwJ10pXG5cbmZ1bmN0aW9uIGltYWdlUmVmKHJhdzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHJlZjogc3RyaW5nKTogSW1hZ2VSZWYgfCBudWxsIHtcbiAgY29uc3Qgc291cmNlID0gcmF3LnNvdXJjZSBhcyB7IHR5cGU/OiBzdHJpbmc7IG1lZGlhX3R5cGU/OiBzdHJpbmc7IGRhdGE/OiBzdHJpbmcgfSB8IHVuZGVmaW5lZFxuICBpZiAoc291cmNlPy50eXBlICE9PSAnYmFzZTY0JyB8fCB0eXBlb2Ygc291cmNlLmRhdGEgIT09ICdzdHJpbmcnIHx8ICFJTUFHRV9UWVBFUy5oYXMoc291cmNlLm1lZGlhX3R5cGUgPz8gJycpKSByZXR1cm4gbnVsbFxuICByZXR1cm4geyByZWYsIG1lZGlhVHlwZTogc291cmNlLm1lZGlhX3R5cGUhLCBieXRlczogTWF0aC5mbG9vcigoc291cmNlLmRhdGEubGVuZ3RoICogMykgLyA0KSB9XG59XG5cbi8qKiBSZWNlbnRseSBvcGVuZWQgaW1hZ2VzLCBzbyB0aGUgY2h1bmtlZCB0cmFuc2ZlciBvZiBvbmUgaW1hZ2Ugc2NhbnMgdGhlIGZpbGUgb25seSBvbmNlLiAqL1xuY29uc3QgaW1hZ2VzID0gbmV3IE1hcDxzdHJpbmcsIHsgbWVkaWFUeXBlOiBzdHJpbmc7IGRhdGE6IHN0cmluZyB9PigpXG5sZXQgaW1hZ2VCeXRlcyA9IDBcbmNvbnN0IElNQUdFX0NBQ0hFX0JZVEVTID0gMjQgKiAxMDI0ICogMTAyNFxuXG5mdW5jdGlvbiBjYWNoZUltYWdlKGtleTogc3RyaW5nLCBpbWFnZTogeyBtZWRpYVR5cGU6IHN0cmluZzsgZGF0YTogc3RyaW5nIH0pOiB2b2lkIHtcbiAgaW1hZ2VzLnNldChrZXksIGltYWdlKVxuICBpbWFnZUJ5dGVzICs9IGltYWdlLmRhdGEubGVuZ3RoXG4gIHdoaWxlIChpbWFnZUJ5dGVzID4gSU1BR0VfQ0FDSEVfQllURVMgJiYgaW1hZ2VzLnNpemUgPiAxKSB7XG4gICAgY29uc3QgW29sZGVzdCwgdmFsdWVdID0gaW1hZ2VzLmVudHJpZXMoKS5uZXh0KCkudmFsdWUgYXMgW3N0cmluZywgeyBkYXRhOiBzdHJpbmcgfV1cbiAgICBpbWFnZXMuZGVsZXRlKG9sZGVzdClcbiAgICBpbWFnZUJ5dGVzIC09IHZhbHVlLmRhdGEubGVuZ3RoXG4gIH1cbn1cblxuLyoqIFRoZSBiYXNlNjQgZGF0YSBvZiBvbmUgaW1hZ2UsIGZvdW5kIGJ5IGl0cyByZWYgKGA8ZW50cnkgdXVpZD58PGJsb2NrPlt8PHRvb2wtcmVzdWx0IHBhcnQ+XWApLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRDbGF1ZGVJbWFnZShwYXRoOiBzdHJpbmcsIHJlZjogc3RyaW5nKTogUHJvbWlzZTx7IG1lZGlhVHlwZTogc3RyaW5nOyBkYXRhOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgY29uc3QgW3V1aWQsIGJsb2NrVGV4dCwgcGFydFRleHRdID0gcmVmLnNwbGl0KCd8JylcbiAgaWYgKCF1dWlkIHx8IGJsb2NrVGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCBrZXkgPSBgJHtwYXRofVxcMCR7cmVmfWBcbiAgY29uc3QgY2FjaGVkID0gaW1hZ2VzLmdldChrZXkpXG4gIGlmIChjYWNoZWQpIHJldHVybiBjYWNoZWRcbiAgY29uc3QgaGFuZGxlID0gYXdhaXQgb3BlbihwYXRoLCAncicpXG4gIGxldCBidWZmZXI6IEJ1ZmZlclxuICB0cnkge1xuICAgIGNvbnN0IHNpemUgPSAoYXdhaXQgaGFuZGxlLnN0YXQoKSkuc2l6ZVxuICAgIC8vIEltYWdlcyBjYW4gc2l0IGZ1cnRoZXIgYmFjayB0aGFuIHRoZSBjb252ZXJzYXRpb24gdGFpbDsgcmVhZCBtb3JlLCBzdGlsbCBib3VuZGVkLlxuICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoMCwgc2l6ZSAtIElNQUdFX1NDQU5fQllURVMpXG4gICAgYnVmZmVyID0gQnVmZmVyLmFsbG9jKHNpemUgLSBzdGFydClcbiAgICBhd2FpdCBoYW5kbGUucmVhZChidWZmZXIsIDAsIGJ1ZmZlci5sZW5ndGgsIHN0YXJ0KVxuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGhhbmRsZS5jbG9zZSgpXG4gIH1cbiAgLy8gU2VhcmNoIHRoZSByYXcgYnl0ZXMgYW5kIGRlY29kZSBvbmx5IHRoZSBsaW5lcyB0aGF0IG1lbnRpb24gdGhpcyBlbnRyeS5cbiAgY29uc3QgbmVlZGxlID0gQnVmZmVyLmZyb20odXVpZClcbiAgZm9yIChsZXQgYXQgPSBidWZmZXIuaW5kZXhPZihuZWVkbGUpOyBhdCA+PSAwOyBhdCA9IGJ1ZmZlci5pbmRleE9mKG5lZWRsZSwgYXQgKyBuZWVkbGUubGVuZ3RoKSkge1xuICAgIGNvbnN0IGxpbmVTdGFydCA9IGJ1ZmZlci5sYXN0SW5kZXhPZigweDBhLCBhdCkgKyAxXG4gICAgY29uc3QgbmV3bGluZSA9IGJ1ZmZlci5pbmRleE9mKDB4MGEsIGF0KVxuICAgIGNvbnN0IGxpbmVFbmQgPSBuZXdsaW5lIDwgMCA/IGJ1ZmZlci5sZW5ndGggOiBuZXdsaW5lXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gSlNPTi5wYXJzZShidWZmZXIudG9TdHJpbmcoJ3V0ZjgnLCBsaW5lU3RhcnQsIGxpbmVFbmQpKSBhcyB7IHV1aWQ/OiBzdHJpbmc7IG1lc3NhZ2U/OiB7IGNvbnRlbnQ/OiB1bmtub3duIH0gfVxuICAgICAgaWYgKGVudHJ5LnV1aWQgIT09IHV1aWQgfHwgIUFycmF5LmlzQXJyYXkoZW50cnkubWVzc2FnZT8uY29udGVudCkpIGNvbnRpbnVlXG4gICAgICBsZXQgYmxvY2sgPSAoZW50cnkubWVzc2FnZSEuY29udGVudCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdKVtOdW1iZXIoYmxvY2tUZXh0KV1cbiAgICAgIGlmIChwYXJ0VGV4dCAhPT0gdW5kZWZpbmVkKSBibG9jayA9IChBcnJheS5pc0FycmF5KGJsb2NrPy5jb250ZW50KSA/IChibG9jay5jb250ZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10pIDogW10pW051bWJlcihwYXJ0VGV4dCldXG4gICAgICBjb25zdCBzb3VyY2UgPSBibG9jaz8uc291cmNlIGFzIHsgdHlwZT86IHN0cmluZzsgbWVkaWFfdHlwZT86IHN0cmluZzsgZGF0YT86IHN0cmluZyB9IHwgdW5kZWZpbmVkXG4gICAgICBpZiAoc291cmNlPy50eXBlID09PSAnYmFzZTY0JyAmJiB0eXBlb2Ygc291cmNlLmRhdGEgPT09ICdzdHJpbmcnICYmIElNQUdFX1RZUEVTLmhhcyhzb3VyY2UubWVkaWFfdHlwZSA/PyAnJykpIHtcbiAgICAgICAgY29uc3QgaW1hZ2UgPSB7IG1lZGlhVHlwZTogc291cmNlLm1lZGlhX3R5cGUhLCBkYXRhOiBzb3VyY2UuZGF0YSB9XG4gICAgICAgIGNhY2hlSW1hZ2Uoa2V5LCBpbWFnZSlcbiAgICAgICAgcmV0dXJuIGltYWdlXG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBwYXJ0aWFsIGxpbmVcbiAgICB9XG4gICAgYXQgPSBNYXRoLm1heChhdCwgbGluZUVuZCAtIG5lZWRsZS5sZW5ndGgpXG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cbiIsICIvLyBEYXNoYm9hcmQgYWNjZXNzIHRva2VuOiByYW5kb20sIHN0b3JlZCBpbiBPcmNhJ3MgZW5jcnlwdGVkIHBsdWdpbiBzZWNyZXRzIHdoZW4gdGhlIE9TIGtleXJpbmdcbi8vIGlzIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGluIGEgMDYwMCBmaWxlIGluIHRoZSBwbHVnaW4ncyBvd24gc3RhdGUgZm9sZGVyLlxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMsIHRpbWluZ1NhZmVFcXVhbCB9IGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0IHsgY2htb2QsIG1rZGlyLCByZWFkRmlsZSwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgdHlwZSB7IE9yY2FXb3JrZXJBcGkgfSBmcm9tICdvcmNhL3dvcmtlcidcblxudHlwZSBTZWNyZXRzQXBpID0gT3JjYVdvcmtlckFwaVsnc2VjcmV0cyddXG5cbmNvbnN0IFNFQ1JFVF9LRVkgPSAnZGFzaGJvYXJkVG9rZW4nXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkT3JDcmVhdGVUb2tlbihzZWNyZXRzOiBTZWNyZXRzQXBpIHwgdW5kZWZpbmVkLCBwcm90ZWN0aW9uOiBzdHJpbmcsIGRpcjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSB1c2VLZXlyaW5nKHNlY3JldHMsIHByb3RlY3Rpb24pID8gYXdhaXQgc2VjcmV0cyEuZ2V0KFNFQ1JFVF9LRVkpLmNhdGNoKCgpID0+IG51bGwpIDogYXdhaXQgcmVhZFRva2VuRmlsZShkaXIpXG4gIGlmIChleGlzdGluZyAmJiBleGlzdGluZy5sZW5ndGggPj0gMzIpIHJldHVybiBleGlzdGluZ1xuICByZXR1cm4gc3RvcmVUb2tlbihzZWNyZXRzLCBwcm90ZWN0aW9uLCBkaXIsIG5ld1Rva2VuKCkpXG59XG5cbi8qKiBBbHdheXMgcmVwbGFjZXMgdGhlIHN0b3JlZCB0b2tlbiB3aXRoIGEgZnJlc2ggb25lIChlLmcuIHdoZW4gZGFzaGJvYXJkIGNvbnRyb2xzIGFyZSB0dXJuZWQgb24pLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvdGF0ZVRva2VuKHNlY3JldHM6IFNlY3JldHNBcGkgfCB1bmRlZmluZWQsIHByb3RlY3Rpb246IHN0cmluZywgZGlyOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gc3RvcmVUb2tlbihzZWNyZXRzLCBwcm90ZWN0aW9uLCBkaXIsIG5ld1Rva2VuKCkpXG59XG5cbmZ1bmN0aW9uIHVzZUtleXJpbmcoc2VjcmV0czogU2VjcmV0c0FwaSB8IHVuZGVmaW5lZCwgcHJvdGVjdGlvbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBCb29sZWFuKHNlY3JldHMpICYmIHByb3RlY3Rpb24gPT09ICdvcy1rZXlyaW5nJ1xufVxuXG5mdW5jdGlvbiB0b2tlbkZpbGUoZGlyOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gam9pbihkaXIsICdkYXNoYm9hcmQtdG9rZW4nKVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkVG9rZW5GaWxlKGRpcjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIChhd2FpdCByZWFkRmlsZSh0b2tlbkZpbGUoZGlyKSwgJ3V0ZjgnKSkudHJpbSgpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RvcmVUb2tlbihzZWNyZXRzOiBTZWNyZXRzQXBpIHwgdW5kZWZpbmVkLCBwcm90ZWN0aW9uOiBzdHJpbmcsIGRpcjogc3RyaW5nLCB0b2tlbjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgaWYgKHVzZUtleXJpbmcoc2VjcmV0cywgcHJvdGVjdGlvbikpIHtcbiAgICBhd2FpdCBzZWNyZXRzIS5zZXQoU0VDUkVUX0tFWSwgdG9rZW4pXG4gICAgcmV0dXJuIHRva2VuXG4gIH1cbiAgYXdhaXQgbWtkaXIoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgbW9kZTogMG83MDAgfSlcbiAgYXdhaXQgd3JpdGVGaWxlKHRva2VuRmlsZShkaXIpLCB0b2tlbiwgeyBtb2RlOiAwbzYwMCB9KVxuICAvLyB3cml0ZUZpbGUncyBtb2RlIG9ubHkgYXBwbGllcyBvbiBjcmVhdGU7IG1ha2Ugc3VyZSBhbiBleGlzdGluZyBmaWxlIGlzIDA2MDAgdG9vLlxuICBhd2FpdCBjaG1vZCh0b2tlbkZpbGUoZGlyKSwgMG82MDApXG4gIHJldHVybiB0b2tlblxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3VG9rZW4oKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJhbmRvbUJ5dGVzKDMyKS50b1N0cmluZygnaGV4Jylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRva2Vuc01hdGNoKGV4cGVjdGVkOiBzdHJpbmcsIGdpdmVuOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogYm9vbGVhbiB7XG4gIGlmICghZ2l2ZW4pIHJldHVybiBmYWxzZVxuICBjb25zdCBhID0gQnVmZmVyLmZyb20oZXhwZWN0ZWQpXG4gIGNvbnN0IGIgPSBCdWZmZXIuZnJvbShnaXZlbilcbiAgcmV0dXJuIGEubGVuZ3RoID09PSBiLmxlbmd0aCAmJiB0aW1pbmdTYWZlRXF1YWwoYSwgYilcbn1cblxuLyoqIEROUy1yZWJpbmRpbmcgZ3VhcmQ6IG9ubHkgbG9vcGJhY2sgaG9zdCBuYW1lcyB3aXRoIG91ciBwb3J0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhvc3RBbGxvd2VkKGhvc3RIZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCwgcG9ydDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICghaG9zdEhlYWRlcikgcmV0dXJuIGZhbHNlXG4gIHJldHVybiBob3N0SGVhZGVyID09PSBgMTI3LjAuMC4xOiR7cG9ydH1gIHx8IGhvc3RIZWFkZXIgPT09IGBsb2NhbGhvc3Q6JHtwb3J0fWAgfHwgaG9zdEhlYWRlciA9PT0gYFs6OjFdOiR7cG9ydH1gXG59XG4iLCAiLy8gU3RhbmRhbG9uZSBkYXNoYm9hcmQ6IHRoZSBzYW1lIFVJIGJ1bmRsZSBhbmQgdGhlIHNhbWUgYXV0aG9yaXRhdGl2ZSBzdGF0ZSwgc2VydmVkIG9uIGxvb3BiYWNrLlxuLy8gRXZlcnkgL2FwaSBjYWxsIG5lZWRzIHRoZSB0b2tlbiAoaGVhZGVyKSwgdGhlIEhvc3QgbXVzdCBiZSBsb29wYmFjaywgYW5kIFBPU1RzIG11c3QgY29tZSBmcm9tXG4vLyBvdXIgb3duIG9yaWdpbiB3aXRoIGEgSlNPTiBib2R5LCBzbyBvdGhlciBzaXRlcyBpbiB0aGUgcGVyc29uJ3MgYnJvd3NlciBjYW5ub3QgZHJpdmUgaXQuXG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIHR5cGUgSW5jb21pbmdNZXNzYWdlLCB0eXBlIFNlcnZlciwgdHlwZSBTZXJ2ZXJSZXNwb25zZSB9IGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCB7IHJlYWRGaWxlLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IHByb21pc2lmeSB9IGZyb20gJ25vZGU6dXRpbCdcbmltcG9ydCB7IGJyb3RsaUNvbXByZXNzLCBjb25zdGFudHMgfSBmcm9tICdub2RlOnpsaWInXG5pbXBvcnQgeyBleHRuYW1lLCByZXNvbHZlLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgeyBSRUFEX09OTFlfQ09NTUFORFMsIHR5cGUgQ29tbWFuZEtpbmQsIHR5cGUgQ29tbWFuZFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vc2hhcmVkL2NvbW1hbmRzLnRzJ1xuaW1wb3J0IHR5cGUgeyBGbG93RGVsdGEsIEZsb3dTbmFwc2hvdCB9IGZyb20gJy4uLy4uL3NoYXJlZC9ldmVudHMudHMnXG5pbXBvcnQgeyBob3N0QWxsb3dlZCwgdG9rZW5zTWF0Y2ggfSBmcm9tICcuL2F1dGgudHMnXG5cbmV4cG9ydCB0eXBlIERhc2hib2FyZERlcHMgPSB7XG4gIHVpRGlyOiBzdHJpbmdcbiAgdG9rZW46IHN0cmluZ1xuICBwb3J0OiBudW1iZXJcbiAgYWxsb3dDb250cm9sczogKCkgPT4gYm9vbGVhblxuICBzbmFwc2hvdDogKCkgPT4gRmxvd1NuYXBzaG90XG4gIHN1YnNjcmliZTogKGxpc3RlbmVyOiAoZGVsdGE6IEZsb3dEZWx0YSkgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZFxuICAvKiogTGl2ZSBvdXRwdXQgbm90aWNlczogYW4gYWdlbnQncyBjb252ZXJzYXRpb24gY2hhbmdlZCAob25seSBpdHMgaWQgaXMgc2VudCkuICovXG4gIHN1YnNjcmliZU91dHB1dD86IChsaXN0ZW5lcjogKGFnZW50SWQ6IHN0cmluZykgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZFxuICBjb21tYW5kOiAoaW5wdXQ6IHVua25vd24sIGFsbG93ZWQ6IChraW5kOiBDb21tYW5kS2luZCkgPT4gYm9vbGVhbikgPT4gUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+XG4gIGxvZzogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZFxufVxuXG5jb25zdCBNSU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAnLmh0bWwnOiAndGV4dC9odG1sOyBjaGFyc2V0PXV0Zi04JywgJy5qcyc6ICd0ZXh0L2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLTgnLCAnLmNzcyc6ICd0ZXh0L2NzczsgY2hhcnNldD11dGYtOCcsICcuc3ZnJzogJ2ltYWdlL3N2Zyt4bWwnLCAnLmpzb24nOiAnYXBwbGljYXRpb24vanNvbicsICcucG5nJzogJ2ltYWdlL3BuZycgfVxuY29uc3QgU1RBVElDX0ZJTEVTID0gbmV3IFNldChbJ2Rhc2hib2FyZC5odG1sJywgJ2FwcC5qcycsICdhcHAuY3NzJywgJ2ljb24uc3ZnJywgJ2xheW91dC13b3JrZXIuanMnXSlcbi8qKiBDb2RlLXNwbGl0IFVJIGNodW5rcyB0aGF0IGVzYnVpbGQgbmFtZXMgYGNodW5rcy88bmFtZT4tPGhhc2g+LmpzYCAobG9hZGVkIG9uIGRlbWFuZCkuICovXG5jb25zdCBDSFVOS19GSUxFID0gL15jaHVua3NcXC9bQS1aYS16MC05Xy1dezEsODB9XFwuanMkL1xuY29uc3QgTUFYX0JPRFkgPSAxMjggKiAxMDI0XG4vKiogUmVhZCAoYW5kIGRpc2NhcmQpIGF0IG1vc3QgdGhpcyBtdWNoIG9mIGFuIG92ZXJzaXplZCBib2R5IGJlZm9yZSBjdXR0aW5nIHRoZSBjb25uZWN0aW9uLiAqL1xuY29uc3QgTUFYX0RSQUlOID0gNCAqIDEwMjQgKiAxMDI0XG5jb25zdCBNQVhfQ0xJRU5UUyA9IDhcbmNvbnN0IGJyb3RsaSA9IHByb21pc2lmeShicm90bGlDb21wcmVzcylcblxuZXhwb3J0IGNsYXNzIERhc2hib2FyZFNlcnZlciB7XG4gIHByaXZhdGUgc2VydmVyOiBTZXJ2ZXIgfCBudWxsID0gbnVsbFxuICBwcml2YXRlIGNsaWVudHMgPSBuZXcgU2V0PFNlcnZlclJlc3BvbnNlPigpXG4gIHByaXZhdGUgdW5zdWJzY3JpYmU6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgdW5zdWJzY3JpYmVPdXRwdXQ6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgYm91bmRQb3J0OiBudW1iZXIgfCBudWxsID0gbnVsbFxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZGVwczogRGFzaGJvYXJkRGVwcykge31cblxuICBnZXQgdXJsKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmJvdW5kUG9ydCA/IGBodHRwOi8vMTI3LjAuMC4xOiR7dGhpcy5ib3VuZFBvcnR9LyN0b2tlbj0ke3RoaXMuZGVwcy50b2tlbn1gIDogbnVsbFxuICB9XG5cbiAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCAxMDsgYXR0ZW1wdCsrKSB7XG4gICAgICBjb25zdCBwb3J0ID0gdGhpcy5kZXBzLnBvcnQgKyBhdHRlbXB0XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmxpc3Rlbihwb3J0KVxuICAgICAgICB0aGlzLmJvdW5kUG9ydCA9IHBvcnRcbiAgICAgICAgdGhpcy51bnN1YnNjcmliZSA9IHRoaXMuZGVwcy5zdWJzY3JpYmUoKGRlbHRhKSA9PiB0aGlzLmJyb2FkY2FzdCgnZGVsdGEnLCBkZWx0YSkpXG4gICAgICAgIHRoaXMudW5zdWJzY3JpYmVPdXRwdXQgPSB0aGlzLmRlcHMuc3Vic2NyaWJlT3V0cHV0Py4oKGFnZW50SWQpID0+IHRoaXMuYnJvYWRjYXN0KCdvdXRwdXQnLCB7IGFnZW50SWQgfSkpID8/IG51bGxcbiAgICAgICAgdGhpcy5kZXBzLmxvZyhgZGFzaGJvYXJkIGxpc3RlbmluZyBvbiAxMjcuMC4wLjE6JHtwb3J0fWApXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgIT09ICdFQUREUklOVVNFJykgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcmVlIHBvcnQgZnJvbSAke3RoaXMuZGVwcy5wb3J0fSB0byAke3RoaXMuZGVwcy5wb3J0ICsgOX0uYClcbiAgfVxuXG4gIGFzeW5jIHN0b3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy51bnN1YnNjcmliZT8uKClcbiAgICB0aGlzLnVuc3Vic2NyaWJlID0gbnVsbFxuICAgIHRoaXMudW5zdWJzY3JpYmVPdXRwdXQ/LigpXG4gICAgdGhpcy51bnN1YnNjcmliZU91dHB1dCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IGNsaWVudCBvZiB0aGlzLmNsaWVudHMpIGNsaWVudC5lbmQoKVxuICAgIHRoaXMuY2xpZW50cy5jbGVhcigpXG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+ICh0aGlzLnNlcnZlciA/IHRoaXMuc2VydmVyLmNsb3NlKCgpID0+IHJlc29sdmUoKSkgOiByZXNvbHZlKCkpKVxuICAgIHRoaXMuc2VydmVyID0gbnVsbFxuICAgIHRoaXMuYm91bmRQb3J0ID0gbnVsbFxuICB9XG5cbiAgcHJpdmF0ZSBsaXN0ZW4ocG9ydDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHNlcnZlciA9IGNyZWF0ZVNlcnZlcigocmVxLCByZXMpID0+IHZvaWQgdGhpcy5yb3V0ZShyZXEsIHJlcywgcG9ydCkpXG4gICAgICBzZXJ2ZXIub25jZSgnZXJyb3InLCByZWplY3QpXG4gICAgICBzZXJ2ZXIubGlzdGVuKHBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiB7XG4gICAgICAgIHNlcnZlci5vZmYoJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICB0aGlzLnNlcnZlciA9IHNlcnZlclxuICAgICAgICByZXNvbHZlKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcm91dGUocmVxOiBJbmNvbWluZ01lc3NhZ2UsIHJlczogU2VydmVyUmVzcG9uc2UsIHBvcnQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHJlcy5zZXRIZWFkZXIoJ1gtQ29udGVudC1UeXBlLU9wdGlvbnMnLCAnbm9zbmlmZicpXG4gICAgcmVzLnNldEhlYWRlcignUmVmZXJyZXItUG9saWN5JywgJ25vLXJlZmVycmVyJylcbiAgICByZXMuc2V0SGVhZGVyKCdDYWNoZS1Db250cm9sJywgJ25vLXN0b3JlJylcbiAgICBpZiAoIWhvc3RBbGxvd2VkKHJlcS5oZWFkZXJzLmhvc3QsIHBvcnQpKSByZXR1cm4gc2VuZChyZXMsIDQyMSwgJ1dyb25nIGhvc3QnKVxuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCA/PyAnLycsIGBodHRwOi8vMTI3LjAuMC4xOiR7cG9ydH1gKVxuICAgIHRyeSB7XG4gICAgICBpZiAodXJsLnBhdGhuYW1lLnN0YXJ0c1dpdGgoJy9hcGkvJykpIHJldHVybiBhd2FpdCB0aGlzLmFwaShyZXEsIHJlcywgdXJsLCBwb3J0KVxuICAgICAgaWYgKHJlcS5tZXRob2QgIT09ICdHRVQnKSByZXR1cm4gc2VuZChyZXMsIDQwNSwgJ01ldGhvZCBub3QgYWxsb3dlZCcpXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5zZXJ2ZVN0YXRpYyhyZXMsIHVybC5wYXRobmFtZSwgYWNjZXB0c0Jyb3RsaShyZXEuaGVhZGVyc1snYWNjZXB0LWVuY29kaW5nJ10pKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmRlcHMubG9nKGBkYXNoYm9hcmQgZXJyb3I6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgICBpZiAoIXJlcy5oZWFkZXJzU2VudCkgc2VuZChyZXMsIDUwMCwgJ0ludGVybmFsIGVycm9yJylcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwaShyZXE6IEluY29taW5nTWVzc2FnZSwgcmVzOiBTZXJ2ZXJSZXNwb25zZSwgdXJsOiBVUkwsIHBvcnQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGF1dGggPSByZXEuaGVhZGVycy5hdXRob3JpemF0aW9uPy5yZXBsYWNlKC9eQmVhcmVyXFxzKy9pLCAnJylcbiAgICBpZiAoIXRva2Vuc01hdGNoKHRoaXMuZGVwcy50b2tlbiwgYXV0aCkpIHJldHVybiBzZW5kSnNvbihyZXMsIDQwMSwgeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6ICd1bmF1dGhvcml6ZWQnLCBtZXNzYWdlOiAnTWlzc2luZyBvciB3cm9uZyB0b2tlbi4nIH0gfSlcbiAgICBpZiAodXJsLnBhdGhuYW1lID09PSAnL2FwaS9zbmFwc2hvdCcgJiYgcmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHJldHVybiBzZW5kSnNvbihyZXMsIDIwMCwgdGhpcy5kZXBzLnNuYXBzaG90KCkpXG4gICAgaWYgKHVybC5wYXRobmFtZSA9PT0gJy9hcGkvZXZlbnRzJyAmJiByZXEubWV0aG9kID09PSAnR0VUJykgcmV0dXJuIHRoaXMub3BlblN0cmVhbShyZXEsIHJlcylcbiAgICBpZiAodXJsLnBhdGhuYW1lID09PSAnL2FwaS9jb21tYW5kJyAmJiByZXEubWV0aG9kID09PSAnUE9TVCcpIHtcbiAgICAgIGNvbnN0IG9yaWdpbiA9IHJlcS5oZWFkZXJzLm9yaWdpblxuICAgICAgaWYgKG9yaWdpbiAmJiBvcmlnaW4gIT09IGBodHRwOi8vMTI3LjAuMC4xOiR7cG9ydH1gICYmIG9yaWdpbiAhPT0gYGh0dHA6Ly9sb2NhbGhvc3Q6JHtwb3J0fWApIHJldHVybiBzZW5kSnNvbihyZXMsIDQwMywgeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6ICdmb3JiaWRkZW4nLCBtZXNzYWdlOiAnQ3Jvc3Mtb3JpZ2luIHJlcXVlc3QgcmVmdXNlZC4nIH0gfSlcbiAgICAgIGlmICghKHJlcS5oZWFkZXJzWydjb250ZW50LXR5cGUnXSA/PyAnJykuc3RhcnRzV2l0aCgnYXBwbGljYXRpb24vanNvbicpKSByZXR1cm4gc2VuZEpzb24ocmVzLCA0MTUsIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAndW5zdXBwb3J0ZWRfbWVkaWEnLCBtZXNzYWdlOiAnU2VuZCBKU09OLicgfSB9KVxuICAgICAgbGV0IGJvZHk6IHN0cmluZ1xuICAgICAgdHJ5IHtcbiAgICAgICAgYm9keSA9IGF3YWl0IHJlYWRCb2R5KHJlcSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gc2VuZEpzb24ocmVzLCA0MTMsIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAndG9vX2xhcmdlJywgbWVzc2FnZTogJ1JlcXVlc3QgYm9keSB0b28gbGFyZ2UuJyB9IH0pXG4gICAgICB9XG4gICAgICBsZXQgcGFyc2VkOiB1bmtub3duXG4gICAgICB0cnkge1xuICAgICAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGJvZHkpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIHNlbmRKc29uKHJlcywgNDAwLCB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogJ2ludmFsaWRfcGFyYW1zJywgbWVzc2FnZTogJ0JvZHkgaXMgbm90IEpTT04uJyB9IH0pXG4gICAgICB9XG4gICAgICBjb25zdCBjb250cm9scyA9IHRoaXMuZGVwcy5hbGxvd0NvbnRyb2xzKClcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGVwcy5jb21tYW5kKHBhcnNlZCwgKGtpbmQpID0+IGtpbmQgIT09ICdkYXNoYm9hcmQuZW5hYmxlJyAmJiBraW5kICE9PSAnZGFzaGJvYXJkLmNvbnRyb2xzJyAmJiAoY29udHJvbHMgfHwgUkVBRF9PTkxZX0NPTU1BTkRTLmhhcyhraW5kKSkpXG4gICAgICByZXR1cm4gc2VuZEpzb24ocmVzLCAyMDAsIHJlc3VsdClcbiAgICB9XG4gICAgcmV0dXJuIHNlbmRKc29uKHJlcywgNDA0LCB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogJ25vdF9mb3VuZCcsIG1lc3NhZ2U6ICdObyBzdWNoIGVuZHBvaW50LicgfSB9KVxuICB9XG5cbiAgcHJpdmF0ZSBvcGVuU3RyZWFtKHJlcTogSW5jb21pbmdNZXNzYWdlLCByZXM6IFNlcnZlclJlc3BvbnNlKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xpZW50cy5zaXplID49IE1BWF9DTElFTlRTKSByZXR1cm4gc2VuZEpzb24ocmVzLCA0MjksIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAndG9vX21hbnlfY2xpZW50cycsIG1lc3NhZ2U6ICdUb28gbWFueSBkYXNoYm9hcmRzIG9wZW4uJyB9IH0pXG4gICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L2V2ZW50LXN0cmVhbScsICdDYWNoZS1Db250cm9sJzogJ25vLXN0b3JlJywgQ29ubmVjdGlvbjogJ2tlZXAtYWxpdmUnIH0pXG4gICAgcmVzLndyaXRlKGBldmVudDogaGVsbG9cXG5kYXRhOiB7fVxcblxcbmApXG4gICAgdGhpcy5jbGllbnRzLmFkZChyZXMpXG4gICAgY29uc3QgaGVhcnRiZWF0ID0gc2V0SW50ZXJ2YWwoKCkgPT4gcmVzLndyaXRlKGA6IHBpbmdcXG5cXG5gKSwgMTUwMDApXG4gICAgcmVxLm9uKCdjbG9zZScsICgpID0+IHtcbiAgICAgIGNsZWFySW50ZXJ2YWwoaGVhcnRiZWF0KVxuICAgICAgdGhpcy5jbGllbnRzLmRlbGV0ZShyZXMpXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgYnJvYWRjYXN0KGV2ZW50OiAnZGVsdGEnIHwgJ291dHB1dCcsIGRhdGE6IEZsb3dEZWx0YSB8IHsgYWdlbnRJZDogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuY2xpZW50cy5zaXplKSByZXR1cm5cbiAgICBjb25zdCBwYXlsb2FkID0gYGV2ZW50OiAke2V2ZW50fVxcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZGF0YSl9XFxuXFxuYFxuICAgIGZvciAoY29uc3QgY2xpZW50IG9mIHRoaXMuY2xpZW50cykgY2xpZW50LndyaXRlKHBheWxvYWQpXG4gIH1cblxuICBwcml2YXRlIGJyb3RsaUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgbXRpbWU6IG51bWJlcjsgZGF0YTogUHJvbWlzZTxCdWZmZXI+IH0+KClcblxuICAvKiogQnJvdGxpIGNvcHkgb2YgYSB0ZXh0IGZpbGUsIG1hZGUgb24gZmlyc3QgcmVxdWVzdCBhbmQgcmV1c2VkIHVudGlsIHRoZSBmaWxlIGNoYW5nZXMuICovXG4gIHByaXZhdGUgYXN5bmMgY29tcHJlc3NlZChmaWxlOiBzdHJpbmcpOiBQcm9taXNlPEJ1ZmZlciB8IG51bGw+IHtcbiAgICBpZiAoIS9cXC4oanN8Y3NzfGh0bWx8c3ZnKSQvLnRlc3QoZmlsZSkpIHJldHVybiBudWxsXG4gICAgY29uc3QgbXRpbWUgPSAoYXdhaXQgc3RhdChmaWxlKSkubXRpbWVNc1xuICAgIGNvbnN0IGhpdCA9IHRoaXMuYnJvdGxpQ2FjaGUuZ2V0KGZpbGUpXG4gICAgaWYgKGhpdCAmJiBoaXQubXRpbWUgPT09IG10aW1lKSByZXR1cm4gaGl0LmRhdGFcbiAgICBjb25zdCBkYXRhID0gcmVhZEZpbGUoZmlsZSkudGhlbigocmF3KSA9PiBicm90bGkocmF3LCB7IHBhcmFtczogeyBbY29uc3RhbnRzLkJST1RMSV9QQVJBTV9RVUFMSVRZXTogOSwgW2NvbnN0YW50cy5CUk9UTElfUEFSQU1fU0laRV9ISU5UXTogcmF3Lmxlbmd0aCB9IH0pKVxuICAgIHRoaXMuYnJvdGxpQ2FjaGUuc2V0KGZpbGUsIHsgbXRpbWUsIGRhdGEgfSlcbiAgICBkYXRhLmNhdGNoKCgpID0+IHRoaXMuYnJvdGxpQ2FjaGUuZGVsZXRlKGZpbGUpKVxuICAgIHJldHVybiBkYXRhXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlcnZlU3RhdGljKHJlczogU2VydmVyUmVzcG9uc2UsIHBhdGhuYW1lOiBzdHJpbmcsIGJyb3RsaTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5hbWUgPSBwYXRobmFtZSA9PT0gJy8nID8gJ2Rhc2hib2FyZC5odG1sJyA6IHBhdGhuYW1lLnJlcGxhY2UoL15cXC8rLywgJycpXG4gICAgaWYgKCFTVEFUSUNfRklMRVMuaGFzKG5hbWUpICYmICFDSFVOS19GSUxFLnRlc3QobmFtZSkpIHJldHVybiBzZW5kKHJlcywgNDA0LCAnTm90IGZvdW5kJylcbiAgICBjb25zdCByb290ID0gcmVzb2x2ZSh0aGlzLmRlcHMudWlEaXIpXG4gICAgY29uc3QgZmlsZSA9IHJlc29sdmUocm9vdCwgbmFtZSlcbiAgICBpZiAoIWZpbGUuc3RhcnRzV2l0aChyb290ICsgc2VwKSkgcmV0dXJuIHNlbmQocmVzLCA0MDQsICdOb3QgZm91bmQnKVxuICAgIGxldCBkYXRhOiBCdWZmZXJcbiAgICBsZXQgZW5jb2RlZCA9IGZhbHNlXG4gICAgdHJ5IHtcbiAgICAgIC8vIENvbXByZXNzZWQgb25jZSBwZXIgZmlsZSB2ZXJzaW9uIGFuZCBrZXB0IGluIG1lbW9yeSAobm8gY29tcHJlc3NlZCBjb3BpZXMgc2hpcCB3aXRoIHRoZSBwbHVnaW4pLlxuICAgICAgY29uc3QgY29tcHJlc3NlZCA9IGJyb3RsaSA/IGF3YWl0IHRoaXMuY29tcHJlc3NlZChmaWxlKSA6IG51bGxcbiAgICAgIGlmIChjb21wcmVzc2VkKSB7XG4gICAgICAgIGRhdGEgPSBjb21wcmVzc2VkXG4gICAgICAgIGVuY29kZWQgPSB0cnVlXG4gICAgICB9IGVsc2UgZGF0YSA9IGF3YWl0IHJlYWRGaWxlKGZpbGUpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gc2VuZChyZXMsIDQwNCwgJ05vdCBmb3VuZCcpXG4gICAgfVxuICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAuLi4oZW5jb2RlZCA/IHsgJ0NvbnRlbnQtRW5jb2RpbmcnOiAnYnInIH0gOiB7fSksXG4gICAgICBWYXJ5OiAnQWNjZXB0LUVuY29kaW5nJyxcbiAgICAgICdDb250ZW50LVR5cGUnOiBNSU1FW2V4dG5hbWUobmFtZSldID8/ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgJ0NvbnRlbnQtU2VjdXJpdHktUG9saWN5JzogXCJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMgJ3NlbGYnOyBzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJzsgaW1nLXNyYyAnc2VsZicgZGF0YTo7IGNvbm5lY3Qtc3JjICdzZWxmJzsgZnJhbWUtYW5jZXN0b3JzICdub25lJzsgYmFzZS11cmkgJ25vbmUnOyBmb3JtLWFjdGlvbiAnbm9uZSdcIixcbiAgICAgICdYLUZyYW1lLU9wdGlvbnMnOiAnREVOWScsXG4gICAgICAvLyBIYXNoZWQgY2h1bmtzIG5ldmVyIGNoYW5nZTsgZXZlcnl0aGluZyBlbHNlIGlzIHJlLWNoZWNrZWQgc28gYSByZWJ1aWxkIHNob3dzIHVwIG9uIHJlbG9hZC5cbiAgICAgICdDYWNoZS1Db250cm9sJzogQ0hVTktfRklMRS50ZXN0KG5hbWUpID8gJ3B1YmxpYywgbWF4LWFnZT0zMTUzNjAwMCwgaW1tdXRhYmxlJyA6ICduby1jYWNoZSdcbiAgICB9KVxuICAgIHJlcy5lbmQoZGF0YSlcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYWNjZXB0c0Jyb3RsaShoZWFkZXI6IHN0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogYm9vbGVhbiB7XG4gIGNvbnN0IHZhbHVlID0gQXJyYXkuaXNBcnJheShoZWFkZXIpID8gaGVhZGVyLmpvaW4oJywnKSA6IChoZWFkZXIgPz8gJycpXG4gIHJldHVybiB2YWx1ZS5zcGxpdCgnLCcpLnNvbWUoKHBhcnQpID0+IHtcbiAgICBjb25zdCBbbmFtZSwgLi4ucGFyYW1zXSA9IHBhcnQudHJpbSgpLnNwbGl0KCc7JylcbiAgICBpZiAobmFtZS50cmltKCkudG9Mb3dlckNhc2UoKSAhPT0gJ2JyJykgcmV0dXJuIGZhbHNlXG4gICAgY29uc3QgcSA9IHBhcmFtcy5tYXAoKHApID0+IHAudHJpbSgpKS5maW5kKChwKSA9PiBwLnN0YXJ0c1dpdGgoJ3E9JykpXG4gICAgcmV0dXJuICFxIHx8IE51bWJlcihxLnNsaWNlKDIpKSA+IDBcbiAgfSlcbn1cblxuZnVuY3Rpb24gc2VuZChyZXM6IFNlcnZlclJlc3BvbnNlLCBzdGF0dXM6IG51bWJlciwgdGV4dDogc3RyaW5nKTogdm9pZCB7XG4gIHJlcy53cml0ZUhlYWQoc3RhdHVzLCB7ICdDb250ZW50LVR5cGUnOiAndGV4dC9wbGFpbjsgY2hhcnNldD11dGYtOCcgfSlcbiAgcmVzLmVuZCh0ZXh0KVxufVxuXG5mdW5jdGlvbiBzZW5kSnNvbihyZXM6IFNlcnZlclJlc3BvbnNlLCBzdGF0dXM6IG51bWJlciwgdmFsdWU6IHVua25vd24pOiB2b2lkIHtcbiAgcmVzLndyaXRlSGVhZChzdGF0dXMsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04JyB9KVxuICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHZhbHVlKSlcbn1cblxuZnVuY3Rpb24gcmVhZEJvZHkocmVxOiBJbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGxldCBzaXplID0gMFxuICAgIGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXVxuICAgIHJlcS5vbignZGF0YScsIChjaHVuazogQnVmZmVyKSA9PiB7XG4gICAgICBzaXplICs9IGNodW5rLmxlbmd0aFxuICAgICAgLy8gVG9vIGJpZzogc3RvcCBrZWVwaW5nIGl0IGJ1dCByZWFkIHRvIHRoZSBlbmQsIHNvIHRoZSA0MTMgYW5zd2VyIHJlYWNoZXMgdGhlIGNsaWVudDsgb25seSBhXG4gICAgICAvLyBydW5hd2F5IHVwbG9hZCBpcyBjdXQgb2ZmLlxuICAgICAgaWYgKHNpemUgPiBNQVhfRFJBSU4pIHJlcS5kZXN0cm95KClcbiAgICAgIGVsc2UgaWYgKHNpemUgPD0gTUFYX0JPRFkpIGNodW5rcy5wdXNoKGNodW5rKVxuICAgIH0pXG4gICAgcmVxLm9uKCdlbmQnLCAoKSA9PiAoc2l6ZSA+IE1BWF9CT0RZID8gcmVqZWN0KG5ldyBFcnJvcignQm9keSB0b28gbGFyZ2UnKSkgOiByZXNvbHZlKEJ1ZmZlci5jb25jYXQoY2h1bmtzKS50b1N0cmluZygndXRmOCcpKSkpXG4gICAgcmVxLm9uKCdlcnJvcicsIHJlamVjdClcbiAgfSlcbn1cbiIsICIvLyBTYXZlcyBlYWNoIHJ1biAodGFza3MsIGFnZW50cywgbWVzc2FnZXMsIHRpbWVsaW5lKSBzbyBmaW5pc2hlZCBydW5zIGNhbiBiZSByZXBsYXllZCBsYXRlci5cbmltcG9ydCB0eXBlIHsgRmxvd1N0b3JlIH0gZnJvbSAnLi9zdG9yZS50cydcbmltcG9ydCB0eXBlIHsgUGVyc2lzdGVuY2UsIFJ1bkhpc3RvcnlSZWNvcmQgfSBmcm9tICcuL3BlcnNpc3RlbmNlLnRzJ1xuXG5leHBvcnQgY2xhc3MgSGlzdG9yeVJlY29yZGVyIHtcbiAgcHJpdmF0ZSBzYXZlZFZlcnNpb24gPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdG9yZTogRmxvd1N0b3JlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGVyc2lzdGVuY2U6IFBlcnNpc3RlbmNlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9nOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkXG4gICkge31cblxuICBhc3luYyBzYXZlQ2hhbmdlZFJ1bnMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0b3JlLnJlYWQoKVxuICAgIGZvciAoY29uc3QgcnVuIG9mIE9iamVjdC52YWx1ZXMoc3RhdGUucnVucykpIHtcbiAgICAgIGNvbnN0IHRhc2tzID0gT2JqZWN0LnZhbHVlcyhzdGF0ZS50YXNrcykuZmlsdGVyKCh0YXNrKSA9PiB0YXNrLnJ1bklkID09PSBydW4uaWQpXG4gICAgICBpZiAoIXRhc2tzLmxlbmd0aCkgY29udGludWVcbiAgICAgIGNvbnN0IGFnZW50cyA9IE9iamVjdC52YWx1ZXMoc3RhdGUuYWdlbnRzKS5maWx0ZXIoKGFnZW50KSA9PiBhZ2VudC5ydW5JZCA9PT0gcnVuLmlkKVxuICAgICAgY29uc3QgZmluZ2VycHJpbnQgPSBgJHtydW4udmVyc2lvbn18JHtydW4uc3RhdGV9fCR7dGFza3MubWFwKCh0KSA9PiB0LnZlcnNpb24pLmpvaW4oJywnKX18JHthZ2VudHMubWFwKChhKSA9PiBhLnZlcnNpb24pLmpvaW4oJywnKX1gXG4gICAgICBpZiAodGhpcy5zYXZlZFZlcnNpb24uZ2V0KHJ1bi5pZCkgPT09IGZpbmdlcnByaW50KSBjb250aW51ZVxuICAgICAgY29uc3QgaWRzID0gbmV3IFNldDxzdHJpbmc+KFtydW4uaWQsIC4uLnRhc2tzLm1hcCgodCkgPT4gdC5pZCksIC4uLmFnZW50cy5tYXAoKGEpID0+IGEuaWQpXSlcbiAgICAgIGNvbnN0IHJlY29yZDogUnVuSGlzdG9yeVJlY29yZCA9IHtcbiAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgc2F2ZWRBdDogRGF0ZS5ub3coKSxcbiAgICAgICAgcnVuLFxuICAgICAgICB0YXNrcyxcbiAgICAgICAgYWdlbnRzLFxuICAgICAgICBtZXNzYWdlczogc3RhdGUubWVzc2FnZXMuZmlsdGVyKChtZXNzYWdlKSA9PiBtZXNzYWdlLnJ1bklkID09PSBydW4uaWQpLFxuICAgICAgICBldmVudHM6IHRoaXMuc3RvcmUuZXZlbnRzKCkuZmlsdGVyKChldmVudCkgPT4gZXZlbnQucnVuSWQgPT09IHJ1bi5pZCB8fCBpZHMuaGFzKGV2ZW50LmVudGl0eUlkKSlcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucGVyc2lzdGVuY2Uuc2F2ZVJ1bihyZWNvcmQpXG4gICAgICAgIHRoaXMuc2F2ZWRWZXJzaW9uLnNldChydW4uaWQsIGZpbmdlcnByaW50KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2coYGhpc3Rvcnkgc2F2ZSBmYWlsZWQgZm9yICR7cnVuLmlkfTogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsICIvLyBUaGUgcmVwb3NpdG9yeSBhIHdvcmt0cmVlIGJlbG9uZ3MgdG8sIGZyb20gaXRzIGAuZ2l0YCBwb2ludGVyIChyZWFkLW9ubHksIG5vIGdpdCBwcm9jZXNzKTpcbi8vIGEgbGlua2VkIHdvcmt0cmVlIGhhcyBhIGAuZ2l0YCBmaWxlIGBnaXRkaXI6IDxyZXBvPi8uZ2l0L3dvcmt0cmVlcy88bmFtZT5gOyBhIG1haW4gY2hlY2tvdXRcbi8vIGhhcyBhIGAuZ2l0YCBmb2xkZXIuIExldHMgcHJvamVjdCBib3hlcyBtYXRjaCBhIHdvcmt0cmVlIHRvIGl0cyBwcm9qZWN0IGV4YWN0bHkuXG5pbXBvcnQgeyByZWFkRmlsZSwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5jb25zdCBjYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmcgfCBudWxsPigpXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXBvUm9vdE9mKHdvcmt0cmVlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGlmIChjYWNoZS5oYXMod29ya3RyZWVQYXRoKSkgcmV0dXJuIGNhY2hlLmdldCh3b3JrdHJlZVBhdGgpIVxuICBsZXQgcm9vdDogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgdHJ5IHtcbiAgICBjb25zdCBkb3RHaXQgPSBqb2luKHdvcmt0cmVlUGF0aCwgJy5naXQnKVxuICAgIGNvbnN0IGluZm8gPSBhd2FpdCBzdGF0KGRvdEdpdClcbiAgICBpZiAoaW5mby5pc0RpcmVjdG9yeSgpKSByb290ID0gd29ya3RyZWVQYXRoXG4gICAgZWxzZSB7XG4gICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoZG90R2l0LCAndXRmOCcpXG4gICAgICBjb25zdCBnaXRkaXIgPSAvXmdpdGRpcjpcXHMqKC4rKSQvbS5leGVjKHRleHQpPy5bMV0/LnRyaW0oKVxuICAgICAgY29uc3QgbWFya2VyID0gZ2l0ZGlyID8gZ2l0ZGlyLmxhc3RJbmRleE9mKCcvLmdpdC8nKSA6IC0xXG4gICAgICBpZiAoZ2l0ZGlyICYmIG1hcmtlciA+IDApIHJvb3QgPSBnaXRkaXIuc2xpY2UoMCwgbWFya2VyKVxuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgcm9vdCA9IG51bGwgLy8gcmVtb3ZlZCB3b3JrdHJlZSBvciBub3QgYSBnaXQgY2hlY2tvdXRcbiAgfVxuICBjYWNoZS5zZXQod29ya3RyZWVQYXRoLCByb290KVxuICBpZiAoY2FjaGUuc2l6ZSA+IDIwMDApIGNhY2hlLmRlbGV0ZShjYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlIGFzIHN0cmluZylcbiAgcmV0dXJuIHJvb3Rcbn1cbiIsICIvLyBDcmFzaCByZWNvdmVyeSBhbmQgcnVuIGhpc3Rvcnkgb24gZGlzaywgaW4gdGhlIHBsdWdpbidzIG93biBzdGF0ZSBmb2xkZXIgKG5ldmVyIHRoZSByZXBvKS5cbi8vIEJvdW5kZWQ6IG9uZSBjb21wYWN0IHNuYXBzaG90IHBsdXMgYXQgbW9zdCBNQVhfUlVOUyBydW4gcmVjb3Jkcy5cbmltcG9ydCB7IG1rZGlyLCByZWFkZGlyLCByZWFkRmlsZSwgcmVuYW1lLCBybSwgc3RhdCwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGhvbWVkaXIsIHBsYXRmb3JtIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgdHlwZSB7IEZsb3dFdmVudCwgRmxvd1NuYXBzaG90IH0gZnJvbSAnLi4vLi4vc2hhcmVkL2V2ZW50cy50cydcbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQsIE1lc3NhZ2VSZWNvcmQsIFJ1blJlY29yZCwgVGFza1JlY29yZCB9IGZyb20gJy4uLy4uL3NoYXJlZC9tb2RlbC50cydcblxuY29uc3QgTUFYX1JVTlMgPSA2MFxuY29uc3QgTUFYX1JVTl9FVkVOVFMgPSAyMDAwXG5jb25zdCBTTkFQU0hPVF9GSUxFID0gJ3NuYXBzaG90Lmpzb24nXG5jb25zdCBQUlVORV9FVkVSWSA9IDEwXG5cbmV4cG9ydCB0eXBlIFJ1bkhpc3RvcnlSZWNvcmQgPSB7XG4gIHZlcnNpb246IDFcbiAgc2F2ZWRBdDogbnVtYmVyXG4gIHJ1bjogUnVuUmVjb3JkXG4gIHRhc2tzOiBUYXNrUmVjb3JkW11cbiAgYWdlbnRzOiBBZ2VudFJlY29yZFtdXG4gIG1lc3NhZ2VzOiBNZXNzYWdlUmVjb3JkW11cbiAgZXZlbnRzOiBGbG93RXZlbnRbXVxufVxuXG5leHBvcnQgdHlwZSBSdW5IaXN0b3J5U3VtbWFyeSA9IFBpY2s8UnVuUmVjb3JkLCAnaWQnIHwgJ29iamVjdGl2ZScgfCAnc3RhdGUnIHwgJ3N0YXJ0ZWRBdCcgfCAnZW5kZWRBdCcgfCAndGFza0NvdW50Jz4gJiB7IHNhdmVkQXQ6IG51bWJlciB9XG5cbmV4cG9ydCBmdW5jdGlvbiBzdGF0ZURpcigpOiBzdHJpbmcge1xuICBjb25zdCBob21lID0gaG9tZWRpcigpXG4gIGlmIChwbGF0Zm9ybSgpID09PSAnZGFyd2luJykgcmV0dXJuIGpvaW4oaG9tZSwgJ0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC9vcmNhLWFnZW50LWZsb3cnKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ3dpbjMyJykgcmV0dXJuIGpvaW4ocHJvY2Vzcy5lbnYuQVBQREFUQSA/PyBqb2luKGhvbWUsICdBcHBEYXRhL1JvYW1pbmcnKSwgJ29yY2EtYWdlbnQtZmxvdycpXG4gIHJldHVybiBqb2luKHByb2Nlc3MuZW52LlhER19TVEFURV9IT01FID8/IGpvaW4oaG9tZSwgJy5sb2NhbC9zdGF0ZScpLCAnb3JjYS1hZ2VudC1mbG93Jylcbn1cblxuZXhwb3J0IGNsYXNzIFBlcnNpc3RlbmNlIHtcbiAgcHJpdmF0ZSBoaXN0b3J5RGlyOiBzdHJpbmdcbiAgcHJpdmF0ZSBzYXZlc1NpbmNlUHJ1bmUgPSAwXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkaXIgPSBzdGF0ZURpcigpKSB7XG4gICAgdGhpcy5oaXN0b3J5RGlyID0gam9pbihkaXIsICdoaXN0b3J5JylcbiAgfVxuXG4gIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgbWtkaXIodGhpcy5oaXN0b3J5RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgbW9kZTogMG83MDAgfSlcbiAgfVxuXG4gIGFzeW5jIGxvYWRTbmFwc2hvdCgpOiBQcm9taXNlPEZsb3dTbmFwc2hvdCB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShqb2luKHRoaXMuZGlyLCBTTkFQU0hPVF9GSUxFKSwgJ3V0ZjgnKSkgYXMgRmxvd1NuYXBzaG90XG4gICAgICByZXR1cm4gcGFyc2VkPy5zdGF0ZSAmJiB0eXBlb2YgcGFyc2VkLnN0YXRlLnNlcSA9PT0gJ251bWJlcicgPyBwYXJzZWQgOiBudWxsXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNhdmVTbmFwc2hvdChzbmFwc2hvdDogRmxvd1NuYXBzaG90KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgYXRvbWljV3JpdGUoam9pbih0aGlzLmRpciwgU05BUFNIT1RfRklMRSksIEpTT04uc3RyaW5naWZ5KHNuYXBzaG90KSlcbiAgfVxuXG4gIGFzeW5jIHNhdmVSdW4ocmVjb3JkOiBSdW5IaXN0b3J5UmVjb3JkKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHsgLi4ucmVjb3JkLCBldmVudHM6IHJlY29yZC5ldmVudHMuc2xpY2UoLU1BWF9SVU5fRVZFTlRTKSB9XG4gICAgYXdhaXQgYXRvbWljV3JpdGUoam9pbih0aGlzLmhpc3RvcnlEaXIsIGAke3NhZmVOYW1lKHJlY29yZC5ydW4uaWQpfS5qc29uYCksIEpTT04uc3RyaW5naWZ5KHRyaW1tZWQpKVxuICAgIC8vIExpc3RpbmcgdGhlIGZvbGRlciBpcyB0aGUgY29zdGx5IHBhcnQ7IHRyaW1taW5nIG9sZCBydW5zIG5vdyBhbmQgdGhlbiBpcyBlbm91Z2guXG4gICAgaWYgKHRoaXMuc2F2ZXNTaW5jZVBydW5lKysgJSBQUlVORV9FVkVSWSA9PT0gMCkgYXdhaXQgdGhpcy5wcnVuZSgpXG4gIH1cblxuICBhc3luYyBsaXN0UnVucygpOiBQcm9taXNlPFJ1bkhpc3RvcnlTdW1tYXJ5W10+IHtcbiAgICBjb25zdCBvdXQ6IFJ1bkhpc3RvcnlTdW1tYXJ5W10gPSBbXVxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBhd2FpdCB0aGlzLmZpbGVzKCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlY29yZCA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoam9pbih0aGlzLmhpc3RvcnlEaXIsIG5hbWUpLCAndXRmOCcpKSBhcyBSdW5IaXN0b3J5UmVjb3JkXG4gICAgICAgIGNvbnN0IHsgaWQsIG9iamVjdGl2ZSwgc3RhdGUsIHN0YXJ0ZWRBdCwgZW5kZWRBdCwgdGFza0NvdW50IH0gPSByZWNvcmQucnVuXG4gICAgICAgIG91dC5wdXNoKHsgaWQsIG9iamVjdGl2ZSwgc3RhdGUsIHN0YXJ0ZWRBdCwgZW5kZWRBdCwgdGFza0NvdW50LCBzYXZlZEF0OiByZWNvcmQuc2F2ZWRBdCB9KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIHNraXAgdW5yZWFkYWJsZSBmaWxlc1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb3V0LnNvcnQoKGEsIGIpID0+IChiLnN0YXJ0ZWRBdCA/PyBiLnNhdmVkQXQpIC0gKGEuc3RhcnRlZEF0ID8/IGEuc2F2ZWRBdCkpLnNsaWNlKDAsIE1BWF9SVU5TKVxuICB9XG5cbiAgYXN5bmMgbG9hZFJ1bihydW5JZDogc3RyaW5nKTogUHJvbWlzZTxSdW5IaXN0b3J5UmVjb3JkIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShqb2luKHRoaXMuaGlzdG9yeURpciwgYCR7c2FmZU5hbWUocnVuSWQpfS5qc29uYCksICd1dGY4JykpIGFzIFJ1bkhpc3RvcnlSZWNvcmRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmaWxlcygpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAoYXdhaXQgcmVhZGRpcih0aGlzLmhpc3RvcnlEaXIpKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUuZW5kc1dpdGgoJy5qc29uJykpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBydW5lKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5hbWVzID0gYXdhaXQgdGhpcy5maWxlcygpXG4gICAgaWYgKG5hbWVzLmxlbmd0aCA8PSBNQVhfUlVOUykgcmV0dXJuXG4gICAgY29uc3Qgd2l0aFRpbWVzID0gYXdhaXQgUHJvbWlzZS5hbGwobmFtZXMubWFwKGFzeW5jIChuYW1lKSA9PiAoeyBuYW1lLCBtdGltZTogKGF3YWl0IHN0YXQoam9pbih0aGlzLmhpc3RvcnlEaXIsIG5hbWUpKSkubXRpbWVNcyB9KSkpXG4gICAgd2l0aFRpbWVzLnNvcnQoKGEsIGIpID0+IGEubXRpbWUgLSBiLm10aW1lKVxuICAgIGZvciAoY29uc3QgeyBuYW1lIH0gb2Ygd2l0aFRpbWVzLnNsaWNlKDAsIG5hbWVzLmxlbmd0aCAtIE1BWF9SVU5TKSkgYXdhaXQgcm0oam9pbih0aGlzLmhpc3RvcnlEaXIsIG5hbWUpLCB7IGZvcmNlOiB0cnVlIH0pXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhZmVOYW1lKGlkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaWQucmVwbGFjZSgvW15BLVphLXowLTlfLi1dL2csICdfJykuc2xpY2UoMCwgMTIwKVxufVxuXG5hc3luYyBmdW5jdGlvbiBhdG9taWNXcml0ZShwYXRoOiBzdHJpbmcsIGRhdGE6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB0bXAgPSBgJHtwYXRofS4ke3Byb2Nlc3MucGlkfS50bXBgXG4gIGF3YWl0IHdyaXRlRmlsZSh0bXAsIGRhdGEsIHsgbW9kZTogMG82MDAgfSlcbiAgYXdhaXQgcmVuYW1lKHRtcCwgcGF0aClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEFnZW50UmVjb3JkLCBFdmlkZW5jZVNvdXJjZSwgRmxvd1N0YXRlLCBHYXRlUmVjb3JkLCBNZXNzYWdlUmVjb3JkLCBSdW5SZWNvcmQsIFRhc2tSZWNvcmQsIFRvb2xDYWxsUmVjb3JkLCBXb3JrdHJlZVJlY29yZCwgQWNjb3VudFJlY29yZCwgQ2FwYWJpbGl0aWVzLCBMYWJlbENvbmZpZywgUHJvamVjdFJlY29yZCB9IGZyb20gJy4vbW9kZWwudHMnXG5cbi8qKiBTZW1hbnRpYyB0aW1lbGluZSBldmVudC4gRHJpdmVzIHRoZSBib3R0b20gdGltZWxpbmUsIGhpc3RvcnkgYW5kIGVkZ2UgYW5pbWF0aW9uLiAqL1xuZXhwb3J0IHR5cGUgRmxvd0V2ZW50S2luZCA9XG4gIHwgJ2FnZW50LmNyZWF0ZWQnXG4gIHwgJ2FnZW50LnN0YXJ0ZWQnXG4gIHwgJ2FnZW50LnN0YXR1c19jaGFuZ2VkJ1xuICB8ICdhZ2VudC5jb21wbGV0ZWQnXG4gIHwgJ2FnZW50LmZhaWxlZCdcbiAgfCAnc3ViYWdlbnQuc3Bhd25lZCdcbiAgfCAnc3ViYWdlbnQuY29tcGxldGVkJ1xuICB8ICd0YXNrLmNyZWF0ZWQnXG4gIHwgJ3Rhc2suYXNzaWduZWQnXG4gIHwgJ3Rhc2suc3RhcnRlZCdcbiAgfCAndGFzay51cGRhdGVkJ1xuICB8ICd0YXNrLmNvbXBsZXRlZCdcbiAgfCAndGFzay5mYWlsZWQnXG4gIHwgJ3Rhc2suYmxvY2tlZCdcbiAgfCAndGFzay5yZXRyaWVkJ1xuICB8ICdyZXZpZXcuc3RhcnRlZCdcbiAgfCAncmV2aWV3LmNvbXBsZXRlZCdcbiAgfCAndGVzdC5zdGFydGVkJ1xuICB8ICd0ZXN0LmNvbXBsZXRlZCdcbiAgfCAnd29ya3RyZWUuY3JlYXRlZCdcbiAgfCAnd29ya3RyZWUudXBkYXRlZCdcbiAgfCAnd29ya3RyZWUucmVtb3ZlZCdcbiAgfCAnbWVzc2FnZS5zZW50J1xuICB8ICd0b29sLmNhbGxlZCdcbiAgfCAnb3JjaGVzdHJhdGlvbi5zdGFydGVkJ1xuICB8ICdvcmNoZXN0cmF0aW9uLmNvbXBsZXRlZCdcbiAgfCAnY29tbWFuZC5leGVjdXRlZCdcbiAgfCAnY29tbWFuZC5mYWlsZWQnXG5cbmV4cG9ydCB0eXBlIEZsb3dFdmVudCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBzZXE6IG51bWJlclxuICB0czogbnVtYmVyXG4gIGtpbmQ6IEZsb3dFdmVudEtpbmRcbiAgc291cmNlOiBFdmlkZW5jZVNvdXJjZSB8ICdjb21tYW5kJ1xuICAvKiogRW50aXR5IHRoZSBldmVudCBpcyBhYm91dCAoYWdlbnQsIHRhc2ssIHJ1biwgd29ya3RyZWUgaWQpLiAqL1xuICBlbnRpdHlJZDogc3RyaW5nXG4gIC8qKiBGb3IgaGFuZG9mZnMvbWVzc2FnZXM6IHRoZSBvdGhlciBlbmQsIHNvIHRoZSBVSSBjYW4gYW5pbWF0ZSB0aGF0IGVkZ2UuICovXG4gIHRhcmdldElkPzogc3RyaW5nIHwgbnVsbFxuICBydW5JZD86IHN0cmluZyB8IG51bGxcbiAgc3VtbWFyeTogc3RyaW5nXG59XG5cbmV4cG9ydCB0eXBlIEVudGl0eVBhdGNoID1cbiAgfCB7IGVudGl0eTogJ2FnZW50JzsgaWQ6IHN0cmluZzsgdmFsdWU6IEFnZW50UmVjb3JkIHwgbnVsbCB9XG4gIHwgeyBlbnRpdHk6ICd0YXNrJzsgaWQ6IHN0cmluZzsgdmFsdWU6IFRhc2tSZWNvcmQgfCBudWxsIH1cbiAgfCB7IGVudGl0eTogJ3J1bic7IGlkOiBzdHJpbmc7IHZhbHVlOiBSdW5SZWNvcmQgfCBudWxsIH1cbiAgfCB7IGVudGl0eTogJ2dhdGUnOyBpZDogc3RyaW5nOyB2YWx1ZTogR2F0ZVJlY29yZCB8IG51bGwgfVxuICB8IHsgZW50aXR5OiAnd29ya3RyZWUnOyBpZDogc3RyaW5nOyB2YWx1ZTogV29ya3RyZWVSZWNvcmQgfCBudWxsIH1cbiAgfCB7IGVudGl0eTogJ2FjY291bnQnOyBpZDogc3RyaW5nOyB2YWx1ZTogQWNjb3VudFJlY29yZCB8IG51bGwgfVxuICB8IHsgZW50aXR5OiAncHJvamVjdCc7IGlkOiBzdHJpbmc7IHZhbHVlOiBQcm9qZWN0UmVjb3JkIHwgbnVsbCB9XG4gIHwgeyBlbnRpdHk6ICdtZXNzYWdlJzsgaWQ6IHN0cmluZzsgdmFsdWU6IE1lc3NhZ2VSZWNvcmQgfVxuICB8IHsgZW50aXR5OiAndG9vbENhbGwnOyBpZDogc3RyaW5nOyB2YWx1ZTogVG9vbENhbGxSZWNvcmQgfVxuICB8IHsgZW50aXR5OiAnY2FwYWJpbGl0aWVzJzsgaWQ6ICdjYXBhYmlsaXRpZXMnOyB2YWx1ZTogQ2FwYWJpbGl0aWVzIH1cbiAgfCB7IGVudGl0eTogJ2xhYmVscyc7IGlkOiAnbGFiZWxzJzsgdmFsdWU6IExhYmVsQ29uZmlnIH1cblxuLyoqIE9yZGVyZWQgZGVsdGEgdGhlIHdvcmtlciBwdXNoZXM7IGBmcm9tU2VxYCBtdXN0IGVxdWFsIHRoZSBjbGllbnQncyBzZXEgb3IgaXQgcmUtc25hcHNob3RzLiAqL1xuZXhwb3J0IHR5cGUgRmxvd0RlbHRhID0ge1xuICBmcm9tU2VxOiBudW1iZXJcbiAgdG9TZXE6IG51bWJlclxuICBwYXRjaGVzOiBFbnRpdHlQYXRjaFtdXG4gIGV2ZW50czogRmxvd0V2ZW50W11cbn1cblxuZXhwb3J0IHR5cGUgRmxvd1NuYXBzaG90ID0ge1xuICBzdGF0ZTogRmxvd1N0YXRlXG4gIGV2ZW50czogRmxvd0V2ZW50W11cbn1cblxuZXhwb3J0IGNvbnN0IE1BWF9NRVNTQUdFUyA9IDMwMFxuZXhwb3J0IGNvbnN0IE1BWF9UT09MX0NBTExTID0gMzAwXG5leHBvcnQgY29uc3QgTUFYX1RJTUVMSU5FID0gMTAwMFxuXG4vKiogQXBwbGllcyBhIHBhdGNoIHRvIGEgc3RhdGUgY29weSBpbiBwbGFjZS4gU2hhcmVkIHNvIFVJIGFuZCB3b3JrZXIgYWdyZWUgYnl0ZSBmb3IgYnl0ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVBhdGNoKHN0YXRlOiBGbG93U3RhdGUsIHBhdGNoOiBFbnRpdHlQYXRjaCk6IHZvaWQge1xuICBzd2l0Y2ggKHBhdGNoLmVudGl0eSkge1xuICAgIGNhc2UgJ2FnZW50JzpcbiAgICAgIHNldE9yRGVsZXRlKHN0YXRlLmFnZW50cywgcGF0Y2guaWQsIHBhdGNoLnZhbHVlKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd0YXNrJzpcbiAgICAgIHNldE9yRGVsZXRlKHN0YXRlLnRhc2tzLCBwYXRjaC5pZCwgcGF0Y2gudmFsdWUpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3J1bic6XG4gICAgICBzZXRPckRlbGV0ZShzdGF0ZS5ydW5zLCBwYXRjaC5pZCwgcGF0Y2gudmFsdWUpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2dhdGUnOlxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUuZ2F0ZXMsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnd29ya3RyZWUnOlxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUud29ya3RyZWVzLCBwYXRjaC5pZCwgcGF0Y2gudmFsdWUpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FjY291bnQnOlxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUuYWNjb3VudHMsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAncHJvamVjdCc6XG4gICAgICAvLyBPbGRlciBzbmFwc2hvdHMgaGF2ZSBubyBwcm9qZWN0cyBtYXAuXG4gICAgICBzdGF0ZS5wcm9qZWN0cyA/Pz0ge31cbiAgICAgIHNldE9yRGVsZXRlKHN0YXRlLnByb2plY3RzLCBwYXRjaC5pZCwgcGF0Y2gudmFsdWUpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ21lc3NhZ2UnOiB7XG4gICAgICBjb25zdCBpbmRleCA9IHN0YXRlLm1lc3NhZ2VzLmZpbmRJbmRleCgobWVzc2FnZSkgPT4gbWVzc2FnZS5pZCA9PT0gcGF0Y2guaWQpXG4gICAgICBpZiAoaW5kZXggPj0gMCkgc3RhdGUubWVzc2FnZXNbaW5kZXhdID0gcGF0Y2gudmFsdWVcbiAgICAgIGVsc2Ugc3RhdGUubWVzc2FnZXMucHVzaChwYXRjaC52YWx1ZSlcbiAgICAgIGlmIChzdGF0ZS5tZXNzYWdlcy5sZW5ndGggPiBNQVhfTUVTU0FHRVMpIHN0YXRlLm1lc3NhZ2VzLnNwbGljZSgwLCBzdGF0ZS5tZXNzYWdlcy5sZW5ndGggLSBNQVhfTUVTU0FHRVMpXG4gICAgICBicmVha1xuICAgIH1cbiAgICBjYXNlICd0b29sQ2FsbCc6IHtcbiAgICAgIGNvbnN0IGluZGV4ID0gc3RhdGUudG9vbENhbGxzLmZpbmRJbmRleCgoY2FsbCkgPT4gY2FsbC5pZCA9PT0gcGF0Y2guaWQpXG4gICAgICBpZiAoaW5kZXggPj0gMCkgc3RhdGUudG9vbENhbGxzW2luZGV4XSA9IHBhdGNoLnZhbHVlXG4gICAgICBlbHNlIHN0YXRlLnRvb2xDYWxscy5wdXNoKHBhdGNoLnZhbHVlKVxuICAgICAgaWYgKHN0YXRlLnRvb2xDYWxscy5sZW5ndGggPiBNQVhfVE9PTF9DQUxMUykgc3RhdGUudG9vbENhbGxzLnNwbGljZSgwLCBzdGF0ZS50b29sQ2FsbHMubGVuZ3RoIC0gTUFYX1RPT0xfQ0FMTFMpXG4gICAgICBicmVha1xuICAgIH1cbiAgICBjYXNlICdjYXBhYmlsaXRpZXMnOlxuICAgICAgc3RhdGUuY2FwYWJpbGl0aWVzID0gcGF0Y2gudmFsdWVcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbGFiZWxzJzpcbiAgICAgIHN0YXRlLmxhYmVscyA9IHBhdGNoLnZhbHVlXG4gICAgICBicmVha1xuICB9XG59XG5cbmZ1bmN0aW9uIHNldE9yRGVsZXRlPFQ+KG1hcDogUmVjb3JkPHN0cmluZywgVD4sIGlkOiBzdHJpbmcsIHZhbHVlOiBUIHwgbnVsbCk6IHZvaWQge1xuICBpZiAodmFsdWUgPT09IG51bGwpIGRlbGV0ZSBtYXBbaWRdXG4gIGVsc2UgbWFwW2lkXSA9IHZhbHVlXG59XG4iLCAiLy8gVGhlIHNpbmdsZSBhdXRob3JpdGF0aXZlIEFnZW50IEZsb3cgc3RhdGUuIEFkYXB0ZXJzIHdyaXRlIG9ic2VydmF0aW9ucyBoZXJlOyB0aGUgc3RvcmUga2VlcHNcbi8vIG9yZGVyaW5nIChzZXEpLCBkcm9wcyBkdXBsaWNhdGVzLCByZWZ1c2VzIHN0YWxlIG9ic2VydmF0aW9ucyBhbmQgYmF0Y2hlcyBkZWx0YXMgZm9yIHRoZSBVSXMuXG5pbXBvcnQgeyBhcHBseVBhdGNoLCBNQVhfVElNRUxJTkUsIHR5cGUgRW50aXR5UGF0Y2gsIHR5cGUgRmxvd0RlbHRhLCB0eXBlIEZsb3dFdmVudCwgdHlwZSBGbG93RXZlbnRLaW5kLCB0eXBlIEZsb3dTbmFwc2hvdCB9IGZyb20gJy4uLy4uL3NoYXJlZC9ldmVudHMudHMnXG5pbXBvcnQgeyBFTVBUWV9MQUJFTFMsIGVtcHR5U3RhdGUsIHR5cGUgQWdlbnRSZWNvcmQsIHR5cGUgRmxvd1N0YXRlLCB0eXBlIFRhc2tSZWNvcmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5cbnR5cGUgTGlzdGVuZXIgPSAoZGVsdGE6IEZsb3dEZWx0YSkgPT4gdm9pZFxuXG5leHBvcnQgdHlwZSBFdmVudElucHV0ID0gT21pdDxGbG93RXZlbnQsICdzZXEnIHwgJ2lkJz4gJiB7IGlkPzogc3RyaW5nIH1cblxuY29uc3QgREVEVVBFX0xJTUlUID0gNTAwMFxuY29uc3QgU1RBVEVfS0VZUyA9IG5ldyBTZXQoWydzdGF0ZScsICdsaXZlJywgJ291dGNvbWUnLCAnc3RhdGVTaW5jZScsICdlbmRlZEF0J10pXG5cbmV4cG9ydCBjbGFzcyBGbG93U3RvcmUge1xuICBwcml2YXRlIHN0YXRlOiBGbG93U3RhdGUgPSBlbXB0eVN0YXRlKClcbiAgcHJpdmF0ZSB0aW1lbGluZTogRmxvd0V2ZW50W10gPSBbXVxuICBwcml2YXRlIHBlbmRpbmdQYXRjaGVzID0gbmV3IE1hcDxzdHJpbmcsIEVudGl0eVBhdGNoPigpXG4gIHByaXZhdGUgcGVuZGluZ0V2ZW50czogRmxvd0V2ZW50W10gPSBbXVxuICBwcml2YXRlIHBlbmRpbmdGcm9tU2VxID0gMFxuICBwcml2YXRlIGxpc3RlbmVycyA9IG5ldyBTZXQ8TGlzdGVuZXI+KClcbiAgcHJpdmF0ZSBzZWVuRXZlbnRJZHMgPSBuZXcgU2V0PHN0cmluZz4oKVxuICAvKiogb2JzZXJ2ZWRBdCBvZiB0aGUgbGFzdCBhY2NlcHRlZCBzdGF0ZSBwZXIgYWdlbnQsIHNvIGFuIG9sZGVyIHBvbGwgbmV2ZXIgb3ZlcndyaXRlcyBhIG5ld2VyIGV2ZW50LiAqL1xuICBwcml2YXRlIGFnZW50T2JzZXJ2ZWRBdCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KClcbiAgcHJpdmF0ZSBmbHVzaFRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgZXZlbnRDb3VudGVyID0gMFxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZmx1c2hNcyA9IDI1MCkge31cblxuICBnZXQgc2VxKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGUuc2VxXG4gIH1cblxuICByZWFkKCk6IFJlYWRvbmx5PEZsb3dTdGF0ZT4ge1xuICAgIHJldHVybiB0aGlzLnN0YXRlXG4gIH1cblxuICBzbmFwc2hvdCgpOiBGbG93U25hcHNob3Qge1xuICAgIHRoaXMuZmx1c2hOb3coKVxuICAgIHJldHVybiB7IHN0YXRlOiBzdHJ1Y3R1cmVkQ2xvbmUodGhpcy5zdGF0ZSksIGV2ZW50czogdGhpcy50aW1lbGluZS5zbGljZSgtTUFYX1RJTUVMSU5FKSB9XG4gIH1cblxuICBldmVudHMoKTogcmVhZG9ubHkgRmxvd0V2ZW50W10ge1xuICAgIHJldHVybiB0aGlzLnRpbWVsaW5lXG4gIH1cblxuICBzdWJzY3JpYmUobGlzdGVuZXI6IExpc3RlbmVyKTogKCkgPT4gdm9pZCB7XG4gICAgdGhpcy5saXN0ZW5lcnMuYWRkKGxpc3RlbmVyKVxuICAgIHJldHVybiAoKSA9PiB0aGlzLmxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpXG4gIH1cblxuICAvKiogUmVzdG9yZXMgYSBwZXJzaXN0ZWQgc25hcHNob3Q7IGxpdmUgYWRhcHRlcnMgcmUtY29uZmlybSBldmVyeXRoaW5nIGFmdGVyd2FyZHMuICovXG4gIHJlc3RvcmUoc25hcHNob3Q6IEZsb3dTbmFwc2hvdCk6IHZvaWQge1xuICAgIGNvbnN0IHJlc3RvcmVkID0gc25hcHNob3Quc3RhdGVcbiAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXMocmVzdG9yZWQuYWdlbnRzKSkge1xuICAgICAgLy8gTm90aGluZyByZXN0b3JlZCBmcm9tIGRpc2sgY291bnRzIGFzIGxpdmUgdW50aWwgcnVudGltZSBldmlkZW5jZSBzYXlzIHNvIGFnYWluLlxuICAgICAgYWdlbnQubGl2ZSA9IGZhbHNlXG4gICAgICBpZiAoYWdlbnQuc3RhdGUgPT09ICd3b3JraW5nJyB8fCBhZ2VudC5zdGF0ZSA9PT0gJ2Jsb2NrZWQnIHx8IGFnZW50LnN0YXRlID09PSAnd2FpdGluZycpIGFnZW50LnN0YXRlID0gJ3Vua25vd24nXG4gICAgfVxuICAgIHRoaXMuc3RhdGUgPSB7IC4uLnJlc3RvcmVkLCBwcm9qZWN0czogcmVzdG9yZWQucHJvamVjdHMgPz8ge30sIGxhYmVsczogeyAuLi5FTVBUWV9MQUJFTFMsIC4uLnJlc3RvcmVkLmxhYmVscyB9LCBzZXE6IE1hdGgubWF4KHJlc3RvcmVkLnNlcSwgdGhpcy5zdGF0ZS5zZXEpICsgMSB9XG4gICAgdGhpcy50aW1lbGluZSA9IHNuYXBzaG90LmV2ZW50cy5zbGljZSgtTUFYX1RJTUVMSU5FKVxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgdGhpcy50aW1lbGluZSkgdGhpcy5zZWVuRXZlbnRJZHMuYWRkKGV2ZW50LmlkKVxuICAgIHRoaXMuZW1pdFJlc2V0KClcbiAgfVxuXG4gIC8qKiBNZXJnZXMgYW4gYWdlbnQgb2JzZXJ2YXRpb24uIGBvYnNlcnZlZEF0YCBvcmRlcnMgY29tcGV0aW5nIHNvdXJjZXMuICovXG4gIHVwc2VydEFnZW50KGlkOiBzdHJpbmcsIG9ic2VydmVkQXQ6IG51bWJlciwgcGFydGlhbDogUGFydGlhbDxBZ2VudFJlY29yZD4sIGNyZWF0ZTogKCkgPT4gQWdlbnRSZWNvcmQpOiBBZ2VudFJlY29yZCB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnN0YXRlLmFnZW50c1tpZF1cbiAgICBjb25zdCBiYXNlID0gZXhpc3RpbmcgPz8gY3JlYXRlKClcbiAgICBjb25zdCBuZXh0OiBBZ2VudFJlY29yZCA9IHsgLi4uYmFzZSB9XG4gICAgY29uc3QgdG91Y2hlc1N0YXRlID0gT2JqZWN0LmtleXMocGFydGlhbCkuc29tZSgoa2V5KSA9PiBTVEFURV9LRVlTLmhhcyhrZXkpICYmIHBhcnRpYWxba2V5IGFzIGtleW9mIEFnZW50UmVjb3JkXSAhPT0gdW5kZWZpbmVkKVxuICAgIGNvbnN0IGxhc3RPYnNlcnZlZCA9IHRoaXMuYWdlbnRPYnNlcnZlZEF0LmdldChpZCkgPz8gMFxuICAgIC8vIFJ1bnRpbWUgc3RhdGUgaXMgb3JkZXJlZCBieSBvYnNlcnZhdGlvbiB0aW1lOiBhbiBvbGRlciBwb2xsIG5ldmVyIG92ZXJ3cml0ZXMgYSBuZXdlciBldmVudC5cbiAgICBjb25zdCBzdGFsZSA9IHRvdWNoZXNTdGF0ZSAmJiBvYnNlcnZlZEF0IDwgbGFzdE9ic2VydmVkXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFydGlhbCkgYXMgW2tleW9mIEFnZW50UmVjb3JkLCB1bmtub3duXVtdKSB7XG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCBrZXkgPT09ICdldmlkZW5jZScpIGNvbnRpbnVlXG4gICAgICBpZiAoc3RhbGUgJiYgU1RBVEVfS0VZUy5oYXMoa2V5KSkgY29udGludWVcbiAgICAgIDsobmV4dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilba2V5XSA9IHZhbHVlXG4gICAgfVxuICAgIGlmIChwYXJ0aWFsLmV2aWRlbmNlKSBuZXh0LmV2aWRlbmNlID0gWy4uLm5ldyBTZXQoWy4uLihiYXNlLmV2aWRlbmNlID8/IFtdKSwgLi4ucGFydGlhbC5ldmlkZW5jZV0pXVxuICAgIG5leHQubGFzdFNlZW5BdCA9IE1hdGgubWF4KGJhc2UubGFzdFNlZW5BdCA/PyAwLCBvYnNlcnZlZEF0KVxuICAgIGlmICh0b3VjaGVzU3RhdGUgJiYgIXN0YWxlKSB0aGlzLmFnZW50T2JzZXJ2ZWRBdC5zZXQoaWQsIG9ic2VydmVkQXQpXG4gICAgaWYgKGV4aXN0aW5nICYmIHNhbWVSZWNvcmQoZXhpc3RpbmcsIG5leHQpKSByZXR1cm4gZXhpc3RpbmdcbiAgICBuZXh0LnZlcnNpb24gPSAoYmFzZS52ZXJzaW9uID8/IDApICsgMVxuICAgIHRoaXMucGF0Y2goeyBlbnRpdHk6ICdhZ2VudCcsIGlkLCB2YWx1ZTogbmV4dCB9KVxuICAgIHJldHVybiBuZXh0XG4gIH1cblxuICB1cHNlcnRUYXNrKHRhc2s6IFRhc2tSZWNvcmQpOiBUYXNrUmVjb3JkIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuc3RhdGUudGFza3NbdGFzay5pZF1cbiAgICBpZiAoZXhpc3RpbmcgJiYgc2FtZVJlY29yZChleGlzdGluZywgeyAuLi50YXNrLCB2ZXJzaW9uOiBleGlzdGluZy52ZXJzaW9uIH0pKSByZXR1cm4gZXhpc3RpbmdcbiAgICBjb25zdCBuZXh0ID0geyAuLi50YXNrLCB2ZXJzaW9uOiAoZXhpc3Rpbmc/LnZlcnNpb24gPz8gMCkgKyAxIH1cbiAgICB0aGlzLnBhdGNoKHsgZW50aXR5OiAndGFzaycsIGlkOiB0YXNrLmlkLCB2YWx1ZTogbmV4dCB9KVxuICAgIHJldHVybiBuZXh0XG4gIH1cblxuICAvKiogR2VuZXJpYyB1cHNlcnQgZm9yIHJlY29yZHMgY29tcGFyZWQgYnkgY29udGVudC4gKi9cbiAgcHV0KHBhdGNoOiBFbnRpdHlQYXRjaCk6IHZvaWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmN1cnJlbnRWYWx1ZShwYXRjaClcbiAgICBpZiAoY3VycmVudCAhPT0gdW5kZWZpbmVkICYmIHBhdGNoLnZhbHVlICE9PSBudWxsICYmIHNhbWVSZWNvcmQoY3VycmVudCwgcGF0Y2gudmFsdWUpKSByZXR1cm5cbiAgICBpZiAoY3VycmVudCA9PT0gdW5kZWZpbmVkICYmIHBhdGNoLnZhbHVlID09PSBudWxsKSByZXR1cm5cbiAgICB0aGlzLnBhdGNoKHBhdGNoKVxuICB9XG5cbiAgcmVtb3ZlQWdlbnQoaWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghdGhpcy5zdGF0ZS5hZ2VudHNbaWRdKSByZXR1cm5cbiAgICB0aGlzLmFnZW50T2JzZXJ2ZWRBdC5kZWxldGUoaWQpXG4gICAgdGhpcy5wYXRjaCh7IGVudGl0eTogJ2FnZW50JywgaWQsIHZhbHVlOiBudWxsIH0pXG4gIH1cblxuICBlbWl0KGlucHV0OiBFdmVudElucHV0KTogRmxvd0V2ZW50IHwgbnVsbCB7XG4gICAgY29uc3QgaWQgPSBpbnB1dC5pZCA/PyBgJHtpbnB1dC5raW5kfToke2lucHV0LmVudGl0eUlkfToke2lucHV0LnRzfTokeysrdGhpcy5ldmVudENvdW50ZXJ9YFxuICAgIGlmICh0aGlzLnNlZW5FdmVudElkcy5oYXMoaWQpKSByZXR1cm4gbnVsbFxuICAgIHRoaXMuc2VlbkV2ZW50SWRzLmFkZChpZClcbiAgICBpZiAodGhpcy5zZWVuRXZlbnRJZHMuc2l6ZSA+IERFRFVQRV9MSU1JVCkge1xuICAgICAgY29uc3QgZmlyc3QgPSB0aGlzLnNlZW5FdmVudElkcy52YWx1ZXMoKS5uZXh0KCkudmFsdWVcbiAgICAgIGlmIChmaXJzdCAhPT0gdW5kZWZpbmVkKSB0aGlzLnNlZW5FdmVudElkcy5kZWxldGUoZmlyc3QpXG4gICAgfVxuICAgIGNvbnN0IGV2ZW50OiBGbG93RXZlbnQgPSB7IC4uLmlucHV0LCBpZCwgc2VxOiB0aGlzLmJ1bXBTZXEoKSB9XG4gICAgdGhpcy50aW1lbGluZS5wdXNoKGV2ZW50KVxuICAgIGlmICh0aGlzLnRpbWVsaW5lLmxlbmd0aCA+IE1BWF9USU1FTElORSAqIDIpIHRoaXMudGltZWxpbmUuc3BsaWNlKDAsIHRoaXMudGltZWxpbmUubGVuZ3RoIC0gTUFYX1RJTUVMSU5FKVxuICAgIHRoaXMucGVuZGluZ0V2ZW50cy5wdXNoKGV2ZW50KVxuICAgIHRoaXMuc2NoZWR1bGVGbHVzaCgpXG4gICAgcmV0dXJuIGV2ZW50XG4gIH1cblxuICBoYXNFdmVudChraW5kOiBGbG93RXZlbnRLaW5kLCBlbnRpdHlJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMudGltZWxpbmUuc29tZSgoZXZlbnQpID0+IGV2ZW50LmtpbmQgPT09IGtpbmQgJiYgZXZlbnQuZW50aXR5SWQgPT09IGVudGl0eUlkKVxuICB9XG5cbiAgZmx1c2hOb3coKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZmx1c2hUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuZmx1c2hUaW1lcilcbiAgICAgIHRoaXMuZmx1c2hUaW1lciA9IG51bGxcbiAgICB9XG4gICAgaWYgKHRoaXMucGVuZGluZ1BhdGNoZXMuc2l6ZSA9PT0gMCAmJiB0aGlzLnBlbmRpbmdFdmVudHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBjb25zdCBkZWx0YTogRmxvd0RlbHRhID0ge1xuICAgICAgZnJvbVNlcTogdGhpcy5wZW5kaW5nRnJvbVNlcSxcbiAgICAgIHRvU2VxOiB0aGlzLnN0YXRlLnNlcSxcbiAgICAgIHBhdGNoZXM6IFsuLi50aGlzLnBlbmRpbmdQYXRjaGVzLnZhbHVlcygpXSxcbiAgICAgIGV2ZW50czogdGhpcy5wZW5kaW5nRXZlbnRzXG4gICAgfVxuICAgIHRoaXMucGVuZGluZ1BhdGNoZXMgPSBuZXcgTWFwKClcbiAgICB0aGlzLnBlbmRpbmdFdmVudHMgPSBbXVxuICAgIHRoaXMucGVuZGluZ0Zyb21TZXEgPSB0aGlzLnN0YXRlLnNlcVxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5saXN0ZW5lcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxpc3RlbmVyKGRlbHRhKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIG9uZSBicm9rZW4gbGlzdGVuZXIgbXVzdCBub3Qgc3RvcCB0aGUgb3RoZXJzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5mbHVzaFRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5mbHVzaFRpbWVyKVxuICAgIHRoaXMubGlzdGVuZXJzLmNsZWFyKClcbiAgfVxuXG4gIHByaXZhdGUgcGF0Y2gocGF0Y2g6IEVudGl0eVBhdGNoKTogdm9pZCB7XG4gICAgYXBwbHlQYXRjaCh0aGlzLnN0YXRlLCBwYXRjaClcbiAgICB0aGlzLmJ1bXBTZXEoKVxuICAgIHRoaXMucGVuZGluZ1BhdGNoZXMuc2V0KGAke3BhdGNoLmVudGl0eX06JHtwYXRjaC5pZH1gLCBwYXRjaClcbiAgICB0aGlzLnNjaGVkdWxlRmx1c2goKVxuICB9XG5cbiAgcHJpdmF0ZSBidW1wU2VxKCk6IG51bWJlciB7XG4gICAgaWYgKHRoaXMucGVuZGluZ1BhdGNoZXMuc2l6ZSA9PT0gMCAmJiB0aGlzLnBlbmRpbmdFdmVudHMubGVuZ3RoID09PSAwICYmICF0aGlzLmZsdXNoVGltZXIpIHRoaXMucGVuZGluZ0Zyb21TZXEgPSB0aGlzLnN0YXRlLnNlcVxuICAgIHRoaXMuc3RhdGUuc2VxICs9IDFcbiAgICB0aGlzLnN0YXRlLmdlbmVyYXRlZEF0ID0gRGF0ZS5ub3coKVxuICAgIHJldHVybiB0aGlzLnN0YXRlLnNlcVxuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZUZsdXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmZsdXNoVGltZXIpIHJldHVyblxuICAgIHRoaXMuZmx1c2hUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5mbHVzaFRpbWVyID0gbnVsbFxuICAgICAgdGhpcy5mbHVzaE5vdygpXG4gICAgfSwgdGhpcy5mbHVzaE1zKVxuICB9XG5cbiAgLyoqIFRlbGxzIGV2ZXJ5IGNsaWVudCB0byByZS1zbmFwc2hvdCAoZnJvbVNlcSB0aGF0IGNhbiBuZXZlciBtYXRjaCkuICovXG4gIHByaXZhdGUgZW1pdFJlc2V0KCk6IHZvaWQge1xuICAgIGNvbnN0IGRlbHRhOiBGbG93RGVsdGEgPSB7IGZyb21TZXE6IC0xLCB0b1NlcTogdGhpcy5zdGF0ZS5zZXEsIHBhdGNoZXM6IFtdLCBldmVudHM6IFtdIH1cbiAgICB0aGlzLnBlbmRpbmdGcm9tU2VxID0gdGhpcy5zdGF0ZS5zZXFcbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMubGlzdGVuZXJzKSBsaXN0ZW5lcihkZWx0YSlcbiAgfVxuXG4gIHByaXZhdGUgY3VycmVudFZhbHVlKHBhdGNoOiBFbnRpdHlQYXRjaCk6IHVua25vd24ge1xuICAgIHN3aXRjaCAocGF0Y2guZW50aXR5KSB7XG4gICAgICBjYXNlICdhZ2VudCc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLmFnZW50c1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ3Rhc2snOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS50YXNrc1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ3J1bic6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLnJ1bnNbcGF0Y2guaWRdXG4gICAgICBjYXNlICdnYXRlJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUuZ2F0ZXNbcGF0Y2guaWRdXG4gICAgICBjYXNlICd3b3JrdHJlZSc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLndvcmt0cmVlc1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ2FjY291bnQnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS5hY2NvdW50c1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ3Byb2plY3QnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS5wcm9qZWN0cz8uW3BhdGNoLmlkXVxuICAgICAgY2FzZSAnbWVzc2FnZSc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLm1lc3NhZ2VzLmZpbmQoKG1lc3NhZ2UpID0+IG1lc3NhZ2UuaWQgPT09IHBhdGNoLmlkKVxuICAgICAgY2FzZSAndG9vbENhbGwnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS50b29sQ2FsbHMuZmluZCgoY2FsbCkgPT4gY2FsbC5pZCA9PT0gcGF0Y2guaWQpXG4gICAgICBjYXNlICdjYXBhYmlsaXRpZXMnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS5jYXBhYmlsaXRpZXNcbiAgICAgIGNhc2UgJ2xhYmVscyc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLmxhYmVsc1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzYW1lUmVjb3JkKGE6IHVua25vd24sIGI6IHVua25vd24pOiBib29sZWFuIHtcbiAgY29uc3Qgc3RyaXAgPSAodmFsdWU6IHVua25vd24pID0+IHtcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHsgdmVyc2lvbjogX3ZlcnNpb24sIGxhc3RTZWVuQXQ6IF9sYXN0U2VlbiwgLi4ucmVzdCB9ID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgICAgIHJldHVybiByZXN0XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZVxuICB9XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShzdHJpcChhKSkgPT09IEpTT04uc3RyaW5naWZ5KHN0cmlwKGIpKVxufVxuIiwgIi8vIEtub3dzIHdoZXRoZXIgYW55b25lIGlzIGxvb2tpbmcgYXQgQWdlbnQgRmxvdywgc28gYmFja2dyb3VuZCBzY2FucyBjYW4gc2xvdyBkb3duIHdoZW4gbm9ib2R5IGlzLlxuLy8gRXZlcnkgcmVxdWVzdCBmcm9tIGEgcGFuZWwgb3IgdGhlIGRhc2hib2FyZCBjb3VudHM7IHZpc2libGUgVUlzIGFsc28gcGluZyAodmlld2VyLnBpbmcpLlxuXG4vKiogTm8gcmVxdWVzdCBmb3IgdGhpcyBsb25nIG1lYW5zIG5vYm9keSBpcyB3YXRjaGluZy4gVUlzIHBpbmcgZXZlcnkgMzAgcyB3aGlsZSB2aXNpYmxlLiAqL1xuZXhwb3J0IGNvbnN0IFZJRVdFUl9JRExFX01TID0gNzVfMDAwXG5cbmV4cG9ydCBjbGFzcyBWaWV3ZXJUcmFja2VyIHtcbiAgcHJpdmF0ZSBsYXN0U2VlbiA9IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXIsXG4gICAgcHJpdmF0ZSByZWFkb25seSBpZGxlQWZ0ZXJNcyA9IFZJRVdFUl9JRExFX01TXG4gICkge31cblxuICAvKiogUmVjb3JkcyBhY3Rpdml0eS4gUmV0dXJucyB0cnVlIHdoZW4gdGhpcyBlbmRzIGFuIGlkbGUgc3RyZXRjaCAodGltZSB0byByZWZyZXNoIHJpZ2h0IGF3YXkpLiAqL1xuICB0b3VjaCgpOiBib29sZWFuIHtcbiAgICBjb25zdCB3YXNJZGxlID0gdGhpcy5pZGxlXG4gICAgdGhpcy5sYXN0U2VlbiA9IHRoaXMubm93KClcbiAgICByZXR1cm4gd2FzSWRsZVxuICB9XG5cbiAgZ2V0IGlkbGUoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMubm93KCkgLSB0aGlzLmxhc3RTZWVuID4gdGhpcy5pZGxlQWZ0ZXJNc1xuICB9XG5cbiAgLyoqIFRoZSBmYXN0IGludGVydmFsIHdoaWxlIHdhdGNoZWQsIHRoZSBzbG93IG9uZSBvdGhlcndpc2UuICovXG4gIHBhY2Uod2F0Y2hlZE1zOiBudW1iZXIsIGlkbGVNczogbnVtYmVyKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pZGxlID8gaWRsZU1zIDogd2F0Y2hlZE1zXG4gIH1cbn1cbiIsICIvLyBMaXZlIG91dHB1dDogd2F0Y2hlcyB0aGUgdHJhbnNjcmlwdCBmaWxlIG9mIGVhY2ggY29udmVyc2F0aW9uIHNvbWVvbmUgaGFzIG9wZW4gYW5kIHNheXMgd2hlblxuLy8gaXQgY2hhbmdlcywgc28gdmlld3MgZmV0Y2ggcmlnaHQgYXdheSBpbnN0ZWFkIG9mIHBvbGxpbmcuIE9ubHkgZmlsZXMgYSB2aWV3IHJlYWQgcmVjZW50bHkgYXJlXG4vLyB3YXRjaGVkLCBhIGZldyBhdCBtb3N0LCBhbmQgYSB3YXRjaCBlbmRzIGJ5IGl0c2VsZiBvbmNlIG5vYm9keSBoYXMgcmVhZCBpdCBmb3IgYSBtaW51dGUuXG5pbXBvcnQgeyB3YXRjaCwgdHlwZSBGU1dhdGNoZXIgfSBmcm9tICdub2RlOmZzJ1xuXG50eXBlIFdhdGNoID0geyBwYXRoOiBzdHJpbmc7IHdhdGNoZXI6IEZTV2F0Y2hlcjsgbGFzdFJlYWQ6IG51bWJlcjsgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCB9XG5cbmV4cG9ydCB0eXBlIFdhdGNoRmFjdG9yeSA9IChwYXRoOiBzdHJpbmcsIG9uQ2hhbmdlOiAoKSA9PiB2b2lkKSA9PiBGU1dhdGNoZXJcblxuY29uc3Qgbm9kZVdhdGNoOiBXYXRjaEZhY3RvcnkgPSAocGF0aCwgb25DaGFuZ2UpID0+IHdhdGNoKHBhdGgsIHsgcGVyc2lzdGVudDogZmFsc2UgfSwgb25DaGFuZ2UpXG5cbmV4cG9ydCBjbGFzcyBPdXRwdXRXYXRjaGVyIHtcbiAgcHJpdmF0ZSB3YXRjaGVzID0gbmV3IE1hcDxzdHJpbmcsIFdhdGNoPigpXG4gIHByaXZhdGUgbGlzdGVuZXJzID0gbmV3IFNldDwoYWdlbnRJZDogc3RyaW5nKSA9PiB2b2lkPigpXG4gIC8qKiBBZ2VudHMgd2l0aG91dCBhIHRyYW5zY3JpcHQgZmlsZSAodGVybWluYWwgb3V0cHV0KTogd2hlbiBhIHZpZXcgbGFzdCByZWFkIHRoZW0uICovXG4gIHByaXZhdGUgaW50ZXJlc3RlZCA9IG5ldyBNYXA8c3RyaW5nLCB7IGxhc3RSZWFkOiBudW1iZXI7IHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGwgfT4oKVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogeyBub3c/OiAoKSA9PiBudW1iZXI7IGlkbGVNcz86IG51bWJlcjsgbWF4PzogbnVtYmVyOyBkZWJvdW5jZU1zPzogbnVtYmVyOyB3YXRjaEZpbGU/OiBXYXRjaEZhY3RvcnkgfSA9IHt9XG4gICkge31cblxuICBwcml2YXRlIGdldCBub3coKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3dcbiAgfVxuXG4gIC8qKiBBIHZpZXcgcmVhZCB0aGlzIGFnZW50J3MgdHJhbnNjcmlwdC4gUmV0dXJucyB0cnVlIHdoZW4gY2hhbmdlcyB3aWxsIGJlIHB1c2hlZC4gKi9cbiAgdHJhY2soYWdlbnRJZDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpXG4gICAgdGhpcy5zd2VlcChub3cpXG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLndhdGNoZXMuZ2V0KGFnZW50SWQpXG4gICAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nLnBhdGggPT09IHBhdGgpIHtcbiAgICAgIGV4aXN0aW5nLmxhc3RSZWFkID0gbm93XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgICBpZiAoZXhpc3RpbmcpIHRoaXMudW50cmFjayhhZ2VudElkKVxuICAgIGNvbnN0IG1heCA9IHRoaXMub3B0aW9ucy5tYXggPz8gOFxuICAgIHdoaWxlICh0aGlzLndhdGNoZXMuc2l6ZSA+PSBtYXgpIHtcbiAgICAgIGNvbnN0IG9sZGVzdCA9IFsuLi50aGlzLndhdGNoZXMuZW50cmllcygpXS5zb3J0KChhLCBiKSA9PiBhWzFdLmxhc3RSZWFkIC0gYlsxXS5sYXN0UmVhZClbMF1cbiAgICAgIHRoaXMudW50cmFjayhvbGRlc3RbMF0pXG4gICAgfVxuICAgIGxldCB3YXRjaGVyOiBGU1dhdGNoZXJcbiAgICB0cnkge1xuICAgICAgd2F0Y2hlciA9ICh0aGlzLm9wdGlvbnMud2F0Y2hGaWxlID8/IG5vZGVXYXRjaCkocGF0aCwgKCkgPT4gdGhpcy5jaGFuZ2VkKGFnZW50SWQpKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHdhdGNoZXIub24/LignZXJyb3InLCAoKSA9PiB0aGlzLnVudHJhY2soYWdlbnRJZCkpXG4gICAgdGhpcy53YXRjaGVzLnNldChhZ2VudElkLCB7IHBhdGgsIHdhdGNoZXIsIGxhc3RSZWFkOiBub3csIHRpbWVyOiBudWxsIH0pXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKiBBIHZpZXcgcmVhZCBvdXRwdXQgdGhhdCBoYXMgbm8gZmlsZSB0byB3YXRjaCAoYSB0ZXJtaW5hbCk7IGV2ZW50cyBjYW4gc3RpbGwgYW5ub3VuY2UgY2hhbmdlcy4gKi9cbiAgbm90ZUludGVyZXN0KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbnRlcmVzdGVkLmdldChhZ2VudElkKVxuICAgIGlmIChlbnRyeSkgZW50cnkubGFzdFJlYWQgPSB0aGlzLm5vdygpXG4gICAgZWxzZSB0aGlzLmludGVyZXN0ZWQuc2V0KGFnZW50SWQsIHsgbGFzdFJlYWQ6IHRoaXMubm93KCksIHRpbWVyOiBudWxsIH0pXG4gICAgaWYgKHRoaXMuaW50ZXJlc3RlZC5zaXplID4gKHRoaXMub3B0aW9ucy5tYXggPz8gOCkgKiA0KSB7XG4gICAgICBjb25zdCBvbGRlc3QgPSBbLi4udGhpcy5pbnRlcmVzdGVkLmVudHJpZXMoKV0uc29ydCgoYSwgYikgPT4gYVsxXS5sYXN0UmVhZCAtIGJbMV0ubGFzdFJlYWQpWzBdXG4gICAgICB0aGlzLmRyb3BJbnRlcmVzdChvbGRlc3RbMF0pXG4gICAgfVxuICB9XG5cbiAgLyoqIFNvbWV0aGluZyBoYXBwZW5lZCB0byB0aGlzIGFnZW50IChzdGF0dXMgY2hhbmdlLCB0b29sIGNhbGwpOiB0ZWxsIHZpZXdzIHNob3dpbmcgaXQuICovXG4gIHBva2UoYWdlbnRJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmludGVyZXN0ZWQuZ2V0KGFnZW50SWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG4gICAgaWYgKHRoaXMubm93KCkgLSBlbnRyeS5sYXN0UmVhZCA+ICh0aGlzLm9wdGlvbnMuaWRsZU1zID8/IDYwXzAwMCkpIHtcbiAgICAgIHRoaXMuZHJvcEludGVyZXN0KGFnZW50SWQpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGVudHJ5LnRpbWVyKSByZXR1cm5cbiAgICBlbnRyeS50aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgZW50cnkudGltZXIgPSBudWxsXG4gICAgICBpZiAoIXRoaXMuaW50ZXJlc3RlZC5oYXMoYWdlbnRJZCkpIHJldHVyblxuICAgICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmxpc3RlbmVycykgbGlzdGVuZXIoYWdlbnRJZClcbiAgICB9LCB0aGlzLm9wdGlvbnMuZGVib3VuY2VNcyA/PyAyNTApXG4gIH1cblxuICBwcml2YXRlIGRyb3BJbnRlcmVzdChhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW50ZXJlc3RlZC5nZXQoYWdlbnRJZClcbiAgICBpZiAoZW50cnk/LnRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZXIpXG4gICAgdGhpcy5pbnRlcmVzdGVkLmRlbGV0ZShhZ2VudElkKVxuICB9XG5cbiAgc3Vic2NyaWJlKGxpc3RlbmVyOiAoYWdlbnRJZDogc3RyaW5nKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgdGhpcy5saXN0ZW5lcnMuYWRkKGxpc3RlbmVyKVxuICAgIHJldHVybiAoKSA9PiB0aGlzLmxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpXG4gIH1cblxuICBnZXQgc2l6ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLndhdGNoZXMuc2l6ZVxuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFsuLi50aGlzLndhdGNoZXMua2V5cygpXSkgdGhpcy51bnRyYWNrKGlkKVxuICAgIGZvciAoY29uc3QgaWQgb2YgWy4uLnRoaXMuaW50ZXJlc3RlZC5rZXlzKCldKSB0aGlzLmRyb3BJbnRlcmVzdChpZClcbiAgICB0aGlzLmxpc3RlbmVycy5jbGVhcigpXG4gIH1cblxuICBwcml2YXRlIGNoYW5nZWQoYWdlbnRJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLndhdGNoZXMuZ2V0KGFnZW50SWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG4gICAgaWYgKHRoaXMubm93KCkgLSBlbnRyeS5sYXN0UmVhZCA+ICh0aGlzLm9wdGlvbnMuaWRsZU1zID8/IDYwXzAwMCkpIHtcbiAgICAgIHRoaXMudW50cmFjayhhZ2VudElkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIC8vIEEgcmVwbHkgYXJyaXZlcyBhcyBtYW55IHNtYWxsIGFwcGVuZHM6IHRlbGwgdmlld3Mgb25jZSBwZXIgYnVyc3QuXG4gICAgaWYgKGVudHJ5LnRpbWVyKSByZXR1cm5cbiAgICBlbnRyeS50aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgZW50cnkudGltZXIgPSBudWxsXG4gICAgICBpZiAoIXRoaXMud2F0Y2hlcy5oYXMoYWdlbnRJZCkpIHJldHVyblxuICAgICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmxpc3RlbmVycykgbGlzdGVuZXIoYWdlbnRJZClcbiAgICB9LCB0aGlzLm9wdGlvbnMuZGVib3VuY2VNcyA/PyAyNTApXG4gIH1cblxuICBwcml2YXRlIHN3ZWVwKG5vdzogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgaWRsZU1zID0gdGhpcy5vcHRpb25zLmlkbGVNcyA/PyA2MF8wMDBcbiAgICBmb3IgKGNvbnN0IFtpZCwgZW50cnldIG9mIHRoaXMud2F0Y2hlcykgaWYgKG5vdyAtIGVudHJ5Lmxhc3RSZWFkID4gaWRsZU1zKSB0aGlzLnVudHJhY2soaWQpXG4gIH1cblxuICBwcml2YXRlIHVudHJhY2soYWdlbnRJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLndhdGNoZXMuZ2V0KGFnZW50SWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG4gICAgaWYgKGVudHJ5LnRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZXIpXG4gICAgdHJ5IHtcbiAgICAgIGVudHJ5LndhdGNoZXIuY2xvc2UoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy53YXRjaGVzLmRlbGV0ZShhZ2VudElkKVxuICB9XG59XG4iLCAiLy8gQSBvbmNlLWluLWEtd2hpbGUgXCJzdGFyIHRoZSBwcm9qZWN0IG9uIEdpdEh1YlwiIHByb21wdC4gU2hvd24gb25seSBhZnRlciByZWFsIHVzZSAodGhyZWUgZGlmZmVyZW50XG4vLyBkYXlzLCBhdCBsZWFzdCB0aHJlZSBkYXlzIGFmdGVyIGZpcnN0IG9wZW5pbmcpLCBuZXZlciB0d2ljZSBpbiBhIHJvdywgYW5kIG5ldmVyIGFnYWluIG9uY2UgdGhlXG4vLyBwZXJzb24gc3RhcnJlZCBpdCBvciBzYWlkIG5vLiBLZXB0IGluIHRoZSBwbHVnaW4ncyBvd24gc3RhdGUgZm9sZGVyLCBzaGFyZWQgYnkgZXZlcnkgdmlldy5cbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVuYW1lLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcblxuZXhwb3J0IGNvbnN0IFNUQVJfUkVQT19VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL1Nva3Bpc2V0aE5ob2V1bi9hZ2VudC1mbG93J1xuY29uc3QgREFZX01TID0gMjQgKiA2MCAqIDYwICogMTAwMFxuY29uc3QgTUlOX0RBWVNfVVNFRCA9IDNcbmNvbnN0IE1JTl9BR0VfTVMgPSAzICogREFZX01TXG5jb25zdCBTTk9PWkVfTVMgPSAzMCAqIERBWV9NU1xuXG5leHBvcnQgdHlwZSBTdGFyQW5zd2VyID0gJ3N0YXJyZWQnIHwgJ2xhdGVyJyB8ICduZXZlcidcbmV4cG9ydCB0eXBlIFN0YXJTdGF0ZSA9IHsgZmlyc3RTZWVuOiBudW1iZXI7IGRheXM6IHN0cmluZ1tdOyBzbm9vemVVbnRpbDogbnVtYmVyOyBkb25lOiBib29sZWFuIH1cblxuZXhwb3J0IGNvbnN0IGZyZXNoU3RhclN0YXRlID0gKG5vdzogbnVtYmVyKTogU3RhclN0YXRlID0+ICh7IGZpcnN0U2Vlbjogbm93LCBkYXlzOiBbXSwgc25vb3plVW50aWw6IDAsIGRvbmU6IGZhbHNlIH0pXG5cbi8qKiBMb2NhbCBjYWxlbmRhciBkYXksIHNvIGEgbGF0ZS1uaWdodCBzZXNzaW9uIGFuZCB0aGUgbmV4dCBtb3JuaW5nIGNvdW50IGFzIHR3byBkYXlzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRheU9mKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdylcbiAgcmV0dXJuIGAke2QuZ2V0RnVsbFllYXIoKX0tJHtTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKX0tJHtTdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyl9YFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkVmlzaXQoc3RhdGU6IFN0YXJTdGF0ZSwgbm93OiBudW1iZXIpOiBTdGFyU3RhdGUge1xuICBjb25zdCBkYXkgPSBkYXlPZihub3cpXG4gIHJldHVybiBzdGF0ZS5kYXlzLmluY2x1ZGVzKGRheSkgPyBzdGF0ZSA6IHsgLi4uc3RhdGUsIGRheXM6IFsuLi5zdGF0ZS5kYXlzLCBkYXldLnNsaWNlKC0xMCkgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkQXNrKHN0YXRlOiBTdGFyU3RhdGUsIG5vdzogbnVtYmVyKTogYm9vbGVhbiB7XG4gIHJldHVybiAhc3RhdGUuZG9uZSAmJiBub3cgPj0gc3RhdGUuc25vb3plVW50aWwgJiYgc3RhdGUuZGF5cy5sZW5ndGggPj0gTUlOX0RBWVNfVVNFRCAmJiBub3cgLSBzdGF0ZS5maXJzdFNlZW4gPj0gTUlOX0FHRV9NU1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlBbnN3ZXIoc3RhdGU6IFN0YXJTdGF0ZSwgYW5zd2VyOiBTdGFyQW5zd2VyLCBub3c6IG51bWJlcik6IFN0YXJTdGF0ZSB7XG4gIHJldHVybiBhbnN3ZXIgPT09ICdsYXRlcicgPyB7IC4uLnN0YXRlLCBzbm9vemVVbnRpbDogbm93ICsgU05PT1pFX01TIH0gOiB7IC4uLnN0YXRlLCBkb25lOiB0cnVlIH1cbn1cblxuZXhwb3J0IGNsYXNzIFN0YXJQcm9tcHRTdG9yZSB7XG4gIHByaXZhdGUgc3RhdGU6IFN0YXJTdGF0ZSB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZTogc3RyaW5nXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBkaXI6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG5vdzogKCkgPT4gbnVtYmVyID0gRGF0ZS5ub3dcbiAgKSB7XG4gICAgdGhpcy5maWxlID0gam9pbihkaXIsICdzdGFyLXByb21wdC5qc29uJylcbiAgfVxuXG4gIC8qKiBSZWNvcmRzIHRvZGF5J3MgdmlzaXQgYW5kIHNheXMgd2hldGhlciB0byBzaG93IHRoZSBwcm9tcHQgbm93LiAqL1xuICBhc3luYyB2aXNpdCgpOiBQcm9taXNlPHsgc2hvdzogYm9vbGVhbjsgdXJsOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHN0YXRlID0gcmVjb3JkVmlzaXQoYXdhaXQgdGhpcy5sb2FkKCksIHRoaXMubm93KCkpXG4gICAgYXdhaXQgdGhpcy5zYXZlKHN0YXRlKVxuICAgIHJldHVybiB7IHNob3c6IHNob3VsZEFzayhzdGF0ZSwgdGhpcy5ub3coKSksIHVybDogU1RBUl9SRVBPX1VSTCB9XG4gIH1cblxuICBhc3luYyBhbnN3ZXIoYW5zd2VyOiBTdGFyQW5zd2VyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlKGFwcGx5QW5zd2VyKGF3YWl0IHRoaXMubG9hZCgpLCBhbnN3ZXIsIHRoaXMubm93KCkpKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkKCk6IFByb21pc2U8U3RhclN0YXRlPiB7XG4gICAgaWYgKHRoaXMuc3RhdGUpIHJldHVybiB0aGlzLnN0YXRlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUodGhpcy5maWxlLCAndXRmOCcpKSBhcyBQYXJ0aWFsPFN0YXJTdGF0ZT5cbiAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgIGZpcnN0U2VlbjogdHlwZW9mIHJhdy5maXJzdFNlZW4gPT09ICdudW1iZXInID8gcmF3LmZpcnN0U2VlbiA6IHRoaXMubm93KCksXG4gICAgICAgIGRheXM6IEFycmF5LmlzQXJyYXkocmF3LmRheXMpID8gcmF3LmRheXMuZmlsdGVyKChkKTogZCBpcyBzdHJpbmcgPT4gdHlwZW9mIGQgPT09ICdzdHJpbmcnKS5zbGljZSgtMTApIDogW10sXG4gICAgICAgIHNub296ZVVudGlsOiB0eXBlb2YgcmF3LnNub296ZVVudGlsID09PSAnbnVtYmVyJyA/IHJhdy5zbm9vemVVbnRpbCA6IDAsXG4gICAgICAgIGRvbmU6IHJhdy5kb25lID09PSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICB0aGlzLnN0YXRlID0gZnJlc2hTdGFyU3RhdGUodGhpcy5ub3coKSlcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2F2ZShzdGF0ZTogU3RhclN0YXRlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKEpTT04uc3RyaW5naWZ5KHN0YXRlKSA9PT0gSlNPTi5zdHJpbmdpZnkodGhpcy5zdGF0ZSkgJiYgdGhpcy5zdGF0ZSkgcmV0dXJuXG4gICAgdGhpcy5zdGF0ZSA9IHN0YXRlXG4gICAgYXdhaXQgbWtkaXIodGhpcy5kaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzcwMCB9KVxuICAgIGNvbnN0IHRtcCA9IGAke3RoaXMuZmlsZX0uJHtwcm9jZXNzLnBpZH0udG1wYFxuICAgIGF3YWl0IHdyaXRlRmlsZSh0bXAsIEpTT04uc3RyaW5naWZ5KHN0YXRlKSwgeyBtb2RlOiAwbzYwMCB9KVxuICAgIGF3YWl0IHJlbmFtZSh0bXAsIHRoaXMuZmlsZSlcbiAgfVxufVxuIiwgIi8vIFwiQSBuZXcgdmVyc2lvbiBvZiBBZ2VudCBGbG93IGlzIGF2YWlsYWJsZVwiOiBjb21wYXJlcyB0aGlzIGNvcHkncyB2ZXJzaW9uIHdpdGggdGhlIG5ld2VzdCBHaXRIdWJcbi8vIHJlbGVhc2Ugb2YgdGhlIHJlcG9zaXRvcnkgaW4gaXRzIG1hbmlmZXN0LCBhdCBtb3N0IGV2ZXJ5IDYgaG91cnMsIGFuZCB1cGRhdGVzIHRocm91Z2ggT3JjYSdzIG93blxuLy8gYG9yY2EgcGx1Z2luIHVwZGF0ZWAuIE9ubHkgaW5zdGFsbGVkIGNvcGllcyAoT3JjYSdzIHBsdWdpbnMgZm9sZGVyKSBjaGVjazsgYSBkZXZlbG9wbWVudCBmb2xkZXIgbmV2ZXJcbi8vIGRvZXMuIE5vdGhpbmcgcGVyc29uYWwgaXMgc2VudDogb25lIHVuYXV0aGVudGljYXRlZCByZXF1ZXN0IGZvciB0aGUgcHVibGljIHJlbGVhc2UgbGlzdC5cbmltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgdHlwZSB7IENsaVJ1bm5lciB9IGZyb20gJy4uL2NsaS9vcmNhLWNsaS50cydcblxuY29uc3QgQ0hFQ0tfRVZFUllfTVMgPSA2ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IEZFVENIX1RJTUVPVVRfTVMgPSA4MDAwXG5cbmV4cG9ydCB0eXBlIFVwZGF0ZUluZm8gPSB7IGN1cnJlbnQ6IHN0cmluZzsgbGF0ZXN0OiBzdHJpbmcgfCBudWxsOyBuZXdlcjogYm9vbGVhbjsgcmVsZWFzZVVybDogc3RyaW5nIHwgbnVsbDsgcGx1Z2luS2V5OiBzdHJpbmcgfCBudWxsIH1cblxuZXhwb3J0IHR5cGUgVXBkYXRlUmVzdWx0ID0geyB1cGRhdGVkOiB0cnVlOyB2ZXJzaW9uOiBzdHJpbmcgfCBudWxsIH0gfCB7IHVwZGF0ZWQ6IGZhbHNlOyBhcHByb3ZlQ29tbWFuZDogc3RyaW5nIHwgbnVsbDsgcmVhc29uOiBzdHJpbmcgfVxuXG4vKiogVGhlIGtleSBvZiBhbiBpbnN0YWxsZWQgY29weSAoYDxwdWJsaXNoZXI+LjxpZD5gKSBmcm9tIHdoZXJlIGl0IHJ1bnM7IG51bGwgZm9yIGEgZGV2ZWxvcG1lbnQgZm9sZGVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxlZEtleShyb290RGlyOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSByb290RGlyLm1hdGNoKC9bXFxcXC9dcGx1Z2luc1tcXFxcL10oW2EtejAtOV1bYS16MC05LV0qXFwuW2EtejAtOV1bYS16MC05LV0qKSg/OltcXFxcL118JCkvaSlcbiAgcmV0dXJuIG1hdGNoICYmICFtYXRjaFsxXS5zdGFydHNXaXRoKCdsb2NhbC4nKSA/IG1hdGNoWzFdIDogbnVsbFxufVxuXG4vKiogb3duZXIvcmVwbyBmcm9tIGEgR2l0SHViIHJlcG9zaXRvcnkgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdpdGh1YlJlcG8odXJsOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSB1cmw/Lm1hdGNoKC9eaHR0cHM6XFwvXFwvZ2l0aHViXFwuY29tXFwvKFtBLVphLXowLTktXSspXFwvKFtBLVphLXowLTkuXy1dKz8pKD86XFwuZ2l0KT9cXC8/JC8pXG4gIHJldHVybiBtYXRjaCA/IGAke21hdGNoWzFdfS8ke21hdGNoWzJdfWAgOiBudWxsXG59XG5cbi8qKiBTZW1hbnRpYyB2ZXJzaW9uIGNvbXBhcmUgb2YgYHgueS56YCAoYSBsZWFkaW5nIHYgaXMgaWdub3JlZCk7IHByZXJlbGVhc2Ugc3VmZml4ZXMgY291bnQgYXMgb2xkZXIuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGFyZVZlcnNpb25zKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgcGFyc2UgPSAodjogc3RyaW5nKSA9PiB7XG4gICAgY29uc3QgW2NvcmUsIHByZV0gPSB2LnJlcGxhY2UoL152L2ksICcnKS5zcGxpdCgnLScsIDIpXG4gICAgcmV0dXJuIHsgbnVtczogY29yZS5zcGxpdCgnLicpLm1hcCgobikgPT4gTnVtYmVyLnBhcnNlSW50KG4sIDEwKSB8fCAwKSwgcHJlOiBwcmUgPz8gbnVsbCB9XG4gIH1cbiAgY29uc3QgeCA9IHBhcnNlKGEpXG4gIGNvbnN0IHkgPSBwYXJzZShiKVxuICBmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgIGNvbnN0IGQgPSAoeC5udW1zW2ldID8/IDApIC0gKHkubnVtc1tpXSA/PyAwKVxuICAgIGlmIChkKSByZXR1cm4gTWF0aC5zaWduKGQpXG4gIH1cbiAgaWYgKHgucHJlID09PSB5LnByZSkgcmV0dXJuIDBcbiAgcmV0dXJuIHgucHJlID09PSBudWxsID8gMSA6IHkucHJlID09PSBudWxsID8gLTEgOiB4LnByZSA8IHkucHJlID8gLTEgOiAxXG59XG5cbnR5cGUgRmV0Y2hlciA9ICh1cmw6IHN0cmluZywgaW5pdDogeyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+OyBzaWduYWw6IEFib3J0U2lnbmFsIH0pID0+IFByb21pc2U8eyBvazogYm9vbGVhbjsgc3RhdHVzOiBudW1iZXI7IGpzb24oKTogUHJvbWlzZTx1bmtub3duPiB9PlxuXG5leHBvcnQgY2xhc3MgVXBkYXRlQ2hlY2tlciB7XG4gIHByaXZhdGUgY2FjaGVkOiB7IGF0OiBudW1iZXI7IGluZm86IFVwZGF0ZUluZm8gfSB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgbWFuaWZlc3Q6IHsgdmVyc2lvbjogc3RyaW5nOyByZXBvc2l0b3J5Pzogc3RyaW5nIH0gfCBudWxsID0gbnVsbFxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcm9vdERpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZW5hYmxlZDogKCkgPT4gYm9vbGVhbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGZldGNoZXI6IEZldGNoZXIgPSBmZXRjaCBhcyB1bmtub3duIGFzIEZldGNoZXIsXG4gICAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlciA9IERhdGUubm93XG4gICkge31cblxuICBwcml2YXRlIGFzeW5jIHJlYWRNYW5pZmVzdCgpOiBQcm9taXNlPHsgdmVyc2lvbjogc3RyaW5nOyByZXBvc2l0b3J5Pzogc3RyaW5nIH0+IHtcbiAgICB0aGlzLm1hbmlmZXN0ID8/PSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGpvaW4odGhpcy5yb290RGlyLCAnb3JjYS1wbHVnaW4uanNvbicpLCAndXRmOCcpKSBhcyB7IHZlcnNpb246IHN0cmluZzsgcmVwb3NpdG9yeT86IHN0cmluZyB9XG4gICAgcmV0dXJuIHRoaXMubWFuaWZlc3RcbiAgfVxuXG4gIGFzeW5jIGNoZWNrKGZvcmNlID0gZmFsc2UpOiBQcm9taXNlPFVwZGF0ZUluZm8+IHtcbiAgICBjb25zdCBtYW5pZmVzdCA9IGF3YWl0IHRoaXMucmVhZE1hbmlmZXN0KClcbiAgICBjb25zdCBwbHVnaW5LZXkgPSBpbnN0YWxsZWRLZXkodGhpcy5yb290RGlyKVxuICAgIGNvbnN0IGJhc2U6IFVwZGF0ZUluZm8gPSB7IGN1cnJlbnQ6IG1hbmlmZXN0LnZlcnNpb24sIGxhdGVzdDogbnVsbCwgbmV3ZXI6IGZhbHNlLCByZWxlYXNlVXJsOiBudWxsLCBwbHVnaW5LZXkgfVxuICAgIGNvbnN0IHJlcG8gPSBnaXRodWJSZXBvKG1hbmlmZXN0LnJlcG9zaXRvcnkpXG4gICAgaWYgKCFwbHVnaW5LZXkgfHwgIXJlcG8gfHwgIXRoaXMuZW5hYmxlZCgpKSByZXR1cm4gYmFzZVxuICAgIGlmICghZm9yY2UgJiYgdGhpcy5jYWNoZWQgJiYgdGhpcy5ub3coKSAtIHRoaXMuY2FjaGVkLmF0IDwgQ0hFQ0tfRVZFUllfTVMpIHJldHVybiB0aGlzLmNhY2hlZC5pbmZvXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5mZXRjaGVyKGBodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zLyR7cmVwb30vcmVsZWFzZXMvbGF0ZXN0YCwge1xuICAgICAgICBoZWFkZXJzOiB7IEFjY2VwdDogJ2FwcGxpY2F0aW9uL3ZuZC5naXRodWIranNvbicsICdVc2VyLUFnZW50JzogJ29yY2EtYWdlbnQtZmxvdy11cGRhdGUtY2hlY2snIH0sXG4gICAgICAgIHNpZ25hbDogQWJvcnRTaWduYWwudGltZW91dChGRVRDSF9USU1FT1VUX01TKVxuICAgICAgfSlcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHRocm93IG5ldyBFcnJvcihgR2l0SHViIGFuc3dlcmVkICR7cmVzcG9uc2Uuc3RhdHVzfWApXG4gICAgICBjb25zdCByZWxlYXNlID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgeyB0YWdfbmFtZT86IHVua25vd247IGh0bWxfdXJsPzogdW5rbm93bjsgZHJhZnQ/OiB1bmtub3duOyBwcmVyZWxlYXNlPzogdW5rbm93biB9XG4gICAgICBjb25zdCB0YWcgPSB0eXBlb2YgcmVsZWFzZS50YWdfbmFtZSA9PT0gJ3N0cmluZycgJiYgL152P1xcZCtcXC5cXGQrXFwuXFxkKy8udGVzdChyZWxlYXNlLnRhZ19uYW1lKSA/IHJlbGVhc2UudGFnX25hbWUucmVwbGFjZSgvXnYvaSwgJycpIDogbnVsbFxuICAgICAgY29uc3QgdXJsID0gdHlwZW9mIHJlbGVhc2UuaHRtbF91cmwgPT09ICdzdHJpbmcnICYmIHJlbGVhc2UuaHRtbF91cmwuc3RhcnRzV2l0aChgaHR0cHM6Ly9naXRodWIuY29tLyR7cmVwb30vYCkgPyByZWxlYXNlLmh0bWxfdXJsIDogbnVsbFxuICAgICAgY29uc3QgaW5mbzogVXBkYXRlSW5mbyA9IHsgLi4uYmFzZSwgbGF0ZXN0OiB0YWcsIG5ld2VyOiBCb29sZWFuKHRhZykgJiYgcmVsZWFzZS5kcmFmdCAhPT0gdHJ1ZSAmJiByZWxlYXNlLnByZXJlbGVhc2UgIT09IHRydWUgJiYgY29tcGFyZVZlcnNpb25zKHRhZyEsIG1hbmlmZXN0LnZlcnNpb24pID4gMCwgcmVsZWFzZVVybDogdXJsIH1cbiAgICAgIHRoaXMuY2FjaGVkID0geyBhdDogdGhpcy5ub3coKSwgaW5mbyB9XG4gICAgICByZXR1cm4gaW5mb1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gT2ZmbGluZSBvciByYXRlLWxpbWl0ZWQ6IHNheSBub3RoaW5nLCB0cnkgYWdhaW4gbmV4dCB0aW1lLlxuICAgICAgdGhpcy5jYWNoZWQgPSB7IGF0OiB0aGlzLm5vdygpIC0gQ0hFQ0tfRVZFUllfTVMgKyAzMCAqIDYwICogMTAwMCwgaW5mbzogYmFzZSB9XG4gICAgICByZXR1cm4gYmFzZVxuICAgIH1cbiAgfVxuXG4gIC8qKiBSdW5zIGBvcmNhIHBsdWdpbiB1cGRhdGUgPGtleT5gLiBBIHZlcnNpb24gdGhhdCBuZWVkcyBuZXcgYWNjZXNzIHJldHVybnMgT3JjYSdzIGFwcHJvdmUgY29tbWFuZCBpbnN0ZWFkLiAqL1xuICBhc3luYyB1cGRhdGUoY2xpOiBDbGlSdW5uZXIpOiBQcm9taXNlPFVwZGF0ZVJlc3VsdD4ge1xuICAgIGNvbnN0IGtleSA9IGluc3RhbGxlZEtleSh0aGlzLnJvb3REaXIpXG4gICAgaWYgKCFrZXkpIHJldHVybiB7IHVwZGF0ZWQ6IGZhbHNlLCBhcHByb3ZlQ29tbWFuZDogbnVsbCwgcmVhc29uOiAnVGhpcyBpcyBhIGRldmVsb3BtZW50IGNvcHk7IHVwZGF0ZSBpdCBmcm9tIGl0cyBmb2xkZXIuJyB9XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2xpLnJ1bjx7IHZlcnNpb24/OiBzdHJpbmcgfT4oWydwbHVnaW4nLCAndXBkYXRlJywga2V5XSwgeyB0aW1lb3V0TXM6IDEyMF8wMDAgfSlcbiAgICBpZiAocmVzdWx0Lm9rKSB7XG4gICAgICB0aGlzLmNhY2hlZCA9IG51bGxcbiAgICAgIHJldHVybiB7IHVwZGF0ZWQ6IHRydWUsIHZlcnNpb246IHR5cGVvZiByZXN1bHQucmVzdWx0Py52ZXJzaW9uID09PSAnc3RyaW5nJyA/IHJlc3VsdC5yZXN1bHQudmVyc2lvbiA6IG51bGwgfVxuICAgIH1cbiAgICBjb25zdCBmaW5nZXJwcmludCA9IHJlc3VsdC5tZXNzYWdlLm1hdGNoKC8tLWFwcHJvdmVcXHMrKGFwXFxkLVthLWYwLTldezE2LDY0fSkvKT8uWzFdID8/IG51bGxcbiAgICByZXR1cm4ge1xuICAgICAgdXBkYXRlZDogZmFsc2UsXG4gICAgICBhcHByb3ZlQ29tbWFuZDogZmluZ2VycHJpbnQgPyBgb3JjYSBwbHVnaW4gdXBkYXRlICR7a2V5fSAtLWFwcHJvdmUgJHtmaW5nZXJwcmludH1gIDogbnVsbCxcbiAgICAgIHJlYXNvbjogcmVzdWx0LmNvZGUgPT09ICdhcHByb3ZhbF9yZXF1aXJlZCcgfHwgZmluZ2VycHJpbnQgPyAnVGhlIG5ldyB2ZXJzaW9uIGFza3MgZm9yIG1vcmUgYWNjZXNzLCBzbyBPcmNhIG5lZWRzIHlvdXIgYXBwcm92YWwuJyA6IHJlc3VsdC5tZXNzYWdlXG4gICAgfVxuICB9XG59XG4iLCAiLy8gT3JjYSBjYXBzIGEgcGFuZWwgcmVxdWVzdCdzIGFuc3dlciBhdCAxIE1pQi4gVHJpbSB0aGUgbGVhc3QgdXNlZnVsIHBhcnRzIGZpcnN0IHVudGlsIHRoZVxuLy8gc25hcHNob3QgZml0czogb2xkIHRpbWVsaW5lIGV2ZW50cywgdG9vbCBjYWxscywgbWVzc2FnZSB0ZXh0LCB0aGVuIGxvbmcgdGFzayB0ZXh0LlxuLy8gVGhlIHdob2xlIHNuYXBzaG90IGlzIHNlcmlhbGl6ZWQgb25jZTsgYWZ0ZXIgdGhhdCBvbmx5IHRoZSBwYXJ0IGEgc3RlcCBjaGFuZ2VkIGlzIHJlLW1lYXN1cmVkLlxuaW1wb3J0IHR5cGUgeyBGbG93U25hcHNob3QgfSBmcm9tICcuLi8uLi9zaGFyZWQvZXZlbnRzLnRzJ1xuaW1wb3J0IHsgdHJ1bmNhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuXG5leHBvcnQgY29uc3QgUEFORUxfU05BUFNIT1RfQlVER0VUID0gOTAwICogMTAyNFxuXG50eXBlIFBhcnQgPSAnZXZlbnRzJyB8ICd0b29sQ2FsbHMnIHwgJ21lc3NhZ2VzJyB8ICd0YXNrcydcblxuY29uc3QgYnl0ZXMgPSAodmFsdWU6IHVua25vd24pID0+IEJ1ZmZlci5ieXRlTGVuZ3RoKEpTT04uc3RyaW5naWZ5KHZhbHVlKSlcblxuY29uc3QgcmVhZCA9IChzOiBGbG93U25hcHNob3QsIHBhcnQ6IFBhcnQpOiB1bmtub3duID0+IChwYXJ0ID09PSAnZXZlbnRzJyA/IHMuZXZlbnRzIDogcy5zdGF0ZVtwYXJ0XSlcblxuY29uc3QgU1RFUFM6IHsgcGFydDogUGFydDsgYXBwbHk6IChzOiBGbG93U25hcHNob3QpID0+IEZsb3dTbmFwc2hvdCB9W10gPSBbXG4gIHsgcGFydDogJ2V2ZW50cycsIGFwcGx5OiAocykgPT4gKHsgLi4ucywgZXZlbnRzOiBzLmV2ZW50cy5zbGljZSgtMzAwKSB9KSB9LFxuICB7IHBhcnQ6ICd0b29sQ2FsbHMnLCBhcHBseTogKHMpID0+ICh7IC4uLnMsIHN0YXRlOiB7IC4uLnMuc3RhdGUsIHRvb2xDYWxsczogcy5zdGF0ZS50b29sQ2FsbHMuc2xpY2UoLTgwKSB9IH0pIH0sXG4gIHsgcGFydDogJ21lc3NhZ2VzJywgYXBwbHk6IChzKSA9PiAoeyAuLi5zLCBzdGF0ZTogeyAuLi5zLnN0YXRlLCBtZXNzYWdlczogcy5zdGF0ZS5tZXNzYWdlcy5zbGljZSgtMTIwKS5tYXAoKG0pID0+ICh7IC4uLm0sIGJvZHk6IG0uYm9keSA/IHRydW5jYXRlKG0uYm9keSwgMjAwKSA6IG51bGwgfSkpIH0gfSkgfSxcbiAge1xuICAgIHBhcnQ6ICd0YXNrcycsXG4gICAgYXBwbHk6IChzKSA9PiAoe1xuICAgICAgLi4ucyxcbiAgICAgIHN0YXRlOiB7XG4gICAgICAgIC4uLnMuc3RhdGUsXG4gICAgICAgIHRhc2tzOiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgT2JqZWN0LmVudHJpZXMocy5zdGF0ZS50YXNrcykubWFwKChbaWQsIHRdKSA9PiBbaWQsIHsgLi4udCwgc3BlYzogdC5zcGVjID8gdHJ1bmNhdGUodC5zcGVjLCAzMDApIDogbnVsbCwgcmVzdWx0OiB0LnJlc3VsdCA/IHsgLi4udC5yZXN1bHQsIHJhdzogbnVsbCwgbWVzc2FnZTogdC5yZXN1bHQubWVzc2FnZSA/IHRydW5jYXRlKHQucmVzdWx0Lm1lc3NhZ2UsIDQwMCkgOiBudWxsIH0gOiBudWxsIH1dKVxuICAgICAgICApXG4gICAgICB9XG4gICAgfSlcbiAgfSxcbiAgeyBwYXJ0OiAnZXZlbnRzJywgYXBwbHk6IChzKSA9PiAoeyAuLi5zLCBldmVudHM6IHMuZXZlbnRzLnNsaWNlKC04MCkgfSkgfVxuXVxuXG5leHBvcnQgZnVuY3Rpb24gZml0U25hcHNob3Qoc25hcHNob3Q6IEZsb3dTbmFwc2hvdCwgYnVkZ2V0ID0gUEFORUxfU05BUFNIT1RfQlVER0VUKTogRmxvd1NuYXBzaG90IHtcbiAgbGV0IHRvdGFsID0gYnl0ZXMoc25hcHNob3QpXG4gIGlmICh0b3RhbCA8PSBidWRnZXQpIHJldHVybiBzbmFwc2hvdFxuICBjb25zdCBzaXplcyA9IG5ldyBNYXA8UGFydCwgbnVtYmVyPigpXG4gIGNvbnN0IHNpemVPZiA9IChzOiBGbG93U25hcHNob3QsIHBhcnQ6IFBhcnQpID0+IHtcbiAgICBpZiAoIXNpemVzLmhhcyhwYXJ0KSkgc2l6ZXMuc2V0KHBhcnQsIGJ5dGVzKHJlYWQocywgcGFydCkpKVxuICAgIHJldHVybiBzaXplcy5nZXQocGFydCkhXG4gIH1cbiAgbGV0IGN1cnJlbnQgPSBzbmFwc2hvdFxuICBmb3IgKGNvbnN0IHN0ZXAgb2YgU1RFUFMpIHtcbiAgICBjb25zdCBiZWZvcmUgPSBzaXplT2YoY3VycmVudCwgc3RlcC5wYXJ0KVxuICAgIGN1cnJlbnQgPSBzdGVwLmFwcGx5KGN1cnJlbnQpXG4gICAgY29uc3QgYWZ0ZXIgPSBieXRlcyhyZWFkKGN1cnJlbnQsIHN0ZXAucGFydCkpXG4gICAgc2l6ZXMuc2V0KHN0ZXAucGFydCwgYWZ0ZXIpXG4gICAgdG90YWwgKz0gYWZ0ZXIgLSBiZWZvcmVcbiAgICBpZiAodG90YWwgPD0gYnVkZ2V0KSByZXR1cm4gY3VycmVudFxuICB9XG4gIHJldHVybiBjdXJyZW50XG59XG4iLCAiLy8gT3JjYSBwYW5lbHMgYW5kIHRoZSBjYW52YXMgZWRpdG9yIHRhbGsgdG8gdGhlIHdvcmtlciB0aHJvdWdoIHBsdWdpbi5yZXF1ZXN0IC8gcGFuZWxzLnBvc3QuXG5pbXBvcnQgdHlwZSB7IE9yY2FXb3JrZXJBcGkgfSBmcm9tICdvcmNhL3dvcmtlcidcbmltcG9ydCB0eXBlIHsgRmxvd0RlbHRhLCBGbG93U25hcHNob3QgfSBmcm9tICcuLi8uLi9zaGFyZWQvZXZlbnRzLnRzJ1xuaW1wb3J0IHR5cGUgeyBDb21tYW5kUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9zaGFyZWQvY29tbWFuZHMudHMnXG5pbXBvcnQgeyBmaXRTbmFwc2hvdCB9IGZyb20gJy4vc25hcHNob3QtYnVkZ2V0LnRzJ1xuXG4vKiogcGFuZWxzLnBvc3QgcGF5bG9hZHMgYXJlIGNhcHBlZCBhdCAyNTYgS2lCOyBsYXJnZXIgZGVsdGFzIGJlY29tZSBhIHJlc3luYyByZXF1ZXN0LiAqL1xuY29uc3QgTUFYX1BPU1RfQllURVMgPSAyMDAgKiAxMDI0XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFuZWxzKFxuICBwYW5lbHM6IE9yY2FXb3JrZXJBcGlbJ3BhbmVscyddLFxuICBkZXBzOiB7XG4gICAgc25hcHNob3Q6ICgpID0+IEZsb3dTbmFwc2hvdFxuICAgIHN1YnNjcmliZTogKGxpc3RlbmVyOiAoZGVsdGE6IEZsb3dEZWx0YSkgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZFxuICAgIC8qKiBMaXZlIG91dHB1dCBub3RpY2VzOiBhbiBhZ2VudCdzIGNvbnZlcnNhdGlvbiBjaGFuZ2VkIChvbmx5IGl0cyBpZCBpcyBzZW50KS4gKi9cbiAgICBzdWJzY3JpYmVPdXRwdXQ/OiAobGlzdGVuZXI6IChhZ2VudElkOiBzdHJpbmcpID0+IHZvaWQpID0+ICgpID0+IHZvaWRcbiAgICBjb21tYW5kOiAoaW5wdXQ6IHVua25vd24pID0+IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPlxuICAgIGxvZzogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZFxuICB9XG4pOiAoKSA9PiB2b2lkIHtcbiAgY29uc3QgZGlzcG9zZXJzID0gW1xuICAgIHBhbmVscy5oYW5kbGUoJ2Zsb3cuc25hcHNob3QnLCAoKSA9PiBmaXRTbmFwc2hvdChkZXBzLnNuYXBzaG90KCkpIGFzIG5ldmVyKSxcbiAgICBwYW5lbHMuaGFuZGxlKCdmbG93LmNvbW1hbmQnLCAoaW5wdXQpID0+IGRlcHMuY29tbWFuZChpbnB1dCkgYXMgbmV2ZXIpXG4gIF1cbiAgY29uc3QgdW5zdWJzY3JpYmUgPSBkZXBzLnN1YnNjcmliZSgoZGVsdGEpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KGRlbHRhKVxuICAgICAgaWYgKEJ1ZmZlci5ieXRlTGVuZ3RoKGpzb24pID4gTUFYX1BPU1RfQllURVMpIHBhbmVscy5wb3N0KCdmbG93LnJlc3luYycsIHsgdG9TZXE6IGRlbHRhLnRvU2VxIH0pXG4gICAgICBlbHNlIHBhbmVscy5wb3N0KCdmbG93LmRlbHRhJywgZGVsdGEgYXMgbmV2ZXIpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGRlcHMubG9nKGBwYW5lbCBwb3N0IGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICB9XG4gIH0pXG4gIGNvbnN0IHVuc3Vic2NyaWJlT3V0cHV0ID0gZGVwcy5zdWJzY3JpYmVPdXRwdXQ/LigoYWdlbnRJZCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBwYW5lbHMucG9zdCgnZmxvdy5vdXRwdXQnLCB7IGFnZW50SWQgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZGVwcy5sb2coYHBhbmVsIHBvc3QgZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgIH1cbiAgfSlcbiAgcmV0dXJuICgpID0+IHtcbiAgICB1bnN1YnNjcmliZSgpXG4gICAgdW5zdWJzY3JpYmVPdXRwdXQ/LigpXG4gICAgZm9yIChjb25zdCBkaXNwb3NlciBvZiBkaXNwb3NlcnMpIGRpc3Bvc2VyLmRpc3Bvc2UoKVxuICB9XG59XG4iLCAiLy8gQWdlbnQgRmxvdyB3b3JrZXIgZW50cnkuIE9yY2EgY2FsbHMgdGhlIGRlZmF1bHQgZXhwb3J0IG9uY2Ugd2hlbiB0aGUgd29ya2VyIHN0YXJ0cy5cbmltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHsgQWdlbnRGbG93UnVudGltZSB9IGZyb20gJy4vcnVudGltZS50cydcblxubGV0IHJ1bnRpbWU6IEFnZW50Rmxvd1J1bnRpbWUgfCBudWxsID0gbnVsbFxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShvcmNhOiBPcmNhV29ya2VyQXBpKTogUHJvbWlzZTx2b2lkPiB7XG4gIHJ1bnRpbWUgPSBuZXcgQWdlbnRGbG93UnVudGltZShvcmNhKVxuICBhd2FpdCBydW50aW1lLnN0YXJ0KClcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHJ1bnRpbWU/LnN0b3AoKVxuICBydW50aW1lID0gbnVsbFxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBQUEsZ0JBQWU7QUFDeEIsU0FBUyxxQkFBcUI7OztBQ3lEdkIsSUFBTSx1QkFBaUQsb0JBQUksSUFBSSxDQUFDLGNBQWMsYUFBYSxDQUFDO0FBRTVGLElBQU0sZUFBdUM7QUFBQSxFQUNsRDtBQUFBLEVBQWtCO0FBQUEsRUFBaUI7QUFBQSxFQUFnQjtBQUFBLEVBQWdCO0FBQUEsRUFBYztBQUFBLEVBQ2pGO0FBQUEsRUFBZTtBQUFBLEVBQWU7QUFBQSxFQUFlO0FBQUEsRUFBYztBQUFBLEVBQWlCO0FBQUEsRUFDNUU7QUFBQSxFQUFtQjtBQUFBLEVBQWlCO0FBQUEsRUFBb0I7QUFBQSxFQUFnQjtBQUFBLEVBQ3hFO0FBQUEsRUFBaUI7QUFBQSxFQUFnQjtBQUFBLEVBQWdCO0FBQUEsRUFBa0I7QUFBQSxFQUFpQjtBQUFBLEVBQW9CO0FBQUEsRUFBc0I7QUFBQSxFQUFnQjtBQUFBLEVBQWU7QUFBQSxFQUFlO0FBQUEsRUFBZ0I7QUFBQSxFQUFjO0FBQUEsRUFBZTtBQUFBLEVBQWdCO0FBQzNPO0FBR08sSUFBTSxxQkFBK0Msb0JBQUksSUFBSTtBQUFBLEVBQ2xFO0FBQUEsRUFBaUI7QUFBQSxFQUFvQjtBQUFBLEVBQW9CO0FBQUEsRUFBZ0I7QUFBQSxFQUFnQjtBQUFBLEVBQWtCO0FBQUEsRUFBaUI7QUFBQSxFQUFlO0FBQUE7QUFBQSxFQUUzSTtBQUFBLEVBQWM7QUFBQSxFQUFlO0FBQy9CLENBQUM7QUFFTSxJQUFNLGtCQUFOLGNBQThCLE1BQU07QUFBQSxFQUN6QyxPQUFPO0FBQ1Q7QUFRQSxJQUFNLEtBQUs7QUFDWCxJQUFNLFFBQVE7QUFDZCxJQUFNLE9BQU87QUFDYixJQUFNLFFBQVE7QUFDZCxJQUFNLFNBQVM7QUFDZixJQUFNLGNBQWMsQ0FBQyxXQUFXLFNBQVMsY0FBYyxhQUFhLFVBQVUsU0FBUztBQUNoRixJQUFNLGlCQUFpQixDQUFDLGFBQWEsU0FBUztBQUU5QyxJQUFNLGlCQUFpRTtBQUFBLEVBQzVFLGtCQUFrQixFQUFFLFlBQVksRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRyxFQUFFO0FBQUEsRUFDaEYsaUJBQWlCLEVBQUUsWUFBWSxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHLEVBQUU7QUFBQSxFQUMvRSxnQkFBZ0I7QUFBQSxJQUNkLGFBQWEsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRztBQUFBLElBQzNELE9BQU8sRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsTUFBTTtBQUFBLElBQ3hELFFBQVEsRUFBRSxNQUFNLFVBQVUsS0FBSyxJQUFNO0FBQUEsRUFDdkM7QUFBQSxFQUNBLGdCQUFnQjtBQUFBLElBQ2QsYUFBYSxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHO0FBQUEsSUFDM0QsT0FBTyxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxNQUFNO0FBQUEsSUFDeEQsV0FBVyxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHO0FBQUEsRUFDM0Q7QUFBQSxFQUNBLGNBQWMsRUFBRSxTQUFTLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUcsRUFBRTtBQUFBLEVBQ3pFLG9CQUFvQjtBQUFBLElBQ2xCLFNBQVMsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRztBQUFBLElBQ3ZELFFBQVEsRUFBRSxNQUFNLFVBQVUsS0FBSyxLQUFLLFNBQVMsMkJBQTJCO0FBQUE7QUFBQSxJQUV4RSxPQUFPLEVBQUUsTUFBTSxVQUFVLEtBQUssSUFBSSxTQUFTLG1CQUFtQjtBQUFBLEVBQ2hFO0FBQUEsRUFDQSxlQUFlO0FBQUEsSUFDYixPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUNyRCxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNsRCxNQUFNLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxLQUFLLElBQU07QUFBQSxJQUNuRCxNQUFNLEVBQUUsTUFBTSxlQUFlLFVBQVUsSUFBSSxTQUFTLEdBQUc7QUFBQSxJQUN2RCxVQUFVLEVBQUUsTUFBTSxVQUFVLFNBQVMsR0FBRztBQUFBLEVBQzFDO0FBQUEsRUFDQSxlQUFlO0FBQUEsSUFDYixRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUN0RCxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUNyRCxRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxPQUFPLFlBQVk7QUFBQSxJQUM3RCxRQUFRLEVBQUUsTUFBTSxVQUFVLEtBQUssSUFBSztBQUFBLEVBQ3RDO0FBQUEsRUFDQSxlQUFlO0FBQUEsSUFDYixRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUN0RCxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxFQUN2RDtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osUUFBUSxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHO0FBQUEsSUFDdEQsT0FBTyxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHO0FBQUEsSUFDckQsT0FBTyxFQUFFLE1BQU0sVUFBVSxTQUFTLE1BQU07QUFBQSxJQUN4QyxPQUFPLEVBQUUsTUFBTSxVQUFVLFNBQVMsTUFBTTtBQUFBLElBQ3hDLFFBQVEsRUFBRSxNQUFNLFVBQVUsU0FBUyxPQUFPO0FBQUEsSUFDMUMsVUFBVSxFQUFFLE1BQU0sVUFBVSxPQUFPLGVBQWU7QUFBQSxFQUNwRDtBQUFBLEVBQ0EsaUJBQWlCO0FBQUEsSUFDZixRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUN0RCxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUNyRCxPQUFPLEVBQUUsTUFBTSxVQUFVLFNBQVMsTUFBTTtBQUFBLElBQ3hDLE9BQU8sRUFBRSxNQUFNLFVBQVUsU0FBUyxNQUFNO0FBQUEsSUFDeEMsUUFBUSxFQUFFLE1BQU0sVUFBVSxTQUFTLE9BQU87QUFBQSxJQUMxQyxVQUFVLEVBQUUsTUFBTSxVQUFVLE9BQU8sZUFBZTtBQUFBLEVBQ3BEO0FBQUEsRUFDQSxnQkFBZ0I7QUFBQSxJQUNkLFFBQVEsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRztBQUFBLElBQ3RELE9BQU8sRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRztBQUFBLElBQ3JELFlBQVksRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLEtBQUssSUFBSztBQUFBLEVBQzFEO0FBQUEsRUFDQSxtQkFBbUI7QUFBQSxJQUNqQixXQUFXLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUN6RCxNQUFNLEVBQUUsTUFBTSxVQUFVLEtBQUssSUFBSTtBQUFBLElBQ2pDLFlBQVksRUFBRSxNQUFNLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDdkMsT0FBTyxFQUFFLE1BQU0sVUFBVSxTQUFTLE1BQU07QUFBQSxJQUN4QyxRQUFRLEVBQUUsTUFBTSxVQUFVLEtBQUssSUFBTTtBQUFBLEVBQ3ZDO0FBQUEsRUFDQSxpQkFBaUIsRUFBRSxhQUFhLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUcsRUFBRTtBQUFBLEVBQ2hGLG9CQUFvQixFQUFFLE1BQU0sRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLEtBQUssSUFBSyxFQUFFO0FBQUEsRUFDMUUsZ0JBQWdCO0FBQUEsSUFDZCxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUNyRCxJQUFJLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUNsRCxTQUFTLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxLQUFLLElBQUk7QUFBQSxJQUNwRCxNQUFNLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxLQUFLLElBQU07QUFBQSxFQUNyRDtBQUFBLEVBQ0EsZ0JBQWdCO0FBQUEsSUFDZCxTQUFTLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLEdBQUc7QUFBQSxJQUN2RCxPQUFPLEVBQUUsTUFBTSxVQUFVLFNBQVMsTUFBTTtBQUFBLElBQ3hDLFFBQVEsRUFBRSxNQUFNLFVBQVUsU0FBUyxPQUFPO0FBQUEsRUFDNUM7QUFBQSxFQUNBLGlCQUFpQjtBQUFBLElBQ2YsY0FBYyxFQUFFLE1BQU0sVUFBVSxTQUFTLElBQUk7QUFBQSxJQUM3QyxZQUFZLEVBQUUsTUFBTSxVQUFVLFNBQVMsSUFBSTtBQUFBLElBQzNDLGNBQWMsRUFBRSxNQUFNLFVBQVUsU0FBUyxJQUFJO0FBQUEsSUFDN0MsZUFBZSxFQUFFLE1BQU0sVUFBVSxTQUFTLElBQUk7QUFBQSxJQUM5QyxjQUFjLEVBQUUsTUFBTSxVQUFVLFNBQVMsSUFBSTtBQUFBLElBQzdDLGFBQWEsRUFBRSxNQUFNLFVBQVUsS0FBSyxJQUFJO0FBQUEsRUFDMUM7QUFBQSxFQUNBLGdCQUFnQixDQUFDO0FBQUEsRUFDakIsZ0JBQWdCLEVBQUUsT0FBTyxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sU0FBUyxHQUFHLEVBQUU7QUFBQSxFQUN6RSxrQkFBa0IsQ0FBQztBQUFBO0FBQUEsRUFFbkIsZUFBZSxDQUFDO0FBQUEsRUFDaEIsZUFBZSxFQUFFLFNBQVMsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRyxHQUFHLEtBQUssRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLEtBQUssS0FBSyxTQUFTLGdEQUFnRCxHQUFHLFFBQVEsRUFBRSxNQUFNLFVBQVUsU0FBUyxZQUFZLEVBQUU7QUFBQSxFQUN6TyxnQkFBZ0I7QUFBQSxJQUNkLFNBQVMsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsR0FBRztBQUFBLElBQ3ZELE1BQU0sRUFBRSxNQUFNLFVBQVUsS0FBSyxJQUFNO0FBQUE7QUFBQSxJQUVuQyxhQUFhLEVBQUUsTUFBTSxlQUFlLFVBQVUsR0FBRyxTQUFTLEtBQUs7QUFBQSxFQUNqRTtBQUFBO0FBQUE7QUFBQSxFQUdBLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxNQUFNLFVBQVUsRUFBRTtBQUFBO0FBQUEsRUFFN0MsY0FBYyxDQUFDO0FBQUEsRUFDZixjQUFjLENBQUM7QUFBQSxFQUNmLGVBQWUsRUFBRSxRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxPQUFPLENBQUMsV0FBVyxTQUFTLE9BQU8sRUFBRSxFQUFFO0FBQUE7QUFBQSxFQUVsRyxnQkFBZ0I7QUFBQSxJQUNkLFVBQVUsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLFNBQVMsS0FBSztBQUFBLElBQzFELFdBQVcsRUFBRSxNQUFNLFVBQVUsVUFBVSxNQUFNLE9BQU8sQ0FBQyxhQUFhLGNBQWMsY0FBYyxXQUFXLEVBQUU7QUFBQSxJQUMzRyxPQUFPLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxLQUFLLEtBQVEsU0FBUyx5QkFBeUI7QUFBQSxJQUN4RixRQUFRLEVBQUUsTUFBTSxVQUFVLFVBQVUsTUFBTSxTQUFTLFlBQVk7QUFBQSxJQUMvRCxNQUFNLEVBQUUsTUFBTSxVQUFVO0FBQUEsRUFDMUI7QUFBQSxFQUNBLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxNQUFNLFdBQVcsVUFBVSxLQUFLLEVBQUU7QUFBQSxFQUNyRSxvQkFBb0IsRUFBRSxTQUFTLEVBQUUsTUFBTSxXQUFXLFVBQVUsS0FBSyxFQUFFO0FBQUEsRUFDbkUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLE1BQU0sVUFBVSxVQUFVLE1BQU0sS0FBSyxLQUFLLFNBQVMsMkNBQTJDLEVBQUU7QUFDNUg7QUFHTyxTQUFTLGdCQUFnQixPQUFnQztBQUM5RCxNQUFJLENBQUMsU0FBUyxLQUFLLEVBQUcsT0FBTSxJQUFJLGdCQUFnQiw0QkFBNEI7QUFDNUUsUUFBTSxFQUFFLFdBQVcsTUFBTSxRQUFRLFVBQVUsSUFBSTtBQUMvQyxNQUFJLE9BQU8sY0FBYyxZQUFZLENBQUMsd0JBQXdCLEtBQUssU0FBUyxFQUFHLE9BQU0sSUFBSSxnQkFBZ0Isb0NBQW9DO0FBQzdJLE1BQUksT0FBTyxTQUFTLFlBQVksQ0FBRSxhQUFtQyxTQUFTLElBQUksRUFBRyxPQUFNLElBQUksZ0JBQWdCLG9CQUFvQixPQUFPLElBQUksQ0FBQyxJQUFJO0FBQ25KLE1BQUksY0FBYyxVQUFhLE9BQU8sY0FBYyxVQUFXLE9BQU0sSUFBSSxnQkFBZ0IsOEJBQThCO0FBQ3ZILFFBQU0sT0FBTyxlQUFlLElBQW1CO0FBQy9DLFFBQU0sTUFBTSxXQUFXLFNBQVksQ0FBQyxJQUFJO0FBQ3hDLE1BQUksQ0FBQyxTQUFTLEdBQUcsRUFBRyxPQUFNLElBQUksZ0JBQWdCLDJCQUEyQjtBQUN6RSxhQUFXLE9BQU8sT0FBTyxLQUFLLEdBQUcsRUFBRyxLQUFJLENBQUMsT0FBTyxPQUFPLE1BQU0sR0FBRyxFQUFHLE9BQU0sSUFBSSxnQkFBZ0Isa0JBQWtCLEdBQUcsU0FBUyxJQUFJLEdBQUc7QUFDbEksUUFBTUMsU0FBaUMsQ0FBQztBQUN4QyxhQUFXLENBQUMsS0FBSyxLQUFLLEtBQUssT0FBTyxRQUFRLElBQUksR0FBRztBQUMvQyxVQUFNLFFBQVEsSUFBSSxHQUFHO0FBQ3JCLFFBQUksVUFBVSxVQUFhLFVBQVUsUUFBUSxVQUFVLElBQUk7QUFDekQsVUFBSSxNQUFNLFNBQVUsT0FBTSxJQUFJLGdCQUFnQixHQUFHLEdBQUcsb0JBQW9CLElBQUksR0FBRztBQUMvRTtBQUFBLElBQ0Y7QUFDQSxJQUFBQSxPQUFNLEdBQUcsSUFBSSxXQUFXLE1BQU0sS0FBSyxPQUFPLEtBQUs7QUFBQSxFQUNqRDtBQUNBLFNBQU8sRUFBRSxXQUFXLE1BQTJCLFFBQVFBLFFBQU8sV0FBVyxjQUFjLEtBQUs7QUFDOUY7QUFFQSxTQUFTLFdBQVcsTUFBYyxLQUFhLE9BQWtCLE9BQXlCO0FBQ3hGLFFBQU0sUUFBUSxHQUFHLEdBQUcsUUFBUSxJQUFJO0FBQ2hDLFVBQVEsTUFBTSxNQUFNO0FBQUEsSUFDbEIsS0FBSyxVQUFVO0FBQ2IsVUFBSSxPQUFPLFVBQVUsU0FBVSxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyxvQkFBb0I7QUFDckYsVUFBSSxNQUFNLFFBQVEsVUFBYSxNQUFNLFNBQVMsTUFBTSxJQUFLLE9BQU0sSUFBSSxnQkFBZ0IsR0FBRyxLQUFLLG1CQUFtQixNQUFNLEdBQUcsY0FBYztBQUNySSxVQUFJLE1BQU0sV0FBVyxDQUFDLE1BQU0sUUFBUSxLQUFLLEtBQUssRUFBRyxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyx1Q0FBdUM7QUFDMUgsVUFBSSxNQUFNLFNBQVMsQ0FBQyxNQUFNLE1BQU0sU0FBUyxLQUFLLEVBQUcsT0FBTSxJQUFJLGdCQUFnQixHQUFHLEtBQUssbUJBQW1CLE1BQU0sTUFBTSxLQUFLLElBQUksQ0FBQyxHQUFHO0FBQy9ILGFBQU87QUFBQSxJQUNUO0FBQUEsSUFDQSxLQUFLO0FBQ0gsVUFBSSxPQUFPLFVBQVUsVUFBVyxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyx5QkFBeUI7QUFDM0YsYUFBTztBQUFBLElBQ1QsS0FBSyxlQUFlO0FBQ2xCLFVBQUksQ0FBQyxNQUFNLFFBQVEsS0FBSyxFQUFHLE9BQU0sSUFBSSxnQkFBZ0IsR0FBRyxLQUFLLGtCQUFrQjtBQUMvRSxVQUFJLE1BQU0sYUFBYSxVQUFhLE1BQU0sU0FBUyxNQUFNLFNBQVUsT0FBTSxJQUFJLGdCQUFnQixHQUFHLEtBQUssc0JBQXNCO0FBQzNILGlCQUFXLFFBQVEsT0FBTztBQUN4QixZQUFJLE9BQU8sU0FBUyxZQUFhLE1BQU0sV0FBVyxDQUFDLE1BQU0sUUFBUSxLQUFLLElBQUksRUFBSSxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyx1QkFBdUI7QUFBQSxNQUN6STtBQUNBLGFBQU8sQ0FBQyxHQUFHLElBQUksSUFBSSxLQUFpQixDQUFDO0FBQUEsSUFDdkM7QUFBQSxJQUNBLEtBQUssVUFBVTtBQUNiLFVBQUksQ0FBQyxTQUFTLEtBQUssRUFBRyxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyxxQkFBcUI7QUFDN0UsWUFBTSxVQUFVLE9BQU8sUUFBUSxLQUFLO0FBQ3BDLFVBQUksTUFBTSxZQUFZLFVBQWEsUUFBUSxTQUFTLE1BQU0sUUFBUyxPQUFNLElBQUksZ0JBQWdCLEdBQUcsS0FBSyx3QkFBd0I7QUFDN0gsWUFBTSxNQUE4QixDQUFDO0FBQ3JDLGlCQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssU0FBUztBQUM1QixZQUFJLE9BQU8sTUFBTSxZQUFZLEVBQUUsU0FBUyxPQUFPLEVBQUUsU0FBUyxJQUFLLE9BQU0sSUFBSSxnQkFBZ0IsR0FBRyxLQUFLLGlDQUFpQztBQUNsSSxZQUFJLENBQUMsSUFBSTtBQUFBLE1BQ1g7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDRjtBQUVPLFNBQVMsU0FBUyxPQUFrRDtBQUN6RSxTQUFPLE9BQU8sVUFBVSxZQUFZLFVBQVUsUUFBUSxDQUFDLE1BQU0sUUFBUSxLQUFLO0FBQzVFOzs7QUNuQ08sSUFBTSxlQUE0QixFQUFFLGNBQWMsQ0FBQyxHQUFHLFlBQVksQ0FBQyxHQUFHLGFBQWEsTUFBTSxjQUFjLENBQUMsR0FBRyxlQUFlLENBQUMsR0FBRyxjQUFjLENBQUMsRUFBRTtBQUUvSSxTQUFTLGNBQTJCO0FBQ3pDLFNBQU8sRUFBRSxjQUFjLENBQUMsR0FBRyxZQUFZLENBQUMsR0FBRyxhQUFhLE1BQU0sY0FBYyxDQUFDLEdBQUcsZUFBZSxDQUFDLEdBQUcsY0FBYyxDQUFDLEVBQUU7QUFDdEg7QUFFTyxTQUFTLG9CQUFrQztBQUNoRCxTQUFPLEVBQUUsYUFBYSxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsa0JBQWtCLE9BQU8sY0FBYyxPQUFPLFNBQVMsTUFBTSxPQUFPLE9BQU8sV0FBVyxFQUFFLFNBQVMsT0FBTyxLQUFLLEtBQUssR0FBRyxVQUFVLEdBQUcsU0FBUyxLQUFLO0FBQzFMO0FBRU8sU0FBUyxhQUF3QjtBQUN0QyxTQUFPO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxhQUFhLEtBQUssSUFBSTtBQUFBLElBQ3RCLFFBQVEsQ0FBQztBQUFBLElBQ1QsT0FBTyxDQUFDO0FBQUEsSUFDUixNQUFNLENBQUM7QUFBQSxJQUNQLFVBQVUsQ0FBQztBQUFBLElBQ1gsT0FBTyxDQUFDO0FBQUEsSUFDUixXQUFXLENBQUM7QUFBQSxJQUNaLFdBQVcsQ0FBQztBQUFBLElBQ1osVUFBVSxDQUFDO0FBQUEsSUFDWCxVQUFVLENBQUM7QUFBQSxJQUNYLGNBQWMsa0JBQWtCO0FBQUE7QUFBQSxJQUVoQyxRQUFRLFlBQVk7QUFBQSxFQUN0QjtBQUNGOzs7QUNsUUEsU0FBUyxTQUFTLGdCQUFnQjtBQUNsQyxTQUFTLFNBQVMsTUFBTSxlQUFlOzs7QUNVaEMsU0FBUyxTQUFTLElBQVksTUFBaUIsS0FBMEI7QUFDOUUsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQSxPQUFPO0FBQUEsSUFDUCxPQUFPO0FBQUEsSUFDUCxVQUFVO0FBQUEsSUFDVixPQUFPO0FBQUEsSUFDUCxZQUFZO0FBQUEsSUFDWixRQUFRO0FBQUEsSUFDUixZQUFZO0FBQUEsSUFDWixnQkFBZ0I7QUFBQSxJQUNoQixTQUFTO0FBQUEsSUFDVCxXQUFXO0FBQUEsSUFDWCxhQUFhO0FBQUEsSUFDYixjQUFjO0FBQUEsSUFDZCxRQUFRO0FBQUEsSUFDUixPQUFPO0FBQUEsSUFDUCxRQUFRO0FBQUEsSUFDUixTQUFTO0FBQUEsSUFDVCxPQUFPO0FBQUEsSUFDUCxTQUFTO0FBQUEsSUFDVCxZQUFZO0FBQUEsSUFDWixXQUFXO0FBQUEsSUFDWCxTQUFTO0FBQUEsSUFDVCxZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUEsSUFDTixRQUFRO0FBQUEsSUFDUixjQUFjO0FBQUEsSUFDZCxjQUFjO0FBQUEsSUFDZCxtQkFBbUI7QUFBQSxJQUNuQixRQUFRO0FBQUEsSUFDUixjQUFjO0FBQUEsSUFDZCxhQUFhO0FBQUEsSUFDYixVQUFVLENBQUM7QUFBQSxJQUNYLFNBQVM7QUFBQSxFQUNYO0FBQ0Y7QUFHTyxTQUFTLFVBQVUsT0FBK0I7QUFDdkQsTUFBSSxPQUFPLFVBQVUsWUFBWSxPQUFPLFNBQVMsS0FBSyxFQUFHLFFBQU87QUFDaEUsTUFBSSxPQUFPLFVBQVUsWUFBWSxDQUFDLFNBQVMsVUFBVSxPQUFRLFFBQU87QUFDcEUsUUFBTSxhQUFhLHdDQUF3QyxLQUFLLEtBQUssSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHLElBQUksTUFBTTtBQUN6RyxRQUFNLEtBQUssS0FBSyxNQUFNLFVBQVU7QUFDaEMsU0FBTyxPQUFPLFNBQVMsRUFBRSxJQUFJLEtBQUs7QUFDcEM7QUFFTyxTQUFTLElBQUksT0FBK0I7QUFDakQsU0FBTyxPQUFPLFVBQVUsWUFBWSxVQUFVLE1BQU0sVUFBVSxTQUFTLFFBQVE7QUFDakY7OztBRHBEQSxJQUFNLG1CQUFtQixDQUFDLHFCQUFxQixjQUFjLHFCQUFxQixxQkFBcUI7QUFDdkcsSUFBTSxvQkFBb0I7QUFFbkIsSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBTzNCLFlBQTZCLEtBQW9CO0FBQXBCO0FBQUEsRUFBcUI7QUFBQSxFQU4xQyxRQUFRLG9CQUFJLElBQXFEO0FBQUEsRUFDakUsaUJBQWlCLG9CQUFJLElBQW9CO0FBQUE7QUFBQSxFQUV6QyxpQkFBaUIsb0JBQUksSUFBd0c7QUFBQSxFQUM3SCxrQkFBa0Isb0JBQUksSUFBb0I7QUFBQTtBQUFBLEVBS2xELGFBQXVCO0FBQ3JCLFdBQU8sQ0FBQyxHQUFHLEtBQUssTUFBTSxRQUFRLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLGFBQWEsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDLElBQUksTUFBTSxJQUFJO0FBQUEsRUFDakc7QUFBQTtBQUFBLEVBR0EsY0FBd0I7QUFDdEIsV0FBTyxDQUFDLEdBQUcsS0FBSyxNQUFNLFFBQVEsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsYUFBYSxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxNQUFNLElBQUk7QUFBQSxFQUNsRztBQUFBLEVBRUEsTUFBTSxVQUF5QjtBQUM3QixVQUFNLEtBQUssYUFBYTtBQUN4QixTQUFLLGVBQWUsTUFBTTtBQUMxQixVQUFNLEtBQUssaUJBQWlCO0FBQzVCLFNBQUssY0FBYztBQUNuQixVQUFNLEtBQUssY0FBYztBQUFBLEVBQzNCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsTUFBTSxnQkFBK0I7QUFDbkMsZUFBVyxTQUFTLE9BQU8sT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsTUFBTSxHQUFHO0FBQy9ELFVBQUksQ0FBQyxNQUFNLGFBQWEsTUFBTSxTQUFTLFdBQVk7QUFDbkQsWUFBTSxPQUFPLEtBQUssZUFBZSxJQUFJLE1BQU0sU0FBUztBQUNwRCxVQUFJLENBQUMsS0FBTTtBQUNYLFlBQU0sUUFBUSxNQUFNLGFBQWEsS0FBSyxLQUFLLEtBQUssU0FBUztBQUN6RCxVQUFJLE1BQU0sU0FBUyxTQUFTLE1BQU0sVUFBVSxVQUFXO0FBQ3ZELFlBQU0sUUFBUSxDQUFDLFFBQVMsTUFBTSxVQUFVLGFBQWEsTUFBTSxPQUFPLFNBQVMsTUFBTSxRQUFTLEtBQUssV0FBVyxTQUFTLFlBQVk7QUFDL0gsV0FBSyxJQUFJLE1BQU0sWUFBWSxNQUFNLElBQUksS0FBSyxhQUFhLEdBQUcsRUFBRSxNQUFNLE9BQU8sT0FBTyxVQUFVLENBQUMsY0FBYyxFQUFFLEdBQUcsTUFBTSxLQUFLO0FBQUEsSUFDM0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQThCO0FBQzFDLFVBQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQWlDLENBQUMsV0FBVyxNQUFNLENBQUM7QUFDdEYsUUFBSSxDQUFDLE9BQU8sSUFBSTtBQUNkLFdBQUssSUFBSSxJQUFJLGlCQUFpQixPQUFPLElBQUksSUFBSSxPQUFPLE9BQU8sRUFBRTtBQUM3RDtBQUFBLElBQ0Y7QUFDQSxVQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFO0FBQ3JDLFVBQU0sT0FBTyxvQkFBSSxJQUFZO0FBQzdCLGVBQVcsQ0FBQyxVQUFVLElBQUksS0FBSyxPQUFPLFFBQVEsT0FBTyxNQUFNLEdBQUc7QUFDNUQsVUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLFFBQVEsS0FBSyxRQUFRLEVBQUc7QUFDNUMsaUJBQVcsV0FBVyxLQUFLLFVBQVU7QUFDbkMsYUFBSyxJQUFJLFFBQVEsRUFBRTtBQUNuQixjQUFNLFFBQVEsSUFBSSxRQUFRLEtBQUs7QUFDL0IsY0FBTSxTQUF3QjtBQUFBLFVBQzVCLElBQUksUUFBUTtBQUFBLFVBQ1o7QUFBQSxVQUNBO0FBQUEsVUFDQSxPQUFPLE9BQU8sYUFBYSxRQUFRLEVBQUUsTUFBTSxRQUFRLE9BQU8sYUFBYSxLQUFLLElBQUksV0FBYztBQUFBLFVBQzlGLFFBQVEsS0FBSyxvQkFBb0IsUUFBUTtBQUFBLFFBQzNDO0FBQ0EsYUFBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsV0FBVyxJQUFJLFFBQVEsSUFBSSxPQUFPLE9BQU8sQ0FBQztBQUN2RSxjQUFNLE9BQU8sSUFBSSxRQUFRLElBQUk7QUFDN0IsWUFBSSxLQUFNLE1BQUssTUFBTSxJQUFJLFFBQVEsSUFBSSxHQUFHLEVBQUUsV0FBVyxRQUFRLElBQUksU0FBUyxDQUFDO0FBQUEsTUFDN0U7QUFBQSxJQUNGO0FBQ0EsZUFBVyxNQUFNLE9BQU8sS0FBSyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsUUFBUSxFQUFHLEtBQUksQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFHLE1BQUssSUFBSSxNQUFNLElBQUksRUFBRSxRQUFRLFdBQVcsSUFBSSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQzVJO0FBQUEsRUFFQSxNQUFjLG1CQUFrQztBQUM5QyxRQUFJLFNBQVM7QUFDYixlQUFXLENBQUMsTUFBTSxFQUFFLFVBQVUsQ0FBQyxLQUFLLEtBQUssT0FBTztBQUM5QyxZQUFNLE1BQU0sS0FBSyxNQUFNLFVBQVU7QUFDakMsVUFBSTtBQUNKLFVBQUk7QUFDRixpQkFBUyxNQUFNLFFBQVEsR0FBRyxHQUFHLE9BQU8sQ0FBQyxTQUFTLGNBQWMsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUN4RSxRQUFRO0FBQ047QUFBQSxNQUNGO0FBQ0EsaUJBQVcsUUFBUSxPQUFPO0FBQ3hCLFlBQUksWUFBWSxFQUFHO0FBQ25CLFlBQUk7QUFDRixnQkFBTSxTQUFTLEtBQUssTUFBTSxNQUFNLFNBQVMsS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLENBQUM7QUFDakUsZ0JBQU0sWUFBWSxJQUFJLE9BQU8sU0FBUztBQUN0QyxjQUFJLFdBQVc7QUFDYixpQkFBSyxlQUFlLElBQUksV0FBVyxTQUFTO0FBQzVDLGdCQUFJLE9BQU8sT0FBTyxRQUFRLFNBQVUsTUFBSyxlQUFlLElBQUksV0FBVyxFQUFFLEtBQUssT0FBTyxLQUFLLFdBQVcsT0FBTyxhQUFhLE9BQU8sT0FBTyxPQUFPLE9BQU8sU0FBUyxHQUFHLFFBQVEsSUFBSSxPQUFPLE1BQU0sR0FBRyxXQUFXLE9BQU8sT0FBTyxjQUFjLFdBQVcsT0FBTyxZQUFZLEtBQUssQ0FBQztBQUFBLFVBQzFRO0FBQUEsUUFDRixRQUFRO0FBQUEsUUFFUjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxTQUFTLE9BQWtGO0FBQ3pGLFFBQUksQ0FBQyxNQUFNLFdBQVk7QUFDdkIsZUFBVyxPQUFPLGtCQUFrQjtBQUNsQyxZQUFNLFFBQVEsTUFBTSxNQUFNLEdBQUc7QUFDN0IsVUFBSSxDQUFDLE1BQU87QUFDWixZQUFNLFlBQVksS0FBSyxxQkFBcUIsS0FBSztBQUNqRCxVQUFJLFdBQVc7QUFDYixhQUFLLGdCQUFnQixJQUFJLE1BQU0sWUFBWSxTQUFTO0FBQ3BEO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxxQkFBcUIsS0FBNEI7QUFDL0MsVUFBTSxTQUFTLFFBQVEsR0FBRztBQUMxQixlQUFXLENBQUMsTUFBTSxFQUFFLFVBQVUsQ0FBQyxLQUFLLEtBQUssT0FBTztBQUU5QyxVQUFJLFdBQVcsUUFBUSxXQUFXLFFBQVEsSUFBSSxLQUFLLE9BQU8sV0FBVyxPQUFPLEdBQUcsRUFBRyxRQUFPO0FBQUEsSUFDM0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsZ0JBQXNCO0FBQ3BCLFVBQU0sUUFBUSxLQUFLLElBQUksTUFBTSxLQUFLO0FBQ2xDLGVBQVcsU0FBUyxPQUFPLE9BQU8sTUFBTSxNQUFNLEdBQUc7QUFDL0MsVUFBSSxNQUF5QjtBQUM3QixZQUFNLGNBQWMsTUFBTSxZQUFZLEtBQUssZUFBZSxJQUFJLE1BQU0sU0FBUyxJQUFJO0FBQ2pGLFlBQU0sYUFBYSxNQUFNLGFBQWEsS0FBSyxnQkFBZ0IsSUFBSSxNQUFNLFVBQVUsSUFBSTtBQUNuRixVQUFJLFlBQWEsT0FBTSxLQUFLLElBQUksYUFBYSxjQUFjO0FBQUEsZUFDbEQsV0FBWSxPQUFNLEtBQUssSUFBSSxZQUFZLGdCQUFnQjtBQUFBLGVBQ3ZELE1BQU0sU0FBUyxjQUFjLE1BQU0sU0FBVSxPQUFNLE1BQU0sT0FBTyxNQUFNLFFBQVEsR0FBRyxXQUFXO0FBQ3JHLFVBQUksQ0FBQyxJQUFLO0FBQ1YsVUFBSSxNQUFNLFdBQVcsTUFBTSxRQUFRLGNBQWMsSUFBSSxhQUFhLE1BQU0sUUFBUSxVQUFVLElBQUksTUFBTztBQUNyRyxXQUFLLElBQUksTUFBTSxZQUFZLE1BQU0sSUFBSSxNQUFNLFlBQVksRUFBRSxTQUFTLEtBQUssVUFBVSxDQUFDLElBQUksTUFBTSxFQUFFLEdBQUcsTUFBTSxLQUFLO0FBQUEsSUFDOUc7QUFBQSxFQUNGO0FBQUEsRUFFUSxJQUFJLFdBQW1CLFFBQTBDO0FBQ3ZFLFVBQU0sVUFBVSxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsU0FBUyxTQUFTO0FBQ3hELFVBQU0sU0FBUyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUU7QUFDckMsVUFBTSxRQUFRLE9BQU8sYUFBYSxTQUFTLE1BQU0sU0FBUyxRQUFRLE9BQU8sYUFBYSxRQUFRLEtBQUssSUFBSSxXQUFjLFNBQVMsU0FBUztBQUN2SSxXQUFPLEVBQUUsV0FBVyxPQUFPLFVBQVUsU0FBUyxZQUFZLE1BQU0sT0FBTztBQUFBLEVBQ3pFO0FBQ0Y7QUFNQSxlQUFzQixhQUFhLEtBQWEsV0FBNEM7QUFDMUYsTUFBSTtBQUNGLFlBQVEsS0FBSyxLQUFLLENBQUM7QUFBQSxFQUNyQixTQUFTLE9BQU87QUFDZCxRQUFLLE1BQWdDLFNBQVMsUUFBUyxRQUFPO0FBQUEsRUFDaEU7QUFDQSxNQUFJLGFBQWEsUUFBUSxhQUFhLFNBQVM7QUFDN0MsUUFBSTtBQUNGLFlBQU1DLFFBQU8sTUFBTSxTQUFTLFNBQVMsR0FBRyxTQUFTLE1BQU07QUFDdkQsWUFBTSxTQUFTQSxNQUFLLE1BQU1BLE1BQUssWUFBWSxHQUFHLElBQUksQ0FBQyxFQUFFLE1BQU0sR0FBRztBQUM5RCxhQUFPLE9BQU8sRUFBRSxNQUFNO0FBQUEsSUFDeEIsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDs7O0FFM0tPLElBQU0sZ0JBQU4sTUFBb0I7QUFBQSxFQUNqQixRQUFRLG9CQUFJLElBQW9CO0FBQUEsRUFFeEMsS0FBSyxTQUFpQixNQUF1QjtBQUMzQyxlQUFXLE9BQU8sUUFBUSxJQUFJLEdBQUc7QUFFL0IsWUFBTSxXQUFXLEtBQUssTUFBTSxJQUFJLEdBQUc7QUFDbkMsVUFBSSxZQUFZLFNBQVMsV0FBVyxXQUFXLEtBQUssQ0FBQyxRQUFRLFdBQVcsV0FBVyxFQUFHO0FBQ3RGLFdBQUssTUFBTSxJQUFJLEtBQUssT0FBTztBQUFBLElBQzdCO0FBQUEsRUFDRjtBQUFBLEVBRUEsUUFBUSxNQUFnQztBQUN0QyxlQUFXLE9BQU8sUUFBUSxJQUFJLEdBQUc7QUFDL0IsWUFBTSxLQUFLLEtBQUssTUFBTSxJQUFJLEdBQUc7QUFDN0IsVUFBSSxHQUFJLFFBQU87QUFBQSxJQUNqQjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxZQUFZLFNBQXVCO0FBQ2pDLGVBQVcsQ0FBQyxLQUFLLEVBQUUsS0FBSyxLQUFLLE1BQU8sS0FBSSxPQUFPLFFBQVMsTUFBSyxNQUFNLE9BQU8sR0FBRztBQUFBLEVBQy9FO0FBQ0Y7QUFFQSxTQUFTLFFBQVEsTUFBMkI7QUFDMUMsUUFBTSxNQUFnQixDQUFDO0FBQ3ZCLE1BQUksS0FBSyxRQUFTLEtBQUksS0FBSyxRQUFRLGlCQUFpQixLQUFLLE9BQU8sQ0FBQyxFQUFFO0FBQ25FLE1BQUksS0FBSyxlQUFnQixLQUFJLEtBQUssVUFBVSxLQUFLLGNBQWMsRUFBRTtBQUNqRSxNQUFJLEtBQUssV0FBWSxLQUFJLEtBQUssUUFBUSxLQUFLLFVBQVUsRUFBRTtBQUN2RCxNQUFJLEtBQUssVUFBVyxLQUFJLEtBQUssV0FBVyxLQUFLLFNBQVMsRUFBRTtBQUN4RCxTQUFPO0FBQ1Q7QUFPTyxTQUFTLGlCQUFpQixTQUF5QjtBQUN4RCxNQUFJLFFBQVEsV0FBVywyQkFBMkIsRUFBRyxRQUFPLFFBQVEsTUFBTSxHQUFHLEVBQUUsQ0FBQztBQUNoRixTQUFPO0FBQ1Q7QUFHTyxTQUFTLFlBQVksR0FBa0IsR0FBMkI7QUFDdkUsU0FBTyxRQUFRLEtBQUssS0FBSyxpQkFBaUIsQ0FBQyxNQUFNLGlCQUFpQixDQUFDLENBQUM7QUFDdEU7OztBQ2xEQSxJQUFNLFFBQStCLENBQUMsYUFBYSxjQUFjLFdBQVcsVUFBVSxnQkFBZ0IsU0FBUyxTQUFTLFVBQVUsVUFBVSxnQkFBZ0IsYUFBYTtBQUVsSyxTQUFTLGVBQWUsT0FBa0IsVUFBeUIsVUFBa0IsVUFBd0I7QUFDbEgsTUFBSSxhQUFhLFNBQVU7QUFDM0IsUUFBTSxRQUFRLE1BQU0sS0FBSztBQUN6QixRQUFNLFNBQVMsTUFBTSxPQUFPLFFBQVE7QUFDcEMsUUFBTSxTQUFTLE1BQU0sT0FBTyxRQUFRO0FBQ3BDLE1BQUksQ0FBQyxVQUFVLENBQUMsT0FBUTtBQUN4QixRQUFNLFFBQThCLEVBQUUsVUFBVSxPQUFPLFNBQVM7QUFDaEUsYUFBVyxPQUFPLE1BQU8sS0FBSSxPQUFPLEdBQUcsS0FBSyxRQUFRLE9BQU8sR0FBRyxLQUFLLEtBQU0sQ0FBQyxNQUFrQyxHQUFHLElBQUksT0FBTyxHQUFHO0FBRTdILE1BQUksT0FBTyxhQUFhLE9BQU8sV0FBWSxRQUFPLE9BQU8sT0FBTyxFQUFFLE9BQU8sT0FBTyxPQUFPLE1BQU0sT0FBTyxNQUFNLFlBQVksT0FBTyxXQUFXLENBQUM7QUFDekksUUFBTSxZQUFZLFVBQVUsS0FBSyxJQUFJLE9BQU8sWUFBWSxPQUFPLFVBQVUsR0FBRyxPQUFPLE1BQU0sTUFBTTtBQUUvRixhQUFXLFNBQVMsT0FBTyxPQUFPLE1BQU0sTUFBTSxFQUFHLEtBQUksTUFBTSxhQUFhLFNBQVUsT0FBTSxZQUFZLE1BQU0sSUFBSSxNQUFNLFlBQVksRUFBRSxVQUFVLFNBQVMsR0FBRyxNQUFNLEtBQUs7QUFDbkssUUFBTSxZQUFZLFFBQVE7QUFDMUIsV0FBUyxZQUFZLFFBQVE7QUFDN0IsV0FBUyxLQUFLLFVBQVUsRUFBRSxZQUFZLE9BQU8sWUFBWSxXQUFXLE9BQU8sV0FBVyxTQUFTLE9BQU8sUUFBUSxDQUFDO0FBQ2pIO0FBRUEsSUFBTSxPQUFPLENBQUMsVUFBd0IsTUFBTSxhQUFhLElBQUksTUFBTSxTQUFTLFNBQVMsSUFBSTtBQU9sRixTQUFTLFlBQVksT0FBa0IsVUFBeUIsU0FBeUI7QUFDOUYsUUFBTSxRQUFRLE1BQU0sS0FBSyxFQUFFLE9BQU8sT0FBTztBQUN6QyxNQUFJLENBQUMsU0FBUyxNQUFNLFNBQVMsV0FBWSxRQUFPO0FBQ2hELE1BQUksV0FBVztBQUNmLGFBQVcsU0FBUyxPQUFPLE9BQU8sTUFBTSxLQUFLLEVBQUUsTUFBTSxHQUFHO0FBQ3RELFFBQUksTUFBTSxPQUFPLFNBQVMsTUFBTSxNQUFNLFNBQVMsV0FBWTtBQUUzRCxRQUFJLE1BQU0sY0FBYyxTQUFTLFdBQVk7QUFDN0MsVUFBTSxPQUNILE1BQU0sY0FBYyxNQUFNLGVBQWUsU0FBUyxjQUNsRCxNQUFNLGFBQWEsTUFBTSxjQUFjLFNBQVMsYUFDakQsWUFBWSxNQUFNLFNBQVMsU0FBUyxPQUFPO0FBQzdDLFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxZQUFZLEtBQUssS0FBSyxJQUFJLEtBQUssUUFBUSxLQUFNLEtBQUssS0FBSyxNQUFNLEtBQUssUUFBUSxLQUFLLE1BQU0sYUFBYSxTQUFTO0FBQ2pILFVBQU0sQ0FBQyxRQUFRLE1BQU0sSUFBSSxZQUFZLENBQUMsT0FBTyxRQUFRLElBQUksQ0FBQyxVQUFVLEtBQUs7QUFDekUsbUJBQWUsT0FBTyxVQUFVLE9BQU8sSUFBSSxPQUFPLEVBQUU7QUFDcEQsZUFBVyxNQUFNLEtBQUssRUFBRSxPQUFPLE9BQU8sRUFBRSxLQUFLO0FBQUEsRUFDL0M7QUFDQSxTQUFPLFNBQVM7QUFDbEI7QUFHTyxTQUFTLGtCQUFrQixPQUFrQixVQUF5QixpQkFBK0I7QUFDMUcsUUFBTSxTQUFTLE1BQU0sS0FBSyxFQUFFLE9BQU8sZUFBZTtBQUNsRCxNQUFJLENBQUMsUUFBUSxRQUFTO0FBQ3RCLGFBQVcsU0FBUyxPQUFPLE9BQU8sTUFBTSxLQUFLLEVBQUUsTUFBTSxHQUFHO0FBQ3RELFFBQUksTUFBTSxPQUFPLG1CQUFtQixNQUFNLGNBQWMsTUFBTSxTQUFTLFVBQVUsTUFBTSxTQUFTLFdBQVk7QUFDNUcsUUFBSSxZQUFZLE1BQU0sU0FBUyxPQUFPLE9BQU8sRUFBRyxnQkFBZSxPQUFPLFVBQVUsaUJBQWlCLE1BQU0sRUFBRTtBQUFBLEVBQzNHO0FBQ0Y7OztBQ3BDQSxJQUFNLDBCQUEwQjtBQUV6QixJQUFNLGdCQUFOLE1BQW9CO0FBQUEsRUFJekIsWUFBNkIsS0FBb0I7QUFBcEI7QUFBQSxFQUFxQjtBQUFBLEVBSDFDLGtCQUFrQixvQkFBSSxJQUE0QjtBQUFBLEVBQ2xELFdBQVc7QUFBQSxFQUluQixnQkFBZ0IsTUFBNEM7QUFDMUQsV0FBTyxPQUFPLEtBQUssZ0JBQWdCLElBQUksSUFBSSxLQUFLLE9BQU87QUFBQSxFQUN6RDtBQUFBO0FBQUEsRUFHQSxNQUFNLE9BQXNCO0FBQzFCLFFBQUksS0FBSyxTQUFVO0FBQ25CLFNBQUssV0FBVztBQUNoQixRQUFJO0FBQ0YsWUFBTSxFQUFFLEtBQUssSUFBSSxLQUFLLElBQUk7QUFDMUIsVUFBSSxDQUFDLEtBQUssSUFBSSxnQkFBZ0IsRUFBRztBQUNqQyxZQUFNLFNBQVMsTUFBTSxLQUFLLEtBQUssa0JBQWtCLEVBQUUsZUFBZSxLQUFLLENBQUM7QUFDeEUsWUFBTSxPQUFPLG9CQUFJLElBQVk7QUFDN0IsaUJBQVcsT0FBTyxPQUFPLFlBQVk7QUFDbkMsY0FBTSxTQUF5QjtBQUFBLFVBQzdCLElBQUksSUFBSTtBQUFBLFVBQ1IsTUFBTSxJQUFJO0FBQUEsVUFDVixNQUFNLElBQUk7QUFBQSxVQUNWLFFBQVEsSUFBSTtBQUFBLFVBQ1osU0FBUyxJQUFJLFdBQVc7QUFBQSxVQUN4QixXQUFXLElBQUksYUFBYTtBQUFBLFVBQzVCLFFBQVEsSUFBSTtBQUFBLFVBQ1osTUFBTSxJQUFJO0FBQUEsVUFDVixRQUFRLElBQUksUUFBUSxTQUFTO0FBQUEsVUFDN0IsZUFBZSxJQUFJLFFBQVEsaUJBQWlCO0FBQUEsVUFDNUMsZ0JBQWdCLElBQUksUUFBUSxrQkFBa0I7QUFBQSxVQUM5QyxTQUFTO0FBQUEsUUFDWDtBQUNBLGFBQUssSUFBSSxJQUFJLEVBQUU7QUFDZixhQUFLLGdCQUFnQixJQUFJLElBQUksTUFBTSxNQUFNO0FBQ3pDLGNBQU0sV0FBVyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsVUFBVSxJQUFJLEVBQUU7QUFDdkQsYUFBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsWUFBWSxJQUFJLElBQUksSUFBSSxPQUFPLEVBQUUsR0FBRyxRQUFRLFVBQVUsVUFBVSxXQUFXLEtBQUssRUFBRSxFQUFFLENBQUM7QUFDbEgsWUFBSSxDQUFDLFVBQVU7QUFDYixlQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxLQUFLLElBQUksSUFBSSxHQUFHLE1BQU0sb0JBQW9CLFFBQVEsYUFBYSxVQUFVLElBQUksSUFBSSxTQUFTLFlBQVksSUFBSSxJQUFJLEtBQUssSUFBSSxVQUFVLFdBQVcsSUFBSSxDQUFDO0FBQUEsUUFDN0s7QUFBQSxNQUNGO0FBQ0EsaUJBQVcsTUFBTSxPQUFPLEtBQUssS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLFNBQVMsR0FBRztBQUM3RCxZQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsS0FBSyxDQUFDLE9BQU8sVUFBVyxNQUFLLElBQUksTUFBTSxJQUFJLEVBQUUsUUFBUSxZQUFZLElBQUksT0FBTyxLQUFLLENBQUM7QUFBQSxNQUNwRztBQUNBLFlBQU0sS0FBSyxhQUFhO0FBQ3hCLFlBQU0sS0FBSyxXQUFXLE9BQU8sVUFBVTtBQUFBLElBQ3pDLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxJQUFJLHVCQUF3QixNQUFnQixPQUFPLEVBQUU7QUFBQSxJQUNoRSxVQUFFO0FBQ0EsV0FBSyxXQUFXO0FBQUEsSUFDbEI7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsZUFBOEI7QUFDMUMsVUFBTSxFQUFFLEtBQUssSUFBSSxLQUFLLElBQUk7QUFDMUIsUUFBSSxDQUFDLEtBQUssSUFBSSxjQUFjLEVBQUc7QUFDL0IsUUFBSTtBQUNGLFlBQU0sRUFBRSxVQUFVLFVBQVUsSUFBSSxNQUFNLEtBQUssS0FBSyxnQkFBZ0IsQ0FBQyxDQUFDO0FBQ2xFLFlBQU0sT0FBTyxvQkFBSSxJQUFZO0FBQzdCLGlCQUFXLEtBQUssVUFBVTtBQUN4QixhQUFLLElBQUksRUFBRSxFQUFFO0FBQ2IsYUFBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsV0FBVyxJQUFJLEVBQUUsSUFBSSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLE1BQU0sTUFBTSxFQUFFLE1BQU0sUUFBUSxFQUFFLFFBQVEsUUFBUSxFQUFFLFdBQVcsS0FBSyxFQUFFLENBQUM7QUFBQSxNQUNoSztBQUNBLFVBQUksQ0FBQztBQUFXLG1CQUFXLE1BQU0sT0FBTyxLQUFLLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQyxFQUFHLEtBQUksQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFHLE1BQUssSUFBSSxNQUFNLElBQUksRUFBRSxRQUFRLFdBQVcsSUFBSSxPQUFPLEtBQUssQ0FBQztBQUFBO0FBQUEsSUFDbEssU0FBUyxPQUFPO0FBQ2QsV0FBSyxJQUFJLElBQUksd0JBQXlCLE1BQWdCLE9BQU8sRUFBRTtBQUFBLElBQ2pFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxXQUFXLFlBQXFJO0FBQzVKLFVBQU0sRUFBRSxLQUFLLElBQUksS0FBSyxJQUFJO0FBQzFCLFFBQUksQ0FBQyxLQUFLLElBQUksYUFBYSxFQUFHO0FBQzlCLFVBQU0sZ0JBQWdCLEtBQUssSUFBSSxLQUFLLEtBQUssU0FBUyxNQUFNO0FBQ3hELFVBQU0sVUFBVSxlQUNaLFdBQVcsT0FBTyxDQUFDLE9BQU8sRUFBRSxRQUFRLGlCQUFpQixLQUFLLEtBQU0sRUFBRSxVQUFVLEVBQUUsT0FBTyxVQUFVLFVBQVcsRUFBRSxNQUFNLEdBQUcsdUJBQXVCLElBQzVJLENBQUM7QUFDTCxVQUFNLFFBQVEsZUFBZSxRQUFRLElBQUksQ0FBQyxPQUFPLEVBQUUsV0FBVyxFQUFxQixFQUFFLElBQUksQ0FBQyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQzdHLGVBQVcsRUFBRSxVQUFVLEtBQUssT0FBTztBQUNqQyxVQUFJO0FBRUYsY0FBTSxTQUFTLE1BQU0sS0FBSyxLQUFLLGVBQWdCLFlBQVksRUFBRSxhQUFhLFVBQVUsR0FBRyxJQUFJLENBQUMsQ0FBMkI7QUFDdkgsbUJBQVcsT0FBTyxPQUFPLE9BQTBCLE1BQUssU0FBUyxLQUFLLFNBQVM7QUFBQSxNQUNqRixTQUFTLE9BQU87QUFDZCxhQUFLLElBQUksSUFBSSwwQkFBMEIsV0FBVyxNQUFNLG1CQUFtQixLQUFNLE1BQWdCLE9BQU8sRUFBRTtBQUFBLE1BQzVHO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLFNBQVMsS0FBbUIsV0FBNkU7QUFDL0csVUFBTSxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQ3pCLFVBQU0sYUFBYSxLQUFLLElBQUksU0FBUyxRQUFRLEVBQUUsWUFBWSxJQUFJLFlBQVksV0FBVyxJQUFJLGFBQWEsS0FBSyxDQUFDO0FBQzdHLFVBQU0sS0FBSyxlQUFlLElBQUksYUFBYSxRQUFRLElBQUksVUFBVSxLQUFLLElBQUksWUFBWSxXQUFXLElBQUksU0FBUyxLQUFLO0FBQ25ILFFBQUksQ0FBQyxHQUFJO0FBQ1QsVUFBTSxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLEVBQUU7QUFDaEQsVUFBTSxRQUFRLFNBQVMsSUFBSSxLQUFLO0FBQ2hDLFNBQUssSUFBSSxNQUFNO0FBQUEsTUFDYjtBQUFBLE1BQ0EsSUFBSSxrQkFBa0I7QUFBQSxNQUN0QjtBQUFBLFFBQ0UsT0FBTyxJQUFJLFNBQVM7QUFBQSxRQUNwQixPQUFPLElBQUksU0FBUztBQUFBLFFBQ3BCLFlBQVksSUFBSSxjQUFjO0FBQUEsUUFDOUIsV0FBVyxJQUFJLGFBQWE7QUFBQSxRQUM1QixhQUFhLFdBQVc7QUFBQSxRQUN4QixjQUFjLFdBQVc7QUFBQSxRQUN6QixRQUFRLFdBQVcsVUFBVTtBQUFBLFFBQzdCLGFBQWEsSUFBSSxNQUFNLFNBQVM7QUFBQSxRQUNoQztBQUFBLFFBQ0EsWUFBWSxJQUFJLGtCQUFrQjtBQUFBLFFBQ2xDLE1BQU0sVUFBVTtBQUFBLFFBQ2hCLFdBQVcsVUFBVSxhQUFhLElBQUksa0JBQWtCO0FBQUEsUUFDeEQsVUFBVSxDQUFDLFdBQVc7QUFBQSxNQUN4QjtBQUFBLE1BQ0EsTUFBTSxTQUFTLElBQUksU0FBUyxHQUFHO0FBQUEsSUFDakM7QUFDQSxTQUFLLElBQUksU0FBUyxLQUFLLElBQUksRUFBRSxZQUFZLElBQUksWUFBWSxXQUFXLElBQUksYUFBYSxLQUFLLENBQUM7QUFDM0YsZ0JBQVksS0FBSyxJQUFJLE9BQU8sS0FBSyxJQUFJLFVBQVUsRUFBRTtBQUNqRCxRQUFJLENBQUMsU0FBVSxNQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxLQUFLLE1BQU0saUJBQWlCLFFBQVEsYUFBYSxVQUFVLElBQUksU0FBUyxHQUFHLElBQUksU0FBUyxPQUFPLElBQUksSUFBSSxTQUFTLEVBQUUsV0FBVyxJQUFJLEtBQUssSUFBSSxLQUFLLEVBQUUsQ0FBQztBQUFBLEVBQzdMO0FBQUE7QUFBQSxFQUdBLFNBQVMsT0FBMEI7QUFDakMsVUFBTSxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQ3pCLFVBQU0sT0FBTyxFQUFFLFNBQVMsTUFBTSxTQUFTLFlBQVksTUFBTSxjQUFjLE1BQU0sV0FBVyxNQUFNLGFBQWEsS0FBSztBQUNoSCxVQUFNLEtBQUssS0FBSyxJQUFJLFNBQVMsUUFBUSxJQUFJLE1BQU0sTUFBTSxhQUFhLFFBQVEsTUFBTSxVQUFVLEtBQUssUUFBUSxNQUFNLE9BQU87QUFDcEgsVUFBTSxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLEVBQUU7QUFDaEQsVUFBTSxPQUFPLE1BQU07QUFDbkIsVUFBTSxRQUFRLFNBQVUsTUFBTSxTQUFrQyxNQUFNLE9BQU8sTUFBTSxPQUFPO0FBQzFGLFVBQU0sWUFBWSxNQUFNLGtCQUFrQixLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsVUFBVSxNQUFNLGVBQWUsSUFBSTtBQUNuRyxVQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU07QUFBQSxNQUM1QjtBQUFBLE1BQ0EsTUFBTSxjQUFjO0FBQUEsTUFDcEI7QUFBQSxRQUNFLFNBQVMsTUFBTTtBQUFBLFFBQ2YsWUFBWSxNQUFNO0FBQUEsUUFDbEIsV0FBVyxNQUFNO0FBQUEsUUFDakIsT0FBTyxNQUFNO0FBQUEsUUFDYixhQUFhLE1BQU0sbUJBQW1CLE1BQU0sZUFBZTtBQUFBLFFBQzNELGNBQWMsV0FBVztBQUFBLFFBQ3pCLFFBQVEsV0FBVyxVQUFVO0FBQUEsUUFDN0I7QUFBQSxRQUNBLFNBQVMsTUFBTSxXQUFXO0FBQUEsUUFDMUIsWUFBWSxNQUFNLGtCQUFrQixNQUFNO0FBQUEsUUFDMUMsTUFBTSxVQUFVLGFBQWEsVUFBVSxhQUFhLFVBQVU7QUFBQSxRQUM5RCxXQUFXLFVBQVUsYUFBYSxNQUFNLGNBQWM7QUFBQSxRQUN0RCxTQUFTLFVBQVUsVUFBVSxVQUFVLFdBQVcsTUFBTSxhQUFhO0FBQUEsUUFDckUsVUFBVSxDQUFDLFlBQVk7QUFBQSxNQUN6QjtBQUFBLE1BQ0EsTUFBTSxTQUFTLElBQUksU0FBUyxHQUFHO0FBQUEsSUFDakM7QUFDQSxTQUFLLElBQUksU0FBUyxLQUFLLElBQUksSUFBSTtBQUMvQixnQkFBWSxLQUFLLElBQUksT0FBTyxLQUFLLElBQUksVUFBVSxFQUFFO0FBQ2pELFFBQUksQ0FBQyxZQUFZLFNBQVMsVUFBVSxPQUFPLE9BQU87QUFDaEQsWUFBTSxPQUFPLENBQUMsV0FBVyxrQkFBa0IsVUFBVSxXQUFXLGlCQUFpQixVQUFVLFNBQVMsb0JBQW9CO0FBQ3hILFdBQUssSUFBSSxNQUFNLEtBQUs7QUFBQSxRQUNsQixJQUFJLE1BQU0sY0FBYztBQUFBLFFBQ3hCO0FBQUEsUUFDQSxRQUFRO0FBQUEsUUFDUixVQUFVO0FBQUEsUUFDVixPQUFPLE9BQU87QUFBQSxRQUNkLFNBQVMsR0FBRyxPQUFPLFNBQVMsT0FBTyxTQUFTLE9BQU8sS0FBSyxVQUFVLFNBQVMsS0FBSyxXQUFNLEtBQUssR0FBRyxNQUFNLFVBQVUsS0FBSyxLQUFLLE9BQU8sTUFBTSxFQUFFO0FBQUEsTUFDekksQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQ0Y7QUFFTyxTQUFTLFNBQVMsT0FBbUQsU0FBcUM7QUFDL0csTUFBSSxVQUFVLFVBQVUsWUFBWSxZQUFZLGFBQWEsWUFBWSxnQkFBaUIsUUFBTztBQUNqRyxTQUFPO0FBQ1Q7OztBQ3RNQSxJQUFNLFdBQVc7QUFHakIsSUFBTSxXQUErQjtBQUFBLEVBQ25DLENBQUMsK0VBQStFLHdCQUF3QjtBQUFBO0FBQUEsRUFFeEcsQ0FBQyx3Q0FBd0MsY0FBYztBQUFBLEVBQ3ZELENBQUMsa0NBQWtDLGdCQUFnQjtBQUFBLEVBQ25ELENBQUMsOEJBQThCLGdCQUFnQjtBQUFBLEVBQy9DLENBQUMsbUNBQW1DLGtCQUFrQjtBQUFBLEVBQ3RELENBQUMscUNBQXFDLGtCQUFrQjtBQUFBLEVBQ3hELENBQUMscUNBQXFDLGtCQUFrQjtBQUFBLEVBQ3hELENBQUMsMkJBQTJCLG9CQUFvQjtBQUFBLEVBQ2hELENBQUMsK0JBQStCLGdCQUFnQjtBQUFBLEVBQ2hELENBQUMsc0VBQXNFLGdCQUFnQjtBQUFBO0FBQUEsRUFFdkYsQ0FBQyx1REFBdUQsS0FBSyxRQUFRLEdBQUc7QUFDMUU7QUFLQSxJQUFNLGtCQUFrQixvQkFBSSxJQUFJLENBQUMsWUFBWSxVQUFVLGNBQWMsVUFBVSxjQUFjLGVBQWUsaUJBQWlCLFVBQVUsWUFBWSxDQUFDO0FBRXBKLElBQU0sZUFBZSxvQkFBSSxJQUFJLENBQUMsT0FBTyxVQUFVLFdBQVcsVUFBVSxRQUFRLFdBQVcsY0FBYyxVQUFVLFVBQVUsV0FBVyxTQUFTLENBQUM7QUFFOUksU0FBUyxTQUFTLEtBQXVCO0FBQ3ZDLFNBQU8sSUFDSixNQUFNLFFBQVEsRUFDZCxRQUFRLENBQUMsU0FBUyxLQUFLLFFBQVEsc0JBQXNCLE9BQU8sRUFBRSxNQUFNLEdBQUcsQ0FBQyxFQUN4RSxPQUFPLE9BQU8sRUFDZCxJQUFJLENBQUMsUUFBUSxJQUFJLFlBQVksQ0FBQztBQUNuQztBQUdPLFNBQVMsZUFBZSxLQUFzQjtBQUNuRCxRQUFNLE9BQU8sU0FBUyxHQUFHO0FBQ3pCLE1BQUksS0FBSyxXQUFXLEVBQUcsUUFBTztBQUM5QixNQUFJLEtBQUssS0FBSyxDQUFDLFFBQVEsZ0JBQWdCLElBQUksR0FBRyxDQUFDLEVBQUcsUUFBTztBQUN6RCxRQUFNLFFBQVEsUUFBUSxLQUFLLEdBQUcsS0FBSyxRQUFRLElBQUksWUFBWTtBQUMzRCxRQUFNLE9BQU8sS0FBSyxLQUFLLFNBQVMsQ0FBQztBQUNqQyxNQUFJLFNBQVMsUUFBUyxRQUFPO0FBQzdCLE1BQUksU0FBUyxNQUFPLFFBQU8sU0FBVSxLQUFLLFNBQVMsS0FBSyxhQUFhLElBQUksS0FBSyxLQUFLLFNBQVMsQ0FBQyxDQUFDO0FBQzlGLE1BQUksU0FBUyxPQUFRLFFBQU87QUFDNUIsU0FBTztBQUNUO0FBRUEsU0FBUyxnQkFBZ0IsT0FBd0I7QUFDL0MsU0FBTyxNQUFNLFdBQVcsV0FBVztBQUNyQztBQUlBLElBQU0sTUFBTSxPQUFPO0FBQ25CLElBQU0sS0FBSyxPQUFPO0FBQ2xCLElBQU0sS0FBSyxPQUFPO0FBU2xCLFNBQVMsWUFBWSxNQUFjLFNBQWlCLFNBQTBCO0FBQzVFLFFBQU0sS0FBSyxJQUFJLE9BQU8sUUFBUSxRQUFRLFFBQVEsTUFBTSxTQUFTLEdBQUcsSUFBSSxRQUFRLFFBQVEsUUFBUSxRQUFRLEdBQUc7QUFDdkcsTUFBSSxNQUFNO0FBQ1YsTUFBSSxTQUFTO0FBQ2IsTUFBSTtBQUNKLFVBQVEsSUFBSSxHQUFHLEtBQUssSUFBSSxPQUFPLE1BQU07QUFDbkMsVUFBTSxjQUFjLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztBQUN0QyxRQUFJLGdCQUFnQixNQUFNO0FBQ3hCLFNBQUcsWUFBWSxFQUFFLFFBQVE7QUFDekI7QUFBQSxJQUNGO0FBQ0EsV0FBTyxLQUFLLE1BQU0sUUFBUSxFQUFFLEtBQUssSUFBSTtBQUNyQyxhQUFTLEVBQUUsUUFBUSxFQUFFLENBQUMsRUFBRTtBQUN4QixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUNBLFNBQU8sTUFBTSxLQUFLLE1BQU0sTUFBTTtBQUNoQztBQUdBLElBQU0sYUFBYSxJQUFJLE9BQU8sT0FBTyxhQUFhLEdBQUcsa0JBQWtCLEVBQUUsSUFBSSxFQUFFLEtBQUssR0FBRztBQUV2RixTQUFTLGlCQUFpQixNQUFzQjtBQUM5QyxTQUFPLFlBQVksTUFBTSxZQUFZLENBQUMsQ0FBQyxHQUFHLEtBQUtDLE1BQUssSUFBSSxFQUFFLE1BQU07QUFDOUQsVUFBTSxRQUFRLE1BQU0sTUFBTTtBQUMxQixRQUFJLENBQUMsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLENBQUMsZUFBZSxHQUFJLEVBQUcsUUFBTztBQUN0RSxVQUFNLEtBQUssT0FBTyxTQUFZLE1BQU07QUFDcEMsV0FBTyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHQSxJQUFHLEdBQUcsRUFBRSxHQUFHLFFBQVEsR0FBRyxFQUFFO0FBQUEsRUFDbEQsQ0FBQztBQUNIO0FBR0EsSUFBTSxXQUFXLElBQUksT0FBTyxPQUFPLG9CQUFvQixHQUFHLGtCQUFrQixFQUFFLElBQUksRUFBRSx3QkFBd0IsR0FBRztBQUUvRyxTQUFTLGVBQWUsTUFBc0I7QUFDNUMsU0FBTyxZQUFZLE1BQU0sVUFBVSxDQUFDLENBQUNDLE9BQU0sTUFBTUQsTUFBSyxJQUFJLElBQUksSUFBSSxNQUFNO0FBQ3RFLFVBQU0sUUFBUSxNQUFNLE1BQU0sUUFBUTtBQUNsQyxRQUFJLENBQUMsU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLENBQUMsZUFBZSxJQUFLLEVBQUcsUUFBTztBQUN2RSxXQUFPLEdBQUdDLEtBQUksR0FBR0QsSUFBRyxHQUFHLFFBQVE7QUFBQSxFQUNqQyxDQUFDO0FBQ0g7QUFHQSxJQUFNLGFBQWEsSUFBSSxPQUFPLE9BQU8sa0JBQWtCLEdBQUcsbUJBQW1CLEVBQUUsSUFBSSxFQUFFLGlCQUFpQixHQUFHO0FBQ3pHLElBQU0saUJBQWlCO0FBRXZCLFNBQVMsa0JBQWtCLE1BQXNCO0FBQy9DLFNBQU8sWUFBWSxNQUFNLFlBQVksQ0FBQyxDQUFDLEtBQUtBLE1BQUssSUFBSSxJQUFJLElBQUksTUFBTTtBQUNqRSxRQUFJLENBQUMsZUFBZSxHQUFJLEVBQUcsUUFBTztBQUNsQyxRQUFJLFNBQVMsUUFBVztBQUV0QixVQUFJLEtBQUssU0FBUyxrQkFBa0IsZ0JBQWdCLElBQUksS0FBSyxvQkFBb0IsS0FBSyxJQUFJLEVBQUcsUUFBTztBQUFBLElBQ3RHLE9BQU87QUFDTCxZQUFNLFFBQVEsTUFBTSxNQUFNO0FBQzFCLFVBQUksQ0FBQyxTQUFTLGdCQUFnQixLQUFLLEVBQUcsUUFBTztBQUFBLElBQy9DO0FBQ0EsV0FBTyxHQUFHLEdBQUcsR0FBR0EsSUFBRyxHQUFHLFFBQVE7QUFBQSxFQUNoQyxDQUFDO0FBQ0g7QUFJTyxTQUFTLE9BQU8sTUFBc0I7QUFDM0MsTUFBSSxNQUFNO0FBQ1YsYUFBVyxDQUFDLFNBQVMsV0FBVyxLQUFLLFNBQVUsT0FBTSxJQUFJLFFBQVEsU0FBUyxXQUFXO0FBQ3JGLFFBQU0saUJBQWlCLEdBQUc7QUFDMUIsUUFBTSxlQUFlLEdBQUc7QUFDeEIsUUFBTSxrQkFBa0IsR0FBRztBQUMzQixTQUFPO0FBQ1Q7QUFFTyxTQUFTLGVBQWUsTUFBZ0Q7QUFDN0UsU0FBTyxRQUFRLE9BQU8sT0FBTyxPQUFPLElBQUk7QUFDMUM7QUFHTyxTQUFTLGtCQUFrQixNQUFjLEtBQXFCO0FBQ25FLFNBQU8sU0FBUyxPQUFPLElBQUksR0FBRyxHQUFHO0FBQ25DO0FBU08sU0FBUyxVQUFVLE1BQXNCO0FBRTlDLFNBQU8sS0FBSyxRQUFRLDhDQUE4QyxFQUFFLEVBQUUsUUFBUSxnQ0FBZ0MsRUFBRSxFQUFFLFFBQVEsd0JBQXdCLEVBQUU7QUFDdEo7QUFFTyxTQUFTLFNBQVMsTUFBYyxLQUFxQjtBQUMxRCxTQUFPLEtBQUssVUFBVSxNQUFNLE9BQU8sS0FBSyxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUk7QUFDOUQ7OztBQ3pJTyxJQUFNLHVCQUE2QyxDQUFDLFFBQVEsVUFBVSxhQUFhLFFBQVE7QUFNM0YsU0FBUyxrQkFBa0IsT0FPcEI7QUFDWixRQUFNLFNBQVMsTUFBTSxXQUFXLFlBQVk7QUFDNUMsTUFBSSxNQUFNLGVBQWUsV0FBVyxlQUFlLFdBQVcsU0FBVSxRQUFPO0FBQy9FLFVBQVEsUUFBUTtBQUFBLElBQ2QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxhQUFPLE1BQU0sYUFBYSxJQUFJLGFBQWE7QUFBQSxJQUM3QyxLQUFLO0FBQ0gsVUFBSSxDQUFDLE1BQU0sa0JBQWtCLE1BQU0sYUFBYSxFQUFHLFFBQU87QUFDMUQsVUFBSSxNQUFNLFNBQVMsU0FBVSxRQUFPO0FBQ3BDLFVBQUksTUFBTSxTQUFTLE9BQVEsUUFBTztBQUNsQyxhQUFPO0FBQUEsSUFDVCxLQUFLLGFBQWE7QUFDaEIsWUFBTSxXQUFXLE1BQU0saUJBQWlCLElBQUksWUFBWTtBQUN4RCxVQUFJLFlBQVksZUFBZSxZQUFZLGVBQWdCLFFBQU87QUFDbEUsVUFBSSxZQUFZLFlBQVksWUFBWSxVQUFXLFFBQU87QUFDMUQsVUFBSSxNQUFNLFNBQVMsUUFBUyxRQUFPO0FBQ25DLGFBQU87QUFBQSxJQUNUO0FBQUEsSUFDQSxLQUFLLFVBQVU7QUFDYixZQUFNLFdBQVcsTUFBTSxpQkFBaUIsSUFBSSxZQUFZO0FBQ3hELGFBQU8sUUFBUSxTQUFTLFFBQVEsSUFBSSxjQUFjO0FBQUEsSUFDcEQ7QUFBQSxJQUNBLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVDtBQUNFLGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFFQSxJQUFNLGdCQUFzQztBQUFBLEVBQzFDLENBQUMsU0FBUyxzQ0FBc0M7QUFBQTtBQUFBLEVBRWhELENBQUMsUUFBUSxvSEFBb0g7QUFBQSxFQUM3SCxDQUFDLFVBQVUscUNBQXFDO0FBQUEsRUFDaEQsQ0FBQyxRQUFRLHFEQUFxRDtBQUNoRTtBQUdPLFNBQVMsY0FBYyxPQUF5QjtBQUNyRCxhQUFXLENBQUMsTUFBTSxPQUFPLEtBQUssY0FBZSxLQUFJLFFBQVEsS0FBSyxLQUFLLEVBQUcsUUFBTztBQUM3RSxTQUFPO0FBQ1Q7OztBQ2pFQSxJQUFNLGlCQUFpQixvQkFBSSxJQUFJLENBQUMsV0FBVyxhQUFhLFVBQVUsV0FBVyxDQUFDO0FBQzlFLElBQU0sV0FBVztBQUNqQixJQUFNLHVCQUF1QjtBQUM3QixJQUFNLG1CQUFtQjtBQUV6QixJQUFNLGVBQWU7QUFFckIsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxhQUFhO0FBQ25CLElBQU0sZUFBZTtBQUNyQixJQUFNLGtCQUFrQjtBQUVqQixJQUFNLHVCQUFOLE1BQTJCO0FBQUEsRUFVaEMsWUFBNkIsS0FBb0I7QUFBcEI7QUFBQSxFQUFxQjtBQUFBLEVBVDFDLFFBQVE7QUFBQSxFQUNSLFVBQVU7QUFBQTtBQUFBLEVBRVYsV0FBVyxvQkFBSSxJQUFvQjtBQUFBLEVBQ25DLGVBQWUsb0JBQUksSUFBMEI7QUFBQTtBQUFBLEVBRTdDLFdBQVcsb0JBQUksSUFBb0I7QUFBQSxFQUNuQyxxQkFBcUIsb0JBQUksSUFBb0I7QUFBQTtBQUFBLEVBS3JELFlBQVksS0FBNEI7QUFDdEMsV0FBTyxLQUFLLFNBQVMsSUFBSSxHQUFHLEtBQUs7QUFBQSxFQUNuQztBQUFBLEVBRVEsU0FBUyxLQUFhLE1BQWMsU0FBeUI7QUFDbkUsU0FBSyxTQUFTLElBQUksS0FBSyxJQUFJO0FBQzNCLFFBQUksS0FBSyxTQUFTLE9BQU8saUJBQWlCO0FBQ3hDLFlBQU0sU0FBUyxLQUFLLFNBQVMsS0FBSyxFQUFFLEtBQUssRUFBRTtBQUMzQyxVQUFJLFdBQVcsT0FBVyxNQUFLLFNBQVMsT0FBTyxNQUFNO0FBQUEsSUFDdkQ7QUFDQSxXQUFPLFNBQVMsTUFBTSxPQUFPO0FBQUEsRUFDL0I7QUFBQSxFQUVBLElBQUksZ0JBQXlCO0FBQzNCLFVBQU0sUUFBUSxLQUFLLElBQUksTUFBTSxLQUFLO0FBRWxDLFdBQU8sT0FBTyxPQUFPLE1BQU0sSUFBSSxFQUFFLEtBQUssQ0FBQyxRQUFRLElBQUksVUFBVSxZQUFZLE9BQU8sT0FBTyxNQUFNLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTSxFQUFFLFVBQVUsSUFBSSxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQUEsRUFDaEo7QUFBQSxFQUVBLE1BQU0sT0FBc0I7QUFDMUIsUUFBSSxLQUFLLFdBQVcsQ0FBQyxLQUFLLElBQUksSUFBSSxLQUFNO0FBQ3hDLFNBQUssVUFBVTtBQUNmLFNBQUs7QUFDTCxRQUFJO0FBQ0YsWUFBTSxPQUFPLE1BQU0sS0FBSyxTQUFTO0FBQ2pDLFVBQUksQ0FBQyxLQUFNO0FBQ1gsaUJBQVcsT0FBTyxNQUFNO0FBQ3RCLGNBQU0sT0FBTyxJQUFJLFVBQVUsWUFBWSxLQUFLLFFBQVEsTUFBTTtBQUMxRCxZQUFJLEtBQU0sT0FBTSxLQUFLLFVBQVUsSUFBSSxFQUFFO0FBRXJDLGNBQU0sWUFBWSxLQUFLLG1CQUFtQixJQUFJLElBQUksRUFBRTtBQUNwRCxZQUFJLENBQUMsSUFBSSxzQkFBc0IsY0FBYyxVQUFhLEtBQUssUUFBUSxhQUFhLEtBQUs7QUFDdkYsZUFBSyxtQkFBbUIsSUFBSSxJQUFJLElBQUksS0FBSyxLQUFLO0FBQzlDLGdCQUFNLEtBQUssY0FBYyxJQUFJLEVBQUU7QUFBQSxRQUNqQztBQUFBLE1BQ0Y7QUFDQSxZQUFNLEtBQUssWUFBWTtBQUN2QixZQUFNLEtBQUssYUFBYTtBQUN4QixXQUFLLGlCQUFpQjtBQUV0QixZQUFNLFNBQVMsT0FBTyxPQUFPLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLFFBQVEsSUFBSSxVQUFVLFFBQVE7QUFDL0YsaUJBQVcsT0FBTyxPQUFRLE9BQU0sS0FBSyxVQUFVLElBQUksRUFBRTtBQUNyRCxVQUFJLE9BQU8sT0FBUSxNQUFLLGlCQUFpQjtBQUFBLElBQzNDLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxJQUFJLDhCQUErQixNQUFnQixPQUFPLEVBQUU7QUFBQSxJQUN2RSxVQUFFO0FBQ0EsV0FBSyxVQUFVO0FBQUEsSUFDakI7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFdBQXdDO0FBQ3BELFVBQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQXNFLENBQUMsaUJBQWlCLFVBQVUsQ0FBQztBQUNySSxRQUFJLENBQUMsT0FBTyxJQUFJO0FBQ2QsV0FBSyxJQUFJLElBQUksYUFBYSxPQUFPLElBQUksSUFBSSxPQUFPLE9BQU8sRUFBRTtBQUN6RCxhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sTUFBbUIsQ0FBQztBQUMxQixlQUFXLE9BQU8sT0FBTyxPQUFPLEtBQUssT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLE1BQU0sRUFBRSxNQUFNLEdBQUcsUUFBUSxHQUFHO0FBQ3BGLFlBQU0sV0FBVyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsS0FBSyxJQUFJLEVBQUU7QUFDbEQsWUFBTSxTQUFvQixXQUN0QixFQUFFLEdBQUcsVUFBVSxXQUFXLElBQUksYUFBYSxTQUFTLFVBQVUsSUFDOUQsRUFBRSxJQUFJLElBQUksSUFBSSxXQUFXLElBQUksYUFBYSxJQUFJLElBQUksUUFBUSxPQUFPLG1CQUFtQixNQUFNLE9BQU8sUUFBUSxXQUFXLE1BQU0sU0FBUyxNQUFNLFdBQVcsR0FBRyxTQUFTLEVBQUU7QUFDdEssV0FBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsT0FBTyxJQUFJLElBQUksSUFBSSxPQUFPLE9BQU8sQ0FBQztBQUMvRCxXQUFLLFdBQVcsTUFBTTtBQUN0QixVQUFJLENBQUMsU0FBVSxNQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxPQUFPLElBQUksRUFBRSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksR0FBRyxNQUFNLHlCQUF5QixRQUFRLFlBQVksVUFBVSxJQUFJLElBQUksT0FBTyxJQUFJLElBQUksU0FBUyxRQUFRLFNBQVMsT0FBTyxXQUFXLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDdE4sVUFBSSxLQUFLLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDO0FBQUEsSUFDN0M7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxNQUFjLGNBQWMsT0FBOEI7QUFDeEQsVUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBdUMsQ0FBQyxpQkFBaUIsWUFBWSxRQUFRLE9BQU8sUUFBUSxDQUFDO0FBQy9ILFFBQUksQ0FBQyxPQUFPLE1BQU0sQ0FBQyxPQUFPLE9BQU8sSUFBSztBQUN0QyxVQUFNLE1BQU0sT0FBTyxPQUFPO0FBQzFCLFVBQU0sTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsS0FBSyxLQUFLO0FBQzVDLFFBQUksQ0FBQyxJQUFLO0FBQ1YsVUFBTSxvQkFBb0IsSUFBSSxJQUFJLGtCQUFrQixLQUFLLElBQUk7QUFDN0QsVUFBTSxZQUFZLElBQUksYUFBYSxVQUFVLElBQUksVUFBVTtBQUMzRCxRQUFJLHNCQUFzQixJQUFJLHFCQUFxQixjQUFjLElBQUksVUFBVztBQUNoRixVQUFNLE9BQU8sRUFBRSxHQUFHLEtBQUssbUJBQW1CLFVBQVU7QUFDcEQsU0FBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsT0FBTyxJQUFJLE9BQU8sT0FBTyxLQUFLLENBQUM7QUFDNUQsU0FBSyxXQUFXLElBQUk7QUFBQSxFQUN0QjtBQUFBO0FBQUEsRUFHUSxXQUFXLEtBQXNCO0FBQ3ZDLFVBQU0sS0FBSyxRQUFRLElBQUksRUFBRTtBQUN6QixVQUFNLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFDekIsU0FBSyxJQUFJLE1BQU07QUFBQSxNQUNiO0FBQUEsTUFDQTtBQUFBLE1BQ0EsRUFBRSxNQUFNLFFBQVEsT0FBTyxJQUFJLElBQUksT0FBTyxxQkFBcUIsYUFBYSxTQUFTLElBQUksV0FBVyxHQUFHLEdBQUcsZ0JBQWdCLElBQUkscUJBQXFCLFFBQVcsVUFBVSxDQUFDLFVBQVUsRUFBRTtBQUFBLE1BQ2pMLE1BQU0sU0FBUyxJQUFJLFFBQVEsR0FBRztBQUFBLElBQ2hDO0FBQ0EsUUFBSSxJQUFJLGtCQUFtQixNQUFLLElBQUksU0FBUyxLQUFLLElBQUksRUFBRSxnQkFBZ0IsSUFBSSxrQkFBa0IsQ0FBQztBQUFBLEVBQ2pHO0FBQUEsRUFFQSxNQUFjLFVBQVUsT0FBOEI7QUFDcEQsVUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBMEIsQ0FBQyxpQkFBaUIsYUFBYSxTQUFTLE9BQU8sUUFBUSxDQUFDO0FBQ3BILFFBQUksQ0FBQyxPQUFPLElBQUk7QUFDZCxXQUFLLElBQUksSUFBSSxhQUFhLEtBQUssS0FBSyxPQUFPLElBQUksSUFBSSxPQUFPLE9BQU8sRUFBRTtBQUNuRTtBQUFBLElBQ0Y7QUFDQSxRQUFJLGNBQTZCO0FBQ2pDLGVBQVcsT0FBTyxPQUFPLE9BQU8sT0FBTztBQUNyQyxzQkFBZ0IsSUFBSSxJQUFJLDBCQUEwQjtBQUNsRCxXQUFLLFVBQVUsT0FBTyxHQUFHO0FBQUEsSUFDM0I7QUFDQSxVQUFNLE1BQU0sS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLEtBQUssS0FBSztBQUM1QyxRQUFJLEtBQUs7QUFDUCxZQUFNLFFBQVEsT0FBTyxPQUFPO0FBQzVCLFlBQU0sUUFBUSxNQUFNLElBQUksQ0FBQyxTQUFTLFVBQVUsS0FBSyxVQUFVLENBQUMsRUFBRSxPQUFPLENBQUMsTUFBbUIsTUFBTSxJQUFJO0FBQ25HLFdBQUssSUFBSSxNQUFNLElBQUk7QUFBQSxRQUNqQixRQUFRO0FBQUEsUUFDUixJQUFJO0FBQUEsUUFDSixPQUFPLEVBQUUsR0FBRyxLQUFLLFdBQVcsTUFBTSxRQUFRLG1CQUFtQixJQUFJLHFCQUFxQixhQUFhLFdBQVcsTUFBTSxTQUFTLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxJQUFJLFVBQVU7QUFBQSxNQUNsSyxDQUFDO0FBQ0QsVUFBSSxlQUFlLENBQUMsSUFBSSxrQkFBbUIsTUFBSyxXQUFXLEVBQUUsR0FBRyxLQUFLLG1CQUFtQixZQUFZLENBQUM7QUFBQSxJQUN2RztBQUFBLEVBQ0Y7QUFBQSxFQUVRLFVBQVUsT0FBZSxLQUFvQjtBQUNuRCxVQUFNLFFBQVEsS0FBSyxJQUFJLE1BQU0sS0FBSztBQUNsQyxVQUFNLFdBQVcsTUFBTSxNQUFNLElBQUksRUFBRTtBQUNuQyxVQUFNLFFBQVEsSUFBSSxJQUFJLFVBQVUsS0FBSyxJQUFJLElBQUksWUFBWSxLQUFLLElBQUk7QUFDbEUsVUFBTSxPQUFPLGNBQWMsR0FBRyxLQUFLLElBQUksSUFBSSxJQUFJLFlBQVksS0FBSyxFQUFFLEVBQUU7QUFDcEUsVUFBTSxlQUFlLFlBQVksSUFBSSxNQUFNO0FBRTNDLFVBQU0sU0FBUyxjQUFjLFVBQVUsRUFBRSxHQUFHLGNBQWMsU0FBUyxLQUFLLFNBQVMsVUFBVSxJQUFJLEVBQUUsSUFBSSxhQUFhLFNBQVMsY0FBYyxFQUFFLElBQUk7QUFDL0ksVUFBTSxjQUFjLFVBQVUsZUFBZSxDQUFDO0FBQzlDLFVBQU0saUJBQWlCLFlBQVksU0FBUyxLQUFLLGFBQWEsSUFBSSxZQUFZLFlBQVksU0FBUyxDQUFDLENBQUMsSUFBSTtBQUN6RyxVQUFNLFVBQVUsT0FBTyxPQUFPLE1BQU0sS0FBSyxFQUFFLE9BQU8sQ0FBQyxTQUFTLEtBQUssV0FBVyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsU0FBUyxLQUFLLEVBQUU7QUFDekcsVUFBTSxjQUFjLFFBQVEsS0FBSyxDQUFDLE9BQU8sTUFBTSxNQUFNLEVBQUUsR0FBRyxXQUFXLFNBQVM7QUFDOUUsVUFBTSxZQUFZLGtCQUFrQjtBQUFBLE1BQ2xDLFlBQVksSUFBSSxJQUFJLE1BQU0sS0FBSztBQUFBLE1BQy9CO0FBQUEsTUFDQSxlQUFlLFFBQVEsV0FBVztBQUFBLE1BQ2xDO0FBQUEsTUFDQSxZQUFZLEtBQUssSUFBSSxHQUFHLFlBQVksU0FBUyxDQUFDO0FBQUEsTUFDOUMsZ0JBQWdCLGlCQUFpQixhQUFhLGNBQWMsSUFBSTtBQUFBLElBQ2xFLENBQUM7QUFDRCxVQUFNLFNBQXFCO0FBQUEsTUFDekIsSUFBSSxJQUFJO0FBQUEsTUFDUjtBQUFBLE1BQ0EsVUFBVSxJQUFJLElBQUksU0FBUztBQUFBLE1BQzNCLE9BQU8sT0FBTyxLQUFLO0FBQUEsTUFDbkIsYUFBYSxlQUFlLElBQUksSUFBSSxZQUFZLENBQUM7QUFBQSxNQUNqRCxNQUFNLElBQUksT0FBTyxLQUFLLFNBQVMsUUFBUSxJQUFJLEVBQUUsSUFBSSxPQUFPLFNBQVMsT0FBTyxJQUFJLElBQUksR0FBRyxVQUFVLENBQUMsR0FBRyxZQUFZLElBQUk7QUFBQSxNQUNqSDtBQUFBLE1BQ0EsWUFBWSxJQUFJLElBQUksTUFBTSxLQUFLO0FBQUEsTUFDL0IsT0FBTztBQUFBLE1BQ1AsTUFBTSxVQUFVLElBQUksSUFBSTtBQUFBLE1BQ3hCLGlCQUFpQixVQUFVLG1CQUFtQjtBQUFBLE1BQzlDO0FBQUEsTUFDQTtBQUFBLE1BQ0EsV0FBVyxVQUFVLElBQUksVUFBVTtBQUFBLE1BQ25DLGFBQWEsVUFBVSxJQUFJLFlBQVk7QUFBQSxNQUN2QyxZQUFZLEtBQUssSUFBSSxHQUFHLFlBQVksU0FBUyxDQUFDO0FBQUEsTUFDOUM7QUFBQSxNQUNBLFNBQVMsVUFBVSxXQUFXO0FBQUEsSUFDaEM7QUFDQSxTQUFLLElBQUksTUFBTSxXQUFXLE1BQU07QUFDaEMsUUFBSSxDQUFDLFVBQVU7QUFDYixXQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxnQkFBZ0IsSUFBSSxFQUFFLElBQUksSUFBSSxPQUFPLGFBQWEsS0FBSyxJQUFJLElBQUksR0FBRyxNQUFNLGdCQUFnQixRQUFRLFlBQVksVUFBVSxJQUFJLElBQUksT0FBTyxTQUFTLGlCQUFpQixTQUFTLE9BQU8sT0FBTyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQUEsSUFDMU4sV0FBVyxTQUFTLFVBQVUsT0FBTyxPQUFPO0FBQzFDLFdBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLEtBQUssSUFBSSxJQUFJLEdBQUcsTUFBTSxjQUFjLE9BQU8sT0FBTyxPQUFPLElBQUksR0FBRyxRQUFRLFlBQVksVUFBVSxJQUFJLElBQUksT0FBTyxVQUFVLE9BQU8saUJBQWlCLFNBQVMsR0FBRyxTQUFTLE9BQU8sT0FBTyxFQUFFLENBQUMsS0FBSyxTQUFTLEtBQUssV0FBTSxPQUFPLEtBQUssR0FBRyxDQUFDO0FBQUEsSUFDMVA7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGNBQTZCO0FBQ3pDLFVBQU0sT0FBdUIsQ0FBQztBQUM5QixRQUFJLFNBQXdCO0FBQzVCLGFBQVMsT0FBTyxHQUFHLE9BQU8sa0JBQWtCLFFBQVE7QUFDbEQsWUFBTSxPQUFPLENBQUMsaUJBQWlCLGFBQWE7QUFDNUMsVUFBSSxPQUFRLE1BQUssS0FBSyxZQUFZLE1BQU07QUFDeEMsWUFBTSxTQUFnSCxNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksSUFBSTtBQUNqSixVQUFJLENBQUMsT0FBTyxJQUFJO0FBQ2QsYUFBSyxJQUFJLElBQUksZ0JBQWdCLE9BQU8sSUFBSSxJQUFJLE9BQU8sT0FBTyxFQUFFO0FBQzVEO0FBQUEsTUFDRjtBQUNBLFdBQUssS0FBSyxHQUFHLE9BQU8sT0FBTyxPQUFPO0FBQ2xDLGVBQVMsT0FBTyxPQUFPLGNBQWM7QUFDckMsVUFBSSxDQUFDLE9BQVE7QUFBQSxJQUNmO0FBQ0EsVUFBTSxRQUFRLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRTtBQUNwQyxRQUFJLGVBQWU7QUFDbkIsVUFBTSxRQUFRLEtBQUssT0FBTyxDQUFDLFFBQVEsTUFBTSxJQUFJLE1BQU0sQ0FBQztBQUVwRCxlQUFXLE9BQU8sT0FBTztBQUN2QixXQUFLLGFBQWEsSUFBSSxJQUFJLFlBQVksR0FBRztBQUN6QyxXQUFLLGVBQWUsR0FBRztBQUFBLElBQ3pCO0FBRUEsVUFBTSxXQUFXLENBQUMsUUFBdUIsYUFBYSxHQUFHLElBQUksSUFBSSxlQUFlLEdBQUcsTUFBTSxXQUFXLElBQUk7QUFDeEcsZUFBVyxPQUFPLENBQUMsR0FBRyxLQUFLLEVBQUUsS0FBSyxDQUFDLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxTQUFTLENBQUMsQ0FBQyxHQUFHO0FBQ3RFLFVBQUksZ0JBQWdCLEVBQUc7QUFDdkIsWUFBTSxjQUFjLEdBQUcsSUFBSSxLQUFLLElBQUksSUFBSSxZQUFZLEVBQUUsSUFBSSxJQUFJLFlBQVksRUFBRTtBQUM1RSxVQUFJLEtBQUssU0FBUyxJQUFJLElBQUksVUFBVSxNQUFNLGVBQWUsQ0FBQyxhQUFhLEdBQUcsRUFBRztBQUM3RTtBQUNBLFlBQU0sS0FBSyxpQkFBaUIsSUFBSSxVQUFVO0FBQzFDLFdBQUssU0FBUyxJQUFJLElBQUksWUFBWSxXQUFXO0FBQUEsSUFDL0M7QUFBQSxFQUNGO0FBQUEsRUFFUSxlQUFlLEtBQXlCO0FBQzlDLFVBQU0sS0FBSyxZQUFZLElBQUksVUFBVTtBQUNyQyxVQUFNLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFDekIsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxNQUFNLElBQUksTUFBTTtBQUNuRCxVQUFNLFdBQVcsS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLE9BQU8sRUFBRTtBQUNoRCxVQUFNLENBQUMsV0FBVyxZQUFZLElBQUksZUFBZSxJQUFJLFNBQVM7QUFDOUQsVUFBTSxTQUFTLGVBQWUsR0FBRztBQUVqQyxVQUFNLGFBQWEsVUFBVSxTQUFTLFNBQVMsWUFBWSxLQUFLLFdBQVcsVUFBVSxXQUFXO0FBQ2hHLFVBQU0sUUFBUSxhQUFhLFNBQVMsUUFBUTtBQUM1QyxVQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU07QUFBQSxNQUM1QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsUUFDRSxNQUFNO0FBQUEsUUFDTixZQUFZLElBQUk7QUFBQSxRQUNoQixRQUFRLElBQUk7QUFBQSxRQUNaLE9BQU8sTUFBTSxTQUFTO0FBQUEsUUFDdEIsVUFBVSxVQUFVLGFBQWEsT0FBTyxRQUFRLEtBQUssS0FBSyxLQUFLO0FBQUEsUUFDL0QsZ0JBQWdCLElBQUksWUFBWTtBQUFBLFFBQ2hDLGFBQWEsSUFBSSxhQUFhO0FBQUEsUUFDOUIsY0FBYyxnQkFBZ0I7QUFBQSxRQUM5QixXQUFXLGFBQWE7QUFBQSxRQUN4QixRQUFRLE9BQU8sT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsU0FBUyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxZQUFZLEdBQUcsVUFBVTtBQUFBLFFBQ3ZHLE9BQU8sVUFBVSxTQUFTLE1BQU0sZUFBZSxNQUFNLFNBQVM7QUFBQSxRQUM5RDtBQUFBLFFBQ0EsTUFBTSxhQUFhLFNBQVMsT0FBTyxhQUFhLEdBQUc7QUFBQTtBQUFBLFFBRW5ELFNBQVMsZUFBZSxJQUFJLElBQUksTUFBTSxZQUFZLENBQUMsSUFBSSxpQkFBaUI7QUFBQSxRQUN4RSxVQUFVLENBQUMsVUFBVTtBQUFBLE1BQ3ZCO0FBQUEsTUFDQSxNQUFNLFNBQVMsSUFBSSxVQUFVLEdBQUc7QUFBQSxJQUNsQztBQUNBLFNBQUssSUFBSSxTQUFTLEtBQUssSUFBSSxFQUFFLGdCQUFnQixJQUFJLFlBQVksS0FBSyxDQUFDO0FBQ25FLFFBQUksUUFBUSxDQUFDLEtBQUssWUFBWSxTQUFTLElBQUksVUFBVSxHQUFHO0FBQ3RELFlBQU0sY0FBYyxDQUFDLEdBQUcsS0FBSyxhQUFhLElBQUksVUFBVTtBQUN4RCxXQUFLLElBQUksTUFBTSxXQUFXLEVBQUUsR0FBRyxNQUFNLGFBQWEsaUJBQWlCLElBQUksWUFBWSxLQUFLLElBQUksR0FBRyxZQUFZLFNBQVMsQ0FBQyxFQUFFLENBQUM7QUFDeEgsV0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLElBQUksaUJBQWlCLElBQUksVUFBVSxJQUFJLElBQUksS0FBSyxNQUFNLFlBQVksU0FBUyxJQUFJLGlCQUFpQixpQkFBaUIsUUFBUSxZQUFZLFVBQVUsSUFBSSxRQUFRLFVBQVUsSUFBSSxPQUFPLEtBQUssT0FBTyxTQUFTLEdBQUcsU0FBUyxLQUFLLE9BQU8sRUFBRSxDQUFDLFdBQU0sT0FBTyxLQUFLLEdBQUcsQ0FBQztBQUFBLElBQzlRO0FBQ0EsUUFBSSxZQUFZLFNBQVMsVUFBVSxPQUFPLE9BQU87QUFDL0MsV0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLElBQUksS0FBSyxNQUFNLFVBQVUsV0FBVyxpQkFBaUIsVUFBVSxTQUFTLG9CQUFvQix3QkFBd0IsUUFBUSxZQUFZLFVBQVUsSUFBSSxPQUFPLE9BQU8sT0FBTyxTQUFTLEdBQUcsT0FBTyxLQUFLLEtBQUssU0FBUyxLQUFLLFdBQU0sS0FBSyxHQUFHLENBQUM7QUFBQSxJQUM3UDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsaUJBQWlCLFlBQW1DO0FBQ2hFLFVBQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQTZCLENBQUMsaUJBQWlCLGVBQWUsY0FBYyxZQUFZLFFBQVEsQ0FBQztBQUNuSSxRQUFJLENBQUMsT0FBTyxHQUFJO0FBQ2hCLFVBQU0sU0FBUyxPQUFPO0FBQ3RCLFVBQU0sV0FBVyxTQUFTLE9BQU8sUUFBUTtBQUN6QyxVQUFNLFNBQVMsU0FBUyxPQUFPLE1BQU07QUFDckMsVUFBTSxRQUFRLFNBQVMsT0FBTyxZQUFZO0FBQzFDLFVBQU0sU0FBUyxTQUFTLFNBQVMsTUFBTSxNQUFNLEVBQUUsU0FBUztBQUN4RCxVQUFNLFlBQVksU0FBUyxTQUFTLE1BQU0sTUFBTSxFQUFFLFNBQVM7QUFDM0QsVUFBTSxLQUFLLFlBQVksVUFBVTtBQUNqQyxVQUFNLFVBQVUsSUFBSSxTQUFTLGlCQUFpQjtBQUM5QyxVQUFNLE9BQU8sS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLE1BQU0sSUFBSSxTQUFTLE1BQU0sS0FBSyxFQUFFO0FBQ25FLFVBQU0sU0FBUyxLQUFLLElBQUksTUFBTTtBQUFBLE1BQzVCO0FBQUEsTUFDQSxLQUFLLElBQUksSUFBSTtBQUFBLE1BQ2I7QUFBQSxRQUNFLE9BQU8sSUFBSSxPQUFPLEtBQUssS0FBSyxJQUFJLE1BQU0sS0FBSyxLQUFLO0FBQUEsUUFDaEQsT0FBTyxJQUFJLE9BQU8sS0FBSyxLQUFLLElBQUksVUFBVSxLQUFLLEtBQUs7QUFBQSxRQUNwRCxRQUFRLElBQUksT0FBTyxNQUFNLEtBQUssSUFBSSxVQUFVLE1BQU0sS0FBSztBQUFBLFFBQ3ZELFNBQVMsSUFBSSxTQUFTLGVBQWUsS0FBSztBQUFBLFFBQzFDLGdCQUFnQixJQUFJLFNBQVMsY0FBYyxLQUFLO0FBQUEsUUFDaEQsVUFBVSxVQUFVLFlBQVksT0FBTyxLQUFLLE9BQU8sUUFBUSxLQUFLLEtBQUssS0FBSztBQUFBLFFBQzFFLG1CQUFtQixJQUFJLFNBQVMsaUJBQWlCO0FBQUEsUUFDakQsY0FBYyxPQUFPLFNBQVMsaUJBQWlCLFdBQVcsU0FBUyxlQUFlO0FBQUEsUUFDbEYsV0FBVyxVQUFVLFNBQVMsWUFBWSxLQUFLO0FBQUEsUUFDL0MsU0FBUyxVQUFVLFNBQVMsV0FBVztBQUFBLFFBQ3ZDLFNBQVMsSUFBSSxTQUFTLE9BQU8sVUFBVSxFQUFFLE9BQU8sS0FBSztBQUFBLFFBQ3JELFVBQVUsQ0FBQyxVQUFVO0FBQUEsTUFDdkI7QUFBQSxNQUNBLE1BQU0sU0FBUyxJQUFJLFVBQVUsS0FBSyxJQUFJLElBQUksQ0FBQztBQUFBLElBQzdDO0FBQ0EsU0FBSyxJQUFJLFNBQVMsS0FBSyxJQUFJLEVBQUUsU0FBUyxPQUFPLFNBQVMsZ0JBQWdCLE9BQU8sZUFBZSxDQUFDO0FBRTdGLHNCQUFrQixLQUFLLElBQUksT0FBTyxLQUFLLElBQUksVUFBVSxFQUFFO0FBQ3ZELGdCQUFZLEtBQUssSUFBSSxPQUFPLEtBQUssSUFBSSxVQUFVLEVBQUU7QUFDakQsU0FBSyxnQkFBZ0IsT0FBTyxNQUFNO0FBQ2xDLFFBQUksSUFBSSxTQUFTLGlCQUFpQixHQUFHO0FBQ25DLFdBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLFNBQVMsVUFBVSxJQUFJLElBQUksT0FBTyxhQUFhLEtBQUssSUFBSSxJQUFJLEdBQUcsTUFBTSxnQkFBZ0IsUUFBUSxZQUFZLFVBQVUsT0FBTyxVQUFVLElBQUksVUFBVSxJQUFJLE9BQU8sT0FBTyxPQUFPLFNBQVMsWUFBWSxJQUFJLFNBQVMsaUJBQWlCLENBQUMsV0FBVyxDQUFDO0FBQUEsSUFDdlE7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdRLGdCQUFnQixRQUE2QjtBQUNuRCxVQUFNLE9BQU8sU0FBUyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsTUFBTSxNQUFNLElBQUk7QUFDNUQsUUFBSSxDQUFDLFFBQVEsS0FBSyxZQUFZLFNBQVMsRUFBRztBQUMxQyxVQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sS0FBSyxFQUFFO0FBQ3JDLFVBQU0sT0FBTyxDQUFDLE9BQWUsT0FBTyxZQUFZLEVBQUUsRUFBRTtBQUVwRCxRQUFJLEtBQUssWUFBWSxLQUFLLENBQUMsT0FBTyxLQUFLLEVBQUUsR0FBRyxhQUFhLElBQUksRUFBRztBQUNoRSxVQUFNLFNBQVMsQ0FBQyxHQUFHLEtBQUssV0FBVyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDbEQsVUFBSSxLQUFLLENBQUMsR0FBRyxzQkFBc0IsRUFBRyxRQUFPO0FBQzdDLFVBQUksS0FBSyxDQUFDLEdBQUcsc0JBQXNCLEVBQUcsUUFBTztBQUM3QyxhQUFRLEtBQUssQ0FBQyxFQUFHLFlBQXdCLEtBQUssQ0FBQyxFQUFHO0FBQUEsSUFDcEQsQ0FBQztBQUNELFFBQUksT0FBTyxLQUFLLE1BQU0sS0FBSyxZQUFZLEtBQUssRUFBRztBQUMvQyxTQUFLLElBQUksTUFBTSxXQUFXLEVBQUUsR0FBRyxNQUFNLGFBQWEsUUFBUSxpQkFBaUIsWUFBWSxPQUFPLE9BQU8sU0FBUyxDQUFDLENBQUMsR0FBRyxDQUFDO0FBQUEsRUFDdEg7QUFBQSxFQUVBLE1BQWMsZUFBOEI7QUFDMUMsVUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLElBQUksSUFBZ0MsQ0FBQyxpQkFBaUIsU0FBUyxXQUFXLE9BQU8sUUFBUSxDQUFDO0FBQ3hILFFBQUksQ0FBQyxPQUFPLEdBQUk7QUFDaEIsVUFBTSxRQUFRLElBQUksSUFBSSxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsU0FBUyxJQUFJLENBQUMsWUFBWSxRQUFRLEVBQUUsQ0FBQztBQUNqRixlQUFXLE9BQU8sQ0FBQyxHQUFHLE9BQU8sT0FBTyxRQUFRLEVBQUUsUUFBUSxHQUFHO0FBQ3ZELFVBQUksTUFBTSxJQUFJLElBQUksRUFBRSxFQUFHO0FBQ3ZCLFlBQU0sVUFBVSxVQUFVLElBQUksT0FBTztBQUNyQyxZQUFNLGFBQWEsSUFBSSxJQUFJLFdBQVc7QUFDdEMsWUFBTSxXQUFXLElBQUksSUFBSSxTQUFTO0FBQ2xDLFlBQU0sY0FBYyxLQUFLLElBQUksU0FBUyxRQUFRLEVBQUUsZ0JBQWdCLFlBQVksU0FBUyxJQUFJLElBQUksZUFBZSxFQUFFLENBQUMsS0FBSyxRQUFRLFVBQVU7QUFDdEksWUFBTSxZQUFZLEtBQUssSUFBSSxTQUFTLFFBQVEsRUFBRSxnQkFBZ0IsU0FBUyxDQUFDLEtBQUssUUFBUSxRQUFRO0FBQzdGLFlBQU0sVUFBeUI7QUFBQSxRQUM3QixJQUFJLElBQUk7QUFBQSxRQUNSLE9BQU8sSUFBSSxJQUFJLE1BQU07QUFBQSxRQUNyQjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsTUFBTSxJQUFJLElBQUksSUFBSSxLQUFLO0FBQUEsUUFDdkIsU0FBUyxlQUFlLElBQUksSUFBSSxPQUFPLENBQUM7QUFBQSxRQUN4QyxNQUFNLElBQUksT0FBTyxLQUFLLFNBQVMsV0FBVyxJQUFJLEVBQUUsSUFBSSxPQUFPLFNBQVMsT0FBTyxJQUFJLElBQUksR0FBRyxVQUFVLENBQUMsR0FBRyxZQUFZLElBQUk7QUFBQSxRQUNwSCxRQUFRLElBQUksUUFBUSxNQUFNO0FBQUEsUUFDMUIsV0FBVyxVQUFVLElBQUksVUFBVSxLQUFLLEtBQUssSUFBSSxJQUFJO0FBQUEsTUFDdkQ7QUFDQSxXQUFLLElBQUksTUFBTSxJQUFJLEVBQUUsUUFBUSxXQUFXLElBQUksSUFBSSxJQUFJLE9BQU8sUUFBUSxDQUFDO0FBQ3BFLFdBQUssSUFBSSxNQUFNLEtBQUs7QUFBQSxRQUNsQixJQUFJLFdBQVcsSUFBSSxFQUFFO0FBQUEsUUFDckIsSUFBSSxRQUFRO0FBQUEsUUFDWixNQUFNO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixVQUFVLGVBQWUsY0FBYztBQUFBLFFBQ3ZDLFVBQVU7QUFBQSxRQUNWLE9BQU8sUUFBUTtBQUFBLFFBQ2YsU0FBUyxHQUFHLFFBQVEsSUFBSSxLQUFLLFNBQVMsUUFBUSxXQUFXLFFBQVEsUUFBUSxJQUFJLEdBQUcsQ0FBQztBQUFBLE1BQ25GLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxVQUFVLE9BQThCO0FBQ3BELFVBQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQTJDLENBQUMsaUJBQWlCLGFBQWEsU0FBUyxPQUFPLFFBQVEsQ0FBQztBQUNySSxRQUFJLENBQUMsT0FBTyxHQUFJO0FBQ2hCLGVBQVcsT0FBTyxPQUFPLE9BQU8sU0FBUyxDQUFDLEdBQUc7QUFDM0MsWUFBTSxLQUFLLElBQUksSUFBSSxFQUFFO0FBQ3JCLFVBQUksQ0FBQyxHQUFJO0FBQ1QsWUFBTSxPQUFtQjtBQUFBLFFBQ3ZCO0FBQUEsUUFDQSxRQUFRLElBQUksSUFBSSxPQUFPLEtBQUssSUFBSSxJQUFJLE1BQU07QUFBQSxRQUMxQyxVQUFVLGVBQWUsSUFBSSxJQUFJLFFBQVEsS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDO0FBQUEsUUFDN0QsUUFBUSxJQUFJLElBQUksTUFBTSxLQUFLO0FBQUEsUUFDM0IsWUFBWSxlQUFlLElBQUksSUFBSSxVQUFVLENBQUM7QUFBQSxRQUM5QyxXQUFXLFVBQVUsSUFBSSxjQUFjLElBQUksU0FBUztBQUFBLE1BQ3REO0FBQ0EsWUFBTSxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxNQUFNLEVBQUU7QUFDL0MsV0FBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsUUFBUSxJQUFJLE9BQU8sS0FBSyxDQUFDO0FBQ3RELFVBQUksQ0FBQyxZQUFZLEtBQUssV0FBVyxhQUFhLEtBQUssUUFBUTtBQUN6RCxhQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxRQUFRLEVBQUUsSUFBSSxJQUFJLEtBQUssYUFBYSxLQUFLLElBQUksSUFBSSxHQUFHLE1BQU0sZ0JBQWdCLFFBQVEsWUFBWSxVQUFVLEtBQUssUUFBUSxPQUFPLFNBQVMsa0JBQWtCLFNBQVMsS0FBSyxZQUFZLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUFBLE1BQ3pOO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLG1CQUF5QjtBQUMvQixVQUFNLFFBQVEsS0FBSyxJQUFJLE1BQU0sS0FBSztBQUNsQyxlQUFXLE9BQU8sT0FBTyxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQzNDLFlBQU0sUUFBUSxPQUFPLE9BQU8sTUFBTSxLQUFLLEVBQUUsT0FBTyxDQUFDLFNBQVMsS0FBSyxVQUFVLElBQUksRUFBRTtBQUMvRSxVQUFJLENBQUMsTUFBTSxPQUFRO0FBQ25CLFlBQU0sVUFBVSxNQUFNLE1BQU0sQ0FBQyxTQUFTLHFCQUFxQixTQUFTLEtBQUssS0FBSyxDQUFDO0FBQy9FLFlBQU0sWUFBWSxNQUFNLEtBQUssQ0FBQyxTQUFTLEtBQUssVUFBVSxRQUFRO0FBQzlELFlBQU0sT0FBMkIsVUFBVyxZQUFZLFdBQVcsY0FBZTtBQUNsRixZQUFNLFVBQVUsVUFBVSxLQUFLLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEtBQUssZUFBZSxDQUFDLENBQUMsS0FBSyxPQUFPO0FBQzVGLFVBQUksU0FBUyxJQUFJLFNBQVMsWUFBWSxJQUFJLFNBQVM7QUFDakQsYUFBSyxJQUFJLE1BQU0sSUFBSSxFQUFFLFFBQVEsT0FBTyxJQUFJLElBQUksSUFBSSxPQUFPLEVBQUUsR0FBRyxLQUFLLE9BQU8sTUFBTSxRQUFRLEVBQUUsQ0FBQztBQUN6RixZQUFJLFdBQVcsSUFBSSxVQUFVLFVBQVU7QUFDckMsZUFBSyxJQUFJLE1BQU0sS0FBSyxFQUFFLElBQUksWUFBWSxJQUFJLEVBQUUsSUFBSSxJQUFJLFdBQVcsS0FBSyxJQUFJLElBQUksR0FBRyxNQUFNLDJCQUEyQixRQUFRLFlBQVksVUFBVSxJQUFJLElBQUksT0FBTyxJQUFJLElBQUksU0FBUyxPQUFPLElBQUksS0FBSyxTQUFTLElBQUksV0FBVyxHQUFHLENBQUMsR0FBRyxDQUFDO0FBQUEsUUFDaE87QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVPLFNBQVMsZUFBZSxLQUE4RDtBQUMzRixRQUFNLFFBQVEsSUFBSSxNQUFNLFlBQVk7QUFDcEMsTUFBSSxVQUFVLGVBQWUsVUFBVSxlQUFlLFVBQVUsVUFBVyxRQUFPO0FBQ2xGLE1BQUksVUFBVSxZQUFZLFVBQVUsa0JBQW1CLFFBQU87QUFDOUQsTUFBSSxVQUFVLGFBQWEsVUFBVSxlQUFlLFVBQVUsWUFBWSxVQUFVLFlBQWEsUUFBTztBQUN4RyxNQUFJLFVBQVUsYUFBYSxVQUFVLGFBQWMsUUFBTztBQUMxRCxNQUFJLFVBQVUsUUFBUyxRQUFPLGFBQWEsR0FBRyxJQUFJLFlBQVk7QUFDOUQsTUFBSSxVQUFVLGNBQWMsVUFBVSxhQUFhLFVBQVUsYUFBYSxVQUFVLGFBQWMsUUFBTztBQUN6RyxTQUFPO0FBQ1Q7QUFFTyxTQUFTLGFBQWEsS0FBb0Q7QUFDL0UsUUFBTSxZQUFZLElBQUksWUFBWSxJQUFJLFlBQVk7QUFDbEQsTUFBSSxhQUFhLFlBQVksYUFBYSxVQUFXLFFBQU87QUFDNUQsTUFBSSxhQUFhLFdBQVcsYUFBYSxhQUFhLGFBQWEsT0FBUSxRQUFPO0FBQ2xGLFFBQU0sUUFBUSxJQUFJLE1BQU0sWUFBWTtBQUNwQyxTQUFPLGFBQWEsbUJBQW1CLFVBQVUsY0FBYyxVQUFVLGFBQWEsVUFBVTtBQUNsRztBQUVBLFNBQVMsY0FBYyxPQUFrQixNQUE2QjtBQUNwRSxVQUFRLE9BQU87QUFBQSxJQUNiLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPLFNBQVMsV0FBVyxxQkFBcUIsU0FBUyxTQUFTLG1CQUFtQjtBQUFBLElBQ3ZGLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNUO0FBQ0UsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQUVBLFNBQVMsWUFBWSxPQUFzQztBQUN6RCxNQUFJLFNBQVMsUUFBUSxVQUFVLEdBQUksUUFBTztBQUMxQyxRQUFNLFNBQVMsVUFBVSxLQUFLO0FBQzlCLE1BQUksQ0FBQyxPQUFPLEtBQUssTUFBTSxFQUFFLFFBQVE7QUFFL0IsVUFBTSxPQUFPLE9BQU8sS0FBSyxFQUFFLEtBQUs7QUFDaEMsVUFBTSxVQUFVLGlDQUFpQyxLQUFLLElBQUksSUFBSSxjQUFjO0FBQzVFLFdBQU8sRUFBRSxTQUFTLFNBQVMsT0FBTyxTQUFTLE1BQU0sR0FBSSxDQUFDLEdBQUcsZUFBZSxDQUFDLEdBQUcsS0FBSyxLQUFLO0FBQUEsRUFDeEY7QUFDQSxRQUFNLFFBQVEsTUFBTSxRQUFRLE9BQU8sYUFBYSxJQUFJLE9BQU8sY0FBYyxPQUFPLENBQUMsTUFBbUIsT0FBTyxNQUFNLFFBQVEsRUFBRSxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUM7QUFDNUksU0FBTztBQUFBLElBQ0wsU0FBUyxJQUFJLE9BQU8sT0FBTztBQUFBLElBQzNCLFNBQVMsT0FBTyxVQUFVLE9BQU8sU0FBUyxPQUFPLE9BQU8sT0FBTyxHQUFHLEdBQUksQ0FBQyxJQUFJO0FBQUEsSUFDM0UsZUFBZTtBQUFBO0FBQUEsSUFFZixLQUFLO0FBQUEsRUFDUDtBQUNGO0FBRUEsU0FBUyxVQUFVLE9BQTBCO0FBQzNDLE1BQUksTUFBTSxRQUFRLEtBQUssRUFBRyxRQUFPLE1BQU0sT0FBTyxDQUFDLE1BQW1CLE9BQU8sTUFBTSxRQUFRO0FBQ3ZGLE1BQUksT0FBTyxVQUFVLFVBQVU7QUFDN0IsUUFBSTtBQUNGLFlBQU0sU0FBUyxLQUFLLE1BQU0sS0FBSztBQUMvQixhQUFPLE1BQU0sUUFBUSxNQUFNLElBQUksT0FBTyxPQUFPLENBQUMsTUFBbUIsT0FBTyxNQUFNLFFBQVEsSUFBSSxDQUFDO0FBQUEsSUFDN0YsUUFBUTtBQUNOLGFBQU8sTUFBTSxNQUFNLEdBQUcsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxFQUFFLE9BQU8sT0FBTztBQUFBLElBQzdEO0FBQUEsRUFDRjtBQUNBLFNBQU8sQ0FBQztBQUNWO0FBRUEsU0FBUyxVQUFVLE9BQXlDO0FBQzFELE1BQUksU0FBUyxPQUFPLFVBQVUsWUFBWSxDQUFDLE1BQU0sUUFBUSxLQUFLLEVBQUcsUUFBTztBQUN4RSxNQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU8sQ0FBQztBQUN2QyxNQUFJO0FBQ0YsVUFBTSxTQUFTLEtBQUssTUFBTSxLQUFLO0FBQy9CLFdBQU8sVUFBVSxPQUFPLFdBQVcsWUFBWSxDQUFDLE1BQU0sUUFBUSxNQUFNLElBQUksU0FBUyxDQUFDO0FBQUEsRUFDcEYsUUFBUTtBQUNOLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDRjtBQUVBLFNBQVMsU0FBUyxPQUF5QztBQUN6RCxTQUFPLFNBQVMsT0FBTyxVQUFVLFlBQVksQ0FBQyxNQUFNLFFBQVEsS0FBSyxJQUFLLFFBQW9DLENBQUM7QUFDN0c7QUFFQSxTQUFTLGVBQWUsT0FBMkQ7QUFDakYsTUFBSSxDQUFDLE1BQU8sUUFBTyxDQUFDLE1BQU0sSUFBSTtBQUM5QixRQUFNLFFBQVEsTUFBTSxRQUFRLElBQUk7QUFDaEMsU0FBTyxTQUFTLElBQUksQ0FBQyxNQUFNLE1BQU0sR0FBRyxLQUFLLEdBQUcsTUFBTSxNQUFNLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUs7QUFDcEY7QUFFQSxTQUFTLFFBQVEsUUFBc0M7QUFDckQsU0FBTyxRQUFRLFdBQVcsTUFBTSxJQUFJLFFBQVEsT0FBTyxNQUFNLENBQUMsQ0FBQyxLQUFLO0FBQ2xFOzs7QUN0Z0JPLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQUMzQixZQUE2QixLQUFvQjtBQUFwQjtBQUFBLEVBQXFCO0FBQUEsRUFFbEQsTUFBTSxVQUF5QjtBQUM3QixVQUFNLEVBQUUsS0FBSyxJQUFJLEtBQUssSUFBSTtBQUMxQixRQUFJLENBQUMsS0FBSyxJQUFJLG9CQUFvQixFQUFHO0FBQ3JDLFFBQUk7QUFDRixZQUFNLEVBQUUsU0FBUyxJQUFJLE1BQU0sS0FBSyxLQUFLLHNCQUFzQixFQUFFLE9BQU8sSUFBSSxDQUFDO0FBQ3pFLFlBQU0sWUFBWSxJQUFJLElBQUksU0FBUyxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsV0FBVyxPQUFPLENBQUMsQ0FBQztBQUNqRixpQkFBVyxTQUFTLE9BQU8sT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsTUFBTSxHQUFHO0FBQy9ELFlBQUksQ0FBQyxNQUFNLFVBQVc7QUFDdEIsY0FBTSxVQUFVLFVBQVUsSUFBSSxNQUFNLFNBQVM7QUFDN0MsWUFBSSxDQUFDLFFBQVM7QUFDZCxZQUFJLE1BQU0sV0FBVyxRQUFRLGVBQWUsTUFBTSxpQkFBaUIsUUFBUSxhQUFjO0FBQ3pGLGFBQUssSUFBSSxNQUFNO0FBQUEsVUFDYixNQUFNO0FBQUEsVUFDTixNQUFNO0FBQUEsVUFDTjtBQUFBLFlBQ0UsUUFBUSxRQUFRO0FBQUEsWUFDaEIsY0FBYyxRQUFRO0FBQUEsWUFDdEIsT0FBTyxNQUFNLFNBQVMsUUFBUTtBQUFBLFlBQzlCLE9BQU8sTUFBTSxTQUFTLFFBQVE7QUFBQSxZQUM5QixRQUFRLE1BQU0sVUFBVSxRQUFRLFVBQVU7QUFBQSxZQUMxQyxVQUFVLENBQUMsV0FBVztBQUFBLFVBQ3hCO0FBQUEsVUFDQSxNQUFNO0FBQUEsUUFDUjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxJQUFJLDhCQUErQixNQUFnQixPQUFPLEVBQUU7QUFBQSxJQUN2RTtBQUFBLEVBQ0Y7QUFDRjs7O0FDN0JPLElBQU0saUJBQWlCLG9CQUFJLElBQUksQ0FBQyxTQUFTLE1BQU0sQ0FBQztBQVloRCxJQUFNLGtCQUFOLE1BQXNCO0FBQUEsRUFHM0IsWUFBNkIsS0FBb0I7QUFBcEI7QUFBQSxFQUFxQjtBQUFBLEVBRjFDLGtCQUFrQjtBQUFBO0FBQUEsRUFLMUIsYUFBYSxPQUF3QjtBQUNuQyxVQUFNLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFDekIsVUFBTSxXQUFXLEtBQUssY0FBYyxLQUFLO0FBQ3pDLFVBQU0sVUFBVSxNQUFNLFVBQVUsR0FBRyxNQUFNLGNBQWMsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFLEtBQUssZUFBZTtBQUM1RixTQUFLLGVBQWUsU0FBUyxPQUFPLFVBQVUsV0FBVyxHQUFHO0FBQzVELFFBQUksQ0FBQyxlQUFlLElBQUksTUFBTSxJQUFJLEVBQUc7QUFDckMsVUFBTSxRQUFRRSxVQUFTLE1BQU0sS0FBSztBQUNsQyxVQUFNLEtBQUssT0FBTyxPQUFPO0FBQ3pCLFVBQU0sU0FBUyxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLFFBQVEsSUFBSTtBQUNuRSxVQUFNLGNBQWNDLEtBQUksTUFBTSxXQUFXLEtBQUtBLEtBQUksTUFBTSxNQUFNLEdBQUcsTUFBTSxHQUFHLEdBQUcsS0FBSztBQUNsRixTQUFLLElBQUksTUFBTTtBQUFBLE1BQ2I7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLFFBQ0UsTUFBTTtBQUFBLFFBQ04sT0FBTyxNQUFNO0FBQUEsUUFDYjtBQUFBLFFBQ0EsUUFBUSxNQUFNLFVBQVU7QUFBQSxRQUN4QixjQUFjQSxLQUFJLE1BQU0sYUFBYSxLQUFLO0FBQUEsUUFDMUMsYUFBYSxjQUFjLE9BQU8sV0FBVyxJQUFJO0FBQUEsUUFDakQsT0FBT0EsS0FBSSxNQUFNLFdBQVcsS0FBS0EsS0FBSSxNQUFNLGFBQWEsS0FBSztBQUFBLFFBQzdELE9BQU9BLEtBQUksTUFBTSxLQUFLO0FBQUEsUUFDdEIsYUFBYSxNQUFNLGVBQWUsUUFBUSxlQUFlO0FBQUEsUUFDekQsY0FBYyxRQUFRLGdCQUFnQjtBQUFBLFFBQ3RDLFFBQVEsUUFBUSxVQUFVO0FBQUEsUUFDMUIsT0FBTyxRQUFRLFNBQVM7QUFBQSxRQUN4QixRQUFRLFFBQVEsVUFBVTtBQUFBLFFBQzFCLFNBQVMsUUFBUSxXQUFXO0FBQUEsUUFDNUIsT0FBTztBQUFBLFFBQ1AsTUFBTTtBQUFBLFFBQ04sV0FBVztBQUFBLFFBQ1gsWUFBWTtBQUFBLFFBQ1osVUFBVSxDQUFDLE1BQU07QUFBQSxNQUNuQjtBQUFBLE1BQ0EsTUFBTSxTQUFTLElBQUksWUFBWSxHQUFHO0FBQUEsSUFDcEM7QUFDQSxTQUFLLElBQUksTUFBTSxLQUFLO0FBQUEsTUFDbEIsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sUUFBUTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVTtBQUFBLE1BQ1YsT0FBTyxRQUFRLFNBQVM7QUFBQSxNQUN4QixTQUFTLEdBQUcsUUFBUSxTQUFTLE1BQU0sS0FBSyxzQkFBc0IsU0FBUyxlQUFlLFlBQVksR0FBRyxDQUFDO0FBQUEsSUFDeEcsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLFlBQVksT0FBd0I7QUFDbEMsVUFBTSxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQ3pCLFVBQU0sV0FBVyxLQUFLLGNBQWMsS0FBSztBQUN6QyxRQUFJLE1BQU0sT0FBUSxNQUFLLGVBQWUsTUFBTSxRQUFRLE9BQU8sVUFBVSxZQUFZLEdBQUc7QUFDcEYsUUFBSSxDQUFDLGVBQWUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLE1BQU0sT0FBUTtBQUN0RCxVQUFNLEtBQUssT0FBTyxNQUFNLE1BQU07QUFDOUIsVUFBTSxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLEVBQUU7QUFDaEQsUUFBSSxDQUFDLFNBQVU7QUFDZixVQUFNLFNBQVMsWUFBWSxNQUFNLE1BQU07QUFDdkMsU0FBSyxJQUFJLE1BQU0sWUFBWSxJQUFJLEtBQUssRUFBRSxPQUFPLFNBQVMsV0FBVyxRQUFRLFNBQVMsU0FBUyxZQUFZLFdBQVcsTUFBTSxPQUFPLFNBQVMsS0FBSyxZQUFZLEtBQUssVUFBVSxDQUFDLE1BQU0sRUFBRSxHQUFHLE1BQU0sUUFBUTtBQUNsTSxTQUFLLElBQUksTUFBTSxLQUFLO0FBQUEsTUFDbEIsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sUUFBUTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxTQUFTO0FBQUEsTUFDbkIsT0FBTyxTQUFTO0FBQUEsTUFDaEIsU0FBUyxZQUFZLFNBQVMsU0FBUyxFQUFFLElBQUksU0FBUyxXQUFXLFVBQVUsR0FBRyxRQUFRLFFBQVEsR0FBRztBQUFBLElBQ25HLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFUSxjQUFjLE9BQWlDO0FBQ3JELFVBQU0sU0FBUyxLQUFLLElBQUksU0FBUyxRQUFRLEVBQUUsWUFBWSxNQUFNLGNBQWMsS0FBSyxDQUFDO0FBQ2pGLFFBQUksT0FBUSxRQUFPO0FBQ25CLFFBQUksQ0FBQyxNQUFNLFlBQWEsUUFBTztBQUUvQixVQUFNLGFBQWEsT0FBTyxPQUFPLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxNQUFNLEVBQUU7QUFBQSxNQUM3RCxDQUFDLFVBQVUsTUFBTSxTQUFTLGNBQWMsTUFBTSxRQUFRLE1BQU0sZ0JBQWdCLE1BQU0sZ0JBQWdCLE1BQU0sU0FBUyxNQUFNLFdBQVcsTUFBTTtBQUFBLElBQzFJO0FBQ0EsV0FBTyxXQUFXLFdBQVcsSUFBSSxXQUFXLENBQUMsRUFBRSxLQUFLO0FBQUEsRUFDdEQ7QUFBQSxFQUVRLGVBQWUsU0FBaUIsT0FBa0IsU0FBd0IsT0FBK0IsS0FBbUI7QUFDbEksU0FBSyxJQUFJLE1BQU0sSUFBSTtBQUFBLE1BQ2pCLFFBQVE7QUFBQSxNQUNSLElBQUk7QUFBQSxNQUNKLE9BQU8sRUFBRSxJQUFJLFNBQVMsU0FBUyxZQUFZLE1BQU0sY0FBYyxNQUFNLE1BQU0sTUFBTSxNQUFNLFNBQVMsZUFBZSxNQUFNLE1BQU0sTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLE1BQU07QUFBQSxJQUMxSixDQUFDO0FBQUEsRUFDSDtBQUNGO0FBRU8sU0FBUyxlQUFlLE1BQWMsT0FBd0I7QUFDbkUsUUFBTSxTQUFTRCxVQUFTLEtBQUs7QUFDN0IsUUFBTSxPQUFPQyxLQUFJLE9BQU8sV0FBVyxLQUFLQSxLQUFJLE9BQU8sT0FBTyxLQUFLQSxLQUFJLE9BQU8sU0FBUyxLQUFLQSxLQUFJLE9BQU8sT0FBTyxLQUFLQSxLQUFJLE9BQU8sR0FBRyxLQUFLQSxLQUFJLE9BQU8sTUFBTTtBQUNuSixTQUFPLE9BQU8sU0FBUyxRQUFRLE1BQU0sR0FBRyxDQUFDO0FBQzNDO0FBRUEsU0FBUyxZQUFZLFFBQTBCO0FBQzdDLFFBQU0sU0FBU0QsVUFBUyxNQUFNO0FBQzlCLE1BQUksT0FBTyxhQUFhLFFBQVEsT0FBTyxZQUFZLEtBQU0sUUFBTztBQUNoRSxRQUFNLFNBQVNDLEtBQUksT0FBTyxNQUFNO0FBQ2hDLFNBQU8sV0FBVyxXQUFXLFdBQVc7QUFDMUM7QUFFQSxTQUFTRCxVQUFTLE9BQXlDO0FBQ3pELFNBQU8sU0FBUyxPQUFPLFVBQVUsWUFBWSxDQUFDLE1BQU0sUUFBUSxLQUFLLElBQUssUUFBb0MsQ0FBQztBQUM3RztBQUVBLFNBQVNDLEtBQUksT0FBK0I7QUFDMUMsU0FBTyxPQUFPLFVBQVUsWUFBWSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUNwRTs7O0FDL0hBLFNBQVMsTUFBTSxXQUFBQyxVQUFTLFlBQUFDLFdBQVUsVUFBVSxZQUFZO0FBQ3hELFNBQVMsZUFBZTtBQUN4QixTQUFTLFFBQUFDLGFBQVk7QUFRckIsSUFBTSxrQkFBa0I7QUFDeEIsSUFBTSxvQkFBb0IsSUFBSSxLQUFLLEtBQUs7QUFDeEMsSUFBTSxlQUFlO0FBQ3JCLElBQU0sd0JBQXdCO0FBQzlCLElBQU0saUJBQWlCO0FBRWhCLElBQU0sdUJBQU4sTUFBMkI7QUFBQSxFQVFoQyxZQUNtQixLQUNBLGFBQ2pCO0FBRmlCO0FBQ0E7QUFBQSxFQUNoQjtBQUFBLEVBVkssY0FBYyxvQkFBSSxJQUF1RDtBQUFBLEVBQ3pFLFlBQVksb0JBQUksSUFBb0I7QUFBQSxFQUNwQyxZQUFZLG9CQUFJLElBQTJDO0FBQUE7QUFBQSxFQUUzRCxjQUFjLG9CQUFJLElBQW9CO0FBQUEsRUFDdEMsZUFBZSxvQkFBSSxJQUFvQjtBQUFBLEVBTy9DLGNBQWMsU0FBZ0M7QUFDNUMsV0FBTyxLQUFLLFlBQVksSUFBSSxPQUFPLEtBQUs7QUFBQSxFQUMxQztBQUFBO0FBQUEsRUFHQSxNQUFNLGtCQUFrQixPQUE0QztBQUNsRSxRQUFJLE1BQU0sU0FBUyxXQUFZLFFBQU8sS0FBSyxjQUFjLE1BQU0sRUFBRTtBQUNqRSxRQUFJLENBQUMsTUFBTSxhQUFjLE1BQU0sVUFBVSxZQUFZLE1BQU0sVUFBVSxLQUFPLFFBQU87QUFDbkYsVUFBTSxTQUFTLEtBQUssYUFBYSxJQUFJLE1BQU0sU0FBUztBQUNwRCxRQUFJLFdBQVcsT0FBVyxRQUFPO0FBQ2pDLFFBQUksUUFBdUI7QUFDM0IsZUFBVyxRQUFRLE1BQU0sS0FBSyxhQUFhLEdBQUc7QUFDNUMsVUFBSSxXQUFxQixDQUFDO0FBQzFCLFVBQUk7QUFDRixtQkFBVyxNQUFNQyxTQUFRLElBQUk7QUFBQSxNQUMvQixRQUFRO0FBQ047QUFBQSxNQUNGO0FBQ0EsaUJBQVcsV0FBVyxVQUFVO0FBQzlCLGNBQU0sT0FBT0MsTUFBSyxNQUFNLFNBQVMsR0FBRyxNQUFNLFNBQVMsUUFBUTtBQUMzRCxZQUFJO0FBQ0YsZUFBSyxNQUFNLEtBQUssSUFBSSxHQUFHLE9BQU8sR0FBRztBQUMvQixvQkFBUTtBQUNSO0FBQUEsVUFDRjtBQUFBLFFBQ0YsUUFBUTtBQUFBLFFBRVI7QUFBQSxNQUNGO0FBQ0EsVUFBSSxNQUFPO0FBQUEsSUFDYjtBQUNBLFFBQUksTUFBTyxNQUFLLGFBQWEsSUFBSSxNQUFNLFdBQVcsS0FBSztBQUN2RCxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBTSxPQUFzQjtBQUMxQixVQUFNLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFDekIsVUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhO0FBQ3RDLFFBQUksQ0FBQyxNQUFNLE9BQVE7QUFDbkIsVUFBTSxVQUFVLE9BQU8sT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsTUFBTSxFQUN2RCxPQUFPLENBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxTQUFTLGVBQWUsRUFBRSxVQUFVLFlBQVksRUFBRSxVQUFVLFVBQVUsRUFBRSxRQUFRLE1BQU0sRUFBRSxhQUFhLGtCQUFrQixFQUN0SixLQUFLLENBQUMsR0FBRyxNQUFNLE9BQU8sRUFBRSxJQUFJLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQzdFLE1BQU0sR0FBRyxxQkFBcUI7QUFDakMsZUFBVyxVQUFVLFNBQVM7QUFDNUIsWUFBTSxNQUFNLE1BQU0sS0FBSyxZQUFZLE9BQU8sT0FBTyxXQUFZLEdBQUc7QUFDaEUsVUFBSSxJQUFLLE9BQU0sS0FBSyxRQUFRLEtBQUssUUFBUSxHQUFHO0FBQUEsSUFDOUM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQWtDO0FBQzlDLFVBQU0sYUFBYSxDQUFDQSxNQUFLLFFBQVEsR0FBRyxXQUFXLFVBQVUsR0FBRyxHQUFHLEtBQUssWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTQSxNQUFLLE1BQU0sVUFBVSxDQUFDLENBQUM7QUFDdkgsVUFBTSxNQUFNLG9CQUFJLElBQVk7QUFDNUIsZUFBVyxhQUFhLFlBQVk7QUFDbEMsVUFBSTtBQUNGLFlBQUksSUFBSSxNQUFNLFNBQVMsU0FBUyxDQUFDO0FBQUEsTUFDbkMsUUFBUTtBQUFBLE1BRVI7QUFBQSxJQUNGO0FBQ0EsV0FBTyxDQUFDLEdBQUcsR0FBRztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxNQUFjLFlBQVksT0FBaUIsV0FBbUIsS0FBcUM7QUFDakcsVUFBTSxTQUFTLEtBQUssWUFBWSxJQUFJLFNBQVM7QUFDN0MsUUFBSSxXQUFXLE9BQU8sT0FBTyxNQUFNLE9BQU8sWUFBWSxjQUFlLFFBQU8sT0FBTztBQUNuRixRQUFJLFFBQXVCO0FBQzNCLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFVBQUk7QUFDSixVQUFJO0FBQ0YsbUJBQVcsTUFBTUQsU0FBUSxJQUFJO0FBQUEsTUFDL0IsUUFBUTtBQUNOO0FBQUEsTUFDRjtBQUNBLGlCQUFXLFdBQVcsVUFBVTtBQUM5QixjQUFNLE1BQU1DLE1BQUssTUFBTSxTQUFTLFdBQVcsV0FBVztBQUN0RCxZQUFJO0FBQ0YsZUFBSyxNQUFNLEtBQUssR0FBRyxHQUFHLFlBQVksR0FBRztBQUNuQyxvQkFBUTtBQUNSO0FBQUEsVUFDRjtBQUFBLFFBQ0YsUUFBUTtBQUFBLFFBRVI7QUFBQSxNQUNGO0FBQ0EsVUFBSSxNQUFPO0FBQUEsSUFDYjtBQUNBLFNBQUssWUFBWSxJQUFJLFdBQVcsRUFBRSxLQUFLLE9BQU8sV0FBVyxJQUFJLENBQUM7QUFDOUQsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQWMsUUFBUSxLQUFhLFFBQXFCLEtBQTRCO0FBQ2xGLFFBQUk7QUFDSixRQUFJO0FBQ0YsZUFBUyxNQUFNRCxTQUFRLEdBQUcsR0FBRyxPQUFPLENBQUMsU0FBUyxLQUFLLFNBQVMsWUFBWSxDQUFDO0FBQUEsSUFDM0UsUUFBUTtBQUNOO0FBQUEsSUFDRjtBQUNBLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFlBQU0sT0FBTyxLQUFLLE1BQU0sR0FBRyxDQUFDLGFBQWEsTUFBTTtBQUMvQyxZQUFNLFdBQVdDLE1BQUssS0FBSyxJQUFJO0FBQy9CLFlBQU0saUJBQWlCQSxNQUFLLEtBQUssR0FBRyxJQUFJLFFBQVE7QUFDaEQsVUFBSSxZQUFZO0FBQ2hCLFVBQUksUUFBUTtBQUNaLFVBQUk7QUFDRixxQkFBYSxNQUFNLEtBQUssUUFBUSxHQUFHO0FBQ25DLGdCQUFRLEtBQUssSUFBSSxXQUFXLE1BQU0sS0FBSyxjQUFjLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxNQUFNLENBQUMsQ0FBQztBQUFBLE1BQzlGLFFBQVE7QUFDTjtBQUFBLE1BQ0Y7QUFFQSxVQUFJO0FBQ0osWUFBTSxhQUFhLEtBQUssVUFBVSxJQUFJLFFBQVE7QUFDOUMsVUFBSSxjQUFjLFdBQVcsVUFBVSxVQUFXLFFBQU8sV0FBVztBQUFBLFdBQy9EO0FBQ0gsWUFBSTtBQUNGLGlCQUFPLEtBQUssTUFBTSxNQUFNQyxVQUFTLFVBQVUsTUFBTSxDQUFDO0FBQUEsUUFDcEQsUUFBUTtBQUNOO0FBQUEsUUFDRjtBQUNBLGFBQUssVUFBVSxJQUFJLFVBQVUsRUFBRSxPQUFPLFdBQVcsS0FBSyxDQUFDO0FBQ3ZELFlBQUksS0FBSyxVQUFVLE9BQU8sZUFBZ0IsTUFBSyxVQUFVLE9BQU8sS0FBSyxVQUFVLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBTTtBQUFBLE1BQ3JHO0FBQ0EsWUFBTSxLQUFLLEtBQUssWUFBWSxPQUFPLEtBQUssU0FBUyxLQUFLLFlBQVksSUFBSTtBQUN0RSxXQUFLLFlBQVksSUFBSSxJQUFJLGNBQWM7QUFDdkMsWUFBTSxXQUFXLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLEVBQUU7QUFDaEQsWUFBTSxVQUFVLE1BQU0sUUFBUTtBQUM5QixZQUFNLFdBQVcsS0FBSyxhQUFhO0FBQ25DLFlBQU0sT0FBTyxDQUFDLFlBQVksV0FBVyxPQUFPO0FBRTVDLFVBQUksS0FBSyxVQUFVLElBQUksRUFBRSxNQUFNLFNBQVMsWUFBWSxTQUFTLFNBQVMsS0FBTTtBQUM1RSxXQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUs7QUFDNUIsWUFBTSxZQUFZLFVBQVUsYUFBYyxNQUFNLGVBQWUsY0FBYyxLQUFNO0FBQ25GLFdBQUssSUFBSSxNQUFNO0FBQUEsUUFDYjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsVUFDRSxNQUFNO0FBQUEsVUFDTixPQUFPO0FBQUEsVUFDUCxVQUFVLFVBQVUsWUFBWSxPQUFPO0FBQUEsVUFDdkMsUUFBUSxLQUFLLGFBQWE7QUFBQSxVQUMxQixjQUFjLEtBQUssYUFBYSxVQUFVLGdCQUFnQjtBQUFBLFVBQzFELGFBQWEsS0FBSyxjQUFjLGtCQUFrQixLQUFLLGFBQWEsR0FBRyxJQUFJLFVBQVUsZUFBZTtBQUFBLFVBQ3BHLE9BQU8sS0FBSyxjQUFjLGtCQUFrQixLQUFLLGFBQWEsR0FBRyxJQUFJLFVBQVUsU0FBUztBQUFBLFVBQ3hGLE9BQU8sS0FBSyxTQUFTLFVBQVUsU0FBUztBQUFBLFVBQ3hDLE9BQU8sT0FBTztBQUFBLFVBQ2QsUUFBUSxPQUFPO0FBQUEsVUFDZixhQUFhLE9BQU87QUFBQSxVQUNwQixjQUFjLE9BQU87QUFBQSxVQUNyQixRQUFRLE9BQU87QUFBQSxVQUNmLFNBQVMsT0FBTztBQUFBLFVBQ2hCLE9BQU8sV0FBVyxTQUFTLE9BQU8sWUFBWTtBQUFBLFVBQzlDLFNBQVMsV0FBVyxZQUFZO0FBQUEsVUFDaEM7QUFBQSxVQUNBO0FBQUEsVUFDQSxZQUFZO0FBQUEsVUFDWixTQUFTLFdBQVcsUUFBUTtBQUFBLFVBQzVCLFVBQVUsQ0FBQyxjQUFjO0FBQUEsUUFDM0I7QUFBQSxRQUNBLE1BQU0sU0FBUyxJQUFJLFlBQVksR0FBRztBQUFBLE1BQ3BDO0FBQ0EsVUFBSSxDQUFDLFVBQVU7QUFDYixhQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxpQkFBaUIsRUFBRSxJQUFJLElBQUksV0FBVyxNQUFNLG9CQUFvQixRQUFRLGdCQUFnQixVQUFVLElBQUksVUFBVSxPQUFPLElBQUksT0FBTyxPQUFPLE9BQU8sU0FBUyxHQUFHLE9BQU8sU0FBUyxRQUFRLHNCQUFzQixLQUFLLGVBQWUsS0FBSyxhQUFhLFVBQVUsR0FBRyxDQUFDO0FBQUEsTUFDMVIsV0FBVyxZQUFZLFNBQVMsVUFBVSxRQUFRO0FBQ2hELGFBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLGlCQUFpQixFQUFFLElBQUksSUFBSSxPQUFPLE1BQU0sc0JBQXNCLFFBQVEsZ0JBQWdCLFVBQVUsSUFBSSxVQUFVLE9BQU8sSUFBSSxPQUFPLE9BQU8sT0FBTyxTQUFTLFlBQVksS0FBSyxlQUFlLEVBQUUsWUFBWSxLQUFLLEVBQUUsQ0FBQztBQUFBLE1BQ3pPO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLGVBQWUsZUFBZSxNQUFzQztBQUNsRSxNQUFJO0FBQ0YsVUFBTSxTQUFTLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFDbkMsUUFBSTtBQUNGLFlBQU0sRUFBRSxRQUFRLFVBQVUsSUFBSSxNQUFNLE9BQU8sS0FBSyxPQUFPLE1BQU0sSUFBSSxHQUFHLEdBQUcsTUFBTSxDQUFDO0FBQzlFLFlBQU0sT0FBTyxPQUFPLFNBQVMsR0FBRyxTQUFTLEVBQUUsU0FBUyxNQUFNLEVBQUUsTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUN6RSxZQUFNLEtBQU0sS0FBSyxNQUFNLElBQUksRUFBNkI7QUFDeEQsWUFBTSxLQUFLLEtBQUssS0FBSyxNQUFNLEVBQUUsSUFBSTtBQUNqQyxhQUFPLE9BQU8sU0FBUyxFQUFFLElBQUksS0FBSztBQUFBLElBQ3BDLFVBQUU7QUFDQSxZQUFNLE9BQU8sTUFBTTtBQUFBLElBQ3JCO0FBQUEsRUFDRixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjs7O0FDck5BLFNBQVMsUUFBQUMsT0FBTSxXQUFBQyxVQUFTLFFBQUFDLGFBQVk7QUFDcEMsU0FBUyxXQUFBQyxnQkFBZTtBQUN4QixTQUFTLFFBQUFDLGFBQVk7QUFLckIsSUFBTSxhQUFhLE1BQU07QUFDekIsSUFBTSxZQUFZLElBQUksS0FBSyxLQUFLO0FBQ2hDLElBQU0saUJBQWlCO0FBSWhCLElBQU0sc0JBQU4sTUFBMEI7QUFBQSxFQUsvQixZQUNtQixLQUNBLGFBQ0EsWUFDakI7QUFIaUI7QUFDQTtBQUNBO0FBQUEsRUFDaEI7QUFBQSxFQVJLLGFBQWEsb0JBQUksSUFBb0I7QUFBQSxFQUNyQyxpQkFBaUI7QUFBQSxFQUNqQixPQUFPLG9CQUFJLElBQW9CO0FBQUEsRUFRdkMsTUFBTSxVQUF5QjtBQUM3QixVQUFNLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFDekIsVUFBTSxTQUFTLE9BQU8sT0FBTyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxPQUFPLEVBQUUsUUFBUSxNQUFNLEVBQUUsYUFBYSxlQUFlLEVBQUUsYUFBYSxFQUFFLFNBQVMsV0FBVztBQUM3SixlQUFXLFNBQVMsUUFBUTtBQUMxQixZQUFNLE9BQU8sTUFBTSxLQUFLLFFBQVEsS0FBSztBQUNyQyxVQUFJLENBQUMsS0FBTTtBQUNYLFVBQUksUUFBUTtBQUNaLFVBQUk7QUFDRixpQkFBUyxNQUFNRixNQUFLLElBQUksR0FBRztBQUFBLE1BQzdCLFFBQVE7QUFDTjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLEtBQUssS0FBSyxJQUFJLE1BQU0sRUFBRSxNQUFNLE1BQU87QUFDdkMsV0FBSyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUs7QUFDN0IsWUFBTSxVQUFVLE1BQU0sVUFBVSxVQUFVLGVBQWUsTUFBTSxLQUFLLElBQUksQ0FBQyxJQUFJLGdCQUFnQixNQUFNLEtBQUssSUFBSSxDQUFDO0FBQzdHLFVBQUksQ0FBQyxRQUFRLFNBQVMsQ0FBQyxRQUFRLE9BQVE7QUFDdkMsWUFBTSxVQUFVLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLE1BQU0sRUFBRTtBQUNyRCxVQUFJLENBQUMsV0FBWSxRQUFRLFdBQVcsUUFBUSxTQUFTLFFBQVEsVUFBVSxRQUFRLFlBQVksUUFBUSxVQUFVLFFBQVEsUUFBVTtBQUMvSCxXQUFLLElBQUksTUFBTSxZQUFZLE1BQU0sSUFBSSxRQUFRLFlBQVksRUFBRSxPQUFPLFFBQVEsU0FBUyxRQUFXLFFBQVEsUUFBUSxVQUFVLFFBQVcsVUFBVSxDQUFDLGNBQWMsRUFBRSxHQUFHLE1BQU0sT0FBTztBQUFBLElBQ2hMO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxRQUFRLE9BQTRDO0FBQ2hFLFFBQUksTUFBTSxVQUFVLFFBQVMsUUFBTyxNQUFNLFlBQVksTUFBTSxLQUFLLFVBQVUsTUFBTSxTQUFTLElBQUk7QUFDOUYsUUFBSSxNQUFNLFVBQVUsWUFBWSxNQUFNLFVBQVUsUUFBUSxNQUFNLFNBQVMsV0FBWSxRQUFPLE1BQU0sS0FBSyxZQUFZLGtCQUFrQixLQUFLO0FBQ3hJLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLFVBQVUsV0FBMkM7QUFDakUsVUFBTSxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQ3pCLFFBQUksQ0FBQyxLQUFLLFdBQVcsSUFBSSxTQUFTLEtBQUssTUFBTSxLQUFLLGlCQUFpQixnQkFBZ0I7QUFDakYsV0FBSyxpQkFBaUI7QUFDdEIsaUJBQVcsUUFBUSxDQUFDRSxNQUFLRCxTQUFRLEdBQUcsUUFBUSxHQUFHLEdBQUcsS0FBSyxXQUFXLENBQUMsRUFBRyxPQUFNLG1CQUFtQkMsTUFBSyxNQUFNLFVBQVUsR0FBRyxLQUFLLFVBQVU7QUFBQSxJQUN4STtBQUNBLFdBQU8sS0FBSyxXQUFXLElBQUksU0FBUyxLQUFLO0FBQUEsRUFDM0M7QUFDRjtBQUdBLGVBQWUsbUJBQW1CLE1BQWMsT0FBMkM7QUFDekYsUUFBTSxPQUFPLE9BQU8sU0FBaUIsTUFBTUgsU0FBUSxHQUFHLEVBQUUsTUFBTSxNQUFNLENBQUMsQ0FBYSxHQUFHLEtBQUssRUFBRSxRQUFRO0FBQ3BHLE1BQUksT0FBTztBQUNYLGFBQVcsUUFBUSxNQUFNLEtBQUssSUFBSSxHQUFHO0FBQ25DLGVBQVcsU0FBUyxNQUFNLEtBQUtHLE1BQUssTUFBTSxJQUFJLENBQUMsR0FBRztBQUNoRCxpQkFBVyxPQUFPLE1BQU0sS0FBS0EsTUFBSyxNQUFNLE1BQU0sS0FBSyxDQUFDLEdBQUc7QUFDckQsWUFBSSxFQUFFLE9BQU8sR0FBSTtBQUNqQixtQkFBVyxRQUFRLE1BQU0sS0FBS0EsTUFBSyxNQUFNLE1BQU0sT0FBTyxHQUFHLENBQUMsR0FBRztBQUMzRCxnQkFBTSxRQUFRLHFGQUFxRixLQUFLLElBQUk7QUFDNUcsY0FBSSxTQUFTLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxDQUFDLEVBQUcsT0FBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHQSxNQUFLLE1BQU0sTUFBTSxPQUFPLEtBQUssSUFBSSxDQUFDO0FBQUEsUUFDM0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLGVBQWUsS0FBSyxNQUFpQztBQUNuRCxRQUFNLFNBQVMsTUFBTUosTUFBSyxNQUFNLEdBQUc7QUFDbkMsTUFBSTtBQUNGLFVBQU0sUUFBUSxNQUFNLE9BQU8sS0FBSyxHQUFHO0FBQ25DLFVBQU0sUUFBUSxLQUFLLElBQUksR0FBRyxPQUFPLFVBQVU7QUFDM0MsVUFBTSxTQUFTLE9BQU8sTUFBTSxPQUFPLEtBQUs7QUFDeEMsVUFBTSxPQUFPLEtBQUssUUFBUSxHQUFHLE9BQU8sUUFBUSxLQUFLO0FBQ2pELFVBQU0sUUFBUSxPQUFPLFNBQVMsTUFBTSxFQUFFLE1BQU0sSUFBSTtBQUNoRCxRQUFJLFFBQVEsRUFBRyxPQUFNLE1BQU07QUFDM0IsV0FBTztBQUFBLEVBQ1QsVUFBRTtBQUNBLFVBQU0sT0FBTyxNQUFNO0FBQUEsRUFDckI7QUFDRjtBQUVPLFNBQVMsZ0JBQWdCLE9BQStCO0FBQzdELFdBQVMsSUFBSSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUMxQyxRQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsU0FBUyxhQUFhLEVBQUc7QUFDdkMsUUFBSTtBQUNGLFlBQU0sUUFBUSxLQUFLLE1BQU0sTUFBTSxDQUFDLENBQUM7QUFDakMsVUFBSSxNQUFNLFNBQVMsZUFBZSxDQUFDLE1BQU0sU0FBUyxTQUFTLE1BQU0sUUFBUSxVQUFVLGNBQWU7QUFDbEcsYUFBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLE9BQU8sUUFBUSxNQUFNLGlCQUFpQixNQUFNLFVBQVUsS0FBSztBQUFBLElBQzNGLFFBQVE7QUFBQSxJQUVSO0FBQUEsRUFDRjtBQUNBLFNBQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLO0FBQ3JDO0FBRU8sU0FBUyxlQUFlLE9BQStCO0FBQzVELFdBQVMsSUFBSSxNQUFNLFNBQVMsR0FBRyxLQUFLLEdBQUcsS0FBSztBQUMxQyxRQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsU0FBUyxjQUFjLEVBQUc7QUFDeEMsUUFBSTtBQUNGLFlBQU0sUUFBUSxLQUFLLE1BQU0sTUFBTSxDQUFDLENBQUM7QUFDakMsVUFBSSxNQUFNLFNBQVMsZUFBZ0I7QUFDbkMsYUFBTyxFQUFFLE9BQU8sTUFBTSxTQUFTLFNBQVMsTUFBTSxRQUFRLE1BQU0sU0FBUyxVQUFVLE1BQU0sU0FBUyxvQkFBb0IsS0FBSztBQUFBLElBQ3pILFFBQVE7QUFBQSxJQUVSO0FBQUEsRUFDRjtBQUNBLFNBQU8sRUFBRSxPQUFPLE1BQU0sUUFBUSxLQUFLO0FBQ3JDOzs7QUMxSEEsU0FBUyxnQkFBZ0I7QUFDekIsU0FBUyxRQUFRLFdBQVcsWUFBQUssaUJBQWdCO0FBQzVDLFNBQVMsV0FBQUMsVUFBUyxnQkFBZ0I7QUFDbEMsU0FBUyxXQUFXLFFBQUFDLGFBQVk7QUFTaEMsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxhQUFhLElBQUksT0FBTztBQU05QixlQUFzQixlQUFlLFVBQWlEO0FBQ3BGLFFBQU0sT0FBT0QsU0FBUTtBQUNyQixRQUFNLGFBQXVCLENBQUM7QUFDOUIsTUFBSSxTQUFVLFlBQVcsS0FBSyxRQUFRO0FBQ3RDLE1BQUksU0FBUyxNQUFNLFFBQVMsWUFBVyxLQUFLQyxNQUFLLE1BQU0sdUNBQXVDLENBQUM7QUFDL0YsUUFBTSxNQUFNLFNBQVMsTUFBTSxVQUFVLENBQUMsWUFBWSxZQUFZLE1BQU0sSUFBSSxDQUFDLE1BQU07QUFDL0UsYUFBVyxRQUFRLFFBQVEsSUFBSSxRQUFRLElBQUksTUFBTSxTQUFTLEVBQUcsWUFBVyxRQUFRLElBQUssS0FBSSxJQUFLLFlBQVcsS0FBS0EsTUFBSyxLQUFLLElBQUksQ0FBQztBQUM3SCxNQUFJLFNBQVMsTUFBTSxTQUFVLFlBQVcsS0FBSyx1QkFBdUIsMEJBQTBCLG9EQUFvRDtBQUNsSixNQUFJLFNBQVMsTUFBTSxRQUFTLFlBQVcsS0FBS0EsTUFBSyxRQUFRLElBQUksZ0JBQWdCQSxNQUFLLE1BQU0sZUFBZSxHQUFHLHNDQUFzQyxDQUFDO0FBQ2pKLE1BQUksU0FBUyxNQUFNLFFBQVMsWUFBVyxLQUFLLHFCQUFxQjtBQUNqRSxhQUFXLGFBQWEsQ0FBQyxHQUFHLElBQUksSUFBSSxVQUFVLENBQUMsR0FBRztBQUNoRCxRQUFJO0FBQ0YsWUFBTSxPQUFPLFdBQVcsU0FBUyxNQUFNLFVBQVUsVUFBVSxPQUFPLFVBQVUsSUFBSTtBQUFBLElBQ2xGLFFBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUFJLE1BQU0sc0JBQXNCLFNBQVMsRUFBRztBQUM1QyxRQUFJLE1BQU0sZ0JBQWdCLFNBQVMsRUFBRyxRQUFPO0FBQUEsRUFDL0M7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxlQUFzQixzQkFBc0IsTUFBZ0M7QUFDMUUsTUFBSTtBQUNGLFVBQU0sUUFBUSxNQUFNRixVQUFTLElBQUksR0FBRyxTQUFTLEdBQUcsSUFBSSxFQUFFLFNBQVMsUUFBUTtBQUN2RSxXQUFPLGNBQWMsS0FBSyxJQUFJLEtBQUssNkNBQTZDLEtBQUssSUFBSTtBQUFBLEVBQzNGLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsU0FBUyxnQkFBZ0IsTUFBZ0M7QUFDdkQsU0FBTyxJQUFJLFFBQVEsQ0FBQ0csYUFBWTtBQUM5QixhQUFTLE1BQU0sQ0FBQyxVQUFVLFFBQVEsR0FBRyxFQUFFLFNBQVMsS0FBTSxXQUFXLE9BQU8sTUFBTSxhQUFhLEtBQUssR0FBRyxDQUFDLFFBQVEsV0FBVztBQUNySCxZQUFNLFNBQVMsZUFBa0MsVUFBVSxJQUFJLElBQUk7QUFDbkUsTUFBQUEsU0FBUSxPQUFPLE1BQU0sT0FBTyxPQUFPLFdBQVcsWUFBWSxPQUFPLFdBQVcsUUFBUSxTQUFTLE9BQU8sTUFBTTtBQUFBLElBQzVHLENBQUM7QUFBQSxFQUNILENBQUM7QUFDSDtBQUVPLFNBQVMsZ0JBQWdCLE1BQWdDO0FBQzlELE1BQUksU0FBUztBQUNiLFFBQU0sUUFBd0IsQ0FBQztBQUMvQixRQUFNLFVBQVUsTUFDZCxJQUFJLFFBQWMsQ0FBQ0EsYUFBWTtBQUM3QixRQUFJLFNBQVMsZ0JBQWdCO0FBQzNCO0FBQ0EsTUFBQUEsU0FBUTtBQUFBLElBQ1YsTUFBTyxPQUFNLEtBQUssTUFBTTtBQUFFO0FBQVUsTUFBQUEsU0FBUTtBQUFBLElBQUUsQ0FBQztBQUFBLEVBQ2pELENBQUM7QUFDSCxRQUFNLFVBQVUsTUFBTTtBQUNwQjtBQUNBLFVBQU0sTUFBTSxJQUFJO0FBQUEsRUFDbEI7QUFFQSxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsTUFBTSxJQUFPLE1BQWdCLFVBQWtELENBQUMsR0FBMEI7QUFDeEcsVUFBSSxDQUFDLEtBQU0sUUFBTyxFQUFFLElBQUksT0FBTyxNQUFNLG1CQUFtQixTQUFTLG1FQUFtRTtBQUNwSSxZQUFNLFFBQVE7QUFDZCxVQUFJO0FBQ0YsZUFBTyxNQUFNLElBQUksUUFBc0IsQ0FBQ0EsYUFBWTtBQUNsRCxnQkFBTSxRQUFRO0FBQUEsWUFDWjtBQUFBLFlBQ0EsQ0FBQyxHQUFHLE1BQU0sUUFBUTtBQUFBLFlBQ2xCLEVBQUUsU0FBUyxRQUFRLGFBQWEsTUFBTyxXQUFXLFlBQVksYUFBYSxNQUFNLEtBQUssRUFBRSxHQUFHLFFBQVEsS0FBSyxVQUFVLElBQUksRUFBRTtBQUFBLFlBQ3hILENBQUMsT0FBTyxXQUFXQSxTQUFRLGVBQWtCLFFBQVEsS0FBSyxDQUFDO0FBQUEsVUFDN0Q7QUFDQSxjQUFJLFFBQVEsVUFBVSxRQUFXO0FBQy9CLGtCQUFNLE9BQU8sSUFBSSxRQUFRLEtBQUs7QUFBQSxVQUNoQyxNQUFPLE9BQU0sT0FBTyxJQUFJO0FBQUEsUUFDMUIsQ0FBQztBQUFBLE1BQ0gsVUFBRTtBQUNBLGdCQUFRO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLGVBQWtCLFFBQWdCLE9BQTRFO0FBQzVILFFBQU0sT0FBTyxPQUFPLEtBQUs7QUFDekIsUUFBTSxRQUFRLEtBQUssUUFBUSxHQUFHO0FBQzlCLE1BQUksU0FBUyxHQUFHO0FBQ2QsUUFBSTtBQUNGLFlBQU0sU0FBUyxLQUFLLE1BQU0sS0FBSyxNQUFNLEtBQUssQ0FBQztBQUMzQyxVQUFJLE9BQU8sT0FBTyxLQUFNLFFBQU8sRUFBRSxJQUFJLE1BQU0sUUFBUSxPQUFPLE9BQVk7QUFDdEUsVUFBSSxPQUFPLE9BQU8sTUFBTyxRQUFPLEVBQUUsSUFBSSxPQUFPLE1BQU0sT0FBTyxPQUFPLFFBQVEsaUJBQWlCLFNBQVMsT0FBTyxPQUFPLFdBQVcsa0NBQWtDO0FBQUEsSUFDaEssUUFBUTtBQUFBLElBRVI7QUFBQSxFQUNGO0FBQ0EsTUFBSSxPQUFPLE9BQVEsUUFBTyxFQUFFLElBQUksT0FBTyxNQUFNLFdBQVcsU0FBUyx1Q0FBdUM7QUFDeEcsU0FBTyxFQUFFLElBQUksT0FBTyxNQUFNLGlCQUFpQixTQUFTLE9BQU8sV0FBVyxpQ0FBaUM7QUFDekc7OztBQy9HQSxJQUFNLHFCQUNKO0FBRUssU0FBUyxvQkFBb0IsTUFBbUIsT0FBbUM7QUFDeEYsUUFBTSxPQUFPLENBQUMsUUFBZ0IsV0FDNUIsTUFBTSxRQUFRLE1BQU0sSUFBSSxFQUFFLFdBQVcsTUFBTSxNQUFNLFVBQVUsUUFBUSxLQUFLLElBQUksRUFBRSxXQUFXLE9BQU8sTUFBTSxlQUFlLFFBQVEsVUFBVSw0QkFBNEIsTUFBTSxlQUFlO0FBQzFMLFFBQU0sTUFBTSxNQUNWLE1BQU0sTUFBTSxFQUFFLFdBQVcsTUFBTSxNQUFNLFVBQVUsUUFBUSxLQUFLLElBQUksRUFBRSxXQUFXLE9BQU8sTUFBTSxlQUFlLFFBQVEsOEJBQThCO0FBQ2pKLFFBQU0sY0FBYyxNQUNsQixDQUFDLE1BQU0sTUFDSCxFQUFFLFdBQVcsT0FBTyxNQUFNLGVBQWUsUUFBUSw4QkFBOEIsSUFDL0UsRUFBRSxXQUFXLE1BQU0sTUFBTSxlQUFlLFFBQVEsTUFBTSxtQkFBbUIsOERBQXlELG1CQUFtQjtBQUMzSixVQUFRLE1BQU07QUFBQSxJQUNaLEtBQUs7QUFDSCxhQUFPLEtBQUssZ0JBQWdCO0FBQUEsSUFDOUIsS0FBSztBQUNILGFBQU8sS0FBSyxlQUFlO0FBQUEsSUFDN0IsS0FBSztBQUNILGFBQU8sS0FBSyxjQUFjO0FBQUEsSUFDNUIsS0FBSztBQUNILGFBQU8sS0FBSyxjQUFjO0FBQUEsSUFDNUIsS0FBSztBQUNILGFBQU8sSUFBSTtBQUFBLElBQ2IsS0FBSztBQUNILGFBQU8sTUFBTSxPQUFPLE1BQU0sUUFBUSxlQUFlLElBQUksRUFBRSxXQUFXLE1BQU0sTUFBTSxVQUFVLFFBQVEsS0FBSyxJQUFJLEVBQUUsV0FBVyxPQUFPLE1BQU0sZUFBZSxRQUFRLHVEQUF1RDtBQUFBLElBQ25OLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPLFlBQVk7QUFBQSxJQUNyQixLQUFLO0FBQ0gsYUFBTyxNQUFNLE1BQU0sRUFBRSxXQUFXLE1BQU0sTUFBTSxVQUFVLFFBQVEsa0ZBQTZFLElBQUksSUFBSTtBQUFBLElBQ3JKLEtBQUs7QUFDSCxhQUFPLEtBQUssa0JBQWtCO0FBQUEsSUFDaEMsS0FBSztBQUNILGFBQU8sS0FBSyxnQkFBZ0I7QUFBQSxJQUM5QixLQUFLO0FBQ0gsYUFBTyxFQUFFLFdBQVcsTUFBTSxNQUFNLFVBQVUsUUFBUSxLQUFLO0FBQUEsSUFDekQsS0FBSztBQUNILGFBQU8sTUFBTSxRQUFRLG1CQUFtQixLQUFLLE1BQU0sTUFDL0MsRUFBRSxXQUFXLE1BQU0sTUFBTSxVQUFVLFFBQVEsS0FBSyxJQUNoRCxFQUFFLFdBQVcsT0FBTyxNQUFNLGVBQWUsUUFBUSw4REFBOEQ7QUFBQSxJQUNySCxLQUFLO0FBQ0gsYUFBTyxFQUFFLFdBQVcsT0FBTyxNQUFNLGVBQWUsUUFBUSw4SEFBeUg7QUFBQSxJQUNuTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTyxFQUFFLFdBQVcsTUFBTSxNQUFNLFVBQVUsUUFBUSxLQUFLO0FBQUEsRUFDM0Q7QUFDRjs7O0FDL0RBLFNBQVMsa0JBQWtCO0FBQzNCLFNBQVMsa0JBQWtCO0FBQzNCLFNBQVMsT0FBTyxpQkFBaUI7QUFDakMsU0FBUyxXQUFBQyxVQUFTLFlBQUFDLGlCQUFnQjtBQUNsQyxTQUFTLFFBQUFDLGFBQVk7QUFJZCxJQUFNLHVCQUF1QixLQUFLLE9BQU87QUFFaEQsSUFBTSxnQkFBZ0IsSUFBSSxLQUFLO0FBQy9CLElBQU0sc0JBQXNCO0FBQzVCLElBQU0sWUFBNEMsRUFBRSxhQUFhLE9BQU8sY0FBYyxPQUFPLGNBQWMsUUFBUSxhQUFhLE1BQU07QUFHL0gsU0FBUyxnQkFBZ0IsVUFBMEI7QUFDeEQsUUFBTSxPQUFPQyxTQUFRO0FBQ3JCLFFBQU0sVUFDSkMsVUFBUyxNQUFNLFdBQ1hDLE1BQUssTUFBTSxrQ0FBa0MsSUFDN0NELFVBQVMsTUFBTSxVQUNiQyxNQUFLLFFBQVEsSUFBSSxXQUFXQSxNQUFLLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxJQUNqRUEsTUFBSyxRQUFRLElBQUksbUJBQW1CQSxNQUFLLE1BQU0sU0FBUyxHQUFHLE1BQU07QUFDekUsU0FBTyxXQUFXLE9BQU8sSUFBSUEsTUFBSyxTQUFTLDJCQUEyQixJQUFJQSxNQUFLLFVBQVUsMkJBQTJCO0FBQ3RIO0FBR08sU0FBUyxVQUFVLE1BQXNCQyxRQUF3QjtBQUN0RSxVQUFRLE1BQU07QUFBQSxJQUNaLEtBQUs7QUFDSCxhQUFPQSxPQUFNLFNBQVMsR0FBRyxDQUFDLEVBQUUsT0FBTyxPQUFPLEtBQUssQ0FBQyxLQUFNLElBQU0sSUFBTSxJQUFNLElBQU0sSUFBTSxJQUFNLEVBQUksQ0FBQyxDQUFDO0FBQUEsSUFDbEcsS0FBSztBQUNILGFBQU9BLE9BQU0sQ0FBQyxNQUFNLE9BQVFBLE9BQU0sQ0FBQyxNQUFNLE9BQVFBLE9BQU0sQ0FBQyxNQUFNO0FBQUEsSUFDaEUsS0FBSztBQUNILGFBQU9BLE9BQU0sU0FBUyxHQUFHLENBQUMsRUFBRSxTQUFTLFFBQVEsTUFBTTtBQUFBLElBQ3JELEtBQUs7QUFDSCxhQUFPQSxPQUFNLFNBQVMsR0FBRyxDQUFDLEVBQUUsU0FBUyxRQUFRLE1BQU0sVUFBVUEsT0FBTSxTQUFTLEdBQUcsRUFBRSxFQUFFLFNBQVMsUUFBUSxNQUFNO0FBQUEsRUFDOUc7QUFDRjtBQUlPLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQUszQixZQUNtQixNQUNBLE1BQW9CLEtBQUssS0FDMUM7QUFGaUI7QUFDQTtBQUFBLEVBQ2hCO0FBQUEsRUFQSyxVQUFVLG9CQUFJLElBQW9CO0FBQUE7QUFBQSxFQUVsQyxRQUFRLG9CQUFJLElBQW9CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVd4QyxNQUFNLE9BQU8sVUFBa0IsTUFBc0IsT0FBZSxRQUFnQixNQUF3RjtBQUMxSyxTQUFLLE1BQU07QUFDWCxRQUFJLFNBQVMsS0FBSyxRQUFRLElBQUksUUFBUTtBQUN0QyxRQUFJLENBQUMsUUFBUTtBQUNYLFVBQUksV0FBVyxFQUFHLE9BQU0sVUFBVSxrQkFBa0IsOENBQThDO0FBQ2xHLFVBQUksS0FBSyxRQUFRLFFBQVEsb0JBQXFCLE9BQU0sVUFBVSxRQUFRLG9DQUFvQztBQUMxRyxlQUFTLEVBQUUsTUFBTSxRQUFRLENBQUMsR0FBRyxRQUFRLEdBQUcsV0FBVyxLQUFLLElBQUksRUFBRTtBQUM5RCxXQUFLLFFBQVEsSUFBSSxVQUFVLE1BQU07QUFBQSxJQUNuQztBQUNBLFFBQUksT0FBTyxTQUFTLEtBQU0sT0FBTSxVQUFVLGtCQUFrQiwyQ0FBMkM7QUFDdkcsUUFBSSxXQUFXLE9BQU8sUUFBUTtBQUM1QixhQUFPLE9BQU8sS0FBSyxLQUFLO0FBQ3hCLGFBQU8sVUFBVSxNQUFNO0FBQUEsSUFDekIsV0FBVyxTQUFTLE1BQU0sV0FBVyxPQUFPLFFBQVE7QUFDbEQsWUFBTSxVQUFVLGtCQUFrQiw0REFBNEQ7QUFBQSxJQUNoRztBQUNBLFFBQUksT0FBTyxTQUFTLE9BQU8sdUJBQXVCLEdBQUc7QUFDbkQsV0FBSyxRQUFRLE9BQU8sUUFBUTtBQUM1QixZQUFNLFVBQVUsYUFBYSx5QkFBeUIsdUJBQXVCLE9BQU8sSUFBSSxNQUFNO0FBQUEsSUFDaEc7QUFDQSxRQUFJLENBQUMsS0FBTSxRQUFPLEVBQUUsVUFBVSxPQUFPLE9BQU87QUFDNUMsU0FBSyxRQUFRLE9BQU8sUUFBUTtBQUM1QixVQUFNQSxTQUFRLE9BQU8sS0FBSyxPQUFPLE9BQU8sS0FBSyxFQUFFLEdBQUcsUUFBUTtBQUMxRCxRQUFJLENBQUNBLE9BQU0sVUFBVUEsT0FBTSxTQUFTLHFCQUFzQixPQUFNLFVBQVUsYUFBYSx5QkFBeUIsdUJBQXVCLE9BQU8sSUFBSSxNQUFNO0FBQ3hKLFFBQUksQ0FBQyxVQUFVLE1BQU1BLE1BQUssRUFBRyxPQUFNLFVBQVUsa0JBQWtCLGtEQUFrRDtBQUNqSCxVQUFNLGVBQWUsV0FBVztBQUNoQyxVQUFNLE1BQU1ELE1BQUssS0FBSyxNQUFNLFlBQVk7QUFDeEMsVUFBTSxNQUFNLEtBQUssRUFBRSxXQUFXLE1BQU0sTUFBTSxJQUFNLENBQUM7QUFDakQsVUFBTSxPQUFPQSxNQUFLLEtBQUssb0JBQW9CLEtBQUssSUFBSSxDQUFDLElBQUksVUFBVSxJQUFJLENBQUMsRUFBRTtBQUMxRSxVQUFNLFVBQVUsTUFBTUMsUUFBTyxFQUFFLE1BQU0sSUFBTSxDQUFDO0FBQzVDLFNBQUssTUFBTSxJQUFJLGNBQWMsSUFBSTtBQUNqQyxRQUFJLEtBQUssTUFBTSxPQUFPLElBQUssTUFBSyxNQUFNLE9BQU8sS0FBSyxNQUFNLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBTTtBQUM1RSxXQUFPLEVBQUUsY0FBYyxPQUFPQSxPQUFNLE9BQU87QUFBQSxFQUM3QztBQUFBO0FBQUEsRUFHQSxRQUFRLGNBQXFDO0FBQzNDLFdBQU8sS0FBSyxNQUFNLElBQUksWUFBWSxLQUFLO0FBQUEsRUFDekM7QUFBQSxFQUVRLFFBQWM7QUFDcEIsVUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyQixlQUFXLENBQUMsSUFBSSxNQUFNLEtBQUssS0FBSyxRQUFTLEtBQUksTUFBTSxPQUFPLFlBQVksY0FBZSxNQUFLLFFBQVEsT0FBTyxFQUFFO0FBQUEsRUFDN0c7QUFDRjtBQUdPLFNBQVMsV0FBVyxNQUFjLE9BQXFEO0FBRTVGLFNBQU8sVUFBVSxVQUFVLE9BQU8sS0FBSyxLQUFLLFFBQVEsTUFBTSxLQUFLLENBQUM7QUFDbEU7QUFFQSxTQUFTLFVBQVUsTUFBYyxTQUEyQztBQUMxRSxTQUFPLE9BQU8sT0FBTyxJQUFJLE1BQU0sT0FBTyxHQUFHLEVBQUUsS0FBSyxDQUFDO0FBQ25EOzs7QUM3R0EsU0FBUyxjQUFBQyxtQkFBa0I7OztBQ0ozQixTQUFTLFlBQUFDLGlCQUFnQjtBQWV6QixTQUFTLElBQUksS0FBYSxNQUFpQztBQUN6RCxTQUFPLElBQUksUUFBUSxDQUFDQyxVQUFTLFdBQVc7QUFDdEMsSUFBQUM7QUFBQSxNQUFTO0FBQUEsTUFBTyxDQUFDLE1BQU0sS0FBSyx1QkFBdUIsR0FBRyxJQUFJO0FBQUEsTUFBRyxFQUFFLFNBQVMsS0FBTSxXQUFXLElBQUksT0FBTyxNQUFNLEtBQUssRUFBRSxHQUFHLFFBQVEsS0FBSyxxQkFBcUIsS0FBSyxvQkFBb0IsSUFBSSxFQUFFO0FBQUEsTUFBRyxDQUFDLE9BQU8sV0FDOUwsUUFBUSxPQUFPLEtBQUssSUFBSUQsU0FBUSxNQUFNO0FBQUEsSUFDeEM7QUFBQSxFQUNGLENBQUM7QUFDSDtBQUVBLGVBQXNCLGdCQUFnQixNQUFzQztBQUMxRSxRQUFNLENBQUMsUUFBUSxNQUFNLFFBQVEsVUFBVSxLQUFLLFFBQVEsSUFBSSxNQUFNLFFBQVEsSUFBSTtBQUFBLElBQ3hFLElBQUksTUFBTSxDQUFDLGFBQWEsZ0JBQWdCLE1BQU0sQ0FBQyxFQUFFLE1BQU0sTUFBTSxFQUFFO0FBQUEsSUFDL0QsSUFBSSxNQUFNLENBQUMsYUFBYSxXQUFXLE1BQU0sQ0FBQyxFQUFFLE1BQU0sTUFBTSxFQUFFO0FBQUEsSUFDMUQsSUFBSSxNQUFNLENBQUMsVUFBVSxrQkFBa0IsT0FBTyxDQUFDLEVBQUUsTUFBTSxNQUFNLEVBQUU7QUFBQSxJQUMvRCxJQUFJLE1BQU0sQ0FBQyxRQUFRLFVBQVUsTUFBTSxDQUFDLEVBQUUsTUFBTSxNQUFNLEVBQUU7QUFBQSxJQUNwRCxJQUFJLE1BQU0sQ0FBQyxPQUFPLE1BQU0sTUFBTSxpQ0FBaUMsQ0FBQyxFQUFFLE1BQU0sTUFBTSxFQUFFO0FBQUEsSUFDaEYsSUFBSSxNQUFNLENBQUMsWUFBWSxnQkFBZ0IsV0FBVyxvQkFBb0IsQ0FBQyxFQUFFLE1BQU0sTUFBTSxFQUFFO0FBQUEsRUFDekYsQ0FBQztBQUNELFFBQU0sZUFBZSxPQUNsQixNQUFNLElBQUksRUFDVixPQUFPLE9BQU8sRUFDZCxNQUFNLEdBQUcsR0FBRyxFQUNaLElBQUksQ0FBQyxVQUFVLEVBQUUsUUFBUSxLQUFLLE1BQU0sR0FBRyxDQUFDLEVBQUUsS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLE1BQU0sQ0FBQyxFQUFFLEVBQUU7QUFDbEYsUUFBTSxZQUFZLGFBQWEsT0FBTyxDQUFDLFNBQVMsQ0FBQyxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sTUFBTSxJQUFJLEVBQUUsU0FBUyxLQUFLLE1BQU0sQ0FBQyxFQUFFLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSTtBQUN6SSxRQUFNLFVBQVUsSUFDYixNQUFNLElBQUksRUFDVixPQUFPLE9BQU8sRUFDZCxJQUFJLENBQUMsU0FBUztBQUNiLFVBQU0sQ0FBQyxNQUFNLFNBQVMsUUFBUSxFQUFFLElBQUksS0FBSyxNQUFNLEdBQU07QUFDckQsV0FBTyxFQUFFLE1BQU0sU0FBUyxPQUFPLFdBQVcsRUFBRSxHQUFHLFFBQVEsVUFBVSxJQUFJLElBQUksT0FBTyxFQUFFLElBQUksSUFBSztBQUFBLEVBQzdGLENBQUM7QUFDSCxRQUFNLENBQUMsT0FBTyxNQUFNLElBQUksU0FBUyxLQUFLLElBQUksU0FBUyxLQUFLLEVBQUUsTUFBTSxLQUFLLEVBQUUsSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLElBQUk7QUFDaEcsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLFFBQVEsT0FBTyxLQUFLLEtBQUs7QUFBQSxJQUN6QixNQUFNLEtBQUssS0FBSyxLQUFLO0FBQUEsSUFDckI7QUFBQSxJQUNBLFVBQVUsU0FBUyxTQUFTLEtBQUssR0FBRyxHQUFJO0FBQUEsSUFDeEM7QUFBQSxJQUNBO0FBQUEsSUFDQSxPQUFPLE9BQU8sU0FBUyxLQUFLLElBQUksUUFBUTtBQUFBLElBQ3hDLFFBQVEsT0FBTyxTQUFTLE1BQU0sSUFBSSxTQUFTO0FBQUEsRUFDN0M7QUFDRjs7O0FDakRPLFNBQVMsS0FBSyxNQUFjLE9BQXVCO0FBQ3hELFNBQU8sS0FBSyxJQUFJLElBQUksS0FBSztBQUMzQjtBQUVPLFNBQVMsZ0JBQWdCLFNBQXlCLE9BQW1DO0FBQzFGLFFBQU0sSUFBSSxRQUFRO0FBQ2xCLFFBQU0sUUFBUSxPQUFPLEVBQUUsVUFBVSxXQUFXLEVBQUUsUUFBUTtBQUN0RCxNQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sS0FBSyxLQUFLLEVBQUcsUUFBTztBQUN6QyxRQUFNLElBQUksQ0FBQyxRQUFpQixPQUFPLEVBQUUsR0FBRyxNQUFNLFdBQVksRUFBRSxHQUFHLElBQWU7QUFDOUUsVUFBUSxRQUFRLE1BQU07QUFBQSxJQUNwQixLQUFLLGVBQWU7QUFDbEIsWUFBTSxPQUFPLENBQUMsaUJBQWlCLGVBQWUsS0FBSyxPQUFPLEtBQUssR0FBRyxLQUFLLGNBQWMsRUFBRSxPQUFPLEtBQUssTUFBTSxHQUFHLEtBQUssUUFBUSxFQUFFLE1BQU0sS0FBSyxFQUFFLENBQUM7QUFDekksWUFBTSxPQUFPLE1BQU0sUUFBUSxFQUFFLElBQUksSUFBSyxFQUFFLE9BQW9CLENBQUM7QUFDN0QsVUFBSSxLQUFLLE9BQVEsTUFBSyxLQUFLLEtBQUssUUFBUSxLQUFLLFVBQVUsSUFBSSxDQUFDLENBQUM7QUFDN0QsVUFBSSxFQUFFLFVBQVUsRUFBRyxNQUFLLEtBQUssS0FBSyxVQUFVLEVBQUUsVUFBVSxDQUFFLENBQUM7QUFDM0QsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLEtBQUssZUFBZTtBQUNsQixZQUFNLFNBQVMsRUFBRSxRQUFRO0FBQ3pCLFVBQUksQ0FBQyxVQUFVLE1BQU0sTUFBTSxNQUFNLEdBQUcsVUFBVSxNQUFPLFFBQU87QUFDNUQsWUFBTSxPQUFPLENBQUMsaUJBQWlCLGVBQWUsS0FBSyxPQUFPLEtBQUssR0FBRyxLQUFLLE1BQU0sTUFBTSxHQUFHLEtBQUssVUFBVSxFQUFFLFFBQVEsS0FBSyxTQUFTLENBQUM7QUFDOUgsVUFBSSxFQUFFLFFBQVEsRUFBRyxNQUFLLEtBQUssS0FBSyxVQUFVLEVBQUUsUUFBUSxDQUFFLENBQUM7QUFDdkQsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLEtBQUs7QUFBQSxJQUNMLEtBQUssaUJBQWlCO0FBQ3BCLFlBQU0sU0FBUyxFQUFFLFFBQVE7QUFDekIsWUFBTSxPQUFPLFNBQVMsTUFBTSxNQUFNLE1BQU0sSUFBSTtBQUM1QyxVQUFJLENBQUMsUUFBUSxLQUFLLFVBQVUsTUFBTyxRQUFPO0FBQzFDLFlBQU0sT0FBTyxDQUFDLGlCQUFpQixnQkFBZ0IsS0FBSyxPQUFPLEtBQUssR0FBRyxLQUFLLFFBQVEsS0FBSyxFQUFFLENBQUM7QUFDeEYsVUFBSSxRQUFRLFNBQVMsY0FBYztBQUNqQyxjQUFNLE9BQU8sS0FBSyxZQUFZLEtBQUssWUFBWSxTQUFTLENBQUM7QUFDekQsWUFBSSxLQUFNLE1BQUssS0FBSyxLQUFLLFlBQVksSUFBSSxDQUFDO0FBQUEsTUFDNUM7QUFDQSxVQUFJLEVBQUUsT0FBTyxFQUFHLE1BQUssS0FBSyxLQUFLLFNBQVMsRUFBRSxPQUFPLENBQUUsQ0FBQztBQUNwRCxVQUFJLEVBQUUsT0FBTyxFQUFHLE1BQUssS0FBSyxLQUFLLFNBQVMsRUFBRSxPQUFPLENBQUUsQ0FBQztBQUNwRCxVQUFJLEVBQUUsT0FBTyxLQUFLLEVBQUUsUUFBUSxFQUFHLE1BQUssS0FBSyxLQUFLLFVBQVUsRUFBRSxRQUFRLENBQUUsQ0FBQztBQUNyRSxXQUFLLEtBQUssS0FBSyxZQUFZLEVBQUUsVUFBVSxLQUFLLFdBQVcsQ0FBQztBQUN4RCxhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0EsS0FBSyxnQkFBZ0I7QUFDbkIsWUFBTSxTQUFTLEVBQUUsUUFBUTtBQUN6QixVQUFJLENBQUMsT0FBUSxRQUFPO0FBRXBCLFlBQU0sU0FBUyxNQUFNLE1BQU0sTUFBTSxHQUFHO0FBQ3BDLFVBQUksQ0FBQyxVQUFVLE1BQU0sTUFBTSxNQUFNLEdBQUcsVUFBVSxNQUFPLFFBQU87QUFDNUQsYUFBTyxDQUFDLGlCQUFpQixnQkFBZ0IsS0FBSyxNQUFNLE1BQU0sR0FBRyxLQUFLLGNBQWMsRUFBRSxZQUFZLEtBQUssRUFBRSxDQUFDO0FBQUEsSUFDeEc7QUFBQSxJQUNBLEtBQUs7QUFDSCxhQUFPO0FBQUEsUUFDTDtBQUFBLFFBQWlCO0FBQUEsUUFBUSxLQUFLLE9BQU8sS0FBSztBQUFBLFFBQUcsS0FBSyxNQUFNLEVBQUUsSUFBSSxLQUFLLE9BQU8sS0FBSyxFQUFFO0FBQUEsUUFDakYsS0FBSyxXQUFXLEVBQUUsU0FBUyxLQUFLLEVBQUU7QUFBQSxRQUFHLEtBQUssUUFBUSxFQUFFLE1BQU0sS0FBSyxFQUFFO0FBQUEsUUFBRyxLQUFLLFFBQVEsUUFBUTtBQUFBLE1BQzNGO0FBQUEsSUFDRjtBQUNFLGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFHTyxTQUFTLFdBQVcsS0FBcUI7QUFDOUMsU0FBTywyQkFBMkIsS0FBSyxHQUFHLElBQUksTUFBTSxJQUFJLElBQUksUUFBUSxNQUFNLE9BQU8sQ0FBQztBQUNwRjs7O0FDakRBLElBQU0sYUFBYTtBQUNuQixJQUFNLFlBQVk7QUFDbEIsSUFBTSxnQkFBZ0I7QUFDdEIsSUFBTSxhQUFhO0FBQ25CLElBQU0sYUFBYTtBQWFuQixlQUFzQixpQkFBaUIsS0FBZ0IsWUFBaUQ7QUFDdEcsUUFBTSxXQUFrQyxDQUFDO0FBQ3pDLE1BQUksU0FBd0I7QUFDNUIsTUFBSSxRQUF3QjtBQUM1QixNQUFJLFlBQVk7QUFDaEIsV0FBUyxPQUFPLEdBQUcsT0FBTyxXQUFXLFFBQVE7QUFDM0MsVUFBTSxPQUFPLENBQUMsaUJBQWlCLGVBQWUsY0FBYyxZQUFZLFdBQVcsT0FBTyxVQUFVLEdBQUcsUUFBUTtBQUMvRyxRQUFJLE9BQVEsTUFBSyxLQUFLLFlBQVksTUFBTTtBQUN4QyxVQUFNLFNBQVMsTUFBTSxJQUFJLElBQWEsTUFBTSxFQUFFLFdBQVcsSUFBTSxDQUFDO0FBQ2hFLFFBQUksQ0FBQyxPQUFPLElBQUk7QUFDZCxVQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CO0FBQUEsSUFDRjtBQUNBLGNBQVUsT0FBTztBQUNqQixVQUFNLGFBQWEsT0FBTyxPQUFPO0FBQ2pDLFFBQUksQ0FBQyxZQUFZLFNBQVU7QUFDM0IsZUFBVyxPQUFPLFdBQVcsVUFBVTtBQUNyQyxZQUFNLFVBQVUsaUJBQWlCLEdBQUc7QUFDcEMsVUFBSSxRQUFTLFVBQVMsS0FBSyxPQUFPO0FBQUEsSUFDcEM7QUFDQSxRQUFJLFNBQVMsU0FBUyxlQUFlO0FBQ25DLGVBQVMsT0FBTyxHQUFHLFNBQVMsU0FBUyxhQUFhO0FBQ2xELGtCQUFZO0FBQUEsSUFDZDtBQUNBLGFBQVMsV0FBVyxjQUFjO0FBQ2xDLFFBQUksQ0FBQyxPQUFRO0FBQ2IsUUFBSSxTQUFTLFlBQVksRUFBRyxhQUFZO0FBQUEsRUFDMUM7QUFDQSxNQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLE1BQUksTUFBTSxXQUFZLFFBQU8sRUFBRSxNQUFNLGdCQUFnQixRQUFRLE1BQU0sVUFBVSxjQUFjLFVBQVUsTUFBTSxZQUFZLE1BQU0sVUFBVSxVQUFVO0FBQ2pKLFNBQU8sRUFBRSxNQUFNLFNBQVMsUUFBUSxNQUFNLFVBQVUsWUFBWSxPQUFPLGFBQWEsS0FBSyxHQUFHLFdBQVcsTUFBTTtBQUMzRztBQUVPLFNBQVMsaUJBQWlCLEtBQTBDO0FBQ3pFLE1BQUksQ0FBQyxPQUFPLE9BQU8sUUFBUSxTQUFVLFFBQU87QUFDNUMsUUFBTSxJQUFJO0FBQ1YsUUFBTSxTQUE4QixDQUFDO0FBQ3JDLFFBQU0sWUFBWSxNQUFNLFFBQVEsRUFBRSxNQUFNLElBQUksRUFBRSxTQUFTLE9BQU8sRUFBRSxTQUFTLFdBQVcsQ0FBQyxFQUFFLE1BQU0sUUFBUSxNQUFNLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQztBQUN4SCxhQUFXLEtBQUssV0FBd0M7QUFDdEQsVUFBTSxPQUFPLE9BQU8sR0FBRyxRQUFRLEVBQUU7QUFDakMsUUFBSSxTQUFTLFVBQVUsT0FBTyxFQUFFLFNBQVMsU0FBVSxRQUFPLEtBQUssRUFBRSxNQUFNLFFBQVEsTUFBTSxNQUFNLEVBQUUsTUFBTSxVQUFVLEVBQUUsQ0FBQztBQUFBLGNBQ3RHLFNBQVMsY0FBYyxTQUFTLGdCQUFnQixPQUFPLEVBQUUsU0FBUyxTQUFVLFFBQU8sS0FBSyxFQUFFLE1BQU0sWUFBWSxNQUFNLE1BQU0sRUFBRSxNQUFNLFVBQVUsRUFBRSxDQUFDO0FBQUEsYUFDOUksU0FBUyxZQUFhLFFBQU8sS0FBSyxFQUFFLE1BQU0sYUFBYSxNQUFNLE9BQU8sRUFBRSxRQUFRLE1BQU0sR0FBRyxPQUFPLE1BQU0sT0FBTyxFQUFFLFVBQVUsV0FBVyxFQUFFLFFBQVEsS0FBSyxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUMsR0FBRyxVQUFVLEVBQUUsQ0FBQztBQUFBLGFBQ3hMLFNBQVMsY0FBZSxRQUFPLEtBQUssRUFBRSxNQUFNLGVBQWUsUUFBUSxNQUFNLE9BQU8sRUFBRSxXQUFXLFdBQVcsRUFBRSxTQUFTLEtBQUssVUFBVSxFQUFFLFVBQVUsRUFBRSxHQUFHLFVBQVUsR0FBRyxTQUFTLEVBQUUsWUFBWSxRQUFRLEVBQUUsYUFBYSxLQUFLLENBQUM7QUFBQSxFQUMvTjtBQUNBLE1BQUksQ0FBQyxPQUFPLE9BQVEsUUFBTztBQUMzQixTQUFPLEVBQUUsSUFBSSxPQUFPLEVBQUUsTUFBTSxLQUFLLE9BQU8sQ0FBQyxHQUFHLE1BQU0sT0FBTyxFQUFFLFFBQVEsV0FBVyxHQUFHLElBQUksT0FBTyxFQUFFLGNBQWMsV0FBVyxFQUFFLFlBQVksTUFBTSxPQUFPO0FBQ3BKO0FBRU8sU0FBUyxhQUFhLFFBQTJCO0FBQ3RELFFBQU0sT0FBUSxNQUFNLFFBQVEsT0FBTyxJQUFJLElBQUksT0FBTyxPQUFPLE1BQU0sUUFBUSxPQUFPLEtBQUssSUFBSSxPQUFPLFFBQVEsQ0FBQztBQUN2RyxRQUFNLFFBQWtCLENBQUM7QUFDekIsYUFBVyxPQUFPLE1BQU07QUFDdEIsUUFBSSxPQUFPLFFBQVEsU0FBVSxPQUFNLEtBQUssR0FBRztBQUFBLGFBQ2xDLE9BQU8sT0FBTyxRQUFRLFVBQVU7QUFDdkMsWUFBTSxJQUFJO0FBQ1YsWUFBTSxPQUFPLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUU7QUFDaEQsWUFBTSxLQUFLLE9BQU8sU0FBUyxXQUFXLE9BQU8sS0FBSyxVQUFVLEdBQUcsQ0FBQztBQUFBLElBQ2xFO0FBQUEsRUFDRjtBQUNBLE1BQUksQ0FBQyxNQUFNLFVBQVUsT0FBTyxPQUFPLFNBQVMsU0FBVSxPQUFNLEtBQUssR0FBRyxPQUFPLEtBQUssTUFBTSxJQUFJLENBQUM7QUFDM0YsU0FBTyxNQUFNLE1BQU0sSUFBSyxFQUFFLElBQUksQ0FBQyxTQUFTLE1BQU0sTUFBTSxVQUFVLENBQUM7QUFDakU7QUFFQSxTQUFTLE1BQU0sTUFBYyxLQUFxQjtBQUNoRCxTQUFPLE9BQU8sVUFBVSxTQUFTLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDOUM7OztBQ3RHQSxTQUFTLFlBQVksY0FBQUUsbUJBQWtCOzs7QUNLdkMsU0FBUyx3QkFBd0I7QUFDakMsU0FBUyxjQUFBQyxtQkFBa0I7QUFDM0IsU0FBUyxZQUFBQyxXQUFVLFFBQUFDLGFBQVk7QUFDL0IsU0FBUyxXQUFBQyxVQUFTLFlBQUFDLGlCQUFnQjtBQUNsQyxTQUFTLFFBQUFDLGFBQVk7QUFFckIsSUFBTSxVQUFVLG9CQUFJLElBQUksQ0FBQyx3QkFBd0IsbUJBQW1CLENBQUM7QUFDckUsSUFBTSxxQkFBcUIsSUFBSSxPQUFPO0FBQ3RDLElBQU0sZ0JBQWdCO0FBRWYsSUFBTSxrQkFBTixjQUE4QixNQUFNO0FBQUEsRUFDekMsWUFDVyxNQUNULFNBQ0E7QUFDQSxVQUFNLE9BQU87QUFISjtBQUFBLEVBSVg7QUFDRjtBQUlPLFNBQVMsa0JBQTBCO0FBQ3hDLFFBQU0sT0FBT0YsU0FBUTtBQUNyQixNQUFJLFFBQVEsSUFBSSxvQkFBcUIsUUFBTyxRQUFRLElBQUk7QUFDeEQsTUFBSUMsVUFBUyxNQUFNLFNBQVUsUUFBT0MsTUFBSyxNQUFNLGtDQUFrQztBQUNqRixNQUFJRCxVQUFTLE1BQU0sUUFBUyxRQUFPQyxNQUFLLFFBQVEsSUFBSSxXQUFXQSxNQUFLLE1BQU0saUJBQWlCLEdBQUcsTUFBTTtBQUNwRyxTQUFPQSxNQUFLLFFBQVEsSUFBSSxtQkFBbUJBLE1BQUssTUFBTSxTQUFTLEdBQUcsTUFBTTtBQUMxRTtBQUVBLGVBQWUsYUFBYSxLQUFnQztBQUMxRCxRQUFNLE9BQU9BLE1BQUssS0FBSyxhQUFhO0FBQ3BDLE1BQUk7QUFFRixVQUFNLE9BQU8sTUFBTUgsTUFBSyxJQUFJO0FBQzVCLFFBQUlFLFVBQVMsTUFBTSxXQUFXLE9BQU8sUUFBUSxXQUFXLGNBQWMsS0FBSyxRQUFRLFFBQVEsT0FBTyxFQUFHLE9BQU0sSUFBSSxnQkFBZ0IscUJBQXFCLGtEQUFrRDtBQUN0TSxVQUFNLFNBQVMsS0FBSyxNQUFNLE1BQU1ILFVBQVMsTUFBTSxNQUFNLENBQUM7QUFDdEQsUUFBSSxDQUFDLE9BQU8sYUFBYSxDQUFDLE1BQU0sUUFBUSxPQUFPLFVBQVUsRUFBRyxPQUFNLElBQUksZ0JBQWdCLHVCQUF1QixzQ0FBc0M7QUFDbkosV0FBTztBQUFBLEVBQ1QsU0FBUyxPQUFPO0FBQ2QsUUFBSSxpQkFBaUIsZ0JBQWlCLE9BQU07QUFDNUMsVUFBTSxJQUFJLGdCQUFnQix1QkFBdUIsd0RBQXdEO0FBQUEsRUFDM0c7QUFDRjtBQUVBLGVBQXNCLGdCQUFtQixRQUFnQixRQUFpQixVQUF3RCxDQUFDLEdBQWU7QUFDaEosTUFBSSxDQUFDLFFBQVEsSUFBSSxNQUFNLEVBQUcsT0FBTSxJQUFJLGdCQUFnQixpQkFBaUIsNEJBQTRCLE1BQU0sR0FBRztBQUMxRyxRQUFNLFdBQVcsTUFBTSxhQUFhLFFBQVEsZUFBZSxnQkFBZ0IsQ0FBQztBQUM1RSxRQUFNLFlBQVksU0FBUyxXQUFXLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxVQUFVLEVBQUUsU0FBUyxZQUFZO0FBQzlGLE1BQUksQ0FBQyxVQUFXLE9BQU0sSUFBSSxnQkFBZ0IsdUJBQXVCLHVDQUF1QztBQUN4RyxRQUFNLEtBQUtELFlBQVc7QUFDdEIsU0FBTyxNQUFNLElBQUksUUFBVyxDQUFDTSxVQUFTLFdBQVc7QUFDL0MsVUFBTSxTQUFTLGlCQUFpQixVQUFVLFFBQVE7QUFDbEQsUUFBSSxTQUFTO0FBQ2IsUUFBSSxPQUFPO0FBQ1gsUUFBSSxPQUFPO0FBQ1gsVUFBTSxTQUFTLENBQUMsT0FBbUI7QUFDakMsVUFBSSxLQUFNO0FBQ1YsYUFBTztBQUNQLG1CQUFhLEtBQUs7QUFDbEIsYUFBTyxRQUFRO0FBQ2YsU0FBRztBQUFBLElBQ0w7QUFDQSxVQUFNLFFBQVEsV0FBVyxNQUFNLE9BQU8sTUFBTSxPQUFPLElBQUksZ0JBQWdCLFdBQVcsOEJBQThCLENBQUMsQ0FBQyxHQUFHLFFBQVEsYUFBYSxJQUFLO0FBQy9JLFdBQU8sR0FBRyxTQUFTLE1BQU0sT0FBTyxNQUFNLE9BQU8sSUFBSSxnQkFBZ0IsdUJBQXVCLHNDQUFpQyxDQUFDLENBQUMsQ0FBQztBQUM1SCxXQUFPLEdBQUcsUUFBUSxDQUFDLFVBQWtCO0FBQ25DLGNBQVEsTUFBTTtBQUNkLFVBQUksT0FBTyxtQkFBb0IsUUFBTyxPQUFPLE1BQU0sT0FBTyxJQUFJLGdCQUFnQixhQUFhLG1DQUE4QixDQUFDLENBQUM7QUFDM0gsZ0JBQVUsTUFBTSxTQUFTLE1BQU07QUFDL0IsVUFBSTtBQUNKLGNBQVEsUUFBUSxPQUFPLFFBQVEsSUFBSSxNQUFNLEdBQUc7QUFDMUMsY0FBTSxPQUFPLE9BQU8sTUFBTSxHQUFHLEtBQUs7QUFDbEMsaUJBQVMsT0FBTyxNQUFNLFFBQVEsQ0FBQztBQUMvQixZQUFJLENBQUMsS0FBSyxLQUFLLEVBQUc7QUFDbEIsWUFBSTtBQUNKLFlBQUk7QUFDRixrQkFBUSxLQUFLLE1BQU0sSUFBSTtBQUFBLFFBQ3pCLFFBQVE7QUFDTixpQkFBTyxPQUFPLE1BQU0sT0FBTyxJQUFJLGdCQUFnQixvQkFBb0IsaUNBQWlDLENBQUMsQ0FBQztBQUFBLFFBQ3hHO0FBQ0EsWUFBSSxNQUFNLGVBQWUsUUFBVztBQUNsQyxnQkFBTSxRQUFRO0FBQ2Q7QUFBQSxRQUNGO0FBQ0EsWUFBSSxNQUFNLE9BQU8sR0FBSSxRQUFPLE9BQU8sTUFBTSxPQUFPLElBQUksZ0JBQWdCLG9CQUFvQixvQ0FBb0MsQ0FBQyxDQUFDO0FBQzlILFlBQUksTUFBTSxHQUFJLFFBQU8sT0FBTyxNQUFNQSxTQUFRLE1BQU0sTUFBVyxDQUFDO0FBQzVELGVBQU8sT0FBTyxNQUFNLE9BQU8sSUFBSSxnQkFBZ0IsTUFBTSxPQUFPLFFBQVEsaUJBQWlCLE1BQU0sT0FBTyxXQUFXLDJCQUEyQixDQUFDLENBQUM7QUFBQSxNQUM1STtBQUFBLElBQ0YsQ0FBQztBQUNELFdBQU8sTUFBTSxLQUFLLFVBQVUsRUFBRSxJQUFJLFdBQVcsU0FBUyxXQUFXLFFBQVEsT0FBTyxDQUFDLElBQUksSUFBSTtBQUFBLEVBQzNGLENBQUM7QUFDSDs7O0FENUZBLElBQU0sb0JBQW9CO0FBR25CLFNBQVMseUJBQXlCLFNBQW1EO0FBQzFGLE1BQUksQ0FBQyxTQUFTLFdBQVcsaUJBQWlCLEVBQUcsUUFBTztBQUNwRCxRQUFNLEtBQUssUUFBUSxNQUFNLGtCQUFrQixNQUFNLEVBQUUsTUFBTSxHQUFHLEVBQUUsQ0FBQztBQUMvRCxTQUFPLHlCQUF5QixLQUFLLEVBQUUsSUFBSSxLQUFLO0FBQ2xEO0FBR08sU0FBUyxhQUFhLE9BQXdCO0FBQ25ELE1BQUksVUFBVSxRQUFRLE9BQU8sVUFBVSxTQUFVLFFBQU8sS0FBSyxVQUFVLFNBQVMsSUFBSTtBQUNwRixNQUFJLE1BQU0sUUFBUSxLQUFLLEVBQUcsUUFBTyxJQUFJLE1BQU0sSUFBSSxZQUFZLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFDdEUsUUFBTSxVQUFVLE9BQU8sUUFBUSxLQUFnQyxFQUM1RCxPQUFPLENBQUMsQ0FBQyxFQUFFLEtBQUssTUFBTSxVQUFVLE1BQVMsRUFDekMsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFPLElBQUksSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJLENBQUU7QUFDbEQsU0FBTyxJQUFJLFFBQVEsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLE1BQU0sR0FBRyxLQUFLLFVBQVUsR0FBRyxDQUFDLElBQUksYUFBYSxLQUFLLENBQUMsRUFBRSxFQUFFLEtBQUssR0FBRyxDQUFDO0FBQ3JHO0FBRU8sU0FBUyxtQkFBbUIsUUFBZ0IsV0FBbUIsUUFBeUM7QUFDN0csU0FBTyxXQUFXLFFBQVEsRUFBRSxPQUFPLGFBQWEsRUFBRSxRQUFRLFdBQVcsT0FBTyxDQUFDLEdBQUcsTUFBTSxFQUFFLE9BQU8sS0FBSztBQUN0RztBQUVPLFNBQVMsWUFBWSxNQUFNLEtBQUssSUFBSSxHQUFXO0FBQ3BELFNBQU8sR0FBRyxLQUFLLE1BQU0sR0FBRyxDQUFDLElBQUlDLFlBQVcsRUFBRSxXQUFXLEtBQUssRUFBRSxFQUFFLFlBQVksQ0FBQztBQUM3RTtBQUlBLGVBQXNCLGdCQUFnQixXQUFtQixNQUEyQztBQUNsRyxRQUFNLFVBQVUsTUFBTSxnQkFBNkIsd0JBQXdCLEVBQUUsV0FBVyxXQUFXLFFBQVEsT0FBTyxFQUFFLENBQUM7QUFDckgsUUFBTSxRQUFRLFFBQVEsTUFBTTtBQUM1QixNQUFJLE9BQU8sVUFBVSxTQUFVLE9BQU0sSUFBSSxNQUFNLHFEQUFnRDtBQUUvRixRQUFNLFNBQVMsRUFBRSxNQUFNLEVBQUUsTUFBTSxXQUFXLE1BQU0sUUFBUSxRQUFRLENBQUMsRUFBRSxNQUFNLFFBQVEsS0FBSyxDQUFDLEVBQUUsR0FBRyxVQUFVLGtCQUEyQjtBQUNqSSxRQUFNLGdCQUFnQixxQkFBcUI7QUFBQSxJQUN6QyxVQUFVLEVBQUUsV0FBVyxtQkFBbUIsWUFBWSxHQUFHLHNCQUFzQixPQUFPLG9CQUFvQixtQkFBbUIscUJBQXFCLFdBQVcsTUFBTSxFQUFFO0FBQUEsSUFDckssR0FBRztBQUFBLEVBQ0wsQ0FBQztBQUNELFNBQU8sRUFBRSxVQUFVLEtBQUs7QUFDMUI7OztBRTNDQSxTQUFTLFFBQUFDLE9BQU0sUUFBQUMsYUFBWTtBQUszQixJQUFNLGVBQWUsQ0FBQyxJQUFJLE9BQU8sTUFBTSxLQUFLLE9BQU8sTUFBTSxLQUFLLE9BQU8sSUFBSTtBQUN6RSxJQUFNLG1CQUFtQixLQUFLLE9BQU87QUFDckMsSUFBTUMsaUJBQWdCO0FBQ3RCLElBQU1DLGNBQWE7QUFDbkIsSUFBTUMsY0FBYTtBQUluQixJQUFNLFFBQVEsb0JBQUksSUFBa0I7QUFDcEMsSUFBTSxZQUFZO0FBRWxCLFNBQVMsU0FBUyxNQUFjQyxPQUF5QjtBQUN2RCxRQUFNLE9BQU8sSUFBSTtBQUNqQixRQUFNLElBQUksTUFBTUEsS0FBSTtBQUNwQixNQUFJLE1BQU0sT0FBTyxVQUFXLE9BQU0sT0FBTyxNQUFNLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBZTtBQUM1RSxTQUFPQSxNQUFLO0FBQ2Q7QUFFQSxTQUFTLGFBQWEsVUFBaUMsV0FBaUM7QUFDdEYsU0FBTyxFQUFFLE1BQU0sZ0JBQWdCLFFBQVEscUJBQXFCLFVBQVUsVUFBVSxVQUFVLFVBQVU7QUFDdEc7QUFlQSxlQUFzQixxQkFBcUIsTUFBYyxVQUFpQyxDQUFDLEdBQWdDO0FBQ3pILE1BQUk7QUFDSixNQUFJO0FBQ0YsV0FBTyxNQUFNQyxNQUFLLElBQUk7QUFBQSxFQUN4QixRQUFRO0FBQ04sVUFBTSxPQUFPLElBQUk7QUFDakIsV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLEVBQUUsTUFBTSxRQUFRLElBQUk7QUFDMUIsTUFBSSxDQUFDLFFBQVEsVUFBVTtBQUNyQixVQUFNQyxRQUFPLE1BQU0sSUFBSSxJQUFJO0FBQzNCLFFBQUlBLFNBQVFBLE1BQUssU0FBUyxRQUFRQSxNQUFLLFlBQVksUUFBUyxRQUFPQSxNQUFLO0FBQ3hFLFFBQUlBLFNBQVEsT0FBT0EsTUFBSyxRQUFRLFFBQVFBLE1BQUssS0FBSztBQUNoRCxZQUFNQyxRQUFPLE1BQU0sYUFBYSxNQUFNRCxNQUFLLEtBQUssTUFBTSxLQUFLO0FBQzNELFVBQUksQ0FBQ0MsTUFBSyxTQUFTLE9BQVEsUUFBTyxTQUFTLE1BQU0sRUFBRSxHQUFHRCxPQUFNLE1BQU0sU0FBUyxLQUFLQyxNQUFLLElBQUksQ0FBQztBQUMxRixZQUFNLE1BQU0sQ0FBQyxHQUFHRCxNQUFLLFVBQVUsR0FBR0MsTUFBSyxRQUFRO0FBQy9DLFlBQU0sV0FBVyxJQUFJLE1BQU0sQ0FBQ0MsY0FBYTtBQUN6QyxZQUFNLFlBQVlGLE1BQUssYUFBYSxJQUFJLFNBQVMsU0FBUztBQUMxRCxhQUFPLFNBQVMsTUFBTSxFQUFFLE1BQU0sU0FBUyxLQUFLQyxNQUFLLEtBQUssVUFBVSxXQUFXLFFBQVEsYUFBYSxVQUFVLFNBQVMsRUFBRSxDQUFDO0FBQUEsSUFDeEg7QUFBQSxFQUNGO0FBQ0EsYUFBVyxVQUFVLGNBQWM7QUFDakMsVUFBTSxRQUFRLEtBQUssSUFBSSxHQUFHLE9BQU8sTUFBTTtBQUN2QyxVQUFNQSxRQUFPLE1BQU0sYUFBYSxNQUFNLE9BQU8sTUFBTSxRQUFRLENBQUM7QUFDNUQsVUFBTSxXQUFXQSxNQUFLO0FBQ3RCLFFBQUksTUFBTSxTQUFTO0FBQ25CLFFBQUksUUFBUSxVQUFVO0FBQ3BCLFlBQU0sU0FBUyxVQUFVLENBQUMsTUFBTSxFQUFFLE9BQU8sUUFBUSxRQUFRO0FBRXpELFVBQUksTUFBTSxHQUFHO0FBQ1gsWUFBSSxVQUFVLEVBQUcsUUFBTyxhQUFhLENBQUMsR0FBRyxLQUFLO0FBQzlDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTUMsY0FBYTtBQUU1QyxRQUFJLFNBQVMsS0FBSyxRQUFRLEtBQUssTUFBTUEsa0JBQWlCLFdBQVcsYUFBYSxhQUFhLFNBQVMsQ0FBQyxFQUFHO0FBQ3hHLFVBQU0sT0FBTyxTQUFTLE1BQU0sTUFBTSxHQUFHO0FBQ3JDLFVBQU0sWUFBWSxPQUFPLEtBQUssUUFBUTtBQUN0QyxRQUFJLFFBQVEsU0FBVSxRQUFPLGFBQWEsTUFBTSxTQUFTO0FBQ3pELFdBQU8sU0FBUyxNQUFNLEVBQUUsTUFBTSxTQUFTLEtBQUtELE1BQUssS0FBSyxVQUFVLE1BQU0sV0FBVyxRQUFRLGFBQWEsTUFBTSxTQUFTLEVBQUUsQ0FBQztBQUFBLEVBQzFIO0FBQ0EsU0FBTztBQUNUO0FBTUEsZUFBZSxhQUFhLE1BQWMsT0FBZSxNQUFjLGNBQWtGO0FBQ3ZKLFFBQU0sU0FBUyxNQUFNRSxNQUFLLE1BQU0sR0FBRztBQUNuQyxRQUFNLFNBQVMsT0FBTyxNQUFNLE9BQU8sS0FBSztBQUN4QyxNQUFJO0FBQ0YsVUFBTSxPQUFPLEtBQUssUUFBUSxHQUFHLE9BQU8sUUFBUSxLQUFLO0FBQUEsRUFDbkQsVUFBRTtBQUNBLFVBQU0sT0FBTyxNQUFNO0FBQUEsRUFDckI7QUFDQSxRQUFNLGNBQWMsT0FBTyxZQUFZLEVBQUk7QUFDM0MsUUFBTSxRQUFRLE9BQU8sU0FBUyxRQUFRLEdBQUcsY0FBYyxDQUFDLEVBQUUsTUFBTSxJQUFJO0FBQ3BFLE1BQUksYUFBYyxPQUFNLE1BQU07QUFDOUIsUUFBTSxXQUFrQyxDQUFDO0FBQ3pDLFFBQU0sT0FBTyxDQUFDLFNBQTBCO0FBQ3RDLFFBQUksQ0FBQyxLQUFLLEtBQUssRUFBRyxRQUFPO0FBQ3pCLFFBQUk7QUFDRixZQUFNLFVBQVUsVUFBVSxLQUFLLE1BQU0sSUFBSSxDQUE0QjtBQUNyRSxVQUFJLFFBQVMsVUFBUyxLQUFLLE9BQU87QUFDbEMsYUFBTztBQUFBLElBQ1QsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLGFBQVcsUUFBUSxNQUFPLE1BQUssSUFBSTtBQUNuQyxNQUFJLE1BQU0sUUFBUSxjQUFjO0FBRWhDLFFBQU0sT0FBTyxPQUFPLFNBQVMsUUFBUSxjQUFjLENBQUM7QUFDcEQsTUFBSSxLQUFLLEtBQUssS0FBSyxFQUFFLGdCQUFnQixjQUFjLE1BQU0sS0FBSyxJQUFJLEVBQUcsT0FBTTtBQUMzRSxTQUFPLEVBQUUsVUFBVSxJQUFJO0FBQ3pCO0FBRU8sU0FBUyxVQUFVLE9BQTREO0FBQ3BGLE1BQUksTUFBTSxTQUFTLFVBQVUsTUFBTSxTQUFTLFlBQWEsUUFBTztBQUNoRSxRQUFNLFVBQVUsTUFBTTtBQUN0QixNQUFJLENBQUMsUUFBUyxRQUFPO0FBQ3JCLFFBQU0sU0FBOEIsQ0FBQztBQUNyQyxRQUFNLFVBQVUsUUFBUTtBQUN4QixNQUFJLE9BQU8sWUFBWSxTQUFVLFFBQU8sS0FBSyxFQUFFLE1BQU0sUUFBUSxNQUFNLGtCQUFrQixTQUFTQyxXQUFVLEVBQUUsQ0FBQztBQUFBLFdBQ2xHLE1BQU0sUUFBUSxPQUFPLEdBQUc7QUFDL0I7QUFBQyxJQUFDLFFBQXNDLFFBQVEsQ0FBQyxLQUFLLFVBQVU7QUFDOUQsY0FBUSxLQUFLLE1BQU07QUFBQSxRQUNqQixLQUFLLFNBQVM7QUFDWixnQkFBTSxRQUFRLFNBQVMsS0FBSyxHQUFHLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRTtBQUNwRCxjQUFJLE1BQU8sUUFBTyxLQUFLLEVBQUUsTUFBTSxTQUFTLE1BQU0sQ0FBQztBQUMvQztBQUFBLFFBQ0Y7QUFBQSxRQUNBLEtBQUs7QUFDSCxjQUFJLE9BQU8sSUFBSSxTQUFTLFlBQVksSUFBSSxLQUFLLEtBQUssRUFBRyxRQUFPLEtBQUssRUFBRSxNQUFNLFFBQVEsTUFBTSxrQkFBa0IsSUFBSSxNQUFNQSxXQUFVLEVBQUUsQ0FBQztBQUNoSTtBQUFBLFFBQ0YsS0FBSztBQUNILGNBQUksT0FBTyxJQUFJLGFBQWEsWUFBWSxJQUFJLFNBQVMsS0FBSyxFQUFHLFFBQU8sS0FBSyxFQUFFLE1BQU0sWUFBWSxNQUFNLGtCQUFrQixJQUFJLFVBQVVBLFdBQVUsRUFBRSxDQUFDO0FBQ2hKO0FBQUEsUUFDRixLQUFLO0FBQ0gsaUJBQU8sS0FBSyxFQUFFLE1BQU0sYUFBYSxNQUFNLE9BQU8sSUFBSSxRQUFRLE1BQU0sR0FBRyxPQUFPLGtCQUFrQixLQUFLLFVBQVUsSUFBSSxTQUFTLENBQUMsQ0FBQyxHQUFHQyxXQUFVLEVBQUUsQ0FBQztBQUMxSTtBQUFBLFFBQ0YsS0FBSyxlQUFlO0FBQ2xCLGdCQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksT0FBTyxJQUFLLElBQUksVUFBd0M7QUFDeEYsZ0JBQU0sTUFBTSxPQUFPLElBQUksWUFBWSxXQUFXLElBQUksVUFBVSxRQUFRLE1BQU0sSUFBSSxDQUFDLE1BQU8sT0FBTyxHQUFHLFNBQVMsV0FBVyxFQUFFLE9BQU8sRUFBRyxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLEtBQUssVUFBVSxJQUFJLFdBQVcsRUFBRTtBQUUvTCxnQkFBTUMsVUFBUyxRQUFRLE1BQU0sSUFBSSxDQUFDLEdBQUcsTUFBTyxHQUFHLFNBQVMsVUFBVSxTQUFTLEdBQUcsR0FBRyxNQUFNLElBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFLElBQUksSUFBSyxFQUFFLE9BQU8sQ0FBQyxNQUFxQixRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDbEssaUJBQU8sS0FBSyxFQUFFLE1BQU0sZUFBZSxRQUFRLGtCQUFrQixLQUFLRCxXQUFVLEdBQUcsU0FBUyxJQUFJLGFBQWEsTUFBTSxHQUFJQyxRQUFPLFNBQVMsRUFBRSxRQUFBQSxRQUFPLElBQUksQ0FBQyxFQUFHLENBQUM7QUFDcko7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFDQSxNQUFJLENBQUMsT0FBTyxPQUFRLFFBQU87QUFDM0IsUUFBTSxLQUFLLE9BQU8sTUFBTSxjQUFjLFdBQVcsS0FBSyxNQUFNLE1BQU0sU0FBUyxJQUFJO0FBQy9FLFFBQU0sV0FBWSxRQUFnQztBQUNsRCxRQUFNLFFBQVEsTUFBTSxTQUFTLGVBQWUsT0FBTyxhQUFhLFlBQVksYUFBYSxnQkFBZ0IsV0FBVztBQUNwSCxRQUFNLFNBQVMsT0FBTyxNQUFNLGtCQUFrQixXQUFXLE1BQU0sZ0JBQWdCLE9BQU8sTUFBTSxXQUFXLFdBQVcsTUFBTSxTQUFTO0FBQ2pJLFNBQU8sRUFBRSxJQUFJLE9BQU8sTUFBTSxRQUFRLEtBQUssT0FBTyxDQUFDLEdBQUcsTUFBTSxRQUFRLFFBQVEsT0FBTyxNQUFNLElBQUksR0FBRyxJQUFJLE9BQU8sU0FBUyxFQUFFLElBQUksS0FBSyxNQUFNLFFBQVEsR0FBSSxRQUFRLEVBQUUsT0FBTyxPQUFPLElBQUksQ0FBQyxFQUFHO0FBQy9LO0FBRUEsSUFBTSxjQUFjLG9CQUFJLElBQUksQ0FBQyxhQUFhLGNBQWMsYUFBYSxZQUFZLENBQUM7QUFFbEYsU0FBUyxTQUFTLEtBQThCLEtBQThCO0FBQzVFLFFBQU0sU0FBUyxJQUFJO0FBQ25CLE1BQUksUUFBUSxTQUFTLFlBQVksT0FBTyxPQUFPLFNBQVMsWUFBWSxDQUFDLFlBQVksSUFBSSxPQUFPLGNBQWMsRUFBRSxFQUFHLFFBQU87QUFDdEgsU0FBTyxFQUFFLEtBQUssV0FBVyxPQUFPLFlBQWEsT0FBTyxLQUFLLE1BQU8sT0FBTyxLQUFLLFNBQVMsSUFBSyxDQUFDLEVBQUU7QUFDL0Y7QUFHQSxJQUFNLFNBQVMsb0JBQUksSUFBaUQ7QUFDcEUsSUFBSSxhQUFhO0FBQ2pCLElBQU0sb0JBQW9CLEtBQUssT0FBTztBQUV0QyxTQUFTLFdBQVcsS0FBYSxPQUFrRDtBQUNqRixTQUFPLElBQUksS0FBSyxLQUFLO0FBQ3JCLGdCQUFjLE1BQU0sS0FBSztBQUN6QixTQUFPLGFBQWEscUJBQXFCLE9BQU8sT0FBTyxHQUFHO0FBQ3hELFVBQU0sQ0FBQyxRQUFRLEtBQUssSUFBSSxPQUFPLFFBQVEsRUFBRSxLQUFLLEVBQUU7QUFDaEQsV0FBTyxPQUFPLE1BQU07QUFDcEIsa0JBQWMsTUFBTSxLQUFLO0FBQUEsRUFDM0I7QUFDRjtBQUdBLGVBQXNCLGdCQUFnQixNQUFjLEtBQWtFO0FBQ3BILFFBQU0sQ0FBQyxNQUFNLFdBQVcsUUFBUSxJQUFJLElBQUksTUFBTSxHQUFHO0FBQ2pELE1BQUksQ0FBQyxRQUFRLGNBQWMsT0FBVyxRQUFPO0FBQzdDLFFBQU0sTUFBTSxHQUFHLElBQUksS0FBSyxHQUFHO0FBQzNCLFFBQU0sU0FBUyxPQUFPLElBQUksR0FBRztBQUM3QixNQUFJLE9BQVEsUUFBTztBQUNuQixRQUFNLFNBQVMsTUFBTUgsTUFBSyxNQUFNLEdBQUc7QUFDbkMsTUFBSTtBQUNKLE1BQUk7QUFDRixVQUFNLFFBQVEsTUFBTSxPQUFPLEtBQUssR0FBRztBQUVuQyxVQUFNLFFBQVEsS0FBSyxJQUFJLEdBQUcsT0FBTyxnQkFBZ0I7QUFDakQsYUFBUyxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQ2xDLFVBQU0sT0FBTyxLQUFLLFFBQVEsR0FBRyxPQUFPLFFBQVEsS0FBSztBQUFBLEVBQ25ELFVBQUU7QUFDQSxVQUFNLE9BQU8sTUFBTTtBQUFBLEVBQ3JCO0FBRUEsUUFBTSxTQUFTLE9BQU8sS0FBSyxJQUFJO0FBQy9CLFdBQVMsS0FBSyxPQUFPLFFBQVEsTUFBTSxHQUFHLE1BQU0sR0FBRyxLQUFLLE9BQU8sUUFBUSxRQUFRLEtBQUssT0FBTyxNQUFNLEdBQUc7QUFDOUYsVUFBTSxZQUFZLE9BQU8sWUFBWSxJQUFNLEVBQUUsSUFBSTtBQUNqRCxVQUFNLFVBQVUsT0FBTyxRQUFRLElBQU0sRUFBRTtBQUN2QyxVQUFNLFVBQVUsVUFBVSxJQUFJLE9BQU8sU0FBUztBQUM5QyxRQUFJO0FBQ0YsWUFBTSxRQUFRLEtBQUssTUFBTSxPQUFPLFNBQVMsUUFBUSxXQUFXLE9BQU8sQ0FBQztBQUNwRSxVQUFJLE1BQU0sU0FBUyxRQUFRLENBQUMsTUFBTSxRQUFRLE1BQU0sU0FBUyxPQUFPLEVBQUc7QUFDbkUsVUFBSSxRQUFTLE1BQU0sUUFBUyxRQUFzQyxPQUFPLFNBQVMsQ0FBQztBQUNuRixVQUFJLGFBQWEsT0FBVyxVQUFTLE1BQU0sUUFBUSxPQUFPLE9BQU8sSUFBSyxNQUFNLFVBQXdDLENBQUMsR0FBRyxPQUFPLFFBQVEsQ0FBQztBQUN4SSxZQUFNLFNBQVMsT0FBTztBQUN0QixVQUFJLFFBQVEsU0FBUyxZQUFZLE9BQU8sT0FBTyxTQUFTLFlBQVksWUFBWSxJQUFJLE9BQU8sY0FBYyxFQUFFLEdBQUc7QUFDNUcsY0FBTSxRQUFRLEVBQUUsV0FBVyxPQUFPLFlBQWEsTUFBTSxPQUFPLEtBQUs7QUFDakUsbUJBQVcsS0FBSyxLQUFLO0FBQ3JCLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRixRQUFRO0FBQUEsSUFFUjtBQUNBLFNBQUssS0FBSyxJQUFJLElBQUksVUFBVSxPQUFPLE1BQU07QUFBQSxFQUMzQztBQUNBLFNBQU87QUFDVDs7O0FOckxBLElBQU0sY0FBYztBQUNwQixJQUFNLGtCQUFrQjtBQUV4QixJQUFNLGNBQWM7QUFDcEIsSUFBTSxnQkFBZ0IsTUFBTTtBQUVyQixJQUFNLGdCQUFOLE1BQW9CO0FBQUEsRUFHekIsWUFBNkIsTUFBa0I7QUFBbEI7QUFBQSxFQUFtQjtBQUFBLEVBRnhDLFVBQVUsb0JBQUksSUFBc0M7QUFBQTtBQUFBLEVBSzVELE9BQU8sT0FBZ0IsVUFBMEMsTUFBTSxNQUFnQztBQUNyRyxRQUFJO0FBQ0osUUFBSTtBQUNGLGdCQUFVLGdCQUFnQixLQUFLO0FBQUEsSUFDakMsU0FBUyxPQUFPO0FBQ2QsYUFBTyxRQUFRLFFBQVEsS0FBSyxpQkFBaUIsa0JBQWtCLG1CQUFtQixpQkFBa0IsTUFBZ0IsT0FBTyxDQUFDO0FBQUEsSUFDOUg7QUFDQSxRQUFJLENBQUMsUUFBUSxRQUFRLElBQUksRUFBRyxRQUFPLFFBQVEsUUFBUSxLQUFLLGlCQUFpQixxQ0FBcUMsQ0FBQztBQUMvRyxVQUFNLFNBQVMsS0FBSyxRQUFRLElBQUksUUFBUSxTQUFTO0FBQ2pELFFBQUksT0FBUSxRQUFPO0FBQ25CLFVBQU0sVUFBVSxLQUFLLFFBQVEsT0FBTztBQUNwQyxTQUFLLFFBQVEsSUFBSSxRQUFRLFdBQVcsT0FBTztBQUMzQyxRQUFJLEtBQUssUUFBUSxPQUFPLGFBQWE7QUFDbkMsWUFBTSxTQUFTLEtBQUssUUFBUSxLQUFLLEVBQUUsS0FBSyxFQUFFO0FBQzFDLFVBQUksV0FBVyxPQUFXLE1BQUssUUFBUSxPQUFPLE1BQU07QUFBQSxJQUN0RDtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLFFBQVEsU0FBbUQ7QUFDdkUsVUFBTSxFQUFFLElBQUksSUFBSSxLQUFLO0FBQ3JCLFVBQU0sZUFBZSxvQkFBb0IsUUFBUSxNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDLEdBQUcsS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLEdBQUcsa0JBQWtCLEtBQUssS0FBSyxTQUFTLEVBQUUsaUJBQWlCLENBQUM7QUFDcEwsUUFBSSxDQUFDLGFBQWEsVUFBVyxRQUFPLEtBQUssZUFBZSxhQUFhLFVBQVUsNkJBQTZCO0FBQzVHLFFBQUkscUJBQXFCLElBQUksUUFBUSxJQUFJLEtBQUssQ0FBQyxRQUFRLFVBQVcsUUFBTyxLQUFLLHlCQUF5Qiw0QkFBNEI7QUFDbkksUUFBSTtBQUNGLFlBQU0sV0FBVyxNQUFNLEtBQUssSUFBSSxPQUFPO0FBQ3ZDLFVBQUksQ0FBQyxtQkFBbUIsSUFBSSxRQUFRLElBQUksS0FBSyxRQUFRLFNBQVMsZ0JBQWlCLEtBQUksTUFBTSxLQUFLO0FBQUEsUUFDNUYsSUFBSSxJQUFJLElBQUk7QUFBQSxRQUNaLE1BQU0sU0FBUyxLQUFLLHFCQUFxQjtBQUFBLFFBQ3pDLFFBQVE7QUFBQSxRQUNSLFVBQVUsT0FBTyxRQUFRLE9BQU8sV0FBVyxRQUFRLE9BQU8sVUFBVSxRQUFRLE9BQU8sY0FBYyxRQUFRLE9BQU8sZUFBZSxRQUFRLElBQUk7QUFBQSxRQUMzSSxTQUFTLEdBQUcsUUFBUSxJQUFJLEtBQUssU0FBUyxLQUFLLFNBQVMsU0FBUyxNQUFNLE9BQU87QUFBQSxNQUM1RSxDQUFDO0FBRUQsVUFBSSxTQUFTLE1BQU0sQ0FBQyxtQkFBbUIsSUFBSSxRQUFRLElBQUksRUFBRyxNQUFLLEtBQUssUUFBUTtBQUM1RSxhQUFPO0FBQUEsSUFDVCxTQUFTLE9BQU87QUFDZCxZQUFNLE1BQU07QUFDWixVQUFJLElBQUksV0FBVyxRQUFRLElBQUksWUFBWSxJQUFJLE9BQU8sRUFBRTtBQUN4RCxhQUFPLEtBQUssT0FBTyxJQUFJLFNBQVMsV0FBVyxJQUFJLE9BQU8saUJBQWlCLE9BQU8sSUFBSSxPQUFPLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsSUFBSSxTQUFtRDtBQUNuRSxVQUFNLEVBQUUsSUFBSSxJQUFJLEtBQUs7QUFDckIsVUFBTSxJQUFJLFFBQVE7QUFDbEIsVUFBTSxPQUFPLElBQUksS0FBSztBQUN0QixZQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3BCLEtBQUs7QUFDSCxlQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUssa0JBQWtCLEVBQUUsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0FBQUEsTUFDM0UsS0FBSyxpQkFBaUI7QUFDcEIsY0FBTSxTQUFTLE1BQU0sS0FBSyxLQUFLLGlCQUFpQixFQUFFLFlBQVksRUFBRSxZQUFZLFVBQVUsSUFBSSxDQUFDO0FBQzNGLGVBQU8sR0FBRyxFQUFFLE1BQU0sU0FBUyxRQUFRLFlBQVksT0FBTyxPQUFPLE1BQU0sSUFBSSxDQUFDLFNBQVMsT0FBTyxVQUFVLElBQUksQ0FBQyxDQUFDLEdBQUcsV0FBVyxPQUFPLFVBQVUsQ0FBQztBQUFBLE1BQzFJO0FBQUEsTUFDQSxLQUFLO0FBQ0gsZUFBTyxFQUFFLFNBQVMsS0FBSyxZQUFZLEVBQUUsU0FBUyxFQUFFLE1BQU0sSUFBSSxLQUFLLGdCQUFnQixFQUFFLFNBQVMsRUFBRSxLQUFLO0FBQUEsTUFDbkcsS0FBSztBQUNILGVBQU8sS0FBSyxPQUFPLEVBQUUsU0FBUyxFQUFFLFFBQVEsSUFBSyxRQUFRLE9BQU8sZUFBd0MsQ0FBQyxDQUFDO0FBQUEsTUFDeEcsS0FBSztBQUNILGVBQU8sS0FBSyxLQUFLLFVBQVUsR0FBRyxNQUFNLEtBQUssS0FBSyxRQUFRLE1BQU0sUUFBUSxPQUFPLFVBQVUsSUFBSSxDQUFDLElBQUksS0FBSyxlQUFlLHVDQUF1QztBQUFBLE1BQzNKLEtBQUs7QUFDSCxlQUFPLEtBQUssS0FBSyxVQUFVLEdBQUcsTUFBTSxLQUFLLEtBQUssUUFBUSxPQUFPLEtBQUssS0FBSyxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUssZUFBZSxpQ0FBaUM7QUFBQSxNQUMxSSxLQUFLO0FBQ0gsZUFBTyxLQUFLLEtBQUssYUFBYSxHQUFHLE1BQU0sS0FBSyxLQUFLLFdBQVcsTUFBTSxDQUFDLElBQUksR0FBRyxFQUFFLE1BQU0sTUFBTSxDQUFDO0FBQUEsTUFDM0YsS0FBSztBQUNILGNBQU0sS0FBSyxLQUFLLFlBQVksT0FBTyxFQUFFLE1BQW9CO0FBQ3pELGVBQU8sR0FBRyxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsTUFDM0IsS0FBSyxnQkFBZ0I7QUFDbkIsWUFBSSxDQUFDLEtBQUssS0FBSyxZQUFhLFFBQU8sS0FBSyxlQUFlLHlDQUF5QztBQUNoRyxjQUFNLFNBQVMsTUFBTSxLQUFLLEtBQUssWUFBWSxPQUFPLEVBQUUsVUFBVSxFQUFFLFdBQTZCLEVBQUUsT0FBTyxPQUFPLEVBQUUsTUFBTSxHQUFHLFFBQVEsT0FBTyxTQUFTLElBQUk7QUFDcEosZUFBTyxHQUFHLE1BQU07QUFBQSxNQUNsQjtBQUFBLE1BQ0EsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLEVBQUUsU0FBUyxFQUFFLEtBQUssT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0FBQUEsTUFDM0QsS0FBSyxnQkFBZ0I7QUFDbkIsY0FBTSxTQUFTLE1BQU0sS0FBSyxLQUFLLGdCQUFnQixFQUFFLGFBQWEsRUFBRSxhQUFhLE9BQU8sRUFBRSxPQUFPLEdBQUksRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE9BQU8sSUFBSSxDQUFDLEVBQUcsQ0FBQztBQUN4SSxhQUFLLEtBQUssYUFBYSxJQUFJLE9BQU8sVUFBVTtBQUM1QyxlQUFPLEdBQUcsTUFBTTtBQUFBLE1BQ2xCO0FBQUEsTUFDQSxLQUFLLGdCQUFnQjtBQUNuQixjQUFNLFNBQVMsTUFBTSxLQUFLLEtBQUssZ0JBQWdCLEVBQUUsYUFBYSxFQUFFLGFBQWEsT0FBTyxFQUFFLE9BQWdCLFdBQVcsRUFBRSxVQUFVLENBQUM7QUFDOUgsYUFBSyxLQUFLLGFBQWEsSUFBSSxPQUFPLFVBQVU7QUFDNUMsZUFBTyxHQUFHLE1BQU07QUFBQSxNQUNsQjtBQUFBLE1BQ0EsS0FBSztBQUNILGVBQU8sS0FBSyxVQUFVLEVBQUUsT0FBTztBQUFBLE1BQ2pDLEtBQUs7QUFDSCxlQUFPLEtBQUssV0FBVyxFQUFFLFFBQVEsRUFBRSxLQUFLO0FBQUEsTUFDMUMsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsS0FBSztBQUNILGVBQU8sS0FBSyxtQkFBbUIsT0FBTztBQUFBLE1BQ3hDLEtBQUssbUJBQW1CO0FBQ3RCLGNBQU0sU0FBUyxNQUFNLEtBQUssS0FBSyxvQkFBb0I7QUFBQSxVQUNqRCxXQUFXLEVBQUU7QUFBQSxVQUNiLEdBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQUEsVUFDakMsR0FBSSxFQUFFLGFBQWEsRUFBRSxZQUFZLEVBQUUsV0FBVyxJQUFJLENBQUM7QUFBQSxVQUNuRCxHQUFJLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQztBQUFBLFVBQ3BDLEdBQUksRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE9BQU8sSUFBSSxDQUFDO0FBQUEsUUFDekMsQ0FBQztBQUNELFlBQUksT0FBTyxXQUFZLE1BQUssS0FBSyxhQUFhLElBQUksT0FBTyxVQUFVO0FBQ25FLGVBQU8sR0FBRyxNQUFNO0FBQUEsTUFDbEI7QUFBQSxNQUNBLEtBQUs7QUFDSCxlQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUssa0JBQWtCLEVBQUUsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDO0FBQUEsTUFDN0UsS0FBSztBQUNILGVBQU8sS0FBSyxRQUFRLEVBQUUsSUFBSTtBQUFBLE1BQzVCLEtBQUs7QUFDSCxlQUFPLEtBQUssZUFBZSxtRUFBOEQ7QUFBQSxNQUMzRixLQUFLLGlCQUFpQjtBQUNwQixjQUFNLFVBQVUsSUFBSSxNQUFNLEtBQUssRUFBRTtBQUNqQyxjQUFNLE9BQW9CO0FBQUEsVUFDeEIsY0FBZSxFQUFFLGdCQUF1RCxRQUFRO0FBQUEsVUFDaEYsWUFBYSxFQUFFLGNBQXFELFFBQVE7QUFBQSxVQUM1RSxhQUFjLEVBQUUsZUFBc0MsUUFBUTtBQUFBLFVBQzlELGNBQWUsRUFBRSxnQkFBdUQsUUFBUSxnQkFBZ0IsQ0FBQztBQUFBLFVBQ2pHLGVBQWUsZUFBZ0IsRUFBRSxpQkFBd0QsUUFBUSxpQkFBaUIsQ0FBQyxDQUFDO0FBQUEsVUFDcEgsY0FBZSxFQUFFLGdCQUF1RCxRQUFRLGdCQUFnQixDQUFDO0FBQUEsUUFDbkc7QUFDQSxjQUFNLEtBQUssS0FBSyxhQUFhLElBQUk7QUFDakMsZUFBTyxHQUFHLElBQUk7QUFBQSxNQUNoQjtBQUFBLE1BQ0EsS0FBSztBQUNILGVBQU8sR0FBRyxNQUFNLEtBQUssS0FBSyxZQUFZLFNBQVMsQ0FBQztBQUFBLE1BQ2xELEtBQUssZ0JBQWdCO0FBQ25CLGNBQU0sU0FBUyxNQUFNLEtBQUssS0FBSyxZQUFZLFFBQVEsRUFBRSxLQUFLO0FBQzFELGVBQU8sU0FBUyxHQUFHLE1BQU0sSUFBSSxLQUFLLGFBQWEsZ0NBQWdDO0FBQUEsTUFDakY7QUFBQSxNQUNBLEtBQUs7QUFDSCxlQUFPLEdBQUcsRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLE1BQzNCLEtBQUs7QUFDSCxlQUFPLEdBQUcsS0FBSyxLQUFLLGNBQWMsQ0FBQztBQUFBLE1BQ3JDLEtBQUs7QUFDSCxlQUFPLEtBQUssS0FBSyx1QkFBdUIsR0FBRyxNQUFNLEtBQUssS0FBSyxxQkFBcUIsUUFBUSxPQUFPLFlBQVksSUFBSSxDQUFDLElBQUksS0FBSyxlQUFlLGdCQUFnQjtBQUFBLE1BQzFKLEtBQUs7QUFDSCxlQUFPLEdBQUcsTUFBTSxLQUFLLEtBQUssYUFBYSxRQUFRLE9BQU8sWUFBWSxJQUFJLENBQUM7QUFBQSxNQUN6RSxLQUFLLGlCQUFpQjtBQUNwQixjQUFNLE9BQU8sS0FBSyxLQUFLLFNBQVMsRUFBRSxHQUFHO0FBQ3JDLGVBQU8sU0FBUyxPQUFPLEtBQUssYUFBYSxrRUFBa0UsSUFBSSxHQUFHLEVBQUUsS0FBSyxDQUFDO0FBQUEsTUFDNUg7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHUSxjQUFjLG9CQUFJLElBQStEO0FBQUE7QUFBQTtBQUFBLEVBSXpGLGlCQUFpQixTQUF1QjtBQUN0QyxTQUFLLFlBQVksT0FBTyxPQUFPO0FBQUEsRUFDakM7QUFBQSxFQUVBLE1BQWMsZ0JBQWdCLFNBQWlCLE9BQXFEO0FBQ2xHLFVBQU0sV0FBVyxNQUFNLEtBQUssV0FBVyxPQUFPO0FBQzlDLFFBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxHQUFJLFFBQU87QUFDbkMsVUFBTSxVQUFXLFNBQVMsT0FBZ0M7QUFDMUQsV0FBTyxZQUFZLFFBQVEsR0FBRyxFQUFFLFdBQVcsTUFBTSxRQUFRLENBQUMsSUFBSTtBQUFBLEVBQ2hFO0FBQUEsRUFFUSxXQUFXLFNBQTJDO0FBQzVELFVBQU0sTUFBTSxLQUFLLElBQUk7QUFDckIsVUFBTSxTQUFTLEtBQUssWUFBWSxJQUFJLE9BQU87QUFDM0MsUUFBSSxVQUFVLE1BQU0sT0FBTyxLQUFLLGdCQUFpQixRQUFPLE9BQU87QUFDL0QsVUFBTSxVQUFVLEtBQUssY0FBYyxPQUFPLEVBQUUsS0FBSyxTQUFTLEVBQUUsS0FBSyxXQUFXO0FBQzVFLFNBQUssWUFBWSxJQUFJLFNBQVMsRUFBRSxJQUFJLEtBQUssUUFBUSxDQUFDO0FBQ2xELFFBQUksS0FBSyxZQUFZLE9BQU8sR0FBSSxNQUFLLFlBQVksT0FBTyxLQUFLLFlBQVksS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFlO0FBQ3RHLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUdBLE1BQWMsWUFBWSxTQUFpQixRQUEwQztBQUNuRixVQUFNLFFBQVEsS0FBSyxLQUFLLElBQUksTUFBTSxLQUFLLEVBQUUsT0FBTyxPQUFPO0FBQ3ZELFFBQUksQ0FBQyxNQUFPLFFBQU8sS0FBSyxhQUFhLGdDQUFnQztBQUNyRSxVQUFNLE9BQU8sTUFBTSxLQUFLLEtBQUsscUJBQXFCLEtBQUs7QUFDdkQsUUFBSSxDQUFDLEtBQU0sUUFBTyxLQUFLLGVBQWUsK0RBQStEO0FBQ3JHLFVBQU0sU0FBUyxNQUFNLHFCQUFxQixNQUFNLEVBQUUsVUFBVSxPQUFPLENBQUM7QUFDcEUsV0FBTyxTQUFTLFVBQVUsR0FBRyxNQUFNLENBQUMsSUFBSSxLQUFLLGVBQWUsZ0NBQWdDO0FBQUEsRUFDOUY7QUFBQSxFQUVBLE1BQWMsY0FBYyxTQUEyQztBQUNyRSxVQUFNLEVBQUUsSUFBSSxJQUFJLEtBQUs7QUFDckIsVUFBTSxRQUFRLElBQUksTUFBTSxLQUFLLEVBQUUsT0FBTyxPQUFPO0FBQzdDLFFBQUksQ0FBQyxNQUFPLFFBQU8sS0FBSyxhQUFhLGdDQUFnQztBQUVyRSxRQUFJLE1BQU0sY0FBYyxJQUFJLElBQUksTUFBTTtBQUNwQyxZQUFNLFNBQVMsTUFBTSxpQkFBaUIsSUFBSSxLQUFLLE1BQU0sVUFBVTtBQUMvRCxVQUFJLFFBQVE7QUFDVixhQUFLLEtBQUsscUJBQXFCLE9BQU87QUFDdEMsZUFBTyxHQUFHLEVBQUUsR0FBRyxRQUFRLFFBQVEsUUFBUSxLQUFLLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztBQUFBLE1BQ3hFO0FBQUEsSUFDRjtBQUVBLFVBQU0sYUFBYSxNQUFNLEtBQUssS0FBSyxxQkFBcUIsS0FBSztBQUM3RCxRQUFJLFlBQVk7QUFDZCxZQUFNLFNBQVMsTUFBTSxxQkFBcUIsVUFBVTtBQUVwRCxVQUFJLE9BQVEsUUFBTyxHQUFHLEVBQUUsR0FBRyxRQUFRLE1BQU0sS0FBSyxLQUFLLGNBQWMsU0FBUyxVQUFVLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDbEc7QUFFQSxRQUFJLE1BQU0sY0FBYyxJQUFJLEtBQUssS0FBSyxJQUFJLGVBQWUsR0FBRztBQUMxRCxZQUFNLFNBQVMsTUFBTSxJQUFJLEtBQUssS0FBSyxLQUFLLGlCQUFpQixFQUFFLFlBQVksTUFBTSxZQUFZLFVBQVUsSUFBSSxDQUFDO0FBQ3hHLFdBQUssS0FBSyxxQkFBcUIsT0FBTztBQUV0QyxhQUFPLEdBQUcsRUFBRSxNQUFNLFNBQVMsUUFBUSxZQUFZLE9BQU8sT0FBTyxNQUFNLElBQUksQ0FBQyxTQUFTLE9BQU8sVUFBVSxJQUFJLENBQUMsQ0FBQyxHQUFHLFdBQVcsT0FBTyxXQUFXLFFBQVEsUUFBUSxLQUFLLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztBQUFBLElBQ3pMO0FBQ0EsV0FBTyxLQUFLLGVBQWUsd0NBQXdDO0FBQUEsRUFDckU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsTUFBYyxPQUFPLFNBQWlCLFNBQWlCLGdCQUEwQixDQUFDLEdBQTZCO0FBQzdHLFVBQU0sRUFBRSxJQUFJLElBQUksS0FBSztBQUNyQixVQUFNLFFBQVEsSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLE9BQU87QUFDN0MsUUFBSSxDQUFDLE1BQU8sUUFBTyxLQUFLLGFBQWEsZ0NBQWdDO0FBQ3JFLFFBQUksQ0FBQyxRQUFRLEtBQUssS0FBSyxDQUFDLGNBQWMsT0FBUSxRQUFPLEtBQUssa0JBQWtCLHVCQUF1QjtBQUNuRyxRQUFJLE1BQU0sU0FBUyxXQUFZLFFBQU8sS0FBSyxlQUFlLGlHQUFpRztBQUUzSixVQUFNLFFBQWtCLENBQUM7QUFDekIsZUFBVyxNQUFNLGVBQWU7QUFDOUIsWUFBTSxPQUFPLEtBQUssS0FBSyxhQUFhLFFBQVEsRUFBRTtBQUM5QyxVQUFJLENBQUMsS0FBTSxRQUFPLEtBQUssYUFBYSw0REFBNEQ7QUFDaEcsWUFBTSxLQUFLLElBQUk7QUFBQSxJQUNqQjtBQUNBLFVBQU0sUUFBUSx5QkFBeUIsTUFBTSxPQUFPLEtBQUssQ0FBQyxNQUFNLGFBQWEsU0FBUyxNQUFNLFVBQVUsWUFBWSxNQUFNLFVBQVUsT0FBTyxvQkFBb0I7QUFDN0osVUFBTSxPQUFPLENBQUMsUUFBUSxLQUFLLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLFdBQVcsTUFBTSxLQUFLLENBQUMsQ0FBQyxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssR0FBRztBQUN2RyxRQUFJLE1BQU0sY0FBYyxJQUFJLEtBQUssS0FBSyxJQUFJLG1CQUFtQixHQUFHO0FBQzlELFlBQU0sU0FBUyxNQUFNLElBQUksS0FBSyxLQUFLLEtBQUsscUJBQXFCLEVBQUUsWUFBWSxNQUFNLFlBQVksTUFBTSxPQUFPLEtBQUssQ0FBQztBQUNoSCxhQUFPLE9BQU8sV0FBVyxHQUFHLEVBQUUsS0FBSyxZQUFZLFdBQVcsS0FBSyxDQUFDLElBQUksS0FBSyxpQkFBaUIsaURBQWlEO0FBQUEsSUFDN0k7QUFDQSxVQUFNLGNBQWMseUJBQXlCLE1BQU0sT0FBTztBQUMxRCxRQUFJLGFBQWE7QUFDZixVQUFJLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRSxZQUFZLENBQUMsS0FBSyxLQUFLLFNBQVUsUUFBTyxLQUFLLGVBQWUsa0VBQWtFO0FBQ3hKLFVBQUk7QUFDRixjQUFNLEtBQUssS0FBSyxTQUFTLGFBQWEsSUFBSTtBQUMxQyxlQUFPLEdBQUcsRUFBRSxLQUFLLGdCQUFnQixXQUFXLEtBQUssQ0FBQztBQUFBLE1BQ3BELFNBQVMsT0FBTztBQUNkLGNBQU0sTUFBTTtBQUNaLGVBQU8sS0FBSyxJQUFJLFFBQVEsaUJBQWlCLGtDQUFrQyxPQUFPLElBQUksT0FBTyxDQUFDLEVBQUU7QUFBQSxNQUNsRztBQUFBLElBQ0Y7QUFDQSxRQUFJLE1BQU0sY0FBYyxNQUFNLE9BQU87QUFDbkMsWUFBTSxXQUFXLE1BQU0sS0FBSyxtQkFBbUIsRUFBRSxXQUFXLG1CQUFtQixNQUFNLGdCQUFnQixRQUFRLEVBQUUsT0FBTyxNQUFNLE9BQU8sSUFBSSxZQUFZLE1BQU0sVUFBVSxJQUFJLFNBQVMsMkJBQTJCLE1BQU0sS0FBSyxFQUFFLENBQUM7QUFDek4sYUFBTyxTQUFTLEtBQUssR0FBRyxFQUFFLEtBQUsseUJBQXlCLFdBQVcsS0FBSyxDQUFDLElBQUk7QUFBQSxJQUMvRTtBQUNBLFdBQU8sS0FBSyxlQUFlLDZHQUE2RztBQUFBLEVBQzFJO0FBQUE7QUFBQSxFQUdBLE1BQWMsTUFBTSxTQUFpQixLQUFhLFFBQTBDO0FBQzFGLFVBQU0sUUFBUSxLQUFLLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLE9BQU87QUFDdkQsUUFBSSxDQUFDLE1BQU8sUUFBTyxLQUFLLGFBQWEsZ0NBQWdDO0FBQ3JFLFVBQU0sT0FBTyxNQUFNLEtBQUssS0FBSyxxQkFBcUIsS0FBSztBQUN2RCxRQUFJLENBQUMsS0FBTSxRQUFPLEtBQUssZUFBZSwyQ0FBMkM7QUFDakYsVUFBTSxRQUFRLE1BQU0sZ0JBQWdCLE1BQU0sR0FBRztBQUM3QyxRQUFJLENBQUMsTUFBTyxRQUFPLEtBQUssYUFBYSw0Q0FBNEM7QUFDakYsVUFBTSxRQUFRLE1BQU0sS0FBSyxNQUFNLFFBQVEsU0FBUyxXQUFXO0FBQzNELFdBQU8sR0FBRyxFQUFFLFdBQVcsTUFBTSxXQUFXLE9BQU8sTUFBTSxLQUFLLFFBQVEsUUFBUSxNQUFNLENBQUM7QUFBQSxFQUNuRjtBQUFBLEVBRUEsTUFBYyxVQUFVLFNBQTJDO0FBQ2pFLFVBQU0sRUFBRSxJQUFJLElBQUksS0FBSztBQUNyQixVQUFNLFFBQVEsSUFBSSxNQUFNLEtBQUssRUFBRSxPQUFPLE9BQU87QUFDN0MsUUFBSSxDQUFDLE1BQU8sUUFBTyxLQUFLLGFBQWEsZ0NBQWdDO0FBQ3JFLFFBQUksTUFBTSxZQUFZO0FBQ3BCLFlBQU0sU0FBUyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsaUJBQWlCLGVBQWUsY0FBYyxNQUFNLFVBQVUsQ0FBQztBQUNqRyxhQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sTUFBTSxJQUFJLEtBQUssT0FBTyxNQUFNLE9BQU8sT0FBTztBQUFBLElBQ3pFO0FBQ0EsUUFBSSxNQUFNLGNBQWMsS0FBSyxLQUFLLGFBQWEsSUFBSSxNQUFNLFVBQVUsS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLGdCQUFnQixHQUFHO0FBQzNHLGFBQU8sR0FBRyxNQUFNLElBQUksS0FBSyxLQUFLLEtBQUssa0JBQWtCLEVBQUUsWUFBWSxNQUFNLFdBQVcsQ0FBQyxDQUFDO0FBQUEsSUFDeEY7QUFDQSxXQUFPLEtBQUssaUJBQWlCLGlIQUFpSDtBQUFBLEVBQ2hKO0FBQUEsRUFFQSxNQUFjLFdBQVcsUUFBZ0IsT0FBeUM7QUFDaEYsVUFBTSxFQUFFLElBQUksSUFBSSxLQUFLO0FBQ3JCLFVBQU0sT0FBTyxJQUFJLE1BQU0sS0FBSyxFQUFFLE1BQU0sTUFBTTtBQUMxQyxRQUFJLENBQUMsUUFBUSxLQUFLLFVBQVUsTUFBTyxRQUFPLEtBQUssYUFBYSwrQkFBK0I7QUFDM0YsVUFBTSxPQUFPLEtBQUssWUFBWSxJQUFJLENBQUMsT0FBTyxJQUFJLE1BQU0sS0FBSyxFQUFFLE9BQU8sWUFBWSxFQUFFLEVBQUUsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxVQUFVLE9BQU8sSUFBSTtBQUNsSCxVQUFNLFVBQW9CLENBQUM7QUFDM0IsZUFBVyxTQUFTLE1BQU07QUFDeEIsWUFBTSxTQUFTLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxpQkFBaUIsZUFBZSxjQUFjLE1BQU8sVUFBVyxDQUFDO0FBQ25HLFVBQUksQ0FBQyxPQUFPLEdBQUksUUFBTyxLQUFLLE9BQU8sTUFBTSxrQkFBa0IsTUFBTyxTQUFTLE1BQU8sVUFBVSxLQUFLLE9BQU8sT0FBTyxFQUFFO0FBQ2pILGNBQVEsS0FBSyxNQUFPLFVBQVc7QUFBQSxJQUNqQztBQUVBLFVBQU0sU0FBUyxNQUFNLEtBQUssbUJBQW1CLEVBQUUsV0FBVyxZQUFZLE1BQU0sZUFBZSxRQUFRLEVBQUUsUUFBUSxPQUFPLFFBQVEsVUFBVSxRQUFRLFlBQVksRUFBRSxDQUFDO0FBQzdKLFFBQUksT0FBTyxHQUFJLFFBQU8sR0FBRyxFQUFFLFNBQVMsUUFBUSxLQUFLLENBQUM7QUFDbEQsV0FBTyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxPQUFPLE1BQU0sTUFBTSxTQUFTLFdBQVcsUUFBUSxNQUFNLGVBQWUsT0FBTyxNQUFNLE9BQU8sR0FBRyxHQUFHLFFBQVEsT0FBTyxPQUFPO0FBQUEsRUFDeko7QUFBQSxFQUVBLE1BQWMsbUJBQW1CLFNBQW1EO0FBQ2xGLFVBQU0sRUFBRSxJQUFJLElBQUksS0FBSztBQUNyQixVQUFNLFFBQVEsT0FBTyxRQUFRLE9BQU8sU0FBUyxFQUFFO0FBQy9DLFVBQU0sTUFBTSxRQUFRLElBQUksTUFBTSxLQUFLLEVBQUUsS0FBSyxLQUFLLElBQUk7QUFDbkQsVUFBTSxPQUFPLGdCQUFnQixTQUFTLElBQUksTUFBTSxLQUFLLENBQUM7QUFDdEQsUUFBSSxDQUFDLEtBQU0sUUFBTyxLQUFLLGtCQUFrQiwwQ0FBMEM7QUFDbkYsVUFBTSxVQUFVLFFBQVEsS0FBSyxJQUFJLFVBQVUsRUFBRSxLQUFLLEdBQUcsQ0FBQztBQUN0RCxRQUFJLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRSxvQkFBb0IsQ0FBQyxLQUFLLG1CQUFtQjtBQUNyRSxZQUFNLFNBQVMsS0FBSyxvQkFDaEIsb0pBQ0E7QUFDSixhQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sRUFBRSxNQUFNLHdCQUF3QixTQUFTLE9BQU8sR0FBRyxRQUFRLEVBQUUsU0FBUyxTQUFTLE9BQU8sRUFBRTtBQUFBLElBQ3JIO0FBRUEsVUFBTSxTQUFTLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLE1BQU0sVUFBVSxJQUFJLGlCQUFpQixFQUFFLEdBQUcsRUFBRSxXQUFXLElBQU0sQ0FBQztBQUNuRyxXQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sTUFBTSxJQUFJLEVBQUUsSUFBSSxPQUFPLE9BQU8sRUFBRSxNQUFNLE9BQU8sTUFBTSxTQUFTLE9BQU8sUUFBUSxHQUFHLFFBQVEsRUFBRSxTQUFTLFNBQVMsUUFBUSxPQUFPLFFBQVEsRUFBRTtBQUFBLEVBQ2xLO0FBQUEsRUFFQSxNQUFjLFFBQVEsTUFBd0M7QUFDNUQsVUFBTSxRQUFRLEtBQUssS0FBSyxJQUFJLE1BQU0sS0FBSztBQUN2QyxVQUFNLFFBQVEsT0FBTyxPQUFPLE1BQU0sU0FBUyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJLEtBQUssT0FBTyxPQUFPLE1BQU0sTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsaUJBQWlCLElBQUk7QUFDNUksUUFBSSxDQUFDLE1BQU8sUUFBTyxLQUFLLGlCQUFpQixzREFBc0Q7QUFDL0YsV0FBTyxHQUFHLE1BQU0sZ0JBQWdCLElBQUksQ0FBQztBQUFBLEVBQ3ZDO0FBQ0Y7QUFHTyxTQUFTLGVBQWUsUUFBd0Q7QUFDckYsU0FBTyxPQUFPLFlBQVksT0FBTyxRQUFRLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxnQ0FBZ0MsS0FBSyxDQUFDLENBQUMsQ0FBQztBQUM3RztBQUdPLFNBQVMsVUFBVSxVQUEyQixTQUFTLGVBQWdDO0FBQzVGLE1BQUksQ0FBQyxTQUFTLEdBQUksUUFBTztBQUN6QixRQUFNLFNBQVMsU0FBUztBQUN4QixNQUFJLFFBQVEsU0FBUyxrQkFBa0IsQ0FBQyxNQUFNLFFBQVEsT0FBTyxRQUFRLEVBQUcsUUFBTztBQUMvRSxNQUFJLFdBQVcsT0FBTztBQUN0QixTQUFPLFNBQVMsU0FBUyxLQUFLLE9BQU8sV0FBVyxLQUFLLFVBQVUsRUFBRSxHQUFHLFFBQVEsU0FBUyxDQUFDLENBQUMsSUFBSSxPQUFRLFlBQVcsU0FBUyxNQUFNLEtBQUssS0FBSyxTQUFTLFNBQVMsQ0FBQyxDQUFDO0FBQzNKLFNBQU8sYUFBYSxPQUFPLFdBQVcsV0FBVyxFQUFFLElBQUksTUFBTSxRQUFRLEVBQUUsR0FBRyxRQUFRLFVBQVUsV0FBVyxLQUFLLEVBQUU7QUFDaEg7QUFHTyxTQUFTLFlBQVksVUFBNEM7QUFDdEUsTUFBSSxDQUFDLFNBQVMsTUFBTSxDQUFDLFNBQVMsVUFBVSxPQUFPLFNBQVMsV0FBVyxTQUFVLFFBQU87QUFDcEYsUUFBTSxVQUFVSSxZQUFXLE1BQU0sRUFBRSxPQUFPLEtBQUssVUFBVSxTQUFTLE1BQU0sQ0FBQyxFQUFFLE9BQU8sS0FBSyxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQ3BHLFNBQU8sRUFBRSxJQUFJLE1BQU0sUUFBUSxFQUFFLEdBQUksU0FBUyxRQUFtQixRQUFRLEVBQUU7QUFDekU7QUFFQSxTQUFTLEdBQUcsUUFBa0M7QUFDNUMsU0FBTyxFQUFFLElBQUksTUFBTSxPQUFPO0FBQzVCO0FBRUEsU0FBUyxLQUFLLE1BQWMsU0FBa0M7QUFDNUQsU0FBTyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxRQUFRLEVBQUU7QUFDL0M7OztBT3RaQSxTQUFTLGFBQWEsdUJBQXVCO0FBQzdDLFNBQVMsT0FBTyxTQUFBQyxRQUFPLFlBQUFDLFdBQVUsYUFBQUMsa0JBQWlCO0FBQ2xELFNBQVMsUUFBQUMsYUFBWTtBQUtyQixJQUFNLGFBQWE7QUFFbkIsZUFBc0Isa0JBQWtCLFNBQWlDLFlBQW9CLEtBQThCO0FBQ3pILFFBQU0sV0FBVyxXQUFXLFNBQVMsVUFBVSxJQUFJLE1BQU0sUUFBUyxJQUFJLFVBQVUsRUFBRSxNQUFNLE1BQU0sSUFBSSxJQUFJLE1BQU0sY0FBYyxHQUFHO0FBQzdILE1BQUksWUFBWSxTQUFTLFVBQVUsR0FBSSxRQUFPO0FBQzlDLFNBQU8sV0FBVyxTQUFTLFlBQVksS0FBSyxTQUFTLENBQUM7QUFDeEQ7QUFHQSxlQUFzQixZQUFZLFNBQWlDLFlBQW9CLEtBQThCO0FBQ25ILFNBQU8sV0FBVyxTQUFTLFlBQVksS0FBSyxTQUFTLENBQUM7QUFDeEQ7QUFFQSxTQUFTLFdBQVcsU0FBaUMsWUFBNkI7QUFDaEYsU0FBTyxRQUFRLE9BQU8sS0FBSyxlQUFlO0FBQzVDO0FBRUEsU0FBUyxVQUFVLEtBQXFCO0FBQ3RDLFNBQU9BLE1BQUssS0FBSyxpQkFBaUI7QUFDcEM7QUFFQSxlQUFlLGNBQWMsS0FBcUM7QUFDaEUsTUFBSTtBQUNGLFlBQVEsTUFBTUYsVUFBUyxVQUFVLEdBQUcsR0FBRyxNQUFNLEdBQUcsS0FBSztBQUFBLEVBQ3ZELFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsZUFBZSxXQUFXLFNBQWlDLFlBQW9CLEtBQWEsT0FBZ0M7QUFDMUgsTUFBSSxXQUFXLFNBQVMsVUFBVSxHQUFHO0FBQ25DLFVBQU0sUUFBUyxJQUFJLFlBQVksS0FBSztBQUNwQyxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU1ELE9BQU0sS0FBSyxFQUFFLFdBQVcsTUFBTSxNQUFNLElBQU0sQ0FBQztBQUNqRCxRQUFNRSxXQUFVLFVBQVUsR0FBRyxHQUFHLE9BQU8sRUFBRSxNQUFNLElBQU0sQ0FBQztBQUV0RCxRQUFNLE1BQU0sVUFBVSxHQUFHLEdBQUcsR0FBSztBQUNqQyxTQUFPO0FBQ1Q7QUFFTyxTQUFTLFdBQW1CO0FBQ2pDLFNBQU8sWUFBWSxFQUFFLEVBQUUsU0FBUyxLQUFLO0FBQ3ZDO0FBRU8sU0FBUyxZQUFZLFVBQWtCLE9BQTJDO0FBQ3ZGLE1BQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsUUFBTSxJQUFJLE9BQU8sS0FBSyxRQUFRO0FBQzlCLFFBQU0sSUFBSSxPQUFPLEtBQUssS0FBSztBQUMzQixTQUFPLEVBQUUsV0FBVyxFQUFFLFVBQVUsZ0JBQWdCLEdBQUcsQ0FBQztBQUN0RDtBQUdPLFNBQVMsWUFBWSxZQUFnQyxNQUF1QjtBQUNqRixNQUFJLENBQUMsV0FBWSxRQUFPO0FBQ3hCLFNBQU8sZUFBZSxhQUFhLElBQUksTUFBTSxlQUFlLGFBQWEsSUFBSSxNQUFNLGVBQWUsU0FBUyxJQUFJO0FBQ2pIOzs7QUM5REEsU0FBUyxvQkFBNEU7QUFDckYsU0FBUyxZQUFBRSxXQUFVLFFBQUFDLGFBQVk7QUFDL0IsU0FBUyxpQkFBaUI7QUFDMUIsU0FBUyxnQkFBZ0IsYUFBQUMsa0JBQWlCO0FBQzFDLFNBQVMsU0FBUyxXQUFBQyxVQUFTLFdBQVc7QUFrQnRDLElBQU0sT0FBK0IsRUFBRSxTQUFTLDRCQUE0QixPQUFPLGtDQUFrQyxRQUFRLDJCQUEyQixRQUFRLGlCQUFpQixTQUFTLG9CQUFvQixRQUFRLFlBQVk7QUFDbE8sSUFBTSxlQUFlLG9CQUFJLElBQUksQ0FBQyxrQkFBa0IsVUFBVSxXQUFXLFlBQVksa0JBQWtCLENBQUM7QUFFcEcsSUFBTSxhQUFhO0FBQ25CLElBQU0sV0FBVyxNQUFNO0FBRXZCLElBQU0sWUFBWSxJQUFJLE9BQU87QUFDN0IsSUFBTSxjQUFjO0FBQ3BCLElBQU0sU0FBUyxVQUFVLGNBQWM7QUFFaEMsSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBTzNCLFlBQTZCLE1BQXFCO0FBQXJCO0FBQUEsRUFBc0I7QUFBQSxFQU4zQyxTQUF3QjtBQUFBLEVBQ3hCLFVBQVUsb0JBQUksSUFBb0I7QUFBQSxFQUNsQyxjQUFtQztBQUFBLEVBQ25DLG9CQUF5QztBQUFBLEVBQ3pDLFlBQTJCO0FBQUEsRUFJbkMsSUFBSSxNQUFxQjtBQUN2QixXQUFPLEtBQUssWUFBWSxvQkFBb0IsS0FBSyxTQUFTLFdBQVcsS0FBSyxLQUFLLEtBQUssS0FBSztBQUFBLEVBQzNGO0FBQUEsRUFFQSxNQUFNLFFBQXVCO0FBQzNCLGFBQVMsVUFBVSxHQUFHLFVBQVUsSUFBSSxXQUFXO0FBQzdDLFlBQU0sT0FBTyxLQUFLLEtBQUssT0FBTztBQUM5QixVQUFJO0FBQ0YsY0FBTSxLQUFLLE9BQU8sSUFBSTtBQUN0QixhQUFLLFlBQVk7QUFDakIsYUFBSyxjQUFjLEtBQUssS0FBSyxVQUFVLENBQUMsVUFBVSxLQUFLLFVBQVUsU0FBUyxLQUFLLENBQUM7QUFDaEYsYUFBSyxvQkFBb0IsS0FBSyxLQUFLLGtCQUFrQixDQUFDLFlBQVksS0FBSyxVQUFVLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxLQUFLO0FBQzVHLGFBQUssS0FBSyxJQUFJLG9DQUFvQyxJQUFJLEVBQUU7QUFDeEQ7QUFBQSxNQUNGLFNBQVMsT0FBTztBQUNkLFlBQUssTUFBZ0MsU0FBUyxhQUFjLE9BQU07QUFBQSxNQUNwRTtBQUFBLElBQ0Y7QUFDQSxVQUFNLElBQUksTUFBTSxxQkFBcUIsS0FBSyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssT0FBTyxDQUFDLEdBQUc7QUFBQSxFQUNqRjtBQUFBLEVBRUEsTUFBTSxPQUFzQjtBQUMxQixTQUFLLGNBQWM7QUFDbkIsU0FBSyxjQUFjO0FBQ25CLFNBQUssb0JBQW9CO0FBQ3pCLFNBQUssb0JBQW9CO0FBQ3pCLGVBQVcsVUFBVSxLQUFLLFFBQVMsUUFBTyxJQUFJO0FBQzlDLFNBQUssUUFBUSxNQUFNO0FBQ25CLFVBQU0sSUFBSSxRQUFjLENBQUNDLGFBQWEsS0FBSyxTQUFTLEtBQUssT0FBTyxNQUFNLE1BQU1BLFNBQVEsQ0FBQyxJQUFJQSxTQUFRLENBQUU7QUFDbkcsU0FBSyxTQUFTO0FBQ2QsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQSxFQUVRLE9BQU8sTUFBNkI7QUFDMUMsV0FBTyxJQUFJLFFBQVEsQ0FBQ0EsVUFBUyxXQUFXO0FBQ3RDLFlBQU0sU0FBUyxhQUFhLENBQUMsS0FBSyxRQUFRLEtBQUssS0FBSyxNQUFNLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDekUsYUFBTyxLQUFLLFNBQVMsTUFBTTtBQUMzQixhQUFPLE9BQU8sTUFBTSxhQUFhLE1BQU07QUFDckMsZUFBTyxJQUFJLFNBQVMsTUFBTTtBQUMxQixhQUFLLFNBQVM7QUFDZCxRQUFBQSxTQUFRO0FBQUEsTUFDVixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBYyxNQUFNLEtBQXNCLEtBQXFCLE1BQTZCO0FBQzFGLFFBQUksVUFBVSwwQkFBMEIsU0FBUztBQUNqRCxRQUFJLFVBQVUsbUJBQW1CLGFBQWE7QUFDOUMsUUFBSSxVQUFVLGlCQUFpQixVQUFVO0FBQ3pDLFFBQUksQ0FBQyxZQUFZLElBQUksUUFBUSxNQUFNLElBQUksRUFBRyxRQUFPLEtBQUssS0FBSyxLQUFLLFlBQVk7QUFDNUUsVUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLE9BQU8sS0FBSyxvQkFBb0IsSUFBSSxFQUFFO0FBQzlELFFBQUk7QUFDRixVQUFJLElBQUksU0FBUyxXQUFXLE9BQU8sRUFBRyxRQUFPLE1BQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLElBQUk7QUFDL0UsVUFBSSxJQUFJLFdBQVcsTUFBTyxRQUFPLEtBQUssS0FBSyxLQUFLLG9CQUFvQjtBQUNwRSxhQUFPLE1BQU0sS0FBSyxZQUFZLEtBQUssSUFBSSxVQUFVLGNBQWMsSUFBSSxRQUFRLGlCQUFpQixDQUFDLENBQUM7QUFBQSxJQUNoRyxTQUFTLE9BQU87QUFDZCxXQUFLLEtBQUssSUFBSSxvQkFBcUIsTUFBZ0IsT0FBTyxFQUFFO0FBQzVELFVBQUksQ0FBQyxJQUFJLFlBQWEsTUFBSyxLQUFLLEtBQUssZ0JBQWdCO0FBQUEsSUFDdkQ7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLElBQUksS0FBc0IsS0FBcUIsS0FBVSxNQUE2QjtBQUNsRyxVQUFNLE9BQU8sSUFBSSxRQUFRLGVBQWUsUUFBUSxlQUFlLEVBQUU7QUFDakUsUUFBSSxDQUFDLFlBQVksS0FBSyxLQUFLLE9BQU8sSUFBSSxFQUFHLFFBQU8sU0FBUyxLQUFLLEtBQUssRUFBRSxJQUFJLE9BQU8sT0FBTyxFQUFFLE1BQU0sZ0JBQWdCLFNBQVMsMEJBQTBCLEVBQUUsQ0FBQztBQUNySixRQUFJLElBQUksYUFBYSxtQkFBbUIsSUFBSSxXQUFXLE1BQU8sUUFBTyxTQUFTLEtBQUssS0FBSyxLQUFLLEtBQUssU0FBUyxDQUFDO0FBQzVHLFFBQUksSUFBSSxhQUFhLGlCQUFpQixJQUFJLFdBQVcsTUFBTyxRQUFPLEtBQUssV0FBVyxLQUFLLEdBQUc7QUFDM0YsUUFBSSxJQUFJLGFBQWEsa0JBQWtCLElBQUksV0FBVyxRQUFRO0FBQzVELFlBQU0sU0FBUyxJQUFJLFFBQVE7QUFDM0IsVUFBSSxVQUFVLFdBQVcsb0JBQW9CLElBQUksTUFBTSxXQUFXLG9CQUFvQixJQUFJLEdBQUksUUFBTyxTQUFTLEtBQUssS0FBSyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxhQUFhLFNBQVMsZ0NBQWdDLEVBQUUsQ0FBQztBQUM3TSxVQUFJLEVBQUUsSUFBSSxRQUFRLGNBQWMsS0FBSyxJQUFJLFdBQVcsa0JBQWtCLEVBQUcsUUFBTyxTQUFTLEtBQUssS0FBSyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxxQkFBcUIsU0FBUyxhQUFhLEVBQUUsQ0FBQztBQUM3SyxVQUFJO0FBQ0osVUFBSTtBQUNGLGVBQU8sTUFBTSxTQUFTLEdBQUc7QUFBQSxNQUMzQixRQUFRO0FBQ04sZUFBTyxTQUFTLEtBQUssS0FBSyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxhQUFhLFNBQVMsMEJBQTBCLEVBQUUsQ0FBQztBQUFBLE1BQzNHO0FBQ0EsVUFBSTtBQUNKLFVBQUk7QUFDRixpQkFBUyxLQUFLLE1BQU0sSUFBSTtBQUFBLE1BQzFCLFFBQVE7QUFDTixlQUFPLFNBQVMsS0FBSyxLQUFLLEVBQUUsSUFBSSxPQUFPLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixTQUFTLG9CQUFvQixFQUFFLENBQUM7QUFBQSxNQUMxRztBQUNBLFlBQU0sV0FBVyxLQUFLLEtBQUssY0FBYztBQUN6QyxZQUFNLFNBQVMsTUFBTSxLQUFLLEtBQUssUUFBUSxRQUFRLENBQUMsU0FBUyxTQUFTLHNCQUFzQixTQUFTLHlCQUF5QixZQUFZLG1CQUFtQixJQUFJLElBQUksRUFBRTtBQUNuSyxhQUFPLFNBQVMsS0FBSyxLQUFLLE1BQU07QUFBQSxJQUNsQztBQUNBLFdBQU8sU0FBUyxLQUFLLEtBQUssRUFBRSxJQUFJLE9BQU8sT0FBTyxFQUFFLE1BQU0sYUFBYSxTQUFTLG9CQUFvQixFQUFFLENBQUM7QUFBQSxFQUNyRztBQUFBLEVBRVEsV0FBVyxLQUFzQixLQUEyQjtBQUNsRSxRQUFJLEtBQUssUUFBUSxRQUFRLFlBQWEsUUFBTyxTQUFTLEtBQUssS0FBSyxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsTUFBTSxvQkFBb0IsU0FBUyw0QkFBNEIsRUFBRSxDQUFDO0FBQ3hKLFFBQUksVUFBVSxLQUFLLEVBQUUsZ0JBQWdCLHFCQUFxQixpQkFBaUIsWUFBWSxZQUFZLGFBQWEsQ0FBQztBQUNqSCxRQUFJLE1BQU07QUFBQTtBQUFBO0FBQUEsQ0FBNEI7QUFDdEMsU0FBSyxRQUFRLElBQUksR0FBRztBQUNwQixVQUFNLFlBQVksWUFBWSxNQUFNLElBQUksTUFBTTtBQUFBO0FBQUEsQ0FBWSxHQUFHLElBQUs7QUFDbEUsUUFBSSxHQUFHLFNBQVMsTUFBTTtBQUNwQixvQkFBYyxTQUFTO0FBQ3ZCLFdBQUssUUFBUSxPQUFPLEdBQUc7QUFBQSxJQUN6QixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsVUFBVSxPQUEyQixNQUE2QztBQUN4RixRQUFJLENBQUMsS0FBSyxRQUFRLEtBQU07QUFDeEIsVUFBTSxVQUFVLFVBQVUsS0FBSztBQUFBLFFBQVcsS0FBSyxVQUFVLElBQUksQ0FBQztBQUFBO0FBQUE7QUFDOUQsZUFBVyxVQUFVLEtBQUssUUFBUyxRQUFPLE1BQU0sT0FBTztBQUFBLEVBQ3pEO0FBQUEsRUFFUSxjQUFjLG9CQUFJLElBQXNEO0FBQUE7QUFBQSxFQUdoRixNQUFjLFdBQVcsTUFBc0M7QUFDN0QsUUFBSSxDQUFDLHVCQUF1QixLQUFLLElBQUksRUFBRyxRQUFPO0FBQy9DLFVBQU0sU0FBUyxNQUFNQyxNQUFLLElBQUksR0FBRztBQUNqQyxVQUFNLE1BQU0sS0FBSyxZQUFZLElBQUksSUFBSTtBQUNyQyxRQUFJLE9BQU8sSUFBSSxVQUFVLE1BQU8sUUFBTyxJQUFJO0FBQzNDLFVBQU0sT0FBT0MsVUFBUyxJQUFJLEVBQUUsS0FBSyxDQUFDLFFBQVEsT0FBTyxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUNDLFdBQVUsb0JBQW9CLEdBQUcsR0FBRyxDQUFDQSxXQUFVLHNCQUFzQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUMsQ0FBQztBQUMxSixTQUFLLFlBQVksSUFBSSxNQUFNLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFDMUMsU0FBSyxNQUFNLE1BQU0sS0FBSyxZQUFZLE9BQU8sSUFBSSxDQUFDO0FBQzlDLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFjLFlBQVksS0FBcUIsVUFBa0JDLFNBQWdDO0FBQy9GLFVBQU0sT0FBTyxhQUFhLE1BQU0sbUJBQW1CLFNBQVMsUUFBUSxRQUFRLEVBQUU7QUFDOUUsUUFBSSxDQUFDLGFBQWEsSUFBSSxJQUFJLEtBQUssQ0FBQyxXQUFXLEtBQUssSUFBSSxFQUFHLFFBQU8sS0FBSyxLQUFLLEtBQUssV0FBVztBQUN4RixVQUFNLE9BQU9KLFNBQVEsS0FBSyxLQUFLLEtBQUs7QUFDcEMsVUFBTSxPQUFPQSxTQUFRLE1BQU0sSUFBSTtBQUMvQixRQUFJLENBQUMsS0FBSyxXQUFXLE9BQU8sR0FBRyxFQUFHLFFBQU8sS0FBSyxLQUFLLEtBQUssV0FBVztBQUNuRSxRQUFJO0FBQ0osUUFBSSxVQUFVO0FBQ2QsUUFBSTtBQUVGLFlBQU0sYUFBYUksVUFBUyxNQUFNLEtBQUssV0FBVyxJQUFJLElBQUk7QUFDMUQsVUFBSSxZQUFZO0FBQ2QsZUFBTztBQUNQLGtCQUFVO0FBQUEsTUFDWixNQUFPLFFBQU8sTUFBTUYsVUFBUyxJQUFJO0FBQUEsSUFDbkMsUUFBUTtBQUNOLGFBQU8sS0FBSyxLQUFLLEtBQUssV0FBVztBQUFBLElBQ25DO0FBQ0EsUUFBSSxVQUFVLEtBQUs7QUFBQSxNQUNqQixHQUFJLFVBQVUsRUFBRSxvQkFBb0IsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUM5QyxNQUFNO0FBQUEsTUFDTixnQkFBZ0IsS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLO0FBQUEsTUFDdkMsMkJBQTJCO0FBQUEsTUFDM0IsbUJBQW1CO0FBQUE7QUFBQSxNQUVuQixpQkFBaUIsV0FBVyxLQUFLLElBQUksSUFBSSx3Q0FBd0M7QUFBQSxJQUNuRixDQUFDO0FBQ0QsUUFBSSxJQUFJLElBQUk7QUFBQSxFQUNkO0FBQ0Y7QUFFTyxTQUFTLGNBQWMsUUFBZ0Q7QUFDNUUsUUFBTSxRQUFRLE1BQU0sUUFBUSxNQUFNLElBQUksT0FBTyxLQUFLLEdBQUcsSUFBSyxVQUFVO0FBQ3BFLFNBQU8sTUFBTSxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsU0FBUztBQUNyQyxVQUFNLENBQUMsTUFBTSxHQUFHLE1BQU0sSUFBSSxLQUFLLEtBQUssRUFBRSxNQUFNLEdBQUc7QUFDL0MsUUFBSSxLQUFLLEtBQUssRUFBRSxZQUFZLE1BQU0sS0FBTSxRQUFPO0FBQy9DLFVBQU0sSUFBSSxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRSxXQUFXLElBQUksQ0FBQztBQUNwRSxXQUFPLENBQUMsS0FBSyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUMsSUFBSTtBQUFBLEVBQ3BDLENBQUM7QUFDSDtBQUVBLFNBQVMsS0FBSyxLQUFxQixRQUFnQixNQUFvQjtBQUNyRSxNQUFJLFVBQVUsUUFBUSxFQUFFLGdCQUFnQiw0QkFBNEIsQ0FBQztBQUNyRSxNQUFJLElBQUksSUFBSTtBQUNkO0FBRUEsU0FBUyxTQUFTLEtBQXFCLFFBQWdCLE9BQXNCO0FBQzNFLE1BQUksVUFBVSxRQUFRLEVBQUUsZ0JBQWdCLGtDQUFrQyxDQUFDO0FBQzNFLE1BQUksSUFBSSxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQy9CO0FBRUEsU0FBUyxTQUFTLEtBQXVDO0FBQ3ZELFNBQU8sSUFBSSxRQUFRLENBQUNGLFVBQVMsV0FBVztBQUN0QyxRQUFJLE9BQU87QUFDWCxVQUFNLFNBQW1CLENBQUM7QUFDMUIsUUFBSSxHQUFHLFFBQVEsQ0FBQyxVQUFrQjtBQUNoQyxjQUFRLE1BQU07QUFHZCxVQUFJLE9BQU8sVUFBVyxLQUFJLFFBQVE7QUFBQSxlQUN6QixRQUFRLFNBQVUsUUFBTyxLQUFLLEtBQUs7QUFBQSxJQUM5QyxDQUFDO0FBQ0QsUUFBSSxHQUFHLE9BQU8sTUFBTyxPQUFPLFdBQVcsT0FBTyxJQUFJLE1BQU0sZ0JBQWdCLENBQUMsSUFBSUEsU0FBUSxPQUFPLE9BQU8sTUFBTSxFQUFFLFNBQVMsTUFBTSxDQUFDLENBQUU7QUFDN0gsUUFBSSxHQUFHLFNBQVMsTUFBTTtBQUFBLEVBQ3hCLENBQUM7QUFDSDs7O0FDbE9PLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQUczQixZQUNtQixPQUNBLGFBQ0EsS0FDakI7QUFIaUI7QUFDQTtBQUNBO0FBQUEsRUFDaEI7QUFBQSxFQU5LLGVBQWUsb0JBQUksSUFBb0I7QUFBQSxFQVEvQyxNQUFNLGtCQUFpQztBQUNyQyxVQUFNLFFBQVEsS0FBSyxNQUFNLEtBQUs7QUFDOUIsZUFBVyxPQUFPLE9BQU8sT0FBTyxNQUFNLElBQUksR0FBRztBQUMzQyxZQUFNLFFBQVEsT0FBTyxPQUFPLE1BQU0sS0FBSyxFQUFFLE9BQU8sQ0FBQyxTQUFTLEtBQUssVUFBVSxJQUFJLEVBQUU7QUFDL0UsVUFBSSxDQUFDLE1BQU0sT0FBUTtBQUNuQixZQUFNLFNBQVMsT0FBTyxPQUFPLE1BQU0sTUFBTSxFQUFFLE9BQU8sQ0FBQyxVQUFVLE1BQU0sVUFBVSxJQUFJLEVBQUU7QUFDbkYsWUFBTSxjQUFjLEdBQUcsSUFBSSxPQUFPLElBQUksSUFBSSxLQUFLLElBQUksTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsQ0FBQyxJQUFJLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFDbEksVUFBSSxLQUFLLGFBQWEsSUFBSSxJQUFJLEVBQUUsTUFBTSxZQUFhO0FBQ25ELFlBQU0sTUFBTSxvQkFBSSxJQUFZLENBQUMsSUFBSSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsR0FBRyxHQUFHLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUMzRixZQUFNLFNBQTJCO0FBQUEsUUFDL0IsU0FBUztBQUFBLFFBQ1QsU0FBUyxLQUFLLElBQUk7QUFBQSxRQUNsQjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQSxVQUFVLE1BQU0sU0FBUyxPQUFPLENBQUMsWUFBWSxRQUFRLFVBQVUsSUFBSSxFQUFFO0FBQUEsUUFDckUsUUFBUSxLQUFLLE1BQU0sT0FBTyxFQUFFLE9BQU8sQ0FBQyxVQUFVLE1BQU0sVUFBVSxJQUFJLE1BQU0sSUFBSSxJQUFJLE1BQU0sUUFBUSxDQUFDO0FBQUEsTUFDakc7QUFDQSxVQUFJO0FBQ0YsY0FBTSxLQUFLLFlBQVksUUFBUSxNQUFNO0FBQ3JDLGFBQUssYUFBYSxJQUFJLElBQUksSUFBSSxXQUFXO0FBQUEsTUFDM0MsU0FBUyxPQUFPO0FBQ2QsYUFBSyxJQUFJLDJCQUEyQixJQUFJLEVBQUUsS0FBTSxNQUFnQixPQUFPLEVBQUU7QUFBQSxNQUMzRTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7OztBQ3BDQSxTQUFTLFlBQUFLLFdBQVUsUUFBQUMsYUFBWTtBQUMvQixTQUFTLFFBQUFDLGFBQVk7QUFFckIsSUFBTSxRQUFRLG9CQUFJLElBQTJCO0FBRTdDLGVBQXNCLFdBQVcsY0FBOEM7QUFDN0UsTUFBSSxNQUFNLElBQUksWUFBWSxFQUFHLFFBQU8sTUFBTSxJQUFJLFlBQVk7QUFDMUQsTUFBSSxPQUFzQjtBQUMxQixNQUFJO0FBQ0YsVUFBTSxTQUFTQSxNQUFLLGNBQWMsTUFBTTtBQUN4QyxVQUFNLE9BQU8sTUFBTUQsTUFBSyxNQUFNO0FBQzlCLFFBQUksS0FBSyxZQUFZLEVBQUcsUUFBTztBQUFBLFNBQzFCO0FBQ0gsWUFBTSxPQUFPLE1BQU1ELFVBQVMsUUFBUSxNQUFNO0FBQzFDLFlBQU0sU0FBUyxvQkFBb0IsS0FBSyxJQUFJLElBQUksQ0FBQyxHQUFHLEtBQUs7QUFDekQsWUFBTSxTQUFTLFNBQVMsT0FBTyxZQUFZLFFBQVEsSUFBSTtBQUN2RCxVQUFJLFVBQVUsU0FBUyxFQUFHLFFBQU8sT0FBTyxNQUFNLEdBQUcsTUFBTTtBQUFBLElBQ3pEO0FBQUEsRUFDRixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDQSxRQUFNLElBQUksY0FBYyxJQUFJO0FBQzVCLE1BQUksTUFBTSxPQUFPLElBQU0sT0FBTSxPQUFPLE1BQU0sS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFlO0FBQ3ZFLFNBQU87QUFDVDs7O0FDekJBLFNBQVMsU0FBQUcsUUFBTyxXQUFBQyxVQUFTLFlBQUFDLFdBQVUsUUFBUSxJQUFJLFFBQUFDLE9BQU0sYUFBQUMsa0JBQWlCO0FBQ3RFLFNBQVMsV0FBQUMsVUFBUyxZQUFBQyxpQkFBZ0I7QUFDbEMsU0FBUyxRQUFBQyxhQUFZO0FBSXJCLElBQU1DLFlBQVc7QUFDakIsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxnQkFBZ0I7QUFDdEIsSUFBTSxjQUFjO0FBY2IsU0FBUyxXQUFtQjtBQUNqQyxRQUFNLE9BQU9ILFNBQVE7QUFDckIsTUFBSUMsVUFBUyxNQUFNLFNBQVUsUUFBT0MsTUFBSyxNQUFNLDZDQUE2QztBQUM1RixNQUFJRCxVQUFTLE1BQU0sUUFBUyxRQUFPQyxNQUFLLFFBQVEsSUFBSSxXQUFXQSxNQUFLLE1BQU0saUJBQWlCLEdBQUcsaUJBQWlCO0FBQy9HLFNBQU9BLE1BQUssUUFBUSxJQUFJLGtCQUFrQkEsTUFBSyxNQUFNLGNBQWMsR0FBRyxpQkFBaUI7QUFDekY7QUFFTyxJQUFNLGNBQU4sTUFBa0I7QUFBQSxFQUl2QixZQUE2QixNQUFNLFNBQVMsR0FBRztBQUFsQjtBQUMzQixTQUFLLGFBQWFBLE1BQUssS0FBSyxTQUFTO0FBQUEsRUFDdkM7QUFBQSxFQUxRO0FBQUEsRUFDQSxrQkFBa0I7QUFBQSxFQU0xQixNQUFNLE9BQXNCO0FBQzFCLFVBQU1QLE9BQU0sS0FBSyxZQUFZLEVBQUUsV0FBVyxNQUFNLE1BQU0sSUFBTSxDQUFDO0FBQUEsRUFDL0Q7QUFBQSxFQUVBLE1BQU0sZUFBNkM7QUFDakQsUUFBSTtBQUNGLFlBQU0sU0FBUyxLQUFLLE1BQU0sTUFBTUUsVUFBU0ssTUFBSyxLQUFLLEtBQUssYUFBYSxHQUFHLE1BQU0sQ0FBQztBQUMvRSxhQUFPLFFBQVEsU0FBUyxPQUFPLE9BQU8sTUFBTSxRQUFRLFdBQVcsU0FBUztBQUFBLElBQzFFLFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sYUFBYSxVQUF1QztBQUN4RCxVQUFNLFlBQVlBLE1BQUssS0FBSyxLQUFLLGFBQWEsR0FBRyxLQUFLLFVBQVUsUUFBUSxDQUFDO0FBQUEsRUFDM0U7QUFBQSxFQUVBLE1BQU0sUUFBUSxRQUF5QztBQUNyRCxVQUFNLFVBQVUsRUFBRSxHQUFHLFFBQVEsUUFBUSxPQUFPLE9BQU8sTUFBTSxDQUFDLGNBQWMsRUFBRTtBQUMxRSxVQUFNLFlBQVlBLE1BQUssS0FBSyxZQUFZLEdBQUcsU0FBUyxPQUFPLElBQUksRUFBRSxDQUFDLE9BQU8sR0FBRyxLQUFLLFVBQVUsT0FBTyxDQUFDO0FBRW5HLFFBQUksS0FBSyxvQkFBb0IsZ0JBQWdCLEVBQUcsT0FBTSxLQUFLLE1BQU07QUFBQSxFQUNuRTtBQUFBLEVBRUEsTUFBTSxXQUF5QztBQUM3QyxVQUFNLE1BQTJCLENBQUM7QUFDbEMsZUFBVyxRQUFRLE1BQU0sS0FBSyxNQUFNLEdBQUc7QUFDckMsVUFBSTtBQUNGLGNBQU0sU0FBUyxLQUFLLE1BQU0sTUFBTUwsVUFBU0ssTUFBSyxLQUFLLFlBQVksSUFBSSxHQUFHLE1BQU0sQ0FBQztBQUM3RSxjQUFNLEVBQUUsSUFBSSxXQUFXLE9BQU8sV0FBVyxTQUFTLFVBQVUsSUFBSSxPQUFPO0FBQ3ZFLFlBQUksS0FBSyxFQUFFLElBQUksV0FBVyxPQUFPLFdBQVcsU0FBUyxXQUFXLFNBQVMsT0FBTyxRQUFRLENBQUM7QUFBQSxNQUMzRixRQUFRO0FBQUEsTUFFUjtBQUFBLElBQ0Y7QUFDQSxXQUFPLElBQUksS0FBSyxDQUFDLEdBQUcsT0FBTyxFQUFFLGFBQWEsRUFBRSxZQUFZLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxNQUFNLEdBQUdDLFNBQVE7QUFBQSxFQUN0RztBQUFBLEVBRUEsTUFBTSxRQUFRLE9BQWlEO0FBQzdELFFBQUk7QUFDRixhQUFPLEtBQUssTUFBTSxNQUFNTixVQUFTSyxNQUFLLEtBQUssWUFBWSxHQUFHLFNBQVMsS0FBSyxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUM7QUFBQSxJQUM1RixRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFFBQTJCO0FBQ3ZDLFFBQUk7QUFDRixjQUFRLE1BQU1OLFNBQVEsS0FBSyxVQUFVLEdBQUcsT0FBTyxDQUFDLFNBQVMsS0FBSyxTQUFTLE9BQU8sQ0FBQztBQUFBLElBQ2pGLFFBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxRQUF1QjtBQUNuQyxVQUFNLFFBQVEsTUFBTSxLQUFLLE1BQU07QUFDL0IsUUFBSSxNQUFNLFVBQVVPLFVBQVU7QUFDOUIsVUFBTSxZQUFZLE1BQU0sUUFBUSxJQUFJLE1BQU0sSUFBSSxPQUFPLFVBQVUsRUFBRSxNQUFNLFFBQVEsTUFBTUwsTUFBS0ksTUFBSyxLQUFLLFlBQVksSUFBSSxDQUFDLEdBQUcsUUFBUSxFQUFFLENBQUM7QUFDbkksY0FBVSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUs7QUFDMUMsZUFBVyxFQUFFLEtBQUssS0FBSyxVQUFVLE1BQU0sR0FBRyxNQUFNLFNBQVNDLFNBQVEsRUFBRyxPQUFNLEdBQUdELE1BQUssS0FBSyxZQUFZLElBQUksR0FBRyxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQUEsRUFDM0g7QUFDRjtBQUVPLFNBQVMsU0FBUyxJQUFvQjtBQUMzQyxTQUFPLEdBQUcsUUFBUSxvQkFBb0IsR0FBRyxFQUFFLE1BQU0sR0FBRyxHQUFHO0FBQ3pEO0FBRUEsZUFBZSxZQUFZLE1BQWMsTUFBNkI7QUFDcEUsUUFBTSxNQUFNLEdBQUcsSUFBSSxJQUFJLFFBQVEsR0FBRztBQUNsQyxRQUFNSCxXQUFVLEtBQUssTUFBTSxFQUFFLE1BQU0sSUFBTSxDQUFDO0FBQzFDLFFBQU0sT0FBTyxLQUFLLElBQUk7QUFDeEI7OztBQ3RDTyxJQUFNLGVBQWU7QUFDckIsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxlQUFlO0FBR3JCLFNBQVMsV0FBVyxPQUFrQixPQUEwQjtBQUNyRSxVQUFRLE1BQU0sUUFBUTtBQUFBLElBQ3BCLEtBQUs7QUFDSCxrQkFBWSxNQUFNLFFBQVEsTUFBTSxJQUFJLE1BQU0sS0FBSztBQUMvQztBQUFBLElBQ0YsS0FBSztBQUNILGtCQUFZLE1BQU0sT0FBTyxNQUFNLElBQUksTUFBTSxLQUFLO0FBQzlDO0FBQUEsSUFDRixLQUFLO0FBQ0gsa0JBQVksTUFBTSxNQUFNLE1BQU0sSUFBSSxNQUFNLEtBQUs7QUFDN0M7QUFBQSxJQUNGLEtBQUs7QUFDSCxrQkFBWSxNQUFNLE9BQU8sTUFBTSxJQUFJLE1BQU0sS0FBSztBQUM5QztBQUFBLElBQ0YsS0FBSztBQUNILGtCQUFZLE1BQU0sV0FBVyxNQUFNLElBQUksTUFBTSxLQUFLO0FBQ2xEO0FBQUEsSUFDRixLQUFLO0FBQ0gsa0JBQVksTUFBTSxVQUFVLE1BQU0sSUFBSSxNQUFNLEtBQUs7QUFDakQ7QUFBQSxJQUNGLEtBQUs7QUFFSCxZQUFNLGFBQWEsQ0FBQztBQUNwQixrQkFBWSxNQUFNLFVBQVUsTUFBTSxJQUFJLE1BQU0sS0FBSztBQUNqRDtBQUFBLElBQ0YsS0FBSyxXQUFXO0FBQ2QsWUFBTSxRQUFRLE1BQU0sU0FBUyxVQUFVLENBQUMsWUFBWSxRQUFRLE9BQU8sTUFBTSxFQUFFO0FBQzNFLFVBQUksU0FBUyxFQUFHLE9BQU0sU0FBUyxLQUFLLElBQUksTUFBTTtBQUFBLFVBQ3pDLE9BQU0sU0FBUyxLQUFLLE1BQU0sS0FBSztBQUNwQyxVQUFJLE1BQU0sU0FBUyxTQUFTLGFBQWMsT0FBTSxTQUFTLE9BQU8sR0FBRyxNQUFNLFNBQVMsU0FBUyxZQUFZO0FBQ3ZHO0FBQUEsSUFDRjtBQUFBLElBQ0EsS0FBSyxZQUFZO0FBQ2YsWUFBTSxRQUFRLE1BQU0sVUFBVSxVQUFVLENBQUMsU0FBUyxLQUFLLE9BQU8sTUFBTSxFQUFFO0FBQ3RFLFVBQUksU0FBUyxFQUFHLE9BQU0sVUFBVSxLQUFLLElBQUksTUFBTTtBQUFBLFVBQzFDLE9BQU0sVUFBVSxLQUFLLE1BQU0sS0FBSztBQUNyQyxVQUFJLE1BQU0sVUFBVSxTQUFTLGVBQWdCLE9BQU0sVUFBVSxPQUFPLEdBQUcsTUFBTSxVQUFVLFNBQVMsY0FBYztBQUM5RztBQUFBLElBQ0Y7QUFBQSxJQUNBLEtBQUs7QUFDSCxZQUFNLGVBQWUsTUFBTTtBQUMzQjtBQUFBLElBQ0YsS0FBSztBQUNILFlBQU0sU0FBUyxNQUFNO0FBQ3JCO0FBQUEsRUFDSjtBQUNGO0FBRUEsU0FBUyxZQUFlLEtBQXdCLElBQVksT0FBdUI7QUFDakYsTUFBSSxVQUFVLEtBQU0sUUFBTyxJQUFJLEVBQUU7QUFBQSxNQUM1QixLQUFJLEVBQUUsSUFBSTtBQUNqQjs7O0FDeEhBLElBQU0sZUFBZTtBQUNyQixJQUFNLGFBQWEsb0JBQUksSUFBSSxDQUFDLFNBQVMsUUFBUSxXQUFXLGNBQWMsU0FBUyxDQUFDO0FBRXpFLElBQU0sWUFBTixNQUFnQjtBQUFBLEVBYXJCLFlBQTZCLFVBQVUsS0FBSztBQUFmO0FBQUEsRUFBZ0I7QUFBQSxFQVpyQyxRQUFtQixXQUFXO0FBQUEsRUFDOUIsV0FBd0IsQ0FBQztBQUFBLEVBQ3pCLGlCQUFpQixvQkFBSSxJQUF5QjtBQUFBLEVBQzlDLGdCQUE2QixDQUFDO0FBQUEsRUFDOUIsaUJBQWlCO0FBQUEsRUFDakIsWUFBWSxvQkFBSSxJQUFjO0FBQUEsRUFDOUIsZUFBZSxvQkFBSSxJQUFZO0FBQUE7QUFBQSxFQUUvQixrQkFBa0Isb0JBQUksSUFBb0I7QUFBQSxFQUMxQyxhQUFtRDtBQUFBLEVBQ25ELGVBQWU7QUFBQSxFQUl2QixJQUFJLE1BQWM7QUFDaEIsV0FBTyxLQUFLLE1BQU07QUFBQSxFQUNwQjtBQUFBLEVBRUEsT0FBNEI7QUFDMUIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBLEVBRUEsV0FBeUI7QUFDdkIsU0FBSyxTQUFTO0FBQ2QsV0FBTyxFQUFFLE9BQU8sZ0JBQWdCLEtBQUssS0FBSyxHQUFHLFFBQVEsS0FBSyxTQUFTLE1BQU0sQ0FBQyxZQUFZLEVBQUU7QUFBQSxFQUMxRjtBQUFBLEVBRUEsU0FBK0I7QUFDN0IsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBLEVBRUEsVUFBVSxVQUFnQztBQUN4QyxTQUFLLFVBQVUsSUFBSSxRQUFRO0FBQzNCLFdBQU8sTUFBTSxLQUFLLFVBQVUsT0FBTyxRQUFRO0FBQUEsRUFDN0M7QUFBQTtBQUFBLEVBR0EsUUFBUSxVQUE4QjtBQUNwQyxVQUFNLFdBQVcsU0FBUztBQUMxQixlQUFXLFNBQVMsT0FBTyxPQUFPLFNBQVMsTUFBTSxHQUFHO0FBRWxELFlBQU0sT0FBTztBQUNiLFVBQUksTUFBTSxVQUFVLGFBQWEsTUFBTSxVQUFVLGFBQWEsTUFBTSxVQUFVLFVBQVcsT0FBTSxRQUFRO0FBQUEsSUFDekc7QUFDQSxTQUFLLFFBQVEsRUFBRSxHQUFHLFVBQVUsVUFBVSxTQUFTLFlBQVksQ0FBQyxHQUFHLFFBQVEsRUFBRSxHQUFHLGNBQWMsR0FBRyxTQUFTLE9BQU8sR0FBRyxLQUFLLEtBQUssSUFBSSxTQUFTLEtBQUssS0FBSyxNQUFNLEdBQUcsSUFBSSxFQUFFO0FBQ2hLLFNBQUssV0FBVyxTQUFTLE9BQU8sTUFBTSxDQUFDLFlBQVk7QUFDbkQsZUFBVyxTQUFTLEtBQUssU0FBVSxNQUFLLGFBQWEsSUFBSSxNQUFNLEVBQUU7QUFDakUsU0FBSyxVQUFVO0FBQUEsRUFDakI7QUFBQTtBQUFBLEVBR0EsWUFBWSxJQUFZLFlBQW9CLFNBQStCLFFBQXdDO0FBQ2pILFVBQU0sV0FBVyxLQUFLLE1BQU0sT0FBTyxFQUFFO0FBQ3JDLFVBQU0sT0FBTyxZQUFZLE9BQU87QUFDaEMsVUFBTSxPQUFvQixFQUFFLEdBQUcsS0FBSztBQUNwQyxVQUFNLGVBQWUsT0FBTyxLQUFLLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxXQUFXLElBQUksR0FBRyxLQUFLLFFBQVEsR0FBd0IsTUFBTSxNQUFTO0FBQzlILFVBQU0sZUFBZSxLQUFLLGdCQUFnQixJQUFJLEVBQUUsS0FBSztBQUVyRCxVQUFNLFFBQVEsZ0JBQWdCLGFBQWE7QUFDM0MsZUFBVyxDQUFDLEtBQUssS0FBSyxLQUFLLE9BQU8sUUFBUSxPQUFPLEdBQXFDO0FBQ3BGLFVBQUksVUFBVSxVQUFhLFFBQVEsV0FBWTtBQUMvQyxVQUFJLFNBQVMsV0FBVyxJQUFJLEdBQUcsRUFBRztBQUNqQyxNQUFDLEtBQWlDLEdBQUcsSUFBSTtBQUFBLElBQzVDO0FBQ0EsUUFBSSxRQUFRLFNBQVUsTUFBSyxXQUFXLENBQUMsR0FBRyxvQkFBSSxJQUFJLENBQUMsR0FBSSxLQUFLLFlBQVksQ0FBQyxHQUFJLEdBQUcsUUFBUSxRQUFRLENBQUMsQ0FBQztBQUNsRyxTQUFLLGFBQWEsS0FBSyxJQUFJLEtBQUssY0FBYyxHQUFHLFVBQVU7QUFDM0QsUUFBSSxnQkFBZ0IsQ0FBQyxNQUFPLE1BQUssZ0JBQWdCLElBQUksSUFBSSxVQUFVO0FBQ25FLFFBQUksWUFBWSxXQUFXLFVBQVUsSUFBSSxFQUFHLFFBQU87QUFDbkQsU0FBSyxXQUFXLEtBQUssV0FBVyxLQUFLO0FBQ3JDLFNBQUssTUFBTSxFQUFFLFFBQVEsU0FBUyxJQUFJLE9BQU8sS0FBSyxDQUFDO0FBQy9DLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxXQUFXLE1BQThCO0FBQ3ZDLFVBQU0sV0FBVyxLQUFLLE1BQU0sTUFBTSxLQUFLLEVBQUU7QUFDekMsUUFBSSxZQUFZLFdBQVcsVUFBVSxFQUFFLEdBQUcsTUFBTSxTQUFTLFNBQVMsUUFBUSxDQUFDLEVBQUcsUUFBTztBQUNyRixVQUFNLE9BQU8sRUFBRSxHQUFHLE1BQU0sVUFBVSxVQUFVLFdBQVcsS0FBSyxFQUFFO0FBQzlELFNBQUssTUFBTSxFQUFFLFFBQVEsUUFBUSxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssQ0FBQztBQUN2RCxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxJQUFJLE9BQTBCO0FBQzVCLFVBQU0sVUFBVSxLQUFLLGFBQWEsS0FBSztBQUN2QyxRQUFJLFlBQVksVUFBYSxNQUFNLFVBQVUsUUFBUSxXQUFXLFNBQVMsTUFBTSxLQUFLLEVBQUc7QUFDdkYsUUFBSSxZQUFZLFVBQWEsTUFBTSxVQUFVLEtBQU07QUFDbkQsU0FBSyxNQUFNLEtBQUs7QUFBQSxFQUNsQjtBQUFBLEVBRUEsWUFBWSxJQUFrQjtBQUM1QixRQUFJLENBQUMsS0FBSyxNQUFNLE9BQU8sRUFBRSxFQUFHO0FBQzVCLFNBQUssZ0JBQWdCLE9BQU8sRUFBRTtBQUM5QixTQUFLLE1BQU0sRUFBRSxRQUFRLFNBQVMsSUFBSSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ2pEO0FBQUEsRUFFQSxLQUFLLE9BQXFDO0FBQ3hDLFVBQU0sS0FBSyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksSUFBSSxNQUFNLFFBQVEsSUFBSSxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssWUFBWTtBQUN6RixRQUFJLEtBQUssYUFBYSxJQUFJLEVBQUUsRUFBRyxRQUFPO0FBQ3RDLFNBQUssYUFBYSxJQUFJLEVBQUU7QUFDeEIsUUFBSSxLQUFLLGFBQWEsT0FBTyxjQUFjO0FBQ3pDLFlBQU0sUUFBUSxLQUFLLGFBQWEsT0FBTyxFQUFFLEtBQUssRUFBRTtBQUNoRCxVQUFJLFVBQVUsT0FBVyxNQUFLLGFBQWEsT0FBTyxLQUFLO0FBQUEsSUFDekQ7QUFDQSxVQUFNLFFBQW1CLEVBQUUsR0FBRyxPQUFPLElBQUksS0FBSyxLQUFLLFFBQVEsRUFBRTtBQUM3RCxTQUFLLFNBQVMsS0FBSyxLQUFLO0FBQ3hCLFFBQUksS0FBSyxTQUFTLFNBQVMsZUFBZSxFQUFHLE1BQUssU0FBUyxPQUFPLEdBQUcsS0FBSyxTQUFTLFNBQVMsWUFBWTtBQUN4RyxTQUFLLGNBQWMsS0FBSyxLQUFLO0FBQzdCLFNBQUssY0FBYztBQUNuQixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsU0FBUyxNQUFxQixVQUEyQjtBQUN2RCxXQUFPLEtBQUssU0FBUyxLQUFLLENBQUMsVUFBVSxNQUFNLFNBQVMsUUFBUSxNQUFNLGFBQWEsUUFBUTtBQUFBLEVBQ3pGO0FBQUEsRUFFQSxXQUFpQjtBQUNmLFFBQUksS0FBSyxZQUFZO0FBQ25CLG1CQUFhLEtBQUssVUFBVTtBQUM1QixXQUFLLGFBQWE7QUFBQSxJQUNwQjtBQUNBLFFBQUksS0FBSyxlQUFlLFNBQVMsS0FBSyxLQUFLLGNBQWMsV0FBVyxFQUFHO0FBQ3ZFLFVBQU0sUUFBbUI7QUFBQSxNQUN2QixTQUFTLEtBQUs7QUFBQSxNQUNkLE9BQU8sS0FBSyxNQUFNO0FBQUEsTUFDbEIsU0FBUyxDQUFDLEdBQUcsS0FBSyxlQUFlLE9BQU8sQ0FBQztBQUFBLE1BQ3pDLFFBQVEsS0FBSztBQUFBLElBQ2Y7QUFDQSxTQUFLLGlCQUFpQixvQkFBSSxJQUFJO0FBQzlCLFNBQUssZ0JBQWdCLENBQUM7QUFDdEIsU0FBSyxpQkFBaUIsS0FBSyxNQUFNO0FBQ2pDLGVBQVcsWUFBWSxLQUFLLFdBQVc7QUFDckMsVUFBSTtBQUNGLGlCQUFTLEtBQUs7QUFBQSxNQUNoQixRQUFRO0FBQUEsTUFFUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxVQUFnQjtBQUNkLFFBQUksS0FBSyxXQUFZLGNBQWEsS0FBSyxVQUFVO0FBQ2pELFNBQUssVUFBVSxNQUFNO0FBQUEsRUFDdkI7QUFBQSxFQUVRLE1BQU0sT0FBMEI7QUFDdEMsZUFBVyxLQUFLLE9BQU8sS0FBSztBQUM1QixTQUFLLFFBQVE7QUFDYixTQUFLLGVBQWUsSUFBSSxHQUFHLE1BQU0sTUFBTSxJQUFJLE1BQU0sRUFBRSxJQUFJLEtBQUs7QUFDNUQsU0FBSyxjQUFjO0FBQUEsRUFDckI7QUFBQSxFQUVRLFVBQWtCO0FBQ3hCLFFBQUksS0FBSyxlQUFlLFNBQVMsS0FBSyxLQUFLLGNBQWMsV0FBVyxLQUFLLENBQUMsS0FBSyxXQUFZLE1BQUssaUJBQWlCLEtBQUssTUFBTTtBQUM1SCxTQUFLLE1BQU0sT0FBTztBQUNsQixTQUFLLE1BQU0sY0FBYyxLQUFLLElBQUk7QUFDbEMsV0FBTyxLQUFLLE1BQU07QUFBQSxFQUNwQjtBQUFBLEVBRVEsZ0JBQXNCO0FBQzVCLFFBQUksS0FBSyxXQUFZO0FBQ3JCLFNBQUssYUFBYSxXQUFXLE1BQU07QUFDakMsV0FBSyxhQUFhO0FBQ2xCLFdBQUssU0FBUztBQUFBLElBQ2hCLEdBQUcsS0FBSyxPQUFPO0FBQUEsRUFDakI7QUFBQTtBQUFBLEVBR1EsWUFBa0I7QUFDeEIsVUFBTSxRQUFtQixFQUFFLFNBQVMsSUFBSSxPQUFPLEtBQUssTUFBTSxLQUFLLFNBQVMsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxFQUFFO0FBQ3ZGLFNBQUssaUJBQWlCLEtBQUssTUFBTTtBQUNqQyxlQUFXLFlBQVksS0FBSyxVQUFXLFVBQVMsS0FBSztBQUFBLEVBQ3ZEO0FBQUEsRUFFUSxhQUFhLE9BQTZCO0FBQ2hELFlBQVEsTUFBTSxRQUFRO0FBQUEsTUFDcEIsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLE9BQU8sTUFBTSxFQUFFO0FBQUEsTUFDbkMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLE1BQU0sTUFBTSxFQUFFO0FBQUEsTUFDbEMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLEtBQUssTUFBTSxFQUFFO0FBQUEsTUFDakMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLE1BQU0sTUFBTSxFQUFFO0FBQUEsTUFDbEMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLFVBQVUsTUFBTSxFQUFFO0FBQUEsTUFDdEMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLFNBQVMsTUFBTSxFQUFFO0FBQUEsTUFDckMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLFdBQVcsTUFBTSxFQUFFO0FBQUEsTUFDdkMsS0FBSztBQUNILGVBQU8sS0FBSyxNQUFNLFNBQVMsS0FBSyxDQUFDLFlBQVksUUFBUSxPQUFPLE1BQU0sRUFBRTtBQUFBLE1BQ3RFLEtBQUs7QUFDSCxlQUFPLEtBQUssTUFBTSxVQUFVLEtBQUssQ0FBQyxTQUFTLEtBQUssT0FBTyxNQUFNLEVBQUU7QUFBQSxNQUNqRSxLQUFLO0FBQ0gsZUFBTyxLQUFLLE1BQU07QUFBQSxNQUNwQixLQUFLO0FBQ0gsZUFBTyxLQUFLLE1BQU07QUFBQSxJQUN0QjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsV0FBVyxHQUFZLEdBQXFCO0FBQ25ELFFBQU0sUUFBUSxDQUFDLFVBQW1CO0FBQ2hDLFFBQUksU0FBUyxPQUFPLFVBQVUsWUFBWSxDQUFDLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDL0QsWUFBTSxFQUFFLFNBQVMsVUFBVSxZQUFZLFdBQVcsR0FBRyxLQUFLLElBQUk7QUFDOUQsYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU8sS0FBSyxVQUFVLE1BQU0sQ0FBQyxDQUFDLE1BQU0sS0FBSyxVQUFVLE1BQU0sQ0FBQyxDQUFDO0FBQzdEOzs7QUMzTk8sSUFBTSxpQkFBaUI7QUFFdkIsSUFBTSxnQkFBTixNQUFvQjtBQUFBLEVBR3pCLFlBQ21CLEtBQ0EsY0FBYyxnQkFDL0I7QUFGaUI7QUFDQTtBQUFBLEVBQ2hCO0FBQUEsRUFMSyxXQUFXLE9BQU87QUFBQTtBQUFBLEVBUTFCLFFBQWlCO0FBQ2YsVUFBTSxVQUFVLEtBQUs7QUFDckIsU0FBSyxXQUFXLEtBQUssSUFBSTtBQUN6QixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsSUFBSSxPQUFnQjtBQUNsQixXQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssV0FBVyxLQUFLO0FBQUEsRUFDM0M7QUFBQTtBQUFBLEVBR0EsS0FBSyxXQUFtQixRQUF3QjtBQUM5QyxXQUFPLEtBQUssT0FBTyxTQUFTO0FBQUEsRUFDOUI7QUFDRjs7O0FDMUJBLFNBQVMsYUFBNkI7QUFNdEMsSUFBTSxZQUEwQixDQUFDLE1BQU0sYUFBYSxNQUFNLE1BQU0sRUFBRSxZQUFZLE1BQU0sR0FBRyxRQUFRO0FBRXhGLElBQU0sZ0JBQU4sTUFBb0I7QUFBQSxFQU16QixZQUNtQixVQUFnSCxDQUFDLEdBQ2xJO0FBRGlCO0FBQUEsRUFDaEI7QUFBQSxFQVBLLFVBQVUsb0JBQUksSUFBbUI7QUFBQSxFQUNqQyxZQUFZLG9CQUFJLElBQStCO0FBQUE7QUFBQSxFQUUvQyxhQUFhLG9CQUFJLElBQStFO0FBQUEsRUFNeEcsSUFBWSxNQUFNO0FBQ2hCLFdBQU8sS0FBSyxRQUFRLE9BQU8sS0FBSztBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLE1BQU0sU0FBaUIsTUFBdUI7QUFDNUMsVUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyQixTQUFLLE1BQU0sR0FBRztBQUNkLFVBQU0sV0FBVyxLQUFLLFFBQVEsSUFBSSxPQUFPO0FBQ3pDLFFBQUksWUFBWSxTQUFTLFNBQVMsTUFBTTtBQUN0QyxlQUFTLFdBQVc7QUFDcEIsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLFNBQVUsTUFBSyxRQUFRLE9BQU87QUFDbEMsVUFBTSxNQUFNLEtBQUssUUFBUSxPQUFPO0FBQ2hDLFdBQU8sS0FBSyxRQUFRLFFBQVEsS0FBSztBQUMvQixZQUFNLFNBQVMsQ0FBQyxHQUFHLEtBQUssUUFBUSxRQUFRLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsUUFBUSxFQUFFLENBQUM7QUFDMUYsV0FBSyxRQUFRLE9BQU8sQ0FBQyxDQUFDO0FBQUEsSUFDeEI7QUFDQSxRQUFJO0FBQ0osUUFBSTtBQUNGLGlCQUFXLEtBQUssUUFBUSxhQUFhLFdBQVcsTUFBTSxNQUFNLEtBQUssUUFBUSxPQUFPLENBQUM7QUFBQSxJQUNuRixRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFDQSxZQUFRLEtBQUssU0FBUyxNQUFNLEtBQUssUUFBUSxPQUFPLENBQUM7QUFDakQsU0FBSyxRQUFRLElBQUksU0FBUyxFQUFFLE1BQU0sU0FBUyxVQUFVLEtBQUssT0FBTyxLQUFLLENBQUM7QUFDdkUsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBR0EsYUFBYSxTQUF1QjtBQUNsQyxVQUFNLFFBQVEsS0FBSyxXQUFXLElBQUksT0FBTztBQUN6QyxRQUFJLE1BQU8sT0FBTSxXQUFXLEtBQUssSUFBSTtBQUFBLFFBQ2hDLE1BQUssV0FBVyxJQUFJLFNBQVMsRUFBRSxVQUFVLEtBQUssSUFBSSxHQUFHLE9BQU8sS0FBSyxDQUFDO0FBQ3ZFLFFBQUksS0FBSyxXQUFXLFFBQVEsS0FBSyxRQUFRLE9BQU8sS0FBSyxHQUFHO0FBQ3RELFlBQU0sU0FBUyxDQUFDLEdBQUcsS0FBSyxXQUFXLFFBQVEsQ0FBQyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsQ0FBQztBQUM3RixXQUFLLGFBQWEsT0FBTyxDQUFDLENBQUM7QUFBQSxJQUM3QjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsS0FBSyxTQUF1QjtBQUMxQixVQUFNLFFBQVEsS0FBSyxXQUFXLElBQUksT0FBTztBQUN6QyxRQUFJLENBQUMsTUFBTztBQUNaLFFBQUksS0FBSyxJQUFJLElBQUksTUFBTSxZQUFZLEtBQUssUUFBUSxVQUFVLE1BQVM7QUFDakUsV0FBSyxhQUFhLE9BQU87QUFDekI7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLE1BQU87QUFDakIsVUFBTSxRQUFRLFdBQVcsTUFBTTtBQUM3QixZQUFNLFFBQVE7QUFDZCxVQUFJLENBQUMsS0FBSyxXQUFXLElBQUksT0FBTyxFQUFHO0FBQ25DLGlCQUFXLFlBQVksS0FBSyxVQUFXLFVBQVMsT0FBTztBQUFBLElBQ3pELEdBQUcsS0FBSyxRQUFRLGNBQWMsR0FBRztBQUFBLEVBQ25DO0FBQUEsRUFFUSxhQUFhLFNBQXVCO0FBQzFDLFVBQU0sUUFBUSxLQUFLLFdBQVcsSUFBSSxPQUFPO0FBQ3pDLFFBQUksT0FBTyxNQUFPLGNBQWEsTUFBTSxLQUFLO0FBQzFDLFNBQUssV0FBVyxPQUFPLE9BQU87QUFBQSxFQUNoQztBQUFBLEVBRUEsVUFBVSxVQUFpRDtBQUN6RCxTQUFLLFVBQVUsSUFBSSxRQUFRO0FBQzNCLFdBQU8sTUFBTSxLQUFLLFVBQVUsT0FBTyxRQUFRO0FBQUEsRUFDN0M7QUFBQSxFQUVBLElBQUksT0FBZTtBQUNqQixXQUFPLEtBQUssUUFBUTtBQUFBLEVBQ3RCO0FBQUEsRUFFQSxVQUFnQjtBQUNkLGVBQVcsTUFBTSxDQUFDLEdBQUcsS0FBSyxRQUFRLEtBQUssQ0FBQyxFQUFHLE1BQUssUUFBUSxFQUFFO0FBQzFELGVBQVcsTUFBTSxDQUFDLEdBQUcsS0FBSyxXQUFXLEtBQUssQ0FBQyxFQUFHLE1BQUssYUFBYSxFQUFFO0FBQ2xFLFNBQUssVUFBVSxNQUFNO0FBQUEsRUFDdkI7QUFBQSxFQUVRLFFBQVEsU0FBdUI7QUFDckMsVUFBTSxRQUFRLEtBQUssUUFBUSxJQUFJLE9BQU87QUFDdEMsUUFBSSxDQUFDLE1BQU87QUFDWixRQUFJLEtBQUssSUFBSSxJQUFJLE1BQU0sWUFBWSxLQUFLLFFBQVEsVUFBVSxNQUFTO0FBQ2pFLFdBQUssUUFBUSxPQUFPO0FBQ3BCO0FBQUEsSUFDRjtBQUVBLFFBQUksTUFBTSxNQUFPO0FBQ2pCLFVBQU0sUUFBUSxXQUFXLE1BQU07QUFDN0IsWUFBTSxRQUFRO0FBQ2QsVUFBSSxDQUFDLEtBQUssUUFBUSxJQUFJLE9BQU8sRUFBRztBQUNoQyxpQkFBVyxZQUFZLEtBQUssVUFBVyxVQUFTLE9BQU87QUFBQSxJQUN6RCxHQUFHLEtBQUssUUFBUSxjQUFjLEdBQUc7QUFBQSxFQUNuQztBQUFBLEVBRVEsTUFBTSxLQUFtQjtBQUMvQixVQUFNLFNBQVMsS0FBSyxRQUFRLFVBQVU7QUFDdEMsZUFBVyxDQUFDLElBQUksS0FBSyxLQUFLLEtBQUssUUFBUyxLQUFJLE1BQU0sTUFBTSxXQUFXLE9BQVEsTUFBSyxRQUFRLEVBQUU7QUFBQSxFQUM1RjtBQUFBLEVBRVEsUUFBUSxTQUF1QjtBQUNyQyxVQUFNLFFBQVEsS0FBSyxRQUFRLElBQUksT0FBTztBQUN0QyxRQUFJLENBQUMsTUFBTztBQUNaLFFBQUksTUFBTSxNQUFPLGNBQWEsTUFBTSxLQUFLO0FBQ3pDLFFBQUk7QUFDRixZQUFNLFFBQVEsTUFBTTtBQUFBLElBQ3RCLFFBQVE7QUFBQSxJQUVSO0FBQ0EsU0FBSyxRQUFRLE9BQU8sT0FBTztBQUFBLEVBQzdCO0FBQ0Y7OztBQ2hJQSxTQUFTLFNBQUFLLFFBQU8sWUFBQUMsV0FBVSxVQUFBQyxTQUFRLGFBQUFDLGtCQUFpQjtBQUNuRCxTQUFTLFFBQUFDLGNBQVk7QUFFZCxJQUFNLGdCQUFnQjtBQUM3QixJQUFNLFNBQVMsS0FBSyxLQUFLLEtBQUs7QUFDOUIsSUFBTSxnQkFBZ0I7QUFDdEIsSUFBTSxhQUFhLElBQUk7QUFDdkIsSUFBTSxZQUFZLEtBQUs7QUFLaEIsSUFBTSxpQkFBaUIsQ0FBQyxTQUE0QixFQUFFLFdBQVcsS0FBSyxNQUFNLENBQUMsR0FBRyxhQUFhLEdBQUcsTUFBTSxNQUFNO0FBRzVHLFNBQVMsTUFBTSxLQUFxQjtBQUN6QyxRQUFNLElBQUksSUFBSSxLQUFLLEdBQUc7QUFDdEIsU0FBTyxHQUFHLEVBQUUsWUFBWSxDQUFDLElBQUksT0FBTyxFQUFFLFNBQVMsSUFBSSxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsQ0FBQyxJQUFJLE9BQU8sRUFBRSxRQUFRLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxDQUFDO0FBQ2hIO0FBRU8sU0FBUyxZQUFZLE9BQWtCLEtBQXdCO0FBQ3BFLFFBQU0sTUFBTSxNQUFNLEdBQUc7QUFDckIsU0FBTyxNQUFNLEtBQUssU0FBUyxHQUFHLElBQUksUUFBUSxFQUFFLEdBQUcsT0FBTyxNQUFNLENBQUMsR0FBRyxNQUFNLE1BQU0sR0FBRyxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQzlGO0FBRU8sU0FBUyxVQUFVLE9BQWtCLEtBQXNCO0FBQ2hFLFNBQU8sQ0FBQyxNQUFNLFFBQVEsT0FBTyxNQUFNLGVBQWUsTUFBTSxLQUFLLFVBQVUsaUJBQWlCLE1BQU0sTUFBTSxhQUFhO0FBQ25IO0FBRU8sU0FBUyxZQUFZLE9BQWtCLFFBQW9CLEtBQXdCO0FBQ3hGLFNBQU8sV0FBVyxVQUFVLEVBQUUsR0FBRyxPQUFPLGFBQWEsTUFBTSxVQUFVLElBQUksRUFBRSxHQUFHLE9BQU8sTUFBTSxLQUFLO0FBQ2xHO0FBRU8sSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBSTNCLFlBQ21CLEtBQ0EsTUFBb0IsS0FBSyxLQUMxQztBQUZpQjtBQUNBO0FBRWpCLFNBQUssT0FBT0EsT0FBSyxLQUFLLGtCQUFrQjtBQUFBLEVBQzFDO0FBQUEsRUFSUSxRQUEwQjtBQUFBLEVBQ2pCO0FBQUE7QUFBQSxFQVVqQixNQUFNLFFBQWlEO0FBQ3JELFVBQU0sUUFBUSxZQUFZLE1BQU0sS0FBSyxLQUFLLEdBQUcsS0FBSyxJQUFJLENBQUM7QUFDdkQsVUFBTSxLQUFLLEtBQUssS0FBSztBQUNyQixXQUFPLEVBQUUsTUFBTSxVQUFVLE9BQU8sS0FBSyxJQUFJLENBQUMsR0FBRyxLQUFLLGNBQWM7QUFBQSxFQUNsRTtBQUFBLEVBRUEsTUFBTSxPQUFPLFFBQW1DO0FBQzlDLFVBQU0sS0FBSyxLQUFLLFlBQVksTUFBTSxLQUFLLEtBQUssR0FBRyxRQUFRLEtBQUssSUFBSSxDQUFDLENBQUM7QUFBQSxFQUNwRTtBQUFBLEVBRUEsTUFBYyxPQUEyQjtBQUN2QyxRQUFJLEtBQUssTUFBTyxRQUFPLEtBQUs7QUFDNUIsUUFBSTtBQUNGLFlBQU0sTUFBTSxLQUFLLE1BQU0sTUFBTUgsVUFBUyxLQUFLLE1BQU0sTUFBTSxDQUFDO0FBQ3hELFdBQUssUUFBUTtBQUFBLFFBQ1gsV0FBVyxPQUFPLElBQUksY0FBYyxXQUFXLElBQUksWUFBWSxLQUFLLElBQUk7QUFBQSxRQUN4RSxNQUFNLE1BQU0sUUFBUSxJQUFJLElBQUksSUFBSSxJQUFJLEtBQUssT0FBTyxDQUFDLE1BQW1CLE9BQU8sTUFBTSxRQUFRLEVBQUUsTUFBTSxHQUFHLElBQUksQ0FBQztBQUFBLFFBQ3pHLGFBQWEsT0FBTyxJQUFJLGdCQUFnQixXQUFXLElBQUksY0FBYztBQUFBLFFBQ3JFLE1BQU0sSUFBSSxTQUFTO0FBQUEsTUFDckI7QUFBQSxJQUNGLFFBQVE7QUFDTixXQUFLLFFBQVEsZUFBZSxLQUFLLElBQUksQ0FBQztBQUFBLElBQ3hDO0FBQ0EsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBLEVBRUEsTUFBYyxLQUFLLE9BQWlDO0FBQ2xELFFBQUksS0FBSyxVQUFVLEtBQUssTUFBTSxLQUFLLFVBQVUsS0FBSyxLQUFLLEtBQUssS0FBSyxNQUFPO0FBQ3hFLFNBQUssUUFBUTtBQUNiLFVBQU1ELE9BQU0sS0FBSyxLQUFLLEVBQUUsV0FBVyxNQUFNLE1BQU0sSUFBTSxDQUFDO0FBQ3RELFVBQU0sTUFBTSxHQUFHLEtBQUssSUFBSSxJQUFJLFFBQVEsR0FBRztBQUN2QyxVQUFNRyxXQUFVLEtBQUssS0FBSyxVQUFVLEtBQUssR0FBRyxFQUFFLE1BQU0sSUFBTSxDQUFDO0FBQzNELFVBQU1ELFFBQU8sS0FBSyxLQUFLLElBQUk7QUFBQSxFQUM3QjtBQUNGOzs7QUM5RUEsU0FBUyxZQUFBRyxrQkFBZ0I7QUFDekIsU0FBUyxRQUFBQyxjQUFZO0FBR3JCLElBQU0saUJBQWlCLElBQUksS0FBSyxLQUFLO0FBQ3JDLElBQU0sbUJBQW1CO0FBT2xCLFNBQVMsYUFBYSxTQUFnQztBQUMzRCxRQUFNLFFBQVEsUUFBUSxNQUFNLHVFQUF1RTtBQUNuRyxTQUFPLFNBQVMsQ0FBQyxNQUFNLENBQUMsRUFBRSxXQUFXLFFBQVEsSUFBSSxNQUFNLENBQUMsSUFBSTtBQUM5RDtBQUdPLFNBQVMsV0FBVyxLQUF3QztBQUNqRSxRQUFNLFFBQVEsS0FBSyxNQUFNLDJFQUEyRTtBQUNwRyxTQUFPLFFBQVEsR0FBRyxNQUFNLENBQUMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDLEtBQUs7QUFDN0M7QUFHTyxTQUFTLGdCQUFnQixHQUFXLEdBQW1CO0FBQzVELFFBQU0sUUFBUSxDQUFDLE1BQWM7QUFDM0IsVUFBTSxDQUFDLE1BQU0sR0FBRyxJQUFJLEVBQUUsUUFBUSxPQUFPLEVBQUUsRUFBRSxNQUFNLEtBQUssQ0FBQztBQUNyRCxXQUFPLEVBQUUsTUFBTSxLQUFLLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNLE9BQU8sU0FBUyxHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUcsS0FBSyxPQUFPLEtBQUs7QUFBQSxFQUMzRjtBQUNBLFFBQU0sSUFBSSxNQUFNLENBQUM7QUFDakIsUUFBTSxJQUFJLE1BQU0sQ0FBQztBQUNqQixXQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUMxQixVQUFNLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxNQUFNLEVBQUUsS0FBSyxDQUFDLEtBQUs7QUFDM0MsUUFBSSxFQUFHLFFBQU8sS0FBSyxLQUFLLENBQUM7QUFBQSxFQUMzQjtBQUNBLE1BQUksRUFBRSxRQUFRLEVBQUUsSUFBSyxRQUFPO0FBQzVCLFNBQU8sRUFBRSxRQUFRLE9BQU8sSUFBSSxFQUFFLFFBQVEsT0FBTyxLQUFLLEVBQUUsTUFBTSxFQUFFLE1BQU0sS0FBSztBQUN6RTtBQUlPLElBQU0sZ0JBQU4sTUFBb0I7QUFBQSxFQUl6QixZQUNtQixTQUNBLFNBQ0EsVUFBbUIsT0FDbkIsTUFBb0IsS0FBSyxLQUMxQztBQUppQjtBQUNBO0FBQ0E7QUFDQTtBQUFBLEVBQ2hCO0FBQUEsRUFSSyxTQUFrRDtBQUFBLEVBQ2xELFdBQTREO0FBQUEsRUFTcEUsTUFBYyxlQUFrRTtBQUM5RSxTQUFLLGFBQWEsS0FBSyxNQUFNLE1BQU1ELFdBQVNDLE9BQUssS0FBSyxTQUFTLGtCQUFrQixHQUFHLE1BQU0sQ0FBQztBQUMzRixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFFQSxNQUFNLE1BQU0sUUFBUSxPQUE0QjtBQUM5QyxVQUFNLFdBQVcsTUFBTSxLQUFLLGFBQWE7QUFDekMsVUFBTSxZQUFZLGFBQWEsS0FBSyxPQUFPO0FBQzNDLFVBQU0sT0FBbUIsRUFBRSxTQUFTLFNBQVMsU0FBUyxRQUFRLE1BQU0sT0FBTyxPQUFPLFlBQVksTUFBTSxVQUFVO0FBQzlHLFVBQU0sT0FBTyxXQUFXLFNBQVMsVUFBVTtBQUMzQyxRQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFFBQVEsRUFBRyxRQUFPO0FBQ25ELFFBQUksQ0FBQyxTQUFTLEtBQUssVUFBVSxLQUFLLElBQUksSUFBSSxLQUFLLE9BQU8sS0FBSyxlQUFnQixRQUFPLEtBQUssT0FBTztBQUM5RixRQUFJO0FBQ0YsWUFBTSxXQUFXLE1BQU0sS0FBSyxRQUFRLGdDQUFnQyxJQUFJLG9CQUFvQjtBQUFBLFFBQzFGLFNBQVMsRUFBRSxRQUFRLCtCQUErQixjQUFjLCtCQUErQjtBQUFBLFFBQy9GLFFBQVEsWUFBWSxRQUFRLGdCQUFnQjtBQUFBLE1BQzlDLENBQUM7QUFDRCxVQUFJLENBQUMsU0FBUyxHQUFJLE9BQU0sSUFBSSxNQUFNLG1CQUFtQixTQUFTLE1BQU0sRUFBRTtBQUN0RSxZQUFNLFVBQVcsTUFBTSxTQUFTLEtBQUs7QUFDckMsWUFBTSxNQUFNLE9BQU8sUUFBUSxhQUFhLFlBQVksbUJBQW1CLEtBQUssUUFBUSxRQUFRLElBQUksUUFBUSxTQUFTLFFBQVEsT0FBTyxFQUFFLElBQUk7QUFDdEksWUFBTSxNQUFNLE9BQU8sUUFBUSxhQUFhLFlBQVksUUFBUSxTQUFTLFdBQVcsc0JBQXNCLElBQUksR0FBRyxJQUFJLFFBQVEsV0FBVztBQUNwSSxZQUFNLE9BQW1CLEVBQUUsR0FBRyxNQUFNLFFBQVEsS0FBSyxPQUFPLFFBQVEsR0FBRyxLQUFLLFFBQVEsVUFBVSxRQUFRLFFBQVEsZUFBZSxRQUFRLGdCQUFnQixLQUFNLFNBQVMsT0FBTyxJQUFJLEdBQUcsWUFBWSxJQUFJO0FBQzlMLFdBQUssU0FBUyxFQUFFLElBQUksS0FBSyxJQUFJLEdBQUcsS0FBSztBQUNyQyxhQUFPO0FBQUEsSUFDVCxRQUFRO0FBRU4sV0FBSyxTQUFTLEVBQUUsSUFBSSxLQUFLLElBQUksSUFBSSxpQkFBaUIsS0FBSyxLQUFLLEtBQU0sTUFBTSxLQUFLO0FBQzdFLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxNQUFNLE9BQU8sS0FBdUM7QUFDbEQsVUFBTSxNQUFNLGFBQWEsS0FBSyxPQUFPO0FBQ3JDLFFBQUksQ0FBQyxJQUFLLFFBQU8sRUFBRSxTQUFTLE9BQU8sZ0JBQWdCLE1BQU0sUUFBUSx5REFBeUQ7QUFDMUgsVUFBTSxTQUFTLE1BQU0sSUFBSSxJQUEwQixDQUFDLFVBQVUsVUFBVSxHQUFHLEdBQUcsRUFBRSxXQUFXLEtBQVEsQ0FBQztBQUNwRyxRQUFJLE9BQU8sSUFBSTtBQUNiLFdBQUssU0FBUztBQUNkLGFBQU8sRUFBRSxTQUFTLE1BQU0sU0FBUyxPQUFPLE9BQU8sUUFBUSxZQUFZLFdBQVcsT0FBTyxPQUFPLFVBQVUsS0FBSztBQUFBLElBQzdHO0FBQ0EsVUFBTSxjQUFjLE9BQU8sUUFBUSxNQUFNLG9DQUFvQyxJQUFJLENBQUMsS0FBSztBQUN2RixXQUFPO0FBQUEsTUFDTCxTQUFTO0FBQUEsTUFDVCxnQkFBZ0IsY0FBYyxzQkFBc0IsR0FBRyxjQUFjLFdBQVcsS0FBSztBQUFBLE1BQ3JGLFFBQVEsT0FBTyxTQUFTLHVCQUF1QixjQUFjLHVFQUF1RSxPQUFPO0FBQUEsSUFDN0k7QUFBQSxFQUNGO0FBQ0Y7OztBQ2pHTyxJQUFNLHdCQUF3QixNQUFNO0FBSTNDLElBQU0sUUFBUSxDQUFDLFVBQW1CLE9BQU8sV0FBVyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBRXpFLElBQU0sT0FBTyxDQUFDLEdBQWlCLFNBQXlCLFNBQVMsV0FBVyxFQUFFLFNBQVMsRUFBRSxNQUFNLElBQUk7QUFFbkcsSUFBTSxRQUFvRTtBQUFBLEVBQ3hFLEVBQUUsTUFBTSxVQUFVLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLFFBQVEsRUFBRSxPQUFPLE1BQU0sSUFBSSxFQUFFLEdBQUc7QUFBQSxFQUN6RSxFQUFFLE1BQU0sYUFBYSxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsR0FBRyxPQUFPLEVBQUUsR0FBRyxFQUFFLE9BQU8sV0FBVyxFQUFFLE1BQU0sVUFBVSxNQUFNLEdBQUcsRUFBRSxFQUFFLEdBQUc7QUFBQSxFQUM5RyxFQUFFLE1BQU0sWUFBWSxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsR0FBRyxPQUFPLEVBQUUsR0FBRyxFQUFFLE9BQU8sVUFBVSxFQUFFLE1BQU0sU0FBUyxNQUFNLElBQUksRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsR0FBRyxNQUFNLEVBQUUsT0FBTyxTQUFTLEVBQUUsTUFBTSxHQUFHLElBQUksS0FBSyxFQUFFLEVBQUUsRUFBRSxHQUFHO0FBQUEsRUFDaEw7QUFBQSxJQUNFLE1BQU07QUFBQSxJQUNOLE9BQU8sQ0FBQyxPQUFPO0FBQUEsTUFDYixHQUFHO0FBQUEsTUFDSCxPQUFPO0FBQUEsUUFDTCxHQUFHLEVBQUU7QUFBQSxRQUNMLE9BQU8sT0FBTztBQUFBLFVBQ1osT0FBTyxRQUFRLEVBQUUsTUFBTSxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxHQUFHLE1BQU0sRUFBRSxPQUFPLFNBQVMsRUFBRSxNQUFNLEdBQUcsSUFBSSxNQUFNLFFBQVEsRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLFFBQVEsS0FBSyxNQUFNLFNBQVMsRUFBRSxPQUFPLFVBQVUsU0FBUyxFQUFFLE9BQU8sU0FBUyxHQUFHLElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQUEsUUFDdE87QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLEVBQUUsTUFBTSxVQUFVLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLFFBQVEsRUFBRSxPQUFPLE1BQU0sR0FBRyxFQUFFLEdBQUc7QUFDMUU7QUFFTyxTQUFTLFlBQVksVUFBd0IsU0FBUyx1QkFBcUM7QUFDaEcsTUFBSSxRQUFRLE1BQU0sUUFBUTtBQUMxQixNQUFJLFNBQVMsT0FBUSxRQUFPO0FBQzVCLFFBQU0sUUFBUSxvQkFBSSxJQUFrQjtBQUNwQyxRQUFNLFNBQVMsQ0FBQyxHQUFpQixTQUFlO0FBQzlDLFFBQUksQ0FBQyxNQUFNLElBQUksSUFBSSxFQUFHLE9BQU0sSUFBSSxNQUFNLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQzFELFdBQU8sTUFBTSxJQUFJLElBQUk7QUFBQSxFQUN2QjtBQUNBLE1BQUksVUFBVTtBQUNkLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLFVBQU0sU0FBUyxPQUFPLFNBQVMsS0FBSyxJQUFJO0FBQ3hDLGNBQVUsS0FBSyxNQUFNLE9BQU87QUFDNUIsVUFBTSxRQUFRLE1BQU0sS0FBSyxTQUFTLEtBQUssSUFBSSxDQUFDO0FBQzVDLFVBQU0sSUFBSSxLQUFLLE1BQU0sS0FBSztBQUMxQixhQUFTLFFBQVE7QUFDakIsUUFBSSxTQUFTLE9BQVEsUUFBTztBQUFBLEVBQzlCO0FBQ0EsU0FBTztBQUNUOzs7QUM1Q0EsSUFBTSxpQkFBaUIsTUFBTTtBQUV0QixTQUFTLGNBQ2QsUUFDQSxNQVFZO0FBQ1osUUFBTSxZQUFZO0FBQUEsSUFDaEIsT0FBTyxPQUFPLGlCQUFpQixNQUFNLFlBQVksS0FBSyxTQUFTLENBQUMsQ0FBVTtBQUFBLElBQzFFLE9BQU8sT0FBTyxnQkFBZ0IsQ0FBQyxVQUFVLEtBQUssUUFBUSxLQUFLLENBQVU7QUFBQSxFQUN2RTtBQUNBLFFBQU0sY0FBYyxLQUFLLFVBQVUsQ0FBQyxVQUFVO0FBQzVDLFFBQUk7QUFDRixZQUFNLE9BQU8sS0FBSyxVQUFVLEtBQUs7QUFDakMsVUFBSSxPQUFPLFdBQVcsSUFBSSxJQUFJLGVBQWdCLFFBQU8sS0FBSyxlQUFlLEVBQUUsT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUFBLFVBQzFGLFFBQU8sS0FBSyxjQUFjLEtBQWM7QUFBQSxJQUMvQyxTQUFTLE9BQU87QUFDZCxXQUFLLElBQUksc0JBQXVCLE1BQWdCLE9BQU8sRUFBRTtBQUFBLElBQzNEO0FBQUEsRUFDRixDQUFDO0FBQ0QsUUFBTSxvQkFBb0IsS0FBSyxrQkFBa0IsQ0FBQyxZQUFZO0FBQzVELFFBQUk7QUFDRixhQUFPLEtBQUssZUFBZSxFQUFFLFFBQVEsQ0FBQztBQUFBLElBQ3hDLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxzQkFBdUIsTUFBZ0IsT0FBTyxFQUFFO0FBQUEsSUFDM0Q7QUFBQSxFQUNGLENBQUM7QUFDRCxTQUFPLE1BQU07QUFDWCxnQkFBWTtBQUNaLHdCQUFvQjtBQUNwQixlQUFXLFlBQVksVUFBVyxVQUFTLFFBQVE7QUFBQSxFQUNyRDtBQUNGOzs7QXJDREEsSUFBTSxtQkFBNkIsRUFBRSxrQkFBa0IsTUFBTSxlQUFlLE1BQU0sbUJBQW1CLE1BQU0sa0JBQWtCLE1BQU0sU0FBUyxJQUFJLFVBQVUsTUFBTSxjQUFjLEtBQUs7QUFFbkwsSUFBTSxvQkFBb0I7QUFFMUIsSUFBTSxhQUFhO0FBQ25CLElBQU0scUJBQXFCLElBQUksS0FBSztBQUNwQyxJQUFNLHdCQUF3QixLQUFLLEtBQUssS0FBSztBQUM3QyxJQUFNLDBCQUEwQixJQUFJLEtBQUssS0FBSyxLQUFLO0FBQ25ELElBQU0sZUFBZSxDQUFDLGtCQUFrQixlQUFlLHNCQUFzQixpQkFBaUIsa0JBQWtCLGtCQUFrQixxQkFBcUIsZ0JBQWdCLGdCQUFnQixvQkFBb0Isa0JBQWtCLGtCQUFrQjtBQUV4TyxJQUFNLG1CQUFOLE1BQXVCO0FBQUEsRUE0QjVCLFlBQTZCLE1BQXFCO0FBQXJCO0FBQUEsRUFBc0I7QUFBQSxFQTNCM0MsUUFBUSxJQUFJLFVBQVU7QUFBQSxFQUN0QixXQUFXLElBQUksY0FBYztBQUFBLEVBQzdCLGNBQWMsSUFBSSxZQUFZO0FBQUEsRUFDOUIsVUFBVSxJQUFJLGNBQWMsS0FBSyxHQUFHO0FBQUEsRUFDcEMsZ0JBQWdCLElBQUksY0FBYztBQUFBLEVBQ2xDLFdBQXFCO0FBQUEsRUFDckIsZUFBZSxvQkFBSSxJQUFZO0FBQUE7QUFBQSxFQUUvQixTQUFTLG9CQUFJLElBQTJDO0FBQUEsRUFDeEQsY0FBNkIsUUFBUSxRQUFRO0FBQUEsRUFDN0MsWUFBNEIsQ0FBQztBQUFBLEVBQzdCLFlBQW9DO0FBQUEsRUFDcEMsbUJBQW1CO0FBQUEsRUFDbkI7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBLGVBQWU7QUFBQSxFQUNmLFlBQVk7QUFBQSxFQUNaLFVBQVU7QUFBQSxFQUlsQixNQUFNLFFBQXVCO0FBQzNCLFVBQU0sTUFBTSxDQUFDLFlBQW9CLEtBQUssS0FBSyxJQUFJLGdCQUFnQixPQUFPLEVBQUU7QUFDeEUsU0FBSyxXQUFXLE1BQU0sS0FBSyxhQUFhO0FBQ3hDLFVBQU0sTUFBTSxnQkFBZ0IsTUFBTSxlQUFlLEtBQUssU0FBUyxXQUFXLElBQUksQ0FBQztBQUMvRSxRQUFJLENBQUMsSUFBSSxLQUFNLEtBQUksNkRBQTZEO0FBQ2hGLFNBQUssTUFBTSxFQUFFLE1BQU0sS0FBSyxNQUFNLE9BQU8sS0FBSyxPQUFPLEtBQUssVUFBVSxLQUFLLFVBQVUsS0FBSyxLQUFLLEtBQUssSUFBSTtBQUVsRyxVQUFNLEtBQUssWUFBWSxLQUFLLEVBQUUsTUFBTSxDQUFDLFVBQVUsSUFBSSxpQkFBa0IsTUFBZ0IsT0FBTyxFQUFFLENBQUM7QUFDL0YsVUFBTSxRQUFRLE1BQU0sS0FBSyxZQUFZLGFBQWE7QUFDbEQsUUFBSSxPQUFPO0FBQ1QsV0FBSyxNQUFNLFFBQVEsS0FBSztBQUV4QixZQUFNLFlBQVksb0JBQUksSUFBb0I7QUFDMUMsaUJBQVcsU0FBUyxPQUFPLE9BQU8sS0FBSyxNQUFNLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLGFBQWEsRUFBRSxVQUFVLEdBQUc7QUFDdkcsWUFBSSxDQUFDLE1BQU0sYUFBYSxNQUFNLFNBQVMsV0FBWTtBQUNuRCxZQUFJLFVBQVUsSUFBSSxNQUFNLFNBQVMsRUFBRyxNQUFLLE1BQU0sWUFBWSxNQUFNLEVBQUU7QUFBQSxZQUM5RCxXQUFVLElBQUksTUFBTSxXQUFXLE1BQU0sRUFBRTtBQUFBLE1BQzlDO0FBRUEsaUJBQVcsU0FBUyxPQUFPLE9BQU8sS0FBSyxNQUFNLEtBQUssRUFBRSxNQUFNLEdBQUc7QUFDM0QsYUFBSyxTQUFTLEtBQUssTUFBTSxJQUFJLEVBQUUsWUFBWSxNQUFNLFlBQVksU0FBUyxNQUFNLFNBQVMsV0FBVyxNQUFNLFdBQVcsZ0JBQWdCLE1BQU0sZUFBZSxDQUFDO0FBQUEsTUFDeko7QUFDQSxpQkFBVyxTQUFTLE9BQU8sT0FBTyxLQUFLLE1BQU0sS0FBSyxFQUFFLE1BQU0sRUFBRyxLQUFJLE1BQU0sV0FBWSxtQkFBa0IsS0FBSyxPQUFPLEtBQUssVUFBVSxNQUFNLEVBQUU7QUFBQSxJQUMxSTtBQUNBLFVBQU0sS0FBSyxXQUFXO0FBRXRCLFNBQUssU0FBUyxJQUFJLGNBQWMsS0FBSyxHQUFHO0FBQ3hDLFNBQUssWUFBWSxJQUFJLGdCQUFnQixLQUFLLEdBQUc7QUFDN0MsU0FBSyxnQkFBZ0IsSUFBSSxxQkFBcUIsS0FBSyxHQUFHO0FBQ3RELFNBQUssV0FBVyxJQUFJLGdCQUFnQixLQUFLLEdBQUc7QUFDNUMsU0FBSyxXQUFXLElBQUksZ0JBQWdCLEtBQUssR0FBRztBQUM1QyxTQUFLLGdCQUFnQixJQUFJLHFCQUFxQixLQUFLLEtBQUssTUFBTSxLQUFLLFNBQVMsWUFBWSxDQUFDO0FBQ3pGLFNBQUssZ0JBQWdCLElBQUksb0JBQW9CLEtBQUssS0FBSyxLQUFLLGVBQWUsTUFBTSxLQUFLLFNBQVMsV0FBVyxDQUFDO0FBQzNHLFNBQUssVUFBVSxJQUFJLGdCQUFnQixLQUFLLE9BQU8sS0FBSyxhQUFhLEdBQUc7QUFDcEUsU0FBSyxTQUFTLElBQUksY0FBYztBQUFBLE1BQzlCLEtBQUssS0FBSztBQUFBLE1BQ1YsYUFBYSxLQUFLO0FBQUEsTUFDbEIsY0FBYyxLQUFLO0FBQUEsTUFDbkIsVUFBVSxPQUFPLEVBQUUsa0JBQWtCLEtBQUssU0FBUyxrQkFBa0IsVUFBVSxLQUFLLFNBQVMsU0FBUztBQUFBLE1BQ3RHLFVBQVUsQ0FBQyxXQUFXLFNBQVMsZ0JBQWdCLFdBQVcsSUFBSTtBQUFBLE1BQzlELGNBQWMsQ0FBQyxXQUFXLEtBQUssV0FBVyxNQUFNO0FBQUEsTUFDaEQsZUFBZSxPQUFPLEVBQUUsU0FBUyxRQUFRLEtBQUssU0FBUyxHQUFHLEtBQUssS0FBSyxXQUFXLE9BQU8sS0FBSztBQUFBLE1BQzNGLFNBQVMsTUFBTSxLQUFLLEtBQUs7QUFBQSxNQUN6QixVQUFVLENBQUMsUUFBUSxLQUFLLGNBQWMsWUFBWSxHQUFHO0FBQUEsTUFDckQsc0JBQXNCLENBQUMsVUFBVSxLQUFLLGNBQWMsa0JBQWtCLEtBQUs7QUFBQSxNQUMzRSxhQUFhLENBQUMsU0FBUyxTQUFTLEtBQUssY0FBYyxNQUFNLFNBQVMsSUFBSTtBQUFBLE1BQ3RFLG9CQUFvQixDQUFDLFlBQVksS0FBSyxjQUFjLGFBQWEsT0FBTztBQUFBLE1BQ3hFLGFBQWEsSUFBSSxnQkFBZ0IsZ0JBQWdCLFNBQVMsQ0FBQyxDQUFDO0FBQUEsTUFDNUQsWUFBWSxJQUFJLGdCQUFnQixTQUFTLENBQUM7QUFBQTtBQUFBLE1BRTFDLFNBQVMsSUFBSSxjQUFjLGNBQWMsSUFBSSxJQUFJLE1BQU0sWUFBWSxHQUFHLENBQUMsR0FBRyxNQUFNLEtBQUssU0FBUyxZQUFZO0FBQUEsTUFDMUcsc0JBQXNCLE9BQU8sWUFBWTtBQUN2QyxjQUFNLEtBQUssS0FBSyxTQUFTLElBQUkscUJBQXFCLE9BQU87QUFDekQsYUFBSyxXQUFXLE1BQU0sS0FBSyxhQUFhO0FBQ3hDLGFBQUssb0JBQW9CO0FBQ3pCLGVBQU8sRUFBRSxVQUFVLEtBQUssU0FBUyxrQkFBa0I7QUFBQSxNQUNyRDtBQUFBLE1BQ0EsY0FBYyxPQUFPLFlBQVk7QUFFL0IsY0FBTSxLQUFLLEtBQUssU0FBUyxJQUFJLG9CQUFvQixPQUFPO0FBQ3hELGFBQUssV0FBVyxNQUFNLEtBQUssYUFBYTtBQUN4QyxjQUFNLEtBQUssY0FBYyxPQUFPO0FBQ2hDLGVBQU8sRUFBRSxTQUFTLFFBQVEsS0FBSyxTQUFTLEdBQUcsS0FBSyxLQUFLLFdBQVcsT0FBTyxLQUFLO0FBQUEsTUFDOUU7QUFBQSxJQUNGLENBQUM7QUFFRCxTQUFLLFVBQVUsS0FBSyxLQUFLLGNBQWMsVUFBVSxDQUFDLFlBQVksS0FBSyxPQUFPLGlCQUFpQixPQUFPLENBQUMsQ0FBQztBQUdwRyxVQUFNLGtCQUFrQixvQkFBSSxJQUFvQjtBQUNoRCxTQUFLLFVBQVU7QUFBQSxNQUNiLEtBQUssTUFBTSxVQUFVLENBQUMsVUFBVTtBQUM5QixtQkFBVyxTQUFTLE1BQU0sU0FBUztBQUNqQyxjQUFJLE1BQU0sV0FBVyxXQUFXLE1BQU0sT0FBTztBQUMzQyxrQkFBTSxJQUFJLE1BQU07QUFDaEIsa0JBQU0sWUFBWSxHQUFHLEVBQUUsS0FBSyxJQUFJLEVBQUUsSUFBSSxJQUFJLEVBQUUsT0FBTyxJQUFJLEVBQUUsWUFBWSxJQUFJLEVBQUUsTUFBTSxJQUFJLEVBQUUsVUFBVTtBQUNqRyxnQkFBSSxnQkFBZ0IsSUFBSSxFQUFFLEVBQUUsTUFBTSxVQUFXO0FBQzdDLDRCQUFnQixJQUFJLEVBQUUsSUFBSSxTQUFTO0FBQ25DLGdCQUFJLGdCQUFnQixPQUFPLElBQU0saUJBQWdCLE9BQU8sZ0JBQWdCLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBTTtBQUM1RixpQkFBSyxjQUFjLEtBQUssRUFBRSxFQUFFO0FBQUEsVUFDOUIsV0FBVyxNQUFNLFdBQVcsY0FBYyxNQUFNLE1BQU0sUUFBUyxNQUFLLGNBQWMsS0FBSyxNQUFNLE1BQU0sT0FBTztBQUFBLFFBQzVHO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUNBLFNBQUssaUJBQWlCO0FBQ3RCLFNBQUssVUFBVTtBQUFBLE1BQ2IsY0FBYyxLQUFLLEtBQUssUUFBUTtBQUFBLFFBQzlCLFVBQVUsTUFBTTtBQUNkLGVBQUssS0FBSztBQUNWLGlCQUFPLEtBQUssTUFBTSxTQUFTO0FBQUEsUUFDN0I7QUFBQSxRQUNBLFdBQVcsQ0FBQyxhQUFhLEtBQUssTUFBTSxVQUFVLFFBQVE7QUFBQSxRQUN0RCxpQkFBaUIsQ0FBQyxhQUFhLEtBQUssY0FBYyxVQUFVLFFBQVE7QUFBQSxRQUNwRSxTQUFTLENBQUMsVUFBVTtBQUNsQixlQUFLLEtBQUs7QUFDVixpQkFBTyxLQUFLLE9BQU8sT0FBTyxLQUFLO0FBQUEsUUFDakM7QUFBQSxRQUNBO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUNBLFNBQUssVUFBVSxLQUFLLEtBQUssS0FBSyxTQUFTLFlBQVksTUFBTSxLQUFLLEtBQUssa0JBQWtCLENBQUMsRUFBRSxPQUFPO0FBQy9GLFNBQUssVUFBVSxLQUFLLEtBQUssS0FBSyxTQUFTLFNBQVMsd0JBQXdCLE1BQU0sS0FBSyxVQUFVLENBQUMsRUFBRSxPQUFPO0FBQ3ZHLFNBQUssVUFBVTtBQUFBLE1BQ2IsS0FBSyxLQUFLLFNBQVM7QUFBQSxRQUFTO0FBQUEsUUFBNEIsTUFDdEQsS0FBSyxXQUFXLE1BQ1osaURBQWlELEtBQUssVUFBVSxHQUFHLEtBQ25FO0FBQUEsTUFDTixFQUFFO0FBQUEsSUFDSjtBQUNBLFNBQUssb0JBQW9CO0FBRXpCLFNBQUssS0FBSyxZQUFZO0FBQUEsRUFDeEI7QUFBQSxFQUVBLE1BQWMsY0FBNkI7QUFDekMsVUFBTSxLQUFLLGNBQWMsS0FBSztBQUM5QixVQUFNLEtBQUssT0FBTyxLQUFLO0FBQ3ZCLFVBQU0sS0FBSyxTQUFTLFFBQVE7QUFDNUIsVUFBTSxLQUFLLGNBQWMsS0FBSztBQUM5QixVQUFNLEtBQUssU0FBUyxRQUFRO0FBQzVCLFVBQU0sS0FBSyxjQUFjLEtBQUs7QUFDOUIsVUFBTSxLQUFLLGlCQUFpQjtBQUM1QixVQUFNLEtBQUssY0FBYyxRQUFRO0FBQ2pDLFNBQUssU0FBUyxjQUFjO0FBQzVCLFFBQUksS0FBSyxRQUFTO0FBRWxCLFVBQU0sT0FBTyxDQUFDLFNBQWlCLFNBQWlCLE1BQU0sS0FBSyxRQUFRLEtBQUssU0FBUyxJQUFJO0FBQ3JGLFNBQUssS0FBSyxpQkFBaUIsWUFBWTtBQUNyQyxZQUFNLEtBQUssY0FBYyxLQUFLO0FBQzlCLFdBQUssU0FBUyxjQUFjO0FBQUEsSUFDOUIsR0FBRyxNQUFPLEtBQUssY0FBYyxnQkFBZ0IsS0FBSyxRQUFRLEtBQUssTUFBTSxHQUFJLElBQUksS0FBSyxRQUFRLEtBQUssS0FBTSxHQUFLLENBQUU7QUFDNUcsU0FBSyxLQUFLLFVBQVUsTUFBTSxLQUFLLE9BQU8sS0FBSyxHQUFHLEtBQUssS0FBTyxHQUFLLENBQUM7QUFDaEUsU0FBSyxLQUFLLFlBQVksWUFBWTtBQUNoQyxZQUFNLEtBQUssU0FBUyxRQUFRO0FBQzVCLFlBQU0sS0FBSyxTQUFTLFFBQVE7QUFBQSxJQUM5QixHQUFHLEtBQUssS0FBTyxJQUFNLENBQUM7QUFDdEIsU0FBSyxLQUFLLGtCQUFrQixZQUFZO0FBQ3RDLFlBQU0sS0FBSyxjQUFjLEtBQUs7QUFDOUIsWUFBTSxLQUFLLGNBQWMsUUFBUTtBQUFBLElBQ25DLEdBQUcsS0FBSyxLQUFNLEdBQUssQ0FBQztBQUNwQixTQUFLLEtBQUssY0FBYyxNQUFNLEtBQUssaUJBQWlCLEdBQUcsS0FBSyxNQUFPLElBQU0sQ0FBQztBQUMxRSxTQUFLLEtBQUssV0FBVyxZQUFZO0FBQy9CLFdBQUssTUFBTTtBQUNYLFlBQU0sS0FBSyxRQUFRO0FBQUEsSUFDckIsR0FBRyxNQUFNLFVBQVU7QUFDbkIsU0FBSyxLQUFLLGNBQWMsWUFBWSxLQUFLLGdCQUFnQixHQUFHLE1BQU0sR0FBSTtBQUFBLEVBQ3hFO0FBQUEsRUFFQSxNQUFNLE9BQXNCO0FBQzFCLFNBQUssVUFBVTtBQUNmLGVBQVcsU0FBUyxLQUFLLE9BQU8sT0FBTyxFQUFHLGNBQWEsS0FBSztBQUM1RCxTQUFLLE9BQU8sTUFBTTtBQUNsQixVQUFNLEtBQUssWUFBWSxNQUFNLE1BQU0sTUFBUztBQUM1QyxlQUFXLFdBQVcsS0FBSyxVQUFVLE9BQU8sQ0FBQyxHQUFHO0FBQzlDLFVBQUk7QUFDRixnQkFBUTtBQUFBLE1BQ1YsUUFBUTtBQUFBLE1BRVI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLLFdBQVcsS0FBSztBQUMzQixTQUFLLGNBQWMsUUFBUTtBQUMzQixVQUFNLEtBQUssUUFBUSxJQUFJO0FBQ3ZCLFNBQUssTUFBTSxRQUFRO0FBQUEsRUFDckI7QUFBQSxFQUVRLG1CQUF5QjtBQUMvQixVQUFNLEVBQUUsUUFBUSxNQUFNLElBQUksS0FBSztBQUMvQixTQUFLLFVBQVUsS0FBSyxPQUFPLEdBQUcsd0JBQXdCLENBQUMsVUFBVSxLQUFLLE9BQU8sU0FBUyxLQUFLLENBQUMsRUFBRSxPQUFPO0FBQ3JHLFNBQUssVUFBVSxLQUFLLE9BQU8sR0FBRyxxQkFBcUIsTUFBTSxLQUFLLEtBQUssT0FBTyxLQUFLLENBQUMsRUFBRSxPQUFPO0FBQ3pGLFNBQUssVUFBVSxLQUFLLE9BQU8sR0FBRyxxQkFBcUIsTUFBTSxLQUFLLEtBQUssT0FBTyxLQUFLLENBQUMsRUFBRSxPQUFPO0FBQ3pGLFNBQUssVUFBVSxLQUFLLE9BQU8sR0FBRyxxQkFBcUIsTUFBTSxLQUFLLEtBQUssT0FBTyxLQUFLLENBQUMsRUFBRSxPQUFPO0FBRXpGLFNBQUssVUFBVTtBQUFBLE1BQ2IsTUFBTSxHQUFHLHFCQUFxQixDQUFDLFVBQVU7QUFDdkMsWUFBSTtBQUNGLGVBQUssVUFBVSxhQUFhLEtBQUs7QUFBQSxRQUNuQyxTQUFTLE9BQU87QUFDZCxlQUFLLElBQUksSUFBSSxnQkFBaUIsTUFBZ0IsT0FBTyxFQUFFO0FBQUEsUUFDekQ7QUFBQSxNQUNGLENBQUMsRUFBRTtBQUFBLElBQ0w7QUFDQSxTQUFLLFVBQVU7QUFBQSxNQUNiLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxVQUFVO0FBQ3RDLFlBQUk7QUFDRixlQUFLLFVBQVUsWUFBWSxLQUFLO0FBQUEsUUFDbEMsU0FBUyxPQUFPO0FBQ2QsZUFBSyxJQUFJLElBQUksZUFBZ0IsTUFBZ0IsT0FBTyxFQUFFO0FBQUEsUUFDeEQ7QUFBQSxNQUNGLENBQUMsRUFBRTtBQUFBLElBQ0w7QUFDQSxTQUFLLFVBQVU7QUFBQSxNQUNiLE1BQU0sR0FBRyx1QkFBdUIsQ0FBQyxVQUFVO0FBQ3pDLFlBQUk7QUFDRixlQUFLLFNBQVMsU0FBUyxLQUFLO0FBQUEsUUFDOUIsU0FBUyxPQUFPO0FBQ2QsZUFBSyxJQUFJLElBQUksa0JBQW1CLE1BQWdCLE9BQU8sRUFBRTtBQUFBLFFBQzNEO0FBQUEsTUFDRixDQUFDLEVBQUU7QUFBQSxJQUNMO0FBQUEsRUFDRjtBQUFBLEVBRVEsS0FBSyxNQUFjLE1BQTJCLFVBQThCO0FBQ2xGLFVBQU0sT0FBTyxZQUFZO0FBQ3ZCLFdBQUssT0FBTyxPQUFPLElBQUk7QUFDdkIsVUFBSSxLQUFLLFFBQVM7QUFDbEIsVUFBSTtBQUNGLGNBQU0sS0FBSztBQUFBLE1BQ2IsU0FBUyxPQUFPO0FBQ2QsYUFBSyxJQUFJLElBQUksR0FBRyxJQUFJLFlBQWEsTUFBZ0IsT0FBTyxFQUFFO0FBQUEsTUFDNUQ7QUFDQSxVQUFJLENBQUMsS0FBSyxRQUFTLE1BQUssT0FBTyxJQUFJLE1BQU0sV0FBVyxNQUFNLFNBQVMsQ0FBQyxDQUFDO0FBQUEsSUFDdkU7QUFDQSxTQUFLLE9BQU8sSUFBSSxNQUFNLFdBQVcsTUFBTSxTQUFTLENBQUMsQ0FBQztBQUFBLEVBQ3BEO0FBQUE7QUFBQSxFQUdRLEtBQUssTUFBYyxJQUFZLE1BQWlDO0FBQ3RFLFVBQU0sV0FBVyxLQUFLLE9BQU8sSUFBSSxJQUFJO0FBQ3JDLFFBQUksU0FBVSxjQUFhLFFBQVE7QUFDbkMsU0FBSyxPQUFPO0FBQUEsTUFDVjtBQUFBLE1BQ0EsV0FBVyxNQUFNO0FBQ2YsYUFBSyxPQUFPLE9BQU8sSUFBSTtBQUN2QixZQUFJLENBQUMsS0FBSyxRQUFTLE1BQUssS0FBSyxFQUFFLE1BQU0sQ0FBQyxVQUFVLEtBQUssSUFBSSxJQUFJLEdBQUcsSUFBSSxZQUFhLE1BQWdCLE9BQU8sRUFBRSxDQUFDO0FBQUEsTUFDN0csR0FBRyxFQUFFO0FBQUEsSUFDUDtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsTUFBYyxtQkFBa0M7QUFDOUMsZUFBVyxTQUFTLE9BQU8sT0FBTyxLQUFLLE1BQU0sS0FBSyxFQUFFLE1BQU0sR0FBRztBQUMzRCxVQUFJLENBQUMsTUFBTSxnQkFBZ0IsTUFBTSxhQUFhLE9BQVc7QUFDekQsWUFBTSxXQUFXLE1BQU0sV0FBVyxNQUFNLFlBQVk7QUFDcEQsWUFBTSxVQUFVLEtBQUssTUFBTSxLQUFLLEVBQUUsT0FBTyxNQUFNLEVBQUU7QUFDakQsVUFBSSxRQUFTLE1BQUssTUFBTSxZQUFZLE1BQU0sSUFBSSxRQUFRLFlBQVksRUFBRSxTQUFTLEdBQUcsTUFBTSxPQUFPO0FBQUEsSUFDL0Y7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdRLFFBQWM7QUFDcEIsVUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyQixlQUFXLFNBQVMsT0FBTyxPQUFPLEtBQUssTUFBTSxLQUFLLEVBQUUsTUFBTSxHQUFHO0FBQzNELFVBQUksTUFBTSxNQUFNO0FBRWQsY0FBTSxTQUFTLE1BQU0sU0FBUyxjQUFjLE1BQU0sV0FBVyxLQUFLLE1BQU0sS0FBSyxFQUFFLE9BQU8sTUFBTSxRQUFRLElBQUk7QUFDeEcsY0FBTSxXQUFXLE1BQU0sU0FBUyxlQUFlLENBQUMsVUFBVSxDQUFDLE9BQU8sU0FBUyxNQUFNLE1BQU0sYUFBYTtBQUNwRyxZQUFJLFNBQVUsTUFBSyxNQUFNLFlBQVksTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLE9BQU8sT0FBTyxXQUFXLFVBQVUsQ0FBQyxZQUFZLEVBQUUsR0FBRyxNQUFNLEtBQUs7QUFDNUg7QUFBQSxNQUNGO0FBQ0EsWUFBTSxNQUFNLE1BQU0sTUFBTTtBQUN4QixZQUFNLFFBQVMsTUFBTSxTQUFTLGNBQWMsTUFBTSx5QkFBMkIsTUFBTSxTQUFTLFdBQVcsQ0FBQyxNQUFNLFNBQVMsTUFBTTtBQUM3SCxVQUFJLE9BQU87QUFDVCxhQUFLLE1BQU0sWUFBWSxNQUFNLEVBQUU7QUFDL0IsYUFBSyxTQUFTLFlBQVksTUFBTSxFQUFFO0FBQUEsTUFDcEM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQSxFQUlRLE9BQWE7QUFDbkIsUUFBSSxDQUFDLEtBQUssUUFBUSxNQUFNLEtBQUssS0FBSyxRQUFTO0FBQzNDLFNBQUssS0FBSztBQUNWLFNBQUssS0FBSyxrQkFBa0IsS0FBSyxZQUFZO0FBQzNDLFlBQU0sS0FBSyxjQUFjLEtBQUs7QUFDOUIsWUFBTSxLQUFLLGNBQWMsUUFBUTtBQUFBLElBQ25DLENBQUM7QUFDRCxTQUFLLEtBQUssaUJBQWlCLE1BQU0sWUFBWTtBQUMzQyxZQUFNLEtBQUssU0FBUyxRQUFRO0FBQzVCLFlBQU0sS0FBSyxTQUFTLFFBQVE7QUFBQSxJQUM5QixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsT0FBYTtBQUNuQixTQUFLLEtBQUssc0JBQXNCLEtBQUssTUFBTSxLQUFLLGNBQWMsS0FBSyxDQUFDO0FBQ3BFLFNBQUssS0FBSyxlQUFlLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxDQUFDO0FBQUEsRUFDeEQ7QUFBQSxFQUVBLE1BQWMsUUFBUSxRQUFRLE9BQXNCO0FBQ2xELFFBQUksQ0FBQyxTQUFTLEtBQUssTUFBTSxRQUFRLEtBQUssYUFBYztBQUNwRCxRQUFJO0FBQ0YsWUFBTSxLQUFLLFlBQVksYUFBYSxLQUFLLE1BQU0sU0FBUyxDQUFDO0FBQ3pELFdBQUssZUFBZSxLQUFLLE1BQU07QUFDL0IsWUFBTSxLQUFLLFFBQVEsZ0JBQWdCO0FBQUEsSUFDckMsU0FBUyxPQUFPO0FBQ2QsV0FBSyxJQUFJLElBQUksbUJBQW9CLE1BQWdCLE9BQU8sRUFBRTtBQUFBLElBQzVEO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxNQUFjLFlBQTZCO0FBQ3pDLFVBQU0sT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLElBQXFGLENBQUMsVUFBVSxNQUFNLEdBQUcsRUFBRSxXQUFXLElBQUssQ0FBQztBQUM1SixRQUFJLENBQUMsS0FBSyxHQUFJLFFBQU8sd0NBQXdDLEtBQUssT0FBTztBQUN6RSxVQUFNLE9BQU8sTUFBTSxRQUFRLEtBQUssTUFBTSxJQUFJLEtBQUssU0FBVSxLQUFLLE9BQU8sV0FBVyxDQUFDO0FBQ2pGLFVBQU0sTUFBTSxLQUFLLEtBQUssQ0FBQyxRQUFRLElBQUksT0FBTyxnQkFBZ0IsSUFBSSxLQUFLLFNBQVMsYUFBYSxDQUFDLEdBQUc7QUFDN0YsUUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixVQUFNLFNBQVMsTUFBTSxLQUFLLElBQUksSUFBSSxJQUFJLENBQUMsVUFBVSxRQUFRLEtBQUssV0FBVyxNQUFNLEdBQUcsRUFBRSxXQUFXLElBQUssQ0FBQztBQUNyRyxXQUFPLE9BQU8sS0FBSyw2QkFBNkIsNkJBQTZCLE9BQU8sT0FBTztBQUFBLEVBQzdGO0FBQUEsRUFFUSxrQkFBd0I7QUFDOUIsUUFBSSxDQUFDLEtBQUssS0FBSyxLQUFLLElBQUksa0JBQWtCLEVBQUc7QUFDN0MsVUFBTSxTQUFTLE9BQU8sT0FBTyxLQUFLLE1BQU0sS0FBSyxFQUFFLE1BQU07QUFDckQsVUFBTSxVQUFVLE9BQU8sT0FBTyxDQUFDLFVBQVUsTUFBTSxTQUFTLE1BQU0sVUFBVSxhQUFhLE1BQU0sVUFBVSxhQUFhLE1BQU0sVUFBVSxVQUFVLEVBQUU7QUFDOUksVUFBTSxVQUFVLE9BQU8sT0FBTyxDQUFDLFVBQVUsTUFBTSxRQUFRLE1BQU0sVUFBVSxTQUFTLEVBQUU7QUFDbEYsVUFBTSxNQUFNLEdBQUcsT0FBTyxJQUFJLE9BQU87QUFDakMsUUFBSSxRQUFRLEtBQUssVUFBVztBQUM1QixTQUFLLFlBQVk7QUFDakIsU0FBSyxLQUFLLEtBQUssS0FDWixLQUFLLG9CQUFvQjtBQUFBLE1BQ3hCLElBQUk7QUFBQSxNQUNKLE1BQU0sVUFBVSxtQkFBZ0IsT0FBTyxXQUFXLFVBQVUsU0FBTSxPQUFPLGFBQWEsRUFBRSxLQUFLO0FBQUEsTUFDN0YsTUFBTSxVQUFVLFlBQVksVUFBVSxXQUFXO0FBQUEsTUFDakQsU0FBUztBQUFBLElBQ1gsQ0FBQyxFQUNBLE1BQU0sTUFBTTtBQUNYLFdBQUssWUFBWTtBQUFBLElBQ25CLENBQUM7QUFBQSxFQUNMO0FBQUEsRUFFUSxzQkFBNEI7QUFDbEMsVUFBTSxjQUF1QyxDQUFDO0FBQzlDLGVBQVcsVUFBVSxhQUFjLGFBQVksTUFBTSxJQUFJLEtBQUssS0FBSyxLQUFLLElBQUksTUFBTTtBQUNsRixVQUFNLFFBQVEsRUFBRSxTQUFTLENBQUMsTUFBYyxLQUFLLEtBQUssS0FBSyxJQUFJLENBQUMsR0FBRyxLQUFLLFFBQVEsS0FBSyxJQUFJLElBQUksSUFBSSxHQUFHLGtCQUFrQixLQUFLLFNBQVMsaUJBQWlCO0FBQ2pKLFVBQU0sV0FBbUUsQ0FBQztBQUMxRSxlQUFXLFFBQVEsYUFBYyxVQUFTLElBQUksSUFBSSxvQkFBb0IsTUFBTSxLQUFLO0FBQ2pGLFNBQUssTUFBTSxJQUFJO0FBQUEsTUFDYixRQUFRO0FBQUEsTUFDUixJQUFJO0FBQUEsTUFDSixPQUFPO0FBQUEsUUFDTDtBQUFBLFFBQ0E7QUFBQSxRQUNBLGtCQUFrQixLQUFLLFNBQVM7QUFBQSxRQUNoQyxVQUFVLEtBQUssU0FBUztBQUFBLFFBQ3hCLG1CQUFtQixLQUFLLFNBQVM7QUFBQSxRQUNqQyxjQUFjLFFBQVEsS0FBSyxJQUFJLElBQUksSUFBSTtBQUFBLFFBQ3ZDLFNBQVMsS0FBSyxJQUFJLElBQUk7QUFBQSxRQUN0QixPQUFPO0FBQUEsUUFDUCxXQUFXLEVBQUUsU0FBUyxRQUFRLEtBQUssU0FBUyxHQUFHLEtBQUssS0FBSyxZQUFZLFlBQVksS0FBSztBQUFBLFFBQ3RGLFVBQVUsS0FBSyxLQUFLLElBQUk7QUFBQSxRQUN4QixTQUFTQyxTQUFRO0FBQUEsTUFDbkI7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLGVBQWtDO0FBQzlDLFFBQUk7QUFDRixZQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssU0FBUyxJQUFJO0FBQ3pDLGFBQU87QUFBQTtBQUFBLFFBRUwsa0JBQWtCLElBQUkscUJBQXFCO0FBQUEsUUFDM0MsZUFBZSxPQUFPLElBQUksa0JBQWtCLFlBQVksSUFBSSxpQkFBaUIsUUFBUSxJQUFJLGlCQUFpQixPQUFRLElBQUksZ0JBQWdCO0FBQUEsUUFDdEksbUJBQW1CLElBQUksc0JBQXNCO0FBQUEsUUFDN0Msa0JBQWtCLElBQUkscUJBQXFCO0FBQUEsUUFDM0MsU0FBUyxPQUFPLElBQUksWUFBWSxXQUFXLElBQUksUUFBUSxLQUFLLElBQUk7QUFBQSxRQUNoRSxVQUFVLElBQUksYUFBYTtBQUFBLFFBQzNCLGNBQWMsSUFBSSxpQkFBaUI7QUFBQSxNQUNyQztBQUFBLElBQ0YsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxvQkFBbUM7QUFDL0MsVUFBTSxTQUFTLEtBQUs7QUFDcEIsU0FBSyxXQUFXLE1BQU0sS0FBSyxhQUFhO0FBQ3hDLFFBQUksT0FBTyxZQUFZLEtBQUssU0FBUyxTQUFTO0FBQzVDLFdBQUssSUFBSSxNQUFNLGdCQUFnQixNQUFNLGVBQWUsS0FBSyxTQUFTLFdBQVcsSUFBSSxDQUFDO0FBQUEsSUFDcEY7QUFDQSxVQUFNLEtBQUssY0FBYyxLQUFLO0FBQzlCLFNBQUssb0JBQW9CO0FBQUEsRUFDM0I7QUFBQTtBQUFBLEVBR1EsY0FBY0MsY0FBcUM7QUFDekQsU0FBSyxjQUFjLEtBQUssWUFBWSxNQUFNLE1BQU0sTUFBUyxFQUFFLEtBQUssTUFBTSxLQUFLLGlCQUFpQkEsWUFBVyxDQUFDO0FBQ3hHLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQSxFQUVBLE1BQWMsaUJBQWlCQSxjQUFxQztBQUNsRSxVQUFNLE9BQU8sS0FBSyxTQUFTLG9CQUFvQixDQUFDLEtBQUs7QUFDckQsUUFBSSxLQUFLLGNBQWMsQ0FBQyxRQUFRQSxlQUFjO0FBQzVDLFlBQU0sS0FBSyxVQUFVLEtBQUs7QUFDMUIsV0FBSyxZQUFZO0FBQUEsSUFDbkI7QUFDQSxRQUFJLENBQUMsUUFBUSxLQUFLLFdBQVc7QUFDM0IsV0FBSyxvQkFBb0I7QUFDekI7QUFBQSxJQUNGO0FBQ0EsUUFBSTtBQUNGLFlBQU0sYUFBYSxLQUFLLEtBQUssS0FBSyxJQUFJLG9CQUFvQixLQUFLLE1BQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxzQkFBc0IsQ0FBQyxDQUFDLEdBQUcsU0FBUztBQUU3SCxZQUFNLFFBQVFBLGVBQWMsTUFBTSxZQUFxQixLQUFLLEtBQUssU0FBUyxZQUFZLFNBQVMsQ0FBQyxJQUFJLE1BQU0sa0JBQWtCLEtBQUssS0FBSyxTQUFTLFlBQVksU0FBUyxDQUFDO0FBQ3JLLFlBQU0sU0FBUyxJQUFJLGdCQUFnQjtBQUFBLFFBQ2pDLE9BQU8sY0FBYyxJQUFJLElBQUksU0FBUyxZQUFZLEdBQUcsQ0FBQztBQUFBLFFBQ3REO0FBQUEsUUFDQSxNQUFNLEtBQUssU0FBUztBQUFBLFFBQ3BCLGVBQWUsTUFBTSxLQUFLLFNBQVM7QUFBQSxRQUNuQyxVQUFVLE1BQU07QUFDZCxlQUFLLEtBQUs7QUFDVixpQkFBTyxLQUFLLE1BQU0sU0FBUztBQUFBLFFBQzdCO0FBQUEsUUFDQSxXQUFXLENBQUMsYUFBYSxLQUFLLE1BQU0sVUFBVSxRQUFRO0FBQUEsUUFDdEQsaUJBQWlCLENBQUMsYUFBYSxLQUFLLGNBQWMsVUFBVSxRQUFRO0FBQUEsUUFDcEUsU0FBUyxDQUFDLE9BQU8sWUFBWTtBQUMzQixlQUFLLEtBQUs7QUFDVixpQkFBTyxLQUFLLE9BQU8sT0FBTyxPQUFPLE9BQU87QUFBQSxRQUMxQztBQUFBLFFBQ0EsS0FBSyxLQUFLLElBQUk7QUFBQSxNQUNoQixDQUFDO0FBQ0QsWUFBTSxPQUFPLE1BQU07QUFDbkIsVUFBSSxDQUFDLEtBQUssU0FBUyxvQkFBb0IsS0FBSyxRQUFTLE9BQU0sT0FBTyxLQUFLO0FBQUEsVUFDbEUsTUFBSyxZQUFZO0FBQ3RCLFdBQUssbUJBQW1CO0FBQUEsSUFDMUIsU0FBUyxPQUFPO0FBQ2QsV0FBSyxJQUFJLElBQUksOEJBQStCLE1BQWdCLE9BQU8sRUFBRTtBQUdyRSxVQUFJLEtBQUssbUJBQW1CLG1CQUFtQjtBQUM3QyxjQUFNLFFBQVEsTUFBTyxLQUFLLEtBQUs7QUFDL0IsYUFBSyxLQUFLLG1CQUFtQixPQUFPLE1BQU0sS0FBSyxjQUFjLEtBQUssQ0FBQztBQUFBLE1BQ3JFO0FBQUEsSUFDRjtBQUNBLFNBQUssb0JBQW9CO0FBQUEsRUFDM0I7QUFBQSxFQUVBLE1BQWMsYUFBNEI7QUFDeEMsUUFBSTtBQUNGLFlBQU0sTUFBTyxNQUFNLEtBQUssS0FBSyxRQUFRLElBQUksUUFBUTtBQUNqRCxVQUFJLE9BQU8sT0FBTyxRQUFRLFVBQVU7QUFDbEMsYUFBSyxNQUFNLElBQUksRUFBRSxRQUFRLFVBQVUsSUFBSSxVQUFVLE9BQU8sRUFBRSxHQUFHLGNBQWMsR0FBRyxJQUFJLEVBQWlCLENBQUM7QUFBQSxNQUN0RztBQUFBLElBQ0YsUUFBUTtBQUFBLElBRVI7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFdBQVcsUUFBb0M7QUFDM0QsVUFBTSxLQUFLLEtBQUssUUFBUSxJQUFJLFVBQVUsTUFBZTtBQUNyRCxTQUFLLE1BQU0sSUFBSSxFQUFFLFFBQVEsVUFBVSxJQUFJLFVBQVUsT0FBTyxPQUFPLENBQUM7QUFDaEUsVUFBTSxLQUFLLFNBQVMsUUFBUTtBQUFBLEVBQzlCO0FBQ0Y7OztBc0MzZ0JBLElBQUksVUFBbUM7QUFFdkMsZUFBTyxTQUFnQyxNQUFvQztBQUN6RSxZQUFVLElBQUksaUJBQWlCLElBQUk7QUFDbkMsUUFBTSxRQUFRLE1BQU07QUFDdEI7QUFFQSxlQUFzQixhQUE0QjtBQUNoRCxRQUFNLFNBQVMsS0FBSztBQUNwQixZQUFVO0FBQ1o7IiwKICAibmFtZXMiOiBbImhvbWVkaXIiLCAiY2xlYW4iLCAic3RhdCIsICJzZXAiLCAiZmxhZyIsICJhc1JlY29yZCIsICJzdHIiLCAicmVhZGRpciIsICJyZWFkRmlsZSIsICJqb2luIiwgInJlYWRkaXIiLCAiam9pbiIsICJyZWFkRmlsZSIsICJvcGVuIiwgInJlYWRkaXIiLCAic3RhdCIsICJob21lZGlyIiwgImpvaW4iLCAicmVhZEZpbGUiLCAiaG9tZWRpciIsICJqb2luIiwgInJlc29sdmUiLCAiaG9tZWRpciIsICJwbGF0Zm9ybSIsICJqb2luIiwgImhvbWVkaXIiLCAicGxhdGZvcm0iLCAiam9pbiIsICJieXRlcyIsICJjcmVhdGVIYXNoIiwgImV4ZWNGaWxlIiwgInJlc29sdmUiLCAiZXhlY0ZpbGUiLCAicmFuZG9tVVVJRCIsICJyYW5kb21VVUlEIiwgInJlYWRGaWxlIiwgInN0YXQiLCAiaG9tZWRpciIsICJwbGF0Zm9ybSIsICJqb2luIiwgInJlc29sdmUiLCAicmFuZG9tVVVJRCIsICJvcGVuIiwgInN0YXQiLCAiS0VFUF9NRVNTQUdFUyIsICJURVhUX0xJTUlUIiwgIlRPT0xfTElNSVQiLCAidGFpbCIsICJzdGF0IiwgInRhaWwiLCAicmVhZCIsICJLRUVQX01FU1NBR0VTIiwgIm9wZW4iLCAiVEVYVF9MSU1JVCIsICJUT09MX0xJTUlUIiwgImltYWdlcyIsICJjcmVhdGVIYXNoIiwgIm1rZGlyIiwgInJlYWRGaWxlIiwgIndyaXRlRmlsZSIsICJqb2luIiwgInJlYWRGaWxlIiwgInN0YXQiLCAiY29uc3RhbnRzIiwgInJlc29sdmUiLCAicmVzb2x2ZSIsICJzdGF0IiwgInJlYWRGaWxlIiwgImNvbnN0YW50cyIsICJicm90bGkiLCAicmVhZEZpbGUiLCAic3RhdCIsICJqb2luIiwgIm1rZGlyIiwgInJlYWRkaXIiLCAicmVhZEZpbGUiLCAic3RhdCIsICJ3cml0ZUZpbGUiLCAiaG9tZWRpciIsICJwbGF0Zm9ybSIsICJqb2luIiwgIk1BWF9SVU5TIiwgIm1rZGlyIiwgInJlYWRGaWxlIiwgInJlbmFtZSIsICJ3cml0ZUZpbGUiLCAiam9pbiIsICJyZWFkRmlsZSIsICJqb2luIiwgImhvbWVkaXIiLCAicm90YXRlVG9rZW4iXQp9Cg==
