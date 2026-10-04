// RAPP Domains: agent-first domain names. Checking and pricing are free and keyless
// (public RDAP + Porkbun's public price list). Registration is paid per call over x402 and
// fulfilled through the Wildhaven Porkbun account; it stays off until PORKBUN_API_KEY is set.

const PRICES_URL = "https://api.porkbun.com/api/json/v3/pricing/get";
const RDAP = "https://rdap.org/domain/";
const MARGIN_PCT = 0.1; // our margin on the registrar's price
const MARGIN_FLAT = 2; // plus a flat fee per order, in USD
const MIN_YEARS = { ai: 2 }; // registries with a minimum first term

let priceCache = null;
async function prices() {
  if (priceCache && Date.now() - priceCache.at < 6 * 3600_000) return priceCache.p;
  const r = await fetch(PRICES_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cf: { cacheTtl: 21600 } });
  const d = await r.json();
  if (d.status !== "SUCCESS") throw new Error("price list unavailable");
  priceCache = { at: Date.now(), p: d.pricing };
  return d.pricing;
}

export function normalizeDomain(input) {
  const d = String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

export function quote(registrarPerYear, years) {
  const cost = Number(registrarPerYear) * years;
  return Math.round((cost * (1 + MARGIN_PCT) + MARGIN_FLAT) * 100) / 100;
}

// Availability from public registration data, asked of each registry directly via IANA's RDAP
// bootstrap file. 404 = no record = available to register.
const UA = { "User-Agent": "rapp-domains/1.0 (+https://kody-w.github.io/rapp-chatgpt/)", accept: "application/rdap+json" };
let bootstrap = null;
async function rdapBase(tld) {
  if (!bootstrap || Date.now() - bootstrap.at > 24 * 3600_000) {
    const d = await (await fetch("https://data.iana.org/rdap/dns.json", { headers: UA, cf: { cacheTtl: 86400 } })).json();
    const map = {};
    for (const [tlds, urls] of d.services) for (const t of tlds) map[t] = urls.find((u) => u.startsWith("https")) || urls[0];
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map[tld];
}

async function rdapStatus(domain) {
  try {
    const tld = domain.split(".").pop();
    const base = (await rdapBase(tld)) || "https://rdap.org/";
    const r = await fetch(`${base.replace(/\/?$/, "/")}domain/${domain}`, { redirect: "follow", headers: UA });
    if (r.status === 404) return "available";
    if (r.ok) return "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function checkDomains({ domains }) {
  const list = [...new Set((domains || []).map(normalizeDomain).filter(Boolean))].slice(0, 20);
  if (!list.length) return { text: "Give one or more full domain names, like getrapp.ai or myshop.com.", structured: { results: [] }, isError: true };
  const p = await prices();
  const results = await Promise.all(list.map(async (domain) => {
    const tld = domain.split(".").slice(1).join(".");
    const price = p[tld] || p[domain.split(".").pop()];
    const years = MIN_YEARS[tld] || 1;
    const status = await rdapStatus(domain);
    return {
      domain,
      status,
      years,
      price_usd: price ? quote(price.registration, years) : null,
      renewal_per_year_usd: price ? Math.round(Number(price.renewal) * (1 + MARGIN_PCT) * 100) / 100 : null,
      supported: !!price,
    };
  }));
  const line = (x) => x.status === "available"
    ? `${x.domain}: available, $${x.price_usd} for ${x.years} year${x.years > 1 ? "s" : ""} (renews at $${x.renewal_per_year_usd}/year)`
    : x.status === "taken" ? `${x.domain}: taken` : `${x.domain}: couldn't confirm, try again`;
  return {
    text: results.map(line).join("\n") + "\n\nTo buy one, use register_domain.",
    structured: { results },
  };
}

export function registerInfo({ domain }, site) {
  const d = normalizeDomain(domain);
  return {
    text:
      `To register ${d || "a domain"}:\n` +
      `- AI agents: pay per call over x402 at POST https://rapp-agent-builder.azurewebsites.net/x402/domains/register with {"domain":"${d || "example.com"}"}. ` +
      `The 402 response states the exact price in USDC; the domain is registered only after payment, and you are charged only if registration succeeds. ` +
      `x402 clients cap each payment at $1 by default, so raise your client's per-payment limit to cover the quoted price.\n` +
      `- People: ask at ${site}contact.html and we'll register it for you.`,
    structured: { domain: d, agent_endpoint: "/x402/domains/register", contact: `${site}contact.html` },
  };
}

// --- Fulfilment through Porkbun (paid path). Off until keys are set; dry run unless PORKBUN_LIVE=1.
function porkbunConfig(env = {}) {
  const get = (k) => env[k] || globalThis.process?.env?.[k];
  return { key: get("PORKBUN_API_KEY"), secret: get("PORKBUN_SECRET_KEY"), live: get("PORKBUN_LIVE") === "1", base: get("PORKBUN_BASE") || "https://api.porkbun.com/api/json/v3" };
}

export function fulfilmentReady(env) {
  return !!porkbunConfig(env).key;
}

export async function orderQuote(domain) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error("invalid domain");
  const [r] = (await checkDomains({ domains: [d] })).structured.results;
  if (r.status !== "available") throw new Error(`${d} is ${r.status}`);
  if (!r.price_usd) throw new Error(`.${d.split(".").pop()} is not supported`);
  return r;
}

export async function registerAtPorkbun(env, domain, years) {
  const c = porkbunConfig(env);
  const res = await fetch(`${c.base}/domain/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: c.key, secretapikey: c.secret, domain, years, dryRun: !c.live }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.status !== "SUCCESS") throw new Error(body.message || `registrar returned ${res.status}`);
  return { domain, years, dry_run: !c.live, registrar: "porkbun", registrar_response: body };
}
