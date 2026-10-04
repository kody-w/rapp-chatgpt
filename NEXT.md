# When OpenAI approves the account

Checkpoint `v1.1.1`. Everything below is ready; nothing is waiting on code.

| Piece | State |
|---|---|
| MCP server | Live on Azure Functions (personal subscription, rg `rapp-chatgpt`): https://rapp-agent-builder.azurewebsites.net/mcp — v1.1.1, 6 tools |
| Site, privacy, terms | https://kody-w.github.io/rapp-chatgpt/ |
| Demo video | https://kody-w.github.io/rapp-chatgpt/demo.mp4 (set as `review.demo_recording_url`) |
| Plugin ZIP | Attached to the `v1.1.1` GitHub release; rebuild with the command below |
| Verification | Business check (Persona) submitted 2026-10-04, pending |

## Steps

1. Kody: confirm the organization shows **Verified** at platform.openai.com → Settings → Organization.
2. Kody: drag the ZIP onto platform.openai.com/plugins → "Upload new or existing plugin".
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
(cd openai-plugin && zip -qr -X ../rapp-agent-builder-plugin.zip plugin.json mcp.json assets)   # build the ZIP
node --test test/plugin_package.test.mjs          # listing limits
node test/check_real_agents.mjs ../RAR            # checker vs. every registry agent
test/mcp_smoke.sh https://rapp-agent-builder.azurewebsites.net
AZURE_CONFIG_DIR=~/.azure-personal az login --use-device-code --tenant wildfeueroutlook.onmicrosoft.com   # if the az session expires
```

The default `az` login on this Mac is the Microsoft work tenant. Always use `AZURE_CONFIG_DIR=~/.azure-personal`; `azure/deploy.sh` does, and refuses an @microsoft.com account.
