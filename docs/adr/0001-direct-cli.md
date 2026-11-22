# Direct CLI and RemNote CLI Bridge

## Status

Accepted. This repository is the RemNote CLI Bridge plugin. The companion CLI is a separate project: https://github.com/zeefan1555/remnote-cli.

The earlier layout, one repository with `packages/plugin` and `packages/cli`, is retired.

## Decision

The plugin exposes only atomic RemNote SDK capabilities. Each bridge call invokes one SDK method and passes the arguments through unchanged. Composition, argument normalization, verification, and workflow logic belong in remnote-cli.

Concurrency is transport-level only.

The plugin owns the official SDK, the generated public allowlist, JSON serialization, active knowledge-base identity, and live official permission checks. Gateway actions are `get_status`, `get_sdk_capabilities`, and `sdk_call`. Begin and end transaction requests fail before any native transaction opens. See [ADR 0003](0003-disable-unsafe-native-transactions.md).

The generated catalog is a versioned SDK-facts artifact. It contains capability identity, target, signatures, support status, execution mode and serialization requirements. It deliberately does not assign CLI groups or command names. The companion CLI derives those navigation names from the same facts, so a CLI presentation change does not require a Bridge release.

Protocol 2 has no application authentication or custom settings. The CLI binds the fixed loopback endpoint, sends `hello`, and receives `ready` with plugin/SDK versions, catalog hash, and live active knowledge-base identity. `get_status.pluginId` reports the manifest id `remnote-cli-bridge`.

The security boundary is the current operating-system user. The CLI rejects ordinary webpage WebSocket Origins, but native local processes can forge headers, so this is not isolation from a malicious same-user program.

## Consequences

Workflow changes land in remnote-cli. After this synchronized protocol migration, the Bridge should change only for an SDK capability/catalog change, serialization or transport-security defect, or a measured transport bottleneck. Other feature work lands in the CLI and Codex plugin.
