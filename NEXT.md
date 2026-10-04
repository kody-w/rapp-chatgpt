# When OpenAI approves the account

Checkpoint `v1.2.0`. Three listings, one server. Everything below is ready; nothing is waiting on code.

| Piece | State |
|---|---|
| MCP server | Live on Azure Functions (personal subscription, rg `rapp-chatgpt`): https://rapp-agent-builder.azurewebsites.net/mcp — v1.1.1, 6 tools |
| Site, privacy, terms | https://kody-w.github.io/rapp-chatgpt/ |
| Demo video | https://kody-w.github.io/rapp-chatgpt/demo.mp4 (set as `review.demo_recording_url`) |
| Listings | `openai-plugin/` RAPP Agent Builder (`/mcp`), `openai-plugin-finder/` RAR Agent Finder (`/finder/mcp`), `openai-plugin-world/` DOGG World Check (`/world/mcp`) |
| Plugin ZIPs | Attached to the latest GitHub release; rebuild with the command below |
| Other assistants | Claude Code marketplace (`.claude-plugin/`), MCP Registry manifests (`registry/`) |
| Verification | Business check (Persona) submitted 2026-10-04, pending |

## Steps

1. Kody: confirm the organization shows **Verified** at platform.openai.com → Settings → Organization.
2. Kody: drag each ZIP onto platform.openai.com/plugins → "Upload new or existing plugin" (builder first; finder and world after it is accepted, one a week).
3. Copy the domain-verification token the portal shows, then:
   ```bash
   AZURE_CONFIG_DIR=~/.azure-personal az functionapp config appsettings set \
     -g rapp-chatgpt -n rapp-agent-builder --settings OPENAI_APPS_CHALLENGE=<token>
   curl https://rapp-agent-builder.azurewebsites.net/.well-known/openai-apps-challenge   # must print exactly the token
   ```
4. Fix anything the automated checks flag. Server changes: `azure/deploy.sh`. Package changes: bump `version` in `openai-plugin/plugin.json`, rebuild the ZIP, re-upload.
5. Kody: Submit for review, then Publish once approved.

## Before submitting (optional, recommended)

- Refresh the developer-mode plugin in ChatGPT so it picks up `use_agent_here`, run test case 2 from `plugin.json`, and confirm the tool is called.
- Re-record `docs/demo.mp4` to show the "use it in the chat" flow instead of the install steps.

## Commands

```bash
for d in openai-plugin openai-plugin-finder openai-plugin-world; do (cd $d && zip -qr -X ../$d.zip plugin.json mcp.json assets); done   # build the ZIPs
node --test test/plugin_package.test.mjs          # listing limits
node test/check_real_agents.mjs ../RAR            # checker vs. every registry agent
test/mcp_smoke.sh https://rapp-agent-builder.azurewebsites.net
AZURE_CONFIG_DIR=~/.azure-personal az login --use-device-code --tenant wildfeueroutlook.onmicrosoft.com   # if the az session expires
```

The default `az` login on this Mac is the Microsoft work tenant. Always use `AZURE_CONFIG_DIR=~/.azure-personal`; `azure/deploy.sh` does, and refuses an @microsoft.com account.

## Other directories (no OpenAI approval needed)

- **Claude Code:** `/plugin marketplace add kody-w/rapp-chatgpt`, then `/plugin install rapp-agent-builder@rapp` (or `rar-agent-finder@rapp`, `dogg-world-check@rapp`).
- **Claude.ai / any MCP client:** add a custom connector with the server URL, no auth.
- **MCP Registry:** PUBLISHED 2026-10-04, all three active as `io.github.kody-w/{rapp-agent-builder,rar-agent-finder,dogg-world-check}`. Bump `version` and rerun `mcp-publisher publish registry/<name>.server.json` on changes (login: `mcp-publisher login github`, device code).
- **Glama:** imports from the official registry. Once https://glama.ai/mcp/connectors/io.github.kody-w/rapp-agent-builder stops returning 404, open the PR to punkpeye/awesome-remote-mcp-servers (entry format in its CONTRIBUTING.md: name linked to the website, endpoint in backticks, Glama badge line, `🔓 - ` one-sentence description ≤120 chars; add 🤖🤖🤖 to the PR title).
- **Smithery, mcp.so:** need Kody's sign-in on their sites; submit the three server URLs.
- **Anthropic connector directory:** submission form, Kody.

## Agent-readable discovery (live)

- `https://rapp-agent-builder.azurewebsites.net/llms.txt`, `/.well-known/mcp.json`, `/.well-known/agent-card.json` (A2A 1.0 + 0.3), JSON-RPC at `/a2a` (`SendMessage` and `message/send`). Copies in `docs/` and `docs/.well-known/` take effect at a custom domain's root.
