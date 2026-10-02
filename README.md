# RemNote SDK Bridge

Part of [RemNote Direct](../../README.md). Run this page's development commands
from `packages/plugin`. [Native rollback acceptance remains blocked](../../docs/acceptance.md).

A RemNote plugin providing authenticated local access to the official Plugin SDK.

```text
remnote-cli <-> loopback WebSocket <-> SDK Bridge <-> RemNote SDK
```

The plugin owns SDK capabilities, permission enforcement, KB identity and bounded
serialization. The CLI owns business workflows such as flashcard plans, wiki
updates and journaling. New CLI workflows can reuse SDK capabilities without
changing this plugin.

No MCP server, business daemon, proxy or matching product version is required. The plugin
connects outward to the listener owned by each CLI command and waits between
commands. Keep RemNote open; the sidebar is optional.

## Local Setup

This direct protocol is a source candidate, not an assumed marketplace release.

```bash
npm ci
npm run build
node scripts/serve-dist.js --root dist --port 8090
```

Install `http://localhost:8090/` through **RemNote desktop**'s local-plugin development UI.
Use the literal `localhost` installer URL; keep the asset host bound to `127.0.0.1`.
See [the local guide](docs/guides/development-run-plugin-locally.md).
The static asset server must remain available to reload the local plugin after
restarting RemNote. It only serves built files, not business requests or credentials.

Pair using the [companion CLI](../cli/README.md), then set the plugin's
**CLI pairing token** to the private local token. Grant content access and the
separate **KnowledgeBaseInfo: Read** scope. Enable write/destructive gates only
when explicitly intended. Destructive commands also require CLI consent.

The independent plugin ID is `zeefan-remnote-sdk-bridge`. Install it separately:
reloading the old `zeefan-remnote-mcp-bridge` JavaScript does not update its granted
scopes. Keep the old plugin disabled after successful local acceptance. SDK,
permission or serialization changes may still need plugin updates; business-only
CLI changes do not. No old MCP client or command alias is retained.

For daily use, serve the verified build and the existing `serve-dist.js` from
`~/.local/share/remnote-sdk-bridge/` with a user LaunchAgent named
`com.remnote.sdk-bridge-assets`, bound to `127.0.0.1:8090`. Use the absolute Node
executable path. Do not serve the checkout, pairing files or test evidence.

## Development

```bash
./code-quality.sh
npm run check:sdk-capabilities
npm run build
```

The public SDK inventory is generated from installed `@remnote/plugin-sdk`
declarations. Do not hand-edit it or add dynamic calls outside the allowlist.
Callbacks, private SDK methods and persistent object handles cannot cross the
JSON boundary. Supported rich-text factories are materialized in one call.

Live tests run through the companion CLI's guarded wrapper after explicit
authorization. See [connection lifecycle](docs/guides/connection-lifecycle.md),
[architecture decision](docs/adr/0001-direct-cli.md),
[agent map](AGENTS.md) and [documentation index](docs/README.md).

MIT License. Derived from Robert Spiegel's RemNote MCP Bridge; retain [LICENSE](LICENSE).
