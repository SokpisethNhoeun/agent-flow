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
      const live = !finished && writing;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3dvcmtlci9ydW50aW1lLnRzIiwgIi4uL3NyYy9zaGFyZWQvY29tbWFuZHMudHMiLCAiLi4vc3JjL3NoYXJlZC9tb2RlbC50cyIsICIuLi9zcmMvd29ya2VyL2FkYXB0ZXJzL2FjY291bnRzLWFkYXB0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9jb250ZXh0LnRzIiwgIi4uL3NyYy93b3JrZXIvc3RhdGUvaWRlbnRpdHktaW5kZXgudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9tZXJnZS1hZ2VudHMudHMiLCAiLi4vc3JjL3dvcmtlci9hZGFwdGVycy9hZ2VudHMtYWRhcHRlci50cyIsICIuLi9zcmMvc2hhcmVkL3JlZGFjdC50cyIsICIuLi9zcmMvc2hhcmVkL3Rhc2stc3RhdGVzLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvb3JjaGVzdHJhdGlvbi1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvc2Vzc2lvbnMtYWRhcHRlci50cyIsICIuLi9zcmMvd29ya2VyL2FkYXB0ZXJzL3N1YmFnZW50LWFkYXB0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9hZGFwdGVycy9zdWJhZ2VudC1maWxlcy1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvYWRhcHRlcnMvc2Vzc2lvbi1tb2RlbC1hZGFwdGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvY2xpL29yY2EtY2xpLnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvYXZhaWxhYmlsaXR5LnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvYXR0YWNobWVudHMudHMiLCAiLi4vc3JjL3dvcmtlci9jb21tYW5kcy9yb3V0ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9naXQvZ2l0LWluc3BlY3QudHMiLCAiLi4vc3JjL3dvcmtlci9jb21tYW5kcy9jb29yZGluYXRvci1jb21tYW5kcy50cyIsICIuLi9zcmMvd29ya2VyL2NvbW1hbmRzL3RyYW5zY3JpcHQudHMiLCAiLi4vc3JjL3dvcmtlci9ydW50aW1lLXJwYy9jaGF0LXNlbmQudHMiLCAiLi4vc3JjL3dvcmtlci9ydW50aW1lLXJwYy9vcmNhLXJ1bnRpbWUtY2xpZW50LnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvY2xhdWRlLXRyYW5zY3JpcHQudHMiLCAiLi4vc3JjL3dvcmtlci9kYXNoYm9hcmQvYXV0aC50cyIsICIuLi9zcmMvd29ya2VyL2Rhc2hib2FyZC9zZXJ2ZXIudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9oaXN0b3J5LXJlY29yZGVyLnRzIiwgIi4uL3NyYy93b3JrZXIvZ2l0L3JlcG8tcm9vdC50cyIsICIuLi9zcmMvd29ya2VyL3N0YXRlL3BlcnNpc3RlbmNlLnRzIiwgIi4uL3NyYy9zaGFyZWQvZXZlbnRzLnRzIiwgIi4uL3NyYy93b3JrZXIvc3RhdGUvc3RvcmUudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS92aWV3ZXJzLnRzIiwgIi4uL3NyYy93b3JrZXIvY29tbWFuZHMvb3V0cHV0LXdhdGNoZXIudHMiLCAiLi4vc3JjL3dvcmtlci9zdGF0ZS9zdGFyLXByb21wdC50cyIsICIuLi9zcmMvd29ya2VyL3VwZGF0ZS91cGRhdGUtY2hlY2sudHMiLCAiLi4vc3JjL3dvcmtlci90cmFuc3BvcnQvc25hcHNob3QtYnVkZ2V0LnRzIiwgIi4uL3NyYy93b3JrZXIvdHJhbnNwb3J0L3BhbmVsLWJyaWRnZS50cyIsICIuLi9zcmMvd29ya2VyL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFdpcmVzIGFkYXB0ZXJzLCBzdG9yZSwgcGVyc2lzdGVuY2UsIGNvbW1hbmRzIGFuZCB0cmFuc3BvcnRzLCBhbmQgcGFjZXMgdGhlIHBvbGxpbmcuXG5pbXBvcnQgeyBob21lZGlyIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCdcbmltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHsgQUxMX0NPTU1BTkRTIH0gZnJvbSAnLi4vc2hhcmVkL2NvbW1hbmRzLnRzJ1xuaW1wb3J0IHsgRU1QVFlfTEFCRUxTLCB0eXBlIExhYmVsQ29uZmlnIH0gZnJvbSAnLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgQWNjb3VudHNBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9hY2NvdW50cy1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgQWdlbnRzQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvYWdlbnRzLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBPcmNoZXN0cmF0aW9uQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb3JjaGVzdHJhdGlvbi1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU2Vzc2lvbnNBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zZXNzaW9ucy1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU3ViYWdlbnRBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zdWJhZ2VudC1hZGFwdGVyLnRzJ1xuaW1wb3J0IHsgU3ViYWdlbnRGaWxlc0FkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzL3N1YmFnZW50LWZpbGVzLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBTZXNzaW9uTW9kZWxBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9zZXNzaW9uLW1vZGVsLWFkYXB0ZXIudHMnXG5pbXBvcnQgeyBjcmVhdGVDbGlSdW5uZXIsIHJlc29sdmVDbGlQYXRoIH0gZnJvbSAnLi9jbGkvb3JjYS1jbGkudHMnXG5pbXBvcnQgeyBjb21tYW5kQXZhaWxhYmlsaXR5IH0gZnJvbSAnLi9jb21tYW5kcy9hdmFpbGFiaWxpdHkudHMnXG5pbXBvcnQgeyBDb21tYW5kUm91dGVyIH0gZnJvbSAnLi9jb21tYW5kcy9yb3V0ZXIudHMnXG5pbXBvcnQgdHlwZSB7IFdvcmtlckNvbnRleHQgfSBmcm9tICcuL2NvbnRleHQudHMnXG5pbXBvcnQgeyBsb2FkT3JDcmVhdGVUb2tlbiwgcm90YXRlVG9rZW4gYXMgcm90YXRlRGFzaGJvYXJkVG9rZW4gfSBmcm9tICcuL2Rhc2hib2FyZC9hdXRoLnRzJ1xuaW1wb3J0IHsgRGFzaGJvYXJkU2VydmVyIH0gZnJvbSAnLi9kYXNoYm9hcmQvc2VydmVyLnRzJ1xuaW1wb3J0IHsgSGlzdG9yeVJlY29yZGVyIH0gZnJvbSAnLi9zdGF0ZS9oaXN0b3J5LXJlY29yZGVyLnRzJ1xuaW1wb3J0IHsgcmVwb1Jvb3RPZiB9IGZyb20gJy4vZ2l0L3JlcG8tcm9vdC50cydcbmltcG9ydCB7IHNlbmRDaGF0TWVzc2FnZSB9IGZyb20gJy4vcnVudGltZS1ycGMvY2hhdC1zZW5kLnRzJ1xuaW1wb3J0IHsgSWRlbnRpdHlJbmRleCB9IGZyb20gJy4vc3RhdGUvaWRlbnRpdHktaW5kZXgudHMnXG5pbXBvcnQgeyBtZXJnZUR1cGxpY2F0ZXNPZiB9IGZyb20gJy4vc3RhdGUvbWVyZ2UtYWdlbnRzLnRzJ1xuaW1wb3J0IHsgUGVyc2lzdGVuY2UsIHN0YXRlRGlyIH0gZnJvbSAnLi9zdGF0ZS9wZXJzaXN0ZW5jZS50cydcbmltcG9ydCB7IEZsb3dTdG9yZSB9IGZyb20gJy4vc3RhdGUvc3RvcmUudHMnXG5pbXBvcnQgeyBWaWV3ZXJUcmFja2VyIH0gZnJvbSAnLi9zdGF0ZS92aWV3ZXJzLnRzJ1xuaW1wb3J0IHsgT3V0cHV0V2F0Y2hlciB9IGZyb20gJy4vY29tbWFuZHMvb3V0cHV0LXdhdGNoZXIudHMnXG5pbXBvcnQgeyBBdHRhY2htZW50U3RvcmUsIGF0dGFjaG1lbnRzUm9vdCB9IGZyb20gJy4vY29tbWFuZHMvYXR0YWNobWVudHMudHMnXG5pbXBvcnQgeyBTdGFyUHJvbXB0U3RvcmUgfSBmcm9tICcuL3N0YXRlL3N0YXItcHJvbXB0LnRzJ1xuaW1wb3J0IHsgVXBkYXRlQ2hlY2tlciB9IGZyb20gJy4vdXBkYXRlL3VwZGF0ZS1jaGVjay50cydcbmltcG9ydCB7IGNvbm5lY3RQYW5lbHMgfSBmcm9tICcuL3RyYW5zcG9ydC9wYW5lbC1icmlkZ2UudHMnXG5cbnR5cGUgU2V0dGluZ3MgPSB7XG4gIGRhc2hib2FyZEVuYWJsZWQ6IGJvb2xlYW5cbiAgZGFzaGJvYXJkUG9ydDogbnVtYmVyXG4gIGRhc2hib2FyZENvbnRyb2xzOiBib29sZWFuXG4gIGFjdEFzQ29vcmRpbmF0b3I6IGJvb2xlYW5cbiAgY2xpUGF0aDogc3RyaW5nXG4gIGNoYXRTZW5kOiBib29sZWFuXG4gIGNoZWNrVXBkYXRlczogYm9vbGVhblxufVxuXG4vKiogRXZlcnl0aGluZyBvbiBieSBkZWZhdWx0ICh0aGUgbWFuaWZlc3QncyBkZWZhdWx0cyBtYXRjaCk7IGVhY2ggc2V0dGluZyBjYW4gYmUgdHVybmVkIG9mZiBpbiBPcmNhLiAqL1xuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogU2V0dGluZ3MgPSB7IGRhc2hib2FyZEVuYWJsZWQ6IHRydWUsIGRhc2hib2FyZFBvcnQ6IDQ3OTAsIGRhc2hib2FyZENvbnRyb2xzOiB0cnVlLCBhY3RBc0Nvb3JkaW5hdG9yOiB0cnVlLCBjbGlQYXRoOiAnJywgY2hhdFNlbmQ6IHRydWUsIGNoZWNrVXBkYXRlczogdHJ1ZSB9XG4vKiogU3RhcnQgYXR0ZW1wdHMgYWZ0ZXIgYSBmYWlsdXJlOiAyIHMsIDQgcywgOCBzLCAxNiBzLCAzMiBzLiAqL1xuY29uc3QgREFTSEJPQVJEX1JFVFJJRVMgPSA1XG4vKiogSG93IG9mdGVuIHN0YXRlIGlzIHNhdmVkIGZvciBjcmFzaCByZWNvdmVyeSAob25seSB3aGVuIHNvbWV0aGluZyBjaGFuZ2VkKS4gKi9cbmNvbnN0IFBFUlNJU1RfTVMgPSAxMl8wMDBcbmNvbnN0IFNVQkFHRU5UX09SUEhBTl9NUyA9IDUgKiA2MCAqIDEwMDBcbmNvbnN0IFNVQkFHRU5UX1JFVEVOVElPTl9NUyA9IDI0ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IFNUQU5EQUxPTkVfUkVURU5USU9OX01TID0gNyAqIDI0ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IEhPU1RfTUVUSE9EUyA9IFsnd29ya3NwYWNlLmxpc3QnLCAnYWdlbnRzLmxpc3QnLCAnYWdlbnQubGlzdFNlc3Npb25zJywgJ3Rlcm1pbmFsLnJlYWQnLCAndGVybWluYWwuZm9jdXMnLCAndGVybWluYWwuY2xvc2UnLCAndGVybWluYWwuc2VuZFRleHQnLCAnYWdlbnQubGF1bmNoJywgJ2FnZW50LnJlc3VtZScsICd3b3Jrc3BhY2UuY3JlYXRlJywgJ3dvcmtzcGFjZS5vcGVuJywgJ3N0YXR1c0Jhci51cGRhdGUnXVxuXG5leHBvcnQgY2xhc3MgQWdlbnRGbG93UnVudGltZSB7XG4gIHByaXZhdGUgc3RvcmUgPSBuZXcgRmxvd1N0b3JlKClcbiAgcHJpdmF0ZSBpZGVudGl0eSA9IG5ldyBJZGVudGl0eUluZGV4KClcbiAgcHJpdmF0ZSBwZXJzaXN0ZW5jZSA9IG5ldyBQZXJzaXN0ZW5jZSgpXG4gIHByaXZhdGUgdmlld2VycyA9IG5ldyBWaWV3ZXJUcmFja2VyKERhdGUubm93KVxuICBwcml2YXRlIG91dHB1dFdhdGNoZXIgPSBuZXcgT3V0cHV0V2F0Y2hlcigpXG4gIHByaXZhdGUgc2V0dGluZ3M6IFNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HU1xuICBwcml2YXRlIG93blRlcm1pbmFscyA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIC8qKiBPbmUgcGVuZGluZyB0aW1lciBwZXIgbmFtZWQgbG9vcCwgc28gbm90aGluZyBhY2N1bXVsYXRlcyBhbmQgc3RvcCgpIGNsZWFycyBldmVyeXRoaW5nLiAqL1xuICBwcml2YXRlIHRpbWVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pj4oKVxuICBwcml2YXRlIGRhc2hib2FyZE9wOiBQcm9taXNlPHZvaWQ+ID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgcHJpdmF0ZSBkaXNwb3NlcnM6ICgoKSA9PiB2b2lkKVtdID0gW11cbiAgcHJpdmF0ZSBkYXNoYm9hcmQ6IERhc2hib2FyZFNlcnZlciB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgZGFzaGJvYXJkUmV0cmllcyA9IDBcbiAgcHJpdmF0ZSBjdHghOiBXb3JrZXJDb250ZXh0XG4gIHByaXZhdGUgYWdlbnRzITogQWdlbnRzQWRhcHRlclxuICBwcml2YXRlIHN1YmFnZW50cyE6IFN1YmFnZW50QWRhcHRlclxuICBwcml2YXRlIG9yY2hlc3RyYXRpb24hOiBPcmNoZXN0cmF0aW9uQWRhcHRlclxuICBwcml2YXRlIGFjY291bnRzITogQWNjb3VudHNBZGFwdGVyXG4gIHByaXZhdGUgc2Vzc2lvbnMhOiBTZXNzaW9uc0FkYXB0ZXJcbiAgcHJpdmF0ZSBzdWJhZ2VudEZpbGVzITogU3ViYWdlbnRGaWxlc0FkYXB0ZXJcbiAgcHJpdmF0ZSBzZXNzaW9uTW9kZWxzITogU2Vzc2lvbk1vZGVsQWRhcHRlclxuICBwcml2YXRlIHJvdXRlciE6IENvbW1hbmRSb3V0ZXJcbiAgcHJpdmF0ZSBoaXN0b3J5ITogSGlzdG9yeVJlY29yZGVyXG4gIHByaXZhdGUgcGVyc2lzdGVkU2VxID0gLTFcbiAgcHJpdmF0ZSBzdGF0dXNLZXkgPSAnJ1xuICBwcml2YXRlIHN0b3BwZWQgPSBmYWxzZVxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgb3JjYTogT3JjYVdvcmtlckFwaSkge31cblxuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBsb2cgPSAobWVzc2FnZTogc3RyaW5nKSA9PiB0aGlzLm9yY2EubG9nKGBbYWdlbnQtZmxvd10gJHttZXNzYWdlfWApXG4gICAgdGhpcy5zZXR0aW5ncyA9IGF3YWl0IHRoaXMucmVhZFNldHRpbmdzKClcbiAgICBjb25zdCBjbGkgPSBjcmVhdGVDbGlSdW5uZXIoYXdhaXQgcmVzb2x2ZUNsaVBhdGgodGhpcy5zZXR0aW5ncy5jbGlQYXRoIHx8IG51bGwpKVxuICAgIGlmICghY2xpLnBhdGgpIGxvZygnb3JjYSBDTEkgbm90IGZvdW5kOyBvcmNoZXN0cmF0aW9uIGRhdGEgYW5kIGNvbnRyb2xzIGFyZSBvZmYnKVxuICAgIHRoaXMuY3R4ID0geyBvcmNhOiB0aGlzLm9yY2EsIHN0b3JlOiB0aGlzLnN0b3JlLCBjbGksIGlkZW50aXR5OiB0aGlzLmlkZW50aXR5LCBub3c6IERhdGUubm93LCBsb2cgfVxuXG4gICAgYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZS5pbml0KCkuY2F0Y2goKGVycm9yKSA9PiBsb2coYHN0YXRlIGZvbGRlcjogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YCkpXG4gICAgY29uc3Qgc2F2ZWQgPSBhd2FpdCB0aGlzLnBlcnNpc3RlbmNlLmxvYWRTbmFwc2hvdCgpXG4gICAgaWYgKHNhdmVkKSB7XG4gICAgICB0aGlzLnN0b3JlLnJlc3RvcmUoc2F2ZWQpXG4gICAgICAvLyBPbGRlciB2ZXJzaW9ucyBjb3VsZCBzdG9yZSBvbmUgc2Vzc2lvbiB0d2ljZTsga2VlcCB0aGUgbW9zdCByZWNlbnRseSBzZWVuIHJlY29yZC5cbiAgICAgIGNvbnN0IGJ5U2Vzc2lvbiA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpLnNvcnQoKGEsIGIpID0+IGIubGFzdFNlZW5BdCAtIGEubGFzdFNlZW5BdCkpIHtcbiAgICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICAgICAgaWYgKGJ5U2Vzc2lvbi5oYXMoYWdlbnQuc2Vzc2lvbklkKSkgdGhpcy5zdG9yZS5yZW1vdmVBZ2VudChhZ2VudC5pZClcbiAgICAgICAgZWxzZSBieVNlc3Npb24uc2V0KGFnZW50LnNlc3Npb25JZCwgYWdlbnQuaWQpXG4gICAgICB9XG4gICAgICAvLyBSZS1saW5rIHJlc3RvcmVkIGFnZW50cyBzbyBsaXZlIGV2ZW50cyBsYW5kIG9uIHRoZSBzYW1lIG5vZGUgaW5zdGVhZCBvZiBhIGR1cGxpY2F0ZS5cbiAgICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgICAgIHRoaXMuaWRlbnRpdHkubGluayhhZ2VudC5pZCwgeyB0ZXJtaW5hbElkOiBhZ2VudC50ZXJtaW5hbElkLCBwYW5lS2V5OiBhZ2VudC5wYW5lS2V5LCBzZXNzaW9uSWQ6IGFnZW50LnNlc3Npb25JZCwgdGVybWluYWxIYW5kbGU6IGFnZW50LnRlcm1pbmFsSGFuZGxlIH0pXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXModGhpcy5zdG9yZS5yZWFkKCkuYWdlbnRzKSkgaWYgKGFnZW50LmRpc3BhdGNoSWQpIG1lcmdlRHVwbGljYXRlc09mKHRoaXMuc3RvcmUsIHRoaXMuaWRlbnRpdHksIGFnZW50LmlkKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLmxvYWRMYWJlbHMoKVxuXG4gICAgdGhpcy5hZ2VudHMgPSBuZXcgQWdlbnRzQWRhcHRlcih0aGlzLmN0eClcbiAgICB0aGlzLnN1YmFnZW50cyA9IG5ldyBTdWJhZ2VudEFkYXB0ZXIodGhpcy5jdHgpXG4gICAgdGhpcy5vcmNoZXN0cmF0aW9uID0gbmV3IE9yY2hlc3RyYXRpb25BZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuYWNjb3VudHMgPSBuZXcgQWNjb3VudHNBZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuc2Vzc2lvbnMgPSBuZXcgU2Vzc2lvbnNBZGFwdGVyKHRoaXMuY3R4KVxuICAgIHRoaXMuc3ViYWdlbnRGaWxlcyA9IG5ldyBTdWJhZ2VudEZpbGVzQWRhcHRlcih0aGlzLmN0eCwgKCkgPT4gdGhpcy5hY2NvdW50cy5jbGF1ZGVIb21lcygpKVxuICAgIHRoaXMuc2Vzc2lvbk1vZGVscyA9IG5ldyBTZXNzaW9uTW9kZWxBZGFwdGVyKHRoaXMuY3R4LCB0aGlzLnN1YmFnZW50RmlsZXMsICgpID0+IHRoaXMuYWNjb3VudHMuY29kZXhIb21lcygpKVxuICAgIHRoaXMuaGlzdG9yeSA9IG5ldyBIaXN0b3J5UmVjb3JkZXIodGhpcy5zdG9yZSwgdGhpcy5wZXJzaXN0ZW5jZSwgbG9nKVxuICAgIHRoaXMucm91dGVyID0gbmV3IENvbW1hbmRSb3V0ZXIoe1xuICAgICAgY3R4OiB0aGlzLmN0eCxcbiAgICAgIHBlcnNpc3RlbmNlOiB0aGlzLnBlcnNpc3RlbmNlLFxuICAgICAgb3duVGVybWluYWxzOiB0aGlzLm93blRlcm1pbmFscyxcbiAgICAgIHNldHRpbmdzOiAoKSA9PiAoeyBhY3RBc0Nvb3JkaW5hdG9yOiB0aGlzLnNldHRpbmdzLmFjdEFzQ29vcmRpbmF0b3IsIGNoYXRTZW5kOiB0aGlzLnNldHRpbmdzLmNoYXRTZW5kIH0pLFxuICAgICAgc2VuZENoYXQ6IChzZXNzaW9uSWQsIHRleHQpID0+IHNlbmRDaGF0TWVzc2FnZShzZXNzaW9uSWQsIHRleHQpLFxuICAgICAgdXBkYXRlTGFiZWxzOiAobGFiZWxzKSA9PiB0aGlzLnNhdmVMYWJlbHMobGFiZWxzKSxcbiAgICAgIGRhc2hib2FyZEluZm86ICgpID0+ICh7IGVuYWJsZWQ6IEJvb2xlYW4odGhpcy5kYXNoYm9hcmQpLCB1cmw6IHRoaXMuZGFzaGJvYXJkPy51cmwgPz8gbnVsbCB9KSxcbiAgICAgIHJlZnJlc2g6ICgpID0+IHRoaXMua2ljaygpLFxuICAgICAgZnVsbFRleHQ6IChrZXkpID0+IHRoaXMub3JjaGVzdHJhdGlvbi5mdWxsVGV4dEZvcihrZXkpLFxuICAgICAgY2xhdWRlVHJhbnNjcmlwdFBhdGg6IChhZ2VudCkgPT4gdGhpcy5zdWJhZ2VudEZpbGVzLnRyYW5zY3JpcHRQYXRoRm9yKGFnZW50KSxcbiAgICAgIHdhdGNoT3V0cHV0OiAoYWdlbnRJZCwgcGF0aCkgPT4gdGhpcy5vdXRwdXRXYXRjaGVyLnRyYWNrKGFnZW50SWQsIHBhdGgpLFxuICAgICAgbm90ZU91dHB1dEludGVyZXN0OiAoYWdlbnRJZCkgPT4gdGhpcy5vdXRwdXRXYXRjaGVyLm5vdGVJbnRlcmVzdChhZ2VudElkKSxcbiAgICAgIGF0dGFjaG1lbnRzOiBuZXcgQXR0YWNobWVudFN0b3JlKGF0dGFjaG1lbnRzUm9vdChzdGF0ZURpcigpKSksXG4gICAgICBzdGFyUHJvbXB0OiBuZXcgU3RhclByb21wdFN0b3JlKHN0YXRlRGlyKCkpLFxuICAgICAgLy8gVGhlIHBsdWdpbiBmb2xkZXIgaXMgb25lIGxldmVsIGFib3ZlIGRpc3Qvd29ya2VyLm1qcy5cbiAgICAgIHVwZGF0ZXM6IG5ldyBVcGRhdGVDaGVja2VyKGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4nLCBpbXBvcnQubWV0YS51cmwpKSwgKCkgPT4gdGhpcy5zZXR0aW5ncy5jaGVja1VwZGF0ZXMpLFxuICAgICAgc2V0RGFzaGJvYXJkQ29udHJvbHM6IGFzeW5jIChlbmFibGVkKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5zZXQoJ2Rhc2hib2FyZENvbnRyb2xzJywgZW5hYmxlZClcbiAgICAgICAgdGhpcy5zZXR0aW5ncyA9IGF3YWl0IHRoaXMucmVhZFNldHRpbmdzKClcbiAgICAgICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgICAgICAgcmV0dXJuIHsgY29udHJvbHM6IHRoaXMuc2V0dGluZ3MuZGFzaGJvYXJkQ29udHJvbHMgfVxuICAgICAgfSxcbiAgICAgIHNldERhc2hib2FyZDogYXN5bmMgKGVuYWJsZWQpID0+IHtcbiAgICAgICAgLy8gVGhlIHBsdWdpbidzIG93biBzZXR0aW5nOyBPcmNhJ3MgU2V0dGluZ3MgcGFnZSBzaG93cyB0aGUgc2FtZSBzd2l0Y2guXG4gICAgICAgIGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5zZXQoJ2Rhc2hib2FyZEVuYWJsZWQnLCBlbmFibGVkKVxuICAgICAgICB0aGlzLnNldHRpbmdzID0gYXdhaXQgdGhpcy5yZWFkU2V0dGluZ3MoKVxuICAgICAgICBhd2FpdCB0aGlzLnN5bmNEYXNoYm9hcmQoZW5hYmxlZClcbiAgICAgICAgcmV0dXJuIHsgZW5hYmxlZDogQm9vbGVhbih0aGlzLmRhc2hib2FyZCksIHVybDogdGhpcy5kYXNoYm9hcmQ/LnVybCA/PyBudWxsIH1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm91dHB1dFdhdGNoZXIuc3Vic2NyaWJlKChhZ2VudElkKSA9PiB0aGlzLnJvdXRlci5pbnZhbGlkYXRlT3V0cHV0KGFnZW50SWQpKSlcbiAgICAvLyBBZ2VudHMgd2l0aG91dCBhIHRyYW5zY3JpcHQgZmlsZTogYSBzdGF0dXMgY2hhbmdlIG9yIGEgdG9vbCBjYWxsIHVzdWFsbHkgbWVhbnMgbmV3IG91dHB1dC5cbiAgICAvLyBPbmx5IHJlYWwgY2hhbmdlcyBjb3VudDogYSByZWNvcmQgYWxzbyBjaGFuZ2VzIHdoZW4ganVzdCBpdHMgbGFzdC1zZWVuIHRpbWUgbW92ZXMuXG4gICAgY29uc3Qgb3V0cHV0U2lnbmF0dXJlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICB0aGlzLnN0b3JlLnN1YnNjcmliZSgoZGVsdGEpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBwYXRjaCBvZiBkZWx0YS5wYXRjaGVzKSB7XG4gICAgICAgICAgaWYgKHBhdGNoLmVudGl0eSA9PT0gJ2FnZW50JyAmJiBwYXRjaC52YWx1ZSkge1xuICAgICAgICAgICAgY29uc3QgdiA9IHBhdGNoLnZhbHVlXG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBgJHt2LnN0YXRlfXwke3YubGl2ZX18JHt2Lm91dGNvbWV9fCR7di5tZXNzYWdlQ291bnR9fCR7di50b2tlbnN9fCR7di5zdGF0ZVNpbmNlfWBcbiAgICAgICAgICAgIGlmIChvdXRwdXRTaWduYXR1cmUuZ2V0KHYuaWQpID09PSBzaWduYXR1cmUpIGNvbnRpbnVlXG4gICAgICAgICAgICBvdXRwdXRTaWduYXR1cmUuc2V0KHYuaWQsIHNpZ25hdHVyZSlcbiAgICAgICAgICAgIGlmIChvdXRwdXRTaWduYXR1cmUuc2l6ZSA+IDIwMDApIG91dHB1dFNpZ25hdHVyZS5kZWxldGUob3V0cHV0U2lnbmF0dXJlLmtleXMoKS5uZXh0KCkudmFsdWUhKVxuICAgICAgICAgICAgdGhpcy5vdXRwdXRXYXRjaGVyLnBva2Uodi5pZClcbiAgICAgICAgICB9IGVsc2UgaWYgKHBhdGNoLmVudGl0eSA9PT0gJ3Rvb2xDYWxsJyAmJiBwYXRjaC52YWx1ZS5hZ2VudElkKSB0aGlzLm91dHB1dFdhdGNoZXIucG9rZShwYXRjaC52YWx1ZS5hZ2VudElkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIClcbiAgICB0aGlzLnN1YnNjcmliZVJ1bnRpbWUoKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICBjb25uZWN0UGFuZWxzKHRoaXMub3JjYS5wYW5lbHMsIHtcbiAgICAgICAgc25hcHNob3Q6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnN0b3JlLnNuYXBzaG90KClcbiAgICAgICAgfSxcbiAgICAgICAgc3Vic2NyaWJlOiAobGlzdGVuZXIpID0+IHRoaXMuc3RvcmUuc3Vic2NyaWJlKGxpc3RlbmVyKSxcbiAgICAgICAgc3Vic2NyaWJlT3V0cHV0OiAobGlzdGVuZXIpID0+IHRoaXMub3V0cHV0V2F0Y2hlci5zdWJzY3JpYmUobGlzdGVuZXIpLFxuICAgICAgICBjb21tYW5kOiAoaW5wdXQpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnJvdXRlci5oYW5kbGUoaW5wdXQpXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ1xuICAgICAgfSlcbiAgICApXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm9yY2Euc2V0dGluZ3Mub25EaWRDaGFuZ2UoKCkgPT4gdm9pZCB0aGlzLm9uU2V0dGluZ3NDaGFuZ2VkKCkpLmRpc3Bvc2UpXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaCh0aGlzLm9yY2EuY29tbWFuZHMucmVnaXN0ZXIoJ2FnZW50LWZsb3cuc2hvd1BhbmVsJywgKCkgPT4gdGhpcy5zaG93UGFuZWwoKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKFxuICAgICAgdGhpcy5vcmNhLmNvbW1hbmRzLnJlZ2lzdGVyKCdhZ2VudC1mbG93LmRhc2hib2FyZExpbmsnLCAoKSA9PlxuICAgICAgICB0aGlzLmRhc2hib2FyZD8udXJsXG4gICAgICAgICAgPyBgT3BlbiBpbiB5b3VyIGJyb3dzZXIgKGtlZXAgdGhlIGxpbmsgcHJpdmF0ZSk6ICR7dGhpcy5kYXNoYm9hcmQudXJsfWBcbiAgICAgICAgICA6ICdUaGUgYnJvd3NlciBkYXNoYm9hcmQgaXMgb2ZmLiBUdXJuIG9uIFx1MjAxQ0Jyb3dzZXIgZGFzaGJvYXJkXHUyMDFEIHVuZGVyIEFnZW50IEZsb3cgaW4gT3JjYSBTZXR0aW5ncy4nXG4gICAgICApLmRpc3Bvc2VcbiAgICApXG4gICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgICAvLyBEbyBub3QgaG9sZCB1cCBhY3RpdmF0aW9uIChPcmNhIGhhcyBhIHdvcmtlci1yZWFkeSB0aW1lb3V0KTogZmlyc3QgcGFzcyBydW5zIGluIHRoZSBiYWNrZ3JvdW5kLlxuICAgIHZvaWQgdGhpcy5pbml0aWFsUGFzcygpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxQYXNzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3luY0Rhc2hib2FyZChmYWxzZSlcbiAgICBhd2FpdCB0aGlzLmFnZW50cy5zY2FuKClcbiAgICBhd2FpdCB0aGlzLmFjY291bnRzLnJlZnJlc2goKVxuICAgIGF3YWl0IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKClcbiAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICBhd2FpdCB0aGlzLnJlc29sdmVSZXBvUm9vdHMoKVxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB0aGlzLmFjY291bnRzLmFwcGx5VG9BZ2VudHMoKVxuICAgIGlmICh0aGlzLnN0b3BwZWQpIHJldHVyblxuICAgIC8vIEZhc3Qgd2hpbGUgc29tZW9uZSBpcyBsb29raW5nOyBzbG93IHdoZW4gbm9ib2R5IGlzIChPcmNhJ3Mgb3duIGV2ZW50cyBzdGlsbCB0cmlnZ2VyIHNjYW5zKS5cbiAgICBjb25zdCBwYWNlID0gKHdhdGNoZWQ6IG51bWJlciwgaWRsZTogbnVtYmVyKSA9PiAoKSA9PiB0aGlzLnZpZXdlcnMucGFjZSh3YXRjaGVkLCBpZGxlKVxuICAgIHRoaXMubG9vcCgnb3JjaGVzdHJhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKClcbiAgICAgIHRoaXMuYWNjb3VudHMuYXBwbHlUb0FnZW50cygpXG4gICAgfSwgKCkgPT4gKHRoaXMub3JjaGVzdHJhdGlvbi5oYXNBY3RpdmVXb3JrID8gdGhpcy52aWV3ZXJzLnBhY2UoMTUwMCwgNTAwMCkgOiB0aGlzLnZpZXdlcnMucGFjZSg2MDAwLCAzMDAwMCkpKVxuICAgIHRoaXMubG9vcCgnYWdlbnRzJywgKCkgPT4gdGhpcy5hZ2VudHMuc2NhbigpLCBwYWNlKDEwMDAwLCA2MDAwMCkpXG4gICAgdGhpcy5sb29wKCdhY2NvdW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIH0sIHBhY2UoMjAwMDAsIDEyMDAwMCkpXG4gICAgdGhpcy5sb29wKCdzdWJhZ2VudC1maWxlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB9LCBwYWNlKDUwMDAsIDMwMDAwKSlcbiAgICB0aGlzLmxvb3AoJ3JlcG8tcm9vdHMnLCAoKSA9PiB0aGlzLnJlc29sdmVSZXBvUm9vdHMoKSwgcGFjZSgxNTAwMCwgMTIwMDAwKSlcbiAgICB0aGlzLmxvb3AoJ3BlcnNpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnBydW5lKClcbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdCgpXG4gICAgfSwgKCkgPT4gUEVSU0lTVF9NUylcbiAgICB0aGlzLmxvb3AoJ3N0YXR1cy1iYXInLCBhc3luYyAoKSA9PiB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpLCAoKSA9PiAzMDAwKVxuICB9XG5cbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0b3BwZWQgPSB0cnVlXG4gICAgZm9yIChjb25zdCB0aW1lciBvZiB0aGlzLnRpbWVycy52YWx1ZXMoKSkgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIHRoaXMudGltZXJzLmNsZWFyKClcbiAgICBhd2FpdCB0aGlzLmRhc2hib2FyZE9wLmNhdGNoKCgpID0+IHVuZGVmaW5lZClcbiAgICBmb3IgKGNvbnN0IGRpc3Bvc2Ugb2YgdGhpcy5kaXNwb3NlcnMuc3BsaWNlKDApKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkaXNwb3NlKClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBrZWVwIGRpc3Bvc2luZ1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLmRhc2hib2FyZD8uc3RvcCgpXG4gICAgdGhpcy5vdXRwdXRXYXRjaGVyLmRpc3Bvc2UoKVxuICAgIGF3YWl0IHRoaXMucGVyc2lzdCh0cnVlKVxuICAgIHRoaXMuc3RvcmUuZGlzcG9zZSgpXG4gIH1cblxuICBwcml2YXRlIHN1YnNjcmliZVJ1bnRpbWUoKTogdm9pZCB7XG4gICAgY29uc3QgeyBldmVudHMsIGhvb2tzIH0gPSB0aGlzLm9yY2FcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignYWdlbnQuc3RhdHVzLmNoYW5nZWQnLCAoZXZlbnQpID0+IHRoaXMuYWdlbnRzLm9uU3RhdHVzKGV2ZW50KSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLmNyZWF0ZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLnJlbW92ZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKGV2ZW50cy5vbignd29ya3NwYWNlLmNoYW5nZWQnLCAoKSA9PiB2b2lkIHRoaXMuYWdlbnRzLnNjYW4oKSkuZGlzcG9zZSlcbiAgICAvLyBPYnNlcnZlLW9ubHkgaG9va3M6IHJldHVybiBub3RoaW5nIHNvIE9yY2EgY2FycmllcyBvbiB3aXRob3V0IHdhaXRpbmcgb24gdXMuXG4gICAgdGhpcy5kaXNwb3NlcnMucHVzaChcbiAgICAgIGhvb2tzLm9uKCdhZ2VudC50b29sLmJlZm9yZScsIChldmVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMuc3ViYWdlbnRzLm9uVG9vbEJlZm9yZShldmVudClcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmN0eC5sb2coYHRvb2wuYmVmb3JlOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgICAgICB9XG4gICAgICB9KS5kaXNwb3NlXG4gICAgKVxuICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goXG4gICAgICBob29rcy5vbignYWdlbnQudG9vbC5hZnRlcicsIChldmVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMuc3ViYWdlbnRzLm9uVG9vbEFmdGVyKGV2ZW50KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMuY3R4LmxvZyhgdG9vbC5hZnRlcjogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgICAgfVxuICAgICAgfSkuZGlzcG9zZVxuICAgIClcbiAgICB0aGlzLmRpc3Bvc2Vycy5wdXNoKFxuICAgICAgaG9va3Mub24oJ2FnZW50LmxhdW5jaC5iZWZvcmUnLCAoZXZlbnQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLmFjY291bnRzLm9uTGF1bmNoKGV2ZW50KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMuY3R4LmxvZyhgbGF1bmNoLmJlZm9yZTogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgICAgfVxuICAgICAgfSkuZGlzcG9zZVxuICAgIClcbiAgfVxuXG4gIHByaXZhdGUgbG9vcChuYW1lOiBzdHJpbmcsIHRhc2s6ICgpID0+IFByb21pc2U8dm9pZD4sIGludGVydmFsOiAoKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCB0aWNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy50aW1lcnMuZGVsZXRlKG5hbWUpXG4gICAgICBpZiAodGhpcy5zdG9wcGVkKSByZXR1cm5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRhc2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5jdHgubG9nKGAke25hbWV9IGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5zdG9wcGVkKSB0aGlzLnRpbWVycy5zZXQobmFtZSwgc2V0VGltZW91dCh0aWNrLCBpbnRlcnZhbCgpKSlcbiAgICB9XG4gICAgdGhpcy50aW1lcnMuc2V0KG5hbWUsIHNldFRpbWVvdXQodGljaywgaW50ZXJ2YWwoKSkpXG4gIH1cblxuICAvKiogQSBvbmUtc2hvdCB0aW1lciB0aGF0IHN0b3AoKSBhbHNvIGNsZWFyczsgcmUtc2NoZWR1bGluZyB0aGUgc2FtZSBuYW1lIHJlcGxhY2VzIGl0LiAqL1xuICBwcml2YXRlIG9uY2UobmFtZTogc3RyaW5nLCBtczogbnVtYmVyLCB0YXNrOiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogdm9pZCB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnRpbWVycy5nZXQobmFtZSlcbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFyVGltZW91dChleGlzdGluZylcbiAgICB0aGlzLnRpbWVycy5zZXQoXG4gICAgICBuYW1lLFxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMudGltZXJzLmRlbGV0ZShuYW1lKVxuICAgICAgICBpZiAoIXRoaXMuc3RvcHBlZCkgdm9pZCB0YXNrKCkuY2F0Y2goKGVycm9yKSA9PiB0aGlzLmN0eC5sb2coYCR7bmFtZX0gZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKSlcbiAgICAgIH0sIG1zKVxuICAgIClcbiAgfVxuXG4gIC8qKiBXaGljaCByZXBvc2l0b3J5IGVhY2ggYWdlbnQncyB3b3JrdHJlZSBiZWxvbmdzIHRvLCBmb3IgZXhhY3QgcHJvamVjdCBib3hlcy4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlUmVwb1Jvb3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgICBpZiAoIWFnZW50Lndvcmt0cmVlUGF0aCB8fCBhZ2VudC5yZXBvUm9vdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZVxuICAgICAgY29uc3QgcmVwb1Jvb3QgPSBhd2FpdCByZXBvUm9vdE9mKGFnZW50Lndvcmt0cmVlUGF0aClcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnQuaWRdXG4gICAgICBpZiAoY3VycmVudCkgdGhpcy5zdG9yZS51cHNlcnRBZ2VudChhZ2VudC5pZCwgY3VycmVudC5sYXN0U2VlbkF0LCB7IHJlcG9Sb290IH0sICgpID0+IGN1cnJlbnQpXG4gICAgfVxuICB9XG5cbiAgLyoqIEJvdW5kZWQgbWVtb3J5OiBkcm9wIGxvbmctZmluaXNoZWQgc3ViYWdlbnRzIGFuZCBzdGFuZGFsb25lIGFnZW50cyAocnVucyBrZWVwIHRoZWlycyBpbiBoaXN0b3J5KS4gKi9cbiAgcHJpdmF0ZSBwcnVuZSgpOiB2b2lkIHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgZm9yIChjb25zdCBhZ2VudCBvZiBPYmplY3QudmFsdWVzKHRoaXMuc3RvcmUucmVhZCgpLmFnZW50cykpIHtcbiAgICAgIGlmIChhZ2VudC5saXZlKSB7XG4gICAgICAgIC8vIEEgc3ViYWdlbnQgY2Fubm90IG91dGxpdmUgaXRzIHBhcmVudDsgaG9va3MgY2FuIG1pc3MgdGhlIGVuZCAoaW50ZXJydXB0LCBjcmFzaCkuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcgJiYgYWdlbnQucGFyZW50SWQgPyB0aGlzLnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnQucGFyZW50SWRdIDogdW5kZWZpbmVkXG4gICAgICAgIGNvbnN0IG9ycGhhbmVkID0gYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JyAmJiAoIXBhcmVudCB8fCAhcGFyZW50LmxpdmUpICYmIG5vdyAtIGFnZW50Lmxhc3RTZWVuQXQgPiBTVUJBR0VOVF9PUlBIQU5fTVNcbiAgICAgICAgaWYgKG9ycGhhbmVkKSB0aGlzLnN0b3JlLnVwc2VydEFnZW50KGFnZW50LmlkLCBub3csIHsgbGl2ZTogZmFsc2UsIHN0YXRlOiAndW5rbm93bicsIGV2aWRlbmNlOiBbJ2hvc3QtZXZlbnQnXSB9LCAoKSA9PiBhZ2VudClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFnZSA9IG5vdyAtIGFnZW50Lmxhc3RTZWVuQXRcbiAgICAgIGNvbnN0IHN0YWxlID0gKGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcgJiYgYWdlID4gU1VCQUdFTlRfUkVURU5USU9OX01TKSB8fCAoYWdlbnQucm9sZSA9PT0gJ2FnZW50JyAmJiAhYWdlbnQucnVuSWQgJiYgYWdlID4gU1RBTkRBTE9ORV9SRVRFTlRJT05fTVMpXG4gICAgICBpZiAoc3RhbGUpIHtcbiAgICAgICAgdGhpcy5zdG9yZS5yZW1vdmVBZ2VudChhZ2VudC5pZClcbiAgICAgICAgdGhpcy5pZGVudGl0eS51bmxpbmtBZ2VudChhZ2VudC5pZClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogQWZ0ZXIgYSBjb21tYW5kLCBsb29rIGFnYWluIHNvb24gc28gaXRzIGVmZmVjdCBzaG93cyB1cCBxdWlja2x5LiAqL1xuICAvKiogQSBwYW5lbCBvciB0aGUgZGFzaGJvYXJkIGFza2VkIGZvciBzb21ldGhpbmcuIEFmdGVyIGEgcXVpZXQgc3RyZXRjaCwgY2F0Y2ggdXAgYXQgb25jZS4gKi9cbiAgcHJpdmF0ZSBzZWVuKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy52aWV3ZXJzLnRvdWNoKCkgfHwgdGhpcy5zdG9wcGVkKSByZXR1cm5cbiAgICB0aGlzLmtpY2soKVxuICAgIHRoaXMub25jZSgnd2FrZS1zdWJhZ2VudHMnLCA4MDAsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc3ViYWdlbnRGaWxlcy5zY2FuKClcbiAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbk1vZGVscy5yZWZyZXNoKClcbiAgICB9KVxuICAgIHRoaXMub25jZSgnd2FrZS1hY2NvdW50cycsIDEyMDAsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlZnJlc2goKVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGtpY2soKTogdm9pZCB7XG4gICAgdGhpcy5vbmNlKCdraWNrLW9yY2hlc3RyYXRpb24nLCA0MDAsICgpID0+IHRoaXMub3JjaGVzdHJhdGlvbi5wb2xsKCkpXG4gICAgdGhpcy5vbmNlKCdraWNrLWFnZW50cycsIDYwMCwgKCkgPT4gdGhpcy5hZ2VudHMuc2NhbigpKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwZXJzaXN0KGZvcmNlID0gZmFsc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWZvcmNlICYmIHRoaXMuc3RvcmUuc2VxID09PSB0aGlzLnBlcnNpc3RlZFNlcSkgcmV0dXJuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdGVuY2Uuc2F2ZVNuYXBzaG90KHRoaXMuc3RvcmUuc25hcHNob3QoKSlcbiAgICAgIHRoaXMucGVyc2lzdGVkU2VxID0gdGhpcy5zdG9yZS5zZXFcbiAgICAgIGF3YWl0IHRoaXMuaGlzdG9yeS5zYXZlQ2hhbmdlZFJ1bnMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYHBlcnNpc3QgZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKiBVc2VzIHRoZSBkb2N1bWVudGVkIGBvcmNhIHBsdWdpbiBvcGVuYCB0byBzaG93IHRoaXMgcGx1Z2luJ3MgcGFuZWwuICovXG4gIHByaXZhdGUgYXN5bmMgc2hvd1BhbmVsKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgbGlzdCA9IGF3YWl0IHRoaXMuY3R4LmNsaS5ydW48eyBwbHVnaW5zPzogeyBrZXk/OiBzdHJpbmc7IGlkPzogc3RyaW5nIH1bXSB9IHwgeyBrZXk/OiBzdHJpbmc7IGlkPzogc3RyaW5nIH1bXT4oWydwbHVnaW4nLCAnbGlzdCddLCB7IHRpbWVvdXRNczogODAwMCB9KVxuICAgIGlmICghbGlzdC5vaykgcmV0dXJuIGBDb3VsZCBub3QgZmluZCB0aGUgQWdlbnQgRmxvdyBwYW5lbDogJHtsaXN0Lm1lc3NhZ2V9YFxuICAgIGNvbnN0IHJvd3MgPSBBcnJheS5pc0FycmF5KGxpc3QucmVzdWx0KSA/IGxpc3QucmVzdWx0IDogKGxpc3QucmVzdWx0LnBsdWdpbnMgPz8gW10pXG4gICAgY29uc3Qga2V5ID0gcm93cy5maW5kKChyb3cpID0+IHJvdy5pZCA9PT0gJ2FnZW50LWZsb3cnIHx8IHJvdy5rZXk/LmVuZHNXaXRoKCcuYWdlbnQtZmxvdycpKT8ua2V5XG4gICAgaWYgKCFrZXkpIHJldHVybiAnQWdlbnQgRmxvdyBpcyBub3QgbGlzdGVkIGFzIGluc3RhbGxlZC4nXG4gICAgY29uc3Qgb3BlbmVkID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bihbJ3BsdWdpbicsICdvcGVuJywga2V5LCAnLS1wYW5lbCcsICdmbG93J10sIHsgdGltZW91dE1zOiA4MDAwIH0pXG4gICAgcmV0dXJuIG9wZW5lZC5vayA/ICdBZ2VudCBGbG93IHBhbmVsIG9wZW5lZC4nIDogYENvdWxkIG5vdCBvcGVuIHRoZSBwYW5lbDogJHtvcGVuZWQubWVzc2FnZX1gXG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMub3JjYS5ob3N0Lmhhcygnc3RhdHVzQmFyLnVwZGF0ZScpKSByZXR1cm5cbiAgICBjb25zdCBhZ2VudHMgPSBPYmplY3QudmFsdWVzKHRoaXMuc3RvcmUucmVhZCgpLmFnZW50cylcbiAgICBjb25zdCBydW5uaW5nID0gYWdlbnRzLmZpbHRlcigoYWdlbnQpID0+IGFnZW50LmxpdmUgJiYgKGFnZW50LnN0YXRlID09PSAnd29ya2luZycgfHwgYWdlbnQuc3RhdGUgPT09ICdibG9ja2VkJyB8fCBhZ2VudC5zdGF0ZSA9PT0gJ3dhaXRpbmcnKSkubGVuZ3RoXG4gICAgY29uc3QgYmxvY2tlZCA9IGFnZW50cy5maWx0ZXIoKGFnZW50KSA9PiBhZ2VudC5saXZlICYmIGFnZW50LnN0YXRlID09PSAnYmxvY2tlZCcpLmxlbmd0aFxuICAgIGNvbnN0IGtleSA9IGAke3J1bm5pbmd9fCR7YmxvY2tlZH1gXG4gICAgaWYgKGtleSA9PT0gdGhpcy5zdGF0dXNLZXkpIHJldHVyblxuICAgIHRoaXMuc3RhdHVzS2V5ID0ga2V5XG4gICAgdm9pZCB0aGlzLm9yY2EuaG9zdFxuICAgICAgLmNhbGwoJ3N0YXR1c0Jhci51cGRhdGUnLCB7XG4gICAgICAgIGlkOiAnYWdlbnQtZmxvdy1zdGF0dXMnLFxuICAgICAgICB0ZXh0OiBydW5uaW5nID8gYEFnZW50IEZsb3cgXHUwMEI3ICR7cnVubmluZ30gcnVubmluZyR7YmxvY2tlZCA/IGAgXHUwMEI3ICR7YmxvY2tlZH0gYmxvY2tlZGAgOiAnJ31gIDogJ0FnZW50IEZsb3cgXHUwMEI3IGlkbGUnLFxuICAgICAgICB0b25lOiBibG9ja2VkID8gJ3dhcm5pbmcnIDogcnVubmluZyA/ICdhY2NlbnQnIDogJ25ldXRyYWwnLFxuICAgICAgICB0b29sdGlwOiAnTGl2ZSBhZ2VudHMgc2VlbiBieSBBZ2VudCBGbG93J1xuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIHRoaXMuc3RhdHVzS2V5ID0gJydcbiAgICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHB1Ymxpc2hDYXBhYmlsaXRpZXMoKTogdm9pZCB7XG4gICAgY29uc3QgaG9zdE1ldGhvZHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+ID0ge31cbiAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBIT1NUX01FVEhPRFMpIGhvc3RNZXRob2RzW21ldGhvZF0gPSB0aGlzLm9yY2EuaG9zdC5oYXMobWV0aG9kKVxuICAgIGNvbnN0IHByb2JlID0geyBob3N0SGFzOiAobTogc3RyaW5nKSA9PiB0aGlzLm9yY2EuaG9zdC5oYXMobSksIGNsaTogQm9vbGVhbih0aGlzLmN0eC5jbGkucGF0aCksIGFjdEFzQ29vcmRpbmF0b3I6IHRoaXMuc2V0dGluZ3MuYWN0QXNDb29yZGluYXRvciB9XG4gICAgY29uc3QgY29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIGNvbW1hbmRBdmFpbGFiaWxpdHk+PiA9IHt9XG4gICAgZm9yIChjb25zdCBraW5kIG9mIEFMTF9DT01NQU5EUykgY29tbWFuZHNba2luZF0gPSBjb21tYW5kQXZhaWxhYmlsaXR5KGtpbmQsIHByb2JlKVxuICAgIHRoaXMuc3RvcmUucHV0KHtcbiAgICAgIGVudGl0eTogJ2NhcGFiaWxpdGllcycsXG4gICAgICBpZDogJ2NhcGFiaWxpdGllcycsXG4gICAgICB2YWx1ZToge1xuICAgICAgICBob3N0TWV0aG9kcyxcbiAgICAgICAgY29tbWFuZHMsXG4gICAgICAgIGFjdEFzQ29vcmRpbmF0b3I6IHRoaXMuc2V0dGluZ3MuYWN0QXNDb29yZGluYXRvcixcbiAgICAgICAgY2hhdFNlbmQ6IHRoaXMuc2V0dGluZ3MuY2hhdFNlbmQsXG4gICAgICAgIGRhc2hib2FyZENvbnRyb2xzOiB0aGlzLnNldHRpbmdzLmRhc2hib2FyZENvbnRyb2xzLFxuICAgICAgICBjbGlBdmFpbGFibGU6IEJvb2xlYW4odGhpcy5jdHguY2xpLnBhdGgpLFxuICAgICAgICBjbGlQYXRoOiB0aGlzLmN0eC5jbGkucGF0aCxcbiAgICAgICAgaG9va3M6IHRydWUsXG4gICAgICAgIGRhc2hib2FyZDogeyBlbmFibGVkOiBCb29sZWFuKHRoaXMuZGFzaGJvYXJkKSwgdXJsOiB0aGlzLmRhc2hib2FyZCA/ICdydW5uaW5nJyA6IG51bGwgfSxcbiAgICAgICAgYXBpTWlub3I6IHRoaXMub3JjYS5hcGkubWlub3IsXG4gICAgICAgIGhvbWVEaXI6IGhvbWVkaXIoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRTZXR0aW5ncygpOiBQcm9taXNlPFNldHRpbmdzPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhdyA9IGF3YWl0IHRoaXMub3JjYS5zZXR0aW5ncy5nZXQoKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLy8gVW5zZXQgbWVhbnMgdGhlIGRlZmF1bHQgKG9uKTsgb25seSBhbiBleHBsaWNpdCBmYWxzZSB0dXJucyBhIHNldHRpbmcgb2ZmLlxuICAgICAgICBkYXNoYm9hcmRFbmFibGVkOiByYXcuZGFzaGJvYXJkRW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICAgIGRhc2hib2FyZFBvcnQ6IHR5cGVvZiByYXcuZGFzaGJvYXJkUG9ydCA9PT0gJ251bWJlcicgJiYgcmF3LmRhc2hib2FyZFBvcnQgPj0gMTAyNCAmJiByYXcuZGFzaGJvYXJkUG9ydCA8PSA2NTAwMCA/IHJhdy5kYXNoYm9hcmRQb3J0IDogNDc5MCxcbiAgICAgICAgZGFzaGJvYXJkQ29udHJvbHM6IHJhdy5kYXNoYm9hcmRDb250cm9scyAhPT0gZmFsc2UsXG4gICAgICAgIGFjdEFzQ29vcmRpbmF0b3I6IHJhdy5hY3RBc0Nvb3JkaW5hdG9yICE9PSBmYWxzZSxcbiAgICAgICAgY2xpUGF0aDogdHlwZW9mIHJhdy5jbGlQYXRoID09PSAnc3RyaW5nJyA/IHJhdy5jbGlQYXRoLnRyaW0oKSA6ICcnLFxuICAgICAgICBjaGF0U2VuZDogcmF3LmNoYXRTZW5kICE9PSBmYWxzZSxcbiAgICAgICAgY2hlY2tVcGRhdGVzOiByYXcuY2hlY2tVcGRhdGVzICE9PSBmYWxzZVxuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIERFRkFVTFRfU0VUVElOR1NcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG9uU2V0dGluZ3NDaGFuZ2VkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJlZm9yZSA9IHRoaXMuc2V0dGluZ3NcbiAgICB0aGlzLnNldHRpbmdzID0gYXdhaXQgdGhpcy5yZWFkU2V0dGluZ3MoKVxuICAgIGlmIChiZWZvcmUuY2xpUGF0aCAhPT0gdGhpcy5zZXR0aW5ncy5jbGlQYXRoKSB7XG4gICAgICB0aGlzLmN0eC5jbGkgPSBjcmVhdGVDbGlSdW5uZXIoYXdhaXQgcmVzb2x2ZUNsaVBhdGgodGhpcy5zZXR0aW5ncy5jbGlQYXRoIHx8IG51bGwpKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnN5bmNEYXNoYm9hcmQoZmFsc2UpXG4gICAgdGhpcy5wdWJsaXNoQ2FwYWJpbGl0aWVzKClcbiAgfVxuXG4gIC8qKiBTZXJpYWxpemVkOiBvdmVybGFwcGluZyBvbi9vZmYgcmVxdWVzdHMgY2FuIG5ldmVyIGxlYXZlIGEgc3RyYXkgc2VydmVyIHJ1bm5pbmcuICovXG4gIHByaXZhdGUgc3luY0Rhc2hib2FyZChyb3RhdGVUb2tlbjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGFzaGJvYXJkT3AgPSB0aGlzLmRhc2hib2FyZE9wLmNhdGNoKCgpID0+IHVuZGVmaW5lZCkudGhlbigoKSA9PiB0aGlzLnN5bmNEYXNoYm9hcmROb3cocm90YXRlVG9rZW4pKVxuICAgIHJldHVybiB0aGlzLmRhc2hib2FyZE9wXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN5bmNEYXNoYm9hcmROb3cocm90YXRlVG9rZW46IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB3YW50ID0gdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRFbmFibGVkICYmICF0aGlzLnN0b3BwZWRcbiAgICBpZiAodGhpcy5kYXNoYm9hcmQgJiYgKCF3YW50IHx8IHJvdGF0ZVRva2VuKSkge1xuICAgICAgYXdhaXQgdGhpcy5kYXNoYm9hcmQuc3RvcCgpXG4gICAgICB0aGlzLmRhc2hib2FyZCA9IG51bGxcbiAgICB9XG4gICAgaWYgKCF3YW50IHx8IHRoaXMuZGFzaGJvYXJkKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hDYXBhYmlsaXRpZXMoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm90ZWN0aW9uID0gdGhpcy5vcmNhLmhvc3QuaGFzKCdzZWNyZXRzLnByb3RlY3Rpb24nKSA/IChhd2FpdCB0aGlzLm9yY2EuaG9zdC5jYWxsKCdzZWNyZXRzLnByb3RlY3Rpb24nLCB7fSkpLnN0YXR1cyA6ICd1bmF2YWlsYWJsZSdcbiAgICAgIC8vIFR1cm5pbmcgdGhlIGRhc2hib2FyZCBvbiBpc3N1ZXMgYSBuZXcgdG9rZW4sIHNvIGFuIG9sZCBsaW5rIHN0b3BzIHdvcmtpbmcuXG4gICAgICBjb25zdCB0b2tlbiA9IHJvdGF0ZVRva2VuID8gYXdhaXQgcm90YXRlRGFzaGJvYXJkVG9rZW4odGhpcy5vcmNhLnNlY3JldHMsIHByb3RlY3Rpb24sIHN0YXRlRGlyKCkpIDogYXdhaXQgbG9hZE9yQ3JlYXRlVG9rZW4odGhpcy5vcmNhLnNlY3JldHMsIHByb3RlY3Rpb24sIHN0YXRlRGlyKCkpXG4gICAgICBjb25zdCBzZXJ2ZXIgPSBuZXcgRGFzaGJvYXJkU2VydmVyKHtcbiAgICAgICAgdWlEaXI6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi91aS8nLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICAgICAgdG9rZW4sXG4gICAgICAgIHBvcnQ6IHRoaXMuc2V0dGluZ3MuZGFzaGJvYXJkUG9ydCxcbiAgICAgICAgYWxsb3dDb250cm9sczogKCkgPT4gdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRDb250cm9scyxcbiAgICAgICAgc25hcHNob3Q6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnN0b3JlLnNuYXBzaG90KClcbiAgICAgICAgfSxcbiAgICAgICAgc3Vic2NyaWJlOiAobGlzdGVuZXIpID0+IHRoaXMuc3RvcmUuc3Vic2NyaWJlKGxpc3RlbmVyKSxcbiAgICAgICAgc3Vic2NyaWJlT3V0cHV0OiAobGlzdGVuZXIpID0+IHRoaXMub3V0cHV0V2F0Y2hlci5zdWJzY3JpYmUobGlzdGVuZXIpLFxuICAgICAgICBjb21tYW5kOiAoaW5wdXQsIGFsbG93ZWQpID0+IHtcbiAgICAgICAgICB0aGlzLnNlZW4oKVxuICAgICAgICAgIHJldHVybiB0aGlzLnJvdXRlci5oYW5kbGUoaW5wdXQsIGFsbG93ZWQpXG4gICAgICAgIH0sXG4gICAgICAgIGxvZzogdGhpcy5jdHgubG9nXG4gICAgICB9KVxuICAgICAgYXdhaXQgc2VydmVyLnN0YXJ0KClcbiAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5kYXNoYm9hcmRFbmFibGVkIHx8IHRoaXMuc3RvcHBlZCkgYXdhaXQgc2VydmVyLnN0b3AoKVxuICAgICAgZWxzZSB0aGlzLmRhc2hib2FyZCA9IHNlcnZlclxuICAgICAgdGhpcy5kYXNoYm9hcmRSZXRyaWVzID0gMFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGRhc2hib2FyZCBjb3VsZCBub3Qgc3RhcnQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgICAvLyBPZnRlbiB0cmFuc2llbnQgKE9yY2EgcmUtY2hlY2tpbmcgYXBwcm92YWwgZHVyaW5nIGEgcmVsb2FkLCB0aGUgcG9ydCBzdGlsbCBjbG9zaW5nKTpcbiAgICAgIC8vIHRyeSBhZ2FpbiB3aXRoIGJhY2tvZmYgaW5zdGVhZCBvZiBzdGF5aW5nIG9mZiB1bnRpbCB0aGUgbmV4dCBzZXR0aW5ncyBjaGFuZ2UuXG4gICAgICBpZiAodGhpcy5kYXNoYm9hcmRSZXRyaWVzIDwgREFTSEJPQVJEX1JFVFJJRVMpIHtcbiAgICAgICAgY29uc3QgZGVsYXkgPSAyMDAwICogMiAqKiB0aGlzLmRhc2hib2FyZFJldHJpZXMrK1xuICAgICAgICB0aGlzLm9uY2UoJ2Rhc2hib2FyZC1yZXRyeScsIGRlbGF5LCAoKSA9PiB0aGlzLnN5bmNEYXNoYm9hcmQoZmFsc2UpKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnB1Ymxpc2hDYXBhYmlsaXRpZXMoKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkTGFiZWxzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByYXcgPSAoYXdhaXQgdGhpcy5vcmNhLnN0b3JhZ2UuZ2V0KCdsYWJlbHMnKSkgYXMgUGFydGlhbDxMYWJlbENvbmZpZz4gfCBudWxsXG4gICAgICBpZiAocmF3ICYmIHR5cGVvZiByYXcgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIHRoaXMuc3RvcmUucHV0KHsgZW50aXR5OiAnbGFiZWxzJywgaWQ6ICdsYWJlbHMnLCB2YWx1ZTogeyAuLi5FTVBUWV9MQUJFTFMsIC4uLnJhdyB9IGFzIExhYmVsQ29uZmlnIH0pXG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBsYWJlbHMgYXJlIG9wdGlvbmFsXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlTGFiZWxzKGxhYmVsczogTGFiZWxDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLm9yY2Euc3RvcmFnZS5zZXQoJ2xhYmVscycsIGxhYmVscyBhcyBuZXZlcilcbiAgICB0aGlzLnN0b3JlLnB1dCh7IGVudGl0eTogJ2xhYmVscycsIGlkOiAnbGFiZWxzJywgdmFsdWU6IGxhYmVscyB9KVxuICAgIGF3YWl0IHRoaXMuYWNjb3VudHMucmVmcmVzaCgpXG4gIH1cbn1cbiIsICIvLyBDb21tYW5kIGNvbnRyYWN0IGJldHdlZW4gZXZlcnkgVUkgYW5kIHRoZSB3b3JrZXIuIFRoZSB3b3JrZXIgcmUtdmFsaWRhdGVzIGV2ZXJ5IGZpZWxkO1xuLy8gVUlzIHVzZSB0aGUgc2FtZSB2YWxpZGF0b3JzIHRvIGRpc2FibGUgaW52YWxpZCBhY3Rpb25zIGVhcmx5LlxuXG5leHBvcnQgdHlwZSBDb21tYW5kS2luZCA9XG4gIHwgJ3Rlcm1pbmFsLmZvY3VzJ1xuICB8ICd0ZXJtaW5hbC5yZWFkJ1xuICB8ICdhZ2VudC5sYXVuY2gnXG4gIHwgJ2FnZW50LnJlc3VtZSdcbiAgfCAnYWdlbnQuc3RvcCdcbiAgfCAnYWdlbnQucmVhZE91dHB1dCdcbiAgfCAndGFzay5jcmVhdGUnXG4gIHwgJ3Rhc2sudXBkYXRlJ1xuICB8ICd0YXNrLmNhbmNlbCdcbiAgfCAndGFzay5yZXRyeSdcbiAgfCAndGFzay5kaXNwYXRjaCdcbiAgfCAnZ2F0ZS5yZXNvbHZlJ1xuICB8ICd3b3JrdHJlZS5jcmVhdGUnXG4gIHwgJ3dvcmt0cmVlLm9wZW4nXG4gIHwgJ3dvcmt0cmVlLmluc3BlY3QnXG4gIHwgJ21lc3NhZ2Uuc2VuZCdcbiAgfCAnbW9kZWwuY2hhbmdlJ1xuICB8ICdsYWJlbHMudXBkYXRlJ1xuICB8ICdoaXN0b3J5Lmxpc3QnXG4gIHwgJ2hpc3RvcnkubG9hZCdcbiAgfCAnZGFzaGJvYXJkLmluZm8nXG4gIHwgJ2VudGl0eS5kZXRhaWwnXG4gIHwgJ2Rhc2hib2FyZC5lbmFibGUnXG4gIHwgJ2Rhc2hib2FyZC5jb250cm9scydcbiAgfCAnYWdlbnQucHJvbXB0J1xuICB8ICdhZ2VudC5pbWFnZSdcbiAgfCAndmlld2VyLnBpbmcnXG4gIHwgJ2FnZW50LmF0dGFjaCdcbiAgfCAnc3Rhci52aXNpdCdcbiAgfCAnc3Rhci5hbnN3ZXInXG4gIHwgJ3VwZGF0ZS5jaGVjaydcbiAgfCAndXBkYXRlLnJ1bidcblxuZXhwb3J0IHR5cGUgQ29tbWFuZFJlcXVlc3QgPSB7XG4gIHJlcXVlc3RJZDogc3RyaW5nXG4gIGtpbmQ6IENvbW1hbmRLaW5kXG4gIHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgLyoqIFNldCBieSB0aGUgVUkgb25seSBhZnRlciBhIGNvbmZpcm1hdGlvbiBkaWFsb2cgZm9yIGRlc3RydWN0aXZlIGNvbW1hbmRzLiAqL1xuICBjb25maXJtZWQ/OiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIENvbW1hbmRFcnJvciA9IHsgY29kZTogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfVxuXG4vKiogRm9yIGNvb3JkaW5hdG9yLW9ubHkgb3JjaGVzdHJhdGlvbiBhY3Rpb25zOiB0aGUgZXhhY3QgQ0xJIGNvbW1hbmQgdGhlIGNvb3JkaW5hdG9yIGNhbiBydW4uICovXG5leHBvcnQgdHlwZSBNYW51YWxTdGVwID0geyBjb21tYW5kOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cblxuZXhwb3J0IHR5cGUgQ29tbWFuZFJlc3BvbnNlID0geyBvazogdHJ1ZTsgcmVzdWx0OiB1bmtub3duIH0gfCB7IG9rOiBmYWxzZTsgZXJyb3I6IENvbW1hbmRFcnJvcjsgbWFudWFsPzogTWFudWFsU3RlcCB9XG5cbi8qKiBIb3cgYSBjb21tYW5kIHJlYWNoZXMgT3JjYSwgcmVwb3J0ZWQgdG8gdGhlIFVJIHNvIGl0IGNhbiBlbmFibGUvZGlzYWJsZSBjb250cm9scyBob25lc3RseS4gKi9cbmV4cG9ydCB0eXBlIENvbW1hbmRBdmFpbGFiaWxpdHkgPSB7XG4gIGF2YWlsYWJsZTogYm9vbGVhblxuICBtb2RlOiAnZGlyZWN0JyB8ICdjb29yZGluYXRvcicgfCAndW5zdXBwb3J0ZWQnXG4gIHJlYXNvbjogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgREVTVFJVQ1RJVkVfQ09NTUFORFM6IFJlYWRvbmx5U2V0PENvbW1hbmRLaW5kPiA9IG5ldyBTZXQoWydhZ2VudC5zdG9wJywgJ3Rhc2suY2FuY2VsJ10pXG5cbmV4cG9ydCBjb25zdCBBTExfQ09NTUFORFM6IHJlYWRvbmx5IENvbW1hbmRLaW5kW10gPSBbXG4gICd0ZXJtaW5hbC5mb2N1cycsICd0ZXJtaW5hbC5yZWFkJywgJ2FnZW50LmxhdW5jaCcsICdhZ2VudC5yZXN1bWUnLCAnYWdlbnQuc3RvcCcsICdhZ2VudC5yZWFkT3V0cHV0JyxcbiAgJ3Rhc2suY3JlYXRlJywgJ3Rhc2sudXBkYXRlJywgJ3Rhc2suY2FuY2VsJywgJ3Rhc2sucmV0cnknLCAndGFzay5kaXNwYXRjaCcsICdnYXRlLnJlc29sdmUnLFxuICAnd29ya3RyZWUuY3JlYXRlJywgJ3dvcmt0cmVlLm9wZW4nLCAnd29ya3RyZWUuaW5zcGVjdCcsICdtZXNzYWdlLnNlbmQnLCAnbW9kZWwuY2hhbmdlJyxcbiAgJ2xhYmVscy51cGRhdGUnLCAnaGlzdG9yeS5saXN0JywgJ2hpc3RvcnkubG9hZCcsICdkYXNoYm9hcmQuaW5mbycsICdlbnRpdHkuZGV0YWlsJywgJ2Rhc2hib2FyZC5lbmFibGUnLCAnZGFzaGJvYXJkLmNvbnRyb2xzJywgJ2FnZW50LnByb21wdCcsICdhZ2VudC5pbWFnZScsICd2aWV3ZXIucGluZycsICdhZ2VudC5hdHRhY2gnLCAnc3Rhci52aXNpdCcsICdzdGFyLmFuc3dlcicsICd1cGRhdGUuY2hlY2snLCAndXBkYXRlLnJ1bidcbl1cblxuLyoqIENvbW1hbmRzIHRoYXQgb25seSByZWFkIHN0YXRlOyBzYWZlIGZvciB0aGUgZGFzaGJvYXJkIHdpdGhvdXQgY29udHJvbCByaWdodHMuICovXG5leHBvcnQgY29uc3QgUkVBRF9PTkxZX0NPTU1BTkRTOiBSZWFkb25seVNldDxDb21tYW5kS2luZD4gPSBuZXcgU2V0KFtcbiAgJ3Rlcm1pbmFsLnJlYWQnLCAnYWdlbnQucmVhZE91dHB1dCcsICd3b3JrdHJlZS5pbnNwZWN0JywgJ2hpc3RvcnkubGlzdCcsICdoaXN0b3J5LmxvYWQnLCAnZGFzaGJvYXJkLmluZm8nLCAnZW50aXR5LmRldGFpbCcsICdhZ2VudC5pbWFnZScsICd2aWV3ZXIucGluZycsXG4gIC8vIE9ubHkgQWdlbnQgRmxvdydzIG93biBcInN0YXIgdGhlIHByb2plY3RcIiBwcm9tcHQgc3RhdGU7IG5vdGhpbmcgaW4gT3JjYSBjaGFuZ2VzLlxuICAnc3Rhci52aXNpdCcsICdzdGFyLmFuc3dlcicsICd1cGRhdGUuY2hlY2snXG5dKVxuXG5leHBvcnQgY2xhc3MgVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb2RlID0gJ2ludmFsaWRfcGFyYW1zJ1xufVxuXG50eXBlIEZpZWxkU3BlYyA9XG4gIHwgeyB0eXBlOiAnc3RyaW5nJzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXg/OiBudW1iZXI7IHBhdHRlcm4/OiBSZWdFeHA7IG9uZU9mPzogcmVhZG9ubHkgc3RyaW5nW10gfVxuICB8IHsgdHlwZTogJ2Jvb2xlYW4nOyByZXF1aXJlZD86IGJvb2xlYW4gfVxuICB8IHsgdHlwZTogJ3N0cmluZ0FycmF5JzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXhJdGVtcz86IG51bWJlcjsgcGF0dGVybj86IFJlZ0V4cCB9XG4gIHwgeyB0eXBlOiAncmVjb3JkJzsgcmVxdWlyZWQ/OiBib29sZWFuOyBtYXhLZXlzPzogbnVtYmVyIH1cblxuY29uc3QgSUQgPSAvXltBLVphLXowLTlfOi5cXC0vQF17MSw0MDB9JC9cbmNvbnN0IEFHRU5UID0gL15bYS16MC05XVthLXowLTktXXswLDQwfSQvXG5jb25zdCBVVUlEID0gL15bMC05YS1mXXs4fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXsxMn0kL1xuY29uc3QgTU9ERUwgPSAvXltBLVphLXowLTlfLjpAL1xcLVtcXF1dezEsMTIwfSQvXG5jb25zdCBFRkZPUlQgPSAvXlthLXpdezEsMjB9JC9cbmNvbnN0IFRBU0tfU1RBVFVTID0gWydwZW5kaW5nJywgJ3JlYWR5JywgJ2Rpc3BhdGNoZWQnLCAnY29tcGxldGVkJywgJ2ZhaWxlZCcsICdibG9ja2VkJ10gYXMgY29uc3RcbmV4cG9ydCBjb25zdCBXT1JLVFJFRV9NT0RFUyA9IFsnbmV3LWNoaWxkJywgJ2N1cnJlbnQnXSBhcyBjb25zdFxuXG5leHBvcnQgY29uc3QgQ09NTUFORF9QQVJBTVM6IFJlY29yZDxDb21tYW5kS2luZCwgUmVjb3JkPHN0cmluZywgRmllbGRTcGVjPj4gPSB7XG4gICd0ZXJtaW5hbC5mb2N1cyc6IHsgdGVybWluYWxJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ3Rlcm1pbmFsLnJlYWQnOiB7IHRlcm1pbmFsSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9IH0sXG4gICdhZ2VudC5sYXVuY2gnOiB7XG4gICAgd29ya3NwYWNlSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIGFnZW50OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogQUdFTlQgfSxcbiAgICBwcm9tcHQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogMjAwMDAgfVxuICB9LFxuICAnYWdlbnQucmVzdW1lJzoge1xuICAgIHdvcmtzcGFjZUlkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IEFHRU5UIH0sXG4gICAgc2Vzc2lvbklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfVxuICB9LFxuICAnYWdlbnQuc3RvcCc6IHsgYWdlbnRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ2FnZW50LnJlYWRPdXRwdXQnOiB7XG4gICAgYWdlbnRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgYmVmb3JlOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMCwgcGF0dGVybjogL15bQS1aYS16MC05Xy46LV17MSwyMDB9JC8gfSxcbiAgICAvKiogVGhlIHZlcnNpb24gdGhlIHZpZXcgYWxyZWFkeSBzaG93czogYW4gdW5jaGFuZ2VkIGFuc3dlciBpcyB0aGVuIHNlbnQgYXMgYHsgdW5jaGFuZ2VkOiB0cnVlIH1gLiAqL1xuICAgIHNpbmNlOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDY0LCBwYXR0ZXJuOiAvXlthLWYwLTldezgsNjR9JC8gfVxuICB9LFxuICAndGFzay5jcmVhdGUnOiB7XG4gICAgcnVuSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHRpdGxlOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgbWF4OiAyMDAgfSxcbiAgICBzcGVjOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgbWF4OiA2MDAwMCB9LFxuICAgIGRlcHM6IHsgdHlwZTogJ3N0cmluZ0FycmF5JywgbWF4SXRlbXM6IDUwLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHBhcmVudElkOiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBJRCB9XG4gIH0sXG4gICd0YXNrLnVwZGF0ZSc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBzdGF0dXM6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBvbmVPZjogVEFTS19TVEFUVVMgfSxcbiAgICByZXN1bHQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogNDAwMCB9XG4gIH0sXG4gICd0YXNrLmNhbmNlbCc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfVxuICB9LFxuICAndGFzay5yZXRyeSc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogQUdFTlQgfSxcbiAgICBtb2RlbDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogTU9ERUwgfSxcbiAgICBlZmZvcnQ6IHsgdHlwZTogJ3N0cmluZycsIHBhdHRlcm46IEVGRk9SVCB9LFxuICAgIHdvcmt0cmVlOiB7IHR5cGU6ICdzdHJpbmcnLCBvbmVPZjogV09SS1RSRUVfTU9ERVMgfVxuICB9LFxuICAndGFzay5kaXNwYXRjaCc6IHtcbiAgICB0YXNrSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICBhZ2VudDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogQUdFTlQgfSxcbiAgICBtb2RlbDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogTU9ERUwgfSxcbiAgICBlZmZvcnQ6IHsgdHlwZTogJ3N0cmluZycsIHBhdHRlcm46IEVGRk9SVCB9LFxuICAgIHdvcmt0cmVlOiB7IHR5cGU6ICdzdHJpbmcnLCBvbmVPZjogV09SS1RSRUVfTU9ERVMgfVxuICB9LFxuICAnZ2F0ZS5yZXNvbHZlJzoge1xuICAgIGdhdGVJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgcnVuSWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIHJlc29sdXRpb246IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDQwMDAgfVxuICB9LFxuICAnd29ya3RyZWUuY3JlYXRlJzoge1xuICAgIHByb2plY3RJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJywgbWF4OiAxMjAgfSxcbiAgICBiYXNlQnJhbmNoOiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMCB9LFxuICAgIGFnZW50OiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBBR0VOVCB9LFxuICAgIHByb21wdDogeyB0eXBlOiAnc3RyaW5nJywgbWF4OiAyMDAwMCB9XG4gIH0sXG4gICd3b3JrdHJlZS5vcGVuJzogeyB3b3Jrc3BhY2VJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ3dvcmt0cmVlLmluc3BlY3QnOiB7IHBhdGg6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDEwMDAgfSB9LFxuICAnbWVzc2FnZS5zZW5kJzoge1xuICAgIHJ1bklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICB0bzogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0sXG4gICAgc3ViamVjdDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogMjAwIH0sXG4gICAgYm9keTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogMjAwMDAgfVxuICB9LFxuICAnbW9kZWwuY2hhbmdlJzoge1xuICAgIGFnZW50SWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LFxuICAgIG1vZGVsOiB7IHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiBNT0RFTCB9LFxuICAgIGVmZm9ydDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogRUZGT1JUIH1cbiAgfSxcbiAgJ2xhYmVscy51cGRhdGUnOiB7XG4gICAgYWNjb3VudFRlYW1zOiB7IHR5cGU6ICdyZWNvcmQnLCBtYXhLZXlzOiAxMDAgfSxcbiAgICBhZ2VudFJvbGVzOiB7IHR5cGU6ICdyZWNvcmQnLCBtYXhLZXlzOiAxMDAgfSxcbiAgICBwcm9qZWN0TmFtZXM6IHsgdHlwZTogJ3JlY29yZCcsIG1heEtleXM6IDIwMCB9LFxuICAgIHByb2plY3RDb2xvcnM6IHsgdHlwZTogJ3JlY29yZCcsIG1heEtleXM6IDIwMCB9LFxuICAgIHByb2plY3RSdWxlczogeyB0eXBlOiAncmVjb3JkJywgbWF4S2V5czogMTAwIH0sXG4gICAgbGVhZEFjY291bnQ6IHsgdHlwZTogJ3N0cmluZycsIG1heDogMzAwIH1cbiAgfSxcbiAgJ2hpc3RvcnkubGlzdCc6IHt9LFxuICAnaGlzdG9yeS5sb2FkJzogeyBydW5JZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IElEIH0gfSxcbiAgJ2Rhc2hib2FyZC5pbmZvJzoge30sXG4gIC8qKiBBIHZpc2libGUgVUkgc2F5cyBpdCBpcyBzdGlsbCBvcGVuLCBzbyB0aGUgd29ya2VyIGtlZXBzIGl0cyBmYXN0IHBhY2UuICovXG4gICd2aWV3ZXIucGluZyc6IHt9LFxuICAnYWdlbnQuaW1hZ2UnOiB7IGFnZW50SWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBwYXR0ZXJuOiBJRCB9LCByZWY6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDIwMCwgcGF0dGVybjogL15bQS1aYS16MC05Xy46LV17MSwxMjB9XFx8XFxkezEsNH0oXFx8XFxkezEsNH0pPyQvIH0sIG9mZnNldDogeyB0eXBlOiAnc3RyaW5nJywgcGF0dGVybjogL15cXGR7MSw5fSQvIH0gfSxcbiAgJ2FnZW50LnByb21wdCc6IHtcbiAgICBhZ2VudElkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogSUQgfSxcbiAgICB0ZXh0OiB7IHR5cGU6ICdzdHJpbmcnLCBtYXg6IDIwMDAwIH0sXG4gICAgLyoqIEltYWdlcyB1cGxvYWRlZCB3aXRoIGFnZW50LmF0dGFjaCAodGhlaXIgaWRzLCBuZXZlciBwYXRocykuICovXG4gICAgYXR0YWNobWVudHM6IHsgdHlwZTogJ3N0cmluZ0FycmF5JywgbWF4SXRlbXM6IDUsIHBhdHRlcm46IFVVSUQgfVxuICB9LFxuICAvKiogUmVjb3JkcyB0b2RheSdzIHZpc2l0OyBhbnN3ZXJzIHdoZXRoZXIgdG8gc2hvdyB0aGUgXCJzdGFyIG9uIEdpdEh1YlwiIHByb21wdCBub3cuICovXG4gIC8qKiBJcyBhIG5ld2VyIHJlbGVhc2Ugb3V0PyAoaW5zdGFsbGVkIGNvcGllcyBvbmx5OyBjYWNoZWQgZm9yIDYgaG91cnMgdW5sZXNzIGZvcmNlZCkgKi9cbiAgJ3VwZGF0ZS5jaGVjayc6IHsgZm9yY2U6IHsgdHlwZTogJ2Jvb2xlYW4nIH0gfSxcbiAgLyoqIFJ1bnMgYG9yY2EgcGx1Z2luIHVwZGF0ZWAgZm9yIHRoaXMgcGx1Z2luLiAqL1xuICAndXBkYXRlLnJ1bic6IHt9LFxuICAnc3Rhci52aXNpdCc6IHt9LFxuICAnc3Rhci5hbnN3ZXInOiB7IGFuc3dlcjogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG9uZU9mOiBbJ3N0YXJyZWQnLCAnbGF0ZXInLCAnbmV2ZXInXSB9IH0sXG4gIC8qKiBPbmUgYmFzZTY0IGNodW5rIG9mIGFuIGltYWdlIGZvciB0aGUgbWVzc2FnZSBib3g7IHRoZSBsYXN0IG9uZSAoYGRvbmVgKSBzYXZlcyBpdC4gKi9cbiAgJ2FnZW50LmF0dGFjaCc6IHtcbiAgICB1cGxvYWRJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIHBhdHRlcm46IFVVSUQgfSxcbiAgICBtZWRpYVR5cGU6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBvbmVPZjogWydpbWFnZS9wbmcnLCAnaW1hZ2UvanBlZycsICdpbWFnZS93ZWJwJywgJ2ltYWdlL2dpZiddIH0sXG4gICAgY2h1bms6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlLCBtYXg6IDUwXzAwMCwgcGF0dGVybjogL15bQS1aYS16MC05Ky9dKj17MCwyfSQvIH0sXG4gICAgb2Zmc2V0OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgcGF0dGVybjogL15cXGR7MSw5fSQvIH0sXG4gICAgZG9uZTogeyB0eXBlOiAnYm9vbGVhbicgfVxuICB9LFxuICAnZGFzaGJvYXJkLmNvbnRyb2xzJzogeyBlbmFibGVkOiB7IHR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IHRydWUgfSB9LFxuICAnZGFzaGJvYXJkLmVuYWJsZSc6IHsgZW5hYmxlZDogeyB0eXBlOiAnYm9vbGVhbicsIHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgJ2VudGl0eS5kZXRhaWwnOiB7IGtleTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUsIG1heDogNDIwLCBwYXR0ZXJuOiAvXih0YXNrfG1lc3NhZ2UpOltBLVphLXowLTlfOi5cXC1dezEsNDAwfSQvIH0gfVxufVxuXG4vKiogU3RyaWN0OiB1bmtub3duIGZpZWxkcyBhcmUgcmVmdXNlZCwgbGlrZSBPcmNhJ3Mgb3duIGhvc3QgQVBJLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29tbWFuZChpbnB1dDogdW5rbm93bik6IENvbW1hbmRSZXF1ZXN0IHtcbiAgaWYgKCFpc1JlY29yZChpbnB1dCkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoJ0NvbW1hbmQgbXVzdCBiZSBhbiBvYmplY3QuJylcbiAgY29uc3QgeyByZXF1ZXN0SWQsIGtpbmQsIHBhcmFtcywgY29uZmlybWVkIH0gPSBpbnB1dFxuICBpZiAodHlwZW9mIHJlcXVlc3RJZCAhPT0gJ3N0cmluZycgfHwgIS9eW0EtWmEtejAtOV8tXXs4LDgwfSQvLnRlc3QocmVxdWVzdElkKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcigncmVxdWVzdElkIGlzIG1pc3Npbmcgb3IgbWFsZm9ybWVkLicpXG4gIGlmICh0eXBlb2Yga2luZCAhPT0gJ3N0cmluZycgfHwgIShBTExfQ09NTUFORFMgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmluY2x1ZGVzKGtpbmQpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGBVbmtub3duIGNvbW1hbmQgXCIke1N0cmluZyhraW5kKX1cIi5gKVxuICBpZiAoY29uZmlybWVkICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNvbmZpcm1lZCAhPT0gJ2Jvb2xlYW4nKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdjb25maXJtZWQgbXVzdCBiZSBhIGJvb2xlYW4uJylcbiAgY29uc3Qgc3BlYyA9IENPTU1BTkRfUEFSQU1TW2tpbmQgYXMgQ29tbWFuZEtpbmRdXG4gIGNvbnN0IHJhdyA9IHBhcmFtcyA9PT0gdW5kZWZpbmVkID8ge30gOiBwYXJhbXNcbiAgaWYgKCFpc1JlY29yZChyYXcpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKCdwYXJhbXMgbXVzdCBiZSBhbiBvYmplY3QuJylcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocmF3KSkgaWYgKCFPYmplY3QuaGFzT3duKHNwZWMsIGtleSkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoYFVua25vd24gZmllbGQgXCIke2tleX1cIiBmb3IgJHtraW5kfS5gKVxuICBjb25zdCBjbGVhbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fVxuICBmb3IgKGNvbnN0IFtrZXksIGZpZWxkXSBvZiBPYmplY3QuZW50cmllcyhzcGVjKSkge1xuICAgIGNvbnN0IHZhbHVlID0gcmF3W2tleV1cbiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gJycpIHtcbiAgICAgIGlmIChmaWVsZC5yZXF1aXJlZCkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHtrZXl9IGlzIHJlcXVpcmVkIGZvciAke2tpbmR9LmApXG4gICAgICBjb250aW51ZVxuICAgIH1cbiAgICBjbGVhbltrZXldID0gY2hlY2tGaWVsZChraW5kLCBrZXksIGZpZWxkLCB2YWx1ZSlcbiAgfVxuICByZXR1cm4geyByZXF1ZXN0SWQsIGtpbmQ6IGtpbmQgYXMgQ29tbWFuZEtpbmQsIHBhcmFtczogY2xlYW4sIGNvbmZpcm1lZDogY29uZmlybWVkID09PSB0cnVlIH1cbn1cblxuZnVuY3Rpb24gY2hlY2tGaWVsZChraW5kOiBzdHJpbmcsIGtleTogc3RyaW5nLCBmaWVsZDogRmllbGRTcGVjLCB2YWx1ZTogdW5rbm93bik6IHVua25vd24ge1xuICBjb25zdCB3aGVyZSA9IGAke2tleX0gZm9yICR7a2luZH1gXG4gIHN3aXRjaCAoZmllbGQudHlwZSkge1xuICAgIGNhc2UgJ3N0cmluZyc6IHtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBtdXN0IGJlIGEgc3RyaW5nLmApXG4gICAgICBpZiAoZmllbGQubWF4ICE9PSB1bmRlZmluZWQgJiYgdmFsdWUubGVuZ3RoID4gZmllbGQubWF4KSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBpcyBsb25nZXIgdGhhbiAke2ZpZWxkLm1heH0gY2hhcmFjdGVycy5gKVxuICAgICAgaWYgKGZpZWxkLnBhdHRlcm4gJiYgIWZpZWxkLnBhdHRlcm4udGVzdCh2YWx1ZSkpIHRocm93IG5ldyBWYWxpZGF0aW9uRXJyb3IoYCR7d2hlcmV9IGhhcyBjaGFyYWN0ZXJzIHRoYXQgYXJlIG5vdCBhbGxvd2VkLmApXG4gICAgICBpZiAoZmllbGQub25lT2YgJiYgIWZpZWxkLm9uZU9mLmluY2x1ZGVzKHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBvbmUgb2YgJHtmaWVsZC5vbmVPZi5qb2luKCcsICcpfS5gKVxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfVxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ2Jvb2xlYW4nKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBtdXN0IGJlIHRydWUgb3IgZmFsc2UuYClcbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIGNhc2UgJ3N0cmluZ0FycmF5Jzoge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhIGxpc3QuYClcbiAgICAgIGlmIChmaWVsZC5tYXhJdGVtcyAhPT0gdW5kZWZpbmVkICYmIHZhbHVlLmxlbmd0aCA+IGZpZWxkLm1heEl0ZW1zKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgdG9vIG1hbnkgaXRlbXMuYClcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB2YWx1ZSkge1xuICAgICAgICBpZiAodHlwZW9mIGl0ZW0gIT09ICdzdHJpbmcnIHx8IChmaWVsZC5wYXR0ZXJuICYmICFmaWVsZC5wYXR0ZXJuLnRlc3QoaXRlbSkpKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgYW4gaW52YWxpZCBpdGVtLmApXG4gICAgICB9XG4gICAgICByZXR1cm4gWy4uLm5ldyBTZXQodmFsdWUgYXMgc3RyaW5nW10pXVxuICAgIH1cbiAgICBjYXNlICdyZWNvcmQnOiB7XG4gICAgICBpZiAoIWlzUmVjb3JkKHZhbHVlKSkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyh2YWx1ZSlcbiAgICAgIGlmIChmaWVsZC5tYXhLZXlzICE9PSB1bmRlZmluZWQgJiYgZW50cmllcy5sZW5ndGggPiBmaWVsZC5tYXhLZXlzKSB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGAke3doZXJlfSBoYXMgdG9vIG1hbnkgZW50cmllcy5gKVxuICAgICAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2ICE9PSAnc3RyaW5nJyB8fCBrLmxlbmd0aCA+IDMwMCB8fCB2Lmxlbmd0aCA+IDEyMCkgdGhyb3cgbmV3IFZhbGlkYXRpb25FcnJvcihgJHt3aGVyZX0gZW50cmllcyBtdXN0IGJlIHNob3J0IHN0cmluZ3MuYClcbiAgICAgICAgb3V0W2tdID0gdlxuICAgICAgfVxuICAgICAgcmV0dXJuIG91dFxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNSZWNvcmQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3UmVxdWVzdElkKCk6IHN0cmluZyB7XG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoMTIpXG4gIGdsb2JhbFRoaXMuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhieXRlcylcbiAgcmV0dXJuICdyZXFfJyArIEFycmF5LmZyb20oYnl0ZXMsIChiKSA9PiBiLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpKS5qb2luKCcnKVxufVxuIiwgIi8vIE5vcm1hbGl6ZWQsIGF1dGhvcml0YXRpdmUgQWdlbnQgRmxvdyBzdGF0ZSBzaGFyZWQgYnkgdGhlIHdvcmtlciBhbmQgZXZlcnkgVUkuXG4vLyBWYWx1ZXMgdGhlIHJ1bnRpbWUgZG9lcyBub3QgcHJvdmlkZSBzdGF5IG51bGw7IHRoZSBVSSBzaG93cyB0aGVtIGFzIHVuYXZhaWxhYmxlLlxuXG5leHBvcnQgdHlwZSBFdmlkZW5jZVNvdXJjZSA9ICdob3N0LWV2ZW50JyB8ICdob3N0LWNhbGwnIHwgJ2hvb2snIHwgJ2NsaS1wb2xsJyB8ICdzZXNzaW9uLWZpbGUnIHwgJ2xhdW5jaC1jYXB0dXJlJyB8ICdjb25maWcnXG5cbmV4cG9ydCB0eXBlIEFnZW50UnVudGltZVN0YXRlID0gJ3dvcmtpbmcnIHwgJ2Jsb2NrZWQnIHwgJ3dhaXRpbmcnIHwgJ2RvbmUnIHwgJ2ZhaWxlZCcgfCAnaWRsZScgfCAndW5rbm93bidcblxuZXhwb3J0IHR5cGUgQWdlbnRSb2xlID0gJ2xlYWQnIHwgJ3dvcmtlcicgfCAnYWdlbnQnIHwgJ3N1YmFnZW50J1xuXG5leHBvcnQgdHlwZSBBY2NvdW50UmVmID0ge1xuICBhY2NvdW50SWQ6IHN0cmluZyB8IG51bGxcbiAgLyoqIERpc3BsYXkgbGFiZWw6IHRoZSBwZXJzb24ncyBvd24gbGFiZWwgZnJvbSBzZXR0aW5ncywgZWxzZSB0aGUgYWNjb3VudCBlbWFpbC4gKi9cbiAgbGFiZWw6IHN0cmluZyB8IG51bGxcbiAgcHJvdmlkZXI6IHN0cmluZyB8IG51bGxcbiAgc291cmNlOiBFdmlkZW5jZVNvdXJjZVxufVxuXG5leHBvcnQgdHlwZSBBZ2VudFJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICByb2xlOiBBZ2VudFJvbGVcbiAgLyoqIE9yY2EgYWdlbnQga2luZDogY2xhdWRlLCBjb2RleCwgYW50aWdyYXZpdHksIGdlbWluaSwgb3BlbmNvZGVcdTIwMjYgKi9cbiAgYWdlbnQ6IHN0cmluZyB8IG51bGxcbiAgdGl0bGU6IHN0cmluZyB8IG51bGxcbiAgcGFyZW50SWQ6IHN0cmluZyB8IG51bGxcbiAgcnVuSWQ6IHN0cmluZyB8IG51bGxcbiAgZGlzcGF0Y2hJZDogc3RyaW5nIHwgbnVsbFxuICB0YXNrSWQ6IHN0cmluZyB8IG51bGxcbiAgdGVybWluYWxJZDogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbEhhbmRsZTogc3RyaW5nIHwgbnVsbFxuICBwYW5lS2V5OiBzdHJpbmcgfCBudWxsXG4gIHNlc3Npb25JZDogc3RyaW5nIHwgbnVsbFxuICB3b3Jrc3BhY2VJZDogc3RyaW5nIHwgbnVsbFxuICB3b3JrdHJlZVBhdGg6IHN0cmluZyB8IG51bGxcbiAgLyoqIFJlcG9zaXRvcnkgdGhlIHdvcmt0cmVlIGJlbG9uZ3MgdG8gKGZyb20gaXRzIC5naXQgcG9pbnRlciksIHdoZW4ga25vd24uICovXG4gIHJlcG9Sb290Pzogc3RyaW5nIHwgbnVsbFxuICAvKiogT3JjYSBwcm9qZWN0IGlkLCB3aGVuIE9yY2EgbmFtZWQgaXQgZm9yIHRoaXMgYWdlbnQgKG9yY2hlc3RyYXRpb24gZGlzcGF0Y2hlcyBkbykuICovXG4gIHByb2plY3RJZD86IHN0cmluZyB8IG51bGxcbiAgYnJhbmNoOiBzdHJpbmcgfCBudWxsXG4gIG1vZGVsOiBzdHJpbmcgfCBudWxsXG4gIGVmZm9ydDogc3RyaW5nIHwgbnVsbFxuICBhY2NvdW50OiBBY2NvdW50UmVmIHwgbnVsbFxuICBzdGF0ZTogQWdlbnRSdW50aW1lU3RhdGVcbiAgb3V0Y29tZTogc3RyaW5nIHwgbnVsbFxuICBzdGF0ZVNpbmNlOiBudW1iZXIgfCBudWxsXG4gIHN0YXJ0ZWRBdDogbnVtYmVyIHwgbnVsbFxuICBlbmRlZEF0OiBudW1iZXIgfCBudWxsXG4gIC8qKiBMYXN0IHRpbWUgYW55IHJ1bnRpbWUgZXZpZGVuY2UgdG91Y2hlZCB0aGlzIGFnZW50LiAqL1xuICBsYXN0U2VlbkF0OiBudW1iZXJcbiAgLyoqIFRydWUgb25seSB3aGVuIGxpdmUgZXZpZGVuY2UgKHN0YXR1cyBldmVudCwgcnVubmluZyBkaXNwYXRjaCwgbGl2ZSBzZXNzaW9uKSBzYXlzIGl0IHJ1bnMuICovXG4gIGxpdmU6IGJvb2xlYW5cbiAgdG9rZW5zOiBudW1iZXIgfCBudWxsXG4gIG1lc3NhZ2VDb3VudDogbnVtYmVyIHwgbnVsbFxuICBmYWlsdXJlQ291bnQ6IG51bWJlclxuICByZXRyeU9mRGlzcGF0Y2hJZDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3ViYWdlbnQgb25seTogdGhlIHRvb2wgY2FsbCB0aGF0IGNyZWF0ZWQgaXQuICovXG4gIGNhbGxJZDogc3RyaW5nIHwgbnVsbFxuICBzdWJhZ2VudFR5cGU6IHN0cmluZyB8IG51bGxcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgZXZpZGVuY2U6IEV2aWRlbmNlU291cmNlW11cbiAgdmVyc2lvbjogbnVtYmVyXG59XG5cbmV4cG9ydCB0eXBlIFRhc2tTdGF0ZSA9XG4gIHwgJ1BFTkRJTkcnXG4gIHwgJ1JFQURZJ1xuICB8ICdSVU5OSU5HJ1xuICB8ICdSRVZJRVcnXG4gIHwgJ1RFU1RJTkcnXG4gIHwgJ0FQUFJPVkVEJ1xuICB8ICdNRVJHRUQnXG4gIHwgJ0RPTkUnXG4gIHwgJ0JMT0NLRUQnXG4gIHwgJ0ZBSUxFRCdcbiAgfCAnUkVUUllJTkcnXG4gIHwgJ0NBTkNFTExFRCdcblxuLyoqIEluZmVycmVkIGZyb20gdGhlIHRpdGxlL3NwZWM7IHNob3duIGFzIFwiaW5mZXJyZWRcIiBpbiB0aGUgaW5zcGVjdG9yLiAqL1xuZXhwb3J0IHR5cGUgVGFza0tpbmQgPSAndGFzaycgfCAncmV2aWV3JyB8ICd0ZXN0JyB8ICdtZXJnZScgfCAncGxhbidcblxuZXhwb3J0IHR5cGUgVGFza1JlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBydW5JZDogc3RyaW5nXG4gIHBhcmVudElkOiBzdHJpbmcgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGlzcGxheU5hbWU6IHN0cmluZyB8IG51bGxcbiAgc3BlYzogc3RyaW5nIHwgbnVsbFxuICBraW5kOiBUYXNrS2luZFxuICAvKiogUmF3IE9yY2Egc3RhdHVzOiBwZW5kaW5nLCByZWFkeSwgZGlzcGF0Y2hlZCwgY29tcGxldGVkLCBmYWlsZWQsIGJsb2NrZWQuICovXG4gIG9yY2FTdGF0dXM6IHN0cmluZ1xuICBzdGF0ZTogVGFza1N0YXRlXG4gIGRlcHM6IHN0cmluZ1tdXG4gIGFzc2lnbmVlQWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICBkaXNwYXRjaElkczogc3RyaW5nW11cbiAgcmVzdWx0OiBUYXNrUmVzdWx0IHwgbnVsbFxuICBjcmVhdGVkQXQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGVkQXQ6IG51bWJlciB8IG51bGxcbiAgcmV0cnlDb3VudDogbnVtYmVyXG4gIGdhdGVJZHM6IHN0cmluZ1tdXG4gIHZlcnNpb246IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBUYXNrUmVzdWx0ID0ge1xuICBvdXRjb21lOiBzdHJpbmcgfCBudWxsXG4gIG1lc3NhZ2U6IHN0cmluZyB8IG51bGxcbiAgZmlsZXNNb2RpZmllZDogc3RyaW5nW11cbiAgcmF3OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCB0eXBlIFJ1blJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBvYmplY3RpdmU6IHN0cmluZ1xuICBsZWdhY3k6IGJvb2xlYW5cbiAgY29vcmRpbmF0b3JIYW5kbGU6IHN0cmluZyB8IG51bGxcbiAgc3RhdGU6ICdhY3RpdmUnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyB8ICdpZGxlJ1xuICBzdGFydGVkQXQ6IG51bWJlciB8IG51bGxcbiAgZW5kZWRBdDogbnVtYmVyIHwgbnVsbFxuICB0YXNrQ291bnQ6IG51bWJlclxuICB2ZXJzaW9uOiBudW1iZXJcbn1cblxuZXhwb3J0IHR5cGUgTWVzc2FnZVJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBydW5JZDogc3RyaW5nIHwgbnVsbFxuICBmcm9tSGFuZGxlOiBzdHJpbmcgfCBudWxsXG4gIHRvSGFuZGxlOiBzdHJpbmcgfCBudWxsXG4gIGZyb21BZ2VudElkOiBzdHJpbmcgfCBudWxsXG4gIHRvQWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICB0eXBlOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nIHwgbnVsbFxuICBib2R5OiBzdHJpbmcgfCBudWxsXG4gIHRhc2tJZDogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkQXQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBHYXRlUmVjb3JkID0ge1xuICBpZDogc3RyaW5nXG4gIHRhc2tJZDogc3RyaW5nIHwgbnVsbFxuICBxdWVzdGlvbjogc3RyaW5nIHwgbnVsbFxuICBzdGF0dXM6IHN0cmluZ1xuICByZXNvbHV0aW9uOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRBdDogbnVtYmVyIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBXb3JrdHJlZVJlY29yZCA9IHtcbiAgaWQ6IHN0cmluZ1xuICBuYW1lOiBzdHJpbmdcbiAgcGF0aDogc3RyaW5nXG4gIGJyYW5jaDogc3RyaW5nIHwgbnVsbFxuICBwcm9qZWN0OiBzdHJpbmcgfCBudWxsXG4gIHByb2plY3RJZDogc3RyaW5nIHwgbnVsbFxuICBob3N0SWQ6IHN0cmluZyB8IG51bGxcbiAga2luZDogJ3dvcmt0cmVlJyB8ICdmb2xkZXInXG4gIHN0YXR1czogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbENvdW50OiBudW1iZXIgfCBudWxsXG4gIGxhc3RBY3Rpdml0eUF0OiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxufVxuXG4vKiogQW4gT3JjYSBwcm9qZWN0IChyZXBvc2l0b3J5IG9yIGZvbGRlcikgYXMgYHByb2plY3QubGlzdGAgcmVwb3J0cyBpdC4gKi9cbmV4cG9ydCB0eXBlIFByb2plY3RSZWNvcmQgPSB7XG4gIGlkOiBzdHJpbmdcbiAgbmFtZTogc3RyaW5nXG4gIHBhdGg6IHN0cmluZ1xuICBraW5kOiAnZ2l0JyB8ICdmb2xkZXInXG4gIGhvc3RJZDogc3RyaW5nIHwgbnVsbFxuICBoaWRkZW46IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgVG9vbENhbGxSZWNvcmQgPSB7XG4gIGlkOiBzdHJpbmdcbiAgYWdlbnRJZDogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbElkOiBzdHJpbmcgfCBudWxsXG4gIHRvb2w6IHN0cmluZ1xuICBzdW1tYXJ5OiBzdHJpbmdcbiAgYXQ6IG51bWJlclxuICBwaGFzZTogJ3N0YXJ0ZWQnIHwgJ2ZpbmlzaGVkJ1xufVxuXG5leHBvcnQgdHlwZSBBY2NvdW50UmVjb3JkID0ge1xuICBpZDogc3RyaW5nXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgZW1haWw6IHN0cmluZyB8IG51bGxcbiAgbGFiZWw6IHN0cmluZyB8IG51bGxcbiAgYWN0aXZlOiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIENvbW1hbmRBdmFpbGFiaWxpdHlNYXAgPSBSZWNvcmQ8c3RyaW5nLCB7IGF2YWlsYWJsZTogYm9vbGVhbjsgbW9kZTogJ2RpcmVjdCcgfCAnY29vcmRpbmF0b3InIHwgJ3Vuc3VwcG9ydGVkJzsgcmVhc29uOiBzdHJpbmcgfCBudWxsIH0+XG5cbmV4cG9ydCB0eXBlIENhcGFiaWxpdGllcyA9IHtcbiAgaG9zdE1ldGhvZHM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+XG4gIGNvbW1hbmRzOiBDb21tYW5kQXZhaWxhYmlsaXR5TWFwXG4gIGFjdEFzQ29vcmRpbmF0b3I6IGJvb2xlYW5cbiAgLyoqIEV4cGVyaW1lbnRhbCBjaGF0LXNlc3Npb24gc2VuZGluZyBpcyBvbi4gKi9cbiAgY2hhdFNlbmQ/OiBib29sZWFuXG4gIC8qKiBUaGUgYnJvd3NlciBkYXNoYm9hcmQgbWF5IHJ1biBjb250cm9scyAoc2V0dGluZyk7IE9yY2EncyBvd24gcGFuZWxzIGFsd2F5cyBtYXkuICovXG4gIGRhc2hib2FyZENvbnRyb2xzPzogYm9vbGVhblxuICBjbGlBdmFpbGFibGU6IGJvb2xlYW5cbiAgY2xpUGF0aDogc3RyaW5nIHwgbnVsbFxuICBob29rczogYm9vbGVhblxuICBkYXNoYm9hcmQ6IHsgZW5hYmxlZDogYm9vbGVhbjsgdXJsOiBzdHJpbmcgfCBudWxsIH1cbiAgYXBpTWlub3I6IG51bWJlclxuICAvKiogVGhlIHBlcnNvbidzIGhvbWUgZm9sZGVyLCBzbyBgfmAgaW4gcHJvamVjdCBydWxlcyBjYW4gYmUgcmVzb2x2ZWQuICovXG4gIGhvbWVEaXI6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IHR5cGUgRmxvd1N0YXRlID0ge1xuICBzZXE6IG51bWJlclxuICBnZW5lcmF0ZWRBdDogbnVtYmVyXG4gIGFnZW50czogUmVjb3JkPHN0cmluZywgQWdlbnRSZWNvcmQ+XG4gIHRhc2tzOiBSZWNvcmQ8c3RyaW5nLCBUYXNrUmVjb3JkPlxuICBydW5zOiBSZWNvcmQ8c3RyaW5nLCBSdW5SZWNvcmQ+XG4gIG1lc3NhZ2VzOiBNZXNzYWdlUmVjb3JkW11cbiAgZ2F0ZXM6IFJlY29yZDxzdHJpbmcsIEdhdGVSZWNvcmQ+XG4gIHdvcmt0cmVlczogUmVjb3JkPHN0cmluZywgV29ya3RyZWVSZWNvcmQ+XG4gIHRvb2xDYWxsczogVG9vbENhbGxSZWNvcmRbXVxuICBhY2NvdW50czogUmVjb3JkPHN0cmluZywgQWNjb3VudFJlY29yZD5cbiAgcHJvamVjdHM6IFJlY29yZDxzdHJpbmcsIFByb2plY3RSZWNvcmQ+XG4gIGNhcGFiaWxpdGllczogQ2FwYWJpbGl0aWVzXG4gIGxhYmVsczogTGFiZWxDb25maWdcbn1cblxuLyoqIE9wdGlvbmFsIHBlcnNvbi1kZWZpbmVkIGxhYmVsczsgbmV2ZXIgcmVxdWlyZWQgZm9yIHRoZSBncmFwaCB0byB3b3JrLiAqL1xuZXhwb3J0IHR5cGUgTGFiZWxDb25maWcgPSB7XG4gIC8qKiBhY2NvdW50SWQgb3IgZW1haWwgXHUyMTkyIHRlYW0gbmFtZSAoXCJUZWFtIEFcIikuICovXG4gIGFjY291bnRUZWFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICAvKiogYWdlbnQga2luZCwgZGlzcGF0Y2ggZGlzcGxheSBuYW1lIG9yIG1vZGVsIFx1MjE5MiByb2xlIGxhYmVsIChcIlJldmlld2VyXCIpLiAqL1xuICBhZ2VudFJvbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIGxlYWRBY2NvdW50OiBzdHJpbmcgfCBudWxsXG4gIC8qKiBQcm9qZWN0IGJveCBrZXkgXHUyMTkyIGRpc3BsYXkgbmFtZSB0aGUgcGVyc29uIGNob3NlLiAqL1xuICBwcm9qZWN0TmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgLyoqIFByb2plY3QgYm94IGtleSBcdTIxOTIgY29sb3IgKCNycmdnYmIpLiAqL1xuICBwcm9qZWN0Q29sb3JzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIC8qKiBQYXRoIHBhdHRlcm4gKGdsb2IsIH4gYWxsb3dlZCkgXHUyMTkyIGdyb3VwIG5hbWUuIFJ1bGVzIHdpbiBvdmVyIE9yY2EncyBwcm9qZWN0cy4gKi9cbiAgcHJvamVjdFJ1bGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBjb25zdCBFTVBUWV9MQUJFTFM6IExhYmVsQ29uZmlnID0geyBhY2NvdW50VGVhbXM6IHt9LCBhZ2VudFJvbGVzOiB7fSwgbGVhZEFjY291bnQ6IG51bGwsIHByb2plY3ROYW1lczoge30sIHByb2plY3RDb2xvcnM6IHt9LCBwcm9qZWN0UnVsZXM6IHt9IH1cblxuZXhwb3J0IGZ1bmN0aW9uIGVtcHR5TGFiZWxzKCk6IExhYmVsQ29uZmlnIHtcbiAgcmV0dXJuIHsgYWNjb3VudFRlYW1zOiB7fSwgYWdlbnRSb2xlczoge30sIGxlYWRBY2NvdW50OiBudWxsLCBwcm9qZWN0TmFtZXM6IHt9LCBwcm9qZWN0Q29sb3JzOiB7fSwgcHJvamVjdFJ1bGVzOiB7fSB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUNhcGFiaWxpdGllcygpOiBDYXBhYmlsaXRpZXMge1xuICByZXR1cm4geyBob3N0TWV0aG9kczoge30sIGNvbW1hbmRzOiB7fSwgYWN0QXNDb29yZGluYXRvcjogZmFsc2UsIGNsaUF2YWlsYWJsZTogZmFsc2UsIGNsaVBhdGg6IG51bGwsIGhvb2tzOiBmYWxzZSwgZGFzaGJvYXJkOiB7IGVuYWJsZWQ6IGZhbHNlLCB1cmw6IG51bGwgfSwgYXBpTWlub3I6IDAsIGhvbWVEaXI6IG51bGwgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlTdGF0ZSgpOiBGbG93U3RhdGUge1xuICByZXR1cm4ge1xuICAgIHNlcTogMCxcbiAgICBnZW5lcmF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICBhZ2VudHM6IHt9LFxuICAgIHRhc2tzOiB7fSxcbiAgICBydW5zOiB7fSxcbiAgICBtZXNzYWdlczogW10sXG4gICAgZ2F0ZXM6IHt9LFxuICAgIHdvcmt0cmVlczoge30sXG4gICAgdG9vbENhbGxzOiBbXSxcbiAgICBhY2NvdW50czoge30sXG4gICAgcHJvamVjdHM6IHt9LFxuICAgIGNhcGFiaWxpdGllczogZW1wdHlDYXBhYmlsaXRpZXMoKSxcbiAgICAvLyBBIGZyZXNoIGNvcHk6IGEgc2hhcmVkIG9iamVjdCB3b3VsZCBsZXQgb25lIHN0YXRlJ3MgbGFiZWxzIGxlYWsgaW50byBhbm90aGVyLlxuICAgIGxhYmVsczogZW1wdHlMYWJlbHMoKVxuICB9XG59XG4iLCAiLy8gQWNjb3VudCBpZGVudGl0eSBwZXIgYWdlbnQsIGV2aWRlbmNlIGZpcnN0OlxuLy8gIDEuIGBvcmNhIGFjY291bnQgbGlzdGAgZm9yIHRoZSBhY2NvdW50cyB0aGVtc2VsdmVzIChpZHMsIHByb3ZpZGVyLCBlbWFpbCwgYWN0aXZlIG9uZSk7XG4vLyAgMi4gZWFjaCBhY2NvdW50IGhvbWUncyBgc2Vzc2lvbnMvPHBpZD4uanNvbmAgKHdyaXR0ZW4gYnkgdGhlIGFnZW50IENMSSkgbWFwcyBzZXNzaW9uSWQgXHUyMTkyIGFjY291bnQ7XG4vLyAgMy4gZmFsbGJhY2s6IHRoZSBhZ2VudC5sYXVuY2guYmVmb3JlIGhvb2sgcmVjb3JkcyB3aGljaCBhY2NvdW50IHByb2ZpbGUgYSB0ZXJtaW5hbCBsYXVuY2hlZCB3aXRoLlxuLy8gVG9rZW5zIGFuZCBjcmVkZW50aWFscyBhcmUgbmV2ZXIgcmVhZCBvciBzdG9yZWQuXG5pbXBvcnQgeyByZWFkZGlyLCByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHR5cGUgeyBBY2NvdW50UmVjb3JkLCBBY2NvdW50UmVmIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgc3RyLCB0eXBlIFdvcmtlckNvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0LnRzJ1xuXG50eXBlIENsaUFjY291bnQgPSB7IGlkOiBzdHJpbmc7IGVtYWlsPzogc3RyaW5nIHwgbnVsbDsgaG9tZT86IHN0cmluZyB8IG51bGwgfVxudHlwZSBDbGlQcm92aWRlciA9IHsgYWNjb3VudHM/OiBDbGlBY2NvdW50W107IGFjdGl2ZUFjY291bnRJZD86IHN0cmluZyB8IG51bGwgfVxuXG4vKiogRW52IHZhcnMgYWdlbnQgQ0xJcyByZWFkIHRoZWlyIHByb2ZpbGUgZGlyZWN0b3J5IGZyb20uICovXG5jb25zdCBQUk9GSUxFX0VOVl9LRVlTID0gWydDTEFVREVfQ09ORklHX0RJUicsICdDT0RFWF9IT01FJywgJ0dFTUlOSV9DT05GSUdfRElSJywgJ09QRU5DT0RFX0NPTkZJR19ESVInXVxuY29uc3QgTUFYX1NFU1NJT05fRklMRVMgPSA0MDBcblxuZXhwb3J0IGNsYXNzIEFjY291bnRzQWRhcHRlciB7XG4gIHByaXZhdGUgaG9tZXMgPSBuZXcgTWFwPHN0cmluZywgeyBhY2NvdW50SWQ6IHN0cmluZzsgcHJvdmlkZXI6IHN0cmluZyB9PigpXG4gIHByaXZhdGUgc2Vzc2lvbkFjY291bnQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG4gIC8qKiBTZXNzaW9uIGZpbGVzIGFsc28gY2FycnkgdGhlIGFnZW50IENMSSdzIHBpZCBhbmQgYnVzeS9pZGxlIHN0YXR1czogbGl2ZSBldmlkZW5jZS4gKi9cbiAgcHJpdmF0ZSBzZXNzaW9uUHJvY2VzcyA9IG5ldyBNYXA8c3RyaW5nLCB7IHBpZDogbnVtYmVyOyBwcm9jU3RhcnQ6IHN0cmluZyB8IG51bGw7IHN0YXR1czogc3RyaW5nIHwgbnVsbDsgdXBkYXRlZEF0OiBudW1iZXIgfCBudWxsIH0+KClcbiAgcHJpdmF0ZSB0ZXJtaW5hbEFjY291bnQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjdHg6IFdvcmtlckNvbnRleHQpIHt9XG5cbiAgLyoqIFByb2ZpbGUgaG9tZXMgb2YgQ29kZXggYWNjb3VudHMgKGVhY2ggbWF5IGtlZXAgaXRzIG93biBzZXNzaW9ucy8pLiAqL1xuICBjb2RleEhvbWVzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuaG9tZXMuZW50cmllcygpXS5maWx0ZXIoKFssIHZdKSA9PiB2LnByb3ZpZGVyID09PSAnY29kZXgnKS5tYXAoKFtob21lXSkgPT4gaG9tZSlcbiAgfVxuXG4gIC8qKiBQcm9maWxlIGhvbWVzIG9mIENsYXVkZSBhY2NvdW50cyAoZWFjaCBoYXMgaXRzIG93biBwcm9qZWN0cy8gYW5kIHNlc3Npb25zLykuICovXG4gIGNsYXVkZUhvbWVzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuaG9tZXMuZW50cmllcygpXS5maWx0ZXIoKFssIHZdKSA9PiB2LnByb3ZpZGVyID09PSAnY2xhdWRlJykubWFwKChbaG9tZV0pID0+IGhvbWUpXG4gIH1cblxuICBhc3luYyByZWZyZXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZEFjY291bnRzKClcbiAgICB0aGlzLnNlc3Npb25Qcm9jZXNzLmNsZWFyKClcbiAgICBhd2FpdCB0aGlzLnNjYW5TZXNzaW9uRmlsZXMoKVxuICAgIHRoaXMuYXBwbHlUb0FnZW50cygpXG4gICAgYXdhaXQgdGhpcy5hcHBseUxpdmVuZXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXZlIGV2aWRlbmNlIGZvciBhZ2VudHMgT3JjYSdzIGV2ZW50cyBoYXZlIG5vdCByZXBvcnRlZCBzaW5jZSBhIHJlc3RhcnQ6IHRoZSBhZ2VudCBDTEknc1xuICAgKiBzZXNzaW9uIGZpbGUgbmFtZXMgaXRzIHBpZDsgaWYgdGhhdCBwcm9jZXNzIGlzIHJ1bm5pbmcsIHRoZSBhZ2VudCBpcyBsaXZlLiBOZXZlciBvdmVycmlkZXMgYVxuICAgKiBuZXdlciBzdGF0dXMgZXZlbnQgKHRoZSBzdG9yZSBvcmRlcnMgc3RhdGUgYnkgb2JzZXJ2YXRpb24gdGltZSkuXG4gICAqL1xuICBhc3luYyBhcHBseUxpdmVuZXNzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzKSkge1xuICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICAgIGNvbnN0IHByb2MgPSB0aGlzLnNlc3Npb25Qcm9jZXNzLmdldChhZ2VudC5zZXNzaW9uSWQpXG4gICAgICBpZiAoIXByb2MpIGNvbnRpbnVlXG4gICAgICBjb25zdCBhbGl2ZSA9IGF3YWl0IHByb2Nlc3NBbGl2ZShwcm9jLnBpZCwgcHJvYy5wcm9jU3RhcnQpXG4gICAgICBpZiAoYWdlbnQubGl2ZSA9PT0gYWxpdmUgJiYgYWdlbnQuc3RhdGUgIT09ICd1bmtub3duJykgY29udGludWVcbiAgICAgIGNvbnN0IHN0YXRlID0gIWFsaXZlID8gKGFnZW50LnN0YXRlID09PSAndW5rbm93bicgfHwgYWdlbnQubGl2ZSA/ICdkb25lJyA6IGFnZW50LnN0YXRlKSA6IHByb2Muc3RhdHVzID09PSAnYnVzeScgPyAnd29ya2luZycgOiAnd2FpdGluZydcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KGFnZW50LmlkLCBwcm9jLnVwZGF0ZWRBdCA/PyAwLCB7IGxpdmU6IGFsaXZlLCBzdGF0ZSwgZXZpZGVuY2U6IFsnc2Vzc2lvbi1maWxlJ10gfSwgKCkgPT4gYWdlbnQpXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2FkQWNjb3VudHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjxSZWNvcmQ8c3RyaW5nLCBDbGlQcm92aWRlcj4+KFsnYWNjb3VudCcsICdsaXN0J10pXG4gICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgIHRoaXMuY3R4LmxvZyhgYWNjb3VudCBsaXN0OiAke3Jlc3VsdC5jb2RlfSAke3Jlc3VsdC5tZXNzYWdlfWApXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgbGFiZWxzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmxhYmVsc1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgW3Byb3ZpZGVyLCBpbmZvXSBvZiBPYmplY3QuZW50cmllcyhyZXN1bHQucmVzdWx0KSkge1xuICAgICAgaWYgKCFpbmZvIHx8ICFBcnJheS5pc0FycmF5KGluZm8uYWNjb3VudHMpKSBjb250aW51ZVxuICAgICAgZm9yIChjb25zdCBhY2NvdW50IG9mIGluZm8uYWNjb3VudHMpIHtcbiAgICAgICAgc2Vlbi5hZGQoYWNjb3VudC5pZClcbiAgICAgICAgY29uc3QgZW1haWwgPSBzdHIoYWNjb3VudC5lbWFpbClcbiAgICAgICAgY29uc3QgcmVjb3JkOiBBY2NvdW50UmVjb3JkID0ge1xuICAgICAgICAgIGlkOiBhY2NvdW50LmlkLFxuICAgICAgICAgIHByb3ZpZGVyLFxuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIGxhYmVsOiBsYWJlbHMuYWNjb3VudFRlYW1zW2FjY291bnQuaWRdID8/IChlbWFpbCA/IGxhYmVscy5hY2NvdW50VGVhbXNbZW1haWxdIDogdW5kZWZpbmVkKSA/PyBudWxsLFxuICAgICAgICAgIGFjdGl2ZTogaW5mby5hY3RpdmVBY2NvdW50SWQgPT09IGFjY291bnQuaWRcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdhY2NvdW50JywgaWQ6IGFjY291bnQuaWQsIHZhbHVlOiByZWNvcmQgfSlcbiAgICAgICAgY29uc3QgaG9tZSA9IHN0cihhY2NvdW50LmhvbWUpXG4gICAgICAgIGlmIChob21lKSB0aGlzLmhvbWVzLnNldChyZXNvbHZlKGhvbWUpLCB7IGFjY291bnRJZDogYWNjb3VudC5pZCwgcHJvdmlkZXIgfSlcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWNjb3VudHMpKSBpZiAoIXNlZW4uaGFzKGlkKSkgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnYWNjb3VudCcsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuU2Vzc2lvbkZpbGVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBidWRnZXQgPSBNQVhfU0VTU0lPTl9GSUxFU1xuICAgIGZvciAoY29uc3QgW2hvbWUsIHsgYWNjb3VudElkIH1dIG9mIHRoaXMuaG9tZXMpIHtcbiAgICAgIGNvbnN0IGRpciA9IGpvaW4oaG9tZSwgJ3Nlc3Npb25zJylcbiAgICAgIGxldCBuYW1lczogc3RyaW5nW11cbiAgICAgIHRyeSB7XG4gICAgICAgIG5hbWVzID0gKGF3YWl0IHJlYWRkaXIoZGlyKSkuZmlsdGVyKChuYW1lKSA9PiAvXlxcZCtcXC5qc29uJC8udGVzdChuYW1lKSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7XG4gICAgICAgIGlmIChidWRnZXQtLSA8PSAwKSByZXR1cm5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGpvaW4oZGlyLCBuYW1lKSwgJ3V0ZjgnKSkgYXMgeyBzZXNzaW9uSWQ/OiB1bmtub3duOyBwaWQ/OiB1bmtub3duOyBwcm9jU3RhcnQ/OiB1bmtub3duOyBzdGF0dXM/OiB1bmtub3duOyB1cGRhdGVkQXQ/OiB1bmtub3duIH1cbiAgICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSBzdHIocGFyc2VkLnNlc3Npb25JZClcbiAgICAgICAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICAgICAgICB0aGlzLnNlc3Npb25BY2NvdW50LnNldChzZXNzaW9uSWQsIGFjY291bnRJZClcbiAgICAgICAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBpZCA9PT0gJ251bWJlcicpIHRoaXMuc2Vzc2lvblByb2Nlc3Muc2V0KHNlc3Npb25JZCwgeyBwaWQ6IHBhcnNlZC5waWQsIHByb2NTdGFydDogcGFyc2VkLnByb2NTdGFydCA9PSBudWxsID8gbnVsbCA6IFN0cmluZyhwYXJzZWQucHJvY1N0YXJ0KSwgc3RhdHVzOiBzdHIocGFyc2VkLnN0YXR1cyksIHVwZGF0ZWRBdDogdHlwZW9mIHBhcnNlZC51cGRhdGVkQXQgPT09ICdudW1iZXInID8gcGFyc2VkLnVwZGF0ZWRBdCA6IG51bGwgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIGEgZmlsZSBiZWluZyB3cml0dGVuIHJpZ2h0IG5vdzsgbmV4dCBzY2FuIHBpY2tzIGl0IHVwXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogYWdlbnQubGF1bmNoLmJlZm9yZTogcmVjb3JkIHRoZSBwcm9maWxlIGRpciBvbmx5LiBSZXR1cm5zIG5vdGhpbmcsIHNvIHRoZSBsYXVuY2ggZ29lcyBvbi4gKi9cbiAgb25MYXVuY2goZXZlbnQ6IHsgYWdlbnQ6IHN0cmluZzsgdGVybWluYWxJZD86IHN0cmluZzsgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0pOiB2b2lkIHtcbiAgICBpZiAoIWV2ZW50LnRlcm1pbmFsSWQpIHJldHVyblxuICAgIGZvciAoY29uc3Qga2V5IG9mIFBST0ZJTEVfRU5WX0tFWVMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZXZlbnQuZW52Py5ba2V5XVxuICAgICAgaWYgKCF2YWx1ZSkgY29udGludWVcbiAgICAgIGNvbnN0IGFjY291bnRJZCA9IHRoaXMuYWNjb3VudEZvclByb2ZpbGVEaXIodmFsdWUpXG4gICAgICBpZiAoYWNjb3VudElkKSB7XG4gICAgICAgIHRoaXMudGVybWluYWxBY2NvdW50LnNldChldmVudC50ZXJtaW5hbElkLCBhY2NvdW50SWQpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFjY291bnRGb3JQcm9maWxlRGlyKGRpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZShkaXIpXG4gICAgZm9yIChjb25zdCBbaG9tZSwgeyBhY2NvdW50SWQgfV0gb2YgdGhpcy5ob21lcykge1xuICAgICAgLy8gRXhhY3QgcHJvZmlsZSBkaXIsIGl0cyBob21lLCBvciBpbnNpZGUgaXQuIE5ldmVyIGEgYnJvYWQgYW5jZXN0b3IgZm9sZGVyLlxuICAgICAgaWYgKHRhcmdldCA9PT0gaG9tZSB8fCB0YXJnZXQgPT09IGRpcm5hbWUoaG9tZSkgfHwgdGFyZ2V0LnN0YXJ0c1dpdGgoaG9tZSArICcvJykpIHJldHVybiBhY2NvdW50SWRcbiAgICB9XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGFwcGx5VG9BZ2VudHMoKTogdm9pZCB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKClcbiAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXMoc3RhdGUuYWdlbnRzKSkge1xuICAgICAgbGV0IHJlZjogQWNjb3VudFJlZiB8IG51bGwgPSBudWxsXG4gICAgICBjb25zdCBmcm9tU2Vzc2lvbiA9IGFnZW50LnNlc3Npb25JZCA/IHRoaXMuc2Vzc2lvbkFjY291bnQuZ2V0KGFnZW50LnNlc3Npb25JZCkgOiB1bmRlZmluZWRcbiAgICAgIGNvbnN0IGZyb21MYXVuY2ggPSBhZ2VudC50ZXJtaW5hbElkID8gdGhpcy50ZXJtaW5hbEFjY291bnQuZ2V0KGFnZW50LnRlcm1pbmFsSWQpIDogdW5kZWZpbmVkXG4gICAgICBpZiAoZnJvbVNlc3Npb24pIHJlZiA9IHRoaXMucmVmKGZyb21TZXNzaW9uLCAnc2Vzc2lvbi1maWxlJylcbiAgICAgIGVsc2UgaWYgKGZyb21MYXVuY2gpIHJlZiA9IHRoaXMucmVmKGZyb21MYXVuY2gsICdsYXVuY2gtY2FwdHVyZScpXG4gICAgICBlbHNlIGlmIChhZ2VudC5yb2xlID09PSAnc3ViYWdlbnQnICYmIGFnZW50LnBhcmVudElkKSByZWYgPSBzdGF0ZS5hZ2VudHNbYWdlbnQucGFyZW50SWRdPy5hY2NvdW50ID8/IG51bGxcbiAgICAgIGlmICghcmVmKSBjb250aW51ZVxuICAgICAgaWYgKGFnZW50LmFjY291bnQgJiYgYWdlbnQuYWNjb3VudC5hY2NvdW50SWQgPT09IHJlZi5hY2NvdW50SWQgJiYgYWdlbnQuYWNjb3VudC5sYWJlbCA9PT0gcmVmLmxhYmVsKSBjb250aW51ZVxuICAgICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoYWdlbnQuaWQsIGFnZW50Lmxhc3RTZWVuQXQsIHsgYWNjb3VudDogcmVmLCBldmlkZW5jZTogW3JlZi5zb3VyY2VdIH0sICgpID0+IGFnZW50KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVmKGFjY291bnRJZDogc3RyaW5nLCBzb3VyY2U6IEFjY291bnRSZWZbJ3NvdXJjZSddKTogQWNjb3VudFJlZiB7XG4gICAgY29uc3QgYWNjb3VudCA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hY2NvdW50c1thY2NvdW50SWRdXG4gICAgY29uc3QgbGFiZWxzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmxhYmVsc1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxzLmFjY291bnRUZWFtc1thY2NvdW50SWRdID8/IChhY2NvdW50Py5lbWFpbCA/IGxhYmVscy5hY2NvdW50VGVhbXNbYWNjb3VudC5lbWFpbF0gOiB1bmRlZmluZWQpID8/IGFjY291bnQ/LmVtYWlsID8/IG51bGxcbiAgICByZXR1cm4geyBhY2NvdW50SWQsIGxhYmVsLCBwcm92aWRlcjogYWNjb3VudD8ucHJvdmlkZXIgPz8gbnVsbCwgc291cmNlIH1cbiAgfVxufVxuXG4vKipcbiAqIElzIHRoZSBhZ2VudCBDTEkgdGhhdCB3cm90ZSB0aGUgc2Vzc2lvbiBmaWxlIHN0aWxsIHJ1bm5pbmc/IEEgcGlkIGNhbiBiZSByZXVzZWQgYnkgYW5vdGhlclxuICogcHJvY2Vzcywgc28gb24gTGludXggdGhlIHByb2Nlc3Mgc3RhcnQgdGltZSBtdXN0IGFsc28gbWF0Y2ggdGhlIGZpbGUncyBgcHJvY1N0YXJ0YC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NBbGl2ZShwaWQ6IG51bWJlciwgcHJvY1N0YXJ0OiBzdHJpbmcgfCBudWxsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgcHJvY2Vzcy5raWxsKHBpZCwgMClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSAhPT0gJ0VQRVJNJykgcmV0dXJuIGZhbHNlXG4gIH1cbiAgaWYgKHByb2NTdGFydCAmJiBwcm9jZXNzLnBsYXRmb3JtID09PSAnbGludXgnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCByZWFkRmlsZShgL3Byb2MvJHtwaWR9L3N0YXRgLCAndXRmOCcpXG4gICAgICBjb25zdCBmaWVsZHMgPSBzdGF0LnNsaWNlKHN0YXQubGFzdEluZGV4T2YoJyknKSArIDIpLnNwbGl0KCcgJylcbiAgICAgIHJldHVybiBmaWVsZHNbMTldID09PSBwcm9jU3RhcnRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuIiwgImltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJlY29yZCwgQWdlbnRSb2xlIH0gZnJvbSAnLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHR5cGUgeyBDbGlSdW5uZXIgfSBmcm9tICcuL2NsaS9vcmNhLWNsaS50cydcbmltcG9ydCB0eXBlIHsgRmxvd1N0b3JlIH0gZnJvbSAnLi9zdGF0ZS9zdG9yZS50cydcbmltcG9ydCB0eXBlIHsgSWRlbnRpdHlJbmRleCB9IGZyb20gJy4vc3RhdGUvaWRlbnRpdHktaW5kZXgudHMnXG5cbi8qKiBFdmVyeXRoaW5nIGFuIGFkYXB0ZXIgb3IgY29tbWFuZCBoYW5kbGVyIG5lZWRzOyB0ZXN0cyBwYXNzIGZha2VzLiAqL1xuZXhwb3J0IHR5cGUgV29ya2VyQ29udGV4dCA9IHtcbiAgb3JjYTogUGljazxPcmNhV29ya2VyQXBpLCAnaG9zdCcgfCAnbG9nJz4gJiBQYXJ0aWFsPFBpY2s8T3JjYVdvcmtlckFwaSwgJ3BhbmVscycgfCAnc3RvcmFnZScgfCAnc2V0dGluZ3MnIHwgJ3NlY3JldHMnIHwgJ2V2ZW50cycgfCAnaG9va3MnIHwgJ2FwaSc+PlxuICBzdG9yZTogRmxvd1N0b3JlXG4gIGNsaTogQ2xpUnVubmVyXG4gIGlkZW50aXR5OiBJZGVudGl0eUluZGV4XG4gIG5vdzogKCkgPT4gbnVtYmVyXG4gIGxvZzogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3QWdlbnQoaWQ6IHN0cmluZywgcm9sZTogQWdlbnRSb2xlLCBub3c6IG51bWJlcik6IEFnZW50UmVjb3JkIHtcbiAgcmV0dXJuIHtcbiAgICBpZCxcbiAgICByb2xlLFxuICAgIGFnZW50OiBudWxsLFxuICAgIHRpdGxlOiBudWxsLFxuICAgIHBhcmVudElkOiBudWxsLFxuICAgIHJ1bklkOiBudWxsLFxuICAgIGRpc3BhdGNoSWQ6IG51bGwsXG4gICAgdGFza0lkOiBudWxsLFxuICAgIHRlcm1pbmFsSWQ6IG51bGwsXG4gICAgdGVybWluYWxIYW5kbGU6IG51bGwsXG4gICAgcGFuZUtleTogbnVsbCxcbiAgICBzZXNzaW9uSWQ6IG51bGwsXG4gICAgd29ya3NwYWNlSWQ6IG51bGwsXG4gICAgd29ya3RyZWVQYXRoOiBudWxsLFxuICAgIGJyYW5jaDogbnVsbCxcbiAgICBtb2RlbDogbnVsbCxcbiAgICBlZmZvcnQ6IG51bGwsXG4gICAgYWNjb3VudDogbnVsbCxcbiAgICBzdGF0ZTogJ3Vua25vd24nLFxuICAgIG91dGNvbWU6IG51bGwsXG4gICAgc3RhdGVTaW5jZTogbnVsbCxcbiAgICBzdGFydGVkQXQ6IG51bGwsXG4gICAgZW5kZWRBdDogbnVsbCxcbiAgICBsYXN0U2VlbkF0OiBub3csXG4gICAgbGl2ZTogZmFsc2UsXG4gICAgdG9rZW5zOiBudWxsLFxuICAgIG1lc3NhZ2VDb3VudDogbnVsbCxcbiAgICBmYWlsdXJlQ291bnQ6IDAsXG4gICAgcmV0cnlPZkRpc3BhdGNoSWQ6IG51bGwsXG4gICAgY2FsbElkOiBudWxsLFxuICAgIHN1YmFnZW50VHlwZTogbnVsbCxcbiAgICBkZXNjcmlwdGlvbjogbnVsbCxcbiAgICBldmlkZW5jZTogW10sXG4gICAgdmVyc2lvbjogMFxuICB9XG59XG5cbi8qKiBQYXJzZXMgT3JjYSB0aW1lc3RhbXBzOiBJU08gc3RyaW5ncywgXCJZWVlZLU1NLUREIEhIOk1NOlNTXCIgKFVUQykgb3IgZXBvY2ggbXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUaW1lKHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJyB8fCAhdmFsdWUgfHwgdmFsdWUgPT09ICdOb25lJykgcmV0dXJuIG51bGxcbiAgY29uc3Qgbm9ybWFsaXplZCA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0gXFxkezJ9OlxcZHsyfTpcXGR7Mn0kLy50ZXN0KHZhbHVlKSA/IHZhbHVlLnJlcGxhY2UoJyAnLCAnVCcpICsgJ1onIDogdmFsdWVcbiAgY29uc3QgbXMgPSBEYXRlLnBhcnNlKG5vcm1hbGl6ZWQpXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobXMpID8gbXMgOiBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdHIodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUgIT09ICcnICYmIHZhbHVlICE9PSAnTm9uZScgPyB2YWx1ZSA6IG51bGxcbn1cbiIsICIvLyBMaW5rcyB0aGUgZGlmZmVyZW50IGlkcyBPcmNhIHVzZXMgZm9yIG9uZSBhZ2VudCAodGVybWluYWwgaWQsIG9yY2hlc3RyYXRpb24gdGVybWluYWwgaGFuZGxlLFxuLy8gcGFuZSBrZXksIHNlc3Npb24gaWQpIHNvIGEgc3RhdHVzIGV2ZW50IGFuZCBhbiBvcmNoZXN0cmF0aW9uIGRpc3BhdGNoIGxhbmQgb24gdGhlIHNhbWUgbm9kZS5cblxuZXhwb3J0IHR5cGUgQWdlbnRLZXlzID0ge1xuICB0ZXJtaW5hbElkPzogc3RyaW5nIHwgbnVsbFxuICB0ZXJtaW5hbEhhbmRsZT86IHN0cmluZyB8IG51bGxcbiAgcGFuZUtleT86IHN0cmluZyB8IG51bGxcbiAgc2Vzc2lvbklkPzogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY2xhc3MgSWRlbnRpdHlJbmRleCB7XG4gIHByaXZhdGUgYnlLZXkgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG5cbiAgbGluayhhZ2VudElkOiBzdHJpbmcsIGtleXM6IEFnZW50S2V5cyk6IHZvaWQge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleUxpc3Qoa2V5cykpIHtcbiAgICAgIC8vIE9yY2hlc3RyYXRpb24gZGlzcGF0Y2ggaWRzIHdpbiBvdmVyIHBsYWluIHRlcm1pbmFsIGlkczogdGhleSBjYXJyeSBtb3JlIGNvbnRleHQuXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuYnlLZXkuZ2V0KGtleSlcbiAgICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZy5zdGFydHNXaXRoKCdkaXNwYXRjaDonKSAmJiAhYWdlbnRJZC5zdGFydHNXaXRoKCdkaXNwYXRjaDonKSkgY29udGludWVcbiAgICAgIHRoaXMuYnlLZXkuc2V0KGtleSwgYWdlbnRJZClcbiAgICB9XG4gIH1cblxuICByZXNvbHZlKGtleXM6IEFnZW50S2V5cyk6IHN0cmluZyB8IG51bGwge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleUxpc3Qoa2V5cykpIHtcbiAgICAgIGNvbnN0IGlkID0gdGhpcy5ieUtleS5nZXQoa2V5KVxuICAgICAgaWYgKGlkKSByZXR1cm4gaWRcbiAgICB9XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHVubGlua0FnZW50KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgW2tleSwgaWRdIG9mIHRoaXMuYnlLZXkpIGlmIChpZCA9PT0gYWdlbnRJZCkgdGhpcy5ieUtleS5kZWxldGUoa2V5KVxuICB9XG59XG5cbmZ1bmN0aW9uIGtleUxpc3Qoa2V5czogQWdlbnRLZXlzKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW11cbiAgaWYgKGtleXMucGFuZUtleSkgb3V0LnB1c2goYHBhbmU6JHtub3JtYWxpemVQYW5lS2V5KGtleXMucGFuZUtleSl9YClcbiAgaWYgKGtleXMudGVybWluYWxIYW5kbGUpIG91dC5wdXNoKGBoYW5kbGU6JHtrZXlzLnRlcm1pbmFsSGFuZGxlfWApXG4gIGlmIChrZXlzLnRlcm1pbmFsSWQpIG91dC5wdXNoKGB0ZXJtOiR7a2V5cy50ZXJtaW5hbElkfWApXG4gIGlmIChrZXlzLnNlc3Npb25JZCkgb3V0LnB1c2goYHNlc3Npb246JHtrZXlzLnNlc3Npb25JZH1gKVxuICByZXR1cm4gb3V0XG59XG5cbi8qKlxuICogU3RydWN0dXJlZCAoY2hhdCkgc2Vzc2lvbnMgdXNlIGBzdHJ1Y3R1cmVkLWFnZW50LXNlc3Npb24tPHNlc3Npb24+OjxwYW5lIGluc3RhbmNlPmA7IHN0YXR1cyBldmVudHNcbiAqIGFuZCBvcmNoZXN0cmF0aW9uIGRpc3BhdGNoZXMgbmFtZSBkaWZmZXJlbnQgaW5zdGFuY2VzIG9mIHRoZSBzYW1lIHNlc3Npb24sIHNvIG1hdGNoIG9uIHRoZVxuICogc2Vzc2lvbiBwYXJ0LiBUZXJtaW5hbCBwYW5lIGtleXMgKGA8dGFiIGdyb3VwPjo8cGFuZT5gKSBzdGF5IGV4YWN0OiB0aGUgZ3JvdXAgaXMgc2hhcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGFuZUtleShwYW5lS2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAocGFuZUtleS5zdGFydHNXaXRoKCdzdHJ1Y3R1cmVkLWFnZW50LXNlc3Npb24tJykpIHJldHVybiBwYW5lS2V5LnNwbGl0KCc6JylbMF1cbiAgcmV0dXJuIHBhbmVLZXlcbn1cblxuLyoqIEFnZW50cyAob3RoZXIgdGhhbiBgZXhjZXB0YCkgd2hvc2UgcGFuZSBrZXkgbmFtZXMgdGhlIHNhbWUgcGFuZSBvciBzdHJ1Y3R1cmVkIHNlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gc2FtZVBhbmVLZXkoYTogc3RyaW5nIHwgbnVsbCwgYjogc3RyaW5nIHwgbnVsbCk6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihhICYmIGIgJiYgbm9ybWFsaXplUGFuZUtleShhKSA9PT0gbm9ybWFsaXplUGFuZUtleShiKSlcbn1cbiIsICIvLyBGb2xkcyBhIGR1cGxpY2F0ZSBhZ2VudCByZWNvcmQgaW50byB0aGUgY2Fub25pY2FsIG9uZSAoYW4gb3JjaGVzdHJhdGlvbiBkaXNwYXRjaCB3aW5zKSwga2VlcGluZ1xuLy8gZXZlcnl0aGluZyB0aGUgZHVwbGljYXRlIGxlYXJuZWQgKHNlc3Npb24sIGFjY291bnQsIHRva2VucywgdGVybWluYWwpIGFuZCByZW1vdmluZyBpdC5cbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgdHlwZSB7IElkZW50aXR5SW5kZXggfSBmcm9tICcuL2lkZW50aXR5LWluZGV4LnRzJ1xuaW1wb3J0IHsgc2FtZVBhbmVLZXkgfSBmcm9tICcuL2lkZW50aXR5LWluZGV4LnRzJ1xuaW1wb3J0IHR5cGUgeyBGbG93U3RvcmUgfSBmcm9tICcuL3N0b3JlLnRzJ1xuXG5jb25zdCBDQVJSWTogKGtleW9mIEFnZW50UmVjb3JkKVtdID0gWydzZXNzaW9uSWQnLCAndGVybWluYWxJZCcsICdhY2NvdW50JywgJ3Rva2VucycsICdtZXNzYWdlQ291bnQnLCAnYWdlbnQnLCAnbW9kZWwnLCAnZWZmb3J0JywgJ2JyYW5jaCcsICd3b3JrdHJlZVBhdGgnLCAnd29ya3NwYWNlSWQnXVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VBZ2VudEludG8oc3RvcmU6IEZsb3dTdG9yZSwgaWRlbnRpdHk6IElkZW50aXR5SW5kZXgsIHRhcmdldElkOiBzdHJpbmcsIHNvdXJjZUlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKHRhcmdldElkID09PSBzb3VyY2VJZCkgcmV0dXJuXG4gIGNvbnN0IHN0YXRlID0gc3RvcmUucmVhZCgpXG4gIGNvbnN0IHRhcmdldCA9IHN0YXRlLmFnZW50c1t0YXJnZXRJZF1cbiAgY29uc3Qgc291cmNlID0gc3RhdGUuYWdlbnRzW3NvdXJjZUlkXVxuICBpZiAoIXRhcmdldCB8fCAhc291cmNlKSByZXR1cm5cbiAgY29uc3QgcGF0Y2g6IFBhcnRpYWw8QWdlbnRSZWNvcmQ+ID0geyBldmlkZW5jZTogc291cmNlLmV2aWRlbmNlIH1cbiAgZm9yIChjb25zdCBrZXkgb2YgQ0FSUlkpIGlmICh0YXJnZXRba2V5XSA9PSBudWxsICYmIHNvdXJjZVtrZXldICE9IG51bGwpIChwYXRjaCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilba2V5XSA9IHNvdXJjZVtrZXldXG4gIC8vIExpdmUgc3RhdHVzIGZyb20gaG9zdCBldmVudHMgaXMgbW9yZSBwcmVjaXNlIHRoYW4gdGhlIGR1cmFibGUgcG9sbDsga2VlcCB0aGUgbmV3ZXIgb25lLlxuICBpZiAoc291cmNlLmxhc3RTZWVuQXQgPiB0YXJnZXQubGFzdFNlZW5BdCkgT2JqZWN0LmFzc2lnbihwYXRjaCwgeyBzdGF0ZTogc291cmNlLnN0YXRlLCBsaXZlOiBzb3VyY2UubGl2ZSwgc3RhdGVTaW5jZTogc291cmNlLnN0YXRlU2luY2UgfSlcbiAgc3RvcmUudXBzZXJ0QWdlbnQodGFyZ2V0SWQsIE1hdGgubWF4KHNvdXJjZS5sYXN0U2VlbkF0LCB0YXJnZXQubGFzdFNlZW5BdCksIHBhdGNoLCAoKSA9PiB0YXJnZXQpXG4gIC8vIENoaWxkcmVuIChzdWJhZ2VudHMpIGZvbGxvdyB0aGVpciBwYXJlbnQuXG4gIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyhzdGF0ZS5hZ2VudHMpKSBpZiAoYWdlbnQucGFyZW50SWQgPT09IHNvdXJjZUlkKSBzdG9yZS51cHNlcnRBZ2VudChhZ2VudC5pZCwgYWdlbnQubGFzdFNlZW5BdCwgeyBwYXJlbnRJZDogdGFyZ2V0SWQgfSwgKCkgPT4gYWdlbnQpXG4gIHN0b3JlLnJlbW92ZUFnZW50KHNvdXJjZUlkKVxuICBpZGVudGl0eS51bmxpbmtBZ2VudChzb3VyY2VJZClcbiAgaWRlbnRpdHkubGluayh0YXJnZXRJZCwgeyB0ZXJtaW5hbElkOiBzb3VyY2UudGVybWluYWxJZCwgc2Vzc2lvbklkOiBzb3VyY2Uuc2Vzc2lvbklkLCBwYW5lS2V5OiBzb3VyY2UucGFuZUtleSB9KVxufVxuXG5jb25zdCByYW5rID0gKGFnZW50OiBBZ2VudFJlY29yZCkgPT4gKGFnZW50LmRpc3BhdGNoSWQgPyAzIDogYWdlbnQucm9sZSA9PT0gJ2xlYWQnID8gMiA6IDEpXG5cbi8qKlxuICogQWZ0ZXIgYW55IG9ic2VydmF0aW9uOiBpZiBhbm90aGVyIHJlY29yZCBuYW1lcyB0aGUgc2FtZSBhZ2VudCAoc2FtZSB0ZXJtaW5hbCwgc2Vzc2lvbiBvclxuICogc3RydWN0dXJlZC1zZXNzaW9uIHBhbmUpLCBmb2xkIHRoZSB3ZWFrZXIgb25lIGludG8gdGhlIHN0cm9uZ2VyIG9uZSAoZGlzcGF0Y2ggPiBsZWFkID4gcGxhaW4pLFxuICogc28gb25lIGFnZW50IGlzIG5ldmVyIGRyYXduIHR3aWNlIGFuZCBubyBvcnBoYW4gc3RheXMgXCJsaXZlXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWR1cGVBZ2VudChzdG9yZTogRmxvd1N0b3JlLCBpZGVudGl0eTogSWRlbnRpdHlJbmRleCwgYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYWdlbnQgPSBzdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50SWRdXG4gIGlmICghYWdlbnQgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgcmV0dXJuIGFnZW50SWRcbiAgbGV0IHN1cnZpdm9yID0gYWdlbnRcbiAgZm9yIChjb25zdCBvdGhlciBvZiBPYmplY3QudmFsdWVzKHN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgaWYgKG90aGVyLmlkID09PSBzdXJ2aXZvci5pZCB8fCBvdGhlci5yb2xlID09PSAnc3ViYWdlbnQnKSBjb250aW51ZVxuICAgIC8vIFR3byBkaWZmZXJlbnQgZGlzcGF0Y2hlcyBhcmUgdHdvIGF0dGVtcHRzLCBuZXZlciB0aGUgc2FtZSBhZ2VudC5cbiAgICBpZiAob3RoZXIuZGlzcGF0Y2hJZCAmJiBzdXJ2aXZvci5kaXNwYXRjaElkKSBjb250aW51ZVxuICAgIGNvbnN0IHNhbWUgPVxuICAgICAgKG90aGVyLnRlcm1pbmFsSWQgJiYgb3RoZXIudGVybWluYWxJZCA9PT0gc3Vydml2b3IudGVybWluYWxJZCkgfHxcbiAgICAgIChvdGhlci5zZXNzaW9uSWQgJiYgb3RoZXIuc2Vzc2lvbklkID09PSBzdXJ2aXZvci5zZXNzaW9uSWQpIHx8XG4gICAgICBzYW1lUGFuZUtleShvdGhlci5wYW5lS2V5LCBzdXJ2aXZvci5wYW5lS2V5KVxuICAgIGlmICghc2FtZSkgY29udGludWVcbiAgICBjb25zdCBrZWVwT3RoZXIgPSByYW5rKG90aGVyKSA+IHJhbmsoc3Vydml2b3IpIHx8IChyYW5rKG90aGVyKSA9PT0gcmFuayhzdXJ2aXZvcikgJiYgb3RoZXIubGFzdFNlZW5BdCA+IHN1cnZpdm9yLmxhc3RTZWVuQXQpXG4gICAgY29uc3QgW3RhcmdldCwgc291cmNlXSA9IGtlZXBPdGhlciA/IFtvdGhlciwgc3Vydml2b3JdIDogW3N1cnZpdm9yLCBvdGhlcl1cbiAgICBtZXJnZUFnZW50SW50byhzdG9yZSwgaWRlbnRpdHksIHRhcmdldC5pZCwgc291cmNlLmlkKVxuICAgIHN1cnZpdm9yID0gc3RvcmUucmVhZCgpLmFnZW50c1t0YXJnZXQuaWRdID8/IHRhcmdldFxuICB9XG4gIHJldHVybiBzdXJ2aXZvci5pZFxufVxuXG4vKiogTWVyZ2VzIGV2ZXJ5IG5vbi1kaXNwYXRjaCByZWNvcmQgdGhhdCBzaGFyZXMgYSBwYW5lL3Nlc3Npb24gd2l0aCBhIGRpc3BhdGNoIHJlY29yZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUR1cGxpY2F0ZXNPZihzdG9yZTogRmxvd1N0b3JlLCBpZGVudGl0eTogSWRlbnRpdHlJbmRleCwgZGlzcGF0Y2hBZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdGFyZ2V0ID0gc3RvcmUucmVhZCgpLmFnZW50c1tkaXNwYXRjaEFnZW50SWRdXG4gIGlmICghdGFyZ2V0Py5wYW5lS2V5KSByZXR1cm5cbiAgZm9yIChjb25zdCBhZ2VudCBvZiBPYmplY3QudmFsdWVzKHN0b3JlLnJlYWQoKS5hZ2VudHMpKSB7XG4gICAgaWYgKGFnZW50LmlkID09PSBkaXNwYXRjaEFnZW50SWQgfHwgYWdlbnQuZGlzcGF0Y2hJZCB8fCBhZ2VudC5yb2xlID09PSAnbGVhZCcgfHwgYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgY29udGludWVcbiAgICBpZiAoc2FtZVBhbmVLZXkoYWdlbnQucGFuZUtleSwgdGFyZ2V0LnBhbmVLZXkpKSBtZXJnZUFnZW50SW50byhzdG9yZSwgaWRlbnRpdHksIGRpc3BhdGNoQWdlbnRJZCwgYWdlbnQuaWQpXG4gIH1cbn1cbiIsICIvLyBMaXZlIGFnZW50cyBmcm9tIE9yY2EncyBob3N0IEFQSTogd29ya3NwYWNlLmxpc3QgKyBhZ2VudHMubGlzdCwgdGhlbiBhZ2VudC5zdGF0dXMuY2hhbmdlZC5cbmltcG9ydCB0eXBlIHsgQWdlbnRSdW50aW1lU3RhdGUsIFdvcmt0cmVlUmVjb3JkIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgbmV3QWdlbnQsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgeyBkZWR1cGVBZ2VudCB9IGZyb20gJy4uL3N0YXRlL21lcmdlLWFnZW50cy50cydcblxudHlwZSBIb3N0QWdlbnRSb3cgPSB7XG4gIHRlcm1pbmFsSWQ6IHN0cmluZyB8IG51bGxcbiAgdGl0bGU6IHN0cmluZyB8IG51bGxcbiAgYWdlbnQ6IHN0cmluZyB8IG51bGxcbiAgc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJ1xuICBzdGF0ZVN0YXJ0ZWRBdDogbnVtYmVyXG4gIHNlc3Npb25JZD86IHN0cmluZyB8IG51bGxcbiAgdGFzaz86IHsgdGl0bGU6IHN0cmluZyB9IHwgbnVsbFxufVxuXG50eXBlIFN0YXR1c0V2ZW50ID0ge1xuICB3b3Jrc3BhY2VJZDogc3RyaW5nIHwgbnVsbFxuICB3b3Jrc3BhY2VMaXN0SWQ/OiBzdHJpbmdcbiAgcGFuZUtleTogc3RyaW5nXG4gIHRlcm1pbmFsSWQ/OiBzdHJpbmdcbiAgdGl0bGU/OiBzdHJpbmdcbiAgc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJ1xuICByZWNlaXZlZEF0OiBudW1iZXJcbiAgbWFpbkFnZW50PzogeyBzdGF0ZTogc3RyaW5nOyBvdXRjb21lPzogc3RyaW5nOyBzdGF0ZVN0YXJ0ZWRBdDogbnVtYmVyIH1cbiAgc2Vzc2lvbklkPzogc3RyaW5nXG59XG5cbmNvbnN0IE1BWF9XT1JLU1BBQ0VTX1BFUl9TQ0FOID0gNDBcblxuZXhwb3J0IGNsYXNzIEFnZW50c0FkYXB0ZXIge1xuICBwcml2YXRlIHdvcmtzcGFjZUJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBXb3JrdHJlZVJlY29yZD4oKVxuICBwcml2YXRlIHNjYW5uaW5nID0gZmFsc2VcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICB3b3JrdHJlZUZvclBhdGgocGF0aDogc3RyaW5nIHwgbnVsbCk6IFdvcmt0cmVlUmVjb3JkIHwgbnVsbCB7XG4gICAgcmV0dXJuIHBhdGggPyB0aGlzLndvcmtzcGFjZUJ5UGF0aC5nZXQocGF0aCkgPz8gbnVsbCA6IG51bGxcbiAgfVxuXG4gIC8qKiBGdWxsIHJlLXNjYW46IGV2ZXJ5IHdvcmtzcGFjZSBhbmQgdGhlIGFnZW50cyBpbiB0aGUgYWN0aXZlIG9uZXMuICovXG4gIGFzeW5jIHNjYW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc2Nhbm5pbmcpIHJldHVyblxuICAgIHRoaXMuc2Nhbm5pbmcgPSB0cnVlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgaG9zdCB9ID0gdGhpcy5jdHgub3JjYVxuICAgICAgaWYgKCFob3N0Lmhhcygnd29ya3NwYWNlLmxpc3QnKSkgcmV0dXJuXG4gICAgICBjb25zdCBsaXN0ZWQgPSBhd2FpdCBob3N0LmNhbGwoJ3dvcmtzcGFjZS5saXN0JywgeyBpbmNsdWRlU3RhdHVzOiB0cnVlIH0pXG4gICAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIGxpc3RlZC53b3Jrc3BhY2VzKSB7XG4gICAgICAgIGNvbnN0IHJlY29yZDogV29ya3RyZWVSZWNvcmQgPSB7XG4gICAgICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgICAgICBuYW1lOiByb3cubmFtZSxcbiAgICAgICAgICBwYXRoOiByb3cucGF0aCxcbiAgICAgICAgICBicmFuY2g6IHJvdy5icmFuY2gsXG4gICAgICAgICAgcHJvamVjdDogcm93LnByb2plY3QgPz8gbnVsbCxcbiAgICAgICAgICBwcm9qZWN0SWQ6IHJvdy5wcm9qZWN0SWQgPz8gbnVsbCxcbiAgICAgICAgICBob3N0SWQ6IHJvdy5ob3N0SWQsXG4gICAgICAgICAga2luZDogcm93LmtpbmQsXG4gICAgICAgICAgc3RhdHVzOiByb3cuc3RhdHVzPy5zdGF0ZSA/PyBudWxsLFxuICAgICAgICAgIHRlcm1pbmFsQ291bnQ6IHJvdy5zdGF0dXM/LnRlcm1pbmFsQ291bnQgPz8gbnVsbCxcbiAgICAgICAgICBsYXN0QWN0aXZpdHlBdDogcm93LnN0YXR1cz8ubGFzdEFjdGl2aXR5QXQgPz8gbnVsbCxcbiAgICAgICAgICB2ZXJzaW9uOiAwXG4gICAgICAgIH1cbiAgICAgICAgc2Vlbi5hZGQocm93LmlkKVxuICAgICAgICB0aGlzLndvcmtzcGFjZUJ5UGF0aC5zZXQocm93LnBhdGgsIHJlY29yZClcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkud29ya3RyZWVzW3Jvdy5pZF1cbiAgICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnd29ya3RyZWUnLCBpZDogcm93LmlkLCB2YWx1ZTogeyAuLi5yZWNvcmQsIHZlcnNpb246IChwcmV2aW91cz8udmVyc2lvbiA/PyAwKSArIDEgfSB9KVxuICAgICAgICBpZiAoIXByZXZpb3VzKSB7XG4gICAgICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IHRzOiB0aGlzLmN0eC5ub3coKSwga2luZDogJ3dvcmt0cmVlLmNyZWF0ZWQnLCBzb3VyY2U6ICdob3N0LWNhbGwnLCBlbnRpdHlJZDogcm93LmlkLCBzdW1tYXJ5OiBgV29ya3RyZWUgJHtyb3cubmFtZX0gKCR7cm93LmJyYW5jaCA/PyAnbm8gYnJhbmNoJ30pYCB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGlkIG9mIE9iamVjdC5rZXlzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXMpKSB7XG4gICAgICAgIGlmICghc2Vlbi5oYXMoaWQpICYmICFsaXN0ZWQudHJ1bmNhdGVkKSB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICd3b3JrdHJlZScsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5zY2FuUHJvamVjdHMoKVxuICAgICAgYXdhaXQgdGhpcy5zY2FuQWdlbnRzKGxpc3RlZC53b3Jrc3BhY2VzKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGFnZW50cyBzY2FuIGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zY2FubmluZyA9IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqIE9yY2EncyBwcm9qZWN0cyAobmFtZSArIHJvb3QgcGF0aCkgZm9yIGdyb3VwaW5nIGFnZW50cyBpbnRvIHByb2plY3QgYm94ZXMuICovXG4gIHByaXZhdGUgYXN5bmMgc2NhblByb2plY3RzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgaG9zdCB9ID0gdGhpcy5jdHgub3JjYVxuICAgIGlmICghaG9zdC5oYXMoJ3Byb2plY3QubGlzdCcpKSByZXR1cm5cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBwcm9qZWN0cywgdHJ1bmNhdGVkIH0gPSBhd2FpdCBob3N0LmNhbGwoJ3Byb2plY3QubGlzdCcsIHt9KVxuICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICBmb3IgKGNvbnN0IHAgb2YgcHJvamVjdHMpIHtcbiAgICAgICAgc2Vlbi5hZGQocC5pZClcbiAgICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAncHJvamVjdCcsIGlkOiBwLmlkLCB2YWx1ZTogeyBpZDogcC5pZCwgbmFtZTogcC5uYW1lLCBwYXRoOiBwLnBhdGgsIGtpbmQ6IHAua2luZCwgaG9zdElkOiBwLmhvc3RJZCwgaGlkZGVuOiBwLmhpZGRlbiA9PT0gdHJ1ZSB9IH0pXG4gICAgICB9XG4gICAgICBpZiAoIXRydW5jYXRlZCkgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkucHJvamVjdHMgPz8ge30pKSBpZiAoIXNlZW4uaGFzKGlkKSkgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAncHJvamVjdCcsIGlkLCB2YWx1ZTogbnVsbCB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYHByb2plY3QubGlzdCBmYWlsZWQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuQWdlbnRzKHdvcmtzcGFjZXM6IHsgaWQ6IHN0cmluZzsgcGF0aDogc3RyaW5nOyBicmFuY2g6IHN0cmluZyB8IG51bGw7IHN0YXR1cz86IHsgc3RhdGU6IHN0cmluZzsgdGVybWluYWxDb3VudDogbnVtYmVyIH0gfVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBob3N0IH0gPSB0aGlzLmN0eC5vcmNhXG4gICAgaWYgKCFob3N0LmhhcygnYWdlbnRzLmxpc3QnKSkgcmV0dXJuXG4gICAgY29uc3QgcGVyV29ya3NwYWNlID0gKHRoaXMuY3R4Lm9yY2EuYXBpPy5taW5vciA/PyAwKSA+PSAxMFxuICAgIGNvbnN0IHRhcmdldHMgPSBwZXJXb3Jrc3BhY2VcbiAgICAgID8gd29ya3NwYWNlcy5maWx0ZXIoKHcpID0+ICh3LnN0YXR1cz8udGVybWluYWxDb3VudCA/PyAwKSA+IDAgfHwgKHcuc3RhdHVzICYmIHcuc3RhdHVzLnN0YXRlICE9PSAnaW5hY3RpdmUnKSkuc2xpY2UoMCwgTUFYX1dPUktTUEFDRVNfUEVSX1NDQU4pXG4gICAgICA6IFtdXG4gICAgY29uc3QgY2FsbHMgPSBwZXJXb3Jrc3BhY2UgPyB0YXJnZXRzLm1hcCgodykgPT4gKHsgd29ya3NwYWNlOiB3IGFzIHR5cGVvZiB3IHwgbnVsbCB9KSkgOiBbeyB3b3Jrc3BhY2U6IG51bGwgfV1cbiAgICBmb3IgKGNvbnN0IHsgd29ya3NwYWNlIH0gb2YgY2FsbHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIGB3b3Jrc3BhY2VJZGAgZXhpc3RzIGZyb20gaG9zdCBBUEkgMS4xMDsgb2xkZXIgT3JjYSBsaXN0cyB0aGUgZm9jdXNlZCB3b3Jrc3BhY2Ugb25seS5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9zdC5jYWxsKCdhZ2VudHMubGlzdCcsICh3b3Jrc3BhY2UgPyB7IHdvcmtzcGFjZUlkOiB3b3Jrc3BhY2UuaWQgfSA6IHt9KSBhcyBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pXG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdC5hZ2VudHMgYXMgSG9zdEFnZW50Um93W10pIHRoaXMuYXBwbHlSb3cocm93LCB3b3Jrc3BhY2UpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmN0eC5sb2coYGFnZW50cy5saXN0IGZhaWxlZCBmb3IgJHt3b3Jrc3BhY2U/LmlkID8/ICdmb2N1c2VkIHdvcmtzcGFjZSd9OiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlSb3cocm93OiBIb3N0QWdlbnRSb3csIHdvcmtzcGFjZTogeyBpZDogc3RyaW5nOyBwYXRoOiBzdHJpbmc7IGJyYW5jaDogc3RyaW5nIHwgbnVsbCB9IHwgbnVsbCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3QgZXhpc3RpbmdJZCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoeyB0ZXJtaW5hbElkOiByb3cudGVybWluYWxJZCwgc2Vzc2lvbklkOiByb3cuc2Vzc2lvbklkID8/IG51bGwgfSlcbiAgICBjb25zdCBpZCA9IGV4aXN0aW5nSWQgPz8gKHJvdy50ZXJtaW5hbElkID8gYHRlcm06JHtyb3cudGVybWluYWxJZH1gIDogcm93LnNlc3Npb25JZCA/IGBzZXNzaW9uOiR7cm93LnNlc3Npb25JZH1gIDogbnVsbClcbiAgICBpZiAoIWlkKSByZXR1cm5cbiAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbaWRdXG4gICAgY29uc3Qgc3RhdGUgPSBtYXBTdGF0ZShyb3cuc3RhdGUpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIHJvdy5zdGF0ZVN0YXJ0ZWRBdCB8fCBub3csXG4gICAgICB7XG4gICAgICAgIGFnZW50OiByb3cuYWdlbnQgPz8gdW5kZWZpbmVkLFxuICAgICAgICB0aXRsZTogcm93LnRpdGxlID8/IHVuZGVmaW5lZCxcbiAgICAgICAgdGVybWluYWxJZDogcm93LnRlcm1pbmFsSWQgPz8gdW5kZWZpbmVkLFxuICAgICAgICBzZXNzaW9uSWQ6IHJvdy5zZXNzaW9uSWQgPz8gdW5kZWZpbmVkLFxuICAgICAgICB3b3Jrc3BhY2VJZDogd29ya3NwYWNlPy5pZCxcbiAgICAgICAgd29ya3RyZWVQYXRoOiB3b3Jrc3BhY2U/LnBhdGgsXG4gICAgICAgIGJyYW5jaDogd29ya3NwYWNlPy5icmFuY2ggPz8gdW5kZWZpbmVkLFxuICAgICAgICBkZXNjcmlwdGlvbjogcm93LnRhc2s/LnRpdGxlID8/IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIHN0YXRlU2luY2U6IHJvdy5zdGF0ZVN0YXJ0ZWRBdCB8fCB1bmRlZmluZWQsXG4gICAgICAgIGxpdmU6IHN0YXRlICE9PSAnZG9uZScsXG4gICAgICAgIHN0YXJ0ZWRBdDogcHJldmlvdXM/LnN0YXJ0ZWRBdCA/PyByb3cuc3RhdGVTdGFydGVkQXQgPz8gbm93LFxuICAgICAgICBldmlkZW5jZTogWydob3N0LWNhbGwnXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnYWdlbnQnLCBub3cpXG4gICAgKVxuICAgIHRoaXMuY3R4LmlkZW50aXR5LmxpbmsoaWQsIHsgdGVybWluYWxJZDogcm93LnRlcm1pbmFsSWQsIHNlc3Npb25JZDogcm93LnNlc3Npb25JZCA/PyBudWxsIH0pXG4gICAgZGVkdXBlQWdlbnQodGhpcy5jdHguc3RvcmUsIHRoaXMuY3R4LmlkZW50aXR5LCBpZClcbiAgICBpZiAoIXByZXZpb3VzKSB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgdHM6IG5vdywga2luZDogJ2FnZW50LmNyZWF0ZWQnLCBzb3VyY2U6ICdob3N0LWNhbGwnLCBlbnRpdHlJZDogaWQsIHN1bW1hcnk6IGAke3Jvdy5hZ2VudCA/PyAnQWdlbnQnfSAke3Jvdy50aXRsZSA/PyAnJ30gZm91bmQgKCR7cm93LnN0YXRlfSlgLnRyaW0oKSB9KVxuICB9XG5cbiAgLyoqIGFnZW50LnN0YXR1cy5jaGFuZ2VkOiB0aGUgbW9zdCBwcmVjaXNlIGxpdmUgc2lnbmFsIE9yY2EgZ2l2ZXMuICovXG4gIG9uU3RhdHVzKGV2ZW50OiBTdGF0dXNFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3Qga2V5cyA9IHsgcGFuZUtleTogZXZlbnQucGFuZUtleSwgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCA/PyBudWxsLCBzZXNzaW9uSWQ6IGV2ZW50LnNlc3Npb25JZCA/PyBudWxsIH1cbiAgICBjb25zdCBpZCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoa2V5cykgPz8gKGV2ZW50LnRlcm1pbmFsSWQgPyBgdGVybToke2V2ZW50LnRlcm1pbmFsSWR9YCA6IGBwYW5lOiR7ZXZlbnQucGFuZUtleX1gKVxuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1tpZF1cbiAgICBjb25zdCBtYWluID0gZXZlbnQubWFpbkFnZW50XG4gICAgY29uc3Qgc3RhdGUgPSBtYXBTdGF0ZSgobWFpbj8uc3RhdGUgYXMgU3RhdHVzRXZlbnRbJ3N0YXRlJ10pID8/IGV2ZW50LnN0YXRlLCBtYWluPy5vdXRjb21lKVxuICAgIGNvbnN0IHdvcmtzcGFjZSA9IGV2ZW50LndvcmtzcGFjZUxpc3RJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXNbZXZlbnQud29ya3NwYWNlTGlzdElkXSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgaWQsXG4gICAgICBldmVudC5yZWNlaXZlZEF0IHx8IG5vdyxcbiAgICAgIHtcbiAgICAgICAgcGFuZUtleTogZXZlbnQucGFuZUtleSxcbiAgICAgICAgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBldmVudC5zZXNzaW9uSWQsXG4gICAgICAgIHRpdGxlOiBldmVudC50aXRsZSxcbiAgICAgICAgd29ya3NwYWNlSWQ6IGV2ZW50LndvcmtzcGFjZUxpc3RJZCA/PyBldmVudC53b3Jrc3BhY2VJZCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHdvcmt0cmVlUGF0aDogd29ya3NwYWNlPy5wYXRoLFxuICAgICAgICBicmFuY2g6IHdvcmtzcGFjZT8uYnJhbmNoID8/IHVuZGVmaW5lZCxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIG91dGNvbWU6IG1haW4/Lm91dGNvbWUgPz8gdW5kZWZpbmVkLFxuICAgICAgICBzdGF0ZVNpbmNlOiBtYWluPy5zdGF0ZVN0YXJ0ZWRBdCA/PyBldmVudC5yZWNlaXZlZEF0LFxuICAgICAgICBsaXZlOiBzdGF0ZSA9PT0gJ3dvcmtpbmcnIHx8IHN0YXRlID09PSAnYmxvY2tlZCcgfHwgc3RhdGUgPT09ICd3YWl0aW5nJyxcbiAgICAgICAgc3RhcnRlZEF0OiBwcmV2aW91cz8uc3RhcnRlZEF0ID8/IGV2ZW50LnJlY2VpdmVkQXQgPz8gbm93LFxuICAgICAgICBlbmRlZEF0OiBzdGF0ZSA9PT0gJ2RvbmUnIHx8IHN0YXRlID09PSAnZmFpbGVkJyA/IGV2ZW50LnJlY2VpdmVkQXQgOiBudWxsLFxuICAgICAgICBldmlkZW5jZTogWydob3N0LWV2ZW50J11cbiAgICAgIH0sXG4gICAgICAoKSA9PiBuZXdBZ2VudChpZCwgJ2FnZW50Jywgbm93KVxuICAgIClcbiAgICB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCBrZXlzKVxuICAgIGRlZHVwZUFnZW50KHRoaXMuY3R4LnN0b3JlLCB0aGlzLmN0eC5pZGVudGl0eSwgaWQpXG4gICAgaWYgKCFwcmV2aW91cyB8fCBwcmV2aW91cy5zdGF0ZSAhPT0gcmVjb3JkLnN0YXRlKSB7XG4gICAgICBjb25zdCBraW5kID0gIXByZXZpb3VzID8gJ2FnZW50LnN0YXJ0ZWQnIDogc3RhdGUgPT09ICdmYWlsZWQnID8gJ2FnZW50LmZhaWxlZCcgOiBzdGF0ZSA9PT0gJ2RvbmUnID8gJ2FnZW50LmNvbXBsZXRlZCcgOiAnYWdlbnQuc3RhdHVzX2NoYW5nZWQnXG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHtcbiAgICAgICAgdHM6IGV2ZW50LnJlY2VpdmVkQXQgfHwgbm93LFxuICAgICAgICBraW5kLFxuICAgICAgICBzb3VyY2U6ICdob3N0LWV2ZW50JyxcbiAgICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgICBydW5JZDogcmVjb3JkLnJ1bklkLFxuICAgICAgICBzdW1tYXJ5OiBgJHtyZWNvcmQudGl0bGUgPz8gcmVjb3JkLmFnZW50ID8/ICdBZ2VudCd9OiAke3ByZXZpb3VzPy5zdGF0ZSA/PyAnbmV3J30gXHUyMTkyICR7c3RhdGV9JHttYWluPy5vdXRjb21lID8gYCAoJHttYWluLm91dGNvbWV9KWAgOiAnJ31gXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFwU3RhdGUoc3RhdGU6ICd3b3JraW5nJyB8ICdibG9ja2VkJyB8ICd3YWl0aW5nJyB8ICdkb25lJywgb3V0Y29tZT86IHN0cmluZyk6IEFnZW50UnVudGltZVN0YXRlIHtcbiAgaWYgKHN0YXRlID09PSAnZG9uZScgJiYgb3V0Y29tZSAmJiAob3V0Y29tZSA9PT0gJ2ZhaWx1cmUnIHx8IG91dGNvbWUgPT09ICdpbnRlcnJ1cHRpb24nKSkgcmV0dXJuICdmYWlsZWQnXG4gIHJldHVybiBzdGF0ZVxufVxuIiwgIi8vIFJlbW92ZXMgc2VjcmV0cyBmcm9tIGFueSB0ZXh0IGJlZm9yZSBpdCByZWFjaGVzIGEgVUksIHRoZSBkYXNoYm9hcmQgb3IgaGlzdG9yeS5cblxuY29uc3QgUkVEQUNURUQgPSAnW3JlZGFjdGVkXSdcblxuLyoqIFdlbGwta25vd24gdG9rZW4gc2hhcGVzLCByZXBsYWNlZCB3aGVyZXZlciB0aGV5IGFwcGVhci4gT3JkZXIgbWF0dGVycy4gKi9cbmNvbnN0IFBBVFRFUk5TOiBbUmVnRXhwLCBzdHJpbmddW10gPSBbXG4gIFsvLS0tLS1CRUdJTiBbQS1aIF0qUFJJVkFURSBLRVktLS0tLVtcXHNcXFNdKj8tLS0tLUVORCBbQS1aIF0qUFJJVkFURSBLRVktLS0tLS9nLCAnW3JlZGFjdGVkLXByaXZhdGUta2V5XSddLFxuICAvLyBCZWFyZXIgYmVmb3JlIHRoZSBrZXk9dmFsdWUgcnVsZXM6IHRoZXkgd291bGQgb3RoZXJ3aXNlIGVhdCB0aGUgd29yZCBcIkJlYXJlclwiLlxuICBbLyhCZWFyZXJcXHMrKVtBLVphLXowLTkuX34rLy1dezEyLH09Ki9nLCAnJDFbcmVkYWN0ZWRdJ10sXG4gIFsvXFxiKHNrLWFudC1bQS1aYS16MC05Xy1dezEwLH0pL2csICdbcmVkYWN0ZWQta2V5XSddLFxuICBbL1xcYihzay1bQS1aYS16MC05Xy1dezIwLH0pL2csICdbcmVkYWN0ZWQta2V5XSddLFxuICBbL1xcYihnaFtwb3Vzcl1fW0EtWmEtejAtOV17MjAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoZ2l0aHViX3BhdF9bQS1aYS16MC05X117MjAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoeG94W2FicHJzXS1bQS1aYS16MC05LV17MTAsfSkvZywgJ1tyZWRhY3RlZC10b2tlbl0nXSxcbiAgWy9cXGIoQUtJQVswLTlBLVpdezE2fSlcXGIvZywgJ1tyZWRhY3RlZC1hd3Mta2V5XSddLFxuICBbL1xcYihBSXphWzAtOUEtWmEtel8tXXszMCx9KS9nLCAnW3JlZGFjdGVkLWtleV0nXSxcbiAgWy9cXGIoZXlKW0EtWmEtejAtOV8tXXsxMCx9XFwuW0EtWmEtejAtOV8tXXsxMCx9XFwuW0EtWmEtejAtOV8tXXsxMCx9KS9nLCAnW3JlZGFjdGVkLWp3dF0nXSxcbiAgLy8gVVJMIGNyZWRlbnRpYWxzOiBrZWVwIHRoZSB1c2VyIG5hbWUsIGhpZGUgdGhlIHBhc3N3b3JkLlxuICBbL1xcYihbYS16XVthLXowLTkrLi1dKjpcXC9cXC9bXlxcczovQD8jXSs6KVteXFxzQC8/I10rQC9naSwgYCQxJHtSRURBQ1RFRH1AYF1cbl1cblxuLy8gXHUyNTAwXHUyNTAwIFNlbnNpdGl2ZSBrZXkgbmFtZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbi8qKiBBbnkgb2YgdGhlc2Ugd29yZCBzZWdtZW50cyBtYWtlcyBhIGtleSBzZW5zaXRpdmUgKGBjbGllbnRfc2VjcmV0YCwgYGRiUGFzc3dvcmRgKS4gKi9cbmNvbnN0IFNUUk9OR19TRUdNRU5UUyA9IG5ldyBTZXQoWydwYXNzd29yZCcsICdwYXNzd2QnLCAncGFzc3BocmFzZScsICdzZWNyZXQnLCAnY3JlZGVudGlhbCcsICdjcmVkZW50aWFscycsICdhdXRob3JpemF0aW9uJywgJ2FwaWtleScsICdwcml2YXRla2V5J10pXG4vKiogYGtleWAgYXMgdGhlIGxhc3Qgc2VnbWVudCBpcyBzZW5zaXRpdmUgb25seSBhZnRlciBvbmUgb2YgdGhlc2UgKGBhcGlfa2V5YCwgYHByaXZhdGVLZXlgKSBvciBpbiBhbiBVUFBFUl9DQVNFIGVudiBuYW1lLiAqL1xuY29uc3QgS0VZX1BSRUZJWEVTID0gbmV3IFNldChbJ2FwaScsICdhY2Nlc3MnLCAncHJpdmF0ZScsICdzZWNyZXQnLCAnYXV0aCcsICdzaWduaW5nJywgJ2VuY3J5cHRpb24nLCAnbWFzdGVyJywgJ2NsaWVudCcsICdsaWNlbnNlJywgJ3Nlc3Npb24nXSlcblxuZnVuY3Rpb24gc2VnbWVudHMoa2V5OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBrZXlcbiAgICAuc3BsaXQoL1tfLi1dKy8pXG4gICAgLmZsYXRNYXAoKHBhcnQpID0+IHBhcnQucmVwbGFjZSgvKFthLXowLTldKShbQS1aXSkvZywgJyQxICQyJykuc3BsaXQoJyAnKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLm1hcCgoc2VnKSA9PiBzZWcudG9Mb3dlckNhc2UoKSlcbn1cblxuLyoqIFRydWUgZm9yIG5hbWVzIGxpa2UgYHBhc3N3b3JkYCwgYEdJVEhVQl9UT0tFTmAsIGBBV1NfU0VDUkVUX0FDQ0VTU19LRVlgLCBgYXBpLWtleWAsIGBhY2Nlc3NUb2tlbmA7IGZhbHNlIGZvciBga2V5Ym9hcmRgLCBgdG9rZW5fY291bnRgLCBgbWF4X3Rva2Vuc2AuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTZW5zaXRpdmVLZXkoa2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgc2VncyA9IHNlZ21lbnRzKGtleSlcbiAgaWYgKHNlZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgaWYgKHNlZ3Muc29tZSgoc2VnKSA9PiBTVFJPTkdfU0VHTUVOVFMuaGFzKHNlZykpKSByZXR1cm4gdHJ1ZVxuICBjb25zdCB1cHBlciA9IC9bQS1aXS8udGVzdChrZXkpICYmIGtleSA9PT0ga2V5LnRvVXBwZXJDYXNlKClcbiAgY29uc3QgbGFzdCA9IHNlZ3Nbc2Vncy5sZW5ndGggLSAxXVxuICBpZiAobGFzdCA9PT0gJ3Rva2VuJykgcmV0dXJuIHRydWVcbiAgaWYgKGxhc3QgPT09ICdrZXknKSByZXR1cm4gdXBwZXIgfHwgKHNlZ3MubGVuZ3RoID4gMSAmJiBLRVlfUFJFRklYRVMuaGFzKHNlZ3Nbc2Vncy5sZW5ndGggLSAyXSkpXG4gIGlmIChsYXN0ID09PSAncGFzcycpIHJldHVybiB1cHBlclxuICByZXR1cm4gZmFsc2Vcbn1cblxuZnVuY3Rpb24gYWxyZWFkeVJlZGFjdGVkKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ1tyZWRhY3RlZCcpXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBLZXkvdmFsdWUgcnVsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbmNvbnN0IEtFWSA9IFN0cmluZy5yYXdgW0EtWmEtel1bQS1aYS16MC05Xy4tXSpgXG5jb25zdCBEUSA9IFN0cmluZy5yYXdgXCIoKD86XFxcXC58W15cIlxcXFxcXG5dKSopXCJgXG5jb25zdCBTUSA9IFN0cmluZy5yYXdgJygoPzpcXFxcLnxbXidcXFxcXFxuXSkqKSdgXG5cbnR5cGUgSGFuZGxlciA9IChncm91cHM6IChzdHJpbmcgfCB1bmRlZmluZWQpW10pID0+IHN0cmluZyB8IG51bGxcblxuLyoqXG4gKiBMaWtlIFN0cmluZy5yZXBsYWNlLCBidXQgd2hlbiB0aGUgaGFuZGxlciBkZWNsaW5lcyAocmV0dXJucyBudWxsKSB0aGUgc2NhbiByZXN1bWVzIG9uZSBjaGFyYWN0ZXJcbiAqIGxhdGVyIGluc3RlYWQgb2YgYWZ0ZXIgdGhlIHdob2xlIG1hdGNoLCBzbyBhIG5vbi1zZWNyZXQgdmFsdWUgY2FuIG5ldmVyIHN3YWxsb3cgYSBmb2xsb3dpbmdcbiAqIGB0b2tlbj1cdTIwMjZgIChgYT1iLHRva2VuPVx1MjAyNmAsIGBodHRwczovL3gvP3Rva2VuPVx1MjAyNmApLlxuICovXG5mdW5jdGlvbiByZXBsYWNlRWFjaCh0ZXh0OiBzdHJpbmcsIHBhdHRlcm46IFJlZ0V4cCwgaGFuZGxlcjogSGFuZGxlcik6IHN0cmluZyB7XG4gIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChwYXR0ZXJuLnNvdXJjZSwgcGF0dGVybi5mbGFncy5pbmNsdWRlcygnZycpID8gcGF0dGVybi5mbGFncyA6IHBhdHRlcm4uZmxhZ3MgKyAnZycpXG4gIGxldCBvdXQgPSAnJ1xuICBsZXQgY29waWVkID0gMFxuICBsZXQgbTogUmVnRXhwRXhlY0FycmF5IHwgbnVsbFxuICB3aGlsZSAoKG0gPSByZS5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IHJlcGxhY2VtZW50ID0gaGFuZGxlcihtLnNsaWNlKDEpKVxuICAgIGlmIChyZXBsYWNlbWVudCA9PT0gbnVsbCkge1xuICAgICAgcmUubGFzdEluZGV4ID0gbS5pbmRleCArIDFcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICAgIG91dCArPSB0ZXh0LnNsaWNlKGNvcGllZCwgbS5pbmRleCkgKyByZXBsYWNlbWVudFxuICAgIGNvcGllZCA9IG0uaW5kZXggKyBtWzBdLmxlbmd0aFxuICAgIHJlLmxhc3RJbmRleCA9IGNvcGllZFxuICB9XG4gIHJldHVybiBvdXQgKyB0ZXh0LnNsaWNlKGNvcGllZClcbn1cblxuLyoqIGBcInBhc3N3b3JkXCI6IFwiXHUyMDI2XCJgIC8gYCdhcGlfa2V5JzogJ1x1MjAyNidgIChKU09OLCBQeXRob24gZGljdHMpLiBRdW90ZXMgYXJlIGtlcHQgc28gSlNPTiBzdGF5cyB2YWxpZC4gKi9cbmNvbnN0IFFVT1RFRF9LRVkgPSBuZXcgUmVnRXhwKFN0cmluZy5yYXdgKFtcIiddKSgke0tFWX0pXFwxKFxccyo6XFxzKikoPzoke0RRfXwke1NRfSlgLCAnZycpXG5cbmZ1bmN0aW9uIHJlZGFjdFF1b3RlZEtleXModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJlcGxhY2VFYWNoKHRleHQsIFFVT1RFRF9LRVksIChbcSwga2V5LCBzZXAsIGRxLCBzcV0pID0+IHtcbiAgICBjb25zdCB2YWx1ZSA9IGRxID8/IHNxID8/ICcnXG4gICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpIHx8ICFpc1NlbnNpdGl2ZUtleShrZXkhKSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB2cSA9IGRxICE9PSB1bmRlZmluZWQgPyAnXCInIDogXCInXCJcbiAgICByZXR1cm4gYCR7cX0ke2tleX0ke3F9JHtzZXB9JHt2cX0ke1JFREFDVEVEfSR7dnF9YFxuICB9KVxufVxuXG4vKiogYC0tcGFzc3dvcmQgeGAsIGAtLWFwaS1rZXk9eGAsIGAtLXRva2VuIFwiYSBiXCJgLiAqL1xuY29uc3QgQ0xJX0ZMQUcgPSBuZXcgUmVnRXhwKFN0cmluZy5yYXdgKD88IVtcXHctXSkoLS0oJHtLRVl9KSkoPXxbIFxcdF0rKSg/OiR7RFF9fCR7U1F9fChbXlxcc1wiJy1dW15cXHNcIiddKikpYCwgJ2cnKVxuXG5mdW5jdGlvbiByZWRhY3RDbGlGbGFncyh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcmVwbGFjZUVhY2godGV4dCwgQ0xJX0ZMQUcsIChbZmxhZywgbmFtZSwgc2VwLCBkcSwgc3EsIGJhcmVdKSA9PiB7XG4gICAgY29uc3QgdmFsdWUgPSBkcSA/PyBzcSA/PyBiYXJlID8/ICcnXG4gICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpIHx8ICFpc1NlbnNpdGl2ZUtleShuYW1lISkpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGAke2ZsYWd9JHtzZXB9JHtSRURBQ1RFRH1gXG4gIH0pXG59XG5cbi8qKiBgcGFzc3dvcmQ9XHUyMDI2YCwgYHNlY3JldDogXCJhIGIgY1wiYCwgYGV4cG9ydCBPUEVOQUlfQVBJX0tFWT1cIlx1MjAyNlwiYCwgYD90b2tlbj1cdTIwMjZgLiAqL1xuY29uc3QgQVNTSUdOTUVOVCA9IG5ldyBSZWdFeHAoU3RyaW5nLnJhd2AoPzwhW1xcdy4tXSkoJHtLRVl9KShcXHMqWzo9XVxccyopKD86JHtEUX18JHtTUX18KFteXFxzXCInJl0rKSlgLCAnZycpXG5jb25zdCBNSU5fQkFSRV9WQUxVRSA9IDZcblxuZnVuY3Rpb24gcmVkYWN0QXNzaWdubWVudHModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJlcGxhY2VFYWNoKHRleHQsIEFTU0lHTk1FTlQsIChba2V5LCBzZXAsIGRxLCBzcSwgYmFyZV0pID0+IHtcbiAgICBpZiAoIWlzU2Vuc2l0aXZlS2V5KGtleSEpKSByZXR1cm4gbnVsbFxuICAgIGlmIChiYXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFNob3J0IGJhcmUgdmFsdWVzIGFyZSB1c3VhbGx5IHByb3NlIChcInBhc3N3b3JkOiB5ZXNcIik7IGF1dGggc2NoZW1lcyBrZWVwIHRoZWlyIG93biBydWxlLlxuICAgICAgaWYgKGJhcmUubGVuZ3RoIDwgTUlOX0JBUkVfVkFMVUUgfHwgYWxyZWFkeVJlZGFjdGVkKGJhcmUpIHx8IC9eKEJlYXJlcnxCYXNpYykkL2kudGVzdChiYXJlKSkgcmV0dXJuIG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgdmFsdWUgPSBkcSA/PyBzcSA/PyAnJ1xuICAgICAgaWYgKCF2YWx1ZSB8fCBhbHJlYWR5UmVkYWN0ZWQodmFsdWUpKSByZXR1cm4gbnVsbFxuICAgIH1cbiAgICByZXR1cm4gYCR7a2V5fSR7c2VwfSR7UkVEQUNURUR9YFxuICB9KVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgUHVibGljIEFQSSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gdGV4dFxuICBmb3IgKGNvbnN0IFtwYXR0ZXJuLCByZXBsYWNlbWVudF0gb2YgUEFUVEVSTlMpIG91dCA9IG91dC5yZXBsYWNlKHBhdHRlcm4sIHJlcGxhY2VtZW50KVxuICBvdXQgPSByZWRhY3RRdW90ZWRLZXlzKG91dClcbiAgb3V0ID0gcmVkYWN0Q2xpRmxhZ3Mob3V0KVxuICBvdXQgPSByZWRhY3RBc3NpZ25tZW50cyhvdXQpXG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdE51bGxhYmxlKHRleHQ6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHRleHQgPT0gbnVsbCA/IG51bGwgOiByZWRhY3QodGV4dClcbn1cblxuLyoqIFJlZGFjdHMgZmlyc3QsIHRoZW4gdHJ1bmNhdGVzLCBzbyBhIGN1dCBjYW4gbmV2ZXIgbGVhdmUgYSBwYXJ0aWFsIHNlY3JldCBiZWhpbmQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkYWN0QW5kVHJ1bmNhdGUodGV4dDogc3RyaW5nLCBtYXg6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiB0cnVuY2F0ZShyZWRhY3QodGV4dCksIG1heClcbn1cblxuLyoqIFJlZGFjdHMgbGluZXMgYXMgb25lIHRleHQsIHNvIHNlY3JldHMgdGhhdCBzcGFuIGxpbmVzIChwcml2YXRlIGtleSBibG9ja3MpIGFyZSBjYXVnaHQuICovXG5leHBvcnQgZnVuY3Rpb24gcmVkYWN0TGluZXMobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cbiAgcmV0dXJuIHJlZGFjdChsaW5lcy5qb2luKCdcXG4nKSkuc3BsaXQoJ1xcbicpXG59XG5cbi8qKiBTdHJpcHMgQU5TSS9PU0MgZXNjYXBlIHNlcXVlbmNlcyBmcm9tIHRlcm1pbmFsIG91dHB1dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcEFuc2kodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnRyb2wtcmVnZXhcbiAgcmV0dXJuIHRleHQucmVwbGFjZSgvXFx1MDAxYlxcXVteXFx1MDAwN1xcdTAwMWJdKihcXHUwMDA3fFxcdTAwMWJcXFxcKS9nLCAnJykucmVwbGFjZSgvXFx1MDAxYlxcW1swLTk7P10qWyAtL10qW0Atfl0vZywgJycpLnJlcGxhY2UoL1xcdTAwMWJbQC1aXFxcXC1fNzg9Pl0vZywgJycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZSh0ZXh0OiBzdHJpbmcsIG1heDogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHQubGVuZ3RoIDw9IG1heCA/IHRleHQgOiB0ZXh0LnNsaWNlKDAsIG1heCAtIDEpICsgJ1x1MjAyNidcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFRhc2tLaW5kLCBUYXNrU3RhdGUgfSBmcm9tICcuL21vZGVsLnRzJ1xuXG4vKiogQWxsb3dlZCBsaWZlY3ljbGUgdHJhbnNpdGlvbnMuIEFueXRoaW5nIGVsc2UgaXMgcmVqZWN0ZWQgYnkgdGhlIHN0b3JlIGFuZCBieSBjb21tYW5kcy4gKi9cbmV4cG9ydCBjb25zdCBUQVNLX1RSQU5TSVRJT05TOiBSZWNvcmQ8VGFza1N0YXRlLCByZWFkb25seSBUYXNrU3RhdGVbXT4gPSB7XG4gIFBFTkRJTkc6IFsnUkVBRFknLCAnUlVOTklORycsICdCTE9DS0VEJywgJ0NBTkNFTExFRCcsICdGQUlMRUQnXSxcbiAgUkVBRFk6IFsnUlVOTklORycsICdCTE9DS0VEJywgJ0NBTkNFTExFRCcsICdQRU5ESU5HJywgJ0ZBSUxFRCddLFxuICBSVU5OSU5HOiBbJ1JFVklFVycsICdURVNUSU5HJywgJ0FQUFJPVkVEJywgJ0RPTkUnLCAnRkFJTEVEJywgJ0JMT0NLRUQnLCAnQ0FOQ0VMTEVEJ10sXG4gIFJFVklFVzogWydURVNUSU5HJywgJ0FQUFJPVkVEJywgJ1JVTk5JTkcnLCAnRkFJTEVEJywgJ0RPTkUnLCAnQ0FOQ0VMTEVEJ10sXG4gIFRFU1RJTkc6IFsnQVBQUk9WRUQnLCAnUlVOTklORycsICdGQUlMRUQnLCAnRE9ORScsICdDQU5DRUxMRUQnXSxcbiAgQVBQUk9WRUQ6IFsnTUVSR0VEJywgJ0RPTkUnLCAnRkFJTEVEJ10sXG4gIE1FUkdFRDogWydET05FJ10sXG4gIERPTkU6IFsnUkVUUllJTkcnXSxcbiAgQkxPQ0tFRDogWydSRUFEWScsICdSVU5OSU5HJywgJ1BFTkRJTkcnLCAnQ0FOQ0VMTEVEJywgJ0ZBSUxFRCddLFxuICBGQUlMRUQ6IFsnUkVUUllJTkcnLCAnQ0FOQ0VMTEVEJ10sXG4gIFJFVFJZSU5HOiBbJ1JVTk5JTkcnLCAnRkFJTEVEJywgJ0NBTkNFTExFRCcsICdSRUFEWSddLFxuICBDQU5DRUxMRUQ6IFsnUkVUUllJTkcnXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FuVHJhbnNpdGlvbihmcm9tOiBUYXNrU3RhdGUsIHRvOiBUYXNrU3RhdGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZyb20gPT09IHRvIHx8IFRBU0tfVFJBTlNJVElPTlNbZnJvbV0uaW5jbHVkZXModG8pXG59XG5cbmV4cG9ydCBjb25zdCBURVJNSU5BTF9UQVNLX1NUQVRFUzogcmVhZG9ubHkgVGFza1N0YXRlW10gPSBbJ0RPTkUnLCAnTUVSR0VEJywgJ0NBTkNFTExFRCcsICdGQUlMRUQnXVxuXG4vKipcbiAqIE1hcHMgT3JjYSdzIHJhdyB0YXNrIHN0YXR1cyAoKyBsaXZlIGRpc3BhdGNoIGluZm8pIG9udG8gdGhlIEFnZW50IEZsb3cgbGlmZWN5Y2xlLlxuICogT3JjYSBzdGF0dXNlczogcGVuZGluZywgcmVhZHksIGRpc3BhdGNoZWQsIGNvbXBsZXRlZCwgZmFpbGVkLCBibG9ja2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFwT3JjYVRhc2tTdGF0dXMoaW5wdXQ6IHtcbiAgb3JjYVN0YXR1czogc3RyaW5nXG4gIGtpbmQ6IFRhc2tLaW5kXG4gIHJlc3VsdE91dGNvbWU6IHN0cmluZyB8IG51bGxcbiAgaGFzT3BlbkdhdGU6IGJvb2xlYW5cbiAgcmV0cnlDb3VudDogbnVtYmVyXG4gIGRpc3BhdGNoQWN0aXZlOiBib29sZWFuXG59KTogVGFza1N0YXRlIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQub3JjYVN0YXR1cy50b0xvd2VyQ2FzZSgpXG4gIGlmIChpbnB1dC5oYXNPcGVuR2F0ZSAmJiBzdGF0dXMgIT09ICdjb21wbGV0ZWQnICYmIHN0YXR1cyAhPT0gJ2ZhaWxlZCcpIHJldHVybiAnQkxPQ0tFRCdcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdwZW5kaW5nJzpcbiAgICAgIHJldHVybiAnUEVORElORydcbiAgICBjYXNlICdyZWFkeSc6XG4gICAgICByZXR1cm4gaW5wdXQucmV0cnlDb3VudCA+IDAgPyAnUkVUUllJTkcnIDogJ1JFQURZJ1xuICAgIGNhc2UgJ2Rpc3BhdGNoZWQnOlxuICAgICAgaWYgKCFpbnB1dC5kaXNwYXRjaEFjdGl2ZSAmJiBpbnB1dC5yZXRyeUNvdW50ID4gMCkgcmV0dXJuICdSRVRSWUlORydcbiAgICAgIGlmIChpbnB1dC5raW5kID09PSAncmV2aWV3JykgcmV0dXJuICdSRVZJRVcnXG4gICAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3Rlc3QnKSByZXR1cm4gJ1RFU1RJTkcnXG4gICAgICByZXR1cm4gJ1JVTk5JTkcnXG4gICAgY2FzZSAnY29tcGxldGVkJzoge1xuICAgICAgY29uc3Qgb3V0Y29tZSA9IChpbnB1dC5yZXN1bHRPdXRjb21lID8/ICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICBpZiAob3V0Y29tZSA9PT0gJ2NhbmNlbGxlZCcgfHwgb3V0Y29tZSA9PT0gJ2NhbmNlbGxhdGlvbicpIHJldHVybiAnQ0FOQ0VMTEVEJ1xuICAgICAgaWYgKG91dGNvbWUgPT09ICdmYWlsZWQnIHx8IG91dGNvbWUgPT09ICdmYWlsdXJlJykgcmV0dXJuICdGQUlMRUQnXG4gICAgICBpZiAoaW5wdXQua2luZCA9PT0gJ21lcmdlJykgcmV0dXJuICdNRVJHRUQnXG4gICAgICByZXR1cm4gJ0RPTkUnXG4gICAgfVxuICAgIGNhc2UgJ2ZhaWxlZCc6IHtcbiAgICAgIGNvbnN0IG91dGNvbWUgPSAoaW5wdXQucmVzdWx0T3V0Y29tZSA/PyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgcmV0dXJuIG91dGNvbWUuaW5jbHVkZXMoJ2NhbmNlbCcpID8gJ0NBTkNFTExFRCcgOiAnRkFJTEVEJ1xuICAgIH1cbiAgICBjYXNlICdibG9ja2VkJzpcbiAgICAgIHJldHVybiAnQkxPQ0tFRCdcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICdQRU5ESU5HJ1xuICB9XG59XG5cbmNvbnN0IEtJTkRfUEFUVEVSTlM6IFtUYXNrS2luZCwgUmVnRXhwXVtdID0gW1xuICBbJ21lcmdlJywgL1xcYihtZXJnZXxpbnRlZ3JhdChlfGlvbil8ZGVsaXZlcilcXGIvaV0sXG4gIC8vIFwidGVzdFwiIGFsb25lIGlzIHRvbyBjb21tb24gaW4gdGl0bGVzIChcIkFGIHRlc3Q6IFx1MjAyNlwiKTsgcmVxdWlyZSBhIHRlc3RpbmcgcGhyYXNlLlxuICBbJ3Rlc3QnLCAvXFxiKHRlc3RzfHRlc3Rpbmd8cWF8ZTJlfHZlcmlmeXx2ZXJpZmljYXRpb258dmFsaWRhdGlvbilcXGJ8XFxiKHJ1bnx3cml0ZXxhZGR8Zml4fHVuaXR8aW50ZWdyYXRpb258c21va2UpXFxzK3Rlc3RzP1xcYi9pXSxcbiAgWydyZXZpZXcnLCAvXFxiKHJldmlld3xhdWRpdHxpbnNwZWN0fGFwcHJvdmUpXFxiL2ldLFxuICBbJ3BsYW4nLCAvXFxiKHBsYW58cGxhbm5pbmd8ZGVzaWdufGFyY2hpdGVjdHVyZXxhbmFseVtzel1lKVxcYi9pXVxuXVxuXG4vKiogVGl0bGUtYmFzZWQgaW5mZXJlbmNlOyB0aGUgaW5zcGVjdG9yIG1hcmtzIHRoZSBraW5kIGFzIGluZmVycmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluZmVyVGFza0tpbmQodGl0bGU6IHN0cmluZyk6IFRhc2tLaW5kIHtcbiAgZm9yIChjb25zdCBba2luZCwgcGF0dGVybl0gb2YgS0lORF9QQVRURVJOUykgaWYgKHBhdHRlcm4udGVzdCh0aXRsZSkpIHJldHVybiBraW5kXG4gIHJldHVybiAndGFzaydcbn1cbiIsICIvLyBPcmNoZXN0cmF0aW9uIHJ1bnMsIHRhc2tzLCBkaXNwYXRjaGVkIHdvcmtlcnMsIG1lc3NhZ2VzIGFuZCBnYXRlcyBmcm9tIHRoZSBkb2N1bWVudGVkXG4vLyBgb3JjYSBvcmNoZXN0cmF0aW9uIFx1MjAyNiAtLWpzb25gIGNvbW1hbmRzLiBQb2xsZWQgYWRhcHRpdmVseTsgZXZlcnkgcmVjb3JkIGtlZXBzIGl0cyBzb3VyY2UuXG5pbXBvcnQgdHlwZSB7IEZsb3dFdmVudEtpbmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvZXZlbnRzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJ1bnRpbWVTdGF0ZSwgR2F0ZVJlY29yZCwgTWVzc2FnZVJlY29yZCwgUnVuUmVjb3JkLCBUYXNrUmVjb3JkLCBUYXNrU3RhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgeyByZWRhY3QsIHJlZGFjdE51bGxhYmxlLCB0cnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5pbXBvcnQgeyBpbmZlclRhc2tLaW5kLCBtYXBPcmNhVGFza1N0YXR1cywgVEVSTUlOQUxfVEFTS19TVEFURVMgfSBmcm9tICcuLi8uLi9zaGFyZWQvdGFzay1zdGF0ZXMudHMnXG5pbXBvcnQgeyBuZXdBZ2VudCwgcGFyc2VUaW1lLCBzdHIsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5pbXBvcnQgeyBkZWR1cGVBZ2VudCwgbWVyZ2VEdXBsaWNhdGVzT2YgfSBmcm9tICcuLi9zdGF0ZS9tZXJnZS1hZ2VudHMudHMnXG5cbnR5cGUgUmF3VGFzayA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBpZDogc3RyaW5nIH1cbnR5cGUgUmF3V29ya2VyUm93ID0geyBkaXNwYXRjaElkOiBzdHJpbmc7IHRhc2tJZDogc3RyaW5nOyBzdGF0ZTogc3RyaW5nOyBsaXZlbmVzcz86IHN0cmluZzsgdGVybWluYWw/OiBzdHJpbmc7IHdvcmtzcGFjZT86IHN0cmluZzsgaG9zdD86IHN0cmluZyB9XG50eXBlIFJhd01lc3NhZ2UgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHsgaWQ6IHN0cmluZyB9XG5cbmNvbnN0IFNUT1BQRURfU1RBVEVTID0gbmV3IFNldChbJ3N0b3BwZWQnLCAnYWJhbmRvbmVkJywgJ2ZlbmNlZCcsICdjYW5jZWxsZWQnXSlcbmNvbnN0IE1BWF9SVU5TID0gMjVcbmNvbnN0IE1BWF9ERVRBSUxfUEVSX0NZQ0xFID0gMTBcbmNvbnN0IE1BWF9XT1JLRVJfUEFHRVMgPSAzXG4vKiogTGl2ZSBzdGF0ZSBjYXJyaWVzIHByZXZpZXdzIG9ubHk7IGZ1bGwgdGV4dCBpcyBmZXRjaGVkIG9uIGRlbWFuZCAocGFuZWwgYW5zd2VycyBhcmUgY2FwcGVkIGF0IDEgTWlCKS4gKi9cbmNvbnN0IFNQRUNfUFJFVklFVyA9IDYwMFxuLyoqIFJlc3VsdCB0ZXh0IGtlcHQgaW4gdGhlIHNoYXJlZCBzdGF0ZTsgdGhlIGluc3BlY3RvciBmZXRjaGVzIHRoZSByZXN0IG9uIGRlbWFuZC4gKi9cbmNvbnN0IFJFU1VMVF9QUkVWSUVXID0gNjAwXG5jb25zdCBTUEVDX0xJTUlUID0gNjAwMDBcbmNvbnN0IEJPRFlfUFJFVklFVyA9IDYwMFxuY29uc3QgRlVMTF9URVhUX0xJTUlUID0gMTAwMFxuXG5leHBvcnQgY2xhc3MgT3JjaGVzdHJhdGlvbkFkYXB0ZXIge1xuICBwcml2YXRlIGN5Y2xlID0gMFxuICBwcml2YXRlIHBvbGxpbmcgPSBmYWxzZVxuICAvKiogZGlzcGF0Y2hJZCBcdTIxOTIgbGFzdCB3b3JrZXItc2hvdyBmaW5nZXJwcmludDsgc2V0dGxlZCBvbmVzIGFyZSBub3QgcmUtZmV0Y2hlZC4gKi9cbiAgcHJpdmF0ZSBkZXRhaWxlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgcHJpdmF0ZSBkaXNwYXRjaFJvd3MgPSBuZXcgTWFwPHN0cmluZywgUmF3V29ya2VyUm93PigpXG4gIC8qKiBGdWxsIHRhc2sgc3BlY3MgYW5kIG1lc3NhZ2UgYm9kaWVzLCBrZXB0IG91dCBvZiB0aGUgc2hhcmVkIHN0YXRlLiAqL1xuICBwcml2YXRlIGZ1bGxUZXh0ID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICBwcml2YXRlIHJ1bkRldGFpbENoZWNrZWRBdCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KClcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICAvKiogRnVsbCBzcGVjIC8gYm9keSBmb3IgdGhlIGluc3BlY3RvcjsgbnVsbCB3aGVuIG5vdCBrbm93bi4gKi9cbiAgZnVsbFRleHRGb3Ioa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5mdWxsVGV4dC5nZXQoa2V5KSA/PyBudWxsXG4gIH1cblxuICBwcml2YXRlIGtlZXBGdWxsKGtleTogc3RyaW5nLCB0ZXh0OiBzdHJpbmcsIHByZXZpZXc6IG51bWJlcik6IHN0cmluZyB7XG4gICAgdGhpcy5mdWxsVGV4dC5zZXQoa2V5LCB0ZXh0KVxuICAgIGlmICh0aGlzLmZ1bGxUZXh0LnNpemUgPiBGVUxMX1RFWFRfTElNSVQpIHtcbiAgICAgIGNvbnN0IG9sZGVzdCA9IHRoaXMuZnVsbFRleHQua2V5cygpLm5leHQoKS52YWx1ZVxuICAgICAgaWYgKG9sZGVzdCAhPT0gdW5kZWZpbmVkKSB0aGlzLmZ1bGxUZXh0LmRlbGV0ZShvbGRlc3QpXG4gICAgfVxuICAgIHJldHVybiB0cnVuY2F0ZSh0ZXh0LCBwcmV2aWV3KVxuICB9XG5cbiAgZ2V0IGhhc0FjdGl2ZVdvcmsoKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKClcbiAgICAvLyBPbmx5IG9yY2hlc3RyYXRpb24gd29yayBzcGVlZHMgdXAgb3JjaGVzdHJhdGlvbiBwb2xsaW5nOyBsaXZlIGNoYXQgYWdlbnRzIGRvIG5vdCBuZWVkIGl0LlxuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHN0YXRlLnJ1bnMpLnNvbWUoKHJ1bikgPT4gcnVuLnN0YXRlID09PSAnYWN0aXZlJyAmJiBPYmplY3QudmFsdWVzKHN0YXRlLmFnZW50cykuc29tZSgoYSkgPT4gYS5ydW5JZCA9PT0gcnVuLmlkICYmIGEubGl2ZSkpXG4gIH1cblxuICBhc3luYyBwb2xsKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnBvbGxpbmcgfHwgIXRoaXMuY3R4LmNsaS5wYXRoKSByZXR1cm5cbiAgICB0aGlzLnBvbGxpbmcgPSB0cnVlXG4gICAgdGhpcy5jeWNsZSsrXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJ1bnMgPSBhd2FpdCB0aGlzLnBvbGxSdW5zKClcbiAgICAgIGlmICghcnVucykgcmV0dXJuXG4gICAgICBmb3IgKGNvbnN0IHJ1biBvZiBydW5zKSB7XG4gICAgICAgIGNvbnN0IGZ1bGwgPSBydW4uc3RhdGUgPT09ICdhY3RpdmUnIHx8IHRoaXMuY3ljbGUgJSA2ID09PSAxXG4gICAgICAgIGlmIChmdWxsKSBhd2FpdCB0aGlzLnBvbGxUYXNrcyhydW4uaWQpXG4gICAgICAgIC8vIENoYXQtY29vcmRpbmF0ZWQgcnVucyBuZXZlciBnZXQgYSBoYW5kbGU6IGxvb2sgb25jZSwgdGhlbiByYXJlbHkuXG4gICAgICAgIGNvbnN0IGxhc3RDaGVjayA9IHRoaXMucnVuRGV0YWlsQ2hlY2tlZEF0LmdldChydW4uaWQpXG4gICAgICAgIGlmICghcnVuLmNvb3JkaW5hdG9ySGFuZGxlICYmIChsYXN0Q2hlY2sgPT09IHVuZGVmaW5lZCB8fCB0aGlzLmN5Y2xlIC0gbGFzdENoZWNrID49IDYwKSkge1xuICAgICAgICAgIHRoaXMucnVuRGV0YWlsQ2hlY2tlZEF0LnNldChydW4uaWQsIHRoaXMuY3ljbGUpXG4gICAgICAgICAgYXdhaXQgdGhpcy5wb2xsUnVuRGV0YWlsKHJ1bi5pZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5wb2xsV29ya2VycygpXG4gICAgICBhd2FpdCB0aGlzLnBvbGxNZXNzYWdlcygpXG4gICAgICB0aGlzLnJlZnJlc2hSdW5TdGF0ZXMoKVxuICAgICAgLy8gVXNlIHRoZSBzdGF0ZSBjb21wdXRlZCBmcm9tIHRoaXMgY3ljbGUncyB0YXNrcywgc28gZ2F0ZXMgc2hvdyB1cCBvbiB0aGUgZmlyc3QgcG9sbCB0b28uXG4gICAgICBjb25zdCBhY3RpdmUgPSBPYmplY3QudmFsdWVzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zKS5maWx0ZXIoKHJ1bikgPT4gcnVuLnN0YXRlID09PSAnYWN0aXZlJylcbiAgICAgIGZvciAoY29uc3QgcnVuIG9mIGFjdGl2ZSkgYXdhaXQgdGhpcy5wb2xsR2F0ZXMocnVuLmlkKVxuICAgICAgaWYgKGFjdGl2ZS5sZW5ndGgpIHRoaXMucmVmcmVzaFJ1blN0YXRlcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuY3R4LmxvZyhgb3JjaGVzdHJhdGlvbiBwb2xsIGZhaWxlZDogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5wb2xsaW5nID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxSdW5zKCk6IFByb21pc2U8UnVuUmVjb3JkW10gfCBudWxsPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IHJ1bnM6IHsgaWQ6IHN0cmluZzsgb2JqZWN0aXZlPzogc3RyaW5nOyBsZWdhY3k/OiBib29sZWFuIH1bXSB9PihbJ29yY2hlc3RyYXRpb24nLCAncnVuLWxpc3QnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgdGhpcy5jdHgubG9nKGBydW4tbGlzdDogJHtyZXN1bHQuY29kZX0gJHtyZXN1bHQubWVzc2FnZX1gKVxuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgY29uc3Qgb3V0OiBSdW5SZWNvcmRbXSA9IFtdXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC5ydW5zLmZpbHRlcigocnVuKSA9PiAhcnVuLmxlZ2FjeSkuc2xpY2UoMCwgTUFYX1JVTlMpKSB7XG4gICAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zW3Jhdy5pZF1cbiAgICAgIGNvbnN0IHJlY29yZDogUnVuUmVjb3JkID0gcHJldmlvdXNcbiAgICAgICAgPyB7IC4uLnByZXZpb3VzLCBvYmplY3RpdmU6IHJhdy5vYmplY3RpdmUgPz8gcHJldmlvdXMub2JqZWN0aXZlIH1cbiAgICAgICAgOiB7IGlkOiByYXcuaWQsIG9iamVjdGl2ZTogcmF3Lm9iamVjdGl2ZSA/PyByYXcuaWQsIGxlZ2FjeTogZmFsc2UsIGNvb3JkaW5hdG9ySGFuZGxlOiBudWxsLCBzdGF0ZTogJ2lkbGUnLCBzdGFydGVkQXQ6IG51bGwsIGVuZGVkQXQ6IG51bGwsIHRhc2tDb3VudDogMCwgdmVyc2lvbjogMCB9XG4gICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdydW4nLCBpZDogcmF3LmlkLCB2YWx1ZTogcmVjb3JkIH0pXG4gICAgICB0aGlzLmVuc3VyZUxlYWQocmVjb3JkKVxuICAgICAgaWYgKCFwcmV2aW91cykgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcnVuOiR7cmF3LmlkfWAsIHRzOiB0aGlzLmN0eC5ub3coKSwga2luZDogJ29yY2hlc3RyYXRpb24uc3RhcnRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQ6IHJhdy5pZCwgc3VtbWFyeTogYFJ1bjogJHt0cnVuY2F0ZShyZWNvcmQub2JqZWN0aXZlLCAxMjApfWAgfSlcbiAgICAgIG91dC5wdXNoKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5ydW5zW3Jhdy5pZF0pXG4gICAgfVxuICAgIHJldHVybiBvdXRcbiAgfVxuXG4gIC8qKiBydW4tc2hvdyAtLWZ1bGwgbmFtZXMgdGhlIGNvb3JkaW5hdG9yJ3MgdGVybWluYWwgaGFuZGxlIChudWxsIGZvciBjaGF0IGNvb3JkaW5hdG9ycykgYW5kIGNyZWF0aW9uIHRpbWUuICovXG4gIHByaXZhdGUgYXN5bmMgcG9sbFJ1bkRldGFpbChydW5JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IHJ1bj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0+KFsnb3JjaGVzdHJhdGlvbicsICdydW4tc2hvdycsICctLWlkJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vayB8fCAhcmVzdWx0LnJlc3VsdC5ydW4pIHJldHVyblxuICAgIGNvbnN0IHJhdyA9IHJlc3VsdC5yZXN1bHQucnVuXG4gICAgY29uc3QgcnVuID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnJ1bnNbcnVuSWRdXG4gICAgaWYgKCFydW4pIHJldHVyblxuICAgIGNvbnN0IGNvb3JkaW5hdG9ySGFuZGxlID0gc3RyKHJhdy5jb29yZGluYXRvcl9oYW5kbGUpID8/IHJ1bi5jb29yZGluYXRvckhhbmRsZVxuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IHJ1bi5zdGFydGVkQXQgPz8gcGFyc2VUaW1lKHJhdy5jcmVhdGVkX2F0KVxuICAgIGlmIChjb29yZGluYXRvckhhbmRsZSA9PT0gcnVuLmNvb3JkaW5hdG9ySGFuZGxlICYmIHN0YXJ0ZWRBdCA9PT0gcnVuLnN0YXJ0ZWRBdCkgcmV0dXJuXG4gICAgY29uc3QgbmV4dCA9IHsgLi4ucnVuLCBjb29yZGluYXRvckhhbmRsZSwgc3RhcnRlZEF0IH1cbiAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdydW4nLCBpZDogcnVuSWQsIHZhbHVlOiBuZXh0IH0pXG4gICAgdGhpcy5lbnN1cmVMZWFkKG5leHQpXG4gIH1cblxuICAvKiogVGhlIGNvb3JkaW5hdG9yIG9mIGEgcnVuLiBTdHJ1Y3R1cmFsIChldmVyeSBydW4gaGFzIG9uZSk7IGxpdmUgb25seSB3aXRoIHJ1bnRpbWUgZXZpZGVuY2UuICovXG4gIHByaXZhdGUgZW5zdXJlTGVhZChydW46IFJ1blJlY29yZCk6IHZvaWQge1xuICAgIGNvbnN0IGlkID0gYGxlYWQ6JHtydW4uaWR9YFxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIDAsXG4gICAgICB7IHJvbGU6ICdsZWFkJywgcnVuSWQ6IHJ1bi5pZCwgdGl0bGU6ICdMZWFkIG9yY2hlc3RyYXRvcicsIGRlc2NyaXB0aW9uOiB0cnVuY2F0ZShydW4ub2JqZWN0aXZlLCAyMDApLCB0ZXJtaW5hbEhhbmRsZTogcnVuLmNvb3JkaW5hdG9ySGFuZGxlID8/IHVuZGVmaW5lZCwgZXZpZGVuY2U6IFsnY2xpLXBvbGwnXSB9LFxuICAgICAgKCkgPT4gbmV3QWdlbnQoaWQsICdsZWFkJywgbm93KVxuICAgIClcbiAgICBpZiAocnVuLmNvb3JkaW5hdG9ySGFuZGxlKSB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCB7IHRlcm1pbmFsSGFuZGxlOiBydW4uY29vcmRpbmF0b3JIYW5kbGUgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcG9sbFRhc2tzKHJ1bklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPHsgdGFza3M6IFJhd1Rhc2tbXSB9PihbJ29yY2hlc3RyYXRpb24nLCAndGFzay1saXN0JywgJy0tcnVuJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgdGhpcy5jdHgubG9nKGB0YXNrLWxpc3QgJHtydW5JZH06ICR7cmVzdWx0LmNvZGV9ICR7cmVzdWx0Lm1lc3NhZ2V9YClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBsZXQgY29vcmRpbmF0b3I6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC50YXNrcykge1xuICAgICAgY29vcmRpbmF0b3IgPz89IHN0cihyYXcuY3JlYXRlZF9ieV90ZXJtaW5hbF9oYW5kbGUpXG4gICAgICB0aGlzLmFwcGx5VGFzayhydW5JZCwgcmF3KVxuICAgIH1cbiAgICBjb25zdCBydW4gPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkucnVuc1tydW5JZF1cbiAgICBpZiAocnVuKSB7XG4gICAgICBjb25zdCB0YXNrcyA9IHJlc3VsdC5yZXN1bHQudGFza3NcbiAgICAgIGNvbnN0IHRpbWVzID0gdGFza3MubWFwKCh0YXNrKSA9PiBwYXJzZVRpbWUodGFzay5jcmVhdGVkX2F0KSkuZmlsdGVyKCh0KTogdCBpcyBudW1iZXIgPT4gdCAhPT0gbnVsbClcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnB1dCh7XG4gICAgICAgIGVudGl0eTogJ3J1bicsXG4gICAgICAgIGlkOiBydW5JZCxcbiAgICAgICAgdmFsdWU6IHsgLi4ucnVuLCB0YXNrQ291bnQ6IHRhc2tzLmxlbmd0aCwgY29vcmRpbmF0b3JIYW5kbGU6IHJ1bi5jb29yZGluYXRvckhhbmRsZSA/PyBjb29yZGluYXRvciwgc3RhcnRlZEF0OiB0aW1lcy5sZW5ndGggPyBNYXRoLm1pbiguLi50aW1lcykgOiBydW4uc3RhcnRlZEF0IH1cbiAgICAgIH0pXG4gICAgICBpZiAoY29vcmRpbmF0b3IgJiYgIXJ1bi5jb29yZGluYXRvckhhbmRsZSkgdGhpcy5lbnN1cmVMZWFkKHsgLi4ucnVuLCBjb29yZGluYXRvckhhbmRsZTogY29vcmRpbmF0b3IgfSlcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5VGFzayhydW5JZDogc3RyaW5nLCByYXc6IFJhd1Rhc2spOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKVxuICAgIGNvbnN0IHByZXZpb3VzID0gc3RhdGUudGFza3NbcmF3LmlkXVxuICAgIGNvbnN0IHRpdGxlID0gc3RyKHJhdy50YXNrX3RpdGxlKSA/PyBzdHIocmF3LmRpc3BsYXlfbmFtZSkgPz8gcmF3LmlkXG4gICAgY29uc3Qga2luZCA9IGluZmVyVGFza0tpbmQoYCR7dGl0bGV9ICR7c3RyKHJhdy5kaXNwbGF5X25hbWUpID8/ICcnfWApXG4gICAgY29uc3QgcGFyc2VkUmVzdWx0ID0gcGFyc2VSZXN1bHQocmF3LnJlc3VsdClcbiAgICAvLyBLZWVwIHRoZSBzaGFyZWQgc3RhdGUgc21hbGwgKGl0IGlzIHNlbnQgdG8gZXZlcnkgdmlldyk6IGxvbmcgcmVzdWx0IHRleHQgc3RheXMgaGVyZS5cbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZWRSZXN1bHQ/Lm1lc3NhZ2UgPyB7IC4uLnBhcnNlZFJlc3VsdCwgbWVzc2FnZTogdGhpcy5rZWVwRnVsbChgcmVzdWx0OiR7cmF3LmlkfWAsIHBhcnNlZFJlc3VsdC5tZXNzYWdlLCBSRVNVTFRfUFJFVklFVykgfSA6IHBhcnNlZFJlc3VsdFxuICAgIGNvbnN0IGRpc3BhdGNoSWRzID0gcHJldmlvdXM/LmRpc3BhdGNoSWRzID8/IFtdXG4gICAgY29uc3QgbGF0ZXN0RGlzcGF0Y2ggPSBkaXNwYXRjaElkcy5sZW5ndGggPyB0aGlzLmRpc3BhdGNoUm93cy5nZXQoZGlzcGF0Y2hJZHNbZGlzcGF0Y2hJZHMubGVuZ3RoIC0gMV0pIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZ2F0ZUlkcyA9IE9iamVjdC52YWx1ZXMoc3RhdGUuZ2F0ZXMpLmZpbHRlcigoZ2F0ZSkgPT4gZ2F0ZS50YXNrSWQgPT09IHJhdy5pZCkubWFwKChnYXRlKSA9PiBnYXRlLmlkKVxuICAgIGNvbnN0IGhhc09wZW5HYXRlID0gZ2F0ZUlkcy5zb21lKChpZCkgPT4gc3RhdGUuZ2F0ZXNbaWRdPy5zdGF0dXMgPT09ICdwZW5kaW5nJylcbiAgICBjb25zdCB0YXNrU3RhdGUgPSBtYXBPcmNhVGFza1N0YXR1cyh7XG4gICAgICBvcmNhU3RhdHVzOiBzdHIocmF3LnN0YXR1cykgPz8gJ3BlbmRpbmcnLFxuICAgICAga2luZCxcbiAgICAgIHJlc3VsdE91dGNvbWU6IHJlc3VsdD8ub3V0Y29tZSA/PyBudWxsLFxuICAgICAgaGFzT3BlbkdhdGUsXG4gICAgICByZXRyeUNvdW50OiBNYXRoLm1heCgwLCBkaXNwYXRjaElkcy5sZW5ndGggLSAxKSxcbiAgICAgIGRpc3BhdGNoQWN0aXZlOiBsYXRlc3REaXNwYXRjaCA/IGlzTGl2ZVdvcmtlcihsYXRlc3REaXNwYXRjaCkgOiBmYWxzZVxuICAgIH0pXG4gICAgY29uc3QgcmVjb3JkOiBUYXNrUmVjb3JkID0ge1xuICAgICAgaWQ6IHJhdy5pZCxcbiAgICAgIHJ1bklkLFxuICAgICAgcGFyZW50SWQ6IHN0cihyYXcucGFyZW50X2lkKSxcbiAgICAgIHRpdGxlOiByZWRhY3QodGl0bGUpLFxuICAgICAgZGlzcGxheU5hbWU6IHJlZGFjdE51bGxhYmxlKHN0cihyYXcuZGlzcGxheV9uYW1lKSksXG4gICAgICBzcGVjOiByYXcuc3BlYyA/IHRoaXMua2VlcEZ1bGwoYHRhc2s6JHtyYXcuaWR9YCwgcmVkYWN0KHRydW5jYXRlKFN0cmluZyhyYXcuc3BlYyksIFNQRUNfTElNSVQpKSwgU1BFQ19QUkVWSUVXKSA6IG51bGwsXG4gICAgICBraW5kLFxuICAgICAgb3JjYVN0YXR1czogc3RyKHJhdy5zdGF0dXMpID8/ICdwZW5kaW5nJyxcbiAgICAgIHN0YXRlOiB0YXNrU3RhdGUsXG4gICAgICBkZXBzOiBwYXJzZURlcHMocmF3LmRlcHMpLFxuICAgICAgYXNzaWduZWVBZ2VudElkOiBwcmV2aW91cz8uYXNzaWduZWVBZ2VudElkID8/IG51bGwsXG4gICAgICBkaXNwYXRjaElkcyxcbiAgICAgIHJlc3VsdCxcbiAgICAgIGNyZWF0ZWRBdDogcGFyc2VUaW1lKHJhdy5jcmVhdGVkX2F0KSxcbiAgICAgIGNvbXBsZXRlZEF0OiBwYXJzZVRpbWUocmF3LmNvbXBsZXRlZF9hdCksXG4gICAgICByZXRyeUNvdW50OiBNYXRoLm1heCgwLCBkaXNwYXRjaElkcy5sZW5ndGggLSAxKSxcbiAgICAgIGdhdGVJZHMsXG4gICAgICB2ZXJzaW9uOiBwcmV2aW91cz8udmVyc2lvbiA/PyAwXG4gICAgfVxuICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydFRhc2socmVjb3JkKVxuICAgIGlmICghcHJldmlvdXMpIHtcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyBpZDogYHRhc2suY3JlYXRlZDoke3Jhdy5pZH1gLCB0czogcmVjb3JkLmNyZWF0ZWRBdCA/PyB0aGlzLmN0eC5ub3coKSwga2luZDogJ3Rhc2suY3JlYXRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQsIHN1bW1hcnk6IGBUYXNrIGNyZWF0ZWQ6ICR7dHJ1bmNhdGUocmVjb3JkLnRpdGxlLCAxMDApfWAgfSlcbiAgICB9IGVsc2UgaWYgKHByZXZpb3VzLnN0YXRlICE9PSByZWNvcmQuc3RhdGUpIHtcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyB0czogdGhpcy5jdHgubm93KCksIGtpbmQ6IHRhc2tFdmVudEtpbmQocmVjb3JkLnN0YXRlLCByZWNvcmQua2luZCksIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJhdy5pZCwgcnVuSWQsIHRhcmdldElkOiByZWNvcmQuYXNzaWduZWVBZ2VudElkLCBzdW1tYXJ5OiBgJHt0cnVuY2F0ZShyZWNvcmQudGl0bGUsIDgwKX06ICR7cHJldmlvdXMuc3RhdGV9IFx1MjE5MiAke3JlY29yZC5zdGF0ZX1gIH0pXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwb2xsV29ya2VycygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb3dzOiBSYXdXb3JrZXJSb3dbXSA9IFtdXG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGxldCBwYWdlID0gMDsgcGFnZSA8IE1BWF9XT1JLRVJfUEFHRVM7IHBhZ2UrKykge1xuICAgICAgY29uc3QgYXJncyA9IFsnb3JjaGVzdHJhdGlvbicsICd3b3JrZXItbGlzdCddXG4gICAgICBpZiAoY3Vyc29yKSBhcmdzLnB1c2goJy0tY3Vyc29yJywgY3Vyc29yKVxuICAgICAgY29uc3QgcmVzdWx0OiBBd2FpdGVkPFJldHVyblR5cGU8dHlwZW9mIHRoaXMuY3R4LmNsaS5ydW48eyB3b3JrZXJzOiBSYXdXb3JrZXJSb3dbXTsgbmV4dEN1cnNvcj86IHN0cmluZyB8IG51bGwgfT4+PiA9IGF3YWl0IHRoaXMuY3R4LmNsaS5ydW4oYXJncylcbiAgICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAgIHRoaXMuY3R4LmxvZyhgd29ya2VyLWxpc3Q6ICR7cmVzdWx0LmNvZGV9ICR7cmVzdWx0Lm1lc3NhZ2V9YClcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICAgIHJvd3MucHVzaCguLi5yZXN1bHQucmVzdWx0LndvcmtlcnMpXG4gICAgICBjdXJzb3IgPSByZXN1bHQucmVzdWx0Lm5leHRDdXJzb3IgPz8gbnVsbFxuICAgICAgaWYgKCFjdXJzb3IpIGJyZWFrXG4gICAgfVxuICAgIGNvbnN0IHRhc2tzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzXG4gICAgbGV0IGRldGFpbEJ1ZGdldCA9IE1BWF9ERVRBSUxfUEVSX0NZQ0xFXG4gICAgY29uc3Qga25vd24gPSByb3dzLmZpbHRlcigocm93KSA9PiB0YXNrc1tyb3cudGFza0lkXSlcbiAgICAvLyBBcHBseSBpbiBPcmNhJ3Mgb3JkZXIsIHNvIGEgdGFzaydzIGRpc3BhdGNoIGhpc3RvcnkgKHJldHJpZXMpIHN0YXlzIGNocm9ub2xvZ2ljYWwuXG4gICAgZm9yIChjb25zdCByb3cgb2Yga25vd24pIHtcbiAgICAgIHRoaXMuZGlzcGF0Y2hSb3dzLnNldChyb3cuZGlzcGF0Y2hJZCwgcm93KVxuICAgICAgdGhpcy5hcHBseVdvcmtlclJvdyhyb3cpXG4gICAgfVxuICAgIC8vIERldGFpbHMgKGFnZW50LCBtb2RlbCwgZWZmb3J0LCBwYW5lKSBmb3IgbGl2ZSBhbmQgZmFpbGVkIHdvcmtlcnMgZmlyc3QsIHRoZW4gdGhlIHJlc3QuXG4gICAgY29uc3QgcHJpb3JpdHkgPSAocm93OiBSYXdXb3JrZXJSb3cpID0+IChpc0xpdmVXb3JrZXIocm93KSA/IDAgOiBtYXBXb3JrZXJTdGF0ZShyb3cpID09PSAnZmFpbGVkJyA/IDEgOiAyKVxuICAgIGZvciAoY29uc3Qgcm93IG9mIFsuLi5rbm93bl0uc29ydCgoYSwgYikgPT4gcHJpb3JpdHkoYSkgLSBwcmlvcml0eShiKSkpIHtcbiAgICAgIGlmIChkZXRhaWxCdWRnZXQgPD0gMCkgYnJlYWtcbiAgICAgIGNvbnN0IGZpbmdlcnByaW50ID0gYCR7cm93LnN0YXRlfXwke3Jvdy5saXZlbmVzcyA/PyAnJ318JHtyb3cudGVybWluYWwgPz8gJyd9YFxuICAgICAgaWYgKHRoaXMuZGV0YWlsZWQuZ2V0KHJvdy5kaXNwYXRjaElkKSA9PT0gZmluZ2VycHJpbnQgJiYgIWlzTGl2ZVdvcmtlcihyb3cpKSBjb250aW51ZVxuICAgICAgZGV0YWlsQnVkZ2V0LS1cbiAgICAgIGF3YWl0IHRoaXMucG9sbFdvcmtlckRldGFpbChyb3cuZGlzcGF0Y2hJZClcbiAgICAgIHRoaXMuZGV0YWlsZWQuc2V0KHJvdy5kaXNwYXRjaElkLCBmaW5nZXJwcmludClcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5V29ya2VyUm93KHJvdzogUmF3V29ya2VyUm93KTogdm9pZCB7XG4gICAgY29uc3QgaWQgPSBgZGlzcGF0Y2g6JHtyb3cuZGlzcGF0Y2hJZH1gXG4gICAgY29uc3Qgbm93ID0gdGhpcy5jdHgubm93KClcbiAgICBjb25zdCB0YXNrID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzW3Jvdy50YXNrSWRdXG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2lkXVxuICAgIGNvbnN0IFtwcm9qZWN0SWQsIHdvcmt0cmVlUGF0aF0gPSBzcGxpdFdvcmtzcGFjZShyb3cud29ya3NwYWNlKVxuICAgIGNvbnN0IHBvbGxlZCA9IG1hcFdvcmtlclN0YXRlKHJvdylcbiAgICAvLyBIb3N0IHN0YXR1cyBldmVudHMgYXJlIHRoZSBwcmVjaXNlIGxpdmUgc2lnbmFsOyBhIGR1cmFibGUgcG9sbCBvbmx5IG92ZXJyaWRlcyB0aGVtIHRvIHNldHRsZS5cbiAgICBjb25zdCBob3N0RHJpdmVuID0gcHJldmlvdXM/LmV2aWRlbmNlLmluY2x1ZGVzKCdob3N0LWV2ZW50JykgJiYgcG9sbGVkICE9PSAnZG9uZScgJiYgcG9sbGVkICE9PSAnZmFpbGVkJ1xuICAgIGNvbnN0IHN0YXRlID0gaG9zdERyaXZlbiA/IHByZXZpb3VzLnN0YXRlIDogcG9sbGVkXG4gICAgY29uc3QgcmVjb3JkID0gdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoXG4gICAgICBpZCxcbiAgICAgIG5vdyxcbiAgICAgIHtcbiAgICAgICAgcm9sZTogJ3dvcmtlcicsXG4gICAgICAgIGRpc3BhdGNoSWQ6IHJvdy5kaXNwYXRjaElkLFxuICAgICAgICB0YXNrSWQ6IHJvdy50YXNrSWQsXG4gICAgICAgIHJ1bklkOiB0YXNrPy5ydW5JZCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHBhcmVudElkOiBwcmV2aW91cz8ucGFyZW50SWQgPz8gKHRhc2sgPyBgbGVhZDoke3Rhc2sucnVuSWR9YCA6IG51bGwpLFxuICAgICAgICB0ZXJtaW5hbEhhbmRsZTogcm93LnRlcm1pbmFsID8/IHVuZGVmaW5lZCxcbiAgICAgICAgd29ya3NwYWNlSWQ6IHJvdy53b3Jrc3BhY2UgPz8gdW5kZWZpbmVkLFxuICAgICAgICB3b3JrdHJlZVBhdGg6IHdvcmt0cmVlUGF0aCA/PyB1bmRlZmluZWQsXG4gICAgICAgIHByb2plY3RJZDogcHJvamVjdElkID8/IHVuZGVmaW5lZCxcbiAgICAgICAgYnJhbmNoOiBPYmplY3QudmFsdWVzKHRoaXMuY3R4LnN0b3JlLnJlYWQoKS53b3JrdHJlZXMpLmZpbmQoKHcpID0+IHcucGF0aCA9PT0gd29ya3RyZWVQYXRoKT8uYnJhbmNoID8/IHVuZGVmaW5lZCxcbiAgICAgICAgdGl0bGU6IHByZXZpb3VzPy50aXRsZSA/PyB0YXNrPy5kaXNwbGF5TmFtZSA/PyB0YXNrPy50aXRsZSA/PyAnV29ya2VyJyxcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGxpdmU6IGhvc3REcml2ZW4gPyBwcmV2aW91cy5saXZlIDogaXNMaXZlV29ya2VyKHJvdyksXG4gICAgICAgIC8vIEEgc3RvcHBlZC9hYmFuZG9uZWQgd29ya2VyIGVuZGVkIGJ5IHJlcXVlc3QsIG5vdCBieSBmaW5pc2hpbmcgaXRzIHRhc2suXG4gICAgICAgIG91dGNvbWU6IFNUT1BQRURfU1RBVEVTLmhhcyhyb3cuc3RhdGUudG9Mb3dlckNhc2UoKSkgPyAnY2FuY2VsbGF0aW9uJyA6IHVuZGVmaW5lZCxcbiAgICAgICAgZXZpZGVuY2U6IFsnY2xpLXBvbGwnXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnd29ya2VyJywgbm93KVxuICAgIClcbiAgICB0aGlzLmN0eC5pZGVudGl0eS5saW5rKGlkLCB7IHRlcm1pbmFsSGFuZGxlOiByb3cudGVybWluYWwgPz8gbnVsbCB9KVxuICAgIGlmICh0YXNrICYmICF0YXNrLmRpc3BhdGNoSWRzLmluY2x1ZGVzKHJvdy5kaXNwYXRjaElkKSkge1xuICAgICAgY29uc3QgZGlzcGF0Y2hJZHMgPSBbLi4udGFzay5kaXNwYXRjaElkcywgcm93LmRpc3BhdGNoSWRdXG4gICAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRUYXNrKHsgLi4udGFzaywgZGlzcGF0Y2hJZHMsIGFzc2lnbmVlQWdlbnRJZDogaWQsIHJldHJ5Q291bnQ6IE1hdGgubWF4KDAsIGRpc3BhdGNoSWRzLmxlbmd0aCAtIDEpIH0pXG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgaWQ6IGB0YXNrLmFzc2lnbmVkOiR7cm93LmRpc3BhdGNoSWR9YCwgdHM6IG5vdywga2luZDogZGlzcGF0Y2hJZHMubGVuZ3RoID4gMSA/ICd0YXNrLnJldHJpZWQnIDogJ3Rhc2suYXNzaWduZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiByb3cudGFza0lkLCB0YXJnZXRJZDogaWQsIHJ1bklkOiB0YXNrLnJ1bklkLCBzdW1tYXJ5OiBgJHt0cnVuY2F0ZSh0YXNrLnRpdGxlLCA4MCl9IFx1MjE5MiAke3JlY29yZC50aXRsZX1gIH0pXG4gICAgfVxuICAgIGlmIChwcmV2aW91cyAmJiBwcmV2aW91cy5zdGF0ZSAhPT0gcmVjb3JkLnN0YXRlKSB7XG4gICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgdHM6IG5vdywga2luZDogc3RhdGUgPT09ICdmYWlsZWQnID8gJ2FnZW50LmZhaWxlZCcgOiBzdGF0ZSA9PT0gJ2RvbmUnID8gJ2FnZW50LmNvbXBsZXRlZCcgOiAnYWdlbnQuc3RhdHVzX2NoYW5nZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiBpZCwgcnVuSWQ6IHJlY29yZC5ydW5JZCwgc3VtbWFyeTogYCR7cmVjb3JkLnRpdGxlfTogJHtwcmV2aW91cy5zdGF0ZX0gXHUyMTkyICR7c3RhdGV9YCB9KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcG9sbFdvcmtlckRldGFpbChkaXNwYXRjaElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPFJlY29yZDxzdHJpbmcsIHVua25vd24+PihbJ29yY2hlc3RyYXRpb24nLCAnd29ya2VyLXNob3cnLCAnLS1kaXNwYXRjaCcsIGRpc3BhdGNoSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuXG4gICAgY29uc3QgZGV0YWlsID0gcmVzdWx0LnJlc3VsdFxuICAgIGNvbnN0IGRpc3BhdGNoID0gYXNSZWNvcmQoZGV0YWlsLmRpc3BhdGNoKVxuICAgIGNvbnN0IHdvcmtlciA9IGFzUmVjb3JkKGRldGFpbC53b3JrZXIpXG4gICAgY29uc3Qgc3RhcnQgPSBhc1JlY29yZCh3b3JrZXIuc3RhcnRPcHRpb25zKVxuICAgIGNvbnN0IGxhdW5jaCA9IGFzUmVjb3JkKGFzUmVjb3JkKHN0YXJ0LmxhdW5jaCkuZWZmZWN0aXZlKVxuICAgIGNvbnN0IHJlcXVlc3RlZCA9IGFzUmVjb3JkKGFzUmVjb3JkKHN0YXJ0LmxhdW5jaCkucmVxdWVzdGVkKVxuICAgIGNvbnN0IGlkID0gYGRpc3BhdGNoOiR7ZGlzcGF0Y2hJZH1gXG4gICAgY29uc3QgY3JlYXRvciA9IHN0cihkaXNwYXRjaC5jcmVhdG9yRGlzcGF0Y2hJZClcbiAgICBjb25zdCB0YXNrID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLnRhc2tzW3N0cihkaXNwYXRjaC50YXNrSWQpID8/ICcnXVxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgaWQsXG4gICAgICB0aGlzLmN0eC5ub3coKSxcbiAgICAgIHtcbiAgICAgICAgYWdlbnQ6IHN0cihsYXVuY2guYWdlbnQpID8/IHN0cihzdGFydC5hZ2VudCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBtb2RlbDogc3RyKGxhdW5jaC5tb2RlbCkgPz8gc3RyKHJlcXVlc3RlZC5tb2RlbCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBlZmZvcnQ6IHN0cihsYXVuY2guZWZmb3J0KSA/PyBzdHIocmVxdWVzdGVkLmVmZm9ydCkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBwYW5lS2V5OiBzdHIoZGlzcGF0Y2guYXNzaWduZWVQYW5lS2V5KSA/PyB1bmRlZmluZWQsXG4gICAgICAgIHRlcm1pbmFsSGFuZGxlOiBzdHIoZGlzcGF0Y2guYXNzaWduZWVIYW5kbGUpID8/IHVuZGVmaW5lZCxcbiAgICAgICAgcGFyZW50SWQ6IGNyZWF0b3IgPyBgZGlzcGF0Y2g6JHtjcmVhdG9yfWAgOiB0YXNrID8gYGxlYWQ6JHt0YXNrLnJ1bklkfWAgOiB1bmRlZmluZWQsXG4gICAgICAgIHJldHJ5T2ZEaXNwYXRjaElkOiBzdHIoZGlzcGF0Y2gucmV0cnlPZkRpc3BhdGNoSWQpLFxuICAgICAgICBmYWlsdXJlQ291bnQ6IHR5cGVvZiBkaXNwYXRjaC5mYWlsdXJlQ291bnQgPT09ICdudW1iZXInID8gZGlzcGF0Y2guZmFpbHVyZUNvdW50IDogMCxcbiAgICAgICAgc3RhcnRlZEF0OiBwYXJzZVRpbWUoZGlzcGF0Y2guZGlzcGF0Y2hlZEF0KSA/PyB1bmRlZmluZWQsXG4gICAgICAgIGVuZGVkQXQ6IHBhcnNlVGltZShkaXNwYXRjaC5jb21wbGV0ZWRBdCksXG4gICAgICAgIG91dGNvbWU6IHN0cihhc1JlY29yZChkZXRhaWwucHJvamVjdGlvbikub3V0Y29tZSkgPz8gdW5kZWZpbmVkLFxuICAgICAgICBldmlkZW5jZTogWydjbGktcG9sbCddXG4gICAgICB9LFxuICAgICAgKCkgPT4gbmV3QWdlbnQoaWQsICd3b3JrZXInLCB0aGlzLmN0eC5ub3coKSlcbiAgICApXG4gICAgdGhpcy5jdHguaWRlbnRpdHkubGluayhpZCwgeyBwYW5lS2V5OiByZWNvcmQucGFuZUtleSwgdGVybWluYWxIYW5kbGU6IHJlY29yZC50ZXJtaW5hbEhhbmRsZSB9KVxuICAgIC8vIFN0YXR1cyBldmVudHMgbWF5IGhhdmUgY3JlYXRlZCBhIHJlY29yZCBmb3IgdGhpcyBzZXNzaW9uIGJlZm9yZSBPcmNhIG5hbWVkIHRoZSBkaXNwYXRjaC5cbiAgICBtZXJnZUR1cGxpY2F0ZXNPZih0aGlzLmN0eC5zdG9yZSwgdGhpcy5jdHguaWRlbnRpdHksIGlkKVxuICAgIGRlZHVwZUFnZW50KHRoaXMuY3R4LnN0b3JlLCB0aGlzLmN0eC5pZGVudGl0eSwgaWQpXG4gICAgdGhpcy5vcmRlckRpc3BhdGNoZXMocmVjb3JkLnRhc2tJZClcbiAgICBpZiAoc3RyKGRpc3BhdGNoLnJldHJ5T2ZEaXNwYXRjaElkKSkge1xuICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcmV0cnk6JHtkaXNwYXRjaElkfWAsIHRzOiByZWNvcmQuc3RhcnRlZEF0ID8/IHRoaXMuY3R4Lm5vdygpLCBraW5kOiAndGFzay5yZXRyaWVkJywgc291cmNlOiAnY2xpLXBvbGwnLCBlbnRpdHlJZDogcmVjb3JkLnRhc2tJZCA/PyBpZCwgdGFyZ2V0SWQ6IGlkLCBydW5JZDogcmVjb3JkLnJ1bklkLCBzdW1tYXJ5OiBgUmV0cnkgb2YgJHtzdHIoZGlzcGF0Y2gucmV0cnlPZkRpc3BhdGNoSWQpfSBzdGFydGVkYCB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKiBLZWVwcyBhIHRhc2sncyBhdHRlbXB0cyBpbiBzdGFydCBvcmRlciBvbmNlIHN0YXJ0IHRpbWVzIGFyZSBrbm93bjsgdGhlIGxhc3QgaXMgdGhlIGxhdGVzdC4gKi9cbiAgcHJpdmF0ZSBvcmRlckRpc3BhdGNoZXModGFza0lkOiBzdHJpbmcgfCBudWxsKTogdm9pZCB7XG4gICAgY29uc3QgdGFzayA9IHRhc2tJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS50YXNrc1t0YXNrSWRdIDogdW5kZWZpbmVkXG4gICAgaWYgKCF0YXNrIHx8IHRhc2suZGlzcGF0Y2hJZHMubGVuZ3RoIDwgMikgcmV0dXJuXG4gICAgY29uc3QgYWdlbnRzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1xuICAgIGNvbnN0IGluZm8gPSAoaWQ6IHN0cmluZykgPT4gYWdlbnRzW2BkaXNwYXRjaDoke2lkfWBdXG4gICAgLy8gUmVvcmRlciBvbmx5IHdpdGggZnVsbCBpbmZvcm1hdGlvbjsgb3RoZXJ3aXNlIGtlZXAgT3JjYSdzIG9yZGVyLlxuICAgIGlmICh0YXNrLmRpc3BhdGNoSWRzLnNvbWUoKGlkKSA9PiBpbmZvKGlkKT8uc3RhcnRlZEF0ID09IG51bGwpKSByZXR1cm5cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGFzay5kaXNwYXRjaElkc10uc29ydCgoYSwgYikgPT4ge1xuICAgICAgaWYgKGluZm8oYik/LnJldHJ5T2ZEaXNwYXRjaElkID09PSBhKSByZXR1cm4gLTFcbiAgICAgIGlmIChpbmZvKGEpPy5yZXRyeU9mRGlzcGF0Y2hJZCA9PT0gYikgcmV0dXJuIDFcbiAgICAgIHJldHVybiAoaW5mbyhhKSEuc3RhcnRlZEF0IGFzIG51bWJlcikgLSAoaW5mbyhiKSEuc3RhcnRlZEF0IGFzIG51bWJlcilcbiAgICB9KVxuICAgIGlmIChzb3J0ZWQuam9pbigpID09PSB0YXNrLmRpc3BhdGNoSWRzLmpvaW4oKSkgcmV0dXJuXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0VGFzayh7IC4uLnRhc2ssIGRpc3BhdGNoSWRzOiBzb3J0ZWQsIGFzc2lnbmVlQWdlbnRJZDogYGRpc3BhdGNoOiR7c29ydGVkW3NvcnRlZC5sZW5ndGggLSAxXX1gIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxNZXNzYWdlcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmN0eC5jbGkucnVuPHsgbWVzc2FnZXM6IFJhd01lc3NhZ2VbXSB9PihbJ29yY2hlc3RyYXRpb24nLCAnaW5ib3gnLCAnLS1saW1pdCcsICcxNTAnLCAnLS1mdWxsJ10pXG4gICAgaWYgKCFyZXN1bHQub2spIHJldHVyblxuICAgIGNvbnN0IGtub3duID0gbmV3IFNldCh0aGlzLmN0eC5zdG9yZS5yZWFkKCkubWVzc2FnZXMubWFwKChtZXNzYWdlKSA9PiBtZXNzYWdlLmlkKSlcbiAgICBmb3IgKGNvbnN0IHJhdyBvZiBbLi4ucmVzdWx0LnJlc3VsdC5tZXNzYWdlc10ucmV2ZXJzZSgpKSB7XG4gICAgICBpZiAoa25vd24uaGFzKHJhdy5pZCkpIGNvbnRpbnVlXG4gICAgICBjb25zdCBwYXlsb2FkID0gcGFyc2VKc29uKHJhdy5wYXlsb2FkKVxuICAgICAgY29uc3QgZnJvbUhhbmRsZSA9IHN0cihyYXcuZnJvbV9oYW5kbGUpXG4gICAgICBjb25zdCB0b0hhbmRsZSA9IHN0cihyYXcudG9faGFuZGxlKVxuICAgICAgY29uc3QgZnJvbUFnZW50SWQgPSB0aGlzLmN0eC5pZGVudGl0eS5yZXNvbHZlKHsgdGVybWluYWxIYW5kbGU6IGZyb21IYW5kbGUsIHBhbmVLZXk6IHN0cihyYXcuc2VuZGVyX3BhbmVfa2V5KSB9KSA/PyBsZWFkRm9yKGZyb21IYW5kbGUpXG4gICAgICBjb25zdCB0b0FnZW50SWQgPSB0aGlzLmN0eC5pZGVudGl0eS5yZXNvbHZlKHsgdGVybWluYWxIYW5kbGU6IHRvSGFuZGxlIH0pID8/IGxlYWRGb3IodG9IYW5kbGUpXG4gICAgICBjb25zdCBtZXNzYWdlOiBNZXNzYWdlUmVjb3JkID0ge1xuICAgICAgICBpZDogcmF3LmlkLFxuICAgICAgICBydW5JZDogc3RyKHJhdy5ydW5faWQpLFxuICAgICAgICBmcm9tSGFuZGxlLFxuICAgICAgICB0b0hhbmRsZSxcbiAgICAgICAgZnJvbUFnZW50SWQsXG4gICAgICAgIHRvQWdlbnRJZCxcbiAgICAgICAgdHlwZTogc3RyKHJhdy50eXBlKSA/PyAnbWVzc2FnZScsXG4gICAgICAgIHN1YmplY3Q6IHJlZGFjdE51bGxhYmxlKHN0cihyYXcuc3ViamVjdCkpLFxuICAgICAgICBib2R5OiByYXcuYm9keSA/IHRoaXMua2VlcEZ1bGwoYG1lc3NhZ2U6JHtyYXcuaWR9YCwgcmVkYWN0KHRydW5jYXRlKFN0cmluZyhyYXcuYm9keSksIFNQRUNfTElNSVQpKSwgQk9EWV9QUkVWSUVXKSA6IG51bGwsXG4gICAgICAgIHRhc2tJZDogc3RyKHBheWxvYWQudGFza0lkKSxcbiAgICAgICAgY3JlYXRlZEF0OiBwYXJzZVRpbWUocmF3LmNyZWF0ZWRfYXQpID8/IHRoaXMuY3R4Lm5vdygpXG4gICAgICB9XG4gICAgICB0aGlzLmN0eC5zdG9yZS5wdXQoeyBlbnRpdHk6ICdtZXNzYWdlJywgaWQ6IHJhdy5pZCwgdmFsdWU6IG1lc3NhZ2UgfSlcbiAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoe1xuICAgICAgICBpZDogYG1lc3NhZ2U6JHtyYXcuaWR9YCxcbiAgICAgICAgdHM6IG1lc3NhZ2UuY3JlYXRlZEF0LFxuICAgICAgICBraW5kOiAnbWVzc2FnZS5zZW50JyxcbiAgICAgICAgc291cmNlOiAnY2xpLXBvbGwnLFxuICAgICAgICBlbnRpdHlJZDogZnJvbUFnZW50SWQgPz8gZnJvbUhhbmRsZSA/PyAndW5rbm93bicsXG4gICAgICAgIHRhcmdldElkOiB0b0FnZW50SWQsXG4gICAgICAgIHJ1bklkOiBtZXNzYWdlLnJ1bklkLFxuICAgICAgICBzdW1tYXJ5OiBgJHttZXNzYWdlLnR5cGV9OiAke3RydW5jYXRlKG1lc3NhZ2Uuc3ViamVjdCA/PyBtZXNzYWdlLmJvZHkgPz8gJycsIDEyMCl9YFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvbGxHYXRlcyhydW5JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jdHguY2xpLnJ1bjx7IGdhdGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSB9PihbJ29yY2hlc3RyYXRpb24nLCAnZ2F0ZS1saXN0JywgJy0tcnVuJywgcnVuSWQsICctLWZ1bGwnXSlcbiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuXG4gICAgZm9yIChjb25zdCByYXcgb2YgcmVzdWx0LnJlc3VsdC5nYXRlcyA/PyBbXSkge1xuICAgICAgY29uc3QgaWQgPSBzdHIocmF3LmlkKVxuICAgICAgaWYgKCFpZCkgY29udGludWVcbiAgICAgIGNvbnN0IGdhdGU6IEdhdGVSZWNvcmQgPSB7XG4gICAgICAgIGlkLFxuICAgICAgICB0YXNrSWQ6IHN0cihyYXcudGFza19pZCkgPz8gc3RyKHJhdy50YXNrSWQpLFxuICAgICAgICBxdWVzdGlvbjogcmVkYWN0TnVsbGFibGUoc3RyKHJhdy5xdWVzdGlvbikgPz8gc3RyKHJhdy5wcm9tcHQpKSxcbiAgICAgICAgc3RhdHVzOiBzdHIocmF3LnN0YXR1cykgPz8gJ3BlbmRpbmcnLFxuICAgICAgICByZXNvbHV0aW9uOiByZWRhY3ROdWxsYWJsZShzdHIocmF3LnJlc29sdXRpb24pKSxcbiAgICAgICAgY3JlYXRlZEF0OiBwYXJzZVRpbWUocmF3LmNyZWF0ZWRfYXQgPz8gcmF3LmNyZWF0ZWRBdClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmdhdGVzW2lkXVxuICAgICAgdGhpcy5jdHguc3RvcmUucHV0KHsgZW50aXR5OiAnZ2F0ZScsIGlkLCB2YWx1ZTogZ2F0ZSB9KVxuICAgICAgaWYgKCFwcmV2aW91cyAmJiBnYXRlLnN0YXR1cyA9PT0gJ3BlbmRpbmcnICYmIGdhdGUudGFza0lkKSB7XG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyBpZDogYGdhdGU6JHtpZH1gLCB0czogZ2F0ZS5jcmVhdGVkQXQgPz8gdGhpcy5jdHgubm93KCksIGtpbmQ6ICd0YXNrLmJsb2NrZWQnLCBzb3VyY2U6ICdjbGktcG9sbCcsIGVudGl0eUlkOiBnYXRlLnRhc2tJZCwgcnVuSWQsIHN1bW1hcnk6IGBEZWNpc2lvbiBnYXRlOiAke3RydW5jYXRlKGdhdGUucXVlc3Rpb24gPz8gaWQsIDEwMCl9YCB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVmcmVzaFJ1blN0YXRlcygpOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKVxuICAgIGZvciAoY29uc3QgcnVuIG9mIE9iamVjdC52YWx1ZXMoc3RhdGUucnVucykpIHtcbiAgICAgIGNvbnN0IHRhc2tzID0gT2JqZWN0LnZhbHVlcyhzdGF0ZS50YXNrcykuZmlsdGVyKCh0YXNrKSA9PiB0YXNrLnJ1bklkID09PSBydW4uaWQpXG4gICAgICBpZiAoIXRhc2tzLmxlbmd0aCkgY29udGludWVcbiAgICAgIGNvbnN0IGFsbERvbmUgPSB0YXNrcy5ldmVyeSgodGFzaykgPT4gVEVSTUlOQUxfVEFTS19TVEFURVMuaW5jbHVkZXModGFzay5zdGF0ZSkpXG4gICAgICBjb25zdCBhbnlGYWlsZWQgPSB0YXNrcy5zb21lKCh0YXNrKSA9PiB0YXNrLnN0YXRlID09PSAnRkFJTEVEJylcbiAgICAgIGNvbnN0IG5leHQ6IFJ1blJlY29yZFsnc3RhdGUnXSA9IGFsbERvbmUgPyAoYW55RmFpbGVkID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJykgOiAnYWN0aXZlJ1xuICAgICAgY29uc3QgZW5kZWRBdCA9IGFsbERvbmUgPyBNYXRoLm1heCguLi50YXNrcy5tYXAoKHRhc2spID0+IHRhc2suY29tcGxldGVkQXQgPz8gMCkpIHx8IG51bGwgOiBudWxsXG4gICAgICBpZiAobmV4dCAhPT0gcnVuLnN0YXRlIHx8IGVuZGVkQXQgIT09IHJ1bi5lbmRlZEF0KSB7XG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLnB1dCh7IGVudGl0eTogJ3J1bicsIGlkOiBydW4uaWQsIHZhbHVlOiB7IC4uLnJ1biwgc3RhdGU6IG5leHQsIGVuZGVkQXQgfSB9KVxuICAgICAgICBpZiAoYWxsRG9uZSAmJiBydW4uc3RhdGUgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7IGlkOiBgcnVuLmRvbmU6JHtydW4uaWR9YCwgdHM6IGVuZGVkQXQgPz8gdGhpcy5jdHgubm93KCksIGtpbmQ6ICdvcmNoZXN0cmF0aW9uLmNvbXBsZXRlZCcsIHNvdXJjZTogJ2NsaS1wb2xsJywgZW50aXR5SWQ6IHJ1bi5pZCwgcnVuSWQ6IHJ1bi5pZCwgc3VtbWFyeTogYFJ1biAke25leHR9OiAke3RydW5jYXRlKHJ1bi5vYmplY3RpdmUsIDEwMCl9YCB9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXBXb3JrZXJTdGF0ZShyb3c6IHsgc3RhdGU6IHN0cmluZzsgbGl2ZW5lc3M/OiBzdHJpbmcgfSk6IEFnZW50UnVudGltZVN0YXRlIHtcbiAgY29uc3Qgc3RhdGUgPSByb3cuc3RhdGUudG9Mb3dlckNhc2UoKVxuICBpZiAoc3RhdGUgPT09ICdzdWNjZWVkZWQnIHx8IHN0YXRlID09PSAnY29tcGxldGVkJyB8fCBzdGF0ZSA9PT0gJ3NldHRsZWQnKSByZXR1cm4gJ2RvbmUnXG4gIGlmIChzdGF0ZSA9PT0gJ2ZhaWxlZCcgfHwgc3RhdGUgPT09ICdvdXRjb21lX3Vua25vd24nKSByZXR1cm4gJ2ZhaWxlZCdcbiAgaWYgKHN0YXRlID09PSAnc3RvcHBlZCcgfHwgc3RhdGUgPT09ICdhYmFuZG9uZWQnIHx8IHN0YXRlID09PSAnZmVuY2VkJyB8fCBzdGF0ZSA9PT0gJ2NhbmNlbGxlZCcpIHJldHVybiAnZG9uZSdcbiAgaWYgKHN0YXRlID09PSAnYmxvY2tlZCcgfHwgc3RhdGUgPT09ICdwZXJtaXNzaW9uJykgcmV0dXJuICdibG9ja2VkJ1xuICBpZiAoc3RhdGUgPT09ICdyZWFkeScpIHJldHVybiBpc0xpdmVXb3JrZXIocm93KSA/ICd3YWl0aW5nJyA6ICdpZGxlJ1xuICBpZiAoc3RhdGUgPT09ICdzdGFydGluZycgfHwgc3RhdGUgPT09ICdydW5uaW5nJyB8fCBzdGF0ZSA9PT0gJ3dvcmtpbmcnIHx8IHN0YXRlID09PSAnZGlzcGF0Y2hlZCcpIHJldHVybiAnd29ya2luZydcbiAgcmV0dXJuICd1bmtub3duJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNMaXZlV29ya2VyKHJvdzogeyBzdGF0ZTogc3RyaW5nOyBsaXZlbmVzcz86IHN0cmluZyB9KTogYm9vbGVhbiB7XG4gIGNvbnN0IGxpdmVuZXNzID0gKHJvdy5saXZlbmVzcyA/PyAnJykudG9Mb3dlckNhc2UoKVxuICBpZiAobGl2ZW5lc3MgPT09ICdleGl0ZWQnIHx8IGxpdmVuZXNzID09PSAnc3RvcHBlZCcpIHJldHVybiBmYWxzZVxuICBpZiAobGl2ZW5lc3MgPT09ICdhbGl2ZScgfHwgbGl2ZW5lc3MgPT09ICdydW5uaW5nJyB8fCBsaXZlbmVzcyA9PT0gJ2xpdmUnKSByZXR1cm4gdHJ1ZVxuICBjb25zdCBzdGF0ZSA9IHJvdy5zdGF0ZS50b0xvd2VyQ2FzZSgpXG4gIHJldHVybiBsaXZlbmVzcyAhPT0gJ3VudmVyaWZpYWJsZScgJiYgKHN0YXRlID09PSAnc3RhcnRpbmcnIHx8IHN0YXRlID09PSAncnVubmluZycgfHwgc3RhdGUgPT09ICd3b3JraW5nJylcbn1cblxuZnVuY3Rpb24gdGFza0V2ZW50S2luZChzdGF0ZTogVGFza1N0YXRlLCBraW5kOiBzdHJpbmcpOiBGbG93RXZlbnRLaW5kIHtcbiAgc3dpdGNoIChzdGF0ZSkge1xuICAgIGNhc2UgJ1JVTk5JTkcnOlxuICAgICAgcmV0dXJuICd0YXNrLnN0YXJ0ZWQnXG4gICAgY2FzZSAnUkVWSUVXJzpcbiAgICAgIHJldHVybiAncmV2aWV3LnN0YXJ0ZWQnXG4gICAgY2FzZSAnVEVTVElORyc6XG4gICAgICByZXR1cm4gJ3Rlc3Quc3RhcnRlZCdcbiAgICBjYXNlICdET05FJzpcbiAgICBjYXNlICdNRVJHRUQnOlxuICAgIGNhc2UgJ0FQUFJPVkVEJzpcbiAgICAgIHJldHVybiBraW5kID09PSAncmV2aWV3JyA/ICdyZXZpZXcuY29tcGxldGVkJyA6IGtpbmQgPT09ICd0ZXN0JyA/ICd0ZXN0LmNvbXBsZXRlZCcgOiAndGFzay5jb21wbGV0ZWQnXG4gICAgY2FzZSAnRkFJTEVEJzpcbiAgICAgIHJldHVybiAndGFzay5mYWlsZWQnXG4gICAgY2FzZSAnQkxPQ0tFRCc6XG4gICAgICByZXR1cm4gJ3Rhc2suYmxvY2tlZCdcbiAgICBjYXNlICdSRVRSWUlORyc6XG4gICAgICByZXR1cm4gJ3Rhc2sucmV0cmllZCdcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICd0YXNrLnVwZGF0ZWQnXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VSZXN1bHQodmFsdWU6IHVua25vd24pOiBUYXNrUmVjb3JkWydyZXN1bHQnXSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsIHx8IHZhbHVlID09PSAnJykgcmV0dXJuIG51bGxcbiAgY29uc3QgcGFyc2VkID0gcGFyc2VKc29uKHZhbHVlKVxuICBpZiAoIU9iamVjdC5rZXlzKHBhcnNlZCkubGVuZ3RoKSB7XG4gICAgLy8gT3JjYSdzIGRvY3VtZW50ZWQgY2FuY2VsIGlzIGAtLXN0YXR1cyBmYWlsZWQgLS1yZXN1bHQgY2FuY2VsbGVkYDogYSBwbGFpbi10ZXh0IHJlc3VsdC5cbiAgICBjb25zdCB0ZXh0ID0gU3RyaW5nKHZhbHVlKS50cmltKClcbiAgICBjb25zdCBvdXRjb21lID0gL14oY2FuY2VsKGwpP2VkfGNhbmNlbGxhdGlvbikkL2kudGVzdCh0ZXh0KSA/ICdjYW5jZWxsZWQnIDogbnVsbFxuICAgIHJldHVybiB7IG91dGNvbWUsIG1lc3NhZ2U6IHJlZGFjdCh0cnVuY2F0ZSh0ZXh0LCA0MDAwKSksIGZpbGVzTW9kaWZpZWQ6IFtdLCByYXc6IG51bGwgfVxuICB9XG4gIGNvbnN0IGZpbGVzID0gQXJyYXkuaXNBcnJheShwYXJzZWQuZmlsZXNNb2RpZmllZCkgPyBwYXJzZWQuZmlsZXNNb2RpZmllZC5maWx0ZXIoKGYpOiBmIGlzIHN0cmluZyA9PiB0eXBlb2YgZiA9PT0gJ3N0cmluZycpLnNsaWNlKDAsIDIwMCkgOiBbXVxuICByZXR1cm4ge1xuICAgIG91dGNvbWU6IHN0cihwYXJzZWQub3V0Y29tZSksXG4gICAgbWVzc2FnZTogcGFyc2VkLm1lc3NhZ2UgPyByZWRhY3QodHJ1bmNhdGUoU3RyaW5nKHBhcnNlZC5tZXNzYWdlKSwgNDAwMCkpIDogbnVsbCxcbiAgICBmaWxlc01vZGlmaWVkOiBmaWxlcyxcbiAgICAvLyBUaGUgcmF3IEpTT04gaXMgbmV2ZXIgc2hvd247IGxlYXZpbmcgaXQgb3V0IGtlZXBzIHNuYXBzaG90cyBhbmQgZGVsdGFzIHNtYWxsLlxuICAgIHJhdzogbnVsbFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRGVwcyh2YWx1ZTogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuZmlsdGVyKCh2KTogdiBpcyBzdHJpbmcgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHZhbHVlKVxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFyc2VkKSA/IHBhcnNlZC5maWx0ZXIoKHYpOiB2IGlzIHN0cmluZyA9PiB0eXBlb2YgdiA9PT0gJ3N0cmluZycpIDogW11cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zcGxpdCgnLCcpLm1hcCgocykgPT4gcy50cmltKCkpLmZpbHRlcihCb29sZWFuKVxuICAgIH1cbiAgfVxuICByZXR1cm4gW11cbn1cblxuZnVuY3Rpb24gcGFyc2VKc29uKHZhbHVlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIHt9XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZSh2YWx1ZSlcbiAgICByZXR1cm4gcGFyc2VkICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQgOiB7fVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4ge31cbiAgfVxufVxuXG5mdW5jdGlvbiBhc1JlY29yZCh2YWx1ZTogdW5rbm93bik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA6IHt9XG59XG5cbmZ1bmN0aW9uIHNwbGl0V29ya3NwYWNlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBbc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbF0ge1xuICBpZiAoIXZhbHVlKSByZXR1cm4gW251bGwsIG51bGxdXG4gIGNvbnN0IGluZGV4ID0gdmFsdWUuaW5kZXhPZignOjonKVxuICByZXR1cm4gaW5kZXggPj0gMCA/IFt2YWx1ZS5zbGljZSgwLCBpbmRleCksIHZhbHVlLnNsaWNlKGluZGV4ICsgMildIDogW251bGwsIHZhbHVlXVxufVxuXG5mdW5jdGlvbiBsZWFkRm9yKGhhbmRsZTogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICByZXR1cm4gaGFuZGxlPy5zdGFydHNXaXRoKCdydW46JykgPyBgbGVhZDoke2hhbmRsZS5zbGljZSg0KX1gIDogbnVsbFxufVxuIiwgIi8vIFRva2VuIGFuZCBtZXNzYWdlIGNvdW50cyBmcm9tIE9yY2EncyBBZ2VudCBTZXNzaW9uIEhpc3RvcnkgKGhpc3Rvcnk6cmVhZCkuXG5pbXBvcnQgdHlwZSB7IFdvcmtlckNvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0LnRzJ1xuXG5leHBvcnQgY2xhc3MgU2Vzc2lvbnNBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjdHg6IFdvcmtlckNvbnRleHQpIHt9XG5cbiAgYXN5bmMgcmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGhvc3QgfSA9IHRoaXMuY3R4Lm9yY2FcbiAgICBpZiAoIWhvc3QuaGFzKCdhZ2VudC5saXN0U2Vzc2lvbnMnKSkgcmV0dXJuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgc2Vzc2lvbnMgfSA9IGF3YWl0IGhvc3QuY2FsbCgnYWdlbnQubGlzdFNlc3Npb25zJywgeyBsaW1pdDogMjAwIH0pXG4gICAgICBjb25zdCBieVNlc3Npb24gPSBuZXcgTWFwKHNlc3Npb25zLm1hcCgoc2Vzc2lvbikgPT4gW3Nlc3Npb24uc2Vzc2lvbklkLCBzZXNzaW9uXSkpXG4gICAgICBmb3IgKGNvbnN0IGFnZW50IG9mIE9iamVjdC52YWx1ZXModGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50cykpIHtcbiAgICAgICAgaWYgKCFhZ2VudC5zZXNzaW9uSWQpIGNvbnRpbnVlXG4gICAgICAgIGNvbnN0IHNlc3Npb24gPSBieVNlc3Npb24uZ2V0KGFnZW50LnNlc3Npb25JZClcbiAgICAgICAgaWYgKCFzZXNzaW9uKSBjb250aW51ZVxuICAgICAgICBpZiAoYWdlbnQudG9rZW5zID09PSBzZXNzaW9uLnRvdGFsVG9rZW5zICYmIGFnZW50Lm1lc3NhZ2VDb3VudCA9PT0gc2Vzc2lvbi5tZXNzYWdlQ291bnQpIGNvbnRpbnVlXG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgICAgIGFnZW50LmlkLFxuICAgICAgICAgIGFnZW50Lmxhc3RTZWVuQXQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgdG9rZW5zOiBzZXNzaW9uLnRvdGFsVG9rZW5zLFxuICAgICAgICAgICAgbWVzc2FnZUNvdW50OiBzZXNzaW9uLm1lc3NhZ2VDb3VudCxcbiAgICAgICAgICAgIGFnZW50OiBhZ2VudC5hZ2VudCA/PyBzZXNzaW9uLmFnZW50LFxuICAgICAgICAgICAgdGl0bGU6IGFnZW50LnRpdGxlID8/IHNlc3Npb24udGl0bGUsXG4gICAgICAgICAgICBicmFuY2g6IGFnZW50LmJyYW5jaCA/PyBzZXNzaW9uLmJyYW5jaCA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICBldmlkZW5jZTogWydob3N0LWNhbGwnXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgKCkgPT4gYWdlbnRcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmN0eC5sb2coYGFnZW50Lmxpc3RTZXNzaW9ucyBmYWlsZWQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgfVxuICB9XG59XG4iLCAiLy8gQ2xhdWRlIHN1YmFnZW50cyBmcm9tIHRoZSBhZ2VudC50b29sLmJlZm9yZS9hZnRlciBob29rcy4gQ2xhdWRlIENvZGUgc3Bhd25zIHN1YmFnZW50cyB3aXRoIGl0c1xuLy8gYEFnZW50YCB0b29sIChvbGRlciB2ZXJzaW9uczogYFRhc2tgKTsgdGhlIGhvb2sgY2FycmllcyB0aGUgY2FsbCBpZCBhbmQgdGhlIHN1YmFnZW50J3MgYnJpZWYuXG4vLyBPdGhlciBhZ2VudHMgZG8gbm90IHJlcG9ydCBzdWJhZ2VudCBpZGVudGl0eSwgc28gbm90aGluZyBpcyBkcmF3biBmb3IgdGhlbS5cbmltcG9ydCB7IHJlZGFjdCwgdHJ1bmNhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuaW1wb3J0IHsgbmV3QWdlbnQsIHR5cGUgV29ya2VyQ29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQudHMnXG5cbmV4cG9ydCBjb25zdCBTVUJBR0VOVF9UT09MUyA9IG5ldyBTZXQoWydBZ2VudCcsICdUYXNrJ10pXG5cbnR5cGUgVG9vbEV2ZW50ID0ge1xuICBhZ2VudDogc3RyaW5nXG4gIHdvcmtzcGFjZUlkOiBzdHJpbmcgfCBudWxsXG4gIHRlcm1pbmFsSWQ/OiBzdHJpbmdcbiAgdG9vbDogc3RyaW5nXG4gIGlucHV0OiB1bmtub3duXG4gIGNhbGxJZD86IHN0cmluZ1xuICBvdXRwdXQ/OiB1bmtub3duXG59XG5cbmV4cG9ydCBjbGFzcyBTdWJhZ2VudEFkYXB0ZXIge1xuICBwcml2YXRlIGZhbGxiYWNrQ291bnRlciA9IDBcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN0eDogV29ya2VyQ29udGV4dCkge31cblxuICAvKiogTXVzdCByZXR1cm4gZmFzdDogQ2xhdWRlIENvZGUgd2FpdHMgZm9yIHRoaXMgaG9vay4gTmV2ZXIgZGVuaWVzLiAqL1xuICBvblRvb2xCZWZvcmUoZXZlbnQ6IFRvb2xFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgY29uc3QgcGFyZW50SWQgPSB0aGlzLnJlc29sdmVQYXJlbnQoZXZlbnQpXG4gICAgY29uc3QgY2FsbEtleSA9IGV2ZW50LmNhbGxJZCA/PyBgJHtldmVudC50ZXJtaW5hbElkID8/ICduYSd9LSR7bm93fS0keysrdGhpcy5mYWxsYmFja0NvdW50ZXJ9YFxuICAgIHRoaXMucmVjb3JkVG9vbENhbGwoY2FsbEtleSwgZXZlbnQsIHBhcmVudElkLCAnc3RhcnRlZCcsIG5vdylcbiAgICBpZiAoIVNVQkFHRU5UX1RPT0xTLmhhcyhldmVudC50b29sKSkgcmV0dXJuXG4gICAgY29uc3QgaW5wdXQgPSBhc1JlY29yZChldmVudC5pbnB1dClcbiAgICBjb25zdCBpZCA9IGBzdWI6JHtjYWxsS2V5fWBcbiAgICBjb25zdCBwYXJlbnQgPSBwYXJlbnRJZCA/IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbcGFyZW50SWRdIDogdW5kZWZpbmVkXG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBzdHIoaW5wdXQuZGVzY3JpcHRpb24pID8/IHN0cihpbnB1dC5wcm9tcHQpPy5zbGljZSgwLCAxMjApID8/IG51bGxcbiAgICB0aGlzLmN0eC5zdG9yZS51cHNlcnRBZ2VudChcbiAgICAgIGlkLFxuICAgICAgbm93LFxuICAgICAge1xuICAgICAgICByb2xlOiAnc3ViYWdlbnQnLFxuICAgICAgICBhZ2VudDogZXZlbnQuYWdlbnQsXG4gICAgICAgIHBhcmVudElkLFxuICAgICAgICBjYWxsSWQ6IGV2ZW50LmNhbGxJZCA/PyBudWxsLFxuICAgICAgICBzdWJhZ2VudFR5cGU6IHN0cihpbnB1dC5zdWJhZ2VudF90eXBlKSA/PyAnZ2VuZXJhbC1wdXJwb3NlJyxcbiAgICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uID8gcmVkYWN0KGRlc2NyaXB0aW9uKSA6IG51bGwsXG4gICAgICAgIHRpdGxlOiBzdHIoaW5wdXQuZGVzY3JpcHRpb24pID8/IHN0cihpbnB1dC5zdWJhZ2VudF90eXBlKSA/PyAnU3ViYWdlbnQnLFxuICAgICAgICBtb2RlbDogc3RyKGlucHV0Lm1vZGVsKSxcbiAgICAgICAgd29ya3NwYWNlSWQ6IGV2ZW50LndvcmtzcGFjZUlkID8/IHBhcmVudD8ud29ya3NwYWNlSWQgPz8gbnVsbCxcbiAgICAgICAgd29ya3RyZWVQYXRoOiBwYXJlbnQ/Lndvcmt0cmVlUGF0aCA/PyBudWxsLFxuICAgICAgICBicmFuY2g6IHBhcmVudD8uYnJhbmNoID8/IG51bGwsXG4gICAgICAgIHJ1bklkOiBwYXJlbnQ/LnJ1bklkID8/IG51bGwsXG4gICAgICAgIHRhc2tJZDogcGFyZW50Py50YXNrSWQgPz8gbnVsbCxcbiAgICAgICAgYWNjb3VudDogcGFyZW50Py5hY2NvdW50ID8/IG51bGwsXG4gICAgICAgIHN0YXRlOiAnd29ya2luZycsXG4gICAgICAgIGxpdmU6IHRydWUsXG4gICAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgICBzdGF0ZVNpbmNlOiBub3csXG4gICAgICAgIGV2aWRlbmNlOiBbJ2hvb2snXVxuICAgICAgfSxcbiAgICAgICgpID0+IG5ld0FnZW50KGlkLCAnc3ViYWdlbnQnLCBub3cpXG4gICAgKVxuICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoe1xuICAgICAgdHM6IG5vdyxcbiAgICAgIGtpbmQ6ICdzdWJhZ2VudC5zcGF3bmVkJyxcbiAgICAgIHNvdXJjZTogJ2hvb2snLFxuICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgdGFyZ2V0SWQ6IHBhcmVudElkLFxuICAgICAgcnVuSWQ6IHBhcmVudD8ucnVuSWQgPz8gbnVsbCxcbiAgICAgIHN1bW1hcnk6IGAke3BhcmVudD8udGl0bGUgPz8gZXZlbnQuYWdlbnR9IHNwYXduZWQgc3ViYWdlbnQ6ICR7dHJ1bmNhdGUoZGVzY3JpcHRpb24gPz8gJ3N1YmFnZW50JywgMTAwKX1gXG4gICAgfSlcbiAgfVxuXG4gIG9uVG9vbEFmdGVyKGV2ZW50OiBUb29sRXZlbnQpOiB2b2lkIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmN0eC5ub3coKVxuICAgIGNvbnN0IHBhcmVudElkID0gdGhpcy5yZXNvbHZlUGFyZW50KGV2ZW50KVxuICAgIGlmIChldmVudC5jYWxsSWQpIHRoaXMucmVjb3JkVG9vbENhbGwoZXZlbnQuY2FsbElkLCBldmVudCwgcGFyZW50SWQsICdmaW5pc2hlZCcsIG5vdylcbiAgICBpZiAoIVNVQkFHRU5UX1RPT0xTLmhhcyhldmVudC50b29sKSB8fCAhZXZlbnQuY2FsbElkKSByZXR1cm5cbiAgICBjb25zdCBpZCA9IGBzdWI6JHtldmVudC5jYWxsSWR9YFxuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1tpZF1cbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm5cbiAgICBjb25zdCBmYWlsZWQgPSBsb29rc0ZhaWxlZChldmVudC5vdXRwdXQpXG4gICAgdGhpcy5jdHguc3RvcmUudXBzZXJ0QWdlbnQoaWQsIG5vdywgeyBzdGF0ZTogZmFpbGVkID8gJ2ZhaWxlZCcgOiAnZG9uZScsIG91dGNvbWU6IGZhaWxlZCA/ICdmYWlsdXJlJyA6ICdzdWNjZXNzJywgbGl2ZTogZmFsc2UsIGVuZGVkQXQ6IG5vdywgc3RhdGVTaW5jZTogbm93LCBldmlkZW5jZTogWydob29rJ10gfSwgKCkgPT4gZXhpc3RpbmcpXG4gICAgdGhpcy5jdHguc3RvcmUuZW1pdCh7XG4gICAgICB0czogbm93LFxuICAgICAga2luZDogJ3N1YmFnZW50LmNvbXBsZXRlZCcsXG4gICAgICBzb3VyY2U6ICdob29rJyxcbiAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgIHRhcmdldElkOiBleGlzdGluZy5wYXJlbnRJZCxcbiAgICAgIHJ1bklkOiBleGlzdGluZy5ydW5JZCxcbiAgICAgIHN1bW1hcnk6IGBTdWJhZ2VudCAke2V4aXN0aW5nLnRpdGxlID8/ICcnfSAke2ZhaWxlZCA/ICdmYWlsZWQnIDogJ2ZpbmlzaGVkJ31gLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVQYXJlbnQoZXZlbnQ6IFRvb2xFdmVudCk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGRpcmVjdCA9IHRoaXMuY3R4LmlkZW50aXR5LnJlc29sdmUoeyB0ZXJtaW5hbElkOiBldmVudC50ZXJtaW5hbElkID8/IG51bGwgfSlcbiAgICBpZiAoZGlyZWN0KSByZXR1cm4gZGlyZWN0XG4gICAgaWYgKCFldmVudC53b3Jrc3BhY2VJZCkgcmV0dXJuIG51bGxcbiAgICAvLyBPbmx5IGF0dHJpYnV0ZSBieSB3b3Jrc3BhY2Ugd2hlbiBleGFjdGx5IG9uZSBsaXZlIGFnZW50IG9mIHRoYXQga2luZCBpcyB0aGVyZS5cbiAgICBjb25zdCBjYW5kaWRhdGVzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzKS5maWx0ZXIoXG4gICAgICAoYWdlbnQpID0+IGFnZW50LnJvbGUgIT09ICdzdWJhZ2VudCcgJiYgYWdlbnQubGl2ZSAmJiBhZ2VudC53b3Jrc3BhY2VJZCA9PT0gZXZlbnQud29ya3NwYWNlSWQgJiYgKGFnZW50LmFnZW50ID8/IGV2ZW50LmFnZW50KSA9PT0gZXZlbnQuYWdlbnRcbiAgICApXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMubGVuZ3RoID09PSAxID8gY2FuZGlkYXRlc1swXS5pZCA6IG51bGxcbiAgfVxuXG4gIHByaXZhdGUgcmVjb3JkVG9vbENhbGwoY2FsbEtleTogc3RyaW5nLCBldmVudDogVG9vbEV2ZW50LCBhZ2VudElkOiBzdHJpbmcgfCBudWxsLCBwaGFzZTogJ3N0YXJ0ZWQnIHwgJ2ZpbmlzaGVkJywgbm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmN0eC5zdG9yZS5wdXQoe1xuICAgICAgZW50aXR5OiAndG9vbENhbGwnLFxuICAgICAgaWQ6IGNhbGxLZXksXG4gICAgICB2YWx1ZTogeyBpZDogY2FsbEtleSwgYWdlbnRJZCwgdGVybWluYWxJZDogZXZlbnQudGVybWluYWxJZCA/PyBudWxsLCB0b29sOiBldmVudC50b29sLCBzdW1tYXJ5OiBzdW1tYXJpemVJbnB1dChldmVudC50b29sLCBldmVudC5pbnB1dCksIGF0OiBub3csIHBoYXNlIH1cbiAgICB9KVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdW1tYXJpemVJbnB1dCh0b29sOiBzdHJpbmcsIGlucHV0OiB1bmtub3duKTogc3RyaW5nIHtcbiAgY29uc3QgcmVjb3JkID0gYXNSZWNvcmQoaW5wdXQpXG4gIGNvbnN0IHBpY2sgPSBzdHIocmVjb3JkLmRlc2NyaXB0aW9uKSA/PyBzdHIocmVjb3JkLmNvbW1hbmQpID8/IHN0cihyZWNvcmQuZmlsZV9wYXRoKSA/PyBzdHIocmVjb3JkLnBhdHRlcm4pID8/IHN0cihyZWNvcmQudXJsKSA/PyBzdHIocmVjb3JkLnByb21wdClcbiAgcmV0dXJuIHJlZGFjdCh0cnVuY2F0ZShwaWNrID8/IHRvb2wsIDE2MCkpXG59XG5cbmZ1bmN0aW9uIGxvb2tzRmFpbGVkKG91dHB1dDogdW5rbm93bik6IGJvb2xlYW4ge1xuICBjb25zdCByZWNvcmQgPSBhc1JlY29yZChvdXRwdXQpXG4gIGlmIChyZWNvcmQuaXNfZXJyb3IgPT09IHRydWUgfHwgcmVjb3JkLmlzRXJyb3IgPT09IHRydWUpIHJldHVybiB0cnVlXG4gIGNvbnN0IHN0YXR1cyA9IHN0cihyZWNvcmQuc3RhdHVzKVxuICByZXR1cm4gc3RhdHVzID09PSAnZXJyb3InIHx8IHN0YXR1cyA9PT0gJ2ZhaWxlZCdcbn1cblxuZnVuY3Rpb24gYXNSZWNvcmQodmFsdWU6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgOiB7fVxufVxuXG5mdW5jdGlvbiBzdHIodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbFxufVxuIiwgIi8vIENsYXVkZSBzdWJhZ2VudHMgZm9yIGV2ZXJ5IENsYXVkZSBzZXNzaW9uICh0ZXJtaW5hbCBvciBjaGF0KSwgZnJvbSB0aGUgZmlsZXMgQ2xhdWRlIENvZGUgaXRzZWxmXG4vLyB3cml0ZXM6IDxwcm9qZWN0cz4vPHByb2plY3Q+LzxzZXNzaW9uPi9zdWJhZ2VudHMvYWdlbnQtPGlkPi5tZXRhLmpzb24gKCsgLmpzb25sIHRyYW5zY3JpcHQpLlxuLy8gVGhlIG1ldGEgZmlsZSBuYW1lcyB0aGUgc3Bhd25pbmcgdG9vbCBjYWxsIChgdG9vbFVzZUlkYCksIHRoZSBzYW1lIGlkIE9yY2EncyB0b29sIGhvb2sgcmVwb3J0cyxcbi8vIHNvIGEgc3ViYWdlbnQgc2VlbiBieSBib3RoIHNvdXJjZXMgaXMgb25lIG5vZGUuIFJlYWQtb25seTsgbm90aGluZyBpcyB3cml0dGVuLlxuaW1wb3J0IHsgb3BlbiwgcmVhZGRpciwgcmVhZEZpbGUsIHJlYWxwYXRoLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQgfSBmcm9tICcuLi8uLi9zaGFyZWQvbW9kZWwudHMnXG5pbXBvcnQgeyByZWRhY3RBbmRUcnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5pbXBvcnQgeyBuZXdBZ2VudCwgdHlwZSBXb3JrZXJDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dC50cydcblxudHlwZSBNZXRhID0geyBhZ2VudFR5cGU/OiBzdHJpbmc7IGRlc2NyaXB0aW9uPzogc3RyaW5nOyB0b29sVXNlSWQ/OiBzdHJpbmc7IG1vZGVsPzogc3RyaW5nOyBmaW5pc2hlZD86IGJvb2xlYW47IHNwYXduRGVwdGg/OiBudW1iZXIgfVxuXG4vKipcbiAqIEEgc3ViYWdlbnQgc3RpbGwgd3JpdGluZyB3aXRoaW4gdGhpcyB3aW5kb3cgY291bnRzIGFzIHdvcmtpbmcsIGV2ZW4gd2hlbiBpdHMgcGFyZW50J3Mgb3duIHR1cm4gaGFzXG4gKiBlbmRlZDogQ2xhdWRlIHJ1bnMgYmFja2dyb3VuZCBhZ2VudHMgb24gYWZ0ZXIgdGhlIGxlYWQgcmVwbGllcyAoT3JjYSB0aGVuIHJlcG9ydHMgdGhlIGxlYWQgYXMgZG9uZSkuXG4gKiBJZiB0aGUgc2Vzc2lvbiByZWFsbHkgc3RvcHMsIHRoZSBzdWJhZ2VudCBzdG9wcyB3cml0aW5nIGFuZCBnb2VzIHF1aWV0IHdpdGhpbiB0aGlzIHdpbmRvdy5cbiAqL1xuY29uc3QgQUNUSVZFX1dSSVRFX01TID0gOTBfMDAwXG5jb25zdCBSRUNFTlRfU0VTU0lPTl9NUyA9IDYgKiA2MCAqIDYwICogMTAwMFxuY29uc3QgRElSX1JFVFJZX01TID0gNjBfMDAwXG5jb25zdCBNQVhfU0VTU0lPTlNfUEVSX1NDQU4gPSA0MFxuY29uc3QgTUFYX01FVEFfQ0FDSEUgPSAyMDAwXG5cbmV4cG9ydCBjbGFzcyBTdWJhZ2VudEZpbGVzQWRhcHRlciB7XG4gIHByaXZhdGUgc2Vzc2lvbkRpcnMgPSBuZXcgTWFwPHN0cmluZywgeyBkaXI6IHN0cmluZyB8IG51bGw7IGNoZWNrZWRBdDogbnVtYmVyIH0+KClcbiAgcHJpdmF0ZSBzZWVuTXRpbWUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpXG4gIHByaXZhdGUgbWV0YUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgbXRpbWU6IG51bWJlcjsgbWV0YTogTWV0YSB9PigpXG4gIC8qKiBzdWJhZ2VudCBub2RlIGlkIFx1MjE5MiBpdHMgdHJhbnNjcmlwdCBmaWxlLCBmb3IgdGhlIE91dHB1dCB0YWIuICovXG4gIHByaXZhdGUgdHJhbnNjcmlwdHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG4gIHByaXZhdGUgc2Vzc2lvbkZpbGVzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3R4OiBXb3JrZXJDb250ZXh0LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY2xhdWRlSG9tZXM6ICgpID0+IHN0cmluZ1tdXG4gICkge31cblxuICB0cmFuc2NyaXB0Rm9yKGFnZW50SWQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnRyYW5zY3JpcHRzLmdldChhZ2VudElkKSA/PyBudWxsXG4gIH1cblxuICAvKiogVGhlIHRyYW5zY3JpcHQgb2YgYSBzdWJhZ2VudCwgb3Igb2YgYSBDbGF1ZGUgc2Vzc2lvbiAoY2hhdCBvciB0ZXJtaW5hbCkgYnkgaXRzIHNlc3Npb24gaWQuICovXG4gIGFzeW5jIHRyYW5zY3JpcHRQYXRoRm9yKGFnZW50OiBBZ2VudFJlY29yZCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGlmIChhZ2VudC5yb2xlID09PSAnc3ViYWdlbnQnKSByZXR1cm4gdGhpcy50cmFuc2NyaXB0Rm9yKGFnZW50LmlkKVxuICAgIGlmICghYWdlbnQuc2Vzc2lvbklkIHx8IChhZ2VudC5hZ2VudCAhPT0gJ2NsYXVkZScgJiYgYWdlbnQuYWdlbnQgIT09IG51bGwpKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMuc2Vzc2lvbkZpbGVzLmdldChhZ2VudC5zZXNzaW9uSWQpXG4gICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkXG4gICAgbGV0IGZvdW5kOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICAgIGZvciAoY29uc3Qgcm9vdCBvZiBhd2FpdCB0aGlzLnByb2plY3RSb290cygpKSB7XG4gICAgICBsZXQgcHJvamVjdHM6IHN0cmluZ1tdID0gW11cbiAgICAgIHRyeSB7XG4gICAgICAgIHByb2plY3RzID0gYXdhaXQgcmVhZGRpcihyb290KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHByb2plY3Qgb2YgcHJvamVjdHMpIHtcbiAgICAgICAgY29uc3QgZmlsZSA9IGpvaW4ocm9vdCwgcHJvamVjdCwgYCR7YWdlbnQuc2Vzc2lvbklkfS5qc29ubGApXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKChhd2FpdCBzdGF0KGZpbGUpKS5pc0ZpbGUoKSkge1xuICAgICAgICAgICAgZm91bmQgPSBmaWxlXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbm90IGhlcmVcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGZvdW5kKSBicmVha1xuICAgIH1cbiAgICBpZiAoZm91bmQpIHRoaXMuc2Vzc2lvbkZpbGVzLnNldChhZ2VudC5zZXNzaW9uSWQsIGZvdW5kKVxuICAgIHJldHVybiBmb3VuZFxuICB9XG5cbiAgYXN5bmMgc2NhbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmN0eC5ub3coKVxuICAgIGNvbnN0IHJvb3RzID0gYXdhaXQgdGhpcy5wcm9qZWN0Um9vdHMoKVxuICAgIGlmICghcm9vdHMubGVuZ3RoKSByZXR1cm5cbiAgICBjb25zdCBwYXJlbnRzID0gT2JqZWN0LnZhbHVlcyh0aGlzLmN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzKVxuICAgICAgLmZpbHRlcigoYSkgPT4gYS5zZXNzaW9uSWQgJiYgYS5yb2xlICE9PSAnc3ViYWdlbnQnICYmIChhLmFnZW50ID09PSAnY2xhdWRlJyB8fCBhLmFnZW50ID09PSBudWxsKSAmJiAoYS5saXZlIHx8IG5vdyAtIGEubGFzdFNlZW5BdCA8IFJFQ0VOVF9TRVNTSU9OX01TKSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYi5saXZlKSAtIE51bWJlcihhLmxpdmUpIHx8IGIubGFzdFNlZW5BdCAtIGEubGFzdFNlZW5BdClcbiAgICAgIC5zbGljZSgwLCBNQVhfU0VTU0lPTlNfUEVSX1NDQU4pXG4gICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50cykge1xuICAgICAgY29uc3QgZGlyID0gYXdhaXQgdGhpcy5zdWJhZ2VudERpcihyb290cywgcGFyZW50LnNlc3Npb25JZCEsIG5vdylcbiAgICAgIGlmIChkaXIpIGF3YWl0IHRoaXMuc2NhbkRpcihkaXIsIHBhcmVudCwgbm93KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvamVjdFJvb3RzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gW2pvaW4oaG9tZWRpcigpLCAnLmNsYXVkZScsICdwcm9qZWN0cycpLCAuLi50aGlzLmNsYXVkZUhvbWVzKCkubWFwKChob21lKSA9PiBqb2luKGhvbWUsICdwcm9qZWN0cycpKV1cbiAgICBjb25zdCBvdXQgPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dC5hZGQoYXdhaXQgcmVhbHBhdGgoY2FuZGlkYXRlKSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBub3QgdGhlcmVcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIFsuLi5vdXRdXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN1YmFnZW50RGlyKHJvb3RzOiBzdHJpbmdbXSwgc2Vzc2lvbklkOiBzdHJpbmcsIG5vdzogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3QgY2FjaGVkID0gdGhpcy5zZXNzaW9uRGlycy5nZXQoc2Vzc2lvbklkKVxuICAgIGlmIChjYWNoZWQgJiYgKGNhY2hlZC5kaXIgfHwgbm93IC0gY2FjaGVkLmNoZWNrZWRBdCA8IERJUl9SRVRSWV9NUykpIHJldHVybiBjYWNoZWQuZGlyXG4gICAgbGV0IGZvdW5kOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICAgIGZvciAoY29uc3Qgcm9vdCBvZiByb290cykge1xuICAgICAgbGV0IHByb2plY3RzOiBzdHJpbmdbXVxuICAgICAgdHJ5IHtcbiAgICAgICAgcHJvamVjdHMgPSBhd2FpdCByZWFkZGlyKHJvb3QpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgcHJvamVjdCBvZiBwcm9qZWN0cykge1xuICAgICAgICBjb25zdCBkaXIgPSBqb2luKHJvb3QsIHByb2plY3QsIHNlc3Npb25JZCwgJ3N1YmFnZW50cycpXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKChhd2FpdCBzdGF0KGRpcikpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGZvdW5kID0gZGlyXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbm90IHRoaXMgcHJvamVjdFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZm91bmQpIGJyZWFrXG4gICAgfVxuICAgIHRoaXMuc2Vzc2lvbkRpcnMuc2V0KHNlc3Npb25JZCwgeyBkaXI6IGZvdW5kLCBjaGVja2VkQXQ6IG5vdyB9KVxuICAgIHJldHVybiBmb3VuZFxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuRGlyKGRpcjogc3RyaW5nLCBwYXJlbnQ6IEFnZW50UmVjb3JkLCBub3c6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBuYW1lczogc3RyaW5nW11cbiAgICB0cnkge1xuICAgICAgbmFtZXMgPSAoYXdhaXQgcmVhZGRpcihkaXIpKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUuZW5kc1dpdGgoJy5tZXRhLmpzb24nKSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgbmFtZXMpIHtcbiAgICAgIGNvbnN0IGJhc2UgPSBuYW1lLnNsaWNlKDAsIC0nLm1ldGEuanNvbicubGVuZ3RoKVxuICAgICAgY29uc3QgbWV0YVBhdGggPSBqb2luKGRpciwgbmFtZSlcbiAgICAgIGNvbnN0IHRyYW5zY3JpcHRQYXRoID0gam9pbihkaXIsIGAke2Jhc2V9Lmpzb25sYClcbiAgICAgIGxldCBtZXRhTXRpbWUgPSAwXG4gICAgICBsZXQgbXRpbWUgPSAwXG4gICAgICB0cnkge1xuICAgICAgICBtZXRhTXRpbWUgPSAoYXdhaXQgc3RhdChtZXRhUGF0aCkpLm10aW1lTXNcbiAgICAgICAgbXRpbWUgPSBNYXRoLm1heChtZXRhTXRpbWUsIGF3YWl0IHN0YXQodHJhbnNjcmlwdFBhdGgpLnRoZW4oKHMpID0+IHMubXRpbWVNcykuY2F0Y2goKCkgPT4gMCkpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIC8vIFRoZSBtZXRhIGZpbGUgcmFyZWx5IGNoYW5nZXMgKG9uY2UgYXQgc3Bhd24sIG9uY2UgYXQgZmluaXNoKTogcGFyc2UgaXQgb25seSB3aGVuIGl0IGRvZXMuXG4gICAgICBsZXQgbWV0YTogTWV0YVxuICAgICAgY29uc3QgY2FjaGVkTWV0YSA9IHRoaXMubWV0YUNhY2hlLmdldChtZXRhUGF0aClcbiAgICAgIGlmIChjYWNoZWRNZXRhICYmIGNhY2hlZE1ldGEubXRpbWUgPT09IG1ldGFNdGltZSkgbWV0YSA9IGNhY2hlZE1ldGEubWV0YVxuICAgICAgZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgbWV0YSA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUobWV0YVBhdGgsICd1dGY4JykpIGFzIE1ldGFcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm1ldGFDYWNoZS5zZXQobWV0YVBhdGgsIHsgbXRpbWU6IG1ldGFNdGltZSwgbWV0YSB9KVxuICAgICAgICBpZiAodGhpcy5tZXRhQ2FjaGUuc2l6ZSA+IE1BWF9NRVRBX0NBQ0hFKSB0aGlzLm1ldGFDYWNoZS5kZWxldGUodGhpcy5tZXRhQ2FjaGUua2V5cygpLm5leHQoKS52YWx1ZSEpXG4gICAgICB9XG4gICAgICBjb25zdCBpZCA9IG1ldGEudG9vbFVzZUlkID8gYHN1Yjoke21ldGEudG9vbFVzZUlkfWAgOiBgc3ViOmZpbGU6JHtiYXNlfWBcbiAgICAgIHRoaXMudHJhbnNjcmlwdHMuc2V0KGlkLCB0cmFuc2NyaXB0UGF0aClcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1tpZF1cbiAgICAgIGNvbnN0IHdyaXRpbmcgPSBub3cgLSBtdGltZSA8IEFDVElWRV9XUklURV9NU1xuICAgICAgY29uc3QgZmluaXNoZWQgPSBtZXRhLmZpbmlzaGVkID09PSB0cnVlXG4gICAgICBjb25zdCBsaXZlID0gIWZpbmlzaGVkICYmIHdyaXRpbmdcbiAgICAgIC8vIFVuY2hhbmdlZCBmaWxlcyBvbmx5IG5lZWQgYSBsaXZlbmVzcyByZWZyZXNoIChhIHN1YmFnZW50IGdvZXMgcXVpZXQgd2hlbiBpdHMgcGFyZW50IHN0b3BzKS5cbiAgICAgIGlmICh0aGlzLnNlZW5NdGltZS5nZXQoaWQpID09PSBtdGltZSAmJiBleGlzdGluZyAmJiBleGlzdGluZy5saXZlID09PSBsaXZlKSBjb250aW51ZVxuICAgICAgdGhpcy5zZWVuTXRpbWUuc2V0KGlkLCBtdGltZSlcbiAgICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IGV4aXN0aW5nPy5zdGFydGVkQXQgPz8gKGF3YWl0IGZpcnN0VGltZXN0YW1wKHRyYW5zY3JpcHRQYXRoKSkgPz8gbXRpbWVcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KFxuICAgICAgICBpZCxcbiAgICAgICAgbXRpbWUsXG4gICAgICAgIHtcbiAgICAgICAgICByb2xlOiAnc3ViYWdlbnQnLFxuICAgICAgICAgIGFnZW50OiAnY2xhdWRlJyxcbiAgICAgICAgICBwYXJlbnRJZDogZXhpc3Rpbmc/LnBhcmVudElkID8/IHBhcmVudC5pZCxcbiAgICAgICAgICBjYWxsSWQ6IG1ldGEudG9vbFVzZUlkID8/IG51bGwsXG4gICAgICAgICAgc3ViYWdlbnRUeXBlOiBtZXRhLmFnZW50VHlwZSA/PyBleGlzdGluZz8uc3ViYWdlbnRUeXBlID8/ICdnZW5lcmFsLXB1cnBvc2UnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBtZXRhLmRlc2NyaXB0aW9uID8gcmVkYWN0QW5kVHJ1bmNhdGUobWV0YS5kZXNjcmlwdGlvbiwgMzAwKSA6IGV4aXN0aW5nPy5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICAgIHRpdGxlOiBtZXRhLmRlc2NyaXB0aW9uID8gcmVkYWN0QW5kVHJ1bmNhdGUobWV0YS5kZXNjcmlwdGlvbiwgMTIwKSA6IGV4aXN0aW5nPy50aXRsZSA/PyAnU3ViYWdlbnQnLFxuICAgICAgICAgIG1vZGVsOiBtZXRhLm1vZGVsID8/IGV4aXN0aW5nPy5tb2RlbCA/PyBudWxsLFxuICAgICAgICAgIHJ1bklkOiBwYXJlbnQucnVuSWQsXG4gICAgICAgICAgdGFza0lkOiBwYXJlbnQudGFza0lkLFxuICAgICAgICAgIHdvcmtzcGFjZUlkOiBwYXJlbnQud29ya3NwYWNlSWQsXG4gICAgICAgICAgd29ya3RyZWVQYXRoOiBwYXJlbnQud29ya3RyZWVQYXRoLFxuICAgICAgICAgIGJyYW5jaDogcGFyZW50LmJyYW5jaCxcbiAgICAgICAgICBhY2NvdW50OiBwYXJlbnQuYWNjb3VudCxcbiAgICAgICAgICBzdGF0ZTogZmluaXNoZWQgPyAnZG9uZScgOiBsaXZlID8gJ3dvcmtpbmcnIDogJ3Vua25vd24nLFxuICAgICAgICAgIG91dGNvbWU6IGZpbmlzaGVkID8gJ3N1Y2Nlc3MnIDogbnVsbCxcbiAgICAgICAgICBsaXZlLFxuICAgICAgICAgIHN0YXJ0ZWRBdCxcbiAgICAgICAgICBzdGF0ZVNpbmNlOiBtdGltZSxcbiAgICAgICAgICBlbmRlZEF0OiBmaW5pc2hlZCA/IG10aW1lIDogbnVsbCxcbiAgICAgICAgICBldmlkZW5jZTogWydzZXNzaW9uLWZpbGUnXVxuICAgICAgICB9LFxuICAgICAgICAoKSA9PiBuZXdBZ2VudChpZCwgJ3N1YmFnZW50Jywgbm93KVxuICAgICAgKVxuICAgICAgaWYgKCFleGlzdGluZykge1xuICAgICAgICB0aGlzLmN0eC5zdG9yZS5lbWl0KHsgaWQ6IGBzdWJhZ2VudC5maWxlOiR7aWR9YCwgdHM6IHN0YXJ0ZWRBdCwga2luZDogJ3N1YmFnZW50LnNwYXduZWQnLCBzb3VyY2U6ICdzZXNzaW9uLWZpbGUnLCBlbnRpdHlJZDogaWQsIHRhcmdldElkOiBwYXJlbnQuaWQsIHJ1bklkOiBwYXJlbnQucnVuSWQsIHN1bW1hcnk6IGAke3BhcmVudC50aXRsZSA/PyAnQ2xhdWRlJ30gc3Bhd25lZCBzdWJhZ2VudDogJHttZXRhLmRlc2NyaXB0aW9uID8/IG1ldGEuYWdlbnRUeXBlID8/ICdzdWJhZ2VudCd9YCB9KVxuICAgICAgfSBlbHNlIGlmIChmaW5pc2hlZCAmJiBleGlzdGluZy5zdGF0ZSAhPT0gJ2RvbmUnKSB7XG4gICAgICAgIHRoaXMuY3R4LnN0b3JlLmVtaXQoeyBpZDogYHN1YmFnZW50LmRvbmU6JHtpZH1gLCB0czogbXRpbWUsIGtpbmQ6ICdzdWJhZ2VudC5jb21wbGV0ZWQnLCBzb3VyY2U6ICdzZXNzaW9uLWZpbGUnLCBlbnRpdHlJZDogaWQsIHRhcmdldElkOiBwYXJlbnQuaWQsIHJ1bklkOiBwYXJlbnQucnVuSWQsIHN1bW1hcnk6IGBTdWJhZ2VudCAke21ldGEuZGVzY3JpcHRpb24gPz8gJyd9IGZpbmlzaGVkYC50cmltKCkgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmlyc3RUaW1lc3RhbXAocGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgaGFuZGxlID0gYXdhaXQgb3BlbihwYXRoLCAncicpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgYnVmZmVyLCBieXRlc1JlYWQgfSA9IGF3YWl0IGhhbmRsZS5yZWFkKEJ1ZmZlci5hbGxvYyg4MTkyKSwgMCwgODE5MiwgMClcbiAgICAgIGNvbnN0IGxpbmUgPSBidWZmZXIuc3ViYXJyYXkoMCwgYnl0ZXNSZWFkKS50b1N0cmluZygndXRmOCcpLnNwbGl0KCdcXG4nKVswXVxuICAgICAgY29uc3QgdHMgPSAoSlNPTi5wYXJzZShsaW5lKSBhcyB7IHRpbWVzdGFtcD86IHN0cmluZyB9KS50aW1lc3RhbXBcbiAgICAgIGNvbnN0IG1zID0gdHMgPyBEYXRlLnBhcnNlKHRzKSA6IE5hTlxuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShtcykgPyBtcyA6IG51bGxcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgaGFuZGxlLmNsb3NlKClcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cbiIsICIvLyBUaGUgbW9kZWwgYW5kIGVmZm9ydCBhbiBhZ2VudCBpcyBhY3R1YWxseSB1c2luZywgcmVhZCBmcm9tIHRoZSBhZ2VudCBDTEkncyBvd24gc2Vzc2lvbiBmaWxlXG4vLyAodGhlIG5ld2VzdCB0dXJuIHdpbnMsIHNvIGEgbWlkLXNlc3Npb24gL21vZGVsIGNoYW5nZSBzaG93cyB1cCk6XG4vLyAgLSBDbGF1ZGU6IGFzc2lzdGFudCBlbnRyaWVzIGNhcnJ5IGBtZXNzYWdlLm1vZGVsYCwgcGx1cyBgZWZmb3J0YCAvIGBwZXJUdXJuRWZmb3J0YDtcbi8vICAtIENvZGV4OiBgdHVybl9jb250ZXh0YCBlbnRyaWVzIGNhcnJ5IGBtb2RlbGAgYW5kIGBlZmZvcnRgOyB0aGUgZmlsZSBuYW1lIGhvbGRzIHRoZSBzZXNzaW9uIGlkLlxuaW1wb3J0IHsgb3BlbiwgcmVhZGRpciwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBob21lZGlyIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgdHlwZSB7IEFnZW50UmVjb3JkIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHR5cGUgeyBXb3JrZXJDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dC50cydcbmltcG9ydCB0eXBlIHsgU3ViYWdlbnRGaWxlc0FkYXB0ZXIgfSBmcm9tICcuL3N1YmFnZW50LWZpbGVzLWFkYXB0ZXIudHMnXG5cbmNvbnN0IFRBSUxfQllURVMgPSAyNTYgKiAxMDI0XG5jb25zdCBSRUNFTlRfTVMgPSA2ICogNjAgKiA2MCAqIDEwMDBcbmNvbnN0IENPREVYX0lOREVYX01TID0gNjBfMDAwXG5cbmV4cG9ydCB0eXBlIE1vZGVsUmVhZGluZyA9IHsgbW9kZWw6IHN0cmluZyB8IG51bGw7IGVmZm9ydDogc3RyaW5nIHwgbnVsbCB9XG5cbmV4cG9ydCBjbGFzcyBTZXNzaW9uTW9kZWxBZGFwdGVyIHtcbiAgcHJpdmF0ZSBjb2RleEluZGV4ID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuICBwcml2YXRlIGNvZGV4SW5kZXhlZEF0ID0gMFxuICBwcml2YXRlIHNlZW4gPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjdHg6IFdvcmtlckNvbnRleHQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBjbGF1ZGVGaWxlczogU3ViYWdlbnRGaWxlc0FkYXB0ZXIsXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb2RleEhvbWVzOiAoKSA9PiBzdHJpbmdbXVxuICApIHt9XG5cbiAgYXN5bmMgcmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmN0eC5ub3coKVxuICAgIGNvbnN0IGFnZW50cyA9IE9iamVjdC52YWx1ZXModGhpcy5jdHguc3RvcmUucmVhZCgpLmFnZW50cykuZmlsdGVyKChhKSA9PiAoYS5saXZlIHx8IG5vdyAtIGEubGFzdFNlZW5BdCA8IFJFQ0VOVF9NUykgJiYgKGEuc2Vzc2lvbklkIHx8IGEucm9sZSA9PT0gJ3N1YmFnZW50JykpXG4gICAgZm9yIChjb25zdCBhZ2VudCBvZiBhZ2VudHMpIHtcbiAgICAgIGNvbnN0IHBhdGggPSBhd2FpdCB0aGlzLmZpbGVGb3IoYWdlbnQpXG4gICAgICBpZiAoIXBhdGgpIGNvbnRpbnVlXG4gICAgICBsZXQgbXRpbWUgPSAwXG4gICAgICB0cnkge1xuICAgICAgICBtdGltZSA9IChhd2FpdCBzdGF0KHBhdGgpKS5tdGltZU1zXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnNlZW4uZ2V0KGFnZW50LmlkKSA9PT0gbXRpbWUpIGNvbnRpbnVlXG4gICAgICB0aGlzLnNlZW4uc2V0KGFnZW50LmlkLCBtdGltZSlcbiAgICAgIGNvbnN0IHJlYWRpbmcgPSBhZ2VudC5hZ2VudCA9PT0gJ2NvZGV4JyA/IHJlYWRDb2RleE1vZGVsKGF3YWl0IHRhaWwocGF0aCkpIDogcmVhZENsYXVkZU1vZGVsKGF3YWl0IHRhaWwocGF0aCkpXG4gICAgICBpZiAoIXJlYWRpbmcubW9kZWwgJiYgIXJlYWRpbmcuZWZmb3J0KSBjb250aW51ZVxuICAgICAgY29uc3QgY3VycmVudCA9IHRoaXMuY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnQuaWRdXG4gICAgICBpZiAoIWN1cnJlbnQgfHwgKGN1cnJlbnQubW9kZWwgPT09IChyZWFkaW5nLm1vZGVsID8/IGN1cnJlbnQubW9kZWwpICYmIGN1cnJlbnQuZWZmb3J0ID09PSAocmVhZGluZy5lZmZvcnQgPz8gY3VycmVudC5lZmZvcnQpKSkgY29udGludWVcbiAgICAgIHRoaXMuY3R4LnN0b3JlLnVwc2VydEFnZW50KGFnZW50LmlkLCBjdXJyZW50Lmxhc3RTZWVuQXQsIHsgbW9kZWw6IHJlYWRpbmcubW9kZWwgPz8gdW5kZWZpbmVkLCBlZmZvcnQ6IHJlYWRpbmcuZWZmb3J0ID8/IHVuZGVmaW5lZCwgZXZpZGVuY2U6IFsnc2Vzc2lvbi1maWxlJ10gfSwgKCkgPT4gY3VycmVudClcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZpbGVGb3IoYWdlbnQ6IEFnZW50UmVjb3JkKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgaWYgKGFnZW50LmFnZW50ID09PSAnY29kZXgnKSByZXR1cm4gYWdlbnQuc2Vzc2lvbklkID8gYXdhaXQgdGhpcy5jb2RleEZpbGUoYWdlbnQuc2Vzc2lvbklkKSA6IG51bGxcbiAgICBpZiAoYWdlbnQuYWdlbnQgPT09ICdjbGF1ZGUnIHx8IGFnZW50LmFnZW50ID09PSBudWxsIHx8IGFnZW50LnJvbGUgPT09ICdzdWJhZ2VudCcpIHJldHVybiBhd2FpdCB0aGlzLmNsYXVkZUZpbGVzLnRyYW5zY3JpcHRQYXRoRm9yKGFnZW50KVxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvZGV4RmlsZShzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY3R4Lm5vdygpXG4gICAgaWYgKCF0aGlzLmNvZGV4SW5kZXguaGFzKHNlc3Npb25JZCkgJiYgbm93IC0gdGhpcy5jb2RleEluZGV4ZWRBdCA+IENPREVYX0lOREVYX01TKSB7XG4gICAgICB0aGlzLmNvZGV4SW5kZXhlZEF0ID0gbm93XG4gICAgICBmb3IgKGNvbnN0IGhvbWUgb2YgW2pvaW4oaG9tZWRpcigpLCAnLmNvZGV4JyksIC4uLnRoaXMuY29kZXhIb21lcygpXSkgYXdhaXQgaW5kZXhDb2RleFNlc3Npb25zKGpvaW4oaG9tZSwgJ3Nlc3Npb25zJyksIHRoaXMuY29kZXhJbmRleClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY29kZXhJbmRleC5nZXQoc2Vzc2lvbklkKSA/PyBudWxsXG4gIH1cbn1cblxuLyoqIHNlc3Npb25zL1lZWVkvTU0vREQvcm9sbG91dC08dGltZT4tPHNlc3Npb24gaWQ+Lmpzb25sLCBuZXdlc3QgZGF5cyBmaXJzdCwgYm91bmRlZC4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluZGV4Q29kZXhTZXNzaW9ucyhyb290OiBzdHJpbmcsIGluZGV4OiBNYXA8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGxpc3QgPSBhc3luYyAoZGlyOiBzdHJpbmcpID0+IChhd2FpdCByZWFkZGlyKGRpcikuY2F0Y2goKCkgPT4gW10gYXMgc3RyaW5nW10pKS5zb3J0KCkucmV2ZXJzZSgpXG4gIGxldCBkYXlzID0gMFxuICBmb3IgKGNvbnN0IHllYXIgb2YgYXdhaXQgbGlzdChyb290KSkge1xuICAgIGZvciAoY29uc3QgbW9udGggb2YgYXdhaXQgbGlzdChqb2luKHJvb3QsIHllYXIpKSkge1xuICAgICAgZm9yIChjb25zdCBkYXkgb2YgYXdhaXQgbGlzdChqb2luKHJvb3QsIHllYXIsIG1vbnRoKSkpIHtcbiAgICAgICAgaWYgKCsrZGF5cyA+IDQ1KSByZXR1cm5cbiAgICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGF3YWl0IGxpc3Qoam9pbihyb290LCB5ZWFyLCBtb250aCwgZGF5KSkpIHtcbiAgICAgICAgICBjb25zdCBtYXRjaCA9IC9ecm9sbG91dC0uKi0oWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17MTJ9KVxcLmpzb25sJC8uZXhlYyhuYW1lKVxuICAgICAgICAgIGlmIChtYXRjaCAmJiAhaW5kZXguaGFzKG1hdGNoWzFdKSkgaW5kZXguc2V0KG1hdGNoWzFdLCBqb2luKHJvb3QsIHllYXIsIG1vbnRoLCBkYXksIG5hbWUpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRhaWwocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCBoYW5kbGUgPSBhd2FpdCBvcGVuKHBhdGgsICdyJylcbiAgdHJ5IHtcbiAgICBjb25zdCBzaXplID0gKGF3YWl0IGhhbmRsZS5zdGF0KCkpLnNpemVcbiAgICBjb25zdCBzdGFydCA9IE1hdGgubWF4KDAsIHNpemUgLSBUQUlMX0JZVEVTKVxuICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5hbGxvYyhzaXplIC0gc3RhcnQpXG4gICAgYXdhaXQgaGFuZGxlLnJlYWQoYnVmZmVyLCAwLCBidWZmZXIubGVuZ3RoLCBzdGFydClcbiAgICBjb25zdCBsaW5lcyA9IGJ1ZmZlci50b1N0cmluZygndXRmOCcpLnNwbGl0KCdcXG4nKVxuICAgIGlmIChzdGFydCA+IDApIGxpbmVzLnNoaWZ0KClcbiAgICByZXR1cm4gbGluZXNcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBoYW5kbGUuY2xvc2UoKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkQ2xhdWRlTW9kZWwobGluZXM6IHN0cmluZ1tdKTogTW9kZWxSZWFkaW5nIHtcbiAgZm9yIChsZXQgaSA9IGxpbmVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKCFsaW5lc1tpXS5pbmNsdWRlcygnXCJhc3Npc3RhbnRcIicpKSBjb250aW51ZVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlbnRyeSA9IEpTT04ucGFyc2UobGluZXNbaV0pIGFzIHsgdHlwZT86IHN0cmluZzsgbWVzc2FnZT86IHsgbW9kZWw/OiBzdHJpbmcgfTsgZWZmb3J0Pzogc3RyaW5nOyBwZXJUdXJuRWZmb3J0Pzogc3RyaW5nIH1cbiAgICAgIGlmIChlbnRyeS50eXBlICE9PSAnYXNzaXN0YW50JyB8fCAhZW50cnkubWVzc2FnZT8ubW9kZWwgfHwgZW50cnkubWVzc2FnZS5tb2RlbCA9PT0gJzxzeW50aGV0aWM+JykgY29udGludWVcbiAgICAgIHJldHVybiB7IG1vZGVsOiBlbnRyeS5tZXNzYWdlLm1vZGVsLCBlZmZvcnQ6IGVudHJ5LnBlclR1cm5FZmZvcnQgPz8gZW50cnkuZWZmb3J0ID8/IG51bGwgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gcGFydGlhbCBsaW5lXG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1vZGVsOiBudWxsLCBlZmZvcnQ6IG51bGwgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZENvZGV4TW9kZWwobGluZXM6IHN0cmluZ1tdKTogTW9kZWxSZWFkaW5nIHtcbiAgZm9yIChsZXQgaSA9IGxpbmVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKCFsaW5lc1tpXS5pbmNsdWRlcygndHVybl9jb250ZXh0JykpIGNvbnRpbnVlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gSlNPTi5wYXJzZShsaW5lc1tpXSkgYXMgeyB0eXBlPzogc3RyaW5nOyBwYXlsb2FkPzogeyBtb2RlbD86IHN0cmluZzsgZWZmb3J0Pzogc3RyaW5nOyByZWFzb25pbmdfZWZmb3J0Pzogc3RyaW5nIH0gfVxuICAgICAgaWYgKGVudHJ5LnR5cGUgIT09ICd0dXJuX2NvbnRleHQnKSBjb250aW51ZVxuICAgICAgcmV0dXJuIHsgbW9kZWw6IGVudHJ5LnBheWxvYWQ/Lm1vZGVsID8/IG51bGwsIGVmZm9ydDogZW50cnkucGF5bG9hZD8uZWZmb3J0ID8/IGVudHJ5LnBheWxvYWQ/LnJlYXNvbmluZ19lZmZvcnQgPz8gbnVsbCB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBwYXJ0aWFsIGxpbmVcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbW9kZWw6IG51bGwsIGVmZm9ydDogbnVsbCB9XG59XG4iLCAiLy8gUnVucyB0aGUgZG9jdW1lbnRlZCBgb3JjYWAgQ0xJIHdpdGggLS1qc29uLiBOZXZlciBhIHNoZWxsOiBhcmd1bWVudHMgZ28gc3RyYWlnaHQgdG8gZXhlY0ZpbGUsXG4vLyBzbyB0YXNrIHRpdGxlcyBhbmQgc3BlY3MgY2Fubm90IGluamVjdCBjb21tYW5kcy5cbmltcG9ydCB7IGV4ZWNGaWxlIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgYWNjZXNzLCBjb25zdGFudHMsIHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGhvbWVkaXIsIHBsYXRmb3JtIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGRlbGltaXRlciwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcblxuZXhwb3J0IHR5cGUgQ2xpUmVzdWx0PFQ+ID0geyBvazogdHJ1ZTsgcmVzdWx0OiBUIH0gfCB7IG9rOiBmYWxzZTsgY29kZTogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfVxuXG5leHBvcnQgdHlwZSBDbGlSdW5uZXIgPSB7XG4gIHJlYWRvbmx5IHBhdGg6IHN0cmluZyB8IG51bGxcbiAgcnVuPFQgPSB1bmtub3duPihhcmdzOiBzdHJpbmdbXSwgb3B0aW9ucz86IHsgdGltZW91dE1zPzogbnVtYmVyOyBzdGRpbj86IHN0cmluZyB9KTogUHJvbWlzZTxDbGlSZXN1bHQ8VD4+XG59XG5cbmNvbnN0IE1BWF9DT05DVVJSRU5UID0gM1xuY29uc3QgTUFYX09VVFBVVCA9IDggKiAxMDI0ICogMTAyNFxuXG4vKipcbiAqIEZpbmRzIHRoZSBPcmNhIElERSBDTEkuIE9uIG1hbnkgTGludXggZGVza3RvcHMgYC91c3IvYmluL29yY2FgIGlzIHRoZSBHTk9NRSAqc2NyZWVuIHJlYWRlciosXG4gKiBzbyBldmVyeSBjYW5kaWRhdGUgaXMgY2hlY2tlZCBieSBjb250ZW50IGFuZCB0aGVuIGNvbmZpcm1lZCB3aXRoIGBvcmNhIHN0YXR1cyAtLWpzb25gLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNsaVBhdGgob3ZlcnJpZGU6IHN0cmluZyB8IG51bGwpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgaG9tZSA9IGhvbWVkaXIoKVxuICBjb25zdCBjYW5kaWRhdGVzOiBzdHJpbmdbXSA9IFtdXG4gIGlmIChvdmVycmlkZSkgY2FuZGlkYXRlcy5wdXNoKG92ZXJyaWRlKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ2xpbnV4JykgY2FuZGlkYXRlcy5wdXNoKGpvaW4oaG9tZSwgJy5jb25maWcvb3JjYS9saW51eC1vcmNhLWNsaS1zaGltL29yY2EnKSlcbiAgY29uc3QgZXhlID0gcGxhdGZvcm0oKSA9PT0gJ3dpbjMyJyA/IFsnb3JjYS5jbWQnLCAnb3JjYS5leGUnLCAnb3JjYSddIDogWydvcmNhJ11cbiAgZm9yIChjb25zdCBkaXIgb2YgKHByb2Nlc3MuZW52LlBBVEggPz8gJycpLnNwbGl0KGRlbGltaXRlcikpIGZvciAoY29uc3QgbmFtZSBvZiBleGUpIGlmIChkaXIpIGNhbmRpZGF0ZXMucHVzaChqb2luKGRpciwgbmFtZSkpXG4gIGlmIChwbGF0Zm9ybSgpID09PSAnZGFyd2luJykgY2FuZGlkYXRlcy5wdXNoKCcvdXNyL2xvY2FsL2Jpbi9vcmNhJywgJy9vcHQvaG9tZWJyZXcvYmluL29yY2EnLCAnL0FwcGxpY2F0aW9ucy9PcmNhLmFwcC9Db250ZW50cy9SZXNvdXJjZXMvYmluL29yY2EnKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ3dpbjMyJykgY2FuZGlkYXRlcy5wdXNoKGpvaW4ocHJvY2Vzcy5lbnYuTE9DQUxBUFBEQVRBID8/IGpvaW4oaG9tZSwgJ0FwcERhdGEvTG9jYWwnKSwgJ1Byb2dyYW1zL09yY2EvcmVzb3VyY2VzL2Jpbi9vcmNhLmNtZCcpKVxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ2xpbnV4JykgY2FuZGlkYXRlcy5wdXNoKCcvdXNyL2xvY2FsL2Jpbi9vcmNhJylcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLm5ldyBTZXQoY2FuZGlkYXRlcyldKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGFjY2VzcyhjYW5kaWRhdGUsIHBsYXRmb3JtKCkgPT09ICd3aW4zMicgPyBjb25zdGFudHMuRl9PSyA6IGNvbnN0YW50cy5YX09LKVxuICAgIH0gY2F0Y2gge1xuICAgICAgY29udGludWVcbiAgICB9XG4gICAgaWYgKGF3YWl0IGxvb2tzTGlrZVNjcmVlblJlYWRlcihjYW5kaWRhdGUpKSBjb250aW51ZVxuICAgIGlmIChhd2FpdCBjb25maXJtc09yY2FJZGUoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZVxuICB9XG4gIHJldHVybiBudWxsXG59XG5cbi8qKiBUaGUgR05PTUUgc2NyZWVuIHJlYWRlciBpcyBhIFB5dGhvbiBzY3JpcHQ7IG5ldmVyIGV4ZWN1dGUgaXQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9va3NMaWtlU2NyZWVuUmVhZGVyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIGNvbnN0IGhlYWQgPSAoYXdhaXQgcmVhZEZpbGUocGF0aCkpLnN1YmFycmF5KDAsIDIwNDgpLnRvU3RyaW5nKCdsYXRpbjEnKVxuICAgIHJldHVybiAvXiMhLipweXRob24vLnRlc3QoaGVhZCkgfHwgL1RoZSBPcmNhIFRlYW18R05PTUV8SWdhbGlhfG9yY2FcXC5vcmNhX21haW4vLnRlc3QoaGVhZClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuZnVuY3Rpb24gY29uZmlybXNPcmNhSWRlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBleGVjRmlsZShwYXRoLCBbJ3N0YXR1cycsICctLWpzb24nXSwgeyB0aW1lb3V0OiA2MDAwLCBtYXhCdWZmZXI6IDEwMjQgKiAxMDI0LCB3aW5kb3dzSGlkZTogdHJ1ZSB9LCAoX2Vycm9yLCBzdGRvdXQpID0+IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQ2xpT3V0cHV0PHsgYXBwPzogdW5rbm93biB9PihzdGRvdXQgPz8gJycsIG51bGwpXG4gICAgICByZXNvbHZlKHBhcnNlZC5vayAmJiB0eXBlb2YgcGFyc2VkLnJlc3VsdCA9PT0gJ29iamVjdCcgJiYgcGFyc2VkLnJlc3VsdCAhPT0gbnVsbCAmJiAnYXBwJyBpbiBwYXJzZWQucmVzdWx0KVxuICAgIH0pXG4gIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDbGlSdW5uZXIocGF0aDogc3RyaW5nIHwgbnVsbCk6IENsaVJ1bm5lciB7XG4gIGxldCBhY3RpdmUgPSAwXG4gIGNvbnN0IHF1ZXVlOiAoKCkgPT4gdm9pZClbXSA9IFtdXG4gIGNvbnN0IGFjcXVpcmUgPSAoKSA9PlxuICAgIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICBpZiAoYWN0aXZlIDwgTUFYX0NPTkNVUlJFTlQpIHtcbiAgICAgICAgYWN0aXZlKytcbiAgICAgICAgcmVzb2x2ZSgpXG4gICAgICB9IGVsc2UgcXVldWUucHVzaCgoKSA9PiB7IGFjdGl2ZSsrOyByZXNvbHZlKCkgfSlcbiAgICB9KVxuICBjb25zdCByZWxlYXNlID0gKCkgPT4ge1xuICAgIGFjdGl2ZS0tXG4gICAgcXVldWUuc2hpZnQoKT8uKClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcGF0aCxcbiAgICBhc3luYyBydW48VD4oYXJnczogc3RyaW5nW10sIG9wdGlvbnM6IHsgdGltZW91dE1zPzogbnVtYmVyOyBzdGRpbj86IHN0cmluZyB9ID0ge30pOiBQcm9taXNlPENsaVJlc3VsdDxUPj4ge1xuICAgICAgaWYgKCFwYXRoKSByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICdjbGlfdW5hdmFpbGFibGUnLCBtZXNzYWdlOiAnVGhlIG9yY2EgQ0xJIHdhcyBub3QgZm91bmQuIFNldCBpdHMgcGF0aCBpbiBBZ2VudCBGbG93IHNldHRpbmdzLicgfVxuICAgICAgYXdhaXQgYWNxdWlyZSgpXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Q2xpUmVzdWx0PFQ+PigocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGNoaWxkID0gZXhlY0ZpbGUoXG4gICAgICAgICAgICBwYXRoLFxuICAgICAgICAgICAgWy4uLmFyZ3MsICctLWpzb24nXSxcbiAgICAgICAgICAgIHsgdGltZW91dDogb3B0aW9ucy50aW1lb3V0TXMgPz8gMTUwMDAsIG1heEJ1ZmZlcjogTUFYX09VVFBVVCwgd2luZG93c0hpZGU6IHRydWUsIGVudjogeyAuLi5wcm9jZXNzLmVudiwgTk9fQ09MT1I6ICcxJyB9IH0sXG4gICAgICAgICAgICAoZXJyb3IsIHN0ZG91dCkgPT4gcmVzb2x2ZShwYXJzZUNsaU91dHB1dDxUPihzdGRvdXQsIGVycm9yKSlcbiAgICAgICAgICApXG4gICAgICAgICAgaWYgKG9wdGlvbnMuc3RkaW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY2hpbGQuc3RkaW4/LmVuZChvcHRpb25zLnN0ZGluKVxuICAgICAgICAgIH0gZWxzZSBjaGlsZC5zdGRpbj8uZW5kKClcbiAgICAgICAgfSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHJlbGVhc2UoKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKiogVGhlIENMSSBwcmludHMgYHsgb2ssIHJlc3VsdCB9YCBvciBgeyBvazpmYWxzZSwgZXJyb3I6eyBjb2RlLCBtZXNzYWdlIH0gfWAgZXZlbiBvbiBub24temVybyBleGl0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNsaU91dHB1dDxUPihzdGRvdXQ6IHN0cmluZywgZXJyb3I6IChFcnJvciAmIHsgY29kZT86IHVua25vd247IGtpbGxlZD86IGJvb2xlYW4gfSkgfCBudWxsKTogQ2xpUmVzdWx0PFQ+IHtcbiAgY29uc3QgdGV4dCA9IHN0ZG91dC50cmltKClcbiAgY29uc3Qgc3RhcnQgPSB0ZXh0LmluZGV4T2YoJ3snKVxuICBpZiAoc3RhcnQgPj0gMCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHRleHQuc2xpY2Uoc3RhcnQpKSBhcyB7IG9rPzogYm9vbGVhbjsgcmVzdWx0PzogVDsgZXJyb3I/OiB7IGNvZGU/OiBzdHJpbmc7IG1lc3NhZ2U/OiBzdHJpbmcgfSB9XG4gICAgICBpZiAocGFyc2VkLm9rID09PSB0cnVlKSByZXR1cm4geyBvazogdHJ1ZSwgcmVzdWx0OiBwYXJzZWQucmVzdWx0IGFzIFQgfVxuICAgICAgaWYgKHBhcnNlZC5vayA9PT0gZmFsc2UpIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogcGFyc2VkLmVycm9yPy5jb2RlID8/ICdhY3Rpb25fZmFpbGVkJywgbWVzc2FnZTogcGFyc2VkLmVycm9yPy5tZXNzYWdlID8/ICdUaGUgb3JjYSBDTEkgcmVwb3J0ZWQgYW4gZXJyb3IuJyB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBmYWxsIHRocm91Z2hcbiAgICB9XG4gIH1cbiAgaWYgKGVycm9yPy5raWxsZWQpIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogJ3RpbWVvdXQnLCBtZXNzYWdlOiAnVGhlIG9yY2EgQ0xJIGRpZCBub3QgYW5zd2VyIGluIHRpbWUuJyB9XG4gIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogJ2FjdGlvbl9mYWlsZWQnLCBtZXNzYWdlOiBlcnJvcj8ubWVzc2FnZSA/PyAnVGhlIG9yY2EgQ0xJIHJldHVybmVkIG5vIEpTT04uJyB9XG59XG4iLCAiLy8gV2hhdCBlYWNoIGNvbW1hbmQgY2FuIGFjdHVhbGx5IGRvIG9uIHRoaXMgT3JjYSwgc28gdGhlIFVJIG5ldmVyIHNob3dzIGEgZmFrZSBjb250cm9sLlxuaW1wb3J0IHR5cGUgeyBDb21tYW5kQXZhaWxhYmlsaXR5LCBDb21tYW5kS2luZCB9IGZyb20gJy4uLy4uL3NoYXJlZC9jb21tYW5kcy50cydcblxudHlwZSBQcm9iZSA9IHsgaG9zdEhhczogKG1ldGhvZDogc3RyaW5nKSA9PiBib29sZWFuOyBjbGk6IGJvb2xlYW47IGFjdEFzQ29vcmRpbmF0b3I6IGJvb2xlYW4gfVxuXG5jb25zdCBDT09SRElOQVRPUl9SRUFTT04gPVxuICAnT3JjYSBvbmx5IGxldHMgYSBSdW5cdTIwMTlzIGNvb3JkaW5hdG9yIGNoYW5nZSBpdHMgdGFza3MuIEFnZW50IEZsb3cgc2hvd3MgdGhlIGV4YWN0IGNvbW1hbmQgdG8gcnVuIGluIHRoZSBjb29yZGluYXRvciwgb3IgcnVucyBpdCBhcyB0aGUgY29vcmRpbmF0b3IgaWYgeW91IHR1cm4gdGhhdCBvbiBpbiBzZXR0aW5ncy4nXG5cbmV4cG9ydCBmdW5jdGlvbiBjb21tYW5kQXZhaWxhYmlsaXR5KGtpbmQ6IENvbW1hbmRLaW5kLCBwcm9iZTogUHJvYmUpOiBDb21tYW5kQXZhaWxhYmlsaXR5IHtcbiAgY29uc3QgaG9zdCA9IChtZXRob2Q6IHN0cmluZywgcmVhc29uPzogc3RyaW5nKTogQ29tbWFuZEF2YWlsYWJpbGl0eSA9PlxuICAgIHByb2JlLmhvc3RIYXMobWV0aG9kKSA/IHsgYXZhaWxhYmxlOiB0cnVlLCBtb2RlOiAnZGlyZWN0JywgcmVhc29uOiBudWxsIH0gOiB7IGF2YWlsYWJsZTogZmFsc2UsIG1vZGU6ICd1bnN1cHBvcnRlZCcsIHJlYXNvbjogcmVhc29uID8/IGBUaGlzIE9yY2EgZG9lcyBub3Qgb2ZmZXIgJHttZXRob2R9IHRvIHBsdWdpbnMuYCB9XG4gIGNvbnN0IGNsaSA9ICgpOiBDb21tYW5kQXZhaWxhYmlsaXR5ID0+XG4gICAgcHJvYmUuY2xpID8geyBhdmFpbGFibGU6IHRydWUsIG1vZGU6ICdkaXJlY3QnLCByZWFzb246IG51bGwgfSA6IHsgYXZhaWxhYmxlOiBmYWxzZSwgbW9kZTogJ3Vuc3VwcG9ydGVkJywgcmVhc29uOiAnVGhlIG9yY2EgQ0xJIHdhcyBub3QgZm91bmQuJyB9XG4gIGNvbnN0IGNvb3JkaW5hdG9yID0gKCk6IENvbW1hbmRBdmFpbGFiaWxpdHkgPT5cbiAgICAhcHJvYmUuY2xpXG4gICAgICA/IHsgYXZhaWxhYmxlOiBmYWxzZSwgbW9kZTogJ3Vuc3VwcG9ydGVkJywgcmVhc29uOiAnVGhlIG9yY2EgQ0xJIHdhcyBub3QgZm91bmQuJyB9XG4gICAgICA6IHsgYXZhaWxhYmxlOiB0cnVlLCBtb2RlOiAnY29vcmRpbmF0b3InLCByZWFzb246IHByb2JlLmFjdEFzQ29vcmRpbmF0b3IgPyAnUnVucyBhcyB0aGUgUnVuXHUyMDE5cyBjb29yZGluYXRvciAoZW5hYmxlZCBpbiBzZXR0aW5ncykuJyA6IENPT1JESU5BVE9SX1JFQVNPTiB9XG4gIHN3aXRjaCAoa2luZCkge1xuICAgIGNhc2UgJ3Rlcm1pbmFsLmZvY3VzJzpcbiAgICAgIHJldHVybiBob3N0KCd0ZXJtaW5hbC5mb2N1cycpXG4gICAgY2FzZSAndGVybWluYWwucmVhZCc6XG4gICAgICByZXR1cm4gaG9zdCgndGVybWluYWwucmVhZCcpXG4gICAgY2FzZSAnYWdlbnQubGF1bmNoJzpcbiAgICAgIHJldHVybiBob3N0KCdhZ2VudC5sYXVuY2gnKVxuICAgIGNhc2UgJ2FnZW50LnJlc3VtZSc6XG4gICAgICByZXR1cm4gaG9zdCgnYWdlbnQucmVzdW1lJylcbiAgICBjYXNlICdhZ2VudC5zdG9wJzpcbiAgICAgIHJldHVybiBjbGkoKVxuICAgIGNhc2UgJ2FnZW50LnJlYWRPdXRwdXQnOlxuICAgICAgcmV0dXJuIHByb2JlLmNsaSB8fCBwcm9iZS5ob3N0SGFzKCd0ZXJtaW5hbC5yZWFkJykgPyB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2RpcmVjdCcsIHJlYXNvbjogbnVsbCB9IDogeyBhdmFpbGFibGU6IGZhbHNlLCBtb2RlOiAndW5zdXBwb3J0ZWQnLCByZWFzb246ICdOZWl0aGVyIHRoZSBvcmNhIENMSSBub3IgdGVybWluYWwucmVhZCBpcyBhdmFpbGFibGUuJyB9XG4gICAgY2FzZSAndGFzay5jcmVhdGUnOlxuICAgIGNhc2UgJ3Rhc2sudXBkYXRlJzpcbiAgICBjYXNlICd0YXNrLnJldHJ5JzpcbiAgICBjYXNlICd0YXNrLmRpc3BhdGNoJzpcbiAgICBjYXNlICdnYXRlLnJlc29sdmUnOlxuICAgIGNhc2UgJ21lc3NhZ2Uuc2VuZCc6XG4gICAgICByZXR1cm4gY29vcmRpbmF0b3IoKVxuICAgIGNhc2UgJ3Rhc2suY2FuY2VsJzpcbiAgICAgIHJldHVybiBwcm9iZS5jbGkgPyB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2RpcmVjdCcsIHJlYXNvbjogJ1N0b3BzIHRoZSB0YXNrXHUyMDE5cyB3b3JrZXIuIE1hcmtpbmcgdGhlIHRhc2sgY2FuY2VsbGVkIG5lZWRzIHRoZSBjb29yZGluYXRvci4nIH0gOiBjbGkoKVxuICAgIGNhc2UgJ3dvcmt0cmVlLmNyZWF0ZSc6XG4gICAgICByZXR1cm4gaG9zdCgnd29ya3NwYWNlLmNyZWF0ZScpXG4gICAgY2FzZSAnd29ya3RyZWUub3Blbic6XG4gICAgICByZXR1cm4gaG9zdCgnd29ya3NwYWNlLm9wZW4nKVxuICAgIGNhc2UgJ3dvcmt0cmVlLmluc3BlY3QnOlxuICAgICAgcmV0dXJuIHsgYXZhaWxhYmxlOiB0cnVlLCBtb2RlOiAnZGlyZWN0JywgcmVhc29uOiBudWxsIH1cbiAgICBjYXNlICdhZ2VudC5wcm9tcHQnOlxuICAgICAgcmV0dXJuIHByb2JlLmhvc3RIYXMoJ3Rlcm1pbmFsLnNlbmRUZXh0JykgfHwgcHJvYmUuY2xpXG4gICAgICAgID8geyBhdmFpbGFibGU6IHRydWUsIG1vZGU6ICdkaXJlY3QnLCByZWFzb246IG51bGwgfVxuICAgICAgICA6IHsgYXZhaWxhYmxlOiBmYWxzZSwgbW9kZTogJ3Vuc3VwcG9ydGVkJywgcmVhc29uOiAnVGhpcyBPcmNhIG9mZmVycyBubyB3YXkgZm9yIHBsdWdpbnMgdG8gc2VuZCB0ZXh0IHRvIGFnZW50cy4nIH1cbiAgICBjYXNlICdtb2RlbC5jaGFuZ2UnOlxuICAgICAgcmV0dXJuIHsgYXZhaWxhYmxlOiBmYWxzZSwgbW9kZTogJ3Vuc3VwcG9ydGVkJywgcmVhc29uOiAnT3JjYSBoYXMgbm8gQVBJIHRvIGNoYW5nZSBhIHJ1bm5pbmcgYWdlbnRcdTIwMTlzIG1vZGVsIG9yIGVmZm9ydC4gUGljayBhIG1vZGVsIHdoZW4geW91IHJldHJ5IG9yIGRpc3BhdGNoIHRoZSB0YXNrIGluc3RlYWQuJyB9XG4gICAgY2FzZSAnbGFiZWxzLnVwZGF0ZSc6XG4gICAgY2FzZSAnaGlzdG9yeS5saXN0JzpcbiAgICBjYXNlICdoaXN0b3J5LmxvYWQnOlxuICAgIGNhc2UgJ3ZpZXdlci5waW5nJzpcbiAgICBjYXNlICdhZ2VudC5hdHRhY2gnOlxuICAgIGNhc2UgJ3N0YXIudmlzaXQnOlxuICAgIGNhc2UgJ3VwZGF0ZS5jaGVjayc6XG4gICAgY2FzZSAndXBkYXRlLnJ1bic6XG4gICAgY2FzZSAnc3Rhci5hbnN3ZXInOlxuICAgIGNhc2UgJ2Rhc2hib2FyZC5pbmZvJzpcbiAgICBjYXNlICdlbnRpdHkuZGV0YWlsJzpcbiAgICBjYXNlICdhZ2VudC5pbWFnZSc6XG4gICAgY2FzZSAnZGFzaGJvYXJkLmVuYWJsZSc6XG4gICAgY2FzZSAnZGFzaGJvYXJkLmNvbnRyb2xzJzpcbiAgICAgIHJldHVybiB7IGF2YWlsYWJsZTogdHJ1ZSwgbW9kZTogJ2RpcmVjdCcsIHJlYXNvbjogbnVsbCB9XG4gIH1cbn1cbiIsICIvLyBJbWFnZXMgdGhlIHBlcnNvbiBhdHRhY2hlcyBpbiBBZ2VudCBGbG93J3MgbWVzc2FnZSBib3guIFRoZXkgYXJyaXZlIGluIGJhc2U2NCBjaHVua3MgKE9yY2EgY2Fwc1xuLy8gZWFjaCBwYW5lbCByZXF1ZXN0KSwgYXJlIGNoZWNrZWQgdG8gcmVhbGx5IGJlIHRoZSBpbWFnZSB0eXBlIHRoZXkgY2xhaW0sIGFuZCBhcmUgc2F2ZWQgd2hlcmVcbi8vIE9yY2EncyBvd24gY2hhdCBrZWVwcyBhdHRhY2htZW50cyAoYGFnZW50LXNlc3Npb24tYXR0YWNobWVudHMvPHV1aWQ+LzxmaWxlPmApLCBzbyBPcmNhIHR1cm5zIGFuXG4vLyBgQFwiPHBhdGg+XCJgIG1lbnRpb24gaW50byBhIHJlYWwgYXR0YWNobWVudC4gT25seSBmaWxlcyB0aGlzIHN0b3JlIHNhdmVkIGNhbiBiZSBzZW50LlxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGhvbWVkaXIsIHBsYXRmb3JtIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5cbmV4cG9ydCBjb25zdCBBVFRBQ0hNRU5UX1RZUEVTID0gWydpbWFnZS9wbmcnLCAnaW1hZ2UvanBlZycsICdpbWFnZS93ZWJwJywgJ2ltYWdlL2dpZiddIGFzIGNvbnN0XG5leHBvcnQgdHlwZSBBdHRhY2htZW50VHlwZSA9ICh0eXBlb2YgQVRUQUNITUVOVF9UWVBFUylbbnVtYmVyXVxuZXhwb3J0IGNvbnN0IE1BWF9BVFRBQ0hNRU5UX0JZVEVTID0gMTAgKiAxMDI0ICogMTAyNFxuZXhwb3J0IGNvbnN0IE1BWF9BVFRBQ0hNRU5UU19QRVJfTUVTU0FHRSA9IDVcbmNvbnN0IFVQTE9BRF9UVExfTVMgPSA1ICogNjAgKiAxMDAwXG5jb25zdCBNQVhfUEVORElOR19VUExPQURTID0gMTBcbmNvbnN0IEVYVEVOU0lPTjogUmVjb3JkPEF0dGFjaG1lbnRUeXBlLCBzdHJpbmc+ID0geyAnaW1hZ2UvcG5nJzogJ3BuZycsICdpbWFnZS9qcGVnJzogJ2pwZycsICdpbWFnZS93ZWJwJzogJ3dlYnAnLCAnaW1hZ2UvZ2lmJzogJ2dpZicgfVxuXG4vKiogT3JjYSdzIG93biBhdHRhY2htZW50cyBmb2xkZXIgd2hlbiBPcmNhJ3MgZGF0YSBmb2xkZXIgZXhpc3RzLCBlbHNlIEFnZW50IEZsb3cncyBzdGF0ZSBmb2xkZXIuICovXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNobWVudHNSb290KGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBob21lID0gaG9tZWRpcigpXG4gIGNvbnN0IG9yY2FEaXIgPVxuICAgIHBsYXRmb3JtKCkgPT09ICdkYXJ3aW4nXG4gICAgICA/IGpvaW4oaG9tZSwgJ0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC9vcmNhJylcbiAgICAgIDogcGxhdGZvcm0oKSA9PT0gJ3dpbjMyJ1xuICAgICAgICA/IGpvaW4ocHJvY2Vzcy5lbnYuQVBQREFUQSA/PyBqb2luKGhvbWUsICdBcHBEYXRhL1JvYW1pbmcnKSwgJ29yY2EnKVxuICAgICAgICA6IGpvaW4ocHJvY2Vzcy5lbnYuWERHX0NPTkZJR19IT01FID8/IGpvaW4oaG9tZSwgJy5jb25maWcnKSwgJ29yY2EnKVxuICByZXR1cm4gZXhpc3RzU3luYyhvcmNhRGlyKSA/IGpvaW4ob3JjYURpciwgJ2FnZW50LXNlc3Npb24tYXR0YWNobWVudHMnKSA6IGpvaW4oZmFsbGJhY2ssICdhZ2VudC1zZXNzaW9uLWF0dGFjaG1lbnRzJylcbn1cblxuLyoqIFRydWUgd2hlbiB0aGUgYnl0ZXMgc3RhcnQgbGlrZSB0aGUgY2xhaW1lZCBpbWFnZSB0eXBlIChhIHJlbmFtZWQgZmlsZSBpcyByZWZ1c2VkKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb29rc0xpa2UodHlwZTogQXR0YWNobWVudFR5cGUsIGJ5dGVzOiBCdWZmZXIpOiBib29sZWFuIHtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAnaW1hZ2UvcG5nJzpcbiAgICAgIHJldHVybiBieXRlcy5zdWJhcnJheSgwLCA4KS5lcXVhbHMoQnVmZmVyLmZyb20oWzB4ODksIDB4NTAsIDB4NGUsIDB4NDcsIDB4MGQsIDB4MGEsIDB4MWEsIDB4MGFdKSlcbiAgICBjYXNlICdpbWFnZS9qcGVnJzpcbiAgICAgIHJldHVybiBieXRlc1swXSA9PT0gMHhmZiAmJiBieXRlc1sxXSA9PT0gMHhkOCAmJiBieXRlc1syXSA9PT0gMHhmZlxuICAgIGNhc2UgJ2ltYWdlL2dpZic6XG4gICAgICByZXR1cm4gYnl0ZXMuc3ViYXJyYXkoMCwgNCkudG9TdHJpbmcoJ2xhdGluMScpID09PSAnR0lGOCdcbiAgICBjYXNlICdpbWFnZS93ZWJwJzpcbiAgICAgIHJldHVybiBieXRlcy5zdWJhcnJheSgwLCA0KS50b1N0cmluZygnbGF0aW4xJykgPT09ICdSSUZGJyAmJiBieXRlcy5zdWJhcnJheSg4LCAxMikudG9TdHJpbmcoJ2xhdGluMScpID09PSAnV0VCUCdcbiAgfVxufVxuXG50eXBlIFVwbG9hZCA9IHsgdHlwZTogQXR0YWNobWVudFR5cGU7IGNodW5rczogc3RyaW5nW107IGxlbmd0aDogbnVtYmVyOyBzdGFydGVkQXQ6IG51bWJlciB9XG5cbmV4cG9ydCBjbGFzcyBBdHRhY2htZW50U3RvcmUge1xuICBwcml2YXRlIHVwbG9hZHMgPSBuZXcgTWFwPHN0cmluZywgVXBsb2FkPigpXG4gIC8qKiBhdHRhY2htZW50IGlkIFx1MjE5MiBzYXZlZCBmaWxlLiAqL1xuICBwcml2YXRlIHNhdmVkID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcm9vdDogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXIgPSBEYXRlLm5vd1xuICApIHt9XG5cbiAgLyoqXG4gICAqIE9uZSBjaHVuayBvZiBhbiB1cGxvYWQuIGBvZmZzZXRgIG11c3QgZXF1YWwgd2hhdCB3YXMgcmVjZWl2ZWQgc28gZmFyIChjaHVua3MgaW4gb3JkZXIsIHJldHJpZXNcbiAgICogb2YgdGhlIHNhbWUgY2h1bmsgYXJlIGhhcm1sZXNzKS4gVGhlIGxhc3QgY2h1bmsgKGBkb25lYCkgY2hlY2tzIGFuZCBzYXZlcyB0aGUgZmlsZS5cbiAgICovXG4gIGFzeW5jIGFwcGVuZCh1cGxvYWRJZDogc3RyaW5nLCB0eXBlOiBBdHRhY2htZW50VHlwZSwgY2h1bms6IHN0cmluZywgb2Zmc2V0OiBudW1iZXIsIGRvbmU6IGJvb2xlYW4pOiBQcm9taXNlPHsgcmVjZWl2ZWQ6IG51bWJlciB9IHwgeyBhdHRhY2htZW50SWQ6IHN0cmluZzsgYnl0ZXM6IG51bWJlciB9PiB7XG4gICAgdGhpcy5zd2VlcCgpXG4gICAgbGV0IHVwbG9hZCA9IHRoaXMudXBsb2Fkcy5nZXQodXBsb2FkSWQpXG4gICAgaWYgKCF1cGxvYWQpIHtcbiAgICAgIGlmIChvZmZzZXQgIT09IDApIHRocm93IGNvZGVFcnJvcignaW52YWxpZF9wYXJhbXMnLCAnVGhpcyB1cGxvYWQgZXhwaXJlZDsgYXR0YWNoIHRoZSBpbWFnZSBhZ2Fpbi4nKVxuICAgICAgaWYgKHRoaXMudXBsb2Fkcy5zaXplID49IE1BWF9QRU5ESU5HX1VQTE9BRFMpIHRocm93IGNvZGVFcnJvcignYnVzeScsICdUb28gbWFueSBpbWFnZXMgdXBsb2FkaW5nIGF0IG9uY2UuJylcbiAgICAgIHVwbG9hZCA9IHsgdHlwZSwgY2h1bmtzOiBbXSwgbGVuZ3RoOiAwLCBzdGFydGVkQXQ6IHRoaXMubm93KCkgfVxuICAgICAgdGhpcy51cGxvYWRzLnNldCh1cGxvYWRJZCwgdXBsb2FkKVxuICAgIH1cbiAgICBpZiAodXBsb2FkLnR5cGUgIT09IHR5cGUpIHRocm93IGNvZGVFcnJvcignaW52YWxpZF9wYXJhbXMnLCAnVGhlIGltYWdlIHR5cGUgY2hhbmdlZCBkdXJpbmcgdGhlIHVwbG9hZC4nKVxuICAgIGlmIChvZmZzZXQgPT09IHVwbG9hZC5sZW5ndGgpIHtcbiAgICAgIHVwbG9hZC5jaHVua3MucHVzaChjaHVuaylcbiAgICAgIHVwbG9hZC5sZW5ndGggKz0gY2h1bmsubGVuZ3RoXG4gICAgfSBlbHNlIGlmIChvZmZzZXQgKyBjaHVuay5sZW5ndGggIT09IHVwbG9hZC5sZW5ndGgpIHtcbiAgICAgIHRocm93IGNvZGVFcnJvcignaW52YWxpZF9wYXJhbXMnLCAnSW1hZ2UgY2h1bmtzIGFycml2ZWQgb3V0IG9mIG9yZGVyOyBhdHRhY2ggdGhlIGltYWdlIGFnYWluLicpXG4gICAgfVxuICAgIGlmICh1cGxvYWQubGVuZ3RoICogMC43NSA+IE1BWF9BVFRBQ0hNRU5UX0JZVEVTICsgMykge1xuICAgICAgdGhpcy51cGxvYWRzLmRlbGV0ZSh1cGxvYWRJZClcbiAgICAgIHRocm93IGNvZGVFcnJvcigndG9vX2xhcmdlJywgYEltYWdlcyBjYW4gYmUgYXQgbW9zdCAke01BWF9BVFRBQ0hNRU5UX0JZVEVTIC8gMTAyNCAvIDEwMjR9IE1CLmApXG4gICAgfVxuICAgIGlmICghZG9uZSkgcmV0dXJuIHsgcmVjZWl2ZWQ6IHVwbG9hZC5sZW5ndGggfVxuICAgIHRoaXMudXBsb2Fkcy5kZWxldGUodXBsb2FkSWQpXG4gICAgY29uc3QgYnl0ZXMgPSBCdWZmZXIuZnJvbSh1cGxvYWQuY2h1bmtzLmpvaW4oJycpLCAnYmFzZTY0JylcbiAgICBpZiAoIWJ5dGVzLmxlbmd0aCB8fCBieXRlcy5sZW5ndGggPiBNQVhfQVRUQUNITUVOVF9CWVRFUykgdGhyb3cgY29kZUVycm9yKCd0b29fbGFyZ2UnLCBgSW1hZ2VzIGNhbiBiZSBhdCBtb3N0ICR7TUFYX0FUVEFDSE1FTlRfQllURVMgLyAxMDI0IC8gMTAyNH0gTUIuYClcbiAgICBpZiAoIWxvb2tzTGlrZSh0eXBlLCBieXRlcykpIHRocm93IGNvZGVFcnJvcignaW52YWxpZF9wYXJhbXMnLCAnVGhhdCBmaWxlIGlzIG5vdCB0aGUgaW1hZ2UgdHlwZSBpdCBjbGFpbXMgdG8gYmUuJylcbiAgICBjb25zdCBhdHRhY2htZW50SWQgPSByYW5kb21VVUlEKClcbiAgICBjb25zdCBkaXIgPSBqb2luKHRoaXMucm9vdCwgYXR0YWNobWVudElkKVxuICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUsIG1vZGU6IDBvNzAwIH0pXG4gICAgY29uc3QgcGF0aCA9IGpvaW4oZGlyLCBgYWdlbnQtZmxvdy1wYXN0ZS0ke3RoaXMubm93KCl9LiR7RVhURU5TSU9OW3R5cGVdfWApXG4gICAgYXdhaXQgd3JpdGVGaWxlKHBhdGgsIGJ5dGVzLCB7IG1vZGU6IDBvNjAwIH0pXG4gICAgdGhpcy5zYXZlZC5zZXQoYXR0YWNobWVudElkLCBwYXRoKVxuICAgIGlmICh0aGlzLnNhdmVkLnNpemUgPiAyMDApIHRoaXMuc2F2ZWQuZGVsZXRlKHRoaXMuc2F2ZWQua2V5cygpLm5leHQoKS52YWx1ZSEpXG4gICAgcmV0dXJuIHsgYXR0YWNobWVudElkLCBieXRlczogYnl0ZXMubGVuZ3RoIH1cbiAgfVxuXG4gIC8qKiBUaGUgc2F2ZWQgZmlsZSBmb3IgYW4gYXR0YWNobWVudCBpZCwgb3IgbnVsbCB3aGVuIHRoaXMgc3RvcmUgZGlkIG5vdCBzYXZlIGl0LiAqL1xuICBwYXRoRm9yKGF0dGFjaG1lbnRJZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuc2F2ZWQuZ2V0KGF0dGFjaG1lbnRJZCkgPz8gbnVsbFxuICB9XG5cbiAgcHJpdmF0ZSBzd2VlcCgpOiB2b2lkIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpXG4gICAgZm9yIChjb25zdCBbaWQsIHVwbG9hZF0gb2YgdGhpcy51cGxvYWRzKSBpZiAobm93IC0gdXBsb2FkLnN0YXJ0ZWRBdCA+IFVQTE9BRF9UVExfTVMpIHRoaXMudXBsb2Fkcy5kZWxldGUoaWQpXG4gIH1cbn1cblxuLyoqIEhvdyBhbiBhdHRhY2htZW50IGlzIG1lbnRpb25lZCBpbiB0aGUgbWVzc2FnZSB0ZXh0LCBwZXIgZGVsaXZlcnkgcm91dGUuICovXG5leHBvcnQgZnVuY3Rpb24gbWVudGlvbkZvcihwYXRoOiBzdHJpbmcsIHJvdXRlOiAnY2hhdCcgfCAnY2xhdWRlLXRlcm1pbmFsJyB8ICdvdGhlcicpOiBzdHJpbmcge1xuICAvLyBPcmNhJ3MgY2hhdCBhbmQgQ2xhdWRlIENvZGUgYm90aCByZWFkIGBAXCI8cGF0aD5cImAgYXMgYW4gYXR0YWNoZWQgZmlsZTsgb3RoZXJzIGdldCB0aGUgcGxhaW4gcGF0aC5cbiAgcmV0dXJuIHJvdXRlID09PSAnb3RoZXInID8gcGF0aCA6IGBAXCIke3BhdGgucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpfVwiYFxufVxuXG5mdW5jdGlvbiBjb2RlRXJyb3IoY29kZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcpOiBFcnJvciAmIHsgY29kZTogc3RyaW5nIH0ge1xuICByZXR1cm4gT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IobWVzc2FnZSksIHsgY29kZSB9KVxufVxuIiwgImltcG9ydCB0eXBlIHsgVXBkYXRlQ2hlY2tlciB9IGZyb20gJy4uL3VwZGF0ZS91cGRhdGUtY2hlY2sudHMnXG5pbXBvcnQgdHlwZSB7IFN0YXJBbnN3ZXIsIFN0YXJQcm9tcHRTdG9yZSB9IGZyb20gJy4uL3N0YXRlL3N0YXItcHJvbXB0LnRzJ1xuLy8gUnVucyB2YWxpZGF0ZWQgY29tbWFuZHMgYWdhaW5zdCByZWFsIE9yY2Egb3BlcmF0aW9ucy4gRWFjaCByZXF1ZXN0IGlkIHJ1bnMgYXQgbW9zdCBvbmNlO1xuLy8gZGVzdHJ1Y3RpdmUgY29tbWFuZHMgbmVlZCB0aGUgVUkncyBjb25maXJtYXRpb24gZmxhZzsgcmVzdWx0cyBhcmUgcmVwb3J0ZWQgYXMgdGhleSBoYXBwZW5lZC5cbmltcG9ydCB7IG1lbnRpb25Gb3IsIHR5cGUgQXR0YWNobWVudFN0b3JlLCB0eXBlIEF0dGFjaG1lbnRUeXBlIH0gZnJvbSAnLi9hdHRhY2htZW50cy50cydcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCB7IERFU1RSVUNUSVZFX0NPTU1BTkRTLCBSRUFEX09OTFlfQ09NTUFORFMsIHZhbGlkYXRlQ29tbWFuZCwgVmFsaWRhdGlvbkVycm9yLCB0eXBlIENvbW1hbmRLaW5kLCB0eXBlIENvbW1hbmRSZXF1ZXN0LCB0eXBlIENvbW1hbmRSZXNwb25zZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9jb21tYW5kcy50cydcbmltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQsIExhYmVsQ29uZmlnIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuaW1wb3J0IHsgcmVkYWN0LCBzdHJpcEFuc2kgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuaW1wb3J0IHR5cGUgeyBXb3JrZXJDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dC50cydcbmltcG9ydCB7IGluc3BlY3RXb3JrdHJlZSB9IGZyb20gJy4uL2dpdC9naXQtaW5zcGVjdC50cydcbmltcG9ydCB0eXBlIHsgUGVyc2lzdGVuY2UgfSBmcm9tICcuLi9zdGF0ZS9wZXJzaXN0ZW5jZS50cydcbmltcG9ydCB7IGNvbW1hbmRBdmFpbGFiaWxpdHkgfSBmcm9tICcuL2F2YWlsYWJpbGl0eS50cydcbmltcG9ydCB7IGNvb3JkaW5hdG9yQXJncywgc2hlbGxRdW90ZSB9IGZyb20gJy4vY29vcmRpbmF0b3ItY29tbWFuZHMudHMnXG5pbXBvcnQgeyByZWFkV29ya2VyT3V0cHV0IH0gZnJvbSAnLi90cmFuc2NyaXB0LnRzJ1xuaW1wb3J0IHsgY2hhdFNlc3Npb25JZEZyb21QYW5lS2V5IH0gZnJvbSAnLi4vcnVudGltZS1ycGMvY2hhdC1zZW5kLnRzJ1xuaW1wb3J0IHsgcmVhZENsYXVkZUltYWdlLCByZWFkQ2xhdWRlVHJhbnNjcmlwdCB9IGZyb20gJy4vY2xhdWRlLXRyYW5zY3JpcHQudHMnXG5cbmV4cG9ydCB0eXBlIFJvdXRlckRlcHMgPSB7XG4gIGN0eDogV29ya2VyQ29udGV4dFxuICBwZXJzaXN0ZW5jZTogUGVyc2lzdGVuY2VcbiAgb3duVGVybWluYWxzOiBTZXQ8c3RyaW5nPlxuICBzZXR0aW5nczogKCkgPT4geyBhY3RBc0Nvb3JkaW5hdG9yOiBib29sZWFuOyBjaGF0U2VuZDogYm9vbGVhbiB9XG4gIC8qKiBFeHBlcmltZW50YWw6IE9yY2EgcnVudGltZSBSUEMgc2VuZCBpbnRvIGEgY2hhdCBzZXNzaW9uLiBJbmplY3RlZCBzbyB0ZXN0cyBuZXZlciB0b3VjaCBhIHJlYWwgc29ja2V0LiAqL1xuICBzZW5kQ2hhdD86IChzZXNzaW9uSWQ6IHN0cmluZywgdGV4dDogc3RyaW5nKSA9PiBQcm9taXNlPHVua25vd24+XG4gIHVwZGF0ZUxhYmVsczogKGxhYmVsczogTGFiZWxDb25maWcpID0+IFByb21pc2U8dm9pZD5cbiAgZGFzaGJvYXJkSW5mbzogKCkgPT4geyBlbmFibGVkOiBib29sZWFuOyB1cmw6IHN0cmluZyB8IG51bGwgfVxuICByZWZyZXNoOiAoKSA9PiB2b2lkXG4gIGZ1bGxUZXh0OiAoa2V5OiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGxcbiAgLyoqIFBhdGggb2YgYSBDbGF1ZGUgdHJhbnNjcmlwdCBmb3IgdGhpcyBhZ2VudCwgd2hlbiBvbmUgZXhpc3RzLiAqL1xuICBjbGF1ZGVUcmFuc2NyaXB0UGF0aDogKGFnZW50OiBBZ2VudFJlY29yZCkgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPlxuICAvKiogU3RhcnRzIHB1c2hpbmcgY2hhbmdlcyBvZiB0aGlzIHRyYW5zY3JpcHQgdG8gdmlld3M7IHRydWUgd2hlbiBpdCB3aWxsLiAqL1xuICB3YXRjaE91dHB1dD86IChhZ2VudElkOiBzdHJpbmcsIHBhdGg6IHN0cmluZykgPT4gYm9vbGVhblxuICAvKiogT3V0cHV0IHdpdGhvdXQgYSBmaWxlOiB2aWV3cyBhcmUgdG9sZCBvbiB0aGUgYWdlbnQncyBzdGF0dXMgY2hhbmdlcyBhbmQgdG9vbCBjYWxscyBpbnN0ZWFkLiAqL1xuICBub3RlT3V0cHV0SW50ZXJlc3Q/OiAoYWdlbnRJZDogc3RyaW5nKSA9PiB2b2lkXG4gIC8qKiBJbWFnZXMgYXR0YWNoZWQgaW4gdGhlIG1lc3NhZ2UgYm94IChhZ2VudC5hdHRhY2gpLiAqL1xuICBhdHRhY2htZW50cz86IEF0dGFjaG1lbnRTdG9yZVxuICAvKiogVGhlIG9jY2FzaW9uYWwgXCJzdGFyIHRoZSBwcm9qZWN0XCIgcHJvbXB0LiAqL1xuICBzdGFyUHJvbXB0PzogU3RhclByb21wdFN0b3JlXG4gIC8qKiBOZXctdmVyc2lvbiBjaGVja3MgYW5kIGBvcmNhIHBsdWdpbiB1cGRhdGVgLiAqL1xuICB1cGRhdGVzPzogVXBkYXRlQ2hlY2tlclxuICAvKiogVGhlIHBsdWdpbidzIG93biBgZGFzaGJvYXJkQ29udHJvbHNgIHNldHRpbmcgKHNhbWUgc3dpdGNoIGFzIGluIE9yY2EgU2V0dGluZ3MpLiAqL1xuICBzZXREYXNoYm9hcmRDb250cm9scz86IChlbmFibGVkOiBib29sZWFuKSA9PiBQcm9taXNlPHsgY29udHJvbHM6IGJvb2xlYW4gfT5cbiAgc2V0RGFzaGJvYXJkOiAoZW5hYmxlZDogYm9vbGVhbikgPT4gUHJvbWlzZTx7IGVuYWJsZWQ6IGJvb2xlYW47IHVybDogc3RyaW5nIHwgbnVsbCB9PlxuICAvKiogQ29tbWFuZHMgYWxsb3dlZCBmcm9tIHRoaXMgY2FsbGVyICh0aGUgZGFzaGJvYXJkIHdpdGhvdXQgY29udHJvbCByaWdodHMgZ2V0cyByZWFkLW9ubHkpLiAqL1xufVxuXG5jb25zdCBDQUNIRV9MSU1JVCA9IDUwMFxuY29uc3QgT1VUUFVUX0NBQ0hFX01TID0gMjUwMFxuLyoqIEJhc2U2NCBjaGFyYWN0ZXJzIHBlciBpbWFnZSBjaHVuazsgd2VsbCB1bmRlciBPcmNhJ3MgMSBNaUIgcGFuZWwgYW5zd2VyIGxpbWl0LiAqL1xuY29uc3QgSU1BR0VfQ0hVTksgPSA2MDBfMDAwXG5jb25zdCBPVVRQVVRfQlVER0VUID0gODUwICogMTAyNFxuXG5leHBvcnQgY2xhc3MgQ29tbWFuZFJvdXRlciB7XG4gIHByaXZhdGUgcmVzdWx0cyA9IG5ldyBNYXA8c3RyaW5nLCBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4+KClcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRlcHM6IFJvdXRlckRlcHMpIHt9XG5cbiAgLyoqIEVudHJ5IHBvaW50IGZvciBldmVyeSB0cmFuc3BvcnQuIGBhbGxvd2VkYCBuYXJyb3dzIHdoYXQgYSBjYWxsZXIgbWF5IHJ1bi4gKi9cbiAgaGFuZGxlKGlucHV0OiB1bmtub3duLCBhbGxvd2VkOiAoa2luZDogQ29tbWFuZEtpbmQpID0+IGJvb2xlYW4gPSAoKSA9PiB0cnVlKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBsZXQgcmVxdWVzdDogQ29tbWFuZFJlcXVlc3RcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdCA9IHZhbGlkYXRlQ29tbWFuZChpbnB1dClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShmYWlsKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yID8gJ2ludmFsaWRfcGFyYW1zJyA6ICdhY3Rpb25fZmFpbGVkJywgKGVycm9yIGFzIEVycm9yKS5tZXNzYWdlKSlcbiAgICB9XG4gICAgaWYgKCFhbGxvd2VkKHJlcXVlc3Qua2luZCkpIHJldHVybiBQcm9taXNlLnJlc29sdmUoZmFpbCgnbm90X3Blcm1pdHRlZCcsICdUaGlzIHZpZXcgbWF5IG5vdCBydW4gdGhhdCBjb21tYW5kLicpKVxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVzdWx0cy5nZXQocmVxdWVzdC5yZXF1ZXN0SWQpXG4gICAgaWYgKGNhY2hlZCkgcmV0dXJuIGNhY2hlZFxuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmV4ZWN1dGUocmVxdWVzdClcbiAgICB0aGlzLnJlc3VsdHMuc2V0KHJlcXVlc3QucmVxdWVzdElkLCBwcm9taXNlKVxuICAgIGlmICh0aGlzLnJlc3VsdHMuc2l6ZSA+IENBQ0hFX0xJTUlUKSB7XG4gICAgICBjb25zdCBvbGRlc3QgPSB0aGlzLnJlc3VsdHMua2V5cygpLm5leHQoKS52YWx1ZVxuICAgICAgaWYgKG9sZGVzdCAhPT0gdW5kZWZpbmVkKSB0aGlzLnJlc3VsdHMuZGVsZXRlKG9sZGVzdClcbiAgICB9XG4gICAgcmV0dXJuIHByb21pc2VcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZShyZXF1ZXN0OiBDb21tYW5kUmVxdWVzdCk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgeyBjdHggfSA9IHRoaXMuZGVwc1xuICAgIGNvbnN0IGF2YWlsYWJpbGl0eSA9IGNvbW1hbmRBdmFpbGFiaWxpdHkocmVxdWVzdC5raW5kLCB7IGhvc3RIYXM6IChtKSA9PiBjdHgub3JjYS5ob3N0LmhhcyhtKSwgY2xpOiBCb29sZWFuKGN0eC5jbGkucGF0aCksIGFjdEFzQ29vcmRpbmF0b3I6IHRoaXMuZGVwcy5zZXR0aW5ncygpLmFjdEFzQ29vcmRpbmF0b3IgfSlcbiAgICBpZiAoIWF2YWlsYWJpbGl0eS5hdmFpbGFibGUpIHJldHVybiBmYWlsKCd1bnN1cHBvcnRlZCcsIGF2YWlsYWJpbGl0eS5yZWFzb24gPz8gJ05vdCBzdXBwb3J0ZWQgYnkgdGhpcyBPcmNhLicpXG4gICAgaWYgKERFU1RSVUNUSVZFX0NPTU1BTkRTLmhhcyhyZXF1ZXN0LmtpbmQpICYmICFyZXF1ZXN0LmNvbmZpcm1lZCkgcmV0dXJuIGZhaWwoJ2NvbmZpcm1hdGlvbl9yZXF1aXJlZCcsICdDb25maXJtIHRoaXMgYWN0aW9uIGZpcnN0LicpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5ydW4ocmVxdWVzdClcbiAgICAgIGlmICghUkVBRF9PTkxZX0NPTU1BTkRTLmhhcyhyZXF1ZXN0LmtpbmQpICYmIHJlcXVlc3Qua2luZCAhPT0gJ2VudGl0eS5kZXRhaWwnKSBjdHguc3RvcmUuZW1pdCh7XG4gICAgICAgIHRzOiBjdHgubm93KCksXG4gICAgICAgIGtpbmQ6IHJlc3BvbnNlLm9rID8gJ2NvbW1hbmQuZXhlY3V0ZWQnIDogJ2NvbW1hbmQuZmFpbGVkJyxcbiAgICAgICAgc291cmNlOiAnY29tbWFuZCcsXG4gICAgICAgIGVudGl0eUlkOiBTdHJpbmcocmVxdWVzdC5wYXJhbXMuYWdlbnRJZCA/PyByZXF1ZXN0LnBhcmFtcy50YXNrSWQgPz8gcmVxdWVzdC5wYXJhbXMudGVybWluYWxJZCA/PyByZXF1ZXN0LnBhcmFtcy53b3Jrc3BhY2VJZCA/PyByZXF1ZXN0LmtpbmQpLFxuICAgICAgICBzdW1tYXJ5OiBgJHtyZXF1ZXN0LmtpbmR9OiAke3Jlc3BvbnNlLm9rID8gJ2RvbmUnIDogcmVzcG9uc2UuZXJyb3IubWVzc2FnZX1gXG4gICAgICB9KVxuICAgICAgLy8gUmVhZHMgY2hhbmdlIG5vdGhpbmcgaW4gT3JjYSwgc28gdGhleSBtdXN0IG5vdCB0cmlnZ2VyIGEgcmUtc2NhbiAodGhlIG91dHB1dCB2aWV3IHBvbGxzKS5cbiAgICAgIGlmIChyZXNwb25zZS5vayAmJiAhUkVBRF9PTkxZX0NPTU1BTkRTLmhhcyhyZXF1ZXN0LmtpbmQpKSB0aGlzLmRlcHMucmVmcmVzaCgpXG4gICAgICByZXR1cm4gcmVzcG9uc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgRXJyb3IgJiB7IGNvZGU/OiBzdHJpbmcgfVxuICAgICAgY3R4LmxvZyhgY29tbWFuZCAke3JlcXVlc3Qua2luZH0gZmFpbGVkOiAke2Vyci5tZXNzYWdlfWApXG4gICAgICByZXR1cm4gZmFpbCh0eXBlb2YgZXJyLmNvZGUgPT09ICdzdHJpbmcnID8gZXJyLmNvZGUgOiAnYWN0aW9uX2ZhaWxlZCcsIHJlZGFjdChlcnIubWVzc2FnZSkpXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW4ocmVxdWVzdDogQ29tbWFuZFJlcXVlc3QpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBwID0gcmVxdWVzdC5wYXJhbXMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nICYgc3RyaW5nW10gJiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PlxuICAgIGNvbnN0IGhvc3QgPSBjdHgub3JjYS5ob3N0XG4gICAgc3dpdGNoIChyZXF1ZXN0LmtpbmQpIHtcbiAgICAgIGNhc2UgJ3Rlcm1pbmFsLmZvY3VzJzpcbiAgICAgICAgcmV0dXJuIG9rKGF3YWl0IGhvc3QuY2FsbCgndGVybWluYWwuZm9jdXMnLCB7IHRlcm1pbmFsSWQ6IHAudGVybWluYWxJZCB9KSlcbiAgICAgIGNhc2UgJ3Rlcm1pbmFsLnJlYWQnOiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvc3QuY2FsbCgndGVybWluYWwucmVhZCcsIHsgdGVybWluYWxJZDogcC50ZXJtaW5hbElkLCBtYXhMaW5lczogNDAwIH0pXG4gICAgICAgIHJldHVybiBvayh7IGtpbmQ6ICdsaW5lcycsIHNvdXJjZTogJ3Rlcm1pbmFsJywgbGluZXM6IHJlc3VsdC5saW5lcy5tYXAoKGxpbmUpID0+IHJlZGFjdChzdHJpcEFuc2kobGluZSkpKSwgdHJ1bmNhdGVkOiByZXN1bHQudHJ1bmNhdGVkIH0pXG4gICAgICB9XG4gICAgICBjYXNlICdhZ2VudC5yZWFkT3V0cHV0JzpcbiAgICAgICAgcmV0dXJuIHAuYmVmb3JlID8gdGhpcy5yZWFkRWFybGllcihwLmFnZW50SWQsIHAuYmVmb3JlKSA6IHRoaXMucmVhZE91dHB1dFNpbmNlKHAuYWdlbnRJZCwgcC5zaW5jZSlcbiAgICAgIGNhc2UgJ2FnZW50LnByb21wdCc6XG4gICAgICAgIHJldHVybiB0aGlzLnByb21wdChwLmFnZW50SWQsIHAudGV4dCA/PyAnJywgKHJlcXVlc3QucGFyYW1zLmF0dGFjaG1lbnRzIGFzIHN0cmluZ1tdIHwgdW5kZWZpbmVkKSA/PyBbXSlcbiAgICAgIGNhc2UgJ3VwZGF0ZS5jaGVjayc6XG4gICAgICAgIHJldHVybiB0aGlzLmRlcHMudXBkYXRlcyA/IG9rKGF3YWl0IHRoaXMuZGVwcy51cGRhdGVzLmNoZWNrKHJlcXVlc3QucGFyYW1zLmZvcmNlID09PSB0cnVlKSkgOiBmYWlsKCd1bnN1cHBvcnRlZCcsICdVcGRhdGUgY2hlY2tzIGFyZSBub3QgYXZhaWxhYmxlIGhlcmUuJylcbiAgICAgIGNhc2UgJ3VwZGF0ZS5ydW4nOlxuICAgICAgICByZXR1cm4gdGhpcy5kZXBzLnVwZGF0ZXMgPyBvayhhd2FpdCB0aGlzLmRlcHMudXBkYXRlcy51cGRhdGUodGhpcy5kZXBzLmN0eC5jbGkpKSA6IGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ1VwZGF0aW5nIGlzIG5vdCBhdmFpbGFibGUgaGVyZS4nKVxuICAgICAgY2FzZSAnc3Rhci52aXNpdCc6XG4gICAgICAgIHJldHVybiB0aGlzLmRlcHMuc3RhclByb21wdCA/IG9rKGF3YWl0IHRoaXMuZGVwcy5zdGFyUHJvbXB0LnZpc2l0KCkpIDogb2soeyBzaG93OiBmYWxzZSB9KVxuICAgICAgY2FzZSAnc3Rhci5hbnN3ZXInOlxuICAgICAgICBhd2FpdCB0aGlzLmRlcHMuc3RhclByb21wdD8uYW5zd2VyKHAuYW5zd2VyIGFzIFN0YXJBbnN3ZXIpXG4gICAgICAgIHJldHVybiBvayh7IHNhdmVkOiB0cnVlIH0pXG4gICAgICBjYXNlICdhZ2VudC5hdHRhY2gnOiB7XG4gICAgICAgIGlmICghdGhpcy5kZXBzLmF0dGFjaG1lbnRzKSByZXR1cm4gZmFpbCgndW5zdXBwb3J0ZWQnLCAnQXR0YWNoaW5nIGltYWdlcyBpcyBub3QgYXZhaWxhYmxlIGhlcmUuJylcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kZXBzLmF0dGFjaG1lbnRzLmFwcGVuZChwLnVwbG9hZElkLCBwLm1lZGlhVHlwZSBhcyBBdHRhY2htZW50VHlwZSwgcC5jaHVuaywgTnVtYmVyKHAub2Zmc2V0KSwgcmVxdWVzdC5wYXJhbXMuZG9uZSA9PT0gdHJ1ZSlcbiAgICAgICAgcmV0dXJuIG9rKHJlc3VsdClcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2FnZW50LmltYWdlJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuaW1hZ2UocC5hZ2VudElkLCBwLnJlZiwgTnVtYmVyKHAub2Zmc2V0ID8/IDApKVxuICAgICAgY2FzZSAnYWdlbnQubGF1bmNoJzoge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob3N0LmNhbGwoJ2FnZW50LmxhdW5jaCcsIHsgd29ya3NwYWNlSWQ6IHAud29ya3NwYWNlSWQsIGFnZW50OiBwLmFnZW50LCAuLi4ocC5wcm9tcHQgPyB7IHByb21wdDogcC5wcm9tcHQgfSA6IHt9KSB9KVxuICAgICAgICB0aGlzLmRlcHMub3duVGVybWluYWxzLmFkZChyZXN1bHQudGVybWluYWxJZClcbiAgICAgICAgcmV0dXJuIG9rKHJlc3VsdClcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2FnZW50LnJlc3VtZSc6IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9zdC5jYWxsKCdhZ2VudC5yZXN1bWUnLCB7IHdvcmtzcGFjZUlkOiBwLndvcmtzcGFjZUlkLCBhZ2VudDogcC5hZ2VudCBhcyBuZXZlciwgc2Vzc2lvbklkOiBwLnNlc3Npb25JZCB9KVxuICAgICAgICB0aGlzLmRlcHMub3duVGVybWluYWxzLmFkZChyZXN1bHQudGVybWluYWxJZClcbiAgICAgICAgcmV0dXJuIG9rKHJlc3VsdClcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2FnZW50LnN0b3AnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdG9wQWdlbnQocC5hZ2VudElkKVxuICAgICAgY2FzZSAndGFzay5jYW5jZWwnOlxuICAgICAgICByZXR1cm4gdGhpcy5jYW5jZWxUYXNrKHAudGFza0lkLCBwLnJ1bklkKVxuICAgICAgY2FzZSAndGFzay5jcmVhdGUnOlxuICAgICAgY2FzZSAndGFzay51cGRhdGUnOlxuICAgICAgY2FzZSAndGFzay5yZXRyeSc6XG4gICAgICBjYXNlICd0YXNrLmRpc3BhdGNoJzpcbiAgICAgIGNhc2UgJ2dhdGUucmVzb2x2ZSc6XG4gICAgICBjYXNlICdtZXNzYWdlLnNlbmQnOlxuICAgICAgICByZXR1cm4gdGhpcy5jb29yZGluYXRvckNvbW1hbmQocmVxdWVzdClcbiAgICAgIGNhc2UgJ3dvcmt0cmVlLmNyZWF0ZSc6IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9zdC5jYWxsKCd3b3Jrc3BhY2UuY3JlYXRlJywge1xuICAgICAgICAgIHByb2plY3RJZDogcC5wcm9qZWN0SWQsXG4gICAgICAgICAgLi4uKHAubmFtZSA/IHsgbmFtZTogcC5uYW1lIH0gOiB7fSksXG4gICAgICAgICAgLi4uKHAuYmFzZUJyYW5jaCA/IHsgYmFzZUJyYW5jaDogcC5iYXNlQnJhbmNoIH0gOiB7fSksXG4gICAgICAgICAgLi4uKHAuYWdlbnQgPyB7IGFnZW50OiBwLmFnZW50IH0gOiB7fSksXG4gICAgICAgICAgLi4uKHAucHJvbXB0ID8geyBwcm9tcHQ6IHAucHJvbXB0IH0gOiB7fSlcbiAgICAgICAgfSlcbiAgICAgICAgaWYgKHJlc3VsdC50ZXJtaW5hbElkKSB0aGlzLmRlcHMub3duVGVybWluYWxzLmFkZChyZXN1bHQudGVybWluYWxJZClcbiAgICAgICAgcmV0dXJuIG9rKHJlc3VsdClcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3dvcmt0cmVlLm9wZW4nOlxuICAgICAgICByZXR1cm4gb2soYXdhaXQgaG9zdC5jYWxsKCd3b3Jrc3BhY2Uub3BlbicsIHsgd29ya3NwYWNlSWQ6IHAud29ya3NwYWNlSWQgfSkpXG4gICAgICBjYXNlICd3b3JrdHJlZS5pbnNwZWN0JzpcbiAgICAgICAgcmV0dXJuIHRoaXMuaW5zcGVjdChwLnBhdGgpXG4gICAgICBjYXNlICdtb2RlbC5jaGFuZ2UnOlxuICAgICAgICByZXR1cm4gZmFpbCgndW5zdXBwb3J0ZWQnLCAnT3JjYSBoYXMgbm8gQVBJIHRvIGNoYW5nZSBhIHJ1bm5pbmcgYWdlbnRcdTIwMTlzIG1vZGVsIG9yIGVmZm9ydC4nKVxuICAgICAgY2FzZSAnbGFiZWxzLnVwZGF0ZSc6IHtcbiAgICAgICAgY29uc3QgY3VycmVudCA9IGN0eC5zdG9yZS5yZWFkKCkubGFiZWxzXG4gICAgICAgIGNvbnN0IG5leHQ6IExhYmVsQ29uZmlnID0ge1xuICAgICAgICAgIGFjY291bnRUZWFtczogKHAuYWNjb3VudFRlYW1zIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQpID8/IGN1cnJlbnQuYWNjb3VudFRlYW1zLFxuICAgICAgICAgIGFnZW50Um9sZXM6IChwLmFnZW50Um9sZXMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCkgPz8gY3VycmVudC5hZ2VudFJvbGVzLFxuICAgICAgICAgIGxlYWRBY2NvdW50OiAocC5sZWFkQWNjb3VudCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpID8/IGN1cnJlbnQubGVhZEFjY291bnQsXG4gICAgICAgICAgcHJvamVjdE5hbWVzOiAocC5wcm9qZWN0TmFtZXMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCkgPz8gY3VycmVudC5wcm9qZWN0TmFtZXMgPz8ge30sXG4gICAgICAgICAgcHJvamVjdENvbG9yczogc2FuaXRpemVDb2xvcnMoKHAucHJvamVjdENvbG9ycyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkKSA/PyBjdXJyZW50LnByb2plY3RDb2xvcnMgPz8ge30pLFxuICAgICAgICAgIHByb2plY3RSdWxlczogKHAucHJvamVjdFJ1bGVzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQpID8/IGN1cnJlbnQucHJvamVjdFJ1bGVzID8/IHt9XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5kZXBzLnVwZGF0ZUxhYmVscyhuZXh0KVxuICAgICAgICByZXR1cm4gb2sobmV4dClcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2hpc3RvcnkubGlzdCc6XG4gICAgICAgIHJldHVybiBvayhhd2FpdCB0aGlzLmRlcHMucGVyc2lzdGVuY2UubGlzdFJ1bnMoKSlcbiAgICAgIGNhc2UgJ2hpc3RvcnkubG9hZCc6IHtcbiAgICAgICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5kZXBzLnBlcnNpc3RlbmNlLmxvYWRSdW4ocC5ydW5JZClcbiAgICAgICAgcmV0dXJuIHJlY29yZCA/IG9rKHJlY29yZCkgOiBmYWlsKCdub3RfZm91bmQnLCAnTm8gc2F2ZWQgaGlzdG9yeSBmb3IgdGhhdCBydW4uJylcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3ZpZXdlci5waW5nJzpcbiAgICAgICAgcmV0dXJuIG9rKHsgYWxpdmU6IHRydWUgfSlcbiAgICAgIGNhc2UgJ2Rhc2hib2FyZC5pbmZvJzpcbiAgICAgICAgcmV0dXJuIG9rKHRoaXMuZGVwcy5kYXNoYm9hcmRJbmZvKCkpXG4gICAgICBjYXNlICdkYXNoYm9hcmQuY29udHJvbHMnOlxuICAgICAgICByZXR1cm4gdGhpcy5kZXBzLnNldERhc2hib2FyZENvbnRyb2xzID8gb2soYXdhaXQgdGhpcy5kZXBzLnNldERhc2hib2FyZENvbnRyb2xzKHJlcXVlc3QucGFyYW1zLmVuYWJsZWQgPT09IHRydWUpKSA6IGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ05vdCBhdmFpbGFibGUuJylcbiAgICAgIGNhc2UgJ2Rhc2hib2FyZC5lbmFibGUnOlxuICAgICAgICByZXR1cm4gb2soYXdhaXQgdGhpcy5kZXBzLnNldERhc2hib2FyZChyZXF1ZXN0LnBhcmFtcy5lbmFibGVkID09PSB0cnVlKSlcbiAgICAgIGNhc2UgJ2VudGl0eS5kZXRhaWwnOiB7XG4gICAgICAgIGNvbnN0IHRleHQgPSB0aGlzLmRlcHMuZnVsbFRleHQocC5rZXkpXG4gICAgICAgIHJldHVybiB0ZXh0ID09PSBudWxsID8gZmFpbCgnbm90X2ZvdW5kJywgJ0Z1bGwgdGV4dCBpcyBubyBsb25nZXIgY2FjaGVkOyBpdCBpcyByZWZyZXNoZWQgb24gdGhlIG5leHQgcG9sbC4nKSA6IG9rKHsgdGV4dCB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKiBTZXZlcmFsIG9wZW4gdmlld3MgYXNrIGZvciB0aGUgc2FtZSBvdXRwdXQ7IHNoYXJlIG9uZSByZWFkIGZvciBhIGZldyBzZWNvbmRzLiAqL1xuICBwcml2YXRlIG91dHB1dENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHsgYXQ6IG51bWJlcjsgcHJvbWlzZTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IH0+KClcblxuICAvKiogTGl2ZSB2aWV3cyBwb2xsIGV2ZXJ5IGZldyBzZWNvbmRzOyB3aGVuIG5vdGhpbmcgY2hhbmdlZCwgYW5zd2VyIHdpdGggYSBmZXcgYnl0ZXMgb25seS4gKi9cbiAgLyoqIFRoZSB0cmFuc2NyaXB0IGNoYW5nZWQ6IHRoZSBuZXh0IHJlYWQgbXVzdCBub3QgZ2V0IHRoZSBzaG9ydC1saXZlZCBjYWNoZWQgYW5zd2VyLiAqL1xuICBpbnZhbGlkYXRlT3V0cHV0KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMub3V0cHV0Q2FjaGUuZGVsZXRlKGFnZW50SWQpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRPdXRwdXRTaW5jZShhZ2VudElkOiBzdHJpbmcsIHNpbmNlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5yZWFkT3V0cHV0KGFnZW50SWQpXG4gICAgaWYgKCFzaW5jZSB8fCAhcmVzcG9uc2Uub2spIHJldHVybiByZXNwb25zZVxuICAgIGNvbnN0IHZlcnNpb24gPSAocmVzcG9uc2UucmVzdWx0IGFzIHsgdmVyc2lvbj86IHN0cmluZyB9KS52ZXJzaW9uXG4gICAgcmV0dXJuIHZlcnNpb24gPT09IHNpbmNlID8gb2soeyB1bmNoYW5nZWQ6IHRydWUsIHZlcnNpb24gfSkgOiByZXNwb25zZVxuICB9XG5cbiAgcHJpdmF0ZSByZWFkT3V0cHV0KGFnZW50SWQ6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMub3V0cHV0Q2FjaGUuZ2V0KGFnZW50SWQpXG4gICAgaWYgKGNhY2hlZCAmJiBub3cgLSBjYWNoZWQuYXQgPCBPVVRQVVRfQ0FDSEVfTVMpIHJldHVybiBjYWNoZWQucHJvbWlzZVxuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLnJlYWRPdXRwdXROb3coYWdlbnRJZCkudGhlbihmaXRPdXRwdXQpLnRoZW4od2l0aFZlcnNpb24pXG4gICAgdGhpcy5vdXRwdXRDYWNoZS5zZXQoYWdlbnRJZCwgeyBhdDogbm93LCBwcm9taXNlIH0pXG4gICAgaWYgKHRoaXMub3V0cHV0Q2FjaGUuc2l6ZSA+IDUwKSB0aGlzLm91dHB1dENhY2hlLmRlbGV0ZSh0aGlzLm91dHB1dENhY2hlLmtleXMoKS5uZXh0KCkudmFsdWUgYXMgc3RyaW5nKVxuICAgIHJldHVybiBwcm9taXNlXG4gIH1cblxuICAvKiogT2xkZXIgbWVzc2FnZXMgb2YgYSBDbGF1ZGUgdHJhbnNjcmlwdCwgdGhlIGJhdGNoIGJlZm9yZSBgYmVmb3JlYCAoYSBtZXNzYWdlIGlkKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZWFkRWFybGllcihhZ2VudElkOiBzdHJpbmcsIGJlZm9yZTogc3RyaW5nKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCBhZ2VudCA9IHRoaXMuZGVwcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1thZ2VudElkXVxuICAgIGlmICghYWdlbnQpIHJldHVybiBmYWlsKCdub3RfZm91bmQnLCAnVGhhdCBhZ2VudCBpcyBubyBsb25nZXIga25vd24uJylcbiAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy5kZXBzLmNsYXVkZVRyYW5zY3JpcHRQYXRoKGFnZW50KVxuICAgIGlmICghcGF0aCkgcmV0dXJuIGZhaWwoJ3VuYXZhaWxhYmxlJywgJ0VhcmxpZXIgbWVzc2FnZXMgYXJlIGF2YWlsYWJsZSBmb3IgQ2xhdWRlIGNvbnZlcnNhdGlvbnMgb25seS4nKVxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJlYWRDbGF1ZGVUcmFuc2NyaXB0KHBhdGgsIHsgYmVmb3JlSWQ6IGJlZm9yZSB9KVxuICAgIHJldHVybiBvdXRwdXQgPyBmaXRPdXRwdXQob2sob3V0cHV0KSkgOiBmYWlsKCd1bmF2YWlsYWJsZScsICdDb3VsZCBub3QgcmVhZCB0aGUgdHJhbnNjcmlwdC4nKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkT3V0cHV0Tm93KGFnZW50SWQ6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgeyBjdHggfSA9IHRoaXMuZGVwc1xuICAgIGNvbnN0IGFnZW50ID0gY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnRJZF1cbiAgICBpZiAoIWFnZW50KSByZXR1cm4gZmFpbCgnbm90X2ZvdW5kJywgJ1RoYXQgYWdlbnQgaXMgbm8gbG9uZ2VyIGtub3duLicpXG4gICAgLy8gMS4gT3JjaGVzdHJhdGlvbiB3b3JrZXJzOiBPcmNhJ3Mgb3duIHRyYW5zY3JpcHQgLyBsYWJlbGxlZCBvdXRwdXQuXG4gICAgaWYgKGFnZW50LmRpc3BhdGNoSWQgJiYgY3R4LmNsaS5wYXRoKSB7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCByZWFkV29ya2VyT3V0cHV0KGN0eC5jbGksIGFnZW50LmRpc3BhdGNoSWQpXG4gICAgICBpZiAob3V0cHV0KSB7XG4gICAgICAgIHRoaXMuZGVwcy5ub3RlT3V0cHV0SW50ZXJlc3Q/LihhZ2VudElkKVxuICAgICAgICByZXR1cm4gb2soeyAuLi5vdXRwdXQsIGV2ZW50czogQm9vbGVhbih0aGlzLmRlcHMubm90ZU91dHB1dEludGVyZXN0KSB9KVxuICAgICAgfVxuICAgIH1cbiAgICAvLyAyLiBDbGF1ZGUgc3ViYWdlbnRzIGFuZCBDbGF1ZGUgc2Vzc2lvbnMgKGNoYXQgb3IgdGVybWluYWwpOiBDbGF1ZGUgQ29kZSdzIG93biB0cmFuc2NyaXB0IGZpbGUuXG4gICAgY29uc3QgdHJhbnNjcmlwdCA9IGF3YWl0IHRoaXMuZGVwcy5jbGF1ZGVUcmFuc2NyaXB0UGF0aChhZ2VudClcbiAgICBpZiAodHJhbnNjcmlwdCkge1xuICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcmVhZENsYXVkZVRyYW5zY3JpcHQodHJhbnNjcmlwdClcbiAgICAgIC8vIGBwdXNoYDogdGhlIHZpZXcgaGVhcnMgYWJvdXQgbmV3IG1lc3NhZ2VzIGFuZCBvbmx5IG5lZWRzIGEgc2xvdyBzYWZldHkgcG9sbC5cbiAgICAgIGlmIChvdXRwdXQpIHJldHVybiBvayh7IC4uLm91dHB1dCwgcHVzaDogdGhpcy5kZXBzLndhdGNoT3V0cHV0Py4oYWdlbnRJZCwgdHJhbnNjcmlwdCkgPz8gZmFsc2UgfSlcbiAgICB9XG4gICAgLy8gMy4gVGVybWluYWwgb3V0cHV0LlxuICAgIGlmIChhZ2VudC50ZXJtaW5hbElkICYmIGN0eC5vcmNhLmhvc3QuaGFzKCd0ZXJtaW5hbC5yZWFkJykpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGN0eC5vcmNhLmhvc3QuY2FsbCgndGVybWluYWwucmVhZCcsIHsgdGVybWluYWxJZDogYWdlbnQudGVybWluYWxJZCwgbWF4TGluZXM6IDQwMCB9KVxuICAgICAgdGhpcy5kZXBzLm5vdGVPdXRwdXRJbnRlcmVzdD8uKGFnZW50SWQpXG4gICAgICAvLyBgZXZlbnRzYDogc3RhdHVzIGNoYW5nZXMgYW5kIHRvb2wgY2FsbHMgYW5ub3VuY2UgbmV3IG91dHB1dDsgcG9sbGluZyBjYW4gYmUgc2xvd2VyLlxuICAgICAgcmV0dXJuIG9rKHsga2luZDogJ2xpbmVzJywgc291cmNlOiAndGVybWluYWwnLCBsaW5lczogcmVzdWx0LmxpbmVzLm1hcCgobGluZSkgPT4gcmVkYWN0KHN0cmlwQW5zaShsaW5lKSkpLCB0cnVuY2F0ZWQ6IHJlc3VsdC50cnVuY2F0ZWQsIGV2ZW50czogQm9vbGVhbih0aGlzLmRlcHMubm90ZU91dHB1dEludGVyZXN0KSB9KVxuICAgIH1cbiAgICByZXR1cm4gZmFpbCgndW5hdmFpbGFibGUnLCAnT3JjYSBleHBvc2VzIG5vIG91dHB1dCBmb3IgdGhpcyBhZ2VudC4nKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGEgcHJvbXB0IHdoZXJlIE9yY2EgYWxsb3dzIGl0OiB0eXBlZCBpbnRvIHRoZSBhZ2VudCdzIHRlcm1pbmFsLCBvciBhcyBhbiBvcmNoZXN0cmF0aW9uXG4gICAqIG1lc3NhZ2UgdG8gYSB3b3JrZXIgKGNvb3JkaW5hdG9yIHJ1bGVzIGFwcGx5KS4gQ2hhdCBzZXNzaW9ucyBhbmQgc3ViYWdlbnRzIGhhdmUgbm8gQVBJLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcm9tcHQoYWdlbnRJZDogc3RyaW5nLCByYXdUZXh0OiBzdHJpbmcsIGF0dGFjaG1lbnRJZHM6IHN0cmluZ1tdID0gW10pOiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT4ge1xuICAgIGNvbnN0IHsgY3R4IH0gPSB0aGlzLmRlcHNcbiAgICBjb25zdCBhZ2VudCA9IGN0eC5zdG9yZS5yZWFkKCkuYWdlbnRzW2FnZW50SWRdXG4gICAgaWYgKCFhZ2VudCkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdUaGF0IGFnZW50IGlzIG5vIGxvbmdlciBrbm93bi4nKVxuICAgIGlmICghcmF3VGV4dC50cmltKCkgJiYgIWF0dGFjaG1lbnRJZHMubGVuZ3RoKSByZXR1cm4gZmFpbCgnaW52YWxpZF9wYXJhbXMnLCAnVGhlIG1lc3NhZ2UgaXMgZW1wdHkuJylcbiAgICBpZiAoYWdlbnQucm9sZSA9PT0gJ3N1YmFnZW50JykgcmV0dXJuIGZhaWwoJ3Vuc3VwcG9ydGVkJywgJ0Egc3ViYWdlbnQgb25seSB0YWtlcyBpdHMgYnJpZWYgZnJvbSBpdHMgcGFyZW50LiBTZW5kIHlvdXIgbWVzc2FnZSB0byB0aGUgcGFyZW50IGFnZW50IGluc3RlYWQuJylcbiAgICAvLyBBdHRhY2hlZCBpbWFnZXM6IG9ubHkgZmlsZXMgQWdlbnQgRmxvdyBpdHNlbGYgc2F2ZWQgKGJ5IGlkKSwgbWVudGlvbmVkIHRoZSB3YXkgZWFjaCByb3V0ZSByZWFkcyB0aGVtLlxuICAgIGNvbnN0IHBhdGhzOiBzdHJpbmdbXSA9IFtdXG4gICAgZm9yIChjb25zdCBpZCBvZiBhdHRhY2htZW50SWRzKSB7XG4gICAgICBjb25zdCBwYXRoID0gdGhpcy5kZXBzLmF0dGFjaG1lbnRzPy5wYXRoRm9yKGlkKVxuICAgICAgaWYgKCFwYXRoKSByZXR1cm4gZmFpbCgnbm90X2ZvdW5kJywgJ0FuIGF0dGFjaGVkIGltYWdlIGlzIG5vIGxvbmdlciBhdmFpbGFibGU7IGF0dGFjaCBpdCBhZ2Fpbi4nKVxuICAgICAgcGF0aHMucHVzaChwYXRoKVxuICAgIH1cbiAgICBjb25zdCByb3V0ZSA9IGNoYXRTZXNzaW9uSWRGcm9tUGFuZUtleShhZ2VudC5wYW5lS2V5KSAmJiAhYWdlbnQudGVybWluYWxJZCA/ICdjaGF0JyA6IGFnZW50LmFnZW50ID09PSAnY2xhdWRlJyB8fCBhZ2VudC5hZ2VudCA9PT0gbnVsbCA/ICdjbGF1ZGUtdGVybWluYWwnIDogJ290aGVyJ1xuICAgIGNvbnN0IHRleHQgPSBbcmF3VGV4dC50cmltKCksIC4uLnBhdGhzLm1hcCgocGF0aCkgPT4gbWVudGlvbkZvcihwYXRoLCByb3V0ZSkpXS5maWx0ZXIoQm9vbGVhbikuam9pbignICcpXG4gICAgaWYgKGFnZW50LnRlcm1pbmFsSWQgJiYgY3R4Lm9yY2EuaG9zdC5oYXMoJ3Rlcm1pbmFsLnNlbmRUZXh0JykpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGN0eC5vcmNhLmhvc3QuY2FsbCgndGVybWluYWwuc2VuZFRleHQnLCB7IHRlcm1pbmFsSWQ6IGFnZW50LnRlcm1pbmFsSWQsIHRleHQsIGVudGVyOiB0cnVlIH0pXG4gICAgICByZXR1cm4gcmVzdWx0LmFjY2VwdGVkID8gb2soeyB2aWE6ICd0ZXJtaW5hbCcsIGRlbGl2ZXJlZDogdHJ1ZSB9KSA6IGZhaWwoJ2FjdGlvbl9mYWlsZWQnLCAnT3JjYSBkaWQgbm90IGFjY2VwdCB0aGUgdGV4dCBmb3IgdGhhdCB0ZXJtaW5hbC4nKVxuICAgIH1cbiAgICBjb25zdCBjaGF0U2Vzc2lvbiA9IGNoYXRTZXNzaW9uSWRGcm9tUGFuZUtleShhZ2VudC5wYW5lS2V5KVxuICAgIGlmIChjaGF0U2Vzc2lvbikge1xuICAgICAgaWYgKCF0aGlzLmRlcHMuc2V0dGluZ3MoKS5jaGF0U2VuZCB8fCAhdGhpcy5kZXBzLnNlbmRDaGF0KSByZXR1cm4gZmFpbCgndW5zdXBwb3J0ZWQnLCAnU2VuZGluZyBpbnRvIGNoYXQgc2Vzc2lvbnMgaXMgdHVybmVkIG9mZiBpbiBBZ2VudCBGbG93IHNldHRpbmdzLicpXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmRlcHMuc2VuZENoYXQoY2hhdFNlc3Npb24sIHRleHQpXG4gICAgICAgIHJldHVybiBvayh7IHZpYTogJ2NoYXQtc2Vzc2lvbicsIGRlbGl2ZXJlZDogdHJ1ZSB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgRXJyb3IgJiB7IGNvZGU/OiBzdHJpbmcgfVxuICAgICAgICByZXR1cm4gZmFpbChlcnIuY29kZSA/PyAnYWN0aW9uX2ZhaWxlZCcsIGBPcmNhIGRpZCBub3QgdGFrZSB0aGUgbWVzc2FnZTogJHtyZWRhY3QoZXJyLm1lc3NhZ2UpfWApXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChhZ2VudC5kaXNwYXRjaElkICYmIGFnZW50LnJ1bklkKSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY29vcmRpbmF0b3JDb21tYW5kKHsgcmVxdWVzdElkOiAnaW50ZXJuYWwtcHJvbXB0Jywga2luZDogJ21lc3NhZ2Uuc2VuZCcsIHBhcmFtczogeyBydW5JZDogYWdlbnQucnVuSWQsIHRvOiBgZGlzcGF0Y2g6JHthZ2VudC5kaXNwYXRjaElkfWAsIHN1YmplY3Q6ICdNZXNzYWdlIGZyb20gQWdlbnQgRmxvdycsIGJvZHk6IHRleHQgfSB9KVxuICAgICAgcmV0dXJuIHJlc3BvbnNlLm9rID8gb2soeyB2aWE6ICdvcmNoZXN0cmF0aW9uLW1lc3NhZ2UnLCBkZWxpdmVyZWQ6IHRydWUgfSkgOiByZXNwb25zZVxuICAgIH1cbiAgICByZXR1cm4gZmFpbCgndW5zdXBwb3J0ZWQnLCAnT3JjYSBoYXMgbm8gQVBJIGZvciBwbHVnaW5zIHRvIHNlbmQgYSBtZXNzYWdlIGludG8gYSBjaGF0IHNlc3Npb24uIE9wZW4gdGhlIHNlc3Npb24gaW4gT3JjYSBhbmQgdHlwZSB0aGVyZS4nKVxuICB9XG5cbiAgLyoqIE9uZSBpbWFnZSBmcm9tIGEgQ2xhdWRlIHRyYW5zY3JpcHQsIGluIGNodW5rcyB0aGF0IGZpdCBPcmNhJ3MgcGFuZWwgYW5zd2VyIGxpbWl0LiAqL1xuICBwcml2YXRlIGFzeW5jIGltYWdlKGFnZW50SWQ6IHN0cmluZywgcmVmOiBzdHJpbmcsIG9mZnNldDogbnVtYmVyKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCBhZ2VudCA9IHRoaXMuZGVwcy5jdHguc3RvcmUucmVhZCgpLmFnZW50c1thZ2VudElkXVxuICAgIGlmICghYWdlbnQpIHJldHVybiBmYWlsKCdub3RfZm91bmQnLCAnVGhhdCBhZ2VudCBpcyBubyBsb25nZXIga25vd24uJylcbiAgICBjb25zdCBwYXRoID0gYXdhaXQgdGhpcy5kZXBzLmNsYXVkZVRyYW5zY3JpcHRQYXRoKGFnZW50KVxuICAgIGlmICghcGF0aCkgcmV0dXJuIGZhaWwoJ3VuYXZhaWxhYmxlJywgJ05vIHRyYW5zY3JpcHQgd2l0aCBpbWFnZXMgZm9yIHRoaXMgYWdlbnQuJylcbiAgICBjb25zdCBpbWFnZSA9IGF3YWl0IHJlYWRDbGF1ZGVJbWFnZShwYXRoLCByZWYpXG4gICAgaWYgKCFpbWFnZSkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdUaGF0IGltYWdlIGlzIG5vIGxvbmdlciBpbiB0aGUgdHJhbnNjcmlwdC4nKVxuICAgIGNvbnN0IGNodW5rID0gaW1hZ2UuZGF0YS5zbGljZShvZmZzZXQsIG9mZnNldCArIElNQUdFX0NIVU5LKVxuICAgIHJldHVybiBvayh7IG1lZGlhVHlwZTogaW1hZ2UubWVkaWFUeXBlLCB0b3RhbDogaW1hZ2UuZGF0YS5sZW5ndGgsIG9mZnNldCwgY2h1bmsgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcEFnZW50KGFnZW50SWQ6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgeyBjdHggfSA9IHRoaXMuZGVwc1xuICAgIGNvbnN0IGFnZW50ID0gY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYWdlbnRJZF1cbiAgICBpZiAoIWFnZW50KSByZXR1cm4gZmFpbCgnbm90X2ZvdW5kJywgJ1RoYXQgYWdlbnQgaXMgbm8gbG9uZ2VyIGtub3duLicpXG4gICAgaWYgKGFnZW50LmRpc3BhdGNoSWQpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGN0eC5jbGkucnVuKFsnb3JjaGVzdHJhdGlvbicsICd3b3JrZXItc3RvcCcsICctLWRpc3BhdGNoJywgYWdlbnQuZGlzcGF0Y2hJZF0pXG4gICAgICByZXR1cm4gcmVzdWx0Lm9rID8gb2socmVzdWx0LnJlc3VsdCkgOiBmYWlsKHJlc3VsdC5jb2RlLCByZXN1bHQubWVzc2FnZSlcbiAgICB9XG4gICAgaWYgKGFnZW50LnRlcm1pbmFsSWQgJiYgdGhpcy5kZXBzLm93blRlcm1pbmFscy5oYXMoYWdlbnQudGVybWluYWxJZCkgJiYgY3R4Lm9yY2EuaG9zdC5oYXMoJ3Rlcm1pbmFsLmNsb3NlJykpIHtcbiAgICAgIHJldHVybiBvayhhd2FpdCBjdHgub3JjYS5ob3N0LmNhbGwoJ3Rlcm1pbmFsLmNsb3NlJywgeyB0ZXJtaW5hbElkOiBhZ2VudC50ZXJtaW5hbElkIH0pKVxuICAgIH1cbiAgICByZXR1cm4gZmFpbCgnbm90X3Blcm1pdHRlZCcsICdPcmNhIGxldHMgcGx1Z2lucyBzdG9wIG9yY2hlc3RyYXRpb24gd29ya2VycyBhbmQgdGVybWluYWxzIEFnZW50IEZsb3cgb3BlbmVkLiBTdG9wIHRoaXMgYWdlbnQgZnJvbSBpdHMgb3duIHRhYi4nKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjYW5jZWxUYXNrKHRhc2tJZDogc3RyaW5nLCBydW5JZDogc3RyaW5nKTogUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+IHtcbiAgICBjb25zdCB7IGN0eCB9ID0gdGhpcy5kZXBzXG4gICAgY29uc3QgdGFzayA9IGN0eC5zdG9yZS5yZWFkKCkudGFza3NbdGFza0lkXVxuICAgIGlmICghdGFzayB8fCB0YXNrLnJ1bklkICE9PSBydW5JZCkgcmV0dXJuIGZhaWwoJ25vdF9mb3VuZCcsICdUaGF0IHRhc2sgaXMgbm90IGluIHRoaXMgcnVuLicpXG4gICAgY29uc3QgbGl2ZSA9IHRhc2suZGlzcGF0Y2hJZHMubWFwKChpZCkgPT4gY3R4LnN0b3JlLnJlYWQoKS5hZ2VudHNbYGRpc3BhdGNoOiR7aWR9YF0pLmZpbHRlcigoYWdlbnQpID0+IGFnZW50Py5saXZlKVxuICAgIGNvbnN0IHN0b3BwZWQ6IHN0cmluZ1tdID0gW11cbiAgICBmb3IgKGNvbnN0IGFnZW50IG9mIGxpdmUpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGN0eC5jbGkucnVuKFsnb3JjaGVzdHJhdGlvbicsICd3b3JrZXItc3RvcCcsICctLWRpc3BhdGNoJywgYWdlbnQhLmRpc3BhdGNoSWQhXSlcbiAgICAgIGlmICghcmVzdWx0Lm9rKSByZXR1cm4gZmFpbChyZXN1bHQuY29kZSwgYENvdWxkIG5vdCBzdG9wICR7YWdlbnQhLnRpdGxlID8/IGFnZW50IS5kaXNwYXRjaElkfTogJHtyZXN1bHQubWVzc2FnZX1gKVxuICAgICAgc3RvcHBlZC5wdXNoKGFnZW50IS5kaXNwYXRjaElkISlcbiAgICB9XG4gICAgLy8gT3JjYTogXCJUbyBjYW5jZWwgYSBUYXNrLCBzdG9wIGl0cyB3b3JrZXIsIHRoZW4gc2V0IC0tc3RhdHVzIGZhaWxlZCAtLXJlc3VsdCBjYW5jZWxsZWRcIi5cbiAgICBjb25zdCB1cGRhdGUgPSBhd2FpdCB0aGlzLmNvb3JkaW5hdG9yQ29tbWFuZCh7IHJlcXVlc3RJZDogJ2ludGVybmFsJywga2luZDogJ3Rhc2sudXBkYXRlJywgcGFyYW1zOiB7IHRhc2tJZCwgcnVuSWQsIHN0YXR1czogJ2ZhaWxlZCcsIHJlc3VsdDogJ2NhbmNlbGxlZCcgfSB9KVxuICAgIGlmICh1cGRhdGUub2spIHJldHVybiBvayh7IHN0b3BwZWQsIG1hcmtlZDogdHJ1ZSB9KVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogdXBkYXRlLmVycm9yLmNvZGUsIG1lc3NhZ2U6IGBTdG9wcGVkICR7c3RvcHBlZC5sZW5ndGh9IHdvcmtlcihzKS4gJHt1cGRhdGUuZXJyb3IubWVzc2FnZX1gIH0sIG1hbnVhbDogdXBkYXRlLm1hbnVhbCB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvb3JkaW5hdG9yQ29tbWFuZChyZXF1ZXN0OiBDb21tYW5kUmVxdWVzdCk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3QgeyBjdHggfSA9IHRoaXMuZGVwc1xuICAgIGNvbnN0IHJ1bklkID0gU3RyaW5nKHJlcXVlc3QucGFyYW1zLnJ1bklkID8/ICcnKVxuICAgIGNvbnN0IHJ1biA9IHJ1bklkID8gY3R4LnN0b3JlLnJlYWQoKS5ydW5zW3J1bklkXSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGFyZ3MgPSBjb29yZGluYXRvckFyZ3MocmVxdWVzdCwgY3R4LnN0b3JlLnJlYWQoKSlcbiAgICBpZiAoIWFyZ3MpIHJldHVybiBmYWlsKCdpbnZhbGlkX3BhcmFtcycsICdUaGF0IGNvbW1hbmQgbmVlZHMgYSBrbm93biBydW4gYW5kIHRhc2suJylcbiAgICBjb25zdCBkaXNwbGF5ID0gYG9yY2EgJHthcmdzLm1hcChzaGVsbFF1b3RlKS5qb2luKCcgJyl9YFxuICAgIGlmICghdGhpcy5kZXBzLnNldHRpbmdzKCkuYWN0QXNDb29yZGluYXRvciB8fCAhcnVuPy5jb29yZGluYXRvckhhbmRsZSkge1xuICAgICAgY29uc3QgcmVhc29uID0gcnVuPy5jb29yZGluYXRvckhhbmRsZVxuICAgICAgICA/ICdPcmNhIG9ubHkgbGV0cyBhIFJ1blx1MjAxOXMgY29vcmRpbmF0b3IgZG8gdGhpcy4gUnVuIHRoaXMgaW4gdGhlIGNvb3JkaW5hdG9yLCBvciB0dXJuIG9uIFx1MjAxQ0FjdCBhcyBjb29yZGluYXRvclx1MjAxRCBpbiBBZ2VudCBGbG93IHNldHRpbmdzLidcbiAgICAgICAgOiAnT3JjYSBvbmx5IGxldHMgYSBSdW5cdTIwMTlzIGNvb3JkaW5hdG9yIGRvIHRoaXMuIFRoaXMgUnVuXHUyMDE5cyBjb29yZGluYXRvciBoYXMgbm8gdGVybWluYWwgaGFuZGxlIChpdCBpcyBhIGNoYXQgc2Vzc2lvbiwgb3IgT3JjYSBkaWQgbm90IHJlY29yZCBvbmUpLCBzbyBwYXN0ZSB0aGlzIGNvbW1hbmQgaW50byB0aGUgY29vcmRpbmF0b3IuJ1xuICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAnY29vcmRpbmF0b3JfcmVxdWlyZWQnLCBtZXNzYWdlOiByZWFzb24gfSwgbWFudWFsOiB7IGNvbW1hbmQ6IGRpc3BsYXksIHJlYXNvbiB9IH1cbiAgICB9XG4gICAgLy8gT25lIGFyZ3YgZWxlbWVudCwgbGlrZSBldmVyeSBvdGhlciB2YWx1ZTogYSBoYW5kbGUgY2FuIG5ldmVyIGJlIHJlYWQgYXMgYW5vdGhlciBmbGFnLlxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGN0eC5jbGkucnVuKFsuLi5hcmdzLCBgLS1mcm9tPSR7cnVuLmNvb3JkaW5hdG9ySGFuZGxlfWBdLCB7IHRpbWVvdXRNczogOTAwMDAgfSlcbiAgICByZXR1cm4gcmVzdWx0Lm9rID8gb2socmVzdWx0LnJlc3VsdCkgOiB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogcmVzdWx0LmNvZGUsIG1lc3NhZ2U6IHJlc3VsdC5tZXNzYWdlIH0sIG1hbnVhbDogeyBjb21tYW5kOiBkaXNwbGF5LCByZWFzb246IHJlc3VsdC5tZXNzYWdlIH0gfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbnNwZWN0KHBhdGg6IHN0cmluZyk6IFByb21pc2U8Q29tbWFuZFJlc3BvbnNlPiB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLmRlcHMuY3R4LnN0b3JlLnJlYWQoKVxuICAgIGNvbnN0IGtub3duID0gT2JqZWN0LnZhbHVlcyhzdGF0ZS53b3JrdHJlZXMpLnNvbWUoKHcpID0+IHcucGF0aCA9PT0gcGF0aCkgfHwgT2JqZWN0LnZhbHVlcyhzdGF0ZS5hZ2VudHMpLnNvbWUoKGEpID0+IGEud29ya3RyZWVQYXRoID09PSBwYXRoKVxuICAgIGlmICgha25vd24pIHJldHVybiBmYWlsKCdub3RfcGVybWl0dGVkJywgJ0FnZW50IEZsb3cgb25seSBpbnNwZWN0cyB3b3JrdHJlZXMgT3JjYSBrbm93cyBhYm91dC4nKVxuICAgIHJldHVybiBvayhhd2FpdCBpbnNwZWN0V29ya3RyZWUocGF0aCkpXG4gIH1cbn1cblxuLyoqIENvbG9ycyBlbmQgdXAgaW4gQ1NTOiBvbmx5ICNyZ2IgLyAjcnJnZ2JiIHN1cnZpdmUuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVDb2xvcnMoY29sb3JzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXMoY29sb3JzKS5maWx0ZXIoKFssIHZdKSA9PiAvXiMoWzAtOWEtZl17M318WzAtOWEtZl17Nn0pJC9pLnRlc3QodikpKVxufVxuXG4vKiogS2VlcHMgYSBjb252ZXJzYXRpb24gYW5zd2VyIHVuZGVyIE9yY2EncyAxIE1pQiBwYW5lbCBsaW1pdCBieSBkcm9wcGluZyB0aGUgb2xkZXN0IG1lc3NhZ2VzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpdE91dHB1dChyZXNwb25zZTogQ29tbWFuZFJlc3BvbnNlLCBidWRnZXQgPSBPVVRQVVRfQlVER0VUKTogQ29tbWFuZFJlc3BvbnNlIHtcbiAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIHJlc3BvbnNlXG4gIGNvbnN0IHJlc3VsdCA9IHJlc3BvbnNlLnJlc3VsdCBhcyB7IGtpbmQ/OiBzdHJpbmc7IG1lc3NhZ2VzPzogdW5rbm93bltdOyB0cnVuY2F0ZWQ/OiBib29sZWFuIH1cbiAgaWYgKHJlc3VsdD8ua2luZCAhPT0gJ2NvbnZlcnNhdGlvbicgfHwgIUFycmF5LmlzQXJyYXkocmVzdWx0Lm1lc3NhZ2VzKSkgcmV0dXJuIHJlc3BvbnNlXG4gIGxldCBtZXNzYWdlcyA9IHJlc3VsdC5tZXNzYWdlc1xuICB3aGlsZSAobWVzc2FnZXMubGVuZ3RoID4gMSAmJiBCdWZmZXIuYnl0ZUxlbmd0aChKU09OLnN0cmluZ2lmeSh7IC4uLnJlc3VsdCwgbWVzc2FnZXMgfSkpID4gYnVkZ2V0KSBtZXNzYWdlcyA9IG1lc3NhZ2VzLnNsaWNlKE1hdGguY2VpbChtZXNzYWdlcy5sZW5ndGggLyA4KSlcbiAgcmV0dXJuIG1lc3NhZ2VzID09PSByZXN1bHQubWVzc2FnZXMgPyByZXNwb25zZSA6IHsgb2s6IHRydWUsIHJlc3VsdDogeyAuLi5yZXN1bHQsIG1lc3NhZ2VzLCB0cnVuY2F0ZWQ6IHRydWUgfSB9XG59XG5cbi8qKiBBZGRzIGEgc2hvcnQgY29udGVudCBoYXNoLCBzbyBhIHZpZXcgY2FuIGFzayBcImFueXRoaW5nIG5ldyBzaW5jZSB0aGlzIHZlcnNpb24/XCIuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFZlcnNpb24ocmVzcG9uc2U6IENvbW1hbmRSZXNwb25zZSk6IENvbW1hbmRSZXNwb25zZSB7XG4gIGlmICghcmVzcG9uc2Uub2sgfHwgIXJlc3BvbnNlLnJlc3VsdCB8fCB0eXBlb2YgcmVzcG9uc2UucmVzdWx0ICE9PSAnb2JqZWN0JykgcmV0dXJuIHJlc3BvbnNlXG4gIGNvbnN0IHZlcnNpb24gPSBjcmVhdGVIYXNoKCdzaGExJykudXBkYXRlKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlLnJlc3VsdCkpLmRpZ2VzdCgnaGV4Jykuc2xpY2UoMCwgMTYpXG4gIHJldHVybiB7IG9rOiB0cnVlLCByZXN1bHQ6IHsgLi4uKHJlc3BvbnNlLnJlc3VsdCBhcyBvYmplY3QpLCB2ZXJzaW9uIH0gfVxufVxuXG5mdW5jdGlvbiBvayhyZXN1bHQ6IHVua25vd24pOiBDb21tYW5kUmVzcG9uc2Uge1xuICByZXR1cm4geyBvazogdHJ1ZSwgcmVzdWx0IH1cbn1cblxuZnVuY3Rpb24gZmFpbChjb2RlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZyk6IENvbW1hbmRSZXNwb25zZSB7XG4gIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZSwgbWVzc2FnZSB9IH1cbn1cbiIsICIvLyBSZWFkLW9ubHkgR2l0IGluc3BlY3Rpb24gb2YgYSB3b3JrdHJlZSBPcmNhIGFscmVhZHkga25vd3MgYWJvdXQuIE5ldmVyIHdyaXRlcywgbWVyZ2VzIG9yIHB1c2hlcy5cbmltcG9ydCB7IGV4ZWNGaWxlIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgcmVkYWN0LCB0cnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5cbmV4cG9ydCB0eXBlIEdpdEluc3BlY3Rpb24gPSB7XG4gIHBhdGg6IHN0cmluZ1xuICBicmFuY2g6IHN0cmluZyB8IG51bGxcbiAgaGVhZDogc3RyaW5nIHwgbnVsbFxuICBjaGFuZ2VkRmlsZXM6IHsgc3RhdHVzOiBzdHJpbmc7IHBhdGg6IHN0cmluZyB9W11cbiAgZGlmZlN0YXQ6IHN0cmluZ1xuICBjb21taXRzOiB7IGhhc2g6IHN0cmluZzsgc3ViamVjdDogc3RyaW5nOyBhdXRob3I6IHN0cmluZzsgYXQ6IG51bWJlciB9W11cbiAgY29uZmxpY3RzOiBzdHJpbmdbXVxuICBhaGVhZDogbnVtYmVyIHwgbnVsbFxuICBiZWhpbmQ6IG51bWJlciB8IG51bGxcbn1cblxuZnVuY3Rpb24gZ2l0KGN3ZDogc3RyaW5nLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgZXhlY0ZpbGUoJ2dpdCcsIFsnLUMnLCBjd2QsICctLW5vLW9wdGlvbmFsLWxvY2tzJywgLi4uYXJnc10sIHsgdGltZW91dDogODAwMCwgbWF4QnVmZmVyOiA0ICogMTAyNCAqIDEwMjQsIGVudjogeyAuLi5wcm9jZXNzLmVudiwgR0lUX1RFUk1JTkFMX1BST01QVDogJzAnLCBHSVRfT1BUSU9OQUxfTE9DS1M6ICcwJyB9IH0sIChlcnJvciwgc3Rkb3V0KSA9PlxuICAgICAgZXJyb3IgPyByZWplY3QoZXJyb3IpIDogcmVzb2x2ZShzdGRvdXQpXG4gICAgKVxuICB9KVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFdvcmt0cmVlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8R2l0SW5zcGVjdGlvbj4ge1xuICBjb25zdCBbYnJhbmNoLCBoZWFkLCBzdGF0dXMsIGRpZmZTdGF0LCBsb2csIHVwc3RyZWFtXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBnaXQocGF0aCwgWydyZXYtcGFyc2UnLCAnLS1hYmJyZXYtcmVmJywgJ0hFQUQnXSkuY2F0Y2goKCkgPT4gJycpLFxuICAgIGdpdChwYXRoLCBbJ3Jldi1wYXJzZScsICctLXNob3J0JywgJ0hFQUQnXSkuY2F0Y2goKCkgPT4gJycpLFxuICAgIGdpdChwYXRoLCBbJ3N0YXR1cycsICctLXBvcmNlbGFpbj12MScsICctdWFsbCddKS5jYXRjaCgoKSA9PiAnJyksXG4gICAgZ2l0KHBhdGgsIFsnZGlmZicsICctLXN0YXQnLCAnSEVBRCddKS5jYXRjaCgoKSA9PiAnJyksXG4gICAgZ2l0KHBhdGgsIFsnbG9nJywgJy1uJywgJzIwJywgJy0tZm9ybWF0PSVoJXgxZiVzJXgxZiVhbiV4MWYlY3QnXSkuY2F0Y2goKCkgPT4gJycpLFxuICAgIGdpdChwYXRoLCBbJ3Jldi1saXN0JywgJy0tbGVmdC1yaWdodCcsICctLWNvdW50JywgJ0hFQUQuLi5Ae3Vwc3RyZWFtfSddKS5jYXRjaCgoKSA9PiAnJylcbiAgXSlcbiAgY29uc3QgY2hhbmdlZEZpbGVzID0gc3RhdHVzXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAuc2xpY2UoMCwgNTAwKVxuICAgIC5tYXAoKGxpbmUpID0+ICh7IHN0YXR1czogbGluZS5zbGljZSgwLCAyKS50cmltKCkgfHwgJz8nLCBwYXRoOiBsaW5lLnNsaWNlKDMpIH0pKVxuICBjb25zdCBjb25mbGljdHMgPSBjaGFuZ2VkRmlsZXMuZmlsdGVyKChmaWxlKSA9PiBbJ1VVJywgJ0FBJywgJ0REJywgJ0FVJywgJ1VBJywgJ0RVJywgJ1VEJ10uaW5jbHVkZXMoZmlsZS5zdGF0dXMpKS5tYXAoKGZpbGUpID0+IGZpbGUucGF0aClcbiAgY29uc3QgY29tbWl0cyA9IGxvZ1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLm1hcCgobGluZSkgPT4ge1xuICAgICAgY29uc3QgW2hhc2gsIHN1YmplY3QsIGF1dGhvciwgY3RdID0gbGluZS5zcGxpdCgnXFx4MWYnKVxuICAgICAgcmV0dXJuIHsgaGFzaCwgc3ViamVjdDogcmVkYWN0KHN1YmplY3QgPz8gJycpLCBhdXRob3I6IGF1dGhvciA/PyAnJywgYXQ6IE51bWJlcihjdCkgKiAxMDAwIH1cbiAgICB9KVxuICBjb25zdCBbYWhlYWQsIGJlaGluZF0gPSB1cHN0cmVhbS50cmltKCkgPyB1cHN0cmVhbS50cmltKCkuc3BsaXQoL1xccysvKS5tYXAoTnVtYmVyKSA6IFtudWxsLCBudWxsXVxuICByZXR1cm4ge1xuICAgIHBhdGgsXG4gICAgYnJhbmNoOiBicmFuY2gudHJpbSgpIHx8IG51bGwsXG4gICAgaGVhZDogaGVhZC50cmltKCkgfHwgbnVsbCxcbiAgICBjaGFuZ2VkRmlsZXMsXG4gICAgZGlmZlN0YXQ6IHRydW5jYXRlKGRpZmZTdGF0LnRyaW0oKSwgODAwMCksXG4gICAgY29tbWl0cyxcbiAgICBjb25mbGljdHMsXG4gICAgYWhlYWQ6IE51bWJlci5pc0Zpbml0ZShhaGVhZCkgPyBhaGVhZCA6IG51bGwsXG4gICAgYmVoaW5kOiBOdW1iZXIuaXNGaW5pdGUoYmVoaW5kKSA/IGJlaGluZCA6IG51bGxcbiAgfVxufVxuIiwgIi8vIEJ1aWxkcyB0aGUgZXhhY3QgYG9yY2Egb3JjaGVzdHJhdGlvbiBcdTIwMjZgIGFyZ3VtZW50cyBmb3IgY29vcmRpbmF0b3Itb25seSBhY3Rpb25zLlxuaW1wb3J0IHR5cGUgeyBDb21tYW5kUmVxdWVzdCB9IGZyb20gJy4uLy4uL3NoYXJlZC9jb21tYW5kcy50cydcbmltcG9ydCB0eXBlIHsgRmxvd1N0YXRlIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuXG4vKipcbiAqIE9yY2EncyBDTEkgcGFyc2VyIHRyZWF0cyBhbnkgYXJndiBlbGVtZW50IHN0YXJ0aW5nIHdpdGggYC0tYCBhcyBhIG5ldyBmbGFnLCBzbyBhIHZhbHVlIGlzXG4gKiBhbHdheXMgcGFzc2VkIGluIHRoZSBzYW1lIGVsZW1lbnQgYXMgaXRzIGZsYWcgKGAtLXNwZWM9XHUyMDI2YCkuIEZyZWUgdGV4dCB0aGF0IGhhcHBlbnMgdG8gc3RhcnRcbiAqIHdpdGggYC0tYCBjYW4gdGhlbiBuZXZlciBiZSByZWFkIGFzIGFub3RoZXIgZmxhZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYWcobmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAtLSR7bmFtZX09JHt2YWx1ZX1gXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb29yZGluYXRvckFyZ3MocmVxdWVzdDogQ29tbWFuZFJlcXVlc3QsIHN0YXRlOiBGbG93U3RhdGUpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCBwID0gcmVxdWVzdC5wYXJhbXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3QgcnVuSWQgPSB0eXBlb2YgcC5ydW5JZCA9PT0gJ3N0cmluZycgPyBwLnJ1bklkIDogbnVsbFxuICBpZiAoIXJ1bklkIHx8ICFzdGF0ZS5ydW5zW3J1bklkXSkgcmV0dXJuIG51bGxcbiAgY29uc3QgcyA9IChrZXk6IHN0cmluZykgPT4gKHR5cGVvZiBwW2tleV0gPT09ICdzdHJpbmcnID8gKHBba2V5XSBhcyBzdHJpbmcpIDogbnVsbClcbiAgc3dpdGNoIChyZXF1ZXN0LmtpbmQpIHtcbiAgICBjYXNlICd0YXNrLmNyZWF0ZSc6IHtcbiAgICAgIGNvbnN0IGFyZ3MgPSBbJ29yY2hlc3RyYXRpb24nLCAndGFzay1jcmVhdGUnLCBmbGFnKCdydW4nLCBydW5JZCksIGZsYWcoJ3Rhc2stdGl0bGUnLCBzKCd0aXRsZScpID8/ICdUYXNrJyksIGZsYWcoJ3NwZWMnLCBzKCdzcGVjJykgPz8gJycpXVxuICAgICAgY29uc3QgZGVwcyA9IEFycmF5LmlzQXJyYXkocC5kZXBzKSA/IChwLmRlcHMgYXMgc3RyaW5nW10pIDogW11cbiAgICAgIGlmIChkZXBzLmxlbmd0aCkgYXJncy5wdXNoKGZsYWcoJ2RlcHMnLCBKU09OLnN0cmluZ2lmeShkZXBzKSkpXG4gICAgICBpZiAocygncGFyZW50SWQnKSkgYXJncy5wdXNoKGZsYWcoJ3BhcmVudCcsIHMoJ3BhcmVudElkJykhKSlcbiAgICAgIHJldHVybiBhcmdzXG4gICAgfVxuICAgIGNhc2UgJ3Rhc2sudXBkYXRlJzoge1xuICAgICAgY29uc3QgdGFza0lkID0gcygndGFza0lkJylcbiAgICAgIGlmICghdGFza0lkIHx8IHN0YXRlLnRhc2tzW3Rhc2tJZF0/LnJ1bklkICE9PSBydW5JZCkgcmV0dXJuIG51bGxcbiAgICAgIGNvbnN0IGFyZ3MgPSBbJ29yY2hlc3RyYXRpb24nLCAndGFzay11cGRhdGUnLCBmbGFnKCdydW4nLCBydW5JZCksIGZsYWcoJ2lkJywgdGFza0lkKSwgZmxhZygnc3RhdHVzJywgcygnc3RhdHVzJykgPz8gJ3BlbmRpbmcnKV1cbiAgICAgIGlmIChzKCdyZXN1bHQnKSkgYXJncy5wdXNoKGZsYWcoJ3Jlc3VsdCcsIHMoJ3Jlc3VsdCcpISkpXG4gICAgICByZXR1cm4gYXJnc1xuICAgIH1cbiAgICBjYXNlICd0YXNrLnJldHJ5JzpcbiAgICBjYXNlICd0YXNrLmRpc3BhdGNoJzoge1xuICAgICAgY29uc3QgdGFza0lkID0gcygndGFza0lkJylcbiAgICAgIGNvbnN0IHRhc2sgPSB0YXNrSWQgPyBzdGF0ZS50YXNrc1t0YXNrSWRdIDogdW5kZWZpbmVkXG4gICAgICBpZiAoIXRhc2sgfHwgdGFzay5ydW5JZCAhPT0gcnVuSWQpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhcmdzID0gWydvcmNoZXN0cmF0aW9uJywgJ3dvcmtlci1zdGFydCcsIGZsYWcoJ3J1bicsIHJ1bklkKSwgZmxhZygndGFzaycsIHRhc2suaWQpXVxuICAgICAgaWYgKHJlcXVlc3Qua2luZCA9PT0gJ3Rhc2sucmV0cnknKSB7XG4gICAgICAgIGNvbnN0IGxhc3QgPSB0YXNrLmRpc3BhdGNoSWRzW3Rhc2suZGlzcGF0Y2hJZHMubGVuZ3RoIC0gMV1cbiAgICAgICAgaWYgKGxhc3QpIGFyZ3MucHVzaChmbGFnKCdyZXRyeS1vZicsIGxhc3QpKVxuICAgICAgfVxuICAgICAgaWYgKHMoJ2FnZW50JykpIGFyZ3MucHVzaChmbGFnKCdhZ2VudCcsIHMoJ2FnZW50JykhKSlcbiAgICAgIGlmIChzKCdtb2RlbCcpKSBhcmdzLnB1c2goZmxhZygnbW9kZWwnLCBzKCdtb2RlbCcpISkpXG4gICAgICBpZiAocygnbW9kZWwnKSAmJiBzKCdlZmZvcnQnKSkgYXJncy5wdXNoKGZsYWcoJ2VmZm9ydCcsIHMoJ2VmZm9ydCcpISkpXG4gICAgICBhcmdzLnB1c2goZmxhZygnd29ya3RyZWUnLCBzKCd3b3JrdHJlZScpID8/ICduZXctY2hpbGQnKSlcbiAgICAgIHJldHVybiBhcmdzXG4gICAgfVxuICAgIGNhc2UgJ2dhdGUucmVzb2x2ZSc6IHtcbiAgICAgIGNvbnN0IGdhdGVJZCA9IHMoJ2dhdGVJZCcpXG4gICAgICBpZiAoIWdhdGVJZCkgcmV0dXJuIG51bGxcbiAgICAgIC8vIFRoZSBnYXRlIG11c3QgYmVsb25nIHRvIGEgdGFzayBvZiB0aGlzIHJ1bjsgb3RoZXJ3aXNlIGEgcnVuJ3MgY29udHJvbHMgY291bGQgcmVzb2x2ZSBhbm90aGVyIHJ1bidzIGdhdGUuXG4gICAgICBjb25zdCB0YXNrSWQgPSBzdGF0ZS5nYXRlc1tnYXRlSWRdPy50YXNrSWRcbiAgICAgIGlmICghdGFza0lkIHx8IHN0YXRlLnRhc2tzW3Rhc2tJZF0/LnJ1bklkICE9PSBydW5JZCkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiBbJ29yY2hlc3RyYXRpb24nLCAnZ2F0ZS1yZXNvbHZlJywgZmxhZygnaWQnLCBnYXRlSWQpLCBmbGFnKCdyZXNvbHV0aW9uJywgcygncmVzb2x1dGlvbicpID8/ICcnKV1cbiAgICB9XG4gICAgY2FzZSAnbWVzc2FnZS5zZW5kJzpcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdvcmNoZXN0cmF0aW9uJywgJ3NlbmQnLCBmbGFnKCdydW4nLCBydW5JZCksIGZsYWcoJ3RvJywgcygndG8nKSA/PyBgcnVuOiR7cnVuSWR9YCksXG4gICAgICAgIGZsYWcoJ3N1YmplY3QnLCBzKCdzdWJqZWN0JykgPz8gJycpLCBmbGFnKCdib2R5JywgcygnYm9keScpID8/ICcnKSwgZmxhZygndHlwZScsICdzdGF0dXMnKVxuICAgICAgXVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbi8qKiBQT1NJWCBzaGVsbCBxdW90aW5nIGZvciB0aGUgY29weWFibGUgY29tbWFuZCBzaG93biB0byB0aGUgcGVyc29uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNoZWxsUXVvdGUoYXJnOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gL15bQS1aYS16MC05X0AlKz06LC4vLV0rJC8udGVzdChhcmcpID8gYXJnIDogYCcke2FyZy5yZXBsYWNlKC8nL2csIGAnXFxcXCcnYCl9J2Bcbn1cbiIsICIvLyBSZWFkcyBhIHdvcmtlcidzIGNvbnZlcnNhdGlvbiB3aXRoIGBvcmNhIG9yY2hlc3RyYXRpb24gd29ya2VyLXJlYWRgICh0cmFuc2NyaXB0IHdoZW4gT3JjYSBoYXNcbi8vIG9uZSwgbGFiZWxsZWQgdGVybWluYWwgb3V0cHV0IG90aGVyd2lzZSkgYW5kIG5vcm1hbGl6ZXMgaXQgZm9yIHRoZSBpbnNwZWN0b3IuXG5pbXBvcnQgeyByZWRhY3QsIHN0cmlwQW5zaSwgdHJ1bmNhdGUgfSBmcm9tICcuLi8uLi9zaGFyZWQvcmVkYWN0LnRzJ1xuaW1wb3J0IHR5cGUgeyBDbGlSdW5uZXIgfSBmcm9tICcuLi9jbGkvb3JjYS1jbGkudHMnXG5cbmV4cG9ydCB0eXBlIENvbnZlcnNhdGlvbkJsb2NrID1cbiAgfCB7IHR5cGU6ICd0ZXh0JzsgdGV4dDogc3RyaW5nIH1cbiAgfCB7IHR5cGU6ICd0aGlua2luZyc7IHRleHQ6IHN0cmluZyB9XG4gIHwgeyB0eXBlOiAndG9vbC1jYWxsJzsgbmFtZTogc3RyaW5nOyBpbnB1dDogc3RyaW5nIH1cbiAgfCB7IHR5cGU6ICd0b29sLXJlc3VsdCc7IG91dHB1dDogc3RyaW5nOyBpc0Vycm9yOiBib29sZWFuOyBpbWFnZXM/OiBJbWFnZVJlZltdIH1cbiAgfCB7IHR5cGU6ICdpbWFnZSc7IGltYWdlOiBJbWFnZVJlZiB9XG5cbi8qKiBBbiBpbWFnZSBrZXB0IGluIHRoZSB0cmFuc2NyaXB0OyBpdHMgYnl0ZXMgYXJlIGZldGNoZWQgb24gZGVtYW5kIHdpdGggYGFnZW50LmltYWdlYC4gKi9cbmV4cG9ydCB0eXBlIEltYWdlUmVmID0geyByZWY6IHN0cmluZzsgbWVkaWFUeXBlOiBzdHJpbmc7IGJ5dGVzOiBudW1iZXIgfVxuXG5leHBvcnQgdHlwZSBDb252ZXJzYXRpb25NZXNzYWdlID0geyBpZDogc3RyaW5nOyByb2xlOiBzdHJpbmc7IHRzOiBudW1iZXIgfCBudWxsOyBibG9ja3M6IENvbnZlcnNhdGlvbkJsb2NrW107IG1vZGVsPzogc3RyaW5nIHwgbnVsbDsgZWZmb3J0Pzogc3RyaW5nIHwgbnVsbCB9XG5cbmV4cG9ydCB0eXBlIEFnZW50T3V0cHV0ID1cbiAgfCB7IGtpbmQ6ICdjb252ZXJzYXRpb24nOyBzb3VyY2U6IHN0cmluZzsgcHJvdmlkZXI6IHN0cmluZyB8IG51bGw7IG1lc3NhZ2VzOiBDb252ZXJzYXRpb25NZXNzYWdlW107IHRydW5jYXRlZDogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiAnbGluZXMnOyBzb3VyY2U6IHN0cmluZzsgbGluZXM6IHN0cmluZ1tdOyB0cnVuY2F0ZWQ6IGJvb2xlYW4gfVxuXG5jb25zdCBQQUdFX0xJTUlUID0gMTAwXG5jb25zdCBNQVhfUEFHRVMgPSA4XG5jb25zdCBLRUVQX01FU1NBR0VTID0gMTYwXG5jb25zdCBURVhUX0xJTUlUID0gNDAwMFxuY29uc3QgVE9PTF9MSU1JVCA9IDE1MDBcblxudHlwZSBSYXdSZWFkID0ge1xuICBzb3VyY2U/OiBzdHJpbmdcbiAgcHJvdmlkZXI/OiBzdHJpbmcgfCBudWxsXG4gIHRyYW5zY3JpcHQ/OiB7IG1lc3NhZ2VzPzogdW5rbm93bltdOyBuZXh0Q3Vyc29yPzogc3RyaW5nIHwgbnVsbCB9IHwgbnVsbFxuICBjdXJzb3I/OiBzdHJpbmcgfCBudWxsXG4gIHJvd3M/OiB1bmtub3duW11cbiAgbGluZXM/OiB1bmtub3duW11cbiAgdGV4dD86IHN0cmluZ1xufVxuXG4vKiogUGFnZXMgZm9yd2FyZCB0aHJvdWdoIHRoZSB0cmFuc2NyaXB0IGFuZCBrZWVwcyB0aGUgbmV3ZXN0IG1lc3NhZ2VzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRXb3JrZXJPdXRwdXQoY2xpOiBDbGlSdW5uZXIsIGRpc3BhdGNoSWQ6IHN0cmluZyk6IFByb21pc2U8QWdlbnRPdXRwdXQgfCBudWxsPiB7XG4gIGNvbnN0IG1lc3NhZ2VzOiBDb252ZXJzYXRpb25NZXNzYWdlW10gPSBbXVxuICBsZXQgY3Vyc29yOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICBsZXQgZmlyc3Q6IFJhd1JlYWQgfCBudWxsID0gbnVsbFxuICBsZXQgdHJ1bmNhdGVkID0gZmFsc2VcbiAgZm9yIChsZXQgcGFnZSA9IDA7IHBhZ2UgPCBNQVhfUEFHRVM7IHBhZ2UrKykge1xuICAgIGNvbnN0IGFyZ3MgPSBbJ29yY2hlc3RyYXRpb24nLCAnd29ya2VyLXJlYWQnLCAnLS1kaXNwYXRjaCcsIGRpc3BhdGNoSWQsICctLWxpbWl0JywgU3RyaW5nKFBBR0VfTElNSVQpLCAnLS1mdWxsJ11cbiAgICBpZiAoY3Vyc29yKSBhcmdzLnB1c2goJy0tY3Vyc29yJywgY3Vyc29yKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNsaS5ydW48UmF3UmVhZD4oYXJncywgeyB0aW1lb3V0TXM6IDIwMDAwIH0pXG4gICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgIGlmICghZmlyc3QpIHJldHVybiBudWxsXG4gICAgICBicmVha1xuICAgIH1cbiAgICBmaXJzdCA/Pz0gcmVzdWx0LnJlc3VsdFxuICAgIGNvbnN0IHRyYW5zY3JpcHQgPSByZXN1bHQucmVzdWx0LnRyYW5zY3JpcHRcbiAgICBpZiAoIXRyYW5zY3JpcHQ/Lm1lc3NhZ2VzKSBicmVha1xuICAgIGZvciAoY29uc3QgcmF3IG9mIHRyYW5zY3JpcHQubWVzc2FnZXMpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBub3JtYWxpemVNZXNzYWdlKHJhdylcbiAgICAgIGlmIChtZXNzYWdlKSBtZXNzYWdlcy5wdXNoKG1lc3NhZ2UpXG4gICAgfVxuICAgIGlmIChtZXNzYWdlcy5sZW5ndGggPiBLRUVQX01FU1NBR0VTKSB7XG4gICAgICBtZXNzYWdlcy5zcGxpY2UoMCwgbWVzc2FnZXMubGVuZ3RoIC0gS0VFUF9NRVNTQUdFUylcbiAgICAgIHRydW5jYXRlZCA9IHRydWVcbiAgICB9XG4gICAgY3Vyc29yID0gdHJhbnNjcmlwdC5uZXh0Q3Vyc29yID8/IG51bGxcbiAgICBpZiAoIWN1cnNvcikgYnJlYWtcbiAgICBpZiAocGFnZSA9PT0gTUFYX1BBR0VTIC0gMSkgdHJ1bmNhdGVkID0gdHJ1ZVxuICB9XG4gIGlmICghZmlyc3QpIHJldHVybiBudWxsXG4gIGlmIChmaXJzdC50cmFuc2NyaXB0KSByZXR1cm4geyBraW5kOiAnY29udmVyc2F0aW9uJywgc291cmNlOiBmaXJzdC5zb3VyY2UgPz8gJ3RyYW5zY3JpcHQnLCBwcm92aWRlcjogZmlyc3QucHJvdmlkZXIgPz8gbnVsbCwgbWVzc2FnZXMsIHRydW5jYXRlZCB9XG4gIHJldHVybiB7IGtpbmQ6ICdsaW5lcycsIHNvdXJjZTogZmlyc3Quc291cmNlID8/ICd0ZXJtaW5hbCcsIGxpbmVzOiBmbGF0dGVuTGluZXMoZmlyc3QpLCB0cnVuY2F0ZWQ6IGZhbHNlIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZU1lc3NhZ2UocmF3OiB1bmtub3duKTogQ29udmVyc2F0aW9uTWVzc2FnZSB8IG51bGwge1xuICBpZiAoIXJhdyB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGxcbiAgY29uc3QgbSA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25zdCBibG9ja3M6IENvbnZlcnNhdGlvbkJsb2NrW10gPSBbXVxuICBjb25zdCByYXdCbG9ja3MgPSBBcnJheS5pc0FycmF5KG0uYmxvY2tzKSA/IG0uYmxvY2tzIDogdHlwZW9mIG0udGV4dCA9PT0gJ3N0cmluZycgPyBbeyB0eXBlOiAndGV4dCcsIHRleHQ6IG0udGV4dCB9XSA6IFtdXG4gIGZvciAoY29uc3QgYiBvZiByYXdCbG9ja3MgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSkge1xuICAgIGNvbnN0IHR5cGUgPSBTdHJpbmcoYj8udHlwZSA/PyAnJylcbiAgICBpZiAodHlwZSA9PT0gJ3RleHQnICYmIHR5cGVvZiBiLnRleHQgPT09ICdzdHJpbmcnKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0ZXh0JywgdGV4dDogY2xlYW4oYi50ZXh0LCBURVhUX0xJTUlUKSB9KVxuICAgIGVsc2UgaWYgKCh0eXBlID09PSAndGhpbmtpbmcnIHx8IHR5cGUgPT09ICdyZWFzb25pbmcnKSAmJiB0eXBlb2YgYi50ZXh0ID09PSAnc3RyaW5nJykgYmxvY2tzLnB1c2goeyB0eXBlOiAndGhpbmtpbmcnLCB0ZXh0OiBjbGVhbihiLnRleHQsIFRFWFRfTElNSVQpIH0pXG4gICAgZWxzZSBpZiAodHlwZSA9PT0gJ3Rvb2wtY2FsbCcpIGJsb2Nrcy5wdXNoKHsgdHlwZTogJ3Rvb2wtY2FsbCcsIG5hbWU6IFN0cmluZyhiLm5hbWUgPz8gJ3Rvb2wnKSwgaW5wdXQ6IGNsZWFuKHR5cGVvZiBiLmlucHV0ID09PSAnc3RyaW5nJyA/IGIuaW5wdXQgOiBKU09OLnN0cmluZ2lmeShiLmlucHV0ID8/IHt9KSwgVE9PTF9MSU1JVCkgfSlcbiAgICBlbHNlIGlmICh0eXBlID09PSAndG9vbC1yZXN1bHQnKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0b29sLXJlc3VsdCcsIG91dHB1dDogY2xlYW4odHlwZW9mIGIub3V0cHV0ID09PSAnc3RyaW5nJyA/IGIub3V0cHV0IDogSlNPTi5zdHJpbmdpZnkoYi5vdXRwdXQgPz8gJycpLCBUT09MX0xJTUlUKSwgaXNFcnJvcjogYi5pc0Vycm9yID09PSB0cnVlIHx8IGIuaXNfZXJyb3IgPT09IHRydWUgfSlcbiAgfVxuICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHJldHVybiBudWxsXG4gIHJldHVybiB7IGlkOiBTdHJpbmcobS5pZCA/PyBNYXRoLnJhbmRvbSgpKSwgcm9sZTogU3RyaW5nKG0ucm9sZSA/PyAnYXNzaXN0YW50JyksIHRzOiB0eXBlb2YgbS50aW1lc3RhbXAgPT09ICdudW1iZXInID8gbS50aW1lc3RhbXAgOiBudWxsLCBibG9ja3MgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZmxhdHRlbkxpbmVzKHJlc3VsdDogUmF3UmVhZCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IChBcnJheS5pc0FycmF5KHJlc3VsdC5yb3dzKSA/IHJlc3VsdC5yb3dzIDogQXJyYXkuaXNBcnJheShyZXN1bHQubGluZXMpID8gcmVzdWx0LmxpbmVzIDogW10pIGFzIHVua25vd25bXVxuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXVxuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHR5cGVvZiByb3cgPT09ICdzdHJpbmcnKSBsaW5lcy5wdXNoKHJvdylcbiAgICBlbHNlIGlmIChyb3cgJiYgdHlwZW9mIHJvdyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IHIgPSByb3cgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgICAgIGNvbnN0IHRleHQgPSByLnRleHQgPz8gci5jb250ZW50ID8/IHIubGluZSA/PyByLm1lc3NhZ2VcbiAgICAgIGxpbmVzLnB1c2godHlwZW9mIHRleHQgPT09ICdzdHJpbmcnID8gdGV4dCA6IEpTT04uc3RyaW5naWZ5KHJvdykpXG4gICAgfVxuICB9XG4gIGlmICghbGluZXMubGVuZ3RoICYmIHR5cGVvZiByZXN1bHQudGV4dCA9PT0gJ3N0cmluZycpIGxpbmVzLnB1c2goLi4ucmVzdWx0LnRleHQuc3BsaXQoJ1xcbicpKVxuICByZXR1cm4gbGluZXMuc2xpY2UoLTEwMDApLm1hcCgobGluZSkgPT4gY2xlYW4obGluZSwgVEVYVF9MSU1JVCkpXG59XG5cbmZ1bmN0aW9uIGNsZWFuKHRleHQ6IHN0cmluZywgbWF4OiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gcmVkYWN0KHN0cmlwQW5zaSh0cnVuY2F0ZSh0ZXh0LCBtYXgpKSlcbn1cbiIsICIvLyBTZW5kcyBhIHVzZXIgbWVzc2FnZSBpbnRvIGFuIE9yY2EgY2hhdCBzZXNzaW9uIGV4YWN0bHkgYXMgT3JjYSdzIG93biBjaGF0IGNvbXBvc2VyIGRvZXM6XG4vLyByZWFkIHRoZSBzZXNzaW9uJ3MgY3VycmVudCBmZW5jZSwgZmluZ2VycHJpbnQgdGhlIHBheWxvYWQsIHRoZW4gYGFnZW50U2Vzc2lvbi5zZW5kYC5cbmltcG9ydCB7IGNyZWF0ZUhhc2gsIHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCB7IGNhbGxPcmNhUnVudGltZSB9IGZyb20gJy4vb3JjYS1ydW50aW1lLWNsaWVudC50cydcblxuY29uc3QgU1RSVUNUVVJFRF9QUkVGSVggPSAnc3RydWN0dXJlZC1hZ2VudC1zZXNzaW9uLSdcblxuLyoqIEEgY2hhdCB0YWIncyBwYW5lIGtleSBpcyBgc3RydWN0dXJlZC1hZ2VudC1zZXNzaW9uLTxPcmNhIHNlc3Npb24gaWQ+Ojx0YWI+YC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjaGF0U2Vzc2lvbklkRnJvbVBhbmVLZXkocGFuZUtleTogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXBhbmVLZXk/LnN0YXJ0c1dpdGgoU1RSVUNUVVJFRF9QUkVGSVgpKSByZXR1cm4gbnVsbFxuICBjb25zdCBpZCA9IHBhbmVLZXkuc2xpY2UoU1RSVUNUVVJFRF9QUkVGSVgubGVuZ3RoKS5zcGxpdCgnOicpWzBdXG4gIHJldHVybiAvXltBLVphLXowLTlfLV17NCwyMDB9JC8udGVzdChpZCkgPyBpZCA6IG51bGxcbn1cblxuLyoqIE9yY2EncyBjYW5vbmljYWwgSlNPTiAoc29ydGVkIGtleXMsIHVuZGVmaW5lZCBkcm9wcGVkKSwgbWF0Y2hpbmcgaXRzIHBheWxvYWQgZmluZ2VycHJpbnQuICovXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSA/PyBudWxsKVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBgWyR7dmFsdWUubWFwKGNhbm9uaWNhbGl6ZSkuam9pbignLCcpfV1gXG4gIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpXG4gICAgLnNvcnQoKFthXSwgW2JdKSA9PiAoYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDApKVxuICByZXR1cm4gYHske2VudHJpZXMubWFwKChba2V5LCBlbnRyeV0pID0+IGAke0pTT04uc3RyaW5naWZ5KGtleSl9OiR7Y2Fub25pY2FsaXplKGVudHJ5KX1gKS5qb2luKCcsJyl9fWBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBheWxvYWRGaW5nZXJwcmludChtZXRob2Q6IHN0cmluZywgc2Vzc2lvbklkOiBzdHJpbmcsIGZpZWxkczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGNhbm9uaWNhbGl6ZSh7IG1ldGhvZCwgc2Vzc2lvbklkLCBmaWVsZHMgfSksICd1dGY4JykuZGlnZXN0KCdoZXgnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gb3BlcmF0aW9uSWQobm93ID0gRGF0ZS5ub3coKSk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtNYXRoLnRydW5jKG5vdyl9LSR7cmFuZG9tVVVJRCgpLnJlcGxhY2VBbGwoJy0nLCAnJykudG9Mb3dlckNhc2UoKX1gXG59XG5cbnR5cGUgSGlzdG9yeVBhZ2UgPSB7IHBhZ2U/OiB7IGZlbmNlPzogbnVtYmVyIH0gfVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VuZENoYXRNZXNzYWdlKHNlc3Npb25JZDogc3RyaW5nLCB0ZXh0OiBzdHJpbmcpOiBQcm9taXNlPHsgYWNjZXB0ZWQ6IHRydWUgfT4ge1xuICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgY2FsbE9yY2FSdW50aW1lPEhpc3RvcnlQYWdlPignYWdlbnRTZXNzaW9uLmhpc3RvcnknLCB7IHNlc3Npb25JZCwgZGlyZWN0aW9uOiAndGFpbCcsIGxpbWl0OiAxIH0pXG4gIGNvbnN0IGZlbmNlID0gaGlzdG9yeS5wYWdlPy5mZW5jZVxuICBpZiAodHlwZW9mIGZlbmNlICE9PSAnbnVtYmVyJykgdGhyb3cgbmV3IEVycm9yKCdPcmNhIGRpZCBub3QgcmVwb3J0IHRoaXMgY2hhdCBzZXNzaW9uXHUyMDE5cyBzdGF0ZS4nKVxuICAvLyBRdWV1ZSBiZWhpbmQgYSBydW5uaW5nIHR1cm4sIGFzIE9yY2EncyBjb21wb3NlciBkb2VzLCBpbnN0ZWFkIG9mIGJlaW5nIHJlZnVzZWQuXG4gIGNvbnN0IGZpZWxkcyA9IHsgYm9keTogeyBraW5kOiAnbWVzc2FnZScsIHJvbGU6ICd1c2VyJywgYmxvY2tzOiBbeyB0eXBlOiAndGV4dCcsIHRleHQgfV0gfSwgZGVsaXZlcnk6ICdxdWV1ZS1pZi1hY3RpdmUnIGFzIGNvbnN0IH1cbiAgYXdhaXQgY2FsbE9yY2FSdW50aW1lKCdhZ2VudFNlc3Npb24uc2VuZCcsIHtcbiAgICBlbnZlbG9wZTogeyBzZXNzaW9uSWQsIGNsaWVudE9wZXJhdGlvbklkOiBvcGVyYXRpb25JZCgpLCBleHBlY3RlZFJ1bnRpbWVGZW5jZTogZmVuY2UsIHBheWxvYWRGaW5nZXJwcmludDogcGF5bG9hZEZpbmdlcnByaW50KCdhZ2VudFNlc3Npb24uc2VuZCcsIHNlc3Npb25JZCwgZmllbGRzKSB9LFxuICAgIC4uLmZpZWxkc1xuICB9KVxuICByZXR1cm4geyBhY2NlcHRlZDogdHJ1ZSB9XG59XG4iLCAiLy8gRVhQRVJJTUVOVEFMOiBhIG1pbmltYWwgY2xpZW50IG9mIE9yY2EncyBsb2NhbCBydW50aW1lIFJQQywgdGhlIHNhbWUgcHJpdmF0ZSBVbml4IHNvY2tldCBhbmRcbi8vIGxpbmUgcHJvdG9jb2wgdGhlIGBvcmNhYCBDTEkgdXNlcy4gSXQgZXhpc3RzIG9ubHkgYmVjYXVzZSBPcmNhJ3MgcGx1Z2luIEFQSSBjYW5ub3QgeWV0IHNlbmQgYVxuLy8gbWVzc2FnZSBpbnRvIGEgY2hhdCBzZXNzaW9uIChzZWUgdXBzdHJlYW0vUFIubWQgZm9yIHRoZSBvZmZpY2lhbCBBUEkgdGhpcyBzaG91bGQgYmVjb21lKS5cbi8vXG4vLyBIYXJkIGxpbWl0czogb25seSB0aGUgbWV0aG9kcyBpbiBBTExPV0VEIGNhbiBiZSBjYWxsZWQ7IHRoZSBhdXRoIHRva2VuIGlzIHJlYWQgZnJvbSBPcmNhJ3Mgb3duXG4vLyBydW50aW1lIG1ldGFkYXRhIGZpbGUsIGtlcHQgaW4gbWVtb3J5IG9ubHksIGFuZCBuZXZlciBsb2dnZWQsIHJldHVybmVkIG9yIHNlbnQgYW55d2hlcmUgZWxzZS5cbi8vIEV2ZXJ5IGZhaWx1cmUgaXMgcmVwb3J0ZWQgYXMgc3VjaDsgbm90aGluZyBpcyByZXRyaWVkIGJsaW5kbHkuXG5pbXBvcnQgeyBjcmVhdGVDb25uZWN0aW9uIH0gZnJvbSAnbm9kZTpuZXQnXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyByZWFkRmlsZSwgc3RhdCB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBob21lZGlyLCBwbGF0Zm9ybSB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5jb25zdCBBTExPV0VEID0gbmV3IFNldChbJ2FnZW50U2Vzc2lvbi5oaXN0b3J5JywgJ2FnZW50U2Vzc2lvbi5zZW5kJ10pXG5jb25zdCBNQVhfUkVTUE9OU0VfQllURVMgPSA4ICogMTAyNCAqIDEwMjRcbmNvbnN0IE1FVEFEQVRBX0ZJTEUgPSAnb3JjYS1ydW50aW1lLmpzb24nXG5cbmV4cG9ydCBjbGFzcyBSdW50aW1lUnBjRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHJlYWRvbmx5IGNvZGU6IHN0cmluZyxcbiAgICBtZXNzYWdlOiBzdHJpbmdcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgfVxufVxuXG50eXBlIE1ldGFkYXRhID0geyBhdXRoVG9rZW46IHN0cmluZzsgdHJhbnNwb3J0czogeyBraW5kOiBzdHJpbmc7IGVuZHBvaW50OiBzdHJpbmcgfVtdIH1cblxuZXhwb3J0IGZ1bmN0aW9uIG9yY2FVc2VyRGF0YURpcigpOiBzdHJpbmcge1xuICBjb25zdCBob21lID0gaG9tZWRpcigpXG4gIGlmIChwcm9jZXNzLmVudi5PUkNBX1VTRVJfREFUQV9QQVRIKSByZXR1cm4gcHJvY2Vzcy5lbnYuT1JDQV9VU0VSX0RBVEFfUEFUSFxuICBpZiAocGxhdGZvcm0oKSA9PT0gJ2RhcndpbicpIHJldHVybiBqb2luKGhvbWUsICdMaWJyYXJ5L0FwcGxpY2F0aW9uIFN1cHBvcnQvb3JjYScpXG4gIGlmIChwbGF0Zm9ybSgpID09PSAnd2luMzInKSByZXR1cm4gam9pbihwcm9jZXNzLmVudi5BUFBEQVRBID8/IGpvaW4oaG9tZSwgJ0FwcERhdGEvUm9hbWluZycpLCAnb3JjYScpXG4gIHJldHVybiBqb2luKHByb2Nlc3MuZW52LlhER19DT05GSUdfSE9NRSA/PyBqb2luKGhvbWUsICcuY29uZmlnJyksICdvcmNhJylcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZE1ldGFkYXRhKGRpcjogc3RyaW5nKTogUHJvbWlzZTxNZXRhZGF0YT4ge1xuICBjb25zdCBwYXRoID0gam9pbihkaXIsIE1FVEFEQVRBX0ZJTEUpXG4gIHRyeSB7XG4gICAgLy8gUmVmdXNlIGEgbWV0YWRhdGEgZmlsZSBvdGhlciB1c2VycyBjb3VsZCBoYXZlIHdyaXR0ZW4uXG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IHN0YXQocGF0aClcbiAgICBpZiAocGxhdGZvcm0oKSAhPT0gJ3dpbjMyJyAmJiB0eXBlb2YgcHJvY2Vzcy5nZXR1aWQgPT09ICdmdW5jdGlvbicgJiYgaW5mby51aWQgIT09IHByb2Nlc3MuZ2V0dWlkKCkpIHRocm93IG5ldyBSdW50aW1lUnBjRXJyb3IoJ3J1bnRpbWVfdW50cnVzdGVkJywgJ09yY2EgcnVudGltZSBtZXRhZGF0YSBpcyBub3Qgb3duZWQgYnkgdGhpcyB1c2VyLicpXG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmOCcpKSBhcyBQYXJ0aWFsPE1ldGFkYXRhPlxuICAgIGlmICghcGFyc2VkLmF1dGhUb2tlbiB8fCAhQXJyYXkuaXNBcnJheShwYXJzZWQudHJhbnNwb3J0cykpIHRocm93IG5ldyBSdW50aW1lUnBjRXJyb3IoJ3J1bnRpbWVfdW5hdmFpbGFibGUnLCAnT3JjYSBydW50aW1lIG1ldGFkYXRhIGlzIGluY29tcGxldGUuJylcbiAgICByZXR1cm4gcGFyc2VkIGFzIE1ldGFkYXRhXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUnVudGltZVJwY0Vycm9yKSB0aHJvdyBlcnJvclxuICAgIHRocm93IG5ldyBSdW50aW1lUnBjRXJyb3IoJ3J1bnRpbWVfdW5hdmFpbGFibGUnLCAnQ291bGQgbm90IHJlYWQgT3JjYSBydW50aW1lIG1ldGFkYXRhLiBJcyBPcmNhIHJ1bm5pbmc/JylcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FsbE9yY2FSdW50aW1lPFQ+KG1ldGhvZDogc3RyaW5nLCBwYXJhbXM6IHVua25vd24sIG9wdGlvbnM6IHsgdGltZW91dE1zPzogbnVtYmVyOyB1c2VyRGF0YURpcj86IHN0cmluZyB9ID0ge30pOiBQcm9taXNlPFQ+IHtcbiAgaWYgKCFBTExPV0VELmhhcyhtZXRob2QpKSB0aHJvdyBuZXcgUnVudGltZVJwY0Vycm9yKCdub3RfcGVybWl0dGVkJywgYEFnZW50IEZsb3cgZG9lcyBub3QgY2FsbCAke21ldGhvZH0uYClcbiAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCByZWFkTWV0YWRhdGEob3B0aW9ucy51c2VyRGF0YURpciA/PyBvcmNhVXNlckRhdGFEaXIoKSlcbiAgY29uc3QgdHJhbnNwb3J0ID0gbWV0YWRhdGEudHJhbnNwb3J0cy5maW5kKCh0KSA9PiB0LmtpbmQgPT09ICd1bml4JyB8fCB0LmtpbmQgPT09ICduYW1lZC1waXBlJylcbiAgaWYgKCF0cmFuc3BvcnQpIHRocm93IG5ldyBSdW50aW1lUnBjRXJyb3IoJ3J1bnRpbWVfdW5hdmFpbGFibGUnLCAnT3JjYSBleHBvc2VzIG5vIGxvY2FsIHJ1bnRpbWUgc29ja2V0LicpXG4gIGNvbnN0IGlkID0gcmFuZG9tVVVJRCgpXG4gIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3Qgc29ja2V0ID0gY3JlYXRlQ29ubmVjdGlvbih0cmFuc3BvcnQuZW5kcG9pbnQpXG4gICAgbGV0IGJ1ZmZlciA9ICcnXG4gICAgbGV0IHNpemUgPSAwXG4gICAgbGV0IGRvbmUgPSBmYWxzZVxuICAgIGNvbnN0IGZpbmlzaCA9IChmbjogKCkgPT4gdm9pZCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVyblxuICAgICAgZG9uZSA9IHRydWVcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICAgIHNvY2tldC5kZXN0cm95KClcbiAgICAgIGZuKClcbiAgICB9XG4gICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGZpbmlzaCgoKSA9PiByZWplY3QobmV3IFJ1bnRpbWVScGNFcnJvcigndGltZW91dCcsICdPcmNhIGRpZCBub3QgYW5zd2VyIGluIHRpbWUuJykpKSwgb3B0aW9ucy50aW1lb3V0TXMgPz8gMTUwMDApXG4gICAgc29ja2V0Lm9uKCdlcnJvcicsICgpID0+IGZpbmlzaCgoKSA9PiByZWplY3QobmV3IFJ1bnRpbWVScGNFcnJvcigncnVudGltZV91bmF2YWlsYWJsZScsICdDb3VsZCBub3QgcmVhY2ggT3JjYVx1MjAxOXMgcnVudGltZS4nKSkpKVxuICAgIHNvY2tldC5vbignZGF0YScsIChjaHVuazogQnVmZmVyKSA9PiB7XG4gICAgICBzaXplICs9IGNodW5rLmxlbmd0aFxuICAgICAgaWYgKHNpemUgPiBNQVhfUkVTUE9OU0VfQllURVMpIHJldHVybiBmaW5pc2goKCkgPT4gcmVqZWN0KG5ldyBSdW50aW1lUnBjRXJyb3IoJ3Rvb19sYXJnZScsICdPcmNhXHUyMDE5cyBhbnN3ZXIgd2FzIHRvbyBsYXJnZS4nKSkpXG4gICAgICBidWZmZXIgKz0gY2h1bmsudG9TdHJpbmcoJ3V0ZjgnKVxuICAgICAgbGV0IGluZGV4OiBudW1iZXJcbiAgICAgIHdoaWxlICgoaW5kZXggPSBidWZmZXIuaW5kZXhPZignXFxuJykpID49IDApIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGJ1ZmZlci5zbGljZSgwLCBpbmRleClcbiAgICAgICAgYnVmZmVyID0gYnVmZmVyLnNsaWNlKGluZGV4ICsgMSlcbiAgICAgICAgaWYgKCFsaW5lLnRyaW0oKSkgY29udGludWVcbiAgICAgICAgbGV0IGZyYW1lOiB7IGlkPzogc3RyaW5nOyBvaz86IGJvb2xlYW47IHJlc3VsdD86IFQ7IGVycm9yPzogeyBjb2RlPzogc3RyaW5nOyBtZXNzYWdlPzogc3RyaW5nIH07IF9rZWVwYWxpdmU/OiB1bmtub3duIH1cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmcmFtZSA9IEpTT04ucGFyc2UobGluZSlcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgcmV0dXJuIGZpbmlzaCgoKSA9PiByZWplY3QobmV3IFJ1bnRpbWVScGNFcnJvcignaW52YWxpZF9yZXNwb25zZScsICdPcmNhIHNlbnQgYW4gdW5yZWFkYWJsZSBhbnN3ZXIuJykpKVxuICAgICAgICB9XG4gICAgICAgIGlmIChmcmFtZS5fa2VlcGFsaXZlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aW1lci5yZWZyZXNoKClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICAgIGlmIChmcmFtZS5pZCAhPT0gaWQpIHJldHVybiBmaW5pc2goKCkgPT4gcmVqZWN0KG5ldyBSdW50aW1lUnBjRXJyb3IoJ2ludmFsaWRfcmVzcG9uc2UnLCAnT3JjYSBhbnN3ZXJlZCBhIGRpZmZlcmVudCByZXF1ZXN0LicpKSlcbiAgICAgICAgaWYgKGZyYW1lLm9rKSByZXR1cm4gZmluaXNoKCgpID0+IHJlc29sdmUoZnJhbWUucmVzdWx0IGFzIFQpKVxuICAgICAgICByZXR1cm4gZmluaXNoKCgpID0+IHJlamVjdChuZXcgUnVudGltZVJwY0Vycm9yKGZyYW1lLmVycm9yPy5jb2RlID8/ICdhY3Rpb25fZmFpbGVkJywgZnJhbWUuZXJyb3I/Lm1lc3NhZ2UgPz8gJ09yY2EgcmVmdXNlZCB0aGUgcmVxdWVzdC4nKSkpXG4gICAgICB9XG4gICAgfSlcbiAgICBzb2NrZXQud3JpdGUoSlNPTi5zdHJpbmdpZnkoeyBpZCwgYXV0aFRva2VuOiBtZXRhZGF0YS5hdXRoVG9rZW4sIG1ldGhvZCwgcGFyYW1zIH0pICsgJ1xcbicpXG4gIH0pXG59XG4iLCAiLy8gUmVhZHMgYSBDbGF1ZGUgQ29kZSB0cmFuc2NyaXB0ICguanNvbmwpIGludG8gdGhlIGluc3BlY3RvcidzIGNvbnZlcnNhdGlvbiBzaGFwZS4gT25seSB0aGUgdGFpbFxuLy8gb2YgbGFyZ2UgZmlsZXMgaXMgcmVhZDsgZXZlcnkgdGV4dCBpcyByZWRhY3RlZCBiZWZvcmUgaXQgbGVhdmVzIHRoZSB3b3JrZXIuXG5pbXBvcnQgeyBvcGVuLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IHJlZGFjdEFuZFRydW5jYXRlIH0gZnJvbSAnLi4vLi4vc2hhcmVkL3JlZGFjdC50cydcbmltcG9ydCB0eXBlIHsgQWdlbnRPdXRwdXQsIENvbnZlcnNhdGlvbkJsb2NrLCBDb252ZXJzYXRpb25NZXNzYWdlLCBJbWFnZVJlZiB9IGZyb20gJy4vdHJhbnNjcmlwdC50cydcblxuLyoqIEdyb3dpbmcgcmVhZCB3aW5kb3dzIGZyb20gdGhlIGVuZCBvZiB0aGUgdHJhbnNjcmlwdC4gKi9cbmNvbnN0IFJFQURfV0lORE9XUyA9IFszICogMTAyNCAqIDEwMjQsIDEyICogMTAyNCAqIDEwMjQsIDQ4ICogMTAyNCAqIDEwMjRdXG5jb25zdCBJTUFHRV9TQ0FOX0JZVEVTID0gMjQgKiAxMDI0ICogMTAyNFxuY29uc3QgS0VFUF9NRVNTQUdFUyA9IDE2MFxuY29uc3QgVEVYVF9MSU1JVCA9IDQwMDBcbmNvbnN0IFRPT0xfTElNSVQgPSAxNTAwXG5cbi8qKiBXaGF0IHdhcyBsYXN0IHJlYWQgZnJvbSBhIHRyYW5zY3JpcHQncyB0YWlsLCBzbyB0aGUgbmV4dCBwb2xsIHJlYWRzIG9ubHkgd2hhdCB3YXMgYXBwZW5kZWQuICovXG50eXBlIFRhaWwgPSB7IHNpemU6IG51bWJlcjsgbXRpbWVNczogbnVtYmVyOyBlbmQ6IG51bWJlcjsgbWVzc2FnZXM6IENvbnZlcnNhdGlvbk1lc3NhZ2VbXTsgdHJ1bmNhdGVkOiBib29sZWFuOyBvdXRwdXQ6IEFnZW50T3V0cHV0IH1cbmNvbnN0IHRhaWxzID0gbmV3IE1hcDxzdHJpbmcsIFRhaWw+KClcbmNvbnN0IE1BWF9UQUlMUyA9IDI0XG5cbmZ1bmN0aW9uIHJlbWVtYmVyKHBhdGg6IHN0cmluZywgdGFpbDogVGFpbCk6IEFnZW50T3V0cHV0IHtcbiAgdGFpbHMuZGVsZXRlKHBhdGgpXG4gIHRhaWxzLnNldChwYXRoLCB0YWlsKVxuICBpZiAodGFpbHMuc2l6ZSA+IE1BWF9UQUlMUykgdGFpbHMuZGVsZXRlKHRhaWxzLmtleXMoKS5uZXh0KCkudmFsdWUgYXMgc3RyaW5nKVxuICByZXR1cm4gdGFpbC5vdXRwdXRcbn1cblxuZnVuY3Rpb24gY29udmVyc2F0aW9uKG1lc3NhZ2VzOiBDb252ZXJzYXRpb25NZXNzYWdlW10sIHRydW5jYXRlZDogYm9vbGVhbik6IEFnZW50T3V0cHV0IHtcbiAgcmV0dXJuIHsga2luZDogJ2NvbnZlcnNhdGlvbicsIHNvdXJjZTogJ2NsYXVkZSB0cmFuc2NyaXB0JywgcHJvdmlkZXI6ICdjbGF1ZGUnLCBtZXNzYWdlcywgdHJ1bmNhdGVkIH1cbn1cblxuLyoqIEZvcmdldHMgY2FjaGVkIHRhaWxzICh0ZXN0cykuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJUcmFuc2NyaXB0Q2FjaGUoKTogdm9pZCB7XG4gIHRhaWxzLmNsZWFyKClcbiAgaW1hZ2VzLmNsZWFyKClcbiAgaW1hZ2VCeXRlcyA9IDBcbn1cblxuLyoqXG4gKiBUaGUgbmV3ZXN0IG1lc3NhZ2VzLCBvciB3aXRoIGBiZWZvcmVJZGAgdGhlIGJhdGNoIGp1c3QgYmVmb3JlIHRoYXQgbWVzc2FnZS4gUmVhZHMgYSBncm93aW5nXG4gKiB3aW5kb3cgZnJvbSB0aGUgZW5kIG9mIHRoZSBmaWxlIG9ubHkgYXMgZmFyIGJhY2sgYXMgbmVlZGVkICh0aGUgZmlsZSBjYW4gYmUgaHVnZSkuIFBvbGxpbmcgdGhlXG4gKiBuZXdlc3QgbWVzc2FnZXMgYWdhaW4gcmVhZHMgb25seSB0aGUgYnl0ZXMgYXBwZW5kZWQgc2luY2UgdGhlIGxhc3QgY2FsbCwgYW5kIG5vdGhpbmcgYXQgYWxsXG4gKiAodGhlIHNhbWUgYW5zd2VyIG9iamVjdCkgd2hlbiB0aGUgZmlsZSBkaWQgbm90IGNoYW5nZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRDbGF1ZGVUcmFuc2NyaXB0KHBhdGg6IHN0cmluZywgb3B0aW9uczogeyBiZWZvcmVJZD86IHN0cmluZyB9ID0ge30pOiBQcm9taXNlPEFnZW50T3V0cHV0IHwgbnVsbD4ge1xuICBsZXQgaW5mbzogeyBzaXplOiBudW1iZXI7IG10aW1lTXM6IG51bWJlciB9XG4gIHRyeSB7XG4gICAgaW5mbyA9IGF3YWl0IHN0YXQocGF0aClcbiAgfSBjYXRjaCB7XG4gICAgdGFpbHMuZGVsZXRlKHBhdGgpXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBjb25zdCB7IHNpemUsIG10aW1lTXMgfSA9IGluZm9cbiAgaWYgKCFvcHRpb25zLmJlZm9yZUlkKSB7XG4gICAgY29uc3QgdGFpbCA9IHRhaWxzLmdldChwYXRoKVxuICAgIGlmICh0YWlsICYmIHRhaWwuc2l6ZSA9PT0gc2l6ZSAmJiB0YWlsLm10aW1lTXMgPT09IG10aW1lTXMpIHJldHVybiB0YWlsLm91dHB1dFxuICAgIGlmICh0YWlsICYmIHNpemUgPiB0YWlsLnNpemUgJiYgc2l6ZSA+PSB0YWlsLmVuZCkge1xuICAgICAgY29uc3QgcmVhZCA9IGF3YWl0IHJlYWRNZXNzYWdlcyhwYXRoLCB0YWlsLmVuZCwgc2l6ZSwgZmFsc2UpXG4gICAgICBpZiAoIXJlYWQubWVzc2FnZXMubGVuZ3RoKSByZXR1cm4gcmVtZW1iZXIocGF0aCwgeyAuLi50YWlsLCBzaXplLCBtdGltZU1zLCBlbmQ6IHJlYWQuZW5kIH0pXG4gICAgICBjb25zdCBhbGwgPSBbLi4udGFpbC5tZXNzYWdlcywgLi4ucmVhZC5tZXNzYWdlc11cbiAgICAgIGNvbnN0IG1lc3NhZ2VzID0gYWxsLnNsaWNlKC1LRUVQX01FU1NBR0VTKVxuICAgICAgY29uc3QgdHJ1bmNhdGVkID0gdGFpbC50cnVuY2F0ZWQgfHwgYWxsLmxlbmd0aCA+IG1lc3NhZ2VzLmxlbmd0aFxuICAgICAgcmV0dXJuIHJlbWVtYmVyKHBhdGgsIHsgc2l6ZSwgbXRpbWVNcywgZW5kOiByZWFkLmVuZCwgbWVzc2FnZXMsIHRydW5jYXRlZCwgb3V0cHV0OiBjb252ZXJzYXRpb24obWVzc2FnZXMsIHRydW5jYXRlZCkgfSlcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCB3aW5kb3cgb2YgUkVBRF9XSU5ET1dTKSB7XG4gICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1heCgwLCBzaXplIC0gd2luZG93KVxuICAgIGNvbnN0IHJlYWQgPSBhd2FpdCByZWFkTWVzc2FnZXMocGF0aCwgc3RhcnQsIHNpemUsIHN0YXJ0ID4gMClcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlYWQubWVzc2FnZXNcbiAgICBsZXQgZW5kID0gbWVzc2FnZXMubGVuZ3RoXG4gICAgaWYgKG9wdGlvbnMuYmVmb3JlSWQpIHtcbiAgICAgIGVuZCA9IG1lc3NhZ2VzLmZpbmRJbmRleCgobSkgPT4gbS5pZCA9PT0gb3B0aW9ucy5iZWZvcmVJZClcbiAgICAgIC8vIE5vdCBpbiB0aGlzIHdpbmRvdyB5ZXQgKG9yIHRoZSBjdXQgbGluZSBoaWQgaXQpOiByZWFkIGZ1cnRoZXIgYmFjay5cbiAgICAgIGlmIChlbmQgPCAwKSB7XG4gICAgICAgIGlmIChzdGFydCA9PT0gMCkgcmV0dXJuIGNvbnZlcnNhdGlvbihbXSwgZmFsc2UpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGZyb20gPSBNYXRoLm1heCgwLCBlbmQgLSBLRUVQX01FU1NBR0VTKVxuICAgIC8vIE5vdCBlbm91Z2ggb2xkZXIgbWVzc2FnZXMgaW4gdGhpcyB3aW5kb3cgYW5kIHRoZSBmaWxlIGdvZXMgZnVydGhlciBiYWNrOiB3aWRlbiBpdC5cbiAgICBpZiAoZnJvbSA9PT0gMCAmJiBzdGFydCA+IDAgJiYgZW5kIDwgS0VFUF9NRVNTQUdFUyAmJiB3aW5kb3cgIT09IFJFQURfV0lORE9XU1tSRUFEX1dJTkRPV1MubGVuZ3RoIC0gMV0pIGNvbnRpbnVlXG4gICAgY29uc3Qga2VwdCA9IG1lc3NhZ2VzLnNsaWNlKGZyb20sIGVuZClcbiAgICBjb25zdCB0cnVuY2F0ZWQgPSBmcm9tID4gMCB8fCBzdGFydCA+IDBcbiAgICBpZiAob3B0aW9ucy5iZWZvcmVJZCkgcmV0dXJuIGNvbnZlcnNhdGlvbihrZXB0LCB0cnVuY2F0ZWQpXG4gICAgcmV0dXJuIHJlbWVtYmVyKHBhdGgsIHsgc2l6ZSwgbXRpbWVNcywgZW5kOiByZWFkLmVuZCwgbWVzc2FnZXM6IGtlcHQsIHRydW5jYXRlZCwgb3V0cHV0OiBjb252ZXJzYXRpb24oa2VwdCwgdHJ1bmNhdGVkKSB9KVxuICB9XG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogTWVzc2FnZXMgaW4gW3N0YXJ0LCBzaXplKS4gYGVuZGAgaXMgd2hlcmUgdGhlIG5leHQgaW5jcmVtZW50YWwgcmVhZCBtdXN0IHN0YXJ0OiBqdXN0IGFmdGVyIHRoZVxuICogbGFzdCBjb21wbGV0ZSBsaW5lIChhIHRyYWlsaW5nIGxpbmUgdGhhdCBpcyBub3QgdmFsaWQgSlNPTiB5ZXQgaXMgcmVhZCBhZ2FpbiBuZXh0IHRpbWUpLlxuICovXG5hc3luYyBmdW5jdGlvbiByZWFkTWVzc2FnZXMocGF0aDogc3RyaW5nLCBzdGFydDogbnVtYmVyLCBzaXplOiBudW1iZXIsIGZpcnN0TGluZUN1dDogYm9vbGVhbik6IFByb21pc2U8eyBtZXNzYWdlczogQ29udmVyc2F0aW9uTWVzc2FnZVtdOyBlbmQ6IG51bWJlciB9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGF3YWl0IG9wZW4ocGF0aCwgJ3InKVxuICBjb25zdCBidWZmZXIgPSBCdWZmZXIuYWxsb2Moc2l6ZSAtIHN0YXJ0KVxuICB0cnkge1xuICAgIGF3YWl0IGhhbmRsZS5yZWFkKGJ1ZmZlciwgMCwgYnVmZmVyLmxlbmd0aCwgc3RhcnQpXG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgaGFuZGxlLmNsb3NlKClcbiAgfVxuICBjb25zdCBsYXN0TmV3bGluZSA9IGJ1ZmZlci5sYXN0SW5kZXhPZigweDBhKVxuICBjb25zdCBsaW5lcyA9IGJ1ZmZlci50b1N0cmluZygndXRmOCcsIDAsIGxhc3ROZXdsaW5lICsgMSkuc3BsaXQoJ1xcbicpXG4gIGlmIChmaXJzdExpbmVDdXQpIGxpbmVzLnNoaWZ0KCkgLy8gdGhlIGZpcnN0IGxpbmUgbWF5IGJlIGN1dFxuICBjb25zdCBtZXNzYWdlczogQ29udmVyc2F0aW9uTWVzc2FnZVtdID0gW11cbiAgY29uc3QgdGFrZSA9IChsaW5lOiBzdHJpbmcpOiBib29sZWFuID0+IHtcbiAgICBpZiAoIWxpbmUudHJpbSgpKSByZXR1cm4gdHJ1ZVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gdG9NZXNzYWdlKEpTT04ucGFyc2UobGluZSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICBpZiAobWVzc2FnZSkgbWVzc2FnZXMucHVzaChtZXNzYWdlKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZSAvLyBwYXJ0aWFsIGxpbmVcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB0YWtlKGxpbmUpXG4gIGxldCBlbmQgPSBzdGFydCArIGxhc3ROZXdsaW5lICsgMVxuICAvLyBBIGNvbXBsZXRlIGxhc3QgZW50cnkgd2l0aG91dCBpdHMgbmV3bGluZSB5ZXQgc3RpbGwgY291bnRzLlxuICBjb25zdCByZXN0ID0gYnVmZmVyLnRvU3RyaW5nKCd1dGY4JywgbGFzdE5ld2xpbmUgKyAxKVxuICBpZiAocmVzdC50cmltKCkgJiYgIShmaXJzdExpbmVDdXQgJiYgbGFzdE5ld2xpbmUgPCAwKSAmJiB0YWtlKHJlc3QpKSBlbmQgPSBzaXplXG4gIHJldHVybiB7IG1lc3NhZ2VzLCBlbmQgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9NZXNzYWdlKGVudHJ5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IENvbnZlcnNhdGlvbk1lc3NhZ2UgfCBudWxsIHtcbiAgaWYgKGVudHJ5LnR5cGUgIT09ICd1c2VyJyAmJiBlbnRyeS50eXBlICE9PSAnYXNzaXN0YW50JykgcmV0dXJuIG51bGxcbiAgY29uc3QgbWVzc2FnZSA9IGVudHJ5Lm1lc3NhZ2UgYXMgeyByb2xlPzogc3RyaW5nOyBjb250ZW50PzogdW5rbm93biB9IHwgdW5kZWZpbmVkXG4gIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGxcbiAgY29uc3QgYmxvY2tzOiBDb252ZXJzYXRpb25CbG9ja1tdID0gW11cbiAgY29uc3QgY29udGVudCA9IG1lc3NhZ2UuY29udGVudFxuICBpZiAodHlwZW9mIGNvbnRlbnQgPT09ICdzdHJpbmcnKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0ZXh0JywgdGV4dDogcmVkYWN0QW5kVHJ1bmNhdGUoY29udGVudCwgVEVYVF9MSU1JVCkgfSlcbiAgZWxzZSBpZiAoQXJyYXkuaXNBcnJheShjb250ZW50KSkge1xuICAgIDsoY29udGVudCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdKS5mb3JFYWNoKChyYXcsIGluZGV4KSA9PiB7XG4gICAgICBzd2l0Y2ggKHJhdz8udHlwZSkge1xuICAgICAgICBjYXNlICdpbWFnZSc6IHtcbiAgICAgICAgICBjb25zdCBpbWFnZSA9IGltYWdlUmVmKHJhdywgYCR7ZW50cnkudXVpZH18JHtpbmRleH1gKVxuICAgICAgICAgIGlmIChpbWFnZSkgYmxvY2tzLnB1c2goeyB0eXBlOiAnaW1hZ2UnLCBpbWFnZSB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAndGV4dCc6XG4gICAgICAgICAgaWYgKHR5cGVvZiByYXcudGV4dCA9PT0gJ3N0cmluZycgJiYgcmF3LnRleHQudHJpbSgpKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0ZXh0JywgdGV4dDogcmVkYWN0QW5kVHJ1bmNhdGUocmF3LnRleHQsIFRFWFRfTElNSVQpIH0pXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAndGhpbmtpbmcnOlxuICAgICAgICAgIGlmICh0eXBlb2YgcmF3LnRoaW5raW5nID09PSAnc3RyaW5nJyAmJiByYXcudGhpbmtpbmcudHJpbSgpKSBibG9ja3MucHVzaCh7IHR5cGU6ICd0aGlua2luZycsIHRleHQ6IHJlZGFjdEFuZFRydW5jYXRlKHJhdy50aGlua2luZywgVEVYVF9MSU1JVCkgfSlcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICd0b29sX3VzZSc6XG4gICAgICAgICAgYmxvY2tzLnB1c2goeyB0eXBlOiAndG9vbC1jYWxsJywgbmFtZTogU3RyaW5nKHJhdy5uYW1lID8/ICd0b29sJyksIGlucHV0OiByZWRhY3RBbmRUcnVuY2F0ZShKU09OLnN0cmluZ2lmeShyYXcuaW5wdXQgPz8ge30pLCBUT09MX0xJTUlUKSB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3Rvb2xfcmVzdWx0Jzoge1xuICAgICAgICAgIGNvbnN0IHBhcnRzID0gQXJyYXkuaXNBcnJheShyYXcuY29udGVudCkgPyAocmF3LmNvbnRlbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSkgOiBudWxsXG4gICAgICAgICAgY29uc3Qgb3V0ID0gdHlwZW9mIHJhdy5jb250ZW50ID09PSAnc3RyaW5nJyA/IHJhdy5jb250ZW50IDogcGFydHMgPyBwYXJ0cy5tYXAoKGMpID0+ICh0eXBlb2YgYz8udGV4dCA9PT0gJ3N0cmluZycgPyBjLnRleHQgOiAnJykpLmZpbHRlcihCb29sZWFuKS5qb2luKCdcXG4nKSA6IEpTT04uc3RyaW5naWZ5KHJhdy5jb250ZW50ID8/ICcnKVxuICAgICAgICAgIC8vIFNjcmVlbnNob3RzIGFuZCBvdGhlciBpbWFnZXMgYSB0b29sIHJldHVybmVkLlxuICAgICAgICAgIGNvbnN0IGltYWdlcyA9IHBhcnRzID8gcGFydHMubWFwKChjLCBqKSA9PiAoYz8udHlwZSA9PT0gJ2ltYWdlJyA/IGltYWdlUmVmKGMsIGAke2VudHJ5LnV1aWR9fCR7aW5kZXh9fCR7an1gKSA6IG51bGwpKS5maWx0ZXIoKHgpOiB4IGlzIEltYWdlUmVmID0+IEJvb2xlYW4oeCkpIDogW11cbiAgICAgICAgICBibG9ja3MucHVzaCh7IHR5cGU6ICd0b29sLXJlc3VsdCcsIG91dHB1dDogcmVkYWN0QW5kVHJ1bmNhdGUob3V0LCBUT09MX0xJTUlUKSwgaXNFcnJvcjogcmF3LmlzX2Vycm9yID09PSB0cnVlLCAuLi4oaW1hZ2VzLmxlbmd0aCA/IHsgaW1hZ2VzIH0gOiB7fSkgfSlcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHJldHVybiBudWxsXG4gIGNvbnN0IHRzID0gdHlwZW9mIGVudHJ5LnRpbWVzdGFtcCA9PT0gJ3N0cmluZycgPyBEYXRlLnBhcnNlKGVudHJ5LnRpbWVzdGFtcCkgOiBOYU5cbiAgY29uc3QgcmF3TW9kZWwgPSAobWVzc2FnZSBhcyB7IG1vZGVsPzogdW5rbm93biB9KS5tb2RlbFxuICBjb25zdCBtb2RlbCA9IGVudHJ5LnR5cGUgPT09ICdhc3Npc3RhbnQnICYmIHR5cGVvZiByYXdNb2RlbCA9PT0gJ3N0cmluZycgJiYgcmF3TW9kZWwgIT09ICc8c3ludGhldGljPicgPyByYXdNb2RlbCA6IG51bGxcbiAgY29uc3QgZWZmb3J0ID0gdHlwZW9mIGVudHJ5LnBlclR1cm5FZmZvcnQgPT09ICdzdHJpbmcnID8gZW50cnkucGVyVHVybkVmZm9ydCA6IHR5cGVvZiBlbnRyeS5lZmZvcnQgPT09ICdzdHJpbmcnID8gZW50cnkuZWZmb3J0IDogbnVsbFxuICByZXR1cm4geyBpZDogU3RyaW5nKGVudHJ5LnV1aWQgPz8gTWF0aC5yYW5kb20oKSksIHJvbGU6IG1lc3NhZ2Uucm9sZSA/PyBTdHJpbmcoZW50cnkudHlwZSksIHRzOiBOdW1iZXIuaXNGaW5pdGUodHMpID8gdHMgOiBudWxsLCBibG9ja3MsIC4uLihtb2RlbCA/IHsgbW9kZWwsIGVmZm9ydCB9IDoge30pIH1cbn1cblxuY29uc3QgSU1BR0VfVFlQRVMgPSBuZXcgU2V0KFsnaW1hZ2UvcG5nJywgJ2ltYWdlL2pwZWcnLCAnaW1hZ2UvZ2lmJywgJ2ltYWdlL3dlYnAnXSlcblxuZnVuY3Rpb24gaW1hZ2VSZWYocmF3OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgcmVmOiBzdHJpbmcpOiBJbWFnZVJlZiB8IG51bGwge1xuICBjb25zdCBzb3VyY2UgPSByYXcuc291cmNlIGFzIHsgdHlwZT86IHN0cmluZzsgbWVkaWFfdHlwZT86IHN0cmluZzsgZGF0YT86IHN0cmluZyB9IHwgdW5kZWZpbmVkXG4gIGlmIChzb3VyY2U/LnR5cGUgIT09ICdiYXNlNjQnIHx8IHR5cGVvZiBzb3VyY2UuZGF0YSAhPT0gJ3N0cmluZycgfHwgIUlNQUdFX1RZUEVTLmhhcyhzb3VyY2UubWVkaWFfdHlwZSA/PyAnJykpIHJldHVybiBudWxsXG4gIHJldHVybiB7IHJlZiwgbWVkaWFUeXBlOiBzb3VyY2UubWVkaWFfdHlwZSEsIGJ5dGVzOiBNYXRoLmZsb29yKChzb3VyY2UuZGF0YS5sZW5ndGggKiAzKSAvIDQpIH1cbn1cblxuLyoqIFJlY2VudGx5IG9wZW5lZCBpbWFnZXMsIHNvIHRoZSBjaHVua2VkIHRyYW5zZmVyIG9mIG9uZSBpbWFnZSBzY2FucyB0aGUgZmlsZSBvbmx5IG9uY2UuICovXG5jb25zdCBpbWFnZXMgPSBuZXcgTWFwPHN0cmluZywgeyBtZWRpYVR5cGU6IHN0cmluZzsgZGF0YTogc3RyaW5nIH0+KClcbmxldCBpbWFnZUJ5dGVzID0gMFxuY29uc3QgSU1BR0VfQ0FDSEVfQllURVMgPSAyNCAqIDEwMjQgKiAxMDI0XG5cbmZ1bmN0aW9uIGNhY2hlSW1hZ2Uoa2V5OiBzdHJpbmcsIGltYWdlOiB7IG1lZGlhVHlwZTogc3RyaW5nOyBkYXRhOiBzdHJpbmcgfSk6IHZvaWQge1xuICBpbWFnZXMuc2V0KGtleSwgaW1hZ2UpXG4gIGltYWdlQnl0ZXMgKz0gaW1hZ2UuZGF0YS5sZW5ndGhcbiAgd2hpbGUgKGltYWdlQnl0ZXMgPiBJTUFHRV9DQUNIRV9CWVRFUyAmJiBpbWFnZXMuc2l6ZSA+IDEpIHtcbiAgICBjb25zdCBbb2xkZXN0LCB2YWx1ZV0gPSBpbWFnZXMuZW50cmllcygpLm5leHQoKS52YWx1ZSBhcyBbc3RyaW5nLCB7IGRhdGE6IHN0cmluZyB9XVxuICAgIGltYWdlcy5kZWxldGUob2xkZXN0KVxuICAgIGltYWdlQnl0ZXMgLT0gdmFsdWUuZGF0YS5sZW5ndGhcbiAgfVxufVxuXG4vKiogVGhlIGJhc2U2NCBkYXRhIG9mIG9uZSBpbWFnZSwgZm91bmQgYnkgaXRzIHJlZiAoYDxlbnRyeSB1dWlkPnw8YmxvY2s+W3w8dG9vbC1yZXN1bHQgcGFydD5dYCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZENsYXVkZUltYWdlKHBhdGg6IHN0cmluZywgcmVmOiBzdHJpbmcpOiBQcm9taXNlPHsgbWVkaWFUeXBlOiBzdHJpbmc7IGRhdGE6IHN0cmluZyB9IHwgbnVsbD4ge1xuICBjb25zdCBbdXVpZCwgYmxvY2tUZXh0LCBwYXJ0VGV4dF0gPSByZWYuc3BsaXQoJ3wnKVxuICBpZiAoIXV1aWQgfHwgYmxvY2tUZXh0ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IGtleSA9IGAke3BhdGh9XFwwJHtyZWZ9YFxuICBjb25zdCBjYWNoZWQgPSBpbWFnZXMuZ2V0KGtleSlcbiAgaWYgKGNhY2hlZCkgcmV0dXJuIGNhY2hlZFxuICBjb25zdCBoYW5kbGUgPSBhd2FpdCBvcGVuKHBhdGgsICdyJylcbiAgbGV0IGJ1ZmZlcjogQnVmZmVyXG4gIHRyeSB7XG4gICAgY29uc3Qgc2l6ZSA9IChhd2FpdCBoYW5kbGUuc3RhdCgpKS5zaXplXG4gICAgLy8gSW1hZ2VzIGNhbiBzaXQgZnVydGhlciBiYWNrIHRoYW4gdGhlIGNvbnZlcnNhdGlvbiB0YWlsOyByZWFkIG1vcmUsIHN0aWxsIGJvdW5kZWQuXG4gICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1heCgwLCBzaXplIC0gSU1BR0VfU0NBTl9CWVRFUylcbiAgICBidWZmZXIgPSBCdWZmZXIuYWxsb2Moc2l6ZSAtIHN0YXJ0KVxuICAgIGF3YWl0IGhhbmRsZS5yZWFkKGJ1ZmZlciwgMCwgYnVmZmVyLmxlbmd0aCwgc3RhcnQpXG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgaGFuZGxlLmNsb3NlKClcbiAgfVxuICAvLyBTZWFyY2ggdGhlIHJhdyBieXRlcyBhbmQgZGVjb2RlIG9ubHkgdGhlIGxpbmVzIHRoYXQgbWVudGlvbiB0aGlzIGVudHJ5LlxuICBjb25zdCBuZWVkbGUgPSBCdWZmZXIuZnJvbSh1dWlkKVxuICBmb3IgKGxldCBhdCA9IGJ1ZmZlci5pbmRleE9mKG5lZWRsZSk7IGF0ID49IDA7IGF0ID0gYnVmZmVyLmluZGV4T2YobmVlZGxlLCBhdCArIG5lZWRsZS5sZW5ndGgpKSB7XG4gICAgY29uc3QgbGluZVN0YXJ0ID0gYnVmZmVyLmxhc3RJbmRleE9mKDB4MGEsIGF0KSArIDFcbiAgICBjb25zdCBuZXdsaW5lID0gYnVmZmVyLmluZGV4T2YoMHgwYSwgYXQpXG4gICAgY29uc3QgbGluZUVuZCA9IG5ld2xpbmUgPCAwID8gYnVmZmVyLmxlbmd0aCA6IG5ld2xpbmVcbiAgICB0cnkge1xuICAgICAgY29uc3QgZW50cnkgPSBKU09OLnBhcnNlKGJ1ZmZlci50b1N0cmluZygndXRmOCcsIGxpbmVTdGFydCwgbGluZUVuZCkpIGFzIHsgdXVpZD86IHN0cmluZzsgbWVzc2FnZT86IHsgY29udGVudD86IHVua25vd24gfSB9XG4gICAgICBpZiAoZW50cnkudXVpZCAhPT0gdXVpZCB8fCAhQXJyYXkuaXNBcnJheShlbnRyeS5tZXNzYWdlPy5jb250ZW50KSkgY29udGludWVcbiAgICAgIGxldCBibG9jayA9IChlbnRyeS5tZXNzYWdlIS5jb250ZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+W10pW051bWJlcihibG9ja1RleHQpXVxuICAgICAgaWYgKHBhcnRUZXh0ICE9PSB1bmRlZmluZWQpIGJsb2NrID0gKEFycmF5LmlzQXJyYXkoYmxvY2s/LmNvbnRlbnQpID8gKGJsb2NrLmNvbnRlbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSkgOiBbXSlbTnVtYmVyKHBhcnRUZXh0KV1cbiAgICAgIGNvbnN0IHNvdXJjZSA9IGJsb2NrPy5zb3VyY2UgYXMgeyB0eXBlPzogc3RyaW5nOyBtZWRpYV90eXBlPzogc3RyaW5nOyBkYXRhPzogc3RyaW5nIH0gfCB1bmRlZmluZWRcbiAgICAgIGlmIChzb3VyY2U/LnR5cGUgPT09ICdiYXNlNjQnICYmIHR5cGVvZiBzb3VyY2UuZGF0YSA9PT0gJ3N0cmluZycgJiYgSU1BR0VfVFlQRVMuaGFzKHNvdXJjZS5tZWRpYV90eXBlID8/ICcnKSkge1xuICAgICAgICBjb25zdCBpbWFnZSA9IHsgbWVkaWFUeXBlOiBzb3VyY2UubWVkaWFfdHlwZSEsIGRhdGE6IHNvdXJjZS5kYXRhIH1cbiAgICAgICAgY2FjaGVJbWFnZShrZXksIGltYWdlKVxuICAgICAgICByZXR1cm4gaW1hZ2VcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIHBhcnRpYWwgbGluZVxuICAgIH1cbiAgICBhdCA9IE1hdGgubWF4KGF0LCBsaW5lRW5kIC0gbmVlZGxlLmxlbmd0aClcbiAgfVxuICByZXR1cm4gbnVsbFxufVxuIiwgIi8vIERhc2hib2FyZCBhY2Nlc3MgdG9rZW46IHJhbmRvbSwgc3RvcmVkIGluIE9yY2EncyBlbmNyeXB0ZWQgcGx1Z2luIHNlY3JldHMgd2hlbiB0aGUgT1Mga2V5cmluZ1xuLy8gaXMgYXZhaWxhYmxlLCBvdGhlcndpc2UgaW4gYSAwNjAwIGZpbGUgaW4gdGhlIHBsdWdpbidzIG93biBzdGF0ZSBmb2xkZXIuXG5pbXBvcnQgeyByYW5kb21CeXRlcywgdGltaW5nU2FmZUVxdWFsIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyBjaG1vZCwgbWtkaXIsIHJlYWRGaWxlLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuXG50eXBlIFNlY3JldHNBcGkgPSBPcmNhV29ya2VyQXBpWydzZWNyZXRzJ11cblxuY29uc3QgU0VDUkVUX0tFWSA9ICdkYXNoYm9hcmRUb2tlbidcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRPckNyZWF0ZVRva2VuKHNlY3JldHM6IFNlY3JldHNBcGkgfCB1bmRlZmluZWQsIHByb3RlY3Rpb246IHN0cmluZywgZGlyOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBleGlzdGluZyA9IHVzZUtleXJpbmcoc2VjcmV0cywgcHJvdGVjdGlvbikgPyBhd2FpdCBzZWNyZXRzIS5nZXQoU0VDUkVUX0tFWSkuY2F0Y2goKCkgPT4gbnVsbCkgOiBhd2FpdCByZWFkVG9rZW5GaWxlKGRpcilcbiAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nLmxlbmd0aCA+PSAzMikgcmV0dXJuIGV4aXN0aW5nXG4gIHJldHVybiBzdG9yZVRva2VuKHNlY3JldHMsIHByb3RlY3Rpb24sIGRpciwgbmV3VG9rZW4oKSlcbn1cblxuLyoqIEFsd2F5cyByZXBsYWNlcyB0aGUgc3RvcmVkIHRva2VuIHdpdGggYSBmcmVzaCBvbmUgKGUuZy4gd2hlbiBkYXNoYm9hcmQgY29udHJvbHMgYXJlIHR1cm5lZCBvbikuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcm90YXRlVG9rZW4oc2VjcmV0czogU2VjcmV0c0FwaSB8IHVuZGVmaW5lZCwgcHJvdGVjdGlvbjogc3RyaW5nLCBkaXI6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBzdG9yZVRva2VuKHNlY3JldHMsIHByb3RlY3Rpb24sIGRpciwgbmV3VG9rZW4oKSlcbn1cblxuZnVuY3Rpb24gdXNlS2V5cmluZyhzZWNyZXRzOiBTZWNyZXRzQXBpIHwgdW5kZWZpbmVkLCBwcm90ZWN0aW9uOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIEJvb2xlYW4oc2VjcmV0cykgJiYgcHJvdGVjdGlvbiA9PT0gJ29zLWtleXJpbmcnXG59XG5cbmZ1bmN0aW9uIHRva2VuRmlsZShkaXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBqb2luKGRpciwgJ2Rhc2hib2FyZC10b2tlbicpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRUb2tlbkZpbGUoZGlyOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKGF3YWl0IHJlYWRGaWxlKHRva2VuRmlsZShkaXIpLCAndXRmOCcpKS50cmltKClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBzdG9yZVRva2VuKHNlY3JldHM6IFNlY3JldHNBcGkgfCB1bmRlZmluZWQsIHByb3RlY3Rpb246IHN0cmluZywgZGlyOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAodXNlS2V5cmluZyhzZWNyZXRzLCBwcm90ZWN0aW9uKSkge1xuICAgIGF3YWl0IHNlY3JldHMhLnNldChTRUNSRVRfS0VZLCB0b2tlbilcbiAgICByZXR1cm4gdG9rZW5cbiAgfVxuICBhd2FpdCBta2RpcihkaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzcwMCB9KVxuICBhd2FpdCB3cml0ZUZpbGUodG9rZW5GaWxlKGRpciksIHRva2VuLCB7IG1vZGU6IDBvNjAwIH0pXG4gIC8vIHdyaXRlRmlsZSdzIG1vZGUgb25seSBhcHBsaWVzIG9uIGNyZWF0ZTsgbWFrZSBzdXJlIGFuIGV4aXN0aW5nIGZpbGUgaXMgMDYwMCB0b28uXG4gIGF3YWl0IGNobW9kKHRva2VuRmlsZShkaXIpLCAwbzYwMClcbiAgcmV0dXJuIHRva2VuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBuZXdUb2tlbigpOiBzdHJpbmcge1xuICByZXR1cm4gcmFuZG9tQnl0ZXMoMzIpLnRvU3RyaW5nKCdoZXgnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5zTWF0Y2goZXhwZWN0ZWQ6IHN0cmluZywgZ2l2ZW46IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBib29sZWFuIHtcbiAgaWYgKCFnaXZlbikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IGEgPSBCdWZmZXIuZnJvbShleHBlY3RlZClcbiAgY29uc3QgYiA9IEJ1ZmZlci5mcm9tKGdpdmVuKVxuICByZXR1cm4gYS5sZW5ndGggPT09IGIubGVuZ3RoICYmIHRpbWluZ1NhZmVFcXVhbChhLCBiKVxufVxuXG4vKiogRE5TLXJlYmluZGluZyBndWFyZDogb25seSBsb29wYmFjayBob3N0IG5hbWVzIHdpdGggb3VyIHBvcnQuICovXG5leHBvcnQgZnVuY3Rpb24gaG9zdEFsbG93ZWQoaG9zdEhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkLCBwb3J0OiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKCFob3N0SGVhZGVyKSByZXR1cm4gZmFsc2VcbiAgcmV0dXJuIGhvc3RIZWFkZXIgPT09IGAxMjcuMC4wLjE6JHtwb3J0fWAgfHwgaG9zdEhlYWRlciA9PT0gYGxvY2FsaG9zdDoke3BvcnR9YCB8fCBob3N0SGVhZGVyID09PSBgWzo6MV06JHtwb3J0fWBcbn1cbiIsICIvLyBTdGFuZGFsb25lIGRhc2hib2FyZDogdGhlIHNhbWUgVUkgYnVuZGxlIGFuZCB0aGUgc2FtZSBhdXRob3JpdGF0aXZlIHN0YXRlLCBzZXJ2ZWQgb24gbG9vcGJhY2suXG4vLyBFdmVyeSAvYXBpIGNhbGwgbmVlZHMgdGhlIHRva2VuIChoZWFkZXIpLCB0aGUgSG9zdCBtdXN0IGJlIGxvb3BiYWNrLCBhbmQgUE9TVHMgbXVzdCBjb21lIGZyb21cbi8vIG91ciBvd24gb3JpZ2luIHdpdGggYSBKU09OIGJvZHksIHNvIG90aGVyIHNpdGVzIGluIHRoZSBwZXJzb24ncyBicm93c2VyIGNhbm5vdCBkcml2ZSBpdC5cbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgdHlwZSBJbmNvbWluZ01lc3NhZ2UsIHR5cGUgU2VydmVyLCB0eXBlIFNlcnZlclJlc3BvbnNlIH0gZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0IHsgcmVhZEZpbGUsIHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnbm9kZTp1dGlsJ1xuaW1wb3J0IHsgYnJvdGxpQ29tcHJlc3MsIGNvbnN0YW50cyB9IGZyb20gJ25vZGU6emxpYidcbmltcG9ydCB7IGV4dG5hbWUsIHJlc29sdmUsIHNlcCB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB7IFJFQURfT05MWV9DT01NQU5EUywgdHlwZSBDb21tYW5kS2luZCwgdHlwZSBDb21tYW5kUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9zaGFyZWQvY29tbWFuZHMudHMnXG5pbXBvcnQgdHlwZSB7IEZsb3dEZWx0YSwgRmxvd1NuYXBzaG90IH0gZnJvbSAnLi4vLi4vc2hhcmVkL2V2ZW50cy50cydcbmltcG9ydCB7IGhvc3RBbGxvd2VkLCB0b2tlbnNNYXRjaCB9IGZyb20gJy4vYXV0aC50cydcblxuZXhwb3J0IHR5cGUgRGFzaGJvYXJkRGVwcyA9IHtcbiAgdWlEaXI6IHN0cmluZ1xuICB0b2tlbjogc3RyaW5nXG4gIHBvcnQ6IG51bWJlclxuICBhbGxvd0NvbnRyb2xzOiAoKSA9PiBib29sZWFuXG4gIHNuYXBzaG90OiAoKSA9PiBGbG93U25hcHNob3RcbiAgc3Vic2NyaWJlOiAobGlzdGVuZXI6IChkZWx0YTogRmxvd0RlbHRhKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkXG4gIC8qKiBMaXZlIG91dHB1dCBub3RpY2VzOiBhbiBhZ2VudCdzIGNvbnZlcnNhdGlvbiBjaGFuZ2VkIChvbmx5IGl0cyBpZCBpcyBzZW50KS4gKi9cbiAgc3Vic2NyaWJlT3V0cHV0PzogKGxpc3RlbmVyOiAoYWdlbnRJZDogc3RyaW5nKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkXG4gIGNvbW1hbmQ6IChpbnB1dDogdW5rbm93biwgYWxsb3dlZDogKGtpbmQ6IENvbW1hbmRLaW5kKSA9PiBib29sZWFuKSA9PiBQcm9taXNlPENvbW1hbmRSZXNwb25zZT5cbiAgbG9nOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkXG59XG5cbmNvbnN0IE1JTUU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7ICcuaHRtbCc6ICd0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgnLCAnLmpzJzogJ3RleHQvamF2YXNjcmlwdDsgY2hhcnNldD11dGYtOCcsICcuY3NzJzogJ3RleHQvY3NzOyBjaGFyc2V0PXV0Zi04JywgJy5zdmcnOiAnaW1hZ2Uvc3ZnK3htbCcsICcuanNvbic6ICdhcHBsaWNhdGlvbi9qc29uJywgJy5wbmcnOiAnaW1hZ2UvcG5nJyB9XG5jb25zdCBTVEFUSUNfRklMRVMgPSBuZXcgU2V0KFsnZGFzaGJvYXJkLmh0bWwnLCAnYXBwLmpzJywgJ2FwcC5jc3MnLCAnaWNvbi5zdmcnLCAnbGF5b3V0LXdvcmtlci5qcyddKVxuLyoqIENvZGUtc3BsaXQgVUkgY2h1bmtzIHRoYXQgZXNidWlsZCBuYW1lcyBgY2h1bmtzLzxuYW1lPi08aGFzaD4uanNgIChsb2FkZWQgb24gZGVtYW5kKS4gKi9cbmNvbnN0IENIVU5LX0ZJTEUgPSAvXmNodW5rc1xcL1tBLVphLXowLTlfLV17MSw4MH1cXC5qcyQvXG5jb25zdCBNQVhfQk9EWSA9IDEyOCAqIDEwMjRcbi8qKiBSZWFkIChhbmQgZGlzY2FyZCkgYXQgbW9zdCB0aGlzIG11Y2ggb2YgYW4gb3ZlcnNpemVkIGJvZHkgYmVmb3JlIGN1dHRpbmcgdGhlIGNvbm5lY3Rpb24uICovXG5jb25zdCBNQVhfRFJBSU4gPSA0ICogMTAyNCAqIDEwMjRcbmNvbnN0IE1BWF9DTElFTlRTID0gOFxuY29uc3QgYnJvdGxpID0gcHJvbWlzaWZ5KGJyb3RsaUNvbXByZXNzKVxuXG5leHBvcnQgY2xhc3MgRGFzaGJvYXJkU2VydmVyIHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IFNlcnZlciB8IG51bGwgPSBudWxsXG4gIHByaXZhdGUgY2xpZW50cyA9IG5ldyBTZXQ8U2VydmVyUmVzcG9uc2U+KClcbiAgcHJpdmF0ZSB1bnN1YnNjcmliZTogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGxcbiAgcHJpdmF0ZSB1bnN1YnNjcmliZU91dHB1dDogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGxcbiAgcHJpdmF0ZSBib3VuZFBvcnQ6IG51bWJlciB8IG51bGwgPSBudWxsXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkZXBzOiBEYXNoYm9hcmREZXBzKSB7fVxuXG4gIGdldCB1cmwoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuYm91bmRQb3J0ID8gYGh0dHA6Ly8xMjcuMC4wLjE6JHt0aGlzLmJvdW5kUG9ydH0vI3Rva2VuPSR7dGhpcy5kZXBzLnRva2VufWAgOiBudWxsXG4gIH1cblxuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8IDEwOyBhdHRlbXB0KyspIHtcbiAgICAgIGNvbnN0IHBvcnQgPSB0aGlzLmRlcHMucG9ydCArIGF0dGVtcHRcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMubGlzdGVuKHBvcnQpXG4gICAgICAgIHRoaXMuYm91bmRQb3J0ID0gcG9ydFxuICAgICAgICB0aGlzLnVuc3Vic2NyaWJlID0gdGhpcy5kZXBzLnN1YnNjcmliZSgoZGVsdGEpID0+IHRoaXMuYnJvYWRjYXN0KCdkZWx0YScsIGRlbHRhKSlcbiAgICAgICAgdGhpcy51bnN1YnNjcmliZU91dHB1dCA9IHRoaXMuZGVwcy5zdWJzY3JpYmVPdXRwdXQ/LigoYWdlbnRJZCkgPT4gdGhpcy5icm9hZGNhc3QoJ291dHB1dCcsIHsgYWdlbnRJZCB9KSkgPz8gbnVsbFxuICAgICAgICB0aGlzLmRlcHMubG9nKGBkYXNoYm9hcmQgbGlzdGVuaW5nIG9uIDEyNy4wLjAuMToke3BvcnR9YClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSAhPT0gJ0VBRERSSU5VU0UnKSB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyZWUgcG9ydCBmcm9tICR7dGhpcy5kZXBzLnBvcnR9IHRvICR7dGhpcy5kZXBzLnBvcnQgKyA5fS5gKVxuICB9XG5cbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnVuc3Vic2NyaWJlPy4oKVxuICAgIHRoaXMudW5zdWJzY3JpYmUgPSBudWxsXG4gICAgdGhpcy51bnN1YnNjcmliZU91dHB1dD8uKClcbiAgICB0aGlzLnVuc3Vic2NyaWJlT3V0cHV0ID0gbnVsbFxuICAgIGZvciAoY29uc3QgY2xpZW50IG9mIHRoaXMuY2xpZW50cykgY2xpZW50LmVuZCgpXG4gICAgdGhpcy5jbGllbnRzLmNsZWFyKClcbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4gKHRoaXMuc2VydmVyID8gdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4gcmVzb2x2ZSgpKSA6IHJlc29sdmUoKSkpXG4gICAgdGhpcy5zZXJ2ZXIgPSBudWxsXG4gICAgdGhpcy5ib3VuZFBvcnQgPSBudWxsXG4gIH1cblxuICBwcml2YXRlIGxpc3Rlbihwb3J0OiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgc2VydmVyID0gY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4gdm9pZCB0aGlzLnJvdXRlKHJlcSwgcmVzLCBwb3J0KSlcbiAgICAgIHNlcnZlci5vbmNlKCdlcnJvcicsIHJlamVjdClcbiAgICAgIHNlcnZlci5saXN0ZW4ocG9ydCwgJzEyNy4wLjAuMScsICgpID0+IHtcbiAgICAgICAgc2VydmVyLm9mZignZXJyb3InLCByZWplY3QpXG4gICAgICAgIHRoaXMuc2VydmVyID0gc2VydmVyXG4gICAgICAgIHJlc29sdmUoKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByb3V0ZShyZXE6IEluY29taW5nTWVzc2FnZSwgcmVzOiBTZXJ2ZXJSZXNwb25zZSwgcG9ydDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVzLnNldEhlYWRlcignWC1Db250ZW50LVR5cGUtT3B0aW9ucycsICdub3NuaWZmJylcbiAgICByZXMuc2V0SGVhZGVyKCdSZWZlcnJlci1Qb2xpY3knLCAnbm8tcmVmZXJyZXInKVxuICAgIHJlcy5zZXRIZWFkZXIoJ0NhY2hlLUNvbnRyb2wnLCAnbm8tc3RvcmUnKVxuICAgIGlmICghaG9zdEFsbG93ZWQocmVxLmhlYWRlcnMuaG9zdCwgcG9ydCkpIHJldHVybiBzZW5kKHJlcywgNDIxLCAnV3JvbmcgaG9zdCcpXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXEudXJsID8/ICcvJywgYGh0dHA6Ly8xMjcuMC4wLjE6JHtwb3J0fWApXG4gICAgdHJ5IHtcbiAgICAgIGlmICh1cmwucGF0aG5hbWUuc3RhcnRzV2l0aCgnL2FwaS8nKSkgcmV0dXJuIGF3YWl0IHRoaXMuYXBpKHJlcSwgcmVzLCB1cmwsIHBvcnQpXG4gICAgICBpZiAocmVxLm1ldGhvZCAhPT0gJ0dFVCcpIHJldHVybiBzZW5kKHJlcywgNDA1LCAnTWV0aG9kIG5vdCBhbGxvd2VkJylcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNlcnZlU3RhdGljKHJlcywgdXJsLnBhdGhuYW1lLCBhY2NlcHRzQnJvdGxpKHJlcS5oZWFkZXJzWydhY2NlcHQtZW5jb2RpbmcnXSkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZGVwcy5sb2coYGRhc2hib2FyZCBlcnJvcjogJHsoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2V9YClcbiAgICAgIGlmICghcmVzLmhlYWRlcnNTZW50KSBzZW5kKHJlcywgNTAwLCAnSW50ZXJuYWwgZXJyb3InKVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBpKHJlcTogSW5jb21pbmdNZXNzYWdlLCByZXM6IFNlcnZlclJlc3BvbnNlLCB1cmw6IFVSTCwgcG9ydDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYXV0aCA9IHJlcS5oZWFkZXJzLmF1dGhvcml6YXRpb24/LnJlcGxhY2UoL15CZWFyZXJcXHMrL2ksICcnKVxuICAgIGlmICghdG9rZW5zTWF0Y2godGhpcy5kZXBzLnRva2VuLCBhdXRoKSkgcmV0dXJuIHNlbmRKc29uKHJlcywgNDAxLCB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogJ3VuYXV0aG9yaXplZCcsIG1lc3NhZ2U6ICdNaXNzaW5nIG9yIHdyb25nIHRva2VuLicgfSB9KVxuICAgIGlmICh1cmwucGF0aG5hbWUgPT09ICcvYXBpL3NuYXBzaG90JyAmJiByZXEubWV0aG9kID09PSAnR0VUJykgcmV0dXJuIHNlbmRKc29uKHJlcywgMjAwLCB0aGlzLmRlcHMuc25hcHNob3QoKSlcbiAgICBpZiAodXJsLnBhdGhuYW1lID09PSAnL2FwaS9ldmVudHMnICYmIHJlcS5tZXRob2QgPT09ICdHRVQnKSByZXR1cm4gdGhpcy5vcGVuU3RyZWFtKHJlcSwgcmVzKVxuICAgIGlmICh1cmwucGF0aG5hbWUgPT09ICcvYXBpL2NvbW1hbmQnICYmIHJlcS5tZXRob2QgPT09ICdQT1NUJykge1xuICAgICAgY29uc3Qgb3JpZ2luID0gcmVxLmhlYWRlcnMub3JpZ2luXG4gICAgICBpZiAob3JpZ2luICYmIG9yaWdpbiAhPT0gYGh0dHA6Ly8xMjcuMC4wLjE6JHtwb3J0fWAgJiYgb3JpZ2luICE9PSBgaHR0cDovL2xvY2FsaG9zdDoke3BvcnR9YCkgcmV0dXJuIHNlbmRKc29uKHJlcywgNDAzLCB7IG9rOiBmYWxzZSwgZXJyb3I6IHsgY29kZTogJ2ZvcmJpZGRlbicsIG1lc3NhZ2U6ICdDcm9zcy1vcmlnaW4gcmVxdWVzdCByZWZ1c2VkLicgfSB9KVxuICAgICAgaWYgKCEocmVxLmhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddID8/ICcnKS5zdGFydHNXaXRoKCdhcHBsaWNhdGlvbi9qc29uJykpIHJldHVybiBzZW5kSnNvbihyZXMsIDQxNSwgeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6ICd1bnN1cHBvcnRlZF9tZWRpYScsIG1lc3NhZ2U6ICdTZW5kIEpTT04uJyB9IH0pXG4gICAgICBsZXQgYm9keTogc3RyaW5nXG4gICAgICB0cnkge1xuICAgICAgICBib2R5ID0gYXdhaXQgcmVhZEJvZHkocmVxKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBzZW5kSnNvbihyZXMsIDQxMywgeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6ICd0b29fbGFyZ2UnLCBtZXNzYWdlOiAnUmVxdWVzdCBib2R5IHRvbyBsYXJnZS4nIH0gfSlcbiAgICAgIH1cbiAgICAgIGxldCBwYXJzZWQ6IHVua25vd25cbiAgICAgIHRyeSB7XG4gICAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoYm9keSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gc2VuZEpzb24ocmVzLCA0MDAsIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAnaW52YWxpZF9wYXJhbXMnLCBtZXNzYWdlOiAnQm9keSBpcyBub3QgSlNPTi4nIH0gfSlcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNvbnRyb2xzID0gdGhpcy5kZXBzLmFsbG93Q29udHJvbHMoKVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kZXBzLmNvbW1hbmQocGFyc2VkLCAoa2luZCkgPT4ga2luZCAhPT0gJ2Rhc2hib2FyZC5lbmFibGUnICYmIGtpbmQgIT09ICdkYXNoYm9hcmQuY29udHJvbHMnICYmIChjb250cm9scyB8fCBSRUFEX09OTFlfQ09NTUFORFMuaGFzKGtpbmQpKSlcbiAgICAgIHJldHVybiBzZW5kSnNvbihyZXMsIDIwMCwgcmVzdWx0KVxuICAgIH1cbiAgICByZXR1cm4gc2VuZEpzb24ocmVzLCA0MDQsIHsgb2s6IGZhbHNlLCBlcnJvcjogeyBjb2RlOiAnbm90X2ZvdW5kJywgbWVzc2FnZTogJ05vIHN1Y2ggZW5kcG9pbnQuJyB9IH0pXG4gIH1cblxuICBwcml2YXRlIG9wZW5TdHJlYW0ocmVxOiBJbmNvbWluZ01lc3NhZ2UsIHJlczogU2VydmVyUmVzcG9uc2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbGllbnRzLnNpemUgPj0gTUFYX0NMSUVOVFMpIHJldHVybiBzZW5kSnNvbihyZXMsIDQyOSwgeyBvazogZmFsc2UsIGVycm9yOiB7IGNvZGU6ICd0b29fbWFueV9jbGllbnRzJywgbWVzc2FnZTogJ1RvbyBtYW55IGRhc2hib2FyZHMgb3Blbi4nIH0gfSlcbiAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ3RleHQvZXZlbnQtc3RyZWFtJywgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tc3RvcmUnLCBDb25uZWN0aW9uOiAna2VlcC1hbGl2ZScgfSlcbiAgICByZXMud3JpdGUoYGV2ZW50OiBoZWxsb1xcbmRhdGE6IHt9XFxuXFxuYClcbiAgICB0aGlzLmNsaWVudHMuYWRkKHJlcylcbiAgICBjb25zdCBoZWFydGJlYXQgPSBzZXRJbnRlcnZhbCgoKSA9PiByZXMud3JpdGUoYDogcGluZ1xcblxcbmApLCAxNTAwMClcbiAgICByZXEub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgY2xlYXJJbnRlcnZhbChoZWFydGJlYXQpXG4gICAgICB0aGlzLmNsaWVudHMuZGVsZXRlKHJlcylcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBicm9hZGNhc3QoZXZlbnQ6ICdkZWx0YScgfCAnb3V0cHV0JywgZGF0YTogRmxvd0RlbHRhIHwgeyBhZ2VudElkOiBzdHJpbmcgfSk6IHZvaWQge1xuICAgIGlmICghdGhpcy5jbGllbnRzLnNpemUpIHJldHVyblxuICAgIGNvbnN0IHBheWxvYWQgPSBgZXZlbnQ6ICR7ZXZlbnR9XFxuZGF0YTogJHtKU09OLnN0cmluZ2lmeShkYXRhKX1cXG5cXG5gXG4gICAgZm9yIChjb25zdCBjbGllbnQgb2YgdGhpcy5jbGllbnRzKSBjbGllbnQud3JpdGUocGF5bG9hZClcbiAgfVxuXG4gIHByaXZhdGUgYnJvdGxpQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgeyBtdGltZTogbnVtYmVyOyBkYXRhOiBQcm9taXNlPEJ1ZmZlcj4gfT4oKVxuXG4gIC8qKiBCcm90bGkgY29weSBvZiBhIHRleHQgZmlsZSwgbWFkZSBvbiBmaXJzdCByZXF1ZXN0IGFuZCByZXVzZWQgdW50aWwgdGhlIGZpbGUgY2hhbmdlcy4gKi9cbiAgcHJpdmF0ZSBhc3luYyBjb21wcmVzc2VkKGZpbGU6IHN0cmluZyk6IFByb21pc2U8QnVmZmVyIHwgbnVsbD4ge1xuICAgIGlmICghL1xcLihqc3xjc3N8aHRtbHxzdmcpJC8udGVzdChmaWxlKSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCBtdGltZSA9IChhd2FpdCBzdGF0KGZpbGUpKS5tdGltZU1zXG4gICAgY29uc3QgaGl0ID0gdGhpcy5icm90bGlDYWNoZS5nZXQoZmlsZSlcbiAgICBpZiAoaGl0ICYmIGhpdC5tdGltZSA9PT0gbXRpbWUpIHJldHVybiBoaXQuZGF0YVxuICAgIGNvbnN0IGRhdGEgPSByZWFkRmlsZShmaWxlKS50aGVuKChyYXcpID0+IGJyb3RsaShyYXcsIHsgcGFyYW1zOiB7IFtjb25zdGFudHMuQlJPVExJX1BBUkFNX1FVQUxJVFldOiA5LCBbY29uc3RhbnRzLkJST1RMSV9QQVJBTV9TSVpFX0hJTlRdOiByYXcubGVuZ3RoIH0gfSkpXG4gICAgdGhpcy5icm90bGlDYWNoZS5zZXQoZmlsZSwgeyBtdGltZSwgZGF0YSB9KVxuICAgIGRhdGEuY2F0Y2goKCkgPT4gdGhpcy5icm90bGlDYWNoZS5kZWxldGUoZmlsZSkpXG4gICAgcmV0dXJuIGRhdGFcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VydmVTdGF0aWMocmVzOiBTZXJ2ZXJSZXNwb25zZSwgcGF0aG5hbWU6IHN0cmluZywgYnJvdGxpOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbmFtZSA9IHBhdGhuYW1lID09PSAnLycgPyAnZGFzaGJvYXJkLmh0bWwnIDogcGF0aG5hbWUucmVwbGFjZSgvXlxcLysvLCAnJylcbiAgICBpZiAoIVNUQVRJQ19GSUxFUy5oYXMobmFtZSkgJiYgIUNIVU5LX0ZJTEUudGVzdChuYW1lKSkgcmV0dXJuIHNlbmQocmVzLCA0MDQsICdOb3QgZm91bmQnKVxuICAgIGNvbnN0IHJvb3QgPSByZXNvbHZlKHRoaXMuZGVwcy51aURpcilcbiAgICBjb25zdCBmaWxlID0gcmVzb2x2ZShyb290LCBuYW1lKVxuICAgIGlmICghZmlsZS5zdGFydHNXaXRoKHJvb3QgKyBzZXApKSByZXR1cm4gc2VuZChyZXMsIDQwNCwgJ05vdCBmb3VuZCcpXG4gICAgbGV0IGRhdGE6IEJ1ZmZlclxuICAgIGxldCBlbmNvZGVkID0gZmFsc2VcbiAgICB0cnkge1xuICAgICAgLy8gQ29tcHJlc3NlZCBvbmNlIHBlciBmaWxlIHZlcnNpb24gYW5kIGtlcHQgaW4gbWVtb3J5IChubyBjb21wcmVzc2VkIGNvcGllcyBzaGlwIHdpdGggdGhlIHBsdWdpbikuXG4gICAgICBjb25zdCBjb21wcmVzc2VkID0gYnJvdGxpID8gYXdhaXQgdGhpcy5jb21wcmVzc2VkKGZpbGUpIDogbnVsbFxuICAgICAgaWYgKGNvbXByZXNzZWQpIHtcbiAgICAgICAgZGF0YSA9IGNvbXByZXNzZWRcbiAgICAgICAgZW5jb2RlZCA9IHRydWVcbiAgICAgIH0gZWxzZSBkYXRhID0gYXdhaXQgcmVhZEZpbGUoZmlsZSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBzZW5kKHJlcywgNDA0LCAnTm90IGZvdW5kJylcbiAgICB9XG4gICAgcmVzLndyaXRlSGVhZCgyMDAsIHtcbiAgICAgIC4uLihlbmNvZGVkID8geyAnQ29udGVudC1FbmNvZGluZyc6ICdicicgfSA6IHt9KSxcbiAgICAgIFZhcnk6ICdBY2NlcHQtRW5jb2RpbmcnLFxuICAgICAgJ0NvbnRlbnQtVHlwZSc6IE1JTUVbZXh0bmFtZShuYW1lKV0gPz8gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICAnQ29udGVudC1TZWN1cml0eS1Qb2xpY3knOiBcImRlZmF1bHQtc3JjICdzZWxmJzsgc2NyaXB0LXNyYyAnc2VsZic7IHN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnOyBpbWctc3JjICdzZWxmJyBkYXRhOjsgY29ubmVjdC1zcmMgJ3NlbGYnOyBmcmFtZS1hbmNlc3RvcnMgJ25vbmUnOyBiYXNlLXVyaSAnbm9uZSc7IGZvcm0tYWN0aW9uICdub25lJ1wiLFxuICAgICAgJ1gtRnJhbWUtT3B0aW9ucyc6ICdERU5ZJyxcbiAgICAgIC8vIEhhc2hlZCBjaHVua3MgbmV2ZXIgY2hhbmdlOyBldmVyeXRoaW5nIGVsc2UgaXMgcmUtY2hlY2tlZCBzbyBhIHJlYnVpbGQgc2hvd3MgdXAgb24gcmVsb2FkLlxuICAgICAgJ0NhY2hlLUNvbnRyb2wnOiBDSFVOS19GSUxFLnRlc3QobmFtZSkgPyAncHVibGljLCBtYXgtYWdlPTMxNTM2MDAwLCBpbW11dGFibGUnIDogJ25vLWNhY2hlJ1xuICAgIH0pXG4gICAgcmVzLmVuZChkYXRhKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhY2NlcHRzQnJvdGxpKGhlYWRlcjogc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQpOiBib29sZWFuIHtcbiAgY29uc3QgdmFsdWUgPSBBcnJheS5pc0FycmF5KGhlYWRlcikgPyBoZWFkZXIuam9pbignLCcpIDogKGhlYWRlciA/PyAnJylcbiAgcmV0dXJuIHZhbHVlLnNwbGl0KCcsJykuc29tZSgocGFydCkgPT4ge1xuICAgIGNvbnN0IFtuYW1lLCAuLi5wYXJhbXNdID0gcGFydC50cmltKCkuc3BsaXQoJzsnKVxuICAgIGlmIChuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpICE9PSAnYnInKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBxID0gcGFyYW1zLm1hcCgocCkgPT4gcC50cmltKCkpLmZpbmQoKHApID0+IHAuc3RhcnRzV2l0aCgncT0nKSlcbiAgICByZXR1cm4gIXEgfHwgTnVtYmVyKHEuc2xpY2UoMikpID4gMFxuICB9KVxufVxuXG5mdW5jdGlvbiBzZW5kKHJlczogU2VydmVyUmVzcG9uc2UsIHN0YXR1czogbnVtYmVyLCB0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgcmVzLndyaXRlSGVhZChzdGF0dXMsIHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04JyB9KVxuICByZXMuZW5kKHRleHQpXG59XG5cbmZ1bmN0aW9uIHNlbmRKc29uKHJlczogU2VydmVyUmVzcG9uc2UsIHN0YXR1czogbnVtYmVyLCB2YWx1ZTogdW5rbm93bik6IHZvaWQge1xuICByZXMud3JpdGVIZWFkKHN0YXR1cywgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgnIH0pXG4gIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkodmFsdWUpKVxufVxuXG5mdW5jdGlvbiByZWFkQm9keShyZXE6IEluY29taW5nTWVzc2FnZSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgbGV0IHNpemUgPSAwXG4gICAgY29uc3QgY2h1bmtzOiBCdWZmZXJbXSA9IFtdXG4gICAgcmVxLm9uKCdkYXRhJywgKGNodW5rOiBCdWZmZXIpID0+IHtcbiAgICAgIHNpemUgKz0gY2h1bmsubGVuZ3RoXG4gICAgICAvLyBUb28gYmlnOiBzdG9wIGtlZXBpbmcgaXQgYnV0IHJlYWQgdG8gdGhlIGVuZCwgc28gdGhlIDQxMyBhbnN3ZXIgcmVhY2hlcyB0aGUgY2xpZW50OyBvbmx5IGFcbiAgICAgIC8vIHJ1bmF3YXkgdXBsb2FkIGlzIGN1dCBvZmYuXG4gICAgICBpZiAoc2l6ZSA+IE1BWF9EUkFJTikgcmVxLmRlc3Ryb3koKVxuICAgICAgZWxzZSBpZiAoc2l6ZSA8PSBNQVhfQk9EWSkgY2h1bmtzLnB1c2goY2h1bmspXG4gICAgfSlcbiAgICByZXEub24oJ2VuZCcsICgpID0+IChzaXplID4gTUFYX0JPRFkgPyByZWplY3QobmV3IEVycm9yKCdCb2R5IHRvbyBsYXJnZScpKSA6IHJlc29sdmUoQnVmZmVyLmNvbmNhdChjaHVua3MpLnRvU3RyaW5nKCd1dGY4JykpKSlcbiAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KVxuICB9KVxufVxuIiwgIi8vIFNhdmVzIGVhY2ggcnVuICh0YXNrcywgYWdlbnRzLCBtZXNzYWdlcywgdGltZWxpbmUpIHNvIGZpbmlzaGVkIHJ1bnMgY2FuIGJlIHJlcGxheWVkIGxhdGVyLlxuaW1wb3J0IHR5cGUgeyBGbG93U3RvcmUgfSBmcm9tICcuL3N0b3JlLnRzJ1xuaW1wb3J0IHR5cGUgeyBQZXJzaXN0ZW5jZSwgUnVuSGlzdG9yeVJlY29yZCB9IGZyb20gJy4vcGVyc2lzdGVuY2UudHMnXG5cbmV4cG9ydCBjbGFzcyBIaXN0b3J5UmVjb3JkZXIge1xuICBwcml2YXRlIHNhdmVkVmVyc2lvbiA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBGbG93U3RvcmUsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwZXJzaXN0ZW5jZTogUGVyc2lzdGVuY2UsXG4gICAgcHJpdmF0ZSByZWFkb25seSBsb2c6IChtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWRcbiAgKSB7fVxuXG4gIGFzeW5jIHNhdmVDaGFuZ2VkUnVucygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RvcmUucmVhZCgpXG4gICAgZm9yIChjb25zdCBydW4gb2YgT2JqZWN0LnZhbHVlcyhzdGF0ZS5ydW5zKSkge1xuICAgICAgY29uc3QgdGFza3MgPSBPYmplY3QudmFsdWVzKHN0YXRlLnRhc2tzKS5maWx0ZXIoKHRhc2spID0+IHRhc2sucnVuSWQgPT09IHJ1bi5pZClcbiAgICAgIGlmICghdGFza3MubGVuZ3RoKSBjb250aW51ZVxuICAgICAgY29uc3QgYWdlbnRzID0gT2JqZWN0LnZhbHVlcyhzdGF0ZS5hZ2VudHMpLmZpbHRlcigoYWdlbnQpID0+IGFnZW50LnJ1bklkID09PSBydW4uaWQpXG4gICAgICBjb25zdCBmaW5nZXJwcmludCA9IGAke3J1bi52ZXJzaW9ufXwke3J1bi5zdGF0ZX18JHt0YXNrcy5tYXAoKHQpID0+IHQudmVyc2lvbikuam9pbignLCcpfXwke2FnZW50cy5tYXAoKGEpID0+IGEudmVyc2lvbikuam9pbignLCcpfWBcbiAgICAgIGlmICh0aGlzLnNhdmVkVmVyc2lvbi5nZXQocnVuLmlkKSA9PT0gZmluZ2VycHJpbnQpIGNvbnRpbnVlXG4gICAgICBjb25zdCBpZHMgPSBuZXcgU2V0PHN0cmluZz4oW3J1bi5pZCwgLi4udGFza3MubWFwKCh0KSA9PiB0LmlkKSwgLi4uYWdlbnRzLm1hcCgoYSkgPT4gYS5pZCldKVxuICAgICAgY29uc3QgcmVjb3JkOiBSdW5IaXN0b3J5UmVjb3JkID0ge1xuICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICBzYXZlZEF0OiBEYXRlLm5vdygpLFxuICAgICAgICBydW4sXG4gICAgICAgIHRhc2tzLFxuICAgICAgICBhZ2VudHMsXG4gICAgICAgIG1lc3NhZ2VzOiBzdGF0ZS5tZXNzYWdlcy5maWx0ZXIoKG1lc3NhZ2UpID0+IG1lc3NhZ2UucnVuSWQgPT09IHJ1bi5pZCksXG4gICAgICAgIGV2ZW50czogdGhpcy5zdG9yZS5ldmVudHMoKS5maWx0ZXIoKGV2ZW50KSA9PiBldmVudC5ydW5JZCA9PT0gcnVuLmlkIHx8IGlkcy5oYXMoZXZlbnQuZW50aXR5SWQpKVxuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0ZW5jZS5zYXZlUnVuKHJlY29yZClcbiAgICAgICAgdGhpcy5zYXZlZFZlcnNpb24uc2V0KHJ1bi5pZCwgZmluZ2VycHJpbnQpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZyhgaGlzdG9yeSBzYXZlIGZhaWxlZCBmb3IgJHtydW4uaWR9OiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIiwgIi8vIFRoZSByZXBvc2l0b3J5IGEgd29ya3RyZWUgYmVsb25ncyB0bywgZnJvbSBpdHMgYC5naXRgIHBvaW50ZXIgKHJlYWQtb25seSwgbm8gZ2l0IHByb2Nlc3MpOlxuLy8gYSBsaW5rZWQgd29ya3RyZWUgaGFzIGEgYC5naXRgIGZpbGUgYGdpdGRpcjogPHJlcG8+Ly5naXQvd29ya3RyZWVzLzxuYW1lPmA7IGEgbWFpbiBjaGVja291dFxuLy8gaGFzIGEgYC5naXRgIGZvbGRlci4gTGV0cyBwcm9qZWN0IGJveGVzIG1hdGNoIGEgd29ya3RyZWUgdG8gaXRzIHByb2plY3QgZXhhY3RseS5cbmltcG9ydCB7IHJlYWRGaWxlLCBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5cbmNvbnN0IGNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZyB8IG51bGw+KClcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcG9Sb290T2Yod29ya3RyZWVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgaWYgKGNhY2hlLmhhcyh3b3JrdHJlZVBhdGgpKSByZXR1cm4gY2FjaGUuZ2V0KHdvcmt0cmVlUGF0aCkhXG4gIGxldCByb290OiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICB0cnkge1xuICAgIGNvbnN0IGRvdEdpdCA9IGpvaW4od29ya3RyZWVQYXRoLCAnLmdpdCcpXG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IHN0YXQoZG90R2l0KVxuICAgIGlmIChpbmZvLmlzRGlyZWN0b3J5KCkpIHJvb3QgPSB3b3JrdHJlZVBhdGhcbiAgICBlbHNlIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShkb3RHaXQsICd1dGY4JylcbiAgICAgIGNvbnN0IGdpdGRpciA9IC9eZ2l0ZGlyOlxccyooLispJC9tLmV4ZWModGV4dCk/LlsxXT8udHJpbSgpXG4gICAgICBjb25zdCBtYXJrZXIgPSBnaXRkaXIgPyBnaXRkaXIubGFzdEluZGV4T2YoJy8uZ2l0LycpIDogLTFcbiAgICAgIGlmIChnaXRkaXIgJiYgbWFya2VyID4gMCkgcm9vdCA9IGdpdGRpci5zbGljZSgwLCBtYXJrZXIpXG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICByb290ID0gbnVsbCAvLyByZW1vdmVkIHdvcmt0cmVlIG9yIG5vdCBhIGdpdCBjaGVja291dFxuICB9XG4gIGNhY2hlLnNldCh3b3JrdHJlZVBhdGgsIHJvb3QpXG4gIGlmIChjYWNoZS5zaXplID4gMjAwMCkgY2FjaGUuZGVsZXRlKGNhY2hlLmtleXMoKS5uZXh0KCkudmFsdWUgYXMgc3RyaW5nKVxuICByZXR1cm4gcm9vdFxufVxuIiwgIi8vIENyYXNoIHJlY292ZXJ5IGFuZCBydW4gaGlzdG9yeSBvbiBkaXNrLCBpbiB0aGUgcGx1Z2luJ3Mgb3duIHN0YXRlIGZvbGRlciAobmV2ZXIgdGhlIHJlcG8pLlxuLy8gQm91bmRlZDogb25lIGNvbXBhY3Qgc25hcHNob3QgcGx1cyBhdCBtb3N0IE1BWF9SVU5TIHJ1biByZWNvcmRzLlxuaW1wb3J0IHsgbWtkaXIsIHJlYWRkaXIsIHJlYWRGaWxlLCByZW5hbWUsIHJtLCBzdGF0LCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgaG9tZWRpciwgcGxhdGZvcm0gfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB0eXBlIHsgRmxvd0V2ZW50LCBGbG93U25hcHNob3QgfSBmcm9tICcuLi8uLi9zaGFyZWQvZXZlbnRzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBZ2VudFJlY29yZCwgTWVzc2FnZVJlY29yZCwgUnVuUmVjb3JkLCBUYXNrUmVjb3JkIH0gZnJvbSAnLi4vLi4vc2hhcmVkL21vZGVsLnRzJ1xuXG5jb25zdCBNQVhfUlVOUyA9IDYwXG5jb25zdCBNQVhfUlVOX0VWRU5UUyA9IDIwMDBcbmNvbnN0IFNOQVBTSE9UX0ZJTEUgPSAnc25hcHNob3QuanNvbidcbmNvbnN0IFBSVU5FX0VWRVJZID0gMTBcblxuZXhwb3J0IHR5cGUgUnVuSGlzdG9yeVJlY29yZCA9IHtcbiAgdmVyc2lvbjogMVxuICBzYXZlZEF0OiBudW1iZXJcbiAgcnVuOiBSdW5SZWNvcmRcbiAgdGFza3M6IFRhc2tSZWNvcmRbXVxuICBhZ2VudHM6IEFnZW50UmVjb3JkW11cbiAgbWVzc2FnZXM6IE1lc3NhZ2VSZWNvcmRbXVxuICBldmVudHM6IEZsb3dFdmVudFtdXG59XG5cbmV4cG9ydCB0eXBlIFJ1bkhpc3RvcnlTdW1tYXJ5ID0gUGljazxSdW5SZWNvcmQsICdpZCcgfCAnb2JqZWN0aXZlJyB8ICdzdGF0ZScgfCAnc3RhcnRlZEF0JyB8ICdlbmRlZEF0JyB8ICd0YXNrQ291bnQnPiAmIHsgc2F2ZWRBdDogbnVtYmVyIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHN0YXRlRGlyKCk6IHN0cmluZyB7XG4gIGNvbnN0IGhvbWUgPSBob21lZGlyKClcbiAgaWYgKHBsYXRmb3JtKCkgPT09ICdkYXJ3aW4nKSByZXR1cm4gam9pbihob21lLCAnTGlicmFyeS9BcHBsaWNhdGlvbiBTdXBwb3J0L29yY2EtYWdlbnQtZmxvdycpXG4gIGlmIChwbGF0Zm9ybSgpID09PSAnd2luMzInKSByZXR1cm4gam9pbihwcm9jZXNzLmVudi5BUFBEQVRBID8/IGpvaW4oaG9tZSwgJ0FwcERhdGEvUm9hbWluZycpLCAnb3JjYS1hZ2VudC1mbG93JylcbiAgcmV0dXJuIGpvaW4ocHJvY2Vzcy5lbnYuWERHX1NUQVRFX0hPTUUgPz8gam9pbihob21lLCAnLmxvY2FsL3N0YXRlJyksICdvcmNhLWFnZW50LWZsb3cnKVxufVxuXG5leHBvcnQgY2xhc3MgUGVyc2lzdGVuY2Uge1xuICBwcml2YXRlIGhpc3RvcnlEaXI6IHN0cmluZ1xuICBwcml2YXRlIHNhdmVzU2luY2VQcnVuZSA9IDBcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRpciA9IHN0YXRlRGlyKCkpIHtcbiAgICB0aGlzLmhpc3RvcnlEaXIgPSBqb2luKGRpciwgJ2hpc3RvcnknKVxuICB9XG5cbiAgYXN5bmMgaW5pdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBta2Rpcih0aGlzLmhpc3RvcnlEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzcwMCB9KVxuICB9XG5cbiAgYXN5bmMgbG9hZFNuYXBzaG90KCk6IFByb21pc2U8Rmxvd1NuYXBzaG90IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGpvaW4odGhpcy5kaXIsIFNOQVBTSE9UX0ZJTEUpLCAndXRmOCcpKSBhcyBGbG93U25hcHNob3RcbiAgICAgIHJldHVybiBwYXJzZWQ/LnN0YXRlICYmIHR5cGVvZiBwYXJzZWQuc3RhdGUuc2VxID09PSAnbnVtYmVyJyA/IHBhcnNlZCA6IG51bGxcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZVNuYXBzaG90KHNuYXBzaG90OiBGbG93U25hcHNob3QpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBhdG9taWNXcml0ZShqb2luKHRoaXMuZGlyLCBTTkFQU0hPVF9GSUxFKSwgSlNPTi5zdHJpbmdpZnkoc25hcHNob3QpKVxuICB9XG5cbiAgYXN5bmMgc2F2ZVJ1bihyZWNvcmQ6IFJ1bkhpc3RvcnlSZWNvcmQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmltbWVkID0geyAuLi5yZWNvcmQsIGV2ZW50czogcmVjb3JkLmV2ZW50cy5zbGljZSgtTUFYX1JVTl9FVkVOVFMpIH1cbiAgICBhd2FpdCBhdG9taWNXcml0ZShqb2luKHRoaXMuaGlzdG9yeURpciwgYCR7c2FmZU5hbWUocmVjb3JkLnJ1bi5pZCl9Lmpzb25gKSwgSlNPTi5zdHJpbmdpZnkodHJpbW1lZCkpXG4gICAgLy8gTGlzdGluZyB0aGUgZm9sZGVyIGlzIHRoZSBjb3N0bHkgcGFydDsgdHJpbW1pbmcgb2xkIHJ1bnMgbm93IGFuZCB0aGVuIGlzIGVub3VnaC5cbiAgICBpZiAodGhpcy5zYXZlc1NpbmNlUHJ1bmUrKyAlIFBSVU5FX0VWRVJZID09PSAwKSBhd2FpdCB0aGlzLnBydW5lKClcbiAgfVxuXG4gIGFzeW5jIGxpc3RSdW5zKCk6IFByb21pc2U8UnVuSGlzdG9yeVN1bW1hcnlbXT4ge1xuICAgIGNvbnN0IG91dDogUnVuSGlzdG9yeVN1bW1hcnlbXSA9IFtdXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIGF3YWl0IHRoaXMuZmlsZXMoKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVjb3JkID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShqb2luKHRoaXMuaGlzdG9yeURpciwgbmFtZSksICd1dGY4JykpIGFzIFJ1bkhpc3RvcnlSZWNvcmRcbiAgICAgICAgY29uc3QgeyBpZCwgb2JqZWN0aXZlLCBzdGF0ZSwgc3RhcnRlZEF0LCBlbmRlZEF0LCB0YXNrQ291bnQgfSA9IHJlY29yZC5ydW5cbiAgICAgICAgb3V0LnB1c2goeyBpZCwgb2JqZWN0aXZlLCBzdGF0ZSwgc3RhcnRlZEF0LCBlbmRlZEF0LCB0YXNrQ291bnQsIHNhdmVkQXQ6IHJlY29yZC5zYXZlZEF0IH0pXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gc2tpcCB1bnJlYWRhYmxlIGZpbGVzXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXQuc29ydCgoYSwgYikgPT4gKGIuc3RhcnRlZEF0ID8/IGIuc2F2ZWRBdCkgLSAoYS5zdGFydGVkQXQgPz8gYS5zYXZlZEF0KSkuc2xpY2UoMCwgTUFYX1JVTlMpXG4gIH1cblxuICBhc3luYyBsb2FkUnVuKHJ1bklkOiBzdHJpbmcpOiBQcm9taXNlPFJ1bkhpc3RvcnlSZWNvcmQgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlKGpvaW4odGhpcy5oaXN0b3J5RGlyLCBgJHtzYWZlTmFtZShydW5JZCl9Lmpzb25gKSwgJ3V0ZjgnKSkgYXMgUnVuSGlzdG9yeVJlY29yZFxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZpbGVzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIChhd2FpdCByZWFkZGlyKHRoaXMuaGlzdG9yeURpcikpLmZpbHRlcigobmFtZSkgPT4gbmFtZS5lbmRzV2l0aCgnLmpzb24nKSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJ1bmUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbmFtZXMgPSBhd2FpdCB0aGlzLmZpbGVzKClcbiAgICBpZiAobmFtZXMubGVuZ3RoIDw9IE1BWF9SVU5TKSByZXR1cm5cbiAgICBjb25zdCB3aXRoVGltZXMgPSBhd2FpdCBQcm9taXNlLmFsbChuYW1lcy5tYXAoYXN5bmMgKG5hbWUpID0+ICh7IG5hbWUsIG10aW1lOiAoYXdhaXQgc3RhdChqb2luKHRoaXMuaGlzdG9yeURpciwgbmFtZSkpKS5tdGltZU1zIH0pKSlcbiAgICB3aXRoVGltZXMuc29ydCgoYSwgYikgPT4gYS5tdGltZSAtIGIubXRpbWUpXG4gICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB3aXRoVGltZXMuc2xpY2UoMCwgbmFtZXMubGVuZ3RoIC0gTUFYX1JVTlMpKSBhd2FpdCBybShqb2luKHRoaXMuaGlzdG9yeURpciwgbmFtZSksIHsgZm9yY2U6IHRydWUgfSlcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FmZU5hbWUoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBpZC5yZXBsYWNlKC9bXkEtWmEtejAtOV8uLV0vZywgJ18nKS5zbGljZSgwLCAxMjApXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF0b21pY1dyaXRlKHBhdGg6IHN0cmluZywgZGF0YTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHRtcCA9IGAke3BhdGh9LiR7cHJvY2Vzcy5waWR9LnRtcGBcbiAgYXdhaXQgd3JpdGVGaWxlKHRtcCwgZGF0YSwgeyBtb2RlOiAwbzYwMCB9KVxuICBhd2FpdCByZW5hbWUodG1wLCBwYXRoKVxufVxuIiwgImltcG9ydCB0eXBlIHsgQWdlbnRSZWNvcmQsIEV2aWRlbmNlU291cmNlLCBGbG93U3RhdGUsIEdhdGVSZWNvcmQsIE1lc3NhZ2VSZWNvcmQsIFJ1blJlY29yZCwgVGFza1JlY29yZCwgVG9vbENhbGxSZWNvcmQsIFdvcmt0cmVlUmVjb3JkLCBBY2NvdW50UmVjb3JkLCBDYXBhYmlsaXRpZXMsIExhYmVsQ29uZmlnLCBQcm9qZWN0UmVjb3JkIH0gZnJvbSAnLi9tb2RlbC50cydcblxuLyoqIFNlbWFudGljIHRpbWVsaW5lIGV2ZW50LiBEcml2ZXMgdGhlIGJvdHRvbSB0aW1lbGluZSwgaGlzdG9yeSBhbmQgZWRnZSBhbmltYXRpb24uICovXG5leHBvcnQgdHlwZSBGbG93RXZlbnRLaW5kID1cbiAgfCAnYWdlbnQuY3JlYXRlZCdcbiAgfCAnYWdlbnQuc3RhcnRlZCdcbiAgfCAnYWdlbnQuc3RhdHVzX2NoYW5nZWQnXG4gIHwgJ2FnZW50LmNvbXBsZXRlZCdcbiAgfCAnYWdlbnQuZmFpbGVkJ1xuICB8ICdzdWJhZ2VudC5zcGF3bmVkJ1xuICB8ICdzdWJhZ2VudC5jb21wbGV0ZWQnXG4gIHwgJ3Rhc2suY3JlYXRlZCdcbiAgfCAndGFzay5hc3NpZ25lZCdcbiAgfCAndGFzay5zdGFydGVkJ1xuICB8ICd0YXNrLnVwZGF0ZWQnXG4gIHwgJ3Rhc2suY29tcGxldGVkJ1xuICB8ICd0YXNrLmZhaWxlZCdcbiAgfCAndGFzay5ibG9ja2VkJ1xuICB8ICd0YXNrLnJldHJpZWQnXG4gIHwgJ3Jldmlldy5zdGFydGVkJ1xuICB8ICdyZXZpZXcuY29tcGxldGVkJ1xuICB8ICd0ZXN0LnN0YXJ0ZWQnXG4gIHwgJ3Rlc3QuY29tcGxldGVkJ1xuICB8ICd3b3JrdHJlZS5jcmVhdGVkJ1xuICB8ICd3b3JrdHJlZS51cGRhdGVkJ1xuICB8ICd3b3JrdHJlZS5yZW1vdmVkJ1xuICB8ICdtZXNzYWdlLnNlbnQnXG4gIHwgJ3Rvb2wuY2FsbGVkJ1xuICB8ICdvcmNoZXN0cmF0aW9uLnN0YXJ0ZWQnXG4gIHwgJ29yY2hlc3RyYXRpb24uY29tcGxldGVkJ1xuICB8ICdjb21tYW5kLmV4ZWN1dGVkJ1xuICB8ICdjb21tYW5kLmZhaWxlZCdcblxuZXhwb3J0IHR5cGUgRmxvd0V2ZW50ID0ge1xuICBpZDogc3RyaW5nXG4gIHNlcTogbnVtYmVyXG4gIHRzOiBudW1iZXJcbiAga2luZDogRmxvd0V2ZW50S2luZFxuICBzb3VyY2U6IEV2aWRlbmNlU291cmNlIHwgJ2NvbW1hbmQnXG4gIC8qKiBFbnRpdHkgdGhlIGV2ZW50IGlzIGFib3V0IChhZ2VudCwgdGFzaywgcnVuLCB3b3JrdHJlZSBpZCkuICovXG4gIGVudGl0eUlkOiBzdHJpbmdcbiAgLyoqIEZvciBoYW5kb2Zmcy9tZXNzYWdlczogdGhlIG90aGVyIGVuZCwgc28gdGhlIFVJIGNhbiBhbmltYXRlIHRoYXQgZWRnZS4gKi9cbiAgdGFyZ2V0SWQ/OiBzdHJpbmcgfCBudWxsXG4gIHJ1bklkPzogc3RyaW5nIHwgbnVsbFxuICBzdW1tYXJ5OiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgRW50aXR5UGF0Y2ggPVxuICB8IHsgZW50aXR5OiAnYWdlbnQnOyBpZDogc3RyaW5nOyB2YWx1ZTogQWdlbnRSZWNvcmQgfCBudWxsIH1cbiAgfCB7IGVudGl0eTogJ3Rhc2snOyBpZDogc3RyaW5nOyB2YWx1ZTogVGFza1JlY29yZCB8IG51bGwgfVxuICB8IHsgZW50aXR5OiAncnVuJzsgaWQ6IHN0cmluZzsgdmFsdWU6IFJ1blJlY29yZCB8IG51bGwgfVxuICB8IHsgZW50aXR5OiAnZ2F0ZSc7IGlkOiBzdHJpbmc7IHZhbHVlOiBHYXRlUmVjb3JkIHwgbnVsbCB9XG4gIHwgeyBlbnRpdHk6ICd3b3JrdHJlZSc7IGlkOiBzdHJpbmc7IHZhbHVlOiBXb3JrdHJlZVJlY29yZCB8IG51bGwgfVxuICB8IHsgZW50aXR5OiAnYWNjb3VudCc7IGlkOiBzdHJpbmc7IHZhbHVlOiBBY2NvdW50UmVjb3JkIHwgbnVsbCB9XG4gIHwgeyBlbnRpdHk6ICdwcm9qZWN0JzsgaWQ6IHN0cmluZzsgdmFsdWU6IFByb2plY3RSZWNvcmQgfCBudWxsIH1cbiAgfCB7IGVudGl0eTogJ21lc3NhZ2UnOyBpZDogc3RyaW5nOyB2YWx1ZTogTWVzc2FnZVJlY29yZCB9XG4gIHwgeyBlbnRpdHk6ICd0b29sQ2FsbCc7IGlkOiBzdHJpbmc7IHZhbHVlOiBUb29sQ2FsbFJlY29yZCB9XG4gIHwgeyBlbnRpdHk6ICdjYXBhYmlsaXRpZXMnOyBpZDogJ2NhcGFiaWxpdGllcyc7IHZhbHVlOiBDYXBhYmlsaXRpZXMgfVxuICB8IHsgZW50aXR5OiAnbGFiZWxzJzsgaWQ6ICdsYWJlbHMnOyB2YWx1ZTogTGFiZWxDb25maWcgfVxuXG4vKiogT3JkZXJlZCBkZWx0YSB0aGUgd29ya2VyIHB1c2hlczsgYGZyb21TZXFgIG11c3QgZXF1YWwgdGhlIGNsaWVudCdzIHNlcSBvciBpdCByZS1zbmFwc2hvdHMuICovXG5leHBvcnQgdHlwZSBGbG93RGVsdGEgPSB7XG4gIGZyb21TZXE6IG51bWJlclxuICB0b1NlcTogbnVtYmVyXG4gIHBhdGNoZXM6IEVudGl0eVBhdGNoW11cbiAgZXZlbnRzOiBGbG93RXZlbnRbXVxufVxuXG5leHBvcnQgdHlwZSBGbG93U25hcHNob3QgPSB7XG4gIHN0YXRlOiBGbG93U3RhdGVcbiAgZXZlbnRzOiBGbG93RXZlbnRbXVxufVxuXG5leHBvcnQgY29uc3QgTUFYX01FU1NBR0VTID0gMzAwXG5leHBvcnQgY29uc3QgTUFYX1RPT0xfQ0FMTFMgPSAzMDBcbmV4cG9ydCBjb25zdCBNQVhfVElNRUxJTkUgPSAxMDAwXG5cbi8qKiBBcHBsaWVzIGEgcGF0Y2ggdG8gYSBzdGF0ZSBjb3B5IGluIHBsYWNlLiBTaGFyZWQgc28gVUkgYW5kIHdvcmtlciBhZ3JlZSBieXRlIGZvciBieXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGF0Y2goc3RhdGU6IEZsb3dTdGF0ZSwgcGF0Y2g6IEVudGl0eVBhdGNoKTogdm9pZCB7XG4gIHN3aXRjaCAocGF0Y2guZW50aXR5KSB7XG4gICAgY2FzZSAnYWdlbnQnOlxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUuYWdlbnRzLCBwYXRjaC5pZCwgcGF0Y2gudmFsdWUpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3Rhc2snOlxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUudGFza3MsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAncnVuJzpcbiAgICAgIHNldE9yRGVsZXRlKHN0YXRlLnJ1bnMsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnZ2F0ZSc6XG4gICAgICBzZXRPckRlbGV0ZShzdGF0ZS5nYXRlcywgcGF0Y2guaWQsIHBhdGNoLnZhbHVlKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd3b3JrdHJlZSc6XG4gICAgICBzZXRPckRlbGV0ZShzdGF0ZS53b3JrdHJlZXMsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYWNjb3VudCc6XG4gICAgICBzZXRPckRlbGV0ZShzdGF0ZS5hY2NvdW50cywgcGF0Y2guaWQsIHBhdGNoLnZhbHVlKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdwcm9qZWN0JzpcbiAgICAgIC8vIE9sZGVyIHNuYXBzaG90cyBoYXZlIG5vIHByb2plY3RzIG1hcC5cbiAgICAgIHN0YXRlLnByb2plY3RzID8/PSB7fVxuICAgICAgc2V0T3JEZWxldGUoc3RhdGUucHJvamVjdHMsIHBhdGNoLmlkLCBwYXRjaC52YWx1ZSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbWVzc2FnZSc6IHtcbiAgICAgIGNvbnN0IGluZGV4ID0gc3RhdGUubWVzc2FnZXMuZmluZEluZGV4KChtZXNzYWdlKSA9PiBtZXNzYWdlLmlkID09PSBwYXRjaC5pZClcbiAgICAgIGlmIChpbmRleCA+PSAwKSBzdGF0ZS5tZXNzYWdlc1tpbmRleF0gPSBwYXRjaC52YWx1ZVxuICAgICAgZWxzZSBzdGF0ZS5tZXNzYWdlcy5wdXNoKHBhdGNoLnZhbHVlKVxuICAgICAgaWYgKHN0YXRlLm1lc3NhZ2VzLmxlbmd0aCA+IE1BWF9NRVNTQUdFUykgc3RhdGUubWVzc2FnZXMuc3BsaWNlKDAsIHN0YXRlLm1lc3NhZ2VzLmxlbmd0aCAtIE1BWF9NRVNTQUdFUylcbiAgICAgIGJyZWFrXG4gICAgfVxuICAgIGNhc2UgJ3Rvb2xDYWxsJzoge1xuICAgICAgY29uc3QgaW5kZXggPSBzdGF0ZS50b29sQ2FsbHMuZmluZEluZGV4KChjYWxsKSA9PiBjYWxsLmlkID09PSBwYXRjaC5pZClcbiAgICAgIGlmIChpbmRleCA+PSAwKSBzdGF0ZS50b29sQ2FsbHNbaW5kZXhdID0gcGF0Y2gudmFsdWVcbiAgICAgIGVsc2Ugc3RhdGUudG9vbENhbGxzLnB1c2gocGF0Y2gudmFsdWUpXG4gICAgICBpZiAoc3RhdGUudG9vbENhbGxzLmxlbmd0aCA+IE1BWF9UT09MX0NBTExTKSBzdGF0ZS50b29sQ2FsbHMuc3BsaWNlKDAsIHN0YXRlLnRvb2xDYWxscy5sZW5ndGggLSBNQVhfVE9PTF9DQUxMUylcbiAgICAgIGJyZWFrXG4gICAgfVxuICAgIGNhc2UgJ2NhcGFiaWxpdGllcyc6XG4gICAgICBzdGF0ZS5jYXBhYmlsaXRpZXMgPSBwYXRjaC52YWx1ZVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdsYWJlbHMnOlxuICAgICAgc3RhdGUubGFiZWxzID0gcGF0Y2gudmFsdWVcbiAgICAgIGJyZWFrXG4gIH1cbn1cblxuZnVuY3Rpb24gc2V0T3JEZWxldGU8VD4obWFwOiBSZWNvcmQ8c3RyaW5nLCBUPiwgaWQ6IHN0cmluZywgdmFsdWU6IFQgfCBudWxsKTogdm9pZCB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCkgZGVsZXRlIG1hcFtpZF1cbiAgZWxzZSBtYXBbaWRdID0gdmFsdWVcbn1cbiIsICIvLyBUaGUgc2luZ2xlIGF1dGhvcml0YXRpdmUgQWdlbnQgRmxvdyBzdGF0ZS4gQWRhcHRlcnMgd3JpdGUgb2JzZXJ2YXRpb25zIGhlcmU7IHRoZSBzdG9yZSBrZWVwc1xuLy8gb3JkZXJpbmcgKHNlcSksIGRyb3BzIGR1cGxpY2F0ZXMsIHJlZnVzZXMgc3RhbGUgb2JzZXJ2YXRpb25zIGFuZCBiYXRjaGVzIGRlbHRhcyBmb3IgdGhlIFVJcy5cbmltcG9ydCB7IGFwcGx5UGF0Y2gsIE1BWF9USU1FTElORSwgdHlwZSBFbnRpdHlQYXRjaCwgdHlwZSBGbG93RGVsdGEsIHR5cGUgRmxvd0V2ZW50LCB0eXBlIEZsb3dFdmVudEtpbmQsIHR5cGUgRmxvd1NuYXBzaG90IH0gZnJvbSAnLi4vLi4vc2hhcmVkL2V2ZW50cy50cydcbmltcG9ydCB7IEVNUFRZX0xBQkVMUywgZW1wdHlTdGF0ZSwgdHlwZSBBZ2VudFJlY29yZCwgdHlwZSBGbG93U3RhdGUsIHR5cGUgVGFza1JlY29yZCB9IGZyb20gJy4uLy4uL3NoYXJlZC9tb2RlbC50cydcblxudHlwZSBMaXN0ZW5lciA9IChkZWx0YTogRmxvd0RlbHRhKSA9PiB2b2lkXG5cbmV4cG9ydCB0eXBlIEV2ZW50SW5wdXQgPSBPbWl0PEZsb3dFdmVudCwgJ3NlcScgfCAnaWQnPiAmIHsgaWQ/OiBzdHJpbmcgfVxuXG5jb25zdCBERURVUEVfTElNSVQgPSA1MDAwXG5jb25zdCBTVEFURV9LRVlTID0gbmV3IFNldChbJ3N0YXRlJywgJ2xpdmUnLCAnb3V0Y29tZScsICdzdGF0ZVNpbmNlJywgJ2VuZGVkQXQnXSlcblxuZXhwb3J0IGNsYXNzIEZsb3dTdG9yZSB7XG4gIHByaXZhdGUgc3RhdGU6IEZsb3dTdGF0ZSA9IGVtcHR5U3RhdGUoKVxuICBwcml2YXRlIHRpbWVsaW5lOiBGbG93RXZlbnRbXSA9IFtdXG4gIHByaXZhdGUgcGVuZGluZ1BhdGNoZXMgPSBuZXcgTWFwPHN0cmluZywgRW50aXR5UGF0Y2g+KClcbiAgcHJpdmF0ZSBwZW5kaW5nRXZlbnRzOiBGbG93RXZlbnRbXSA9IFtdXG4gIHByaXZhdGUgcGVuZGluZ0Zyb21TZXEgPSAwXG4gIHByaXZhdGUgbGlzdGVuZXJzID0gbmV3IFNldDxMaXN0ZW5lcj4oKVxuICBwcml2YXRlIHNlZW5FdmVudElkcyA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIC8qKiBvYnNlcnZlZEF0IG9mIHRoZSBsYXN0IGFjY2VwdGVkIHN0YXRlIHBlciBhZ2VudCwgc28gYW4gb2xkZXIgcG9sbCBuZXZlciBvdmVyd3JpdGVzIGEgbmV3ZXIgZXZlbnQuICovXG4gIHByaXZhdGUgYWdlbnRPYnNlcnZlZEF0ID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKVxuICBwcml2YXRlIGZsdXNoVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcbiAgcHJpdmF0ZSBldmVudENvdW50ZXIgPSAwXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBmbHVzaE1zID0gMjUwKSB7fVxuXG4gIGdldCBzZXEoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZS5zZXFcbiAgfVxuXG4gIHJlYWQoKTogUmVhZG9ubHk8Rmxvd1N0YXRlPiB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgfVxuXG4gIHNuYXBzaG90KCk6IEZsb3dTbmFwc2hvdCB7XG4gICAgdGhpcy5mbHVzaE5vdygpXG4gICAgcmV0dXJuIHsgc3RhdGU6IHN0cnVjdHVyZWRDbG9uZSh0aGlzLnN0YXRlKSwgZXZlbnRzOiB0aGlzLnRpbWVsaW5lLnNsaWNlKC1NQVhfVElNRUxJTkUpIH1cbiAgfVxuXG4gIGV2ZW50cygpOiByZWFkb25seSBGbG93RXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMudGltZWxpbmVcbiAgfVxuXG4gIHN1YnNjcmliZShsaXN0ZW5lcjogTGlzdGVuZXIpOiAoKSA9PiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5hZGQobGlzdGVuZXIpXG4gICAgcmV0dXJuICgpID0+IHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcilcbiAgfVxuXG4gIC8qKiBSZXN0b3JlcyBhIHBlcnNpc3RlZCBzbmFwc2hvdDsgbGl2ZSBhZGFwdGVycyByZS1jb25maXJtIGV2ZXJ5dGhpbmcgYWZ0ZXJ3YXJkcy4gKi9cbiAgcmVzdG9yZShzbmFwc2hvdDogRmxvd1NuYXBzaG90KTogdm9pZCB7XG4gICAgY29uc3QgcmVzdG9yZWQgPSBzbmFwc2hvdC5zdGF0ZVxuICAgIGZvciAoY29uc3QgYWdlbnQgb2YgT2JqZWN0LnZhbHVlcyhyZXN0b3JlZC5hZ2VudHMpKSB7XG4gICAgICAvLyBOb3RoaW5nIHJlc3RvcmVkIGZyb20gZGlzayBjb3VudHMgYXMgbGl2ZSB1bnRpbCBydW50aW1lIGV2aWRlbmNlIHNheXMgc28gYWdhaW4uXG4gICAgICBhZ2VudC5saXZlID0gZmFsc2VcbiAgICAgIGlmIChhZ2VudC5zdGF0ZSA9PT0gJ3dvcmtpbmcnIHx8IGFnZW50LnN0YXRlID09PSAnYmxvY2tlZCcgfHwgYWdlbnQuc3RhdGUgPT09ICd3YWl0aW5nJykgYWdlbnQuc3RhdGUgPSAndW5rbm93bidcbiAgICB9XG4gICAgdGhpcy5zdGF0ZSA9IHsgLi4ucmVzdG9yZWQsIHByb2plY3RzOiByZXN0b3JlZC5wcm9qZWN0cyA/PyB7fSwgbGFiZWxzOiB7IC4uLkVNUFRZX0xBQkVMUywgLi4ucmVzdG9yZWQubGFiZWxzIH0sIHNlcTogTWF0aC5tYXgocmVzdG9yZWQuc2VxLCB0aGlzLnN0YXRlLnNlcSkgKyAxIH1cbiAgICB0aGlzLnRpbWVsaW5lID0gc25hcHNob3QuZXZlbnRzLnNsaWNlKC1NQVhfVElNRUxJTkUpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiB0aGlzLnRpbWVsaW5lKSB0aGlzLnNlZW5FdmVudElkcy5hZGQoZXZlbnQuaWQpXG4gICAgdGhpcy5lbWl0UmVzZXQoKVxuICB9XG5cbiAgLyoqIE1lcmdlcyBhbiBhZ2VudCBvYnNlcnZhdGlvbi4gYG9ic2VydmVkQXRgIG9yZGVycyBjb21wZXRpbmcgc291cmNlcy4gKi9cbiAgdXBzZXJ0QWdlbnQoaWQ6IHN0cmluZywgb2JzZXJ2ZWRBdDogbnVtYmVyLCBwYXJ0aWFsOiBQYXJ0aWFsPEFnZW50UmVjb3JkPiwgY3JlYXRlOiAoKSA9PiBBZ2VudFJlY29yZCk6IEFnZW50UmVjb3JkIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuc3RhdGUuYWdlbnRzW2lkXVxuICAgIGNvbnN0IGJhc2UgPSBleGlzdGluZyA/PyBjcmVhdGUoKVxuICAgIGNvbnN0IG5leHQ6IEFnZW50UmVjb3JkID0geyAuLi5iYXNlIH1cbiAgICBjb25zdCB0b3VjaGVzU3RhdGUgPSBPYmplY3Qua2V5cyhwYXJ0aWFsKS5zb21lKChrZXkpID0+IFNUQVRFX0tFWVMuaGFzKGtleSkgJiYgcGFydGlhbFtrZXkgYXMga2V5b2YgQWdlbnRSZWNvcmRdICE9PSB1bmRlZmluZWQpXG4gICAgY29uc3QgbGFzdE9ic2VydmVkID0gdGhpcy5hZ2VudE9ic2VydmVkQXQuZ2V0KGlkKSA/PyAwXG4gICAgLy8gUnVudGltZSBzdGF0ZSBpcyBvcmRlcmVkIGJ5IG9ic2VydmF0aW9uIHRpbWU6IGFuIG9sZGVyIHBvbGwgbmV2ZXIgb3ZlcndyaXRlcyBhIG5ld2VyIGV2ZW50LlxuICAgIGNvbnN0IHN0YWxlID0gdG91Y2hlc1N0YXRlICYmIG9ic2VydmVkQXQgPCBsYXN0T2JzZXJ2ZWRcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwYXJ0aWFsKSBhcyBba2V5b2YgQWdlbnRSZWNvcmQsIHVua25vd25dW10pIHtcbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IGtleSA9PT0gJ2V2aWRlbmNlJykgY29udGludWVcbiAgICAgIGlmIChzdGFsZSAmJiBTVEFURV9LRVlTLmhhcyhrZXkpKSBjb250aW51ZVxuICAgICAgOyhuZXh0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtrZXldID0gdmFsdWVcbiAgICB9XG4gICAgaWYgKHBhcnRpYWwuZXZpZGVuY2UpIG5leHQuZXZpZGVuY2UgPSBbLi4ubmV3IFNldChbLi4uKGJhc2UuZXZpZGVuY2UgPz8gW10pLCAuLi5wYXJ0aWFsLmV2aWRlbmNlXSldXG4gICAgbmV4dC5sYXN0U2VlbkF0ID0gTWF0aC5tYXgoYmFzZS5sYXN0U2VlbkF0ID8/IDAsIG9ic2VydmVkQXQpXG4gICAgaWYgKHRvdWNoZXNTdGF0ZSAmJiAhc3RhbGUpIHRoaXMuYWdlbnRPYnNlcnZlZEF0LnNldChpZCwgb2JzZXJ2ZWRBdClcbiAgICBpZiAoZXhpc3RpbmcgJiYgc2FtZVJlY29yZChleGlzdGluZywgbmV4dCkpIHJldHVybiBleGlzdGluZ1xuICAgIG5leHQudmVyc2lvbiA9IChiYXNlLnZlcnNpb24gPz8gMCkgKyAxXG4gICAgdGhpcy5wYXRjaCh7IGVudGl0eTogJ2FnZW50JywgaWQsIHZhbHVlOiBuZXh0IH0pXG4gICAgcmV0dXJuIG5leHRcbiAgfVxuXG4gIHVwc2VydFRhc2sodGFzazogVGFza1JlY29yZCk6IFRhc2tSZWNvcmQge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5zdGF0ZS50YXNrc1t0YXNrLmlkXVxuICAgIGlmIChleGlzdGluZyAmJiBzYW1lUmVjb3JkKGV4aXN0aW5nLCB7IC4uLnRhc2ssIHZlcnNpb246IGV4aXN0aW5nLnZlcnNpb24gfSkpIHJldHVybiBleGlzdGluZ1xuICAgIGNvbnN0IG5leHQgPSB7IC4uLnRhc2ssIHZlcnNpb246IChleGlzdGluZz8udmVyc2lvbiA/PyAwKSArIDEgfVxuICAgIHRoaXMucGF0Y2goeyBlbnRpdHk6ICd0YXNrJywgaWQ6IHRhc2suaWQsIHZhbHVlOiBuZXh0IH0pXG4gICAgcmV0dXJuIG5leHRcbiAgfVxuXG4gIC8qKiBHZW5lcmljIHVwc2VydCBmb3IgcmVjb3JkcyBjb21wYXJlZCBieSBjb250ZW50LiAqL1xuICBwdXQocGF0Y2g6IEVudGl0eVBhdGNoKTogdm9pZCB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMuY3VycmVudFZhbHVlKHBhdGNoKVxuICAgIGlmIChjdXJyZW50ICE9PSB1bmRlZmluZWQgJiYgcGF0Y2gudmFsdWUgIT09IG51bGwgJiYgc2FtZVJlY29yZChjdXJyZW50LCBwYXRjaC52YWx1ZSkpIHJldHVyblxuICAgIGlmIChjdXJyZW50ID09PSB1bmRlZmluZWQgJiYgcGF0Y2gudmFsdWUgPT09IG51bGwpIHJldHVyblxuICAgIHRoaXMucGF0Y2gocGF0Y2gpXG4gIH1cblxuICByZW1vdmVBZ2VudChpZDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnN0YXRlLmFnZW50c1tpZF0pIHJldHVyblxuICAgIHRoaXMuYWdlbnRPYnNlcnZlZEF0LmRlbGV0ZShpZClcbiAgICB0aGlzLnBhdGNoKHsgZW50aXR5OiAnYWdlbnQnLCBpZCwgdmFsdWU6IG51bGwgfSlcbiAgfVxuXG4gIGVtaXQoaW5wdXQ6IEV2ZW50SW5wdXQpOiBGbG93RXZlbnQgfCBudWxsIHtcbiAgICBjb25zdCBpZCA9IGlucHV0LmlkID8/IGAke2lucHV0LmtpbmR9OiR7aW5wdXQuZW50aXR5SWR9OiR7aW5wdXQudHN9OiR7Kyt0aGlzLmV2ZW50Q291bnRlcn1gXG4gICAgaWYgKHRoaXMuc2VlbkV2ZW50SWRzLmhhcyhpZCkpIHJldHVybiBudWxsXG4gICAgdGhpcy5zZWVuRXZlbnRJZHMuYWRkKGlkKVxuICAgIGlmICh0aGlzLnNlZW5FdmVudElkcy5zaXplID4gREVEVVBFX0xJTUlUKSB7XG4gICAgICBjb25zdCBmaXJzdCA9IHRoaXMuc2VlbkV2ZW50SWRzLnZhbHVlcygpLm5leHQoKS52YWx1ZVxuICAgICAgaWYgKGZpcnN0ICE9PSB1bmRlZmluZWQpIHRoaXMuc2VlbkV2ZW50SWRzLmRlbGV0ZShmaXJzdClcbiAgICB9XG4gICAgY29uc3QgZXZlbnQ6IEZsb3dFdmVudCA9IHsgLi4uaW5wdXQsIGlkLCBzZXE6IHRoaXMuYnVtcFNlcSgpIH1cbiAgICB0aGlzLnRpbWVsaW5lLnB1c2goZXZlbnQpXG4gICAgaWYgKHRoaXMudGltZWxpbmUubGVuZ3RoID4gTUFYX1RJTUVMSU5FICogMikgdGhpcy50aW1lbGluZS5zcGxpY2UoMCwgdGhpcy50aW1lbGluZS5sZW5ndGggLSBNQVhfVElNRUxJTkUpXG4gICAgdGhpcy5wZW5kaW5nRXZlbnRzLnB1c2goZXZlbnQpXG4gICAgdGhpcy5zY2hlZHVsZUZsdXNoKClcbiAgICByZXR1cm4gZXZlbnRcbiAgfVxuXG4gIGhhc0V2ZW50KGtpbmQ6IEZsb3dFdmVudEtpbmQsIGVudGl0eUlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy50aW1lbGluZS5zb21lKChldmVudCkgPT4gZXZlbnQua2luZCA9PT0ga2luZCAmJiBldmVudC5lbnRpdHlJZCA9PT0gZW50aXR5SWQpXG4gIH1cblxuICBmbHVzaE5vdygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5mbHVzaFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5mbHVzaFRpbWVyKVxuICAgICAgdGhpcy5mbHVzaFRpbWVyID0gbnVsbFxuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0Y2hlcy5zaXplID09PSAwICYmIHRoaXMucGVuZGluZ0V2ZW50cy5sZW5ndGggPT09IDApIHJldHVyblxuICAgIGNvbnN0IGRlbHRhOiBGbG93RGVsdGEgPSB7XG4gICAgICBmcm9tU2VxOiB0aGlzLnBlbmRpbmdGcm9tU2VxLFxuICAgICAgdG9TZXE6IHRoaXMuc3RhdGUuc2VxLFxuICAgICAgcGF0Y2hlczogWy4uLnRoaXMucGVuZGluZ1BhdGNoZXMudmFsdWVzKCldLFxuICAgICAgZXZlbnRzOiB0aGlzLnBlbmRpbmdFdmVudHNcbiAgICB9XG4gICAgdGhpcy5wZW5kaW5nUGF0Y2hlcyA9IG5ldyBNYXAoKVxuICAgIHRoaXMucGVuZGluZ0V2ZW50cyA9IFtdXG4gICAgdGhpcy5wZW5kaW5nRnJvbVNlcSA9IHRoaXMuc3RhdGUuc2VxXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmxpc3RlbmVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIoZGVsdGEpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gb25lIGJyb2tlbiBsaXN0ZW5lciBtdXN0IG5vdCBzdG9wIHRoZSBvdGhlcnNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBkaXNwb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmZsdXNoVGltZXIpIGNsZWFyVGltZW91dCh0aGlzLmZsdXNoVGltZXIpXG4gICAgdGhpcy5saXN0ZW5lcnMuY2xlYXIoKVxuICB9XG5cbiAgcHJpdmF0ZSBwYXRjaChwYXRjaDogRW50aXR5UGF0Y2gpOiB2b2lkIHtcbiAgICBhcHBseVBhdGNoKHRoaXMuc3RhdGUsIHBhdGNoKVxuICAgIHRoaXMuYnVtcFNlcSgpXG4gICAgdGhpcy5wZW5kaW5nUGF0Y2hlcy5zZXQoYCR7cGF0Y2guZW50aXR5fToke3BhdGNoLmlkfWAsIHBhdGNoKVxuICAgIHRoaXMuc2NoZWR1bGVGbHVzaCgpXG4gIH1cblxuICBwcml2YXRlIGJ1bXBTZXEoKTogbnVtYmVyIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0Y2hlcy5zaXplID09PSAwICYmIHRoaXMucGVuZGluZ0V2ZW50cy5sZW5ndGggPT09IDAgJiYgIXRoaXMuZmx1c2hUaW1lcikgdGhpcy5wZW5kaW5nRnJvbVNlcSA9IHRoaXMuc3RhdGUuc2VxXG4gICAgdGhpcy5zdGF0ZS5zZXEgKz0gMVxuICAgIHRoaXMuc3RhdGUuZ2VuZXJhdGVkQXQgPSBEYXRlLm5vdygpXG4gICAgcmV0dXJuIHRoaXMuc3RhdGUuc2VxXG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlRmx1c2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZmx1c2hUaW1lcikgcmV0dXJuXG4gICAgdGhpcy5mbHVzaFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLmZsdXNoVGltZXIgPSBudWxsXG4gICAgICB0aGlzLmZsdXNoTm93KClcbiAgICB9LCB0aGlzLmZsdXNoTXMpXG4gIH1cblxuICAvKiogVGVsbHMgZXZlcnkgY2xpZW50IHRvIHJlLXNuYXBzaG90IChmcm9tU2VxIHRoYXQgY2FuIG5ldmVyIG1hdGNoKS4gKi9cbiAgcHJpdmF0ZSBlbWl0UmVzZXQoKTogdm9pZCB7XG4gICAgY29uc3QgZGVsdGE6IEZsb3dEZWx0YSA9IHsgZnJvbVNlcTogLTEsIHRvU2VxOiB0aGlzLnN0YXRlLnNlcSwgcGF0Y2hlczogW10sIGV2ZW50czogW10gfVxuICAgIHRoaXMucGVuZGluZ0Zyb21TZXEgPSB0aGlzLnN0YXRlLnNlcVxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5saXN0ZW5lcnMpIGxpc3RlbmVyKGRlbHRhKVxuICB9XG5cbiAgcHJpdmF0ZSBjdXJyZW50VmFsdWUocGF0Y2g6IEVudGl0eVBhdGNoKTogdW5rbm93biB7XG4gICAgc3dpdGNoIChwYXRjaC5lbnRpdHkpIHtcbiAgICAgIGNhc2UgJ2FnZW50JzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUuYWdlbnRzW3BhdGNoLmlkXVxuICAgICAgY2FzZSAndGFzayc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLnRhc2tzW3BhdGNoLmlkXVxuICAgICAgY2FzZSAncnVuJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUucnVuc1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ2dhdGUnOlxuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZS5nYXRlc1twYXRjaC5pZF1cbiAgICAgIGNhc2UgJ3dvcmt0cmVlJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUud29ya3RyZWVzW3BhdGNoLmlkXVxuICAgICAgY2FzZSAnYWNjb3VudCc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLmFjY291bnRzW3BhdGNoLmlkXVxuICAgICAgY2FzZSAncHJvamVjdCc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLnByb2plY3RzPy5bcGF0Y2guaWRdXG4gICAgICBjYXNlICdtZXNzYWdlJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUubWVzc2FnZXMuZmluZCgobWVzc2FnZSkgPT4gbWVzc2FnZS5pZCA9PT0gcGF0Y2guaWQpXG4gICAgICBjYXNlICd0b29sQ2FsbCc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLnRvb2xDYWxscy5maW5kKChjYWxsKSA9PiBjYWxsLmlkID09PSBwYXRjaC5pZClcbiAgICAgIGNhc2UgJ2NhcGFiaWxpdGllcyc6XG4gICAgICAgIHJldHVybiB0aGlzLnN0YXRlLmNhcGFiaWxpdGllc1xuICAgICAgY2FzZSAnbGFiZWxzJzpcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGUubGFiZWxzXG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHNhbWVSZWNvcmQoYTogdW5rbm93biwgYjogdW5rbm93bik6IGJvb2xlYW4ge1xuICBjb25zdCBzdHJpcCA9ICh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgY29uc3QgeyB2ZXJzaW9uOiBfdmVyc2lvbiwgbGFzdFNlZW5BdDogX2xhc3RTZWVuLCAuLi5yZXN0IH0gPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgICAgcmV0dXJuIHJlc3RcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHN0cmlwKGEpKSA9PT0gSlNPTi5zdHJpbmdpZnkoc3RyaXAoYikpXG59XG4iLCAiLy8gS25vd3Mgd2hldGhlciBhbnlvbmUgaXMgbG9va2luZyBhdCBBZ2VudCBGbG93LCBzbyBiYWNrZ3JvdW5kIHNjYW5zIGNhbiBzbG93IGRvd24gd2hlbiBub2JvZHkgaXMuXG4vLyBFdmVyeSByZXF1ZXN0IGZyb20gYSBwYW5lbCBvciB0aGUgZGFzaGJvYXJkIGNvdW50czsgdmlzaWJsZSBVSXMgYWxzbyBwaW5nICh2aWV3ZXIucGluZykuXG5cbi8qKiBObyByZXF1ZXN0IGZvciB0aGlzIGxvbmcgbWVhbnMgbm9ib2R5IGlzIHdhdGNoaW5nLiBVSXMgcGluZyBldmVyeSAzMCBzIHdoaWxlIHZpc2libGUuICovXG5leHBvcnQgY29uc3QgVklFV0VSX0lETEVfTVMgPSA3NV8wMDBcblxuZXhwb3J0IGNsYXNzIFZpZXdlclRyYWNrZXIge1xuICBwcml2YXRlIGxhc3RTZWVuID0gTnVtYmVyLk5FR0FUSVZFX0lORklOSVRZXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGlkbGVBZnRlck1zID0gVklFV0VSX0lETEVfTVNcbiAgKSB7fVxuXG4gIC8qKiBSZWNvcmRzIGFjdGl2aXR5LiBSZXR1cm5zIHRydWUgd2hlbiB0aGlzIGVuZHMgYW4gaWRsZSBzdHJldGNoICh0aW1lIHRvIHJlZnJlc2ggcmlnaHQgYXdheSkuICovXG4gIHRvdWNoKCk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHdhc0lkbGUgPSB0aGlzLmlkbGVcbiAgICB0aGlzLmxhc3RTZWVuID0gdGhpcy5ub3coKVxuICAgIHJldHVybiB3YXNJZGxlXG4gIH1cblxuICBnZXQgaWRsZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKSAtIHRoaXMubGFzdFNlZW4gPiB0aGlzLmlkbGVBZnRlck1zXG4gIH1cblxuICAvKiogVGhlIGZhc3QgaW50ZXJ2YWwgd2hpbGUgd2F0Y2hlZCwgdGhlIHNsb3cgb25lIG90aGVyd2lzZS4gKi9cbiAgcGFjZSh3YXRjaGVkTXM6IG51bWJlciwgaWRsZU1zOiBudW1iZXIpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmlkbGUgPyBpZGxlTXMgOiB3YXRjaGVkTXNcbiAgfVxufVxuIiwgIi8vIExpdmUgb3V0cHV0OiB3YXRjaGVzIHRoZSB0cmFuc2NyaXB0IGZpbGUgb2YgZWFjaCBjb252ZXJzYXRpb24gc29tZW9uZSBoYXMgb3BlbiBhbmQgc2F5cyB3aGVuXG4vLyBpdCBjaGFuZ2VzLCBzbyB2aWV3cyBmZXRjaCByaWdodCBhd2F5IGluc3RlYWQgb2YgcG9sbGluZy4gT25seSBmaWxlcyBhIHZpZXcgcmVhZCByZWNlbnRseSBhcmVcbi8vIHdhdGNoZWQsIGEgZmV3IGF0IG1vc3QsIGFuZCBhIHdhdGNoIGVuZHMgYnkgaXRzZWxmIG9uY2Ugbm9ib2R5IGhhcyByZWFkIGl0IGZvciBhIG1pbnV0ZS5cbmltcG9ydCB7IHdhdGNoLCB0eXBlIEZTV2F0Y2hlciB9IGZyb20gJ25vZGU6ZnMnXG5cbnR5cGUgV2F0Y2ggPSB7IHBhdGg6IHN0cmluZzsgd2F0Y2hlcjogRlNXYXRjaGVyOyBsYXN0UmVhZDogbnVtYmVyOyB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsIH1cblxuZXhwb3J0IHR5cGUgV2F0Y2hGYWN0b3J5ID0gKHBhdGg6IHN0cmluZywgb25DaGFuZ2U6ICgpID0+IHZvaWQpID0+IEZTV2F0Y2hlclxuXG5jb25zdCBub2RlV2F0Y2g6IFdhdGNoRmFjdG9yeSA9IChwYXRoLCBvbkNoYW5nZSkgPT4gd2F0Y2gocGF0aCwgeyBwZXJzaXN0ZW50OiBmYWxzZSB9LCBvbkNoYW5nZSlcblxuZXhwb3J0IGNsYXNzIE91dHB1dFdhdGNoZXIge1xuICBwcml2YXRlIHdhdGNoZXMgPSBuZXcgTWFwPHN0cmluZywgV2F0Y2g+KClcbiAgcHJpdmF0ZSBsaXN0ZW5lcnMgPSBuZXcgU2V0PChhZ2VudElkOiBzdHJpbmcpID0+IHZvaWQ+KClcbiAgLyoqIEFnZW50cyB3aXRob3V0IGEgdHJhbnNjcmlwdCBmaWxlICh0ZXJtaW5hbCBvdXRwdXQpOiB3aGVuIGEgdmlldyBsYXN0IHJlYWQgdGhlbS4gKi9cbiAgcHJpdmF0ZSBpbnRlcmVzdGVkID0gbmV3IE1hcDxzdHJpbmcsIHsgbGFzdFJlYWQ6IG51bWJlcjsgdGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCB9PigpXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiB7IG5vdz86ICgpID0+IG51bWJlcjsgaWRsZU1zPzogbnVtYmVyOyBtYXg/OiBudW1iZXI7IGRlYm91bmNlTXM/OiBudW1iZXI7IHdhdGNoRmlsZT86IFdhdGNoRmFjdG9yeSB9ID0ge31cbiAgKSB7fVxuXG4gIHByaXZhdGUgZ2V0IG5vdygpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLm5vdyA/PyBEYXRlLm5vd1xuICB9XG5cbiAgLyoqIEEgdmlldyByZWFkIHRoaXMgYWdlbnQncyB0cmFuc2NyaXB0LiBSZXR1cm5zIHRydWUgd2hlbiBjaGFuZ2VzIHdpbGwgYmUgcHVzaGVkLiAqL1xuICB0cmFjayhhZ2VudElkOiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMubm93KClcbiAgICB0aGlzLnN3ZWVwKG5vdylcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMud2F0Y2hlcy5nZXQoYWdlbnRJZClcbiAgICBpZiAoZXhpc3RpbmcgJiYgZXhpc3RpbmcucGF0aCA9PT0gcGF0aCkge1xuICAgICAgZXhpc3RpbmcubGFzdFJlYWQgPSBub3dcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICAgIGlmIChleGlzdGluZykgdGhpcy51bnRyYWNrKGFnZW50SWQpXG4gICAgY29uc3QgbWF4ID0gdGhpcy5vcHRpb25zLm1heCA/PyA4XG4gICAgd2hpbGUgKHRoaXMud2F0Y2hlcy5zaXplID49IG1heCkge1xuICAgICAgY29uc3Qgb2xkZXN0ID0gWy4uLnRoaXMud2F0Y2hlcy5lbnRyaWVzKCldLnNvcnQoKGEsIGIpID0+IGFbMV0ubGFzdFJlYWQgLSBiWzFdLmxhc3RSZWFkKVswXVxuICAgICAgdGhpcy51bnRyYWNrKG9sZGVzdFswXSlcbiAgICB9XG4gICAgbGV0IHdhdGNoZXI6IEZTV2F0Y2hlclxuICAgIHRyeSB7XG4gICAgICB3YXRjaGVyID0gKHRoaXMub3B0aW9ucy53YXRjaEZpbGUgPz8gbm9kZVdhdGNoKShwYXRoLCAoKSA9PiB0aGlzLmNoYW5nZWQoYWdlbnRJZCkpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgd2F0Y2hlci5vbj8uKCdlcnJvcicsICgpID0+IHRoaXMudW50cmFjayhhZ2VudElkKSlcbiAgICB0aGlzLndhdGNoZXMuc2V0KGFnZW50SWQsIHsgcGF0aCwgd2F0Y2hlciwgbGFzdFJlYWQ6IG5vdywgdGltZXI6IG51bGwgfSlcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqIEEgdmlldyByZWFkIG91dHB1dCB0aGF0IGhhcyBubyBmaWxlIHRvIHdhdGNoIChhIHRlcm1pbmFsKTsgZXZlbnRzIGNhbiBzdGlsbCBhbm5vdW5jZSBjaGFuZ2VzLiAqL1xuICBub3RlSW50ZXJlc3QoYWdlbnRJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmludGVyZXN0ZWQuZ2V0KGFnZW50SWQpXG4gICAgaWYgKGVudHJ5KSBlbnRyeS5sYXN0UmVhZCA9IHRoaXMubm93KClcbiAgICBlbHNlIHRoaXMuaW50ZXJlc3RlZC5zZXQoYWdlbnRJZCwgeyBsYXN0UmVhZDogdGhpcy5ub3coKSwgdGltZXI6IG51bGwgfSlcbiAgICBpZiAodGhpcy5pbnRlcmVzdGVkLnNpemUgPiAodGhpcy5vcHRpb25zLm1heCA/PyA4KSAqIDQpIHtcbiAgICAgIGNvbnN0IG9sZGVzdCA9IFsuLi50aGlzLmludGVyZXN0ZWQuZW50cmllcygpXS5zb3J0KChhLCBiKSA9PiBhWzFdLmxhc3RSZWFkIC0gYlsxXS5sYXN0UmVhZClbMF1cbiAgICAgIHRoaXMuZHJvcEludGVyZXN0KG9sZGVzdFswXSlcbiAgICB9XG4gIH1cblxuICAvKiogU29tZXRoaW5nIGhhcHBlbmVkIHRvIHRoaXMgYWdlbnQgKHN0YXR1cyBjaGFuZ2UsIHRvb2wgY2FsbCk6IHRlbGwgdmlld3Mgc2hvd2luZyBpdC4gKi9cbiAgcG9rZShhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW50ZXJlc3RlZC5nZXQoYWdlbnRJZClcbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cbiAgICBpZiAodGhpcy5ub3coKSAtIGVudHJ5Lmxhc3RSZWFkID4gKHRoaXMub3B0aW9ucy5pZGxlTXMgPz8gNjBfMDAwKSkge1xuICAgICAgdGhpcy5kcm9wSW50ZXJlc3QoYWdlbnRJZClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoZW50cnkudGltZXIpIHJldHVyblxuICAgIGVudHJ5LnRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBlbnRyeS50aW1lciA9IG51bGxcbiAgICAgIGlmICghdGhpcy5pbnRlcmVzdGVkLmhhcyhhZ2VudElkKSkgcmV0dXJuXG4gICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMubGlzdGVuZXJzKSBsaXN0ZW5lcihhZ2VudElkKVxuICAgIH0sIHRoaXMub3B0aW9ucy5kZWJvdW5jZU1zID8/IDI1MClcbiAgfVxuXG4gIHByaXZhdGUgZHJvcEludGVyZXN0KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbnRlcmVzdGVkLmdldChhZ2VudElkKVxuICAgIGlmIChlbnRyeT8udGltZXIpIGNsZWFyVGltZW91dChlbnRyeS50aW1lcilcbiAgICB0aGlzLmludGVyZXN0ZWQuZGVsZXRlKGFnZW50SWQpXG4gIH1cblxuICBzdWJzY3JpYmUobGlzdGVuZXI6IChhZ2VudElkOiBzdHJpbmcpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5hZGQobGlzdGVuZXIpXG4gICAgcmV0dXJuICgpID0+IHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcilcbiAgfVxuXG4gIGdldCBzaXplKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMud2F0Y2hlcy5zaXplXG4gIH1cblxuICBkaXNwb3NlKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgaWQgb2YgWy4uLnRoaXMud2F0Y2hlcy5rZXlzKCldKSB0aGlzLnVudHJhY2soaWQpXG4gICAgZm9yIChjb25zdCBpZCBvZiBbLi4udGhpcy5pbnRlcmVzdGVkLmtleXMoKV0pIHRoaXMuZHJvcEludGVyZXN0KGlkKVxuICAgIHRoaXMubGlzdGVuZXJzLmNsZWFyKClcbiAgfVxuXG4gIHByaXZhdGUgY2hhbmdlZChhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMud2F0Y2hlcy5nZXQoYWdlbnRJZClcbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cbiAgICBpZiAodGhpcy5ub3coKSAtIGVudHJ5Lmxhc3RSZWFkID4gKHRoaXMub3B0aW9ucy5pZGxlTXMgPz8gNjBfMDAwKSkge1xuICAgICAgdGhpcy51bnRyYWNrKGFnZW50SWQpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgLy8gQSByZXBseSBhcnJpdmVzIGFzIG1hbnkgc21hbGwgYXBwZW5kczogdGVsbCB2aWV3cyBvbmNlIHBlciBidXJzdC5cbiAgICBpZiAoZW50cnkudGltZXIpIHJldHVyblxuICAgIGVudHJ5LnRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBlbnRyeS50aW1lciA9IG51bGxcbiAgICAgIGlmICghdGhpcy53YXRjaGVzLmhhcyhhZ2VudElkKSkgcmV0dXJuXG4gICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMubGlzdGVuZXJzKSBsaXN0ZW5lcihhZ2VudElkKVxuICAgIH0sIHRoaXMub3B0aW9ucy5kZWJvdW5jZU1zID8/IDI1MClcbiAgfVxuXG4gIHByaXZhdGUgc3dlZXAobm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBpZGxlTXMgPSB0aGlzLm9wdGlvbnMuaWRsZU1zID8/IDYwXzAwMFxuICAgIGZvciAoY29uc3QgW2lkLCBlbnRyeV0gb2YgdGhpcy53YXRjaGVzKSBpZiAobm93IC0gZW50cnkubGFzdFJlYWQgPiBpZGxlTXMpIHRoaXMudW50cmFjayhpZClcbiAgfVxuXG4gIHByaXZhdGUgdW50cmFjayhhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMud2F0Y2hlcy5nZXQoYWdlbnRJZClcbiAgICBpZiAoIWVudHJ5KSByZXR1cm5cbiAgICBpZiAoZW50cnkudGltZXIpIGNsZWFyVGltZW91dChlbnRyeS50aW1lcilcbiAgICB0cnkge1xuICAgICAgZW50cnkud2F0Y2hlci5jbG9zZSgpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBhbHJlYWR5IGNsb3NlZFxuICAgIH1cbiAgICB0aGlzLndhdGNoZXMuZGVsZXRlKGFnZW50SWQpXG4gIH1cbn1cbiIsICIvLyBBIG9uY2UtaW4tYS13aGlsZSBcInN0YXIgdGhlIHByb2plY3Qgb24gR2l0SHViXCIgcHJvbXB0LiBTaG93biBvbmx5IGFmdGVyIHJlYWwgdXNlICh0aHJlZSBkaWZmZXJlbnRcbi8vIGRheXMsIGF0IGxlYXN0IHRocmVlIGRheXMgYWZ0ZXIgZmlyc3Qgb3BlbmluZyksIG5ldmVyIHR3aWNlIGluIGEgcm93LCBhbmQgbmV2ZXIgYWdhaW4gb25jZSB0aGVcbi8vIHBlcnNvbiBzdGFycmVkIGl0IG9yIHNhaWQgbm8uIEtlcHQgaW4gdGhlIHBsdWdpbidzIG93biBzdGF0ZSBmb2xkZXIsIHNoYXJlZCBieSBldmVyeSB2aWV3LlxuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCByZW5hbWUsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5leHBvcnQgY29uc3QgU1RBUl9SRVBPX1VSTCA9ICdodHRwczovL2dpdGh1Yi5jb20vU29rcGlzZXRoTmhvZXVuL2FnZW50LWZsb3cnXG5jb25zdCBEQVlfTVMgPSAyNCAqIDYwICogNjAgKiAxMDAwXG5jb25zdCBNSU5fREFZU19VU0VEID0gM1xuY29uc3QgTUlOX0FHRV9NUyA9IDMgKiBEQVlfTVNcbmNvbnN0IFNOT09aRV9NUyA9IDMwICogREFZX01TXG5cbmV4cG9ydCB0eXBlIFN0YXJBbnN3ZXIgPSAnc3RhcnJlZCcgfCAnbGF0ZXInIHwgJ25ldmVyJ1xuZXhwb3J0IHR5cGUgU3RhclN0YXRlID0geyBmaXJzdFNlZW46IG51bWJlcjsgZGF5czogc3RyaW5nW107IHNub296ZVVudGlsOiBudW1iZXI7IGRvbmU6IGJvb2xlYW4gfVxuXG5leHBvcnQgY29uc3QgZnJlc2hTdGFyU3RhdGUgPSAobm93OiBudW1iZXIpOiBTdGFyU3RhdGUgPT4gKHsgZmlyc3RTZWVuOiBub3csIGRheXM6IFtdLCBzbm9vemVVbnRpbDogMCwgZG9uZTogZmFsc2UgfSlcblxuLyoqIExvY2FsIGNhbGVuZGFyIGRheSwgc28gYSBsYXRlLW5pZ2h0IHNlc3Npb24gYW5kIHRoZSBuZXh0IG1vcm5pbmcgY291bnQgYXMgdHdvIGRheXMuICovXG5leHBvcnQgZnVuY3Rpb24gZGF5T2Yobm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBkID0gbmV3IERhdGUobm93KVxuICByZXR1cm4gYCR7ZC5nZXRGdWxsWWVhcigpfS0ke1N0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpfS0ke1N0cmluZyhkLmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKX1gXG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRWaXNpdChzdGF0ZTogU3RhclN0YXRlLCBub3c6IG51bWJlcik6IFN0YXJTdGF0ZSB7XG4gIGNvbnN0IGRheSA9IGRheU9mKG5vdylcbiAgcmV0dXJuIHN0YXRlLmRheXMuaW5jbHVkZXMoZGF5KSA/IHN0YXRlIDogeyAuLi5zdGF0ZSwgZGF5czogWy4uLnN0YXRlLmRheXMsIGRheV0uc2xpY2UoLTEwKSB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRBc2soc3RhdGU6IFN0YXJTdGF0ZSwgbm93OiBudW1iZXIpOiBib29sZWFuIHtcbiAgcmV0dXJuICFzdGF0ZS5kb25lICYmIG5vdyA+PSBzdGF0ZS5zbm9vemVVbnRpbCAmJiBzdGF0ZS5kYXlzLmxlbmd0aCA+PSBNSU5fREFZU19VU0VEICYmIG5vdyAtIHN0YXRlLmZpcnN0U2VlbiA+PSBNSU5fQUdFX01TXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseUFuc3dlcihzdGF0ZTogU3RhclN0YXRlLCBhbnN3ZXI6IFN0YXJBbnN3ZXIsIG5vdzogbnVtYmVyKTogU3RhclN0YXRlIHtcbiAgcmV0dXJuIGFuc3dlciA9PT0gJ2xhdGVyJyA/IHsgLi4uc3RhdGUsIHNub296ZVVudGlsOiBub3cgKyBTTk9PWkVfTVMgfSA6IHsgLi4uc3RhdGUsIGRvbmU6IHRydWUgfVxufVxuXG5leHBvcnQgY2xhc3MgU3RhclByb21wdFN0b3JlIHtcbiAgcHJpdmF0ZSBzdGF0ZTogU3RhclN0YXRlIHwgbnVsbCA9IG51bGxcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlOiBzdHJpbmdcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGRpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXIgPSBEYXRlLm5vd1xuICApIHtcbiAgICB0aGlzLmZpbGUgPSBqb2luKGRpciwgJ3N0YXItcHJvbXB0Lmpzb24nKVxuICB9XG5cbiAgLyoqIFJlY29yZHMgdG9kYXkncyB2aXNpdCBhbmQgc2F5cyB3aGV0aGVyIHRvIHNob3cgdGhlIHByb21wdCBub3cuICovXG4gIGFzeW5jIHZpc2l0KCk6IFByb21pc2U8eyBzaG93OiBib29sZWFuOyB1cmw6IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc3RhdGUgPSByZWNvcmRWaXNpdChhd2FpdCB0aGlzLmxvYWQoKSwgdGhpcy5ub3coKSlcbiAgICBhd2FpdCB0aGlzLnNhdmUoc3RhdGUpXG4gICAgcmV0dXJuIHsgc2hvdzogc2hvdWxkQXNrKHN0YXRlLCB0aGlzLm5vdygpKSwgdXJsOiBTVEFSX1JFUE9fVVJMIH1cbiAgfVxuXG4gIGFzeW5jIGFuc3dlcihhbnN3ZXI6IFN0YXJBbnN3ZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmUoYXBwbHlBbnN3ZXIoYXdhaXQgdGhpcy5sb2FkKCksIGFuc3dlciwgdGhpcy5ub3coKSkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWQoKTogUHJvbWlzZTxTdGFyU3RhdGU+IHtcbiAgICBpZiAodGhpcy5zdGF0ZSkgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmF3ID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZSh0aGlzLmZpbGUsICd1dGY4JykpIGFzIFBhcnRpYWw8U3RhclN0YXRlPlxuICAgICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgICAgZmlyc3RTZWVuOiB0eXBlb2YgcmF3LmZpcnN0U2VlbiA9PT0gJ251bWJlcicgPyByYXcuZmlyc3RTZWVuIDogdGhpcy5ub3coKSxcbiAgICAgICAgZGF5czogQXJyYXkuaXNBcnJheShyYXcuZGF5cykgPyByYXcuZGF5cy5maWx0ZXIoKGQpOiBkIGlzIHN0cmluZyA9PiB0eXBlb2YgZCA9PT0gJ3N0cmluZycpLnNsaWNlKC0xMCkgOiBbXSxcbiAgICAgICAgc25vb3plVW50aWw6IHR5cGVvZiByYXcuc25vb3plVW50aWwgPT09ICdudW1iZXInID8gcmF3LnNub296ZVVudGlsIDogMCxcbiAgICAgICAgZG9uZTogcmF3LmRvbmUgPT09IHRydWVcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuc3RhdGUgPSBmcmVzaFN0YXJTdGF0ZSh0aGlzLm5vdygpKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlKHN0YXRlOiBTdGFyU3RhdGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoSlNPTi5zdHJpbmdpZnkoc3RhdGUpID09PSBKU09OLnN0cmluZ2lmeSh0aGlzLnN0YXRlKSAmJiB0aGlzLnN0YXRlKSByZXR1cm5cbiAgICB0aGlzLnN0YXRlID0gc3RhdGVcbiAgICBhd2FpdCBta2Rpcih0aGlzLmRpciwgeyByZWN1cnNpdmU6IHRydWUsIG1vZGU6IDBvNzAwIH0pXG4gICAgY29uc3QgdG1wID0gYCR7dGhpcy5maWxlfS4ke3Byb2Nlc3MucGlkfS50bXBgXG4gICAgYXdhaXQgd3JpdGVGaWxlKHRtcCwgSlNPTi5zdHJpbmdpZnkoc3RhdGUpLCB7IG1vZGU6IDBvNjAwIH0pXG4gICAgYXdhaXQgcmVuYW1lKHRtcCwgdGhpcy5maWxlKVxuICB9XG59XG4iLCAiLy8gXCJBIG5ldyB2ZXJzaW9uIG9mIEFnZW50IEZsb3cgaXMgYXZhaWxhYmxlXCI6IGNvbXBhcmVzIHRoaXMgY29weSdzIHZlcnNpb24gd2l0aCB0aGUgbmV3ZXN0IEdpdEh1YlxuLy8gcmVsZWFzZSBvZiB0aGUgcmVwb3NpdG9yeSBpbiBpdHMgbWFuaWZlc3QsIGF0IG1vc3QgZXZlcnkgNiBob3VycywgYW5kIHVwZGF0ZXMgdGhyb3VnaCBPcmNhJ3Mgb3duXG4vLyBgb3JjYSBwbHVnaW4gdXBkYXRlYC4gT25seSBpbnN0YWxsZWQgY29waWVzIChPcmNhJ3MgcGx1Z2lucyBmb2xkZXIpIGNoZWNrOyBhIGRldmVsb3BtZW50IGZvbGRlciBuZXZlclxuLy8gZG9lcy4gTm90aGluZyBwZXJzb25hbCBpcyBzZW50OiBvbmUgdW5hdXRoZW50aWNhdGVkIHJlcXVlc3QgZm9yIHRoZSBwdWJsaWMgcmVsZWFzZSBsaXN0LlxuaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB0eXBlIHsgQ2xpUnVubmVyIH0gZnJvbSAnLi4vY2xpL29yY2EtY2xpLnRzJ1xuXG5jb25zdCBDSEVDS19FVkVSWV9NUyA9IDYgKiA2MCAqIDYwICogMTAwMFxuY29uc3QgRkVUQ0hfVElNRU9VVF9NUyA9IDgwMDBcblxuZXhwb3J0IHR5cGUgVXBkYXRlSW5mbyA9IHsgY3VycmVudDogc3RyaW5nOyBsYXRlc3Q6IHN0cmluZyB8IG51bGw7IG5ld2VyOiBib29sZWFuOyByZWxlYXNlVXJsOiBzdHJpbmcgfCBudWxsOyBwbHVnaW5LZXk6IHN0cmluZyB8IG51bGwgfVxuXG5leHBvcnQgdHlwZSBVcGRhdGVSZXN1bHQgPSB7IHVwZGF0ZWQ6IHRydWU7IHZlcnNpb246IHN0cmluZyB8IG51bGwgfSB8IHsgdXBkYXRlZDogZmFsc2U7IGFwcHJvdmVDb21tYW5kOiBzdHJpbmcgfCBudWxsOyByZWFzb246IHN0cmluZyB9XG5cbi8qKiBUaGUga2V5IG9mIGFuIGluc3RhbGxlZCBjb3B5IChgPHB1Ymxpc2hlcj4uPGlkPmApIGZyb20gd2hlcmUgaXQgcnVuczsgbnVsbCBmb3IgYSBkZXZlbG9wbWVudCBmb2xkZXIuICovXG5leHBvcnQgZnVuY3Rpb24gaW5zdGFsbGVkS2V5KHJvb3REaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHJvb3REaXIubWF0Y2goL1tcXFxcL11wbHVnaW5zW1xcXFwvXShbYS16MC05XVthLXowLTktXSpcXC5bYS16MC05XVthLXowLTktXSopKD86W1xcXFwvXXwkKS9pKVxuICByZXR1cm4gbWF0Y2ggJiYgIW1hdGNoWzFdLnN0YXJ0c1dpdGgoJ2xvY2FsLicpID8gbWF0Y2hbMV0gOiBudWxsXG59XG5cbi8qKiBvd25lci9yZXBvIGZyb20gYSBHaXRIdWIgcmVwb3NpdG9yeSBVUkwuICovXG5leHBvcnQgZnVuY3Rpb24gZ2l0aHViUmVwbyh1cmw6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHVybD8ubWF0Y2goL15odHRwczpcXC9cXC9naXRodWJcXC5jb21cXC8oW0EtWmEtejAtOS1dKylcXC8oW0EtWmEtejAtOS5fLV0rPykoPzpcXC5naXQpP1xcLz8kLylcbiAgcmV0dXJuIG1hdGNoID8gYCR7bWF0Y2hbMV19LyR7bWF0Y2hbMl19YCA6IG51bGxcbn1cblxuLyoqIFNlbWFudGljIHZlcnNpb24gY29tcGFyZSBvZiBgeC55LnpgIChhIGxlYWRpbmcgdiBpcyBpZ25vcmVkKTsgcHJlcmVsZWFzZSBzdWZmaXhlcyBjb3VudCBhcyBvbGRlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wYXJlVmVyc2lvbnMoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBwYXJzZSA9ICh2OiBzdHJpbmcpID0+IHtcbiAgICBjb25zdCBbY29yZSwgcHJlXSA9IHYucmVwbGFjZSgvXnYvaSwgJycpLnNwbGl0KCctJywgMilcbiAgICByZXR1cm4geyBudW1zOiBjb3JlLnNwbGl0KCcuJykubWFwKChuKSA9PiBOdW1iZXIucGFyc2VJbnQobiwgMTApIHx8IDApLCBwcmU6IHByZSA/PyBudWxsIH1cbiAgfVxuICBjb25zdCB4ID0gcGFyc2UoYSlcbiAgY29uc3QgeSA9IHBhcnNlKGIpXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMzsgaSsrKSB7XG4gICAgY29uc3QgZCA9ICh4Lm51bXNbaV0gPz8gMCkgLSAoeS5udW1zW2ldID8/IDApXG4gICAgaWYgKGQpIHJldHVybiBNYXRoLnNpZ24oZClcbiAgfVxuICBpZiAoeC5wcmUgPT09IHkucHJlKSByZXR1cm4gMFxuICByZXR1cm4geC5wcmUgPT09IG51bGwgPyAxIDogeS5wcmUgPT09IG51bGwgPyAtMSA6IHgucHJlIDwgeS5wcmUgPyAtMSA6IDFcbn1cblxudHlwZSBGZXRjaGVyID0gKHVybDogc3RyaW5nLCBpbml0OiB7IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47IHNpZ25hbDogQWJvcnRTaWduYWwgfSkgPT4gUHJvbWlzZTx7IG9rOiBib29sZWFuOyBzdGF0dXM6IG51bWJlcjsganNvbigpOiBQcm9taXNlPHVua25vd24+IH0+XG5cbmV4cG9ydCBjbGFzcyBVcGRhdGVDaGVja2VyIHtcbiAgcHJpdmF0ZSBjYWNoZWQ6IHsgYXQ6IG51bWJlcjsgaW5mbzogVXBkYXRlSW5mbyB9IHwgbnVsbCA9IG51bGxcbiAgcHJpdmF0ZSBtYW5pZmVzdDogeyB2ZXJzaW9uOiBzdHJpbmc7IHJlcG9zaXRvcnk/OiBzdHJpbmcgfSB8IG51bGwgPSBudWxsXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSByb290RGlyOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBlbmFibGVkOiAoKSA9PiBib29sZWFuLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZmV0Y2hlcjogRmV0Y2hlciA9IGZldGNoIGFzIHVua25vd24gYXMgRmV0Y2hlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IG5vdzogKCkgPT4gbnVtYmVyID0gRGF0ZS5ub3dcbiAgKSB7fVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZE1hbmlmZXN0KCk6IFByb21pc2U8eyB2ZXJzaW9uOiBzdHJpbmc7IHJlcG9zaXRvcnk/OiBzdHJpbmcgfT4ge1xuICAgIHRoaXMubWFuaWZlc3QgPz89IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoam9pbih0aGlzLnJvb3REaXIsICdvcmNhLXBsdWdpbi5qc29uJyksICd1dGY4JykpIGFzIHsgdmVyc2lvbjogc3RyaW5nOyByZXBvc2l0b3J5Pzogc3RyaW5nIH1cbiAgICByZXR1cm4gdGhpcy5tYW5pZmVzdFxuICB9XG5cbiAgYXN5bmMgY2hlY2soZm9yY2UgPSBmYWxzZSk6IFByb21pc2U8VXBkYXRlSW5mbz4ge1xuICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5yZWFkTWFuaWZlc3QoKVxuICAgIGNvbnN0IHBsdWdpbktleSA9IGluc3RhbGxlZEtleSh0aGlzLnJvb3REaXIpXG4gICAgY29uc3QgYmFzZTogVXBkYXRlSW5mbyA9IHsgY3VycmVudDogbWFuaWZlc3QudmVyc2lvbiwgbGF0ZXN0OiBudWxsLCBuZXdlcjogZmFsc2UsIHJlbGVhc2VVcmw6IG51bGwsIHBsdWdpbktleSB9XG4gICAgY29uc3QgcmVwbyA9IGdpdGh1YlJlcG8obWFuaWZlc3QucmVwb3NpdG9yeSlcbiAgICBpZiAoIXBsdWdpbktleSB8fCAhcmVwbyB8fCAhdGhpcy5lbmFibGVkKCkpIHJldHVybiBiYXNlXG4gICAgaWYgKCFmb3JjZSAmJiB0aGlzLmNhY2hlZCAmJiB0aGlzLm5vdygpIC0gdGhpcy5jYWNoZWQuYXQgPCBDSEVDS19FVkVSWV9NUykgcmV0dXJuIHRoaXMuY2FjaGVkLmluZm9cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoZXIoYGh0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3MvJHtyZXBvfS9yZWxlYXNlcy9sYXRlc3RgLCB7XG4gICAgICAgIGhlYWRlcnM6IHsgQWNjZXB0OiAnYXBwbGljYXRpb24vdm5kLmdpdGh1Yitqc29uJywgJ1VzZXItQWdlbnQnOiAnb3JjYS1hZ2VudC1mbG93LXVwZGF0ZS1jaGVjaycgfSxcbiAgICAgICAgc2lnbmFsOiBBYm9ydFNpZ25hbC50aW1lb3V0KEZFVENIX1RJTUVPVVRfTVMpXG4gICAgICB9KVxuICAgICAgaWYgKCFyZXNwb25zZS5vaykgdGhyb3cgbmV3IEVycm9yKGBHaXRIdWIgYW5zd2VyZWQgJHtyZXNwb25zZS5zdGF0dXN9YClcbiAgICAgIGNvbnN0IHJlbGVhc2UgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyB7IHRhZ19uYW1lPzogdW5rbm93bjsgaHRtbF91cmw/OiB1bmtub3duOyBkcmFmdD86IHVua25vd247IHByZXJlbGVhc2U/OiB1bmtub3duIH1cbiAgICAgIGNvbnN0IHRhZyA9IHR5cGVvZiByZWxlYXNlLnRhZ19uYW1lID09PSAnc3RyaW5nJyAmJiAvXnY/XFxkK1xcLlxcZCtcXC5cXGQrLy50ZXN0KHJlbGVhc2UudGFnX25hbWUpID8gcmVsZWFzZS50YWdfbmFtZS5yZXBsYWNlKC9edi9pLCAnJykgOiBudWxsXG4gICAgICBjb25zdCB1cmwgPSB0eXBlb2YgcmVsZWFzZS5odG1sX3VybCA9PT0gJ3N0cmluZycgJiYgcmVsZWFzZS5odG1sX3VybC5zdGFydHNXaXRoKGBodHRwczovL2dpdGh1Yi5jb20vJHtyZXBvfS9gKSA/IHJlbGVhc2UuaHRtbF91cmwgOiBudWxsXG4gICAgICBjb25zdCBpbmZvOiBVcGRhdGVJbmZvID0geyAuLi5iYXNlLCBsYXRlc3Q6IHRhZywgbmV3ZXI6IEJvb2xlYW4odGFnKSAmJiByZWxlYXNlLmRyYWZ0ICE9PSB0cnVlICYmIHJlbGVhc2UucHJlcmVsZWFzZSAhPT0gdHJ1ZSAmJiBjb21wYXJlVmVyc2lvbnModGFnISwgbWFuaWZlc3QudmVyc2lvbikgPiAwLCByZWxlYXNlVXJsOiB1cmwgfVxuICAgICAgdGhpcy5jYWNoZWQgPSB7IGF0OiB0aGlzLm5vdygpLCBpbmZvIH1cbiAgICAgIHJldHVybiBpbmZvXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBPZmZsaW5lIG9yIHJhdGUtbGltaXRlZDogc2F5IG5vdGhpbmcsIHRyeSBhZ2FpbiBuZXh0IHRpbWUuXG4gICAgICB0aGlzLmNhY2hlZCA9IHsgYXQ6IHRoaXMubm93KCkgLSBDSEVDS19FVkVSWV9NUyArIDMwICogNjAgKiAxMDAwLCBpbmZvOiBiYXNlIH1cbiAgICAgIHJldHVybiBiYXNlXG4gICAgfVxuICB9XG5cbiAgLyoqIFJ1bnMgYG9yY2EgcGx1Z2luIHVwZGF0ZSA8a2V5PmAuIEEgdmVyc2lvbiB0aGF0IG5lZWRzIG5ldyBhY2Nlc3MgcmV0dXJucyBPcmNhJ3MgYXBwcm92ZSBjb21tYW5kIGluc3RlYWQuICovXG4gIGFzeW5jIHVwZGF0ZShjbGk6IENsaVJ1bm5lcik6IFByb21pc2U8VXBkYXRlUmVzdWx0PiB7XG4gICAgY29uc3Qga2V5ID0gaW5zdGFsbGVkS2V5KHRoaXMucm9vdERpcilcbiAgICBpZiAoIWtleSkgcmV0dXJuIHsgdXBkYXRlZDogZmFsc2UsIGFwcHJvdmVDb21tYW5kOiBudWxsLCByZWFzb246ICdUaGlzIGlzIGEgZGV2ZWxvcG1lbnQgY29weTsgdXBkYXRlIGl0IGZyb20gaXRzIGZvbGRlci4nIH1cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGkucnVuPHsgdmVyc2lvbj86IHN0cmluZyB9PihbJ3BsdWdpbicsICd1cGRhdGUnLCBrZXldLCB7IHRpbWVvdXRNczogMTIwXzAwMCB9KVxuICAgIGlmIChyZXN1bHQub2spIHtcbiAgICAgIHRoaXMuY2FjaGVkID0gbnVsbFxuICAgICAgcmV0dXJuIHsgdXBkYXRlZDogdHJ1ZSwgdmVyc2lvbjogdHlwZW9mIHJlc3VsdC5yZXN1bHQ/LnZlcnNpb24gPT09ICdzdHJpbmcnID8gcmVzdWx0LnJlc3VsdC52ZXJzaW9uIDogbnVsbCB9XG4gICAgfVxuICAgIGNvbnN0IGZpbmdlcnByaW50ID0gcmVzdWx0Lm1lc3NhZ2UubWF0Y2goLy0tYXBwcm92ZVxccysoYXBcXGQtW2EtZjAtOV17MTYsNjR9KS8pPy5bMV0gPz8gbnVsbFxuICAgIHJldHVybiB7XG4gICAgICB1cGRhdGVkOiBmYWxzZSxcbiAgICAgIGFwcHJvdmVDb21tYW5kOiBmaW5nZXJwcmludCA/IGBvcmNhIHBsdWdpbiB1cGRhdGUgJHtrZXl9IC0tYXBwcm92ZSAke2ZpbmdlcnByaW50fWAgOiBudWxsLFxuICAgICAgcmVhc29uOiByZXN1bHQuY29kZSA9PT0gJ2FwcHJvdmFsX3JlcXVpcmVkJyB8fCBmaW5nZXJwcmludCA/ICdUaGUgbmV3IHZlcnNpb24gYXNrcyBmb3IgbW9yZSBhY2Nlc3MsIHNvIE9yY2EgbmVlZHMgeW91ciBhcHByb3ZhbC4nIDogcmVzdWx0Lm1lc3NhZ2VcbiAgICB9XG4gIH1cbn1cbiIsICIvLyBPcmNhIGNhcHMgYSBwYW5lbCByZXF1ZXN0J3MgYW5zd2VyIGF0IDEgTWlCLiBUcmltIHRoZSBsZWFzdCB1c2VmdWwgcGFydHMgZmlyc3QgdW50aWwgdGhlXG4vLyBzbmFwc2hvdCBmaXRzOiBvbGQgdGltZWxpbmUgZXZlbnRzLCB0b29sIGNhbGxzLCBtZXNzYWdlIHRleHQsIHRoZW4gbG9uZyB0YXNrIHRleHQuXG4vLyBUaGUgd2hvbGUgc25hcHNob3QgaXMgc2VyaWFsaXplZCBvbmNlOyBhZnRlciB0aGF0IG9ubHkgdGhlIHBhcnQgYSBzdGVwIGNoYW5nZWQgaXMgcmUtbWVhc3VyZWQuXG5pbXBvcnQgdHlwZSB7IEZsb3dTbmFwc2hvdCB9IGZyb20gJy4uLy4uL3NoYXJlZC9ldmVudHMudHMnXG5pbXBvcnQgeyB0cnVuY2F0ZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9yZWRhY3QudHMnXG5cbmV4cG9ydCBjb25zdCBQQU5FTF9TTkFQU0hPVF9CVURHRVQgPSA5MDAgKiAxMDI0XG5cbnR5cGUgUGFydCA9ICdldmVudHMnIHwgJ3Rvb2xDYWxscycgfCAnbWVzc2FnZXMnIHwgJ3Rhc2tzJ1xuXG5jb25zdCBieXRlcyA9ICh2YWx1ZTogdW5rbm93bikgPT4gQnVmZmVyLmJ5dGVMZW5ndGgoSlNPTi5zdHJpbmdpZnkodmFsdWUpKVxuXG5jb25zdCByZWFkID0gKHM6IEZsb3dTbmFwc2hvdCwgcGFydDogUGFydCk6IHVua25vd24gPT4gKHBhcnQgPT09ICdldmVudHMnID8gcy5ldmVudHMgOiBzLnN0YXRlW3BhcnRdKVxuXG5jb25zdCBTVEVQUzogeyBwYXJ0OiBQYXJ0OyBhcHBseTogKHM6IEZsb3dTbmFwc2hvdCkgPT4gRmxvd1NuYXBzaG90IH1bXSA9IFtcbiAgeyBwYXJ0OiAnZXZlbnRzJywgYXBwbHk6IChzKSA9PiAoeyAuLi5zLCBldmVudHM6IHMuZXZlbnRzLnNsaWNlKC0zMDApIH0pIH0sXG4gIHsgcGFydDogJ3Rvb2xDYWxscycsIGFwcGx5OiAocykgPT4gKHsgLi4ucywgc3RhdGU6IHsgLi4ucy5zdGF0ZSwgdG9vbENhbGxzOiBzLnN0YXRlLnRvb2xDYWxscy5zbGljZSgtODApIH0gfSkgfSxcbiAgeyBwYXJ0OiAnbWVzc2FnZXMnLCBhcHBseTogKHMpID0+ICh7IC4uLnMsIHN0YXRlOiB7IC4uLnMuc3RhdGUsIG1lc3NhZ2VzOiBzLnN0YXRlLm1lc3NhZ2VzLnNsaWNlKC0xMjApLm1hcCgobSkgPT4gKHsgLi4ubSwgYm9keTogbS5ib2R5ID8gdHJ1bmNhdGUobS5ib2R5LCAyMDApIDogbnVsbCB9KSkgfSB9KSB9LFxuICB7XG4gICAgcGFydDogJ3Rhc2tzJyxcbiAgICBhcHBseTogKHMpID0+ICh7XG4gICAgICAuLi5zLFxuICAgICAgc3RhdGU6IHtcbiAgICAgICAgLi4ucy5zdGF0ZSxcbiAgICAgICAgdGFza3M6IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICBPYmplY3QuZW50cmllcyhzLnN0YXRlLnRhc2tzKS5tYXAoKFtpZCwgdF0pID0+IFtpZCwgeyAuLi50LCBzcGVjOiB0LnNwZWMgPyB0cnVuY2F0ZSh0LnNwZWMsIDMwMCkgOiBudWxsLCByZXN1bHQ6IHQucmVzdWx0ID8geyAuLi50LnJlc3VsdCwgcmF3OiBudWxsLCBtZXNzYWdlOiB0LnJlc3VsdC5tZXNzYWdlID8gdHJ1bmNhdGUodC5yZXN1bHQubWVzc2FnZSwgNDAwKSA6IG51bGwgfSA6IG51bGwgfV0pXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9KVxuICB9LFxuICB7IHBhcnQ6ICdldmVudHMnLCBhcHBseTogKHMpID0+ICh7IC4uLnMsIGV2ZW50czogcy5ldmVudHMuc2xpY2UoLTgwKSB9KSB9XG5dXG5cbmV4cG9ydCBmdW5jdGlvbiBmaXRTbmFwc2hvdChzbmFwc2hvdDogRmxvd1NuYXBzaG90LCBidWRnZXQgPSBQQU5FTF9TTkFQU0hPVF9CVURHRVQpOiBGbG93U25hcHNob3Qge1xuICBsZXQgdG90YWwgPSBieXRlcyhzbmFwc2hvdClcbiAgaWYgKHRvdGFsIDw9IGJ1ZGdldCkgcmV0dXJuIHNuYXBzaG90XG4gIGNvbnN0IHNpemVzID0gbmV3IE1hcDxQYXJ0LCBudW1iZXI+KClcbiAgY29uc3Qgc2l6ZU9mID0gKHM6IEZsb3dTbmFwc2hvdCwgcGFydDogUGFydCkgPT4ge1xuICAgIGlmICghc2l6ZXMuaGFzKHBhcnQpKSBzaXplcy5zZXQocGFydCwgYnl0ZXMocmVhZChzLCBwYXJ0KSkpXG4gICAgcmV0dXJuIHNpemVzLmdldChwYXJ0KSFcbiAgfVxuICBsZXQgY3VycmVudCA9IHNuYXBzaG90XG4gIGZvciAoY29uc3Qgc3RlcCBvZiBTVEVQUykge1xuICAgIGNvbnN0IGJlZm9yZSA9IHNpemVPZihjdXJyZW50LCBzdGVwLnBhcnQpXG4gICAgY3VycmVudCA9IHN0ZXAuYXBwbHkoY3VycmVudClcbiAgICBjb25zdCBhZnRlciA9IGJ5dGVzKHJlYWQoY3VycmVudCwgc3RlcC5wYXJ0KSlcbiAgICBzaXplcy5zZXQoc3RlcC5wYXJ0LCBhZnRlcilcbiAgICB0b3RhbCArPSBhZnRlciAtIGJlZm9yZVxuICAgIGlmICh0b3RhbCA8PSBidWRnZXQpIHJldHVybiBjdXJyZW50XG4gIH1cbiAgcmV0dXJuIGN1cnJlbnRcbn1cbiIsICIvLyBPcmNhIHBhbmVscyBhbmQgdGhlIGNhbnZhcyBlZGl0b3IgdGFsayB0byB0aGUgd29ya2VyIHRocm91Z2ggcGx1Z2luLnJlcXVlc3QgLyBwYW5lbHMucG9zdC5cbmltcG9ydCB0eXBlIHsgT3JjYVdvcmtlckFwaSB9IGZyb20gJ29yY2Evd29ya2VyJ1xuaW1wb3J0IHR5cGUgeyBGbG93RGVsdGEsIEZsb3dTbmFwc2hvdCB9IGZyb20gJy4uLy4uL3NoYXJlZC9ldmVudHMudHMnXG5pbXBvcnQgdHlwZSB7IENvbW1hbmRSZXNwb25zZSB9IGZyb20gJy4uLy4uL3NoYXJlZC9jb21tYW5kcy50cydcbmltcG9ydCB7IGZpdFNuYXBzaG90IH0gZnJvbSAnLi9zbmFwc2hvdC1idWRnZXQudHMnXG5cbi8qKiBwYW5lbHMucG9zdCBwYXlsb2FkcyBhcmUgY2FwcGVkIGF0IDI1NiBLaUI7IGxhcmdlciBkZWx0YXMgYmVjb21lIGEgcmVzeW5jIHJlcXVlc3QuICovXG5jb25zdCBNQVhfUE9TVF9CWVRFUyA9IDIwMCAqIDEwMjRcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3RQYW5lbHMoXG4gIHBhbmVsczogT3JjYVdvcmtlckFwaVsncGFuZWxzJ10sXG4gIGRlcHM6IHtcbiAgICBzbmFwc2hvdDogKCkgPT4gRmxvd1NuYXBzaG90XG4gICAgc3Vic2NyaWJlOiAobGlzdGVuZXI6IChkZWx0YTogRmxvd0RlbHRhKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkXG4gICAgLyoqIExpdmUgb3V0cHV0IG5vdGljZXM6IGFuIGFnZW50J3MgY29udmVyc2F0aW9uIGNoYW5nZWQgKG9ubHkgaXRzIGlkIGlzIHNlbnQpLiAqL1xuICAgIHN1YnNjcmliZU91dHB1dD86IChsaXN0ZW5lcjogKGFnZW50SWQ6IHN0cmluZykgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZFxuICAgIGNvbW1hbmQ6IChpbnB1dDogdW5rbm93bikgPT4gUHJvbWlzZTxDb21tYW5kUmVzcG9uc2U+XG4gICAgbG9nOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkXG4gIH1cbik6ICgpID0+IHZvaWQge1xuICBjb25zdCBkaXNwb3NlcnMgPSBbXG4gICAgcGFuZWxzLmhhbmRsZSgnZmxvdy5zbmFwc2hvdCcsICgpID0+IGZpdFNuYXBzaG90KGRlcHMuc25hcHNob3QoKSkgYXMgbmV2ZXIpLFxuICAgIHBhbmVscy5oYW5kbGUoJ2Zsb3cuY29tbWFuZCcsIChpbnB1dCkgPT4gZGVwcy5jb21tYW5kKGlucHV0KSBhcyBuZXZlcilcbiAgXVxuICBjb25zdCB1bnN1YnNjcmliZSA9IGRlcHMuc3Vic2NyaWJlKChkZWx0YSkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkoZGVsdGEpXG4gICAgICBpZiAoQnVmZmVyLmJ5dGVMZW5ndGgoanNvbikgPiBNQVhfUE9TVF9CWVRFUykgcGFuZWxzLnBvc3QoJ2Zsb3cucmVzeW5jJywgeyB0b1NlcTogZGVsdGEudG9TZXEgfSlcbiAgICAgIGVsc2UgcGFuZWxzLnBvc3QoJ2Zsb3cuZGVsdGEnLCBkZWx0YSBhcyBuZXZlcilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZGVwcy5sb2coYHBhbmVsIHBvc3QgZmFpbGVkOiAkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX1gKVxuICAgIH1cbiAgfSlcbiAgY29uc3QgdW5zdWJzY3JpYmVPdXRwdXQgPSBkZXBzLnN1YnNjcmliZU91dHB1dD8uKChhZ2VudElkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHBhbmVscy5wb3N0KCdmbG93Lm91dHB1dCcsIHsgYWdlbnRJZCB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBkZXBzLmxvZyhgcGFuZWwgcG9zdCBmYWlsZWQ6ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApXG4gICAgfVxuICB9KVxuICByZXR1cm4gKCkgPT4ge1xuICAgIHVuc3Vic2NyaWJlKClcbiAgICB1bnN1YnNjcmliZU91dHB1dD8uKClcbiAgICBmb3IgKGNvbnN0IGRpc3Bvc2VyIG9mIGRpc3Bvc2VycykgZGlzcG9zZXIuZGlzcG9zZSgpXG4gIH1cbn1cbiIsICIvLyBBZ2VudCBGbG93IHdvcmtlciBlbnRyeS4gT3JjYSBjYWxscyB0aGUgZGVmYXVsdCBleHBvcnQgb25jZSB3aGVuIHRoZSB3b3JrZXIgc3RhcnRzLlxuaW1wb3J0IHR5cGUgeyBPcmNhV29ya2VyQXBpIH0gZnJvbSAnb3JjYS93b3JrZXInXG5pbXBvcnQgeyBBZ2VudEZsb3dSdW50aW1lIH0gZnJvbSAnLi9ydW50aW1lLnRzJ1xuXG5sZXQgcnVudGltZTogQWdlbnRGbG93UnVudGltZSB8IG51bGwgPSBudWxsXG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKG9yY2E6IE9yY2FXb3JrZXJBcGkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgcnVudGltZSA9IG5ldyBBZ2VudEZsb3dSdW50aW1lKG9yY2EpXG4gIGF3YWl0IHJ1bnRpbWUuc3RhcnQoKVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVhY3RpdmF0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgcnVudGltZT8uc3RvcCgpXG4gIHJ1bnRpbWUgPSBudWxsXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxXQUFBQSxnQkFBZTtBQUN4QixTQUFTLHFCQUFxQjs7O0FDeUR2QixJQUFNLHVCQUFpRCxvQkFBSSxJQUFJLENBQUMsY0FBYyxhQUFhLENBQUM7QUFFNUYsSUFBTSxlQUF1QztBQUFBLEVBQ2xEO0FBQUEsRUFBa0I7QUFBQSxFQUFpQjtBQUFBLEVBQWdCO0FBQUEsRUFBZ0I7QUFBQSxFQUFjO0FBQUEsRUFDakY7QUFBQSxFQUFlO0FBQUEsRUFBZTtBQUFBLEVBQWU7QUFBQSxFQUFjO0FBQUEsRUFBaUI7QUFBQSxFQUM1RTtBQUFBLEVBQW1CO0FBQUEsRUFBaUI7QUFBQSxFQUFvQjtBQUFBLEVBQWdCO0FBQUEsRUFDeEU7QUFBQSxFQUFpQjtBQUFBLEVBQWdCO0FBQUEsRUFBZ0I7QUFBQSxFQUFrQjtBQUFBLEVBQWlCO0FBQUEsRUFBb0I7QUFBQSxFQUFzQjtBQUFBLEVBQWdCO0FBQUEsRUFBZTtBQUFBLEVBQWU7QUFBQSxFQUFnQjtBQUFBLEVBQWM7QUFBQSxFQUFlO0FBQUEsRUFBZ0I7QUFDM087QUFHTyxJ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bUIsT0FBTyxNQUFNLEtBQUssY0FBYyxLQUFLLENBQUM7QUFBQSxNQUNyRTtBQUFBLElBQ0Y7QUFDQSxTQUFLLG9CQUFvQjtBQUFBLEVBQzNCO0FBQUEsRUFFQSxNQUFjLGFBQTRCO0FBQ3hDLFFBQUk7QUFDRixZQUFNLE1BQU8sTUFBTSxLQUFLLEtBQUssUUFBUSxJQUFJLFFBQVE7QUFDakQsVUFBSSxPQUFPLE9BQU8sUUFBUSxVQUFVO0FBQ2xDLGFBQUssTUFBTSxJQUFJLEVBQUUsUUFBUSxVQUFVLElBQUksVUFBVSxPQUFPLEVBQUUsR0FBRyxjQUFjLEdBQUcsSUFBSSxFQUFpQixDQUFDO0FBQUEsTUFDdEc7QUFBQSxJQUNGLFFBQVE7QUFBQSxJQUVSO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxXQUFXLFFBQW9DO0FBQzNELFVBQU0sS0FBSyxLQUFLLFFBQVEsSUFBSSxVQUFVLE1BQWU7QUFDckQsU0FBSyxNQUFNLElBQUksRUFBRSxRQUFRLFVBQVUsSUFBSSxVQUFVLE9BQU8sT0FBTyxDQUFDO0FBQ2hFLFVBQU0sS0FBSyxTQUFTLFFBQVE7QUFBQSxFQUM5QjtBQUNGOzs7QXNDM2dCQSxJQUFJLFVBQW1DO0FBRXZDLGVBQU8sU0FBZ0MsTUFBb0M7QUFDekUsWUFBVSxJQUFJLGlCQUFpQixJQUFJO0FBQ25DLFFBQU0sUUFBUSxNQUFNO0FBQ3RCO0FBRUEsZUFBc0IsYUFBNEI7QUFDaEQsUUFBTSxTQUFTLEtBQUs7QUFDcEIsWUFBVTtBQUNaOyIsCiAgIm5hbWVzIjogWyJob21lZGlyIiwgImNsZWFuIiwgInN0YXQiLCAic2VwIiwgImZsYWciLCAiYXNSZWNvcmQiLCAic3RyIiwgInJlYWRkaXIiLCAicmVhZEZpbGUiLCAiam9pbiIsICJyZWFkZGlyIiwgImpvaW4iLCAicmVhZEZpbGUiLCAib3BlbiIsICJyZWFkZGlyIiwgInN0YXQiLCAiaG9tZWRpciIsICJqb2luIiwgInJlYWRGaWxlIiwgImhvbWVkaXIiLCAiam9pbiIsICJyZXNvbHZlIiwgImhvbWVkaXIiLCAicGxhdGZvcm0iLCAiam9pbiIsICJob21lZGlyIiwgInBsYXRmb3JtIiwgImpvaW4iLCAiYnl0ZXMiLCAiY3JlYXRlSGFzaCIsICJleGVjRmlsZSIsICJyZXNvbHZlIiwgImV4ZWNGaWxlIiwgInJhbmRvbVVVSUQiLCAicmFuZG9tVVVJRCIsICJyZWFkRmlsZSIsICJzdGF0IiwgImhvbWVkaXIiLCAicGxhdGZvcm0iLCAiam9pbiIsICJyZXNvbHZlIiwgInJhbmRvbVVVSUQiLCAib3BlbiIsICJzdGF0IiwgIktFRVBfTUVTU0FHRVMiLCAiVEVYVF9MSU1JVCIsICJUT09MX0xJTUlUIiwgInRhaWwiLCAic3RhdCIsICJ0YWlsIiwgInJlYWQiLCAiS0VFUF9NRVNTQUdFUyIsICJvcGVuIiwgIlRFWFRfTElNSVQiLCAiVE9PTF9MSU1JVCIsICJpbWFnZXMiLCAiY3JlYXRlSGFzaCIsICJta2RpciIsICJyZWFkRmlsZSIsICJ3cml0ZUZpbGUiLCAiam9pbiIsICJyZWFkRmlsZSIsICJzdGF0IiwgImNvbnN0YW50cyIsICJyZXNvbHZlIiwgInJlc29sdmUiLCAic3RhdCIsICJyZWFkRmlsZSIsICJjb25zdGFudHMiLCAiYnJvdGxpIiwgInJlYWRGaWxlIiwgInN0YXQiLCAiam9pbiIsICJta2RpciIsICJyZWFkZGlyIiwgInJlYWRGaWxlIiwgInN0YXQiLCAid3JpdGVGaWxlIiwgImhvbWVkaXIiLCAicGxhdGZvcm0iLCAiam9pbiIsICJNQVhfUlVOUyIsICJta2RpciIsICJyZWFkRmlsZSIsICJyZW5hbWUiLCAid3JpdGVGaWxlIiwgImpvaW4iLCAicmVhZEZpbGUiLCAiam9pbiIsICJob21lZGlyIiwgInJvdGF0ZVRva2VuIl0KfQo=
