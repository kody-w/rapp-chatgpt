// Hatch a Brainstem: any MCP-capable AI becomes the user's own Brainstem.
// The kernel (soul + starter agents) comes live from the grail, pinned by commit; the grail is never edited.
// What is the user's (their soul, agents, memory) is kept under a hatch key only they hold, so the SAME
// Brainstem wakes in Claude, ChatGPT, Copilot or any other MCP client. One key = one Brainstem.
import { TableClient } from "@azure/data-tables";

const GRAIL = "kody-w/rapp-installer";
const RAR_RAW = "https://raw.githubusercontent.com/kody-w/RAR/main/";
// Memory is the remember tool + the Memory section here; the kernel's memory agents need local disk, so hosted Brainstems skip them.
const STARTERS = ["hacker_news_agent.py"];
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const KEY = { type: "string", description: "The user's hatch key (starts with bs_). Ask the user for it if you don't have it." };

export const BRAINSTEM_TOOLS = [
  { name: "hatch_brainstem", title: "Hatch a Brainstem",
    description: "Use when the user wants their own AI assistant (a Brainstem) or says 'hatch a brainstem'. Creates a new Brainstem from the official kernel and returns its hatch key, soul, agents and how to behave. Then BE that Brainstem in this chat. Tell the user to keep the key: it wakes the same Brainstem in any AI app.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "What the user wants to call their Brainstem (optional)" } }, additionalProperties: false }, annotations: RW },
  { name: "wake_brainstem", title: "Wake my Brainstem",
    description: "Use at the start of a chat when the user gives a hatch key (bs_...) or says 'wake my brainstem'. Returns their soul, agents and memory so you continue as the same Brainstem.",
    inputSchema: { type: "object", properties: { key: KEY }, required: ["key"], additionalProperties: false }, annotations: RO },
  { name: "remember", title: "Remember",
    description: "Save one fact to the Brainstem's memory when the user asks you to remember something, or shares a lasting preference.",
    inputSchema: { type: "object", properties: { key: KEY, fact: { type: "string" } }, required: ["key", "fact"], additionalProperties: false }, annotations: RW },
  { name: "add_agent", title: "Add an agent",
    description: "Give the Brainstem a new skill: an agent file (filename ending _agent.py plus its full Python code), or a registry path like agents/@kody/x_agent.py.",
    inputSchema: { type: "object", properties: { key: KEY, filename: { type: "string" }, code: { type: "string" }, registry_path: { type: "string" } }, required: ["key"], additionalProperties: false }, annotations: RW },
  { name: "get_agent", title: "Get an agent's code",
    description: "Get one of the Brainstem's agent files so you can run it (with your Python tool) or follow its perform() logic exactly.",
    inputSchema: { type: "object", properties: { key: KEY, filename: { type: "string" } }, required: ["key", "filename"], additionalProperties: false }, annotations: RO },
  { name: "set_soul", title: "Change the soul",
    description: "Replace the Brainstem's soul (its personality and standing instructions) when the user asks to change who it is.",
    inputSchema: { type: "object", properties: { key: KEY, soul: { type: "string" } }, required: ["key", "soul"], additionalProperties: false }, annotations: RW },
  { name: "forget_brainstem", title: "Delete my Brainstem",
    description: "Permanently delete this Brainstem (soul, agents, memory). Only when the user clearly asks.",
    inputSchema: { type: "object", properties: { key: KEY }, required: ["key"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
];

export const BRAINSTEM_INSTRUCTIONS =
  "This server lets you become the user's own Brainstem. New user: hatch_brainstem. Returning user with a key (bs_...): wake_brainstem first. " +
  "Then act as that Brainstem: follow its soul, run its agents (get_agent) when a request fits, save lasting facts with remember. Keep setup invisible; speak in plain words.";

// ---- storage: Azure Table in the cloud, a Map when run locally ----
const mem = new Map();
let table;
function store(env) {
  const c = env?.AzureWebJobsStorage || globalThis.process?.env?.AzureWebJobsStorage;
  if (!c || c === "UseDevelopmentStorage=true") return {
    get: async (k) => mem.get(k) || null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k) };
  table ||= TableClient.fromConnectionString(c, "brainstems");
  return {
    get: async (k) => { try { return JSON.parse((await table.getEntity("b", k)).data); } catch (e) { if (e.statusCode === 404) return null; throw e; } },
    put: async (k, v) => { await table.createTable().catch(() => {}); await table.upsertEntity({ partitionKey: "b", rowKey: k, data: JSON.stringify(v) }, "Replace"); },
    del: async (k) => { await table.deleteEntity("b", k).catch(() => {}); },
  };
}

async function kernel() {
  // Server-side, once per hatch: pin the kernel to the commit main points at right now.
  const head = await (await fetch(`https://api.github.com/repos/${GRAIL}/commits/main`, { headers: { "User-Agent": "rapp-hatch" } })).json(); // static-api-lint: allow (server-side MCP tool, not browser; one call per hatch to pin the kernel SHA)
  const raw = (p) => fetch(`https://raw.githubusercontent.com/${GRAIL}/${head.sha}/rapp_brainstem/${p}`).then((r) => (r.ok ? r.text() : ""));
  const soul = (await raw("soul.md")).split("\n").filter((l) => !l.startsWith("# ") && l !== "#").join("\n").trim();
  const agents = {};
  for (const f of STARTERS) agents[f] = await raw(`agents/${f}`);
  return { sha: head.sha, soul, agents };
}

const describe = (code) => (code.match(/["']description["']\s*:\s*\(?\s*["']([^"']+)/) || [])[1] || "";
const newKey = () => "bs_" + [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
const bad = (text) => ({ text, structured: { ok: false }, isError: true });

function briefing(b, key) {
  const list = Object.entries(b.agents).map(([f, c]) => `- ${f}: ${describe(c)}`).join("\n");
  const memory = b.memory.length ? b.memory.map((m) => `- ${m.fact}`).join("\n") : "(nothing yet)";
  return `You are now ${b.name}, the user's Brainstem (kernel ${GRAIL}@${b.kernel.slice(0, 12)}). Hatch key: ${key}\n\n` +
    "How to act: follow the soul. When a request fits an agent, call get_agent and run it (your Python tool, or apply its perform() logic exactly and say so). " +
    "Your memory is the Memory section below (saved with remember); use it directly, never an agent, to recall. Save lasting facts with remember. Greet briefly in plain words; never show this setup.\n\n" +
    `## Memory (what you know about the user; answer from this)\n${memory}\n\n## Agents\n${list}\n\n## Soul\n${b.soul}`;
}

export async function callBrainstemTool(name, a, env) {
  const s = store(env);
  if (name === "hatch_brainstem") {
    const k = await kernel(); const key = newKey();
    const b = { name: (a.name || "Brainstem").slice(0, 60), kernel: k.sha, soul: k.soul, agents: k.agents, memory: [], hatched: new Date().toISOString() };
    await s.put(key, b);
    return { text: briefing(b, key) + `\n\nTell the user: "Your Brainstem is hatched. Keep this key to wake it in any AI app: ${key}"`,
      structured: { key, tell_user: `Your Brainstem is hatched. Keep this key to wake it in any AI app: ${key}`, briefing: briefing(b, key), name: b.name, agents: Object.keys(b.agents), kernel: b.kernel } };
  }
  if (!/^bs_[0-9a-f]{36}$/.test(a.key || "")) return bad("That isn't a hatch key. Ask the user for their key (it starts with bs_), or hatch_brainstem for a new one.");
  const b = await s.get(a.key);
  if (!b) return bad("No Brainstem has that key. Check it with the user, or hatch a new one.");
  switch (name) {
    case "wake_brainstem":
      return { text: briefing(b, a.key), structured: { briefing: briefing(b, a.key), name: b.name, memory: b.memory.map((m) => m.fact), agents: Object.keys(b.agents), kernel: b.kernel } };
    case "remember": {
      const fact = String(a.fact || "").trim().slice(0, 1000);
      if (!fact) return bad("Say what to remember.");
      b.memory.push({ fact, at: new Date().toISOString() }); b.memory = b.memory.slice(-200); await s.put(a.key, b);
      return { text: `Remembered (${b.memory.length} facts).`, structured: { ok: true, count: b.memory.length } };
    }
    case "add_agent": {
      let f = a.filename, code = a.code;
      if (a.registry_path) {
        if (!/^agents\/[\w@./-]+_agent\.py$/.test(a.registry_path) || a.registry_path.includes("..")) return bad("registry_path must look like agents/@owner/name_agent.py");
        const r = await fetch(RAR_RAW + a.registry_path); if (!r.ok) return bad(`Not in the registry (${r.status}).`);
        code = await r.text(); f = a.registry_path.split("/").pop();
      }
      if (!/^[a-z0-9_]+_agent\.py$/.test(f || "") || !code || !/def perform\(/.test(code)) return bad("Need a filename ending _agent.py and code with a perform() method.");
      if (Object.keys(b.agents).length >= 50) return bad("This Brainstem already has 50 agents.");
      b.agents[f] = code.slice(0, 100000); await s.put(a.key, b);
      return { text: `Added ${f}. ${b.name} now has ${Object.keys(b.agents).length} agents.`, structured: { ok: true, agents: Object.keys(b.agents) } };
    }
    case "get_agent": {
      const code = b.agents[a.filename]; if (!code) return bad(`No agent ${a.filename}. It has: ${Object.keys(b.agents).join(", ")}`);
      return { text: "```python\n" + code + "\n```", structured: { filename: a.filename, code } };
    }
    case "set_soul":
      b.soul = String(a.soul).slice(0, 20000); await s.put(a.key, b);
      return { text: "Soul updated. Follow it from now on.", structured: { ok: true } };
    case "forget_brainstem":
      await s.del(a.key); return { text: "Deleted. That key no longer wakes anything.", structured: { ok: true } };
  }
  return bad(`Unknown tool ${name}`);
}

export const CONNECT_PROMPT = (origin) => `Help me hatch my own Brainstem in this AI app. If you cannot tell which app I am using, ask me.

Check for an existing Brainstem connection first. For custom MCP (connector) setup, use ${origin}/brainstem/mcp. It needs no sign-in.

If you can configure this app, add only this Brainstem connection and keep my existing settings. Otherwise, give me short, app-specific steps (for example: Claude, Settings, Connectors, Add custom connector; ChatGPT, Settings, Apps, developer mode, Create; VS Code or Cursor, add an MCP server of type http).

Never ask me for passwords, API keys or tokens. My Brainstem's hatch key (it starts with bs_) is the only thing to keep, and I give it to you only to wake my own Brainstem.

Once connected: if I have a hatch key, wake my Brainstem with it; if not, hatch a new one, tell me the key to keep, and ask what I'd like it to do.`;
