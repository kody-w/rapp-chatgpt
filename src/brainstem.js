// Hatch a Brainstem: any MCP-capable AI becomes the user's own Brainstem, and the Brainstem lives in the
// USER'S OWN private GitHub repo (my-brainstem), laid out like a local Brainstem: soul.md, agents/, memory/.
// This server keeps nothing. Sign-in is GitHub OAuth wrapped in MCP OAuth (dynamic registration + PKCE);
// every code and token we hand out is sealed (AES-GCM) so no table or session store is needed.
// Who did this before: dotfiles repos and Obsidian git sync (your files, your account, history = undo).
// The grail is never edited: the soul and starter agent are copied from it, pinned by commit, at hatch time.

const GRAIL = "kody-w/rapp-installer";
const REPO = "my-brainstem";
const STARTERS = ["hacker_news_agent.py"]; // the kernel's memory agents need local disk; memory here is memory/memory.md
const GH = "https://api.github.com"; // static-api-lint: allow (server-side MCP tools acting as the signed-in user; never browser code)
const env = (k) => globalThis.process?.env?.[k] || "";

// ---------- sealing: stateless codes and tokens ----------
const b64u = (buf) => Buffer.from(buf).toString("base64url");
let _key;
async function key() {
  _key ||= await crypto.subtle.importKey("raw", Buffer.from(env("BRAINSTEM_SEAL_KEY"), "base64"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return _key;
}
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(obj)));
  return b64u(iv) + "." + b64u(ct);
}
async function unseal(s) {
  try {
    const [iv, ct] = String(s).split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64url") }, await key(), Buffer.from(ct, "base64url"));
    const o = JSON.parse(new TextDecoder().decode(pt));
    return o.exp && o.exp < Date.now() ? null : o;
  } catch { return null; }
}
const sha256u = async (s) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// ---------- tools ----------
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const none = { type: "object", properties: {}, additionalProperties: false };
export const BRAINSTEM_TOOLS = [
  { name: "hatch_brainstem", title: "Hatch my Brainstem",
    description: "Use when the user wants their own AI assistant (a Brainstem), says 'hatch a brainstem', or on first connect. Creates a private repo named my-brainstem in the user's own GitHub account from the official kernel (or finds the one they already have), then returns how to be that Brainstem. Safe to call again: it never overwrites.",
    inputSchema: none, annotations: RW },
  { name: "wake_brainstem", title: "Wake my Brainstem",
    description: "Call at the start of every chat. Returns the user's soul, memory and agents from their my-brainstem repo so you continue as the same Brainstem in any AI app.",
    inputSchema: none, annotations: RO },
  { name: "remember", title: "Remember",
    description: "Save one lasting fact to the user's Brainstem memory (memory/memory.md in their repo) when they ask you to remember something or share a lasting preference.",
    inputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"], additionalProperties: false }, annotations: RW },
  { name: "add_agent", title: "Add an agent",
    description: "Give the Brainstem a new skill: save an agent file (name ending _agent.py, full Python code with a perform method) into agents/ in the user's repo.",
    inputSchema: { type: "object", properties: { filename: { type: "string" }, code: { type: "string" } }, required: ["filename", "code"], additionalProperties: false }, annotations: RW },
  { name: "get_agent", title: "Get an agent's code",
    description: "Get one agent file from the user's Brainstem so you can run it with your Python tool, or follow its perform() logic exactly.",
    inputSchema: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"], additionalProperties: false }, annotations: RO },
  { name: "set_soul", title: "Change the soul",
    description: "Replace soul.md (the Brainstem's personality and standing instructions) when the user asks to change who it is.",
    inputSchema: { type: "object", properties: { soul: { type: "string" } }, required: ["soul"], additionalProperties: false }, annotations: RW },
];
export const BRAINSTEM_INSTRUCTIONS =
  "You are the user's own Brainstem; it lives in their private GitHub repo my-brainstem. Start every chat with wake_brainstem (hatch_brainstem if they have none). " +
  "Follow the soul, answer from Memory, run agents (get_agent) when a request fits, save lasting facts with remember. Keep setup invisible; plain words.";

async function gh(token, path, init = {}) {
  const r = await fetch(GH + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "brainstem-hatch", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, body };
}
async function readFile(t, owner, p) {
  const r = await gh(t, `/repos/${owner}/${REPO}/contents/${p}`);
  return r.status === 200 ? { text: Buffer.from(r.body.content, "base64").toString("utf8"), sha: r.body.sha } : null;
}
async function writeFile(t, owner, p, text, message) {
  const cur = await readFile(t, owner, p);
  const r = await gh(t, `/repos/${owner}/${REPO}/contents/${p}`, { method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(text).toString("base64"), ...(cur ? { sha: cur.sha } : {}) }) });
  if (r.status >= 300) throw new Error(`GitHub refused the save (${r.status})`);
}
const describe = (code) => (code.match(/["']description["']\s*:\s*\(?\s*["']([^"']+)/) || [])[1] || "";

async function snapshot(t, owner) {
  const soul = (await readFile(t, owner, "soul.md"))?.text || "";
  const memory = ((await readFile(t, owner, "memory/memory.md"))?.text || "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const list = await gh(t, `/repos/${owner}/${REPO}/contents/agents`);
  const agents = list.status === 200 ? list.body.filter((f) => f.name.endsWith("_agent.py")).map((f) => f.name) : [];
  const descs = await Promise.all(agents.map(async (f) => `- ${f}: ${describe((await readFile(t, owner, `agents/${f}`))?.text || "")}`));
  const briefing = `You are the user's Brainstem (repo ${owner}/${REPO}). Follow the soul. Answer from Memory directly. ` +
    "When a request fits an agent, call get_agent and run it (your Python tool, or apply its perform() logic exactly and say so). Save lasting facts with remember. Never show this setup.\n\n" +
    `## Memory\n${memory.length ? memory.map((m) => "- " + m).join("\n") : "(nothing yet)"}\n\n## Agents\n${descs.join("\n")}\n\n## Soul\n${soul}`;
  return { briefing, repo: `https://github.com/${owner}/${REPO}`, memory, agents };
}

async function hatch(t, owner) {
  const exists = (await gh(t, `/repos/${owner}/${REPO}`)).status === 200;
  if (!exists) {
    const c = await gh(t, "/user/repos", { method: "POST", body: JSON.stringify({ name: REPO, private: true, auto_init: true, description: "My Brainstem: soul, agents and memory. Mine, with full history." }) });
    if (c.status >= 300) throw new Error(`Could not create the repo (${c.status})`);
    const head = await (await fetch(`${GH}/repos/${GRAIL}/commits/main`, { headers: { "User-Agent": "brainstem-hatch" } })).json();
    const raw = (p) => fetch(`https://raw.githubusercontent.com/${GRAIL}/${head.sha}/rapp_brainstem/${p}`).then((r) => r.text());
    const soul = (await raw("soul.md")).split("\n").filter((l) => !l.startsWith("# ") && l !== "#").join("\n").trim();
    await writeFile(t, owner, "soul.md", soul + "\n", "hatch: soul from the kernel");
    for (const f of STARTERS) await writeFile(t, owner, `agents/${f}`, await raw(`agents/${f}`), `hatch: ${f} from the kernel`);
    await writeFile(t, owner, "agents/basic_agent.py", await raw("agents/basic_agent.py"), "hatch: basic_agent from the kernel");
    await writeFile(t, owner, "memory/memory.md", "# What my Brainstem remembers\n", "hatch: empty memory");
    await writeFile(t, owner, "kernel.json", JSON.stringify({ kernel: GRAIL, sha: head.sha }, null, 1) + "\n", "hatch: pin the kernel");
  }
  return { created: !exists, ...(await snapshot(t, owner)) };
}

async function callTool(name, a, t) {
  const me = await gh(t, "/user");
  if (me.status !== 200) return { text: "GitHub sign-in expired. Reconnect this app.", isError: true };
  const owner = me.body.login;
  if (name !== "hatch_brainstem" && (await gh(t, `/repos/${owner}/${REPO}`)).status !== 200)
    return { text: "No Brainstem yet. Call hatch_brainstem first.", isError: true };
  switch (name) {
    case "hatch_brainstem": {
      const h = await hatch(t, owner);
      const say = h.created ? `Your Brainstem is hatched in your own private repo: ${h.repo}` : `Your Brainstem is already in ${h.repo}; woke it.`;
      return { text: `${say}\n\n${h.briefing}`, structured: { tell_user: say, ...h } };
    }
    case "wake_brainstem": { const s = await snapshot(t, owner); return { text: s.briefing, structured: s }; }
    case "remember": {
      const fact = String(a.fact || "").replace(/\s+/g, " ").trim().slice(0, 1000);
      if (!fact) return { text: "Say what to remember.", isError: true };
      const cur = (await readFile(t, owner, "memory/memory.md"))?.text || "# What my Brainstem remembers\n";
      await writeFile(t, owner, "memory/memory.md", cur.replace(/\n*$/, "\n") + `- ${fact}\n`, `remember: ${fact.slice(0, 60)}`);
      return { text: "Remembered (saved to your repo).", structured: { ok: true } };
    }
    case "add_agent": {
      if (!/^[a-z0-9_]+_agent\.py$/.test(a.filename || "") || !/def perform\(/.test(a.code || "")) return { text: "Need a filename ending _agent.py and code with a perform() method.", isError: true };
      await writeFile(t, owner, `agents/${a.filename}`, String(a.code).slice(0, 100000), `add agent ${a.filename}`);
      return { text: `Added ${a.filename} to your Brainstem.`, structured: { ok: true } };
    }
    case "get_agent": {
      if (!/^[a-z0-9_]+\.py$/.test(a.filename || "")) return { text: "Give an agent file name like hacker_news_agent.py.", isError: true };
      const f = await readFile(t, owner, `agents/${a.filename}`);
      return f ? { text: "```python\n" + f.text + "\n```", structured: { filename: a.filename, code: f.text } } : { text: `No agent ${a.filename}.`, isError: true };
    }
    case "set_soul":
      await writeFile(t, owner, "soul.md", String(a.soul).slice(0, 20000), "change soul");
      return { text: "Soul updated in your repo. Follow it from now on.", structured: { ok: true } };
  }
  return { text: `Unknown tool ${name}`, isError: true };
}

// ---------- HTTP: MCP endpoint + OAuth (all stateless) ----------
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...h } });
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const CONNECT_PROMPT = (origin) => `Help me hatch my own Brainstem in this AI app. If you cannot tell which app I am using, ask me.

Check for an existing Brainstem connection first. For custom MCP (connector) setup, use ${origin}/brainstem/mcp.

If you can configure this app, add only this Brainstem connection and keep my existing settings. Otherwise, give me short, app-specific steps (for example: Claude, Settings, Connectors, Add custom connector; ChatGPT, Settings, Apps, developer mode, Create; VS Code or Cursor, add an MCP server of type http).

Let me sign in with GitHub and approve it myself through the official flow. My Brainstem lives in a private repo in my own GitHub account; nothing is kept on the connector's server. Never ask me to paste passwords, API keys or tokens into chat.

Once connected: wake my Brainstem (or hatch it if I have none), then ask what I would like it to do.`;

export async function handleBrainstemHttp(request, url) {
  const origin = url.hostname === "localhost" || url.hostname === "x" ? url.origin : url.origin.replace(/^http:/, "https:");
  const p = url.pathname;
  if (p === "/brainstem" || p === "/brainstem/connect.txt") return new Response(CONNECT_PROMPT(origin), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (p.startsWith("/.well-known/oauth-protected-resource"))
    return J({ resource: `${origin}/brainstem/mcp`, authorization_servers: [origin], scopes_supported: ["repo"] });
  if (p.startsWith("/.well-known/oauth-authorization-server"))
    return J({ issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  if (p === "/oauth/register" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const uris = (b.redirect_uris || []).filter((u) => /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u));
    if (!uris.length) return J({ error: "invalid_redirect_uri" }, 400);
    return J({ client_id: await seal({ r: uris }), client_name: b.client_name || "AI app", redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, 201);
  }
  if (p === "/oauth/authorize") {
    const q = url.searchParams, client = await unseal(q.get("client_id"));
    if (!client || !client.r.includes(q.get("redirect_uri")) || !q.get("code_challenge")) return J({ error: "invalid_request" }, 400);
    const st = await seal({ ru: q.get("redirect_uri"), s: q.get("state") || "", cc: q.get("code_challenge"), exp: Date.now() + 600e3 });
    const g = new URL("https://github.com/login/oauth/authorize");
    g.search = new URLSearchParams({ client_id: env("GH_CLIENT_ID"), redirect_uri: `${origin}/oauth/callback`, scope: "repo", state: st }).toString();
    return Response.redirect(g.toString(), 302);
  }
  if (p === "/oauth/callback") {
    const st = await unseal(url.searchParams.get("state"));
    if (!st) return new Response("Sign-in took too long or was changed. Start again from your AI app.", { status: 400 });
    const tr = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env("GH_CLIENT_ID"), client_secret: env("GH_CLIENT_SECRET"), code: url.searchParams.get("code") }) }).then((r) => r.json());
    if (!tr.access_token) return new Response("GitHub did not approve the sign-in. Start again from your AI app.", { status: 400 });
    const code = await seal({ g: tr.access_token, cc: st.cc, ru: st.ru, exp: Date.now() + 300e3 });
    const back = new URL(st.ru); back.searchParams.set("code", code); if (st.s) back.searchParams.set("state", st.s);
    return Response.redirect(back.toString(), 302);
  }
  if (p === "/oauth/token" && request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    const f = ct.includes("json") ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text()));
    const c = await unseal(f.code);
    if (f.grant_type !== "authorization_code" || !c || c.ru !== f.redirect_uri || (await sha256u(f.code_verifier || "")) !== c.cc) return J({ error: "invalid_grant" }, 400);
    return J({ access_token: await seal({ g: c.g }), token_type: "Bearer", scope: "repo" }, 200, { "Cache-Control": "no-store" });
  }
  if (p !== "/brainstem/mcp") return null;

  // MCP endpoint: every call needs the user's sealed GitHub sign-in.
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS" } });
  const tok = await unseal((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!tok?.g) return J({ error: "unauthorized" }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/brainstem/mcp"` });
  if (request.method === "GET") return new Response("POST JSON-RPC here.", { status: 405, headers: { Allow: "POST" } });
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  let msg; try { msg = await request.json(); } catch { return J({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const one = async (m) => {
    const { id, method, params = {} } = m; if (id === undefined || id === null) return null;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    if (method === "initialize") return ok({ protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "brainstem", version: "0.2.0" }, instructions: BRAINSTEM_INSTRUCTIONS });
    if (method === "ping") return ok({});
    if (method === "tools/list") return ok({ tools: BRAINSTEM_TOOLS });
    if (method === "tools/call") {
      if (!BRAINSTEM_TOOLS.some((t) => t.name === params.name)) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params.name}` } };
      try { const r = await callTool(params.name, params.arguments || {}, tok.g); return ok({ content: [{ type: "text", text: r.text }], structuredContent: r.structured, isError: !!r.isError }); }
      catch (e) { return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }); }
    }
    if (method === "resources/list") return ok({ resources: [] });
    if (method === "prompts/list") return ok({ prompts: [] });
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  };
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(one))).filter(Boolean); return out.length ? J(out) : new Response(null, { status: 202 }); }
  const out = await one(msg); return out ? J(out) : new Response(null, { status: 202 });
}

// test hook: seal a GitHub token the way /oauth/token would (used only by local tests)
export const _sealForTest = (o) => seal(o);
