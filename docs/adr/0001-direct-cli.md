# Direct CLI and RemNote CLI Bridge

## Status

Accepted. This repository is the RemNote CLI Bridge plugin. The companion CLI is a separate project: https://github.com/zeefan1555/remnote-cli.

The earlier layout, one repository with `packages/plugin` and `packages/cli`, is retired.

## Decision

The plugin exposes only atomic RemNote SDK capabilities. Each bridge call invokes one SDK method and passes the arguments through unchanged. Composition, argument normalization, verification, and workflow logic belong in remnote-cli.

Concurrency is transport-level only.

The plugin owns the official SDK, the generated public allowlist, JSON serialization, mutual authentication, knowledge-base binding, and live permission checks. Gateway actions are `get_status`, `get_sdk_capabilities`, and `sdk_call`. Begin and end transaction requests fail before any native transaction opens. See [ADR 0003](0003-disable-unsafe-native-transactions.md).

Protocol 1 is unchanged by the plugin id rename. The handshake does not carry the plugin id. `get_status.pluginId` reports the manifest id `remnote-cli-bridge`.

## Consequences

Workflow changes land in remnote-cli. Changes to the SDK allowlist, permissions, serialization, or the wire handshake land here, with a coordinated CLI update when the CLI depends on that contract.
