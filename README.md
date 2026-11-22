# RemNote CLI Bridge

RemNote CLI Bridge is the desktop plugin that lets [remnote-cli](https://github.com/zeefan1555/remnote-cli)
use RemNote's official Plugin SDK on the same machine. It is the only bridge between the CLI and
RemNote: the CLI owns commands and workflows, while the plugin translates individual operations to
official SDK calls.

```text
remnote-cli <-> fixed loopback connection <-> RemNote CLI Bridge <-> official RemNote SDK
                                                                  |
                                                                  +-> active knowledge base
```

The Bridge runs inside RemNote desktop. It does not contain a workflow engine, MCP server, resident
daemon, or remote relay. Keep RemNote open while using the CLI. The sidebar is optional; it is a
connection monitor, not a setup wizard.

## Requirements

- RemNote desktop with the **RemNote CLI Bridge** plugin enabled.
- [remnote-cli](https://github.com/zeefan1555/remnote-cli) installed from source. The CLI currently
  requires Node.js 22.13.0 or newer.
- The Bridge source build requires Node.js 20.19.0 or newer; building both projects therefore needs
  the CLI's Node.js 22.13.0 baseline.
- Both sides on Bridge Protocol 2. Plugin and CLI product version numbers do not need to match.

## Install

### 1. Install the plugin from RemNote

1. In **RemNote desktop**, open **Plugins**.
2. Install **RemNote CLI Bridge**. The plugin ID is `remnote-cli-bridge`.
3. Approve both official RemNote scopes when RemNote asks.

| Scope | Level | Why it is required |
| --- | --- | --- |
| `All` | `ReadCreateModifyDelete` | Exposes official SDK operations for the current knowledge base. The Bridge must support both reads and user-authorized changes. |
| `KnowledgeBaseInfo` | `Read` | Identifies the currently open knowledge base so each command is bound to the right KB. The content scope does not provide this identity. |

These are RemNote's scopes, not a second Bridge permission system. The plugin is desktop-only and
does not request native transactions.

If a separately installed older bridge is present, disable it after this plugin and CLI work. Its
permissions and plugin identity do not transfer to `remnote-cli-bridge`.

### 2. Install the CLI from source

Use Node.js 22.13.0 or newer. Node.js 24 is recommended by the CLI.

```bash
git clone https://github.com/zeefan1555/remnote-cli.git
cd remnote-cli
npm ci
npm run build
./link-cli.sh
remnote-cli --version
```

`./link-cli.sh` registers `remnote-cli` with the current npm prefix and refuses to overwrite an
unrelated global installation. Run `./unlink-cli.sh` in the same checkout to remove the link.

## Verify the real connection

Run the CLI while RemNote is open:

```bash
remnote-cli status --text
```

`status` opens a real Bridge session; it does not infer success from the presence of a plugin or a
configuration file. The `--text` output shows the Bridge connection state and plugin version, plugin
ID, CLI version when available, active knowledge-base name and ID, Bridge Protocol, SDK version,
`Native transactions: unavailable (SDK cannot acknowledge abort)` when transactions are disabled,
and any authorization error.

The SDK catalog hash and the boolean `nativeTransactions: false` are available only in JSON output:

```bash
remnote-cli status --json
```

Do not continue troubleshooting a CLI command until `status` succeeds. It tests the connection,
protocol, active knowledge-base identity, and live SDK catalog together.

## Daily use

The plugin starts when RemNote starts and keeps reconnecting to the fixed local endpoint. The CLI
creates a short-lived session for each command, so the normal states are:

| State | Meaning |
| --- | --- |
| **Waiting for CLI** | Expected between commands. No CLI command currently owns the port. |
| **CLI connected** | A CLI command is using the Bridge. It is normally visible only during that command. |
| **Disconnected with an error** | Open the sidebar log, bring RemNote to the foreground, and run a read-only `status` check. |

Example commands:

```bash
remnote-cli status --text
remnote-cli search "project notes"
remnote-cli read REM_ID --content-mode structured --depth 1
remnote-cli list-children PARENT_REM_ID
```

JSON is the default CLI output; add `--text` for a human-readable response. Consecutive commands
create separate sessions. Use `remnote-cli batch --file FILE` when a series of dependent commands
must share one connection and avoid colliding on the local port.

A lost response does not prove that a write did not happen. Preserve returned IDs and any recovery
journal, then read those exact objects back before retrying.

## Zero-configuration model

There is nothing to initialize or pair in the Bridge.

| Setting | Current behavior |
| --- | --- |
| Bridge protocol | Protocol 2 only |
| Endpoint | Fixed local endpoint at `127.0.0.1:3002` |
| Pairing token | None |
| URL setting | None |
| Knowledge-base setting | None; every connection uses RemNote's active KB |
| Write or destructive permission setting | None in the Bridge |
| Mobile support | Disabled |
| Native transactions | Unavailable |

The CLI may accept one-shot options such as `--kb-id` as assertions about the command's target.
Those options are guards in the CLI, not persisted Bridge settings or ways to connect elsewhere.
High-risk CLI operations still require their own explicit confirmation, such as
`--allow-destructive`; there is no separate Bridge write switch to enable.

## Active knowledge base and KB switching

Each CLI command binds to the knowledge base that is active when its session starts. Use
`remnote-cli status --text` to see that KB before a sensitive operation.

If the active knowledge base changes while a command is running, the Bridge detects the change and
stops later SDK calls from that session. It does not silently retarget the command to the new KB.
An SDK operation that has already started may still finish because native cancellation is not
available. After switching:

1. Keep any returned IDs and inspect any uncertain write in the intended knowledge base.
2. Run `remnote-cli status --text` again to confirm the new active KB.
3. Start a new command only after checking the KB name and ID.

Use `--kb-id ID` when a command must fail rather than touch a different active KB.

## Privacy and trust boundary

Knowledge-base content stays on the local machine. The plugin connects only to the companion CLI on
localhost, does not send notes, cards, search results, or usage data to a remote service, and has no
telemetry.

The trust boundary is the current operating-system user. After the plugin is installed and the
official scopes are approved, programs running as that user can request the exposed SDK capabilities.
There is no per-process authentication or pairing secret. The CLI rejects ordinary webpage use of
its local endpoint, but that is not isolation from a compromised native program running as the same
user.

The `All: ReadCreateModifyDelete` scope is broad by design because the plugin is an open-ended SDK
gateway. Install it only when you intend to trust `remnote-cli` and local processes running under
your account with this access.

## Install a local source build

Use this path to test unreleased plugin changes in RemNote desktop. Keep the production marketplace
install for normal use unless you intentionally need a local build.

```bash
npm ci
npm run build
node scripts/serve-dist.js --root dist --port 8090
```

The build creates `dist/` and `PluginZip.zip`. Only `dist/` is served locally. The static asset host
binds to `127.0.0.1:8090`, including when the plugin URL uses the hostname `localhost`.

In **RemNote desktop**:

1. Open **Settings > Plugins > Build**.
2. Enter `http://localhost:8090/`. Use the literal hostname `localhost`; RemNote can treat the
   numeric URL as a non-local plugin and fail to load its widgets.
3. Confirm that the manifest ID is `remnote-cli-bridge`.
4. Install the local build and approve both scopes.
5. Keep the asset host running while RemNote uses the local plugin.

Check that the asset host is reachable with `curl http://127.0.0.1:8090/`. The static server is not
the Bridge connection endpoint: it only serves built plugin files. For source-only changes, rebuild
`dist/` and reload the plugin. If the manifest or requested scopes changed, reinstall the Build
plugin; reloading JavaScript alone cannot grant new permissions.

See [local setup](docs/guides/development-run-plugin-locally.md) and the
[connection lifecycle](docs/guides/connection-lifecycle.md) for retained development hosting.

## Troubleshooting

### The sidebar says "Waiting for CLI"

This is the normal idle state between commands. Run `remnote-cli status --text`. The status changes
to **CLI connected** only while that command has an open session.

If status cannot connect:

- keep RemNote open and confirm **RemNote CLI Bridge** is enabled;
- use RemNote desktop, not an unrelated browser tab;
- bring RemNote to the foreground and retry once;
- use the sidebar **Reconnect** button if it still reports a stale disconnect;
- wait for the CLI's 15-second connection window on a heavily throttled or sleeping machine.

### The local port is occupied

Only one CLI command can own the fixed port at a time. Batch dependent work instead of starting
overlapping commands. To identify the current listener:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

Wait for a legitimate command to finish. Do not kill an unknown process. Stop an obsolete companion
only after confirming what owns it and obtaining any required authorization.

### Permission errors

`All: ReadCreateModifyDelete` and `KnowledgeBaseInfo: Read` are separate grants. Even a read-only
status check needs the knowledge-base identity permission. Review the installed plugin's permissions
in RemNote, and reinstall the plugin if the permission prompt cannot be reproduced. Restarting
RemNote after approval ensures the new grant is active. The sidebar can show the exact authorization
error reported by RemNote.

### The knowledge base changed

A message such as `Knowledge base changed; session stopped` means the command was bound to the KB
that was active when it began. Check the new KB with `remnote-cli status --text`, then start a fresh
command. Do not reuse an old KB ID merely to suppress the error.

### Protocol or SDK catalog mismatch

Update both the plugin and CLI. Protocol 2 is mandatory, but the product version numbers do not have
to match. `status` must report the plugin ID, protocol 2, and a compatible live SDK catalog. For a
local build, rebuild and reload the plugin after changing its source.

### Localhost access is blocked

A marketplace install does not need a localhost plugin URL. For a source build, make sure the asset
server is running, load `http://localhost:8090/` in **Build**, and verify it separately with
`curl http://127.0.0.1:8090/`. If a browser-based environment or embedded webview reports a
localhost or private-network permission problem, review that environment's site permission and use
RemNote desktop. Do not disable browser security protections to make the local plugin load.

## Version compatibility

- **Bridge Protocol 2 is required on both sides.** A CLI and plugin on different protocols cannot
  form a session.
- **Product versions are informational.** Plugin `0.26.x` and CLI versions do not need to be equal.
- **The SDK catalog must match.** The CLI checks the live capability catalog and catalog hash. An SDK
  upgrade may require rebuilding both projects.
- **Native transactions are disabled.** SDK 0.0.46 cannot safely acknowledge a rejected callback, so
  begin/end transaction requests fail before any native transaction opens. A disconnected or timed-out
  call does not abort work that already started and cannot provide rollback.

After any plugin, CLI, or SDK upgrade, run `remnote-cli status --text` before another write. For local
source work, rebuild the CLI, rebuild/reload the plugin, and reinstall the Build plugin if its manifest
or scopes changed. See [ADR 0003](docs/adr/0003-disable-unsafe-native-transactions.md) for the native
transaction boundary.

## Development checks

From the Bridge repository:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:sdk-capabilities
npm run build
```

`npm run build` validates the manifest and produces `dist/` plus `PluginZip.zip`. The public SDK catalog
is generated from the installed `@remnote/plugin-sdk` declarations. After an SDK upgrade, run
`npm run generate:sdk-capabilities`; do not hand-edit the generated catalog.

For hot-reload development, `npm run dev` is available, but use the production build for local
acceptance. Live integration suites and their destructive-operation confirmation live in the
[CLI repository](https://github.com/zeefan1555/remnote-cli).

## More documentation

- [Local plugin setup](docs/guides/development-run-plugin-locally.md)
- [Connection lifecycle](docs/guides/connection-lifecycle.md)
- [CLI installation](https://github.com/zeefan1555/remnote-cli/blob/main/docs/guides/installation.md)
- [CLI troubleshooting](https://github.com/zeefan1555/remnote-cli/blob/main/docs/guides/remnote-cli-troubleshooting.md)
- [CLI command reference](https://github.com/zeefan1555/remnote-cli/blob/main/docs/guides/remnote-cli-command-reference.md)

MIT License. Derived from Robert Spiegel's RemNote MCP Bridge. Retain [LICENSE](LICENSE) and
[NOTICE](NOTICE.md).
