# RemNote CLI Bridge

A RemNote desktop plugin that gives [remnote-cli](https://github.com/zeefan1555/remnote-cli) authenticated access to the official Plugin SDK on this machine.

```text
remnote-cli <-> loopback WebSocket (127.0.0.1) <-> RemNote CLI Bridge <-> RemNote SDK
```

The plugin exposes one official SDK method per call and passes the arguments through. The CLI composes those calls into workflows such as flashcards, outlines, and journals. Keep RemNote open while you use the CLI. The sidebar is optional and shows whether a command is connected.

Plugin id: `remnote-cli-bridge`. Product versions of the plugin and the CLI do not need to match. Protocol 1 does.

## Privacy

Knowledge-base content stays on this machine. The plugin talks only to the local CLI over `ws://127.0.0.1`. It does not send notes, cards, tokens, or usage data to a remote server. It has no telemetry.

The pairing token is a local secret. The plugin uses it to check HMAC proofs and never puts the token on the wire. Logs redact 64-character hex secrets. A local development asset server, when you use one, binds to `127.0.0.1` and serves the built plugin files only.

## Permissions

The manifest requests two scopes. RemNote asks you to approve them at install time.

| Scope | Level | Why it is requested |
| --- | --- | --- |
| `All` | `ReadCreateModifyDelete` | The CLI is a general client for the knowledge base you choose. Reads, new Rems, edits, and deletions all go through official SDK methods. The plugin still defaults **Accept write operations** and **Accept destructive operations** to off, and a destructive CLI command also requires its own consent. Narrower descendant or powerup scopes cannot cover an open-ended SDK gateway. |
| `KnowledgeBaseInfo` | `Read` | Each session is bound to the open knowledge base. The plugin reads that knowledge base's id and name so a switch stops further writes. The `All` content scope does not include this identity. |

`requestNative` is false. `enableOnMobile` is false. This plugin is for RemNote desktop.

## Install and pair

1. In **RemNote desktop**, open **Plugins** and install **RemNote CLI Bridge** (`remnote-cli-bridge`) from the marketplace.
2. Approve both scopes above. An older install of `zeefan-remnote-sdk-bridge` is a different plugin. Its grants do not apply here. Disable that older plugin after this one works.
3. Install [remnote-cli](https://github.com/zeefan1555/remnote-cli) and run its pairing command so it writes a private local token.
4. In the plugin settings, set **CLI pairing token** to that token. Leave the field and confirm the setting was saved. Do not put the token in screenshots, logs, or issues.
5. Set **CLI loopback WebSocket URL** to the CLI listener, `ws://127.0.0.1:<port>`. The default is `ws://127.0.0.1:3002`.
6. Leave the write gates off until you intend to change the knowledge base.

The sidebar says **Waiting for CLI** between commands and **CLI connected** while a command is running. Use **Reconnect** if the panel stays disconnected after you start a command.

### Local development install

```bash
npm ci
npm run build
node scripts/serve-dist.js --root dist --port 8090
```

In **Settings > Plugins > Build**, enter `http://localhost:8090/`. Use the literal hostname `localhost`. The asset host still binds to `127.0.0.1`. Confirm the manifest id is `remnote-cli-bridge`, then approve the scopes and pair as above.

For a retained local copy, serve `dist/` and `scripts/serve-dist.js` from `~/.local/share/remnote-cli-bridge/` with a user LaunchAgent named `com.remnote.cli-bridge-assets` on `127.0.0.1:8090`. Point the agent at an absolute Node path. That directory holds built files only: no pairing token, checkout, or test notes.

See [local setup](docs/guides/development-run-plugin-locally.md) and [connection lifecycle](docs/guides/connection-lifecycle.md).

## What the CLI must know about this rename

The handshake is unchanged. `challenge`, `hello`, and `ready` stay on protocol 1. `hello.identity` carries the protocol version, plugin version, SDK version, catalog hash, knowledge-base id and name, and the write gates. It does not carry the plugin id. Proof messages remain `cli:<nonce>` and `plugin:<nonce>:<JSON hello>`.

`get_status` returns `pluginId: "remnote-cli-bridge"`. Display-only clients need no protocol change. A client that requires `zeefan-remnote-sdk-bridge` must accept `remnote-cli-bridge`.

## Development

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:sdk-capabilities
npm run build
```

The public SDK inventory is generated from the installed `@remnote/plugin-sdk` declarations. Regenerate it with `npm run generate:sdk-capabilities` after an SDK upgrade. Callbacks, private SDK methods, and persistent object handles stay off the JSON boundary.

Live tests run from the [CLI repository](https://github.com/zeefan1555/remnote-cli) after you authorize them. See the [agent map](AGENTS.md) and the [documentation index](docs/README.md).

MIT License. Derived from Robert Spiegel's RemNote MCP Bridge. Retain [LICENSE](LICENSE) and [NOTICE](NOTICE.md).
