// Stored test: the ChatGPT plugin package stays within OpenAI's listing rules.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
const read = (p) => JSON.parse(readFileSync(new URL(`../openai-plugin/${p}`, import.meta.url), "utf8"));

test("package fits OpenAI's listing limits", () => {
  const plugin = read("plugin.json");
  const servers = Object.values(read("mcp.json").mcpServers);
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0], { type: "streamable-http", url: "https://rapp-agent-builder.azurewebsites.net/mcp" });
  const ui = plugin.extensions["com.openai"].interface;
  assert.ok(ui.displayName.length <= 30 && ui.shortDescription.length <= 30 && ui.longDescription.length <= 4000);
  assert.ok(ui.developerName.length <= 80);
  assert.ok(ui.defaultPrompt.every((p) => p.length <= 128));
  assert.ok(ui.capabilities.every((c) => c.length <= 120));
  for (const u of [ui.websiteURL, ui.supportURL, ui.privacyPolicyURL, ui.termsOfServiceURL]) assert.match(u, /^https:\/\//);
  for (const f of [ui.logo, ui.composerIcon]) assert.ok(existsSync(new URL(`../openai-plugin/${f.slice(2)}`, import.meta.url)), f);
  const t = plugin.extensions["com.openai"].review.test_cases;
  assert.equal(t.positive.length, 5);
  assert.equal(t.negative.length, 3);
});
