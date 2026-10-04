// RAPP Agent Builder — a ChatGPT app (MCP server over streamable HTTP, stateless JSON responses).
// ChatGPT's own model writes the agent; this server supplies the template, checks the result,
// searches the public RAR registry, and tells the user how to run it in their own Brainstem.

import { TEMPLATE } from "./template.js";

const SERVER = { name: "rapp-agent-builder", version: "1.1.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const REGISTRY_URL = "https://kody-w.github.io/RAR/registry.json";
const RAW_BASE = "https://raw.githubusercontent.com/kody-w/RAR/main/";
const SITE = "https://kody-w.github.io/rapp-chatgpt/";

const CATEGORIES = [
  "core", "pipeline", "integrations", "productivity", "devtools", "b2b_sales", "b2c_sales",
  "energy", "federal_government", "financial_services", "general", "healthcare",
  "human_resources", "it_management", "manufacturing", "professional_services", "retail_cpg",
  "slg_government", "software_digital_products",
];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const TOOLS = [
  {
    name: "get_agent_template",
    title: "Get the agent template",
    description:
      "Use this when the user wants to build an AI agent from an idea, a process description, or a meeting transcript. " +
      "Returns the official single-file RAPP agent template and its rules. Fill it in yourself from what the user described, " +
      "then call check_agent on the finished file before showing it to the user. Then call use_agent_here so the user can use it right away in this chat.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "check_agent",
    title: "Check an agent file",
    description:
      "Checks a finished RAPP agent file against the template rules (manifest, naming, class, perform method, no hardcoded secrets). " +
      "Call it on every agent you write, fix anything it reports, and call it again until it passes.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name, must end with _agent.py, e.g. invoice_triage_agent.py" },
        code: { type: "string", description: "The full Python source of the agent file" },
      },
      required: ["filename", "code"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "find_agents",
    title: "Find existing agents",
    description:
      "Searches the public RAPP Agent Registry (RAR, about 1,700 single-file agents) for agents that already do what the user wants. " +
      "Use it before building from scratch, or when the user asks whether an agent exists for a task.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain words describing the task, e.g. 'summarize sales calls'" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many results, default 5" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "get_agent_code",
    title: "Get an agent's code",
    description: "Returns the full source of one agent from the registry, by its name (e.g. @bill/neuron_agent), so it can be read or adapted.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Registry name, e.g. @kody/memory_agent" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "use_agent_here",
    title: "Use the agent in this chat",
    description:
      "Use this right after an agent passes check_agent, or whenever the user wants to try an agent. Returns a short Python runner so you can run the agent " +
      "in this chat with your own Python tool on the user's own data (pasted text, an uploaded spreadsheet, a list). Nothing to install. " +
      "Ask the user for their real data, run the agent, and show the result in plain words.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "The agent file name, e.g. invoice_triage_agent.py" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "how_to_run_agent",
    title: "Keep an agent running on your computer",
    description: "Optional, for later: how to keep an agent running on the user's own computer with the free RAPP Brainstem. Only offer this after the user has used the agent in the chat and wants to keep it.",
    inputSchema: {
      type: "object",
      properties: {
        os: { type: "string", enum: ["mac", "windows", "linux"], description: "The user's operating system" },
        filename: { type: "string", description: "The agent file name, if known" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

// ---------- tool implementations ----------

const RULES = [
  "One file. Everything goes in it. No extra files.",
  "File name must end with _agent.py and use snake_case (no dashes or spaces).",
  "Keep the __manifest__ block. Set name to @github_username/snake_name, plus version, display_name, description, author, tags and one category.",
  "Rename the class to match display_name with no spaces, and set self.name to the same value.",
  "perform() must always return a string, never None or a dict. Catch errors and return a message.",
  "No network calls in __init__().",
  "No hardcoded secrets. Read keys with os.environ.get() and list them in requires_env.",
  "Describe perform()'s inputs in self.metadata['parameters'] as a JSON schema so the Brainstem knows what to pass.",
];

function getTemplate() {
  return {
    text:
      "Fill in this template from what the user described. Rules:\n- " + RULES.join("\n- ") +
      "\n\nAllowed categories: " + CATEGORIES.join(", ") +
      "\n\nWhen done, call check_agent. Then call use_agent_here and offer to run it right now on the user's own data in this chat. Keeping it on their computer (how_to_run_agent) is optional and comes later." +
      "\n\n----- template_agent.py -----\n" + TEMPLATE,
    structured: { rules: RULES, categories: CATEGORIES, template: TEMPLATE },
  };
}

function manifestField(code, key) {
  const m = code.match(new RegExp(`["']${key}["']\\s*:\\s*(["'])(.*?)\\1`));
  return m ? m[2] : null;
}

// Body of a method: from its def line until the next line at the same or lower indent.
function methodBody(code, name) {
  const lines = code.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${name}\\s*\\(`).test(l));
  if (start < 0) return null;
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.match(/^\s*/)[0].length <= indent) break;
    out.push(l);
  }
  return out.join("\n");
}

export function checkAgent(filename, code) {
  const problems = [];
  const warnings = [];
  const fail = (s) => problems.push(s);

  if (!/^[a-z0-9_]+_agent\.py$/.test(filename || "")) fail("File name must be snake_case and end with _agent.py (e.g. invoice_triage_agent.py).");
  if (!code || !code.trim()) return { passed: false, problems: ["The file is empty."], warnings };
  if (code.length > 200_000) fail("The file is over 200 KB. Keep agents small and focused.");

  if (!/__manifest__\s*=\s*\{/.test(code)) fail("Missing the __manifest__ = { ... } block.");
  else {
    if (manifestField(code, "schema") !== "rapp-agent/1.0") fail('Manifest "schema" must be "rapp-agent/1.0".');
    const name = manifestField(code, "name");
    if (!name) fail('Manifest is missing "name".');
    else if (!/^@[A-Za-z0-9][A-Za-z0-9_-]*\/[a-z0-9_]+$/.test(name)) fail(`Manifest name "${name}" must look like @github_username/snake_case_name.`);
    else if (name.startsWith("@your_username")) fail("Replace @your_username in the manifest name with the user's GitHub username.");
    const version = manifestField(code, "version");
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('Manifest "version" must be like "1.0.0".');
    for (const k of ["display_name", "description", "author"]) {
      const v = manifestField(code, k);
      if (!v) fail(`Manifest is missing "${k}".`);
      else if (/^(Your Agent Name|Your Name|What your agent does in one sentence\.)$/.test(v)) fail(`Manifest "${k}" still has the template placeholder.`);
    }
    const cat = manifestField(code, "category");
    if (!cat) fail('Manifest is missing "category".');
    else if (!CATEGORIES.includes(cat)) warnings.push(`Category "${cat}" is not one of the template's: ${CATEGORIES.join(", ")}.`);
    if (!/["']tags["']\s*:\s*\[/.test(code)) fail('Manifest is missing a "tags" list.');
    else if (/["']keyword1["']/.test(code)) fail("Replace the placeholder tags (keyword1, keyword2).");
    if (!/["']dependencies["']\s*:\s*\[[^\]]*@rapp\/basic_agent/.test(code)) fail('Manifest "dependencies" must include "@rapp/basic_agent".');
  }

  if (!/from\s+(agents\.)?basic_agent\s+import\s+BasicAgent/.test(code)) fail("Missing the BasicAgent import (keep the try/except block from the template).");
  const cls = code.match(/^class\s+(\w+)\s*\(\s*BasicAgent\s*\)\s*:/m);
  if (!cls) fail("Missing a class that extends BasicAgent.");
  else if (cls[1] === "YourAgentName") fail("Rename the class from YourAgentName to match display_name.");

  const selfName = code.match(/self\.name\s*=\s*["']([^"']*)["']/);
  if (!selfName) fail("Set self.name in __init__.");
  else {
    if (/\s/.test(selfName[1])) fail(`self.name "${selfName[1]}" must not contain spaces.`);
    if (cls && selfName[1] !== cls[1]) warnings.push(`self.name "${selfName[1]}" differs from the class name "${cls[1]}". The template keeps them the same.`);
  }

  const perform = methodBody(code, "perform");
  if (perform === null) fail("Missing the perform(self, **kwargs) method.");
  else {
    if (!/\breturn\b/.test(perform)) fail("perform() never returns. It must return a string.");
    if (/\breturn\s*(None)?\s*$/m.test(perform)) fail("perform() has a bare return or returns None. It must return a string.");
    if (/\breturn\s*\{/.test(perform)) fail("perform() returns a dict. Convert it to a string (e.g. json.dumps).");
    if (/Hello from your new agent!/.test(perform)) fail("perform() still has the template placeholder logic.");
  }

  const init = methodBody(code, "__init__");
  if (init && /\b(requests\.|urllib|httpx\.|aiohttp|urlopen|socket\.)/.test(init)) fail("__init__() makes a network call. Move it into perform().");

  const secret = code.match(/^\s*\w*(key|token|secret|password)\w*\s*=\s*["'][A-Za-z0-9_\-]{16,}["']/im);
  if (secret) fail("Looks like a hardcoded secret. Read it with os.environ.get() and list it in requires_env.");
  if (/^[^#\n]*(os\.environ(\.get)?\s*[\[(]\s*["']|os\.getenv\s*\(\s*["'])/m.test(code) && /["']requires_env["']\s*:\s*\[\s*\]/.test(code)) warnings.push("The code reads environment variables but requires_env is empty. List them so users know what to set.");

  if (!/["']parameters["']\s*:/.test(code)) warnings.push("No parameters schema in self.metadata. The Brainstem won't know what inputs to pass.");

  return { passed: problems.length === 0, problems, warnings };
}

let registryCache = null;
async function loadRegistry() {
  if (registryCache && Date.now() - registryCache.at < 15 * 60_000) return registryCache.agents;
  const r = await fetch(REGISTRY_URL, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) throw new Error(`registry returned ${r.status}`);
  const d = await r.json();
  const agents = (d.agents || []).map((a) => ({
    name: a.name,
    display_name: a.display_name,
    description: a.description,
    tags: a.tags || [],
    category: a.category,
    author: a.author,
    version: a.version,
    file: a._file,
  }));
  registryCache = { at: Date.now(), agents };
  return agents;
}

export function searchAgents(agents, query, limit = 5) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const scored = agents.map((a) => {
    const title = `${a.display_name} ${a.name}`.toLowerCase();
    const tags = a.tags.join(" ").toLowerCase();
    const desc = (a.description || "").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 3;
      if (tags.includes(w)) s += 2;
      if (desc.includes(w)) s += 1;
    }
    return { a, s };
  });
  return scored.filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}

async function findAgents({ query, limit }) {
  const agents = await loadRegistry();
  const hits = searchAgents(agents, String(query || ""), Math.min(Math.max(limit || 5, 1), 10));
  if (!hits.length) {
    return { text: `No registry agents match "${query}". Offer to build one with get_agent_template.`, structured: { results: [] } };
  }
  const results = hits.map((a) => ({ ...a, code_url: a.file ? RAW_BASE + a.file : null }));
  const text = results.map((a, i) => `${i + 1}. ${a.display_name} (${a.name}) — ${a.description}`).join("\n") +
    "\n\nUse get_agent_code to read one, or how_to_run_agent to run it.";
  return { text, structured: { results } };
}

async function getAgentCode({ name }) {
  const agents = await loadRegistry();
  const a = agents.find((x) => x.name === name);
  if (!a || !a.file) return { text: `No agent named ${name} in the registry. Try find_agents.`, structured: { found: false }, isError: true };
  const r = await fetch(RAW_BASE + a.file, { cf: { cacheTtl: 900 } });
  if (!r.ok) return { text: `Could not load ${name} (status ${r.status}).`, structured: { found: false }, isError: true };
  const code = await r.text();
  return { text: `${a.display_name} (${a.name} v${a.version})\n\n${code}`, structured: { found: true, name: a.name, code_url: RAW_BASE + a.file, code } };
}

function useHere({ filename }) {
  const f = filename || "your_agent.py";
  const runner = [
    "import importlib.util, inspect, json",
    `spec = importlib.util.spec_from_file_location("agent", "${f}")  # save the agent file here first`,
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)",
    "Agent = next(c for _, c in inspect.getmembers(mod, inspect.isclass)",
    "             if c.__module__ == mod.__name__ and c.__name__ != 'BasicAgent' and hasattr(c, 'perform'))",
    "agent = Agent()",
    "args = {}  # fill from the user's data, matching agent.metadata['parameters']",
    "print(agent.perform(**args))",
  ].join("\n");
  const steps = [
    `Save the agent code to ${f} in your Python environment.`,
    "Ask the user for their real data if you don't have it yet (paste, upload, or a few rows). Offer a short sample only if they want to see it first.",
    "Run the runner below with args built from that data.",
    "Show the result in plain words. Don't show the runner unless they ask.",
    "Afterwards, mention they can keep the file and run it on their own computer any time (how_to_run_agent).",
  ];
  return {
    text: "Use the agent right here, nothing to install:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + "\n\n```python\n" + runner + "\n```",
    structured: { steps, runner },
  };
}

function howToRun({ os, filename }) {
  const f = filename || "your_agent.py";
  const install = os === "windows"
    ? "irm https://raw.githubusercontent.com/kody-w/rapp-installer/main/install.ps1 | iex"
    : "curl -fsSL https://kody-w.github.io/rapp-installer/install.sh | bash";
  const folder = os === "windows" ? "%USERPROFILE%\\.brainstem\\src\\rapp_brainstem\\agents\\" : "~/.brainstem/src/rapp_brainstem/agents/";
  const steps = [
    `Install the free RAPP Brainstem (one line, in ${os === "windows" ? "PowerShell" : "Terminal"}): ${install}`,
    "Sign in with GitHub when it asks. The Brainstem uses your existing GitHub Copilot access.",
    `Save the agent as ${f} in ${folder}`,
    "Open http://localhost:7071 and ask for what the agent does. The Brainstem picks it up automatically.",
  ];
  return {
    text: "Optional: keep this agent running on your own computer.\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + `\n\nMore: ${SITE}`,
    structured: { steps, install_command: install, agents_folder: folder },
  };
}

async function callTool(name, args) {
  switch (name) {
    case "get_agent_template": return getTemplate();
    case "check_agent": {
      const r = checkAgent(args.filename, args.code);
      const text = r.passed
        ? "PASSED. The agent follows the template rules." + (r.warnings.length ? "\nSuggestions:\n- " + r.warnings.join("\n- ") : "")
        : "NOT YET. Fix these and check again:\n- " + r.problems.join("\n- ") + (r.warnings.length ? "\nAlso:\n- " + r.warnings.join("\n- ") : "");
      return { text, structured: r };
    }
    case "find_agents": return findAgents(args);
    case "get_agent_code": return getAgentCode(args);
    case "use_agent_here": return useHere(args);
    case "how_to_run_agent": return howToRun(args);
    default: return null;
  }
}

// ---------- MCP JSON-RPC ----------

async function handleRpc(msg) {
  const { id, method, params = {} } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (id === undefined || id === null) return null; // notification: no response body
  switch (method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "Build single-file AI agents people can use immediately: get_agent_template, write the agent, check_agent until it passes, then use_agent_here to run it in this chat on the user's own data. Nothing to install. Use find_agents to reuse existing ones. how_to_run_agent is only for keeping an agent on their own computer later.",
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${params.name}`);
      try {
        const r = await callTool(params.name, params.arguments || {});
        return ok({ content: [{ type: "text", text: r.text }], structuredContent: r.structured, isError: !!r.isError });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${method}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    // OpenAI domain verification: serve exactly the token the plugin portal issues.
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      const token = env.OPENAI_APPS_CHALLENGE || globalThis.process?.env?.OPENAI_APPS_CHALLENGE;
      return token
        ? new Response(token.trim(), { headers: { "Content-Type": "text/plain" } })
        : new Response("not configured", { status: 404 });
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, server: SERVER, mcp: `${url.origin}/mcp`, site: SITE });
    }
    if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
    if (request.method === "GET") return new Response("SSE stream not offered; POST JSON-RPC to /mcp.", { status: 405, headers: { Allow: "POST", ...CORS } });
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handleRpc(body);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  },
};
