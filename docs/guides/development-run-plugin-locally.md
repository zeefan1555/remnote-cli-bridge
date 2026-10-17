# Run The Plugin Locally

Use Node.js >= 22.13.0, with Node.js 24 recommended.

```bash
npm ci
./code-quality.sh
npm run build
node scripts/serve-dist.js --root dist --port 8090
```

The last command serves production assets without hot reload. Choose another port
when 8090 is occupied during development; never stop an unknown listener. For
the approved local adoption, 8090 is the fixed asset endpoint; identify its owner
before changing it. The file-only host must remain available across desktop restarts.

In **RemNote desktop**, open **Settings > Plugins > Build**, choose the local
development option and enter `http://localhost:8090/`. Verify the manifest ID is
`remnote-cli-bridge` and install it independently of the old MCP plugin and of
the previous `zeefan-remnote-sdk-bridge` id.
Use the literal `localhost` URL here: the desktop installer can register the
numeric loopback URL as a non-local plugin without loading its local widgets.
The asset host still binds only to `127.0.0.1`. Confirm the installed plugin is
listed under **Build** with the local URL and that its SDK settings appear.
Approve both `All: ReadCreateModifyDelete` and `KnowledgeBaseInfo: Read`;
content access alone does not include knowledge-base identity. A new plugin ID
has separate settings, so its pairing token and write gate must be set explicitly.

Pair the [CLI](https://github.com/zeefan1555/remnote-cli/blob/master/docs/guides/installation.md) with the
intended KB. Set **CLI pairing token** from the private pairing file, use the
matching loopback WebSocket port, and enable writes only when authorized.
The token is private; never put it in screenshots, logs or issue reports.
Commit the token through normal typing/paste and leave the input before checking
status. A populated text field alone does not prove that the SDK setting was saved.

After a source or WebSocket URL change, reload the plugin before testing. A
manifest/permission change must also be applied to the installed plugin; reloading
JavaScript alone does not grant new scopes.

From a checkout of https://github.com/zeefan1555/remnote-cli:

```bash
./run-agent-integration-test.sh --preflight-only
./run-agent-integration-test.sh --yes --command status --text
./run-agent-integration-test.sh --yes --transactions-only
```

Keep the RemNote session open. The sidebar normally says **Waiting for CLI**
between commands. CLI/plugin product versions need not match.

For hot reload, `npm run dev` is still available. Use the production build for
acceptance and record asset hashes. For temporary tests, restore the previous
environment afterward. The approved local adoption instead retains the new
plugin/CLI on success and restores the recorded environment only on failure.

Daily local hosting uses a verified copy of `dist/` and `scripts/serve-dist.js`
under `~/.local/share/remnote-cli-bridge/`, served by the user LaunchAgent
`com.remnote.cli-bridge-assets` on `127.0.0.1:8090`. Configure `RunAtLoad`,
`KeepAlive`, an absolute Node path and absolute asset/script paths. The host
directory must not contain pairing config, source checkout or private evidence.
Before acceptance, restart this host and RemNote, then re-read the exact card
IDs and transaction test IDs through the guarded wrapper. Do not restart the
old MCP service on success. Local hosting requires no plugin upload/publication.
