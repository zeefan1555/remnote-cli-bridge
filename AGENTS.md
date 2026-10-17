# Agent Map

This repository is the RemNote CLI Bridge plugin. It pairs with the companion CLI at https://github.com/zeefan1555/remnote-cli.

```text
remnote-cli <-> loopback WebSocket <-> plugin <-> official SDK
```

## Design principle

The plugin exposes only atomic RemNote SDK capabilities. Each bridge call invokes one SDK method and passes the arguments through unchanged.

Composition, argument normalization, verification, and workflow logic belong in remnote-cli. The CLI composes multiple atomic plugin calls.

Concurrency is transport-level only. The socket may run several validated requests at once, and each response matches its request id. Workflow batching and cross-call orchestration belong in remnote-cli.

## Ownership

The plugin owns the official SDK, the generated public allowlist, JSON serialization, mutual authentication, knowledge-base binding, and live permission checks. Native transactions stay disabled because SDK 0.0.46 does not acknowledge rejected callbacks; see [ADR 0003](docs/adr/0003-disable-unsafe-native-transactions.md). CLI business behavior lives in remnote-cli, under `src/business/` in that repository.

The gateway actions are `get_status`, `get_sdk_capabilities`, and `sdk_call`. Transaction begin and end requests fail. There is no MCP transport, business action dispatcher, developer-console executor, or compatibility shim.

The handshake is protocol 1. `hello` does not include the plugin id. `get_status.pluginId` is the manifest id `remnote-cli-bridge`. Read [ADR 0001](docs/adr/0001-direct-cli.md) before changing this ownership.

## Code Map

- `src/widgets/index.tsx`: activation, settings, and sidebar registration.
- `src/bridge/runtime.ts`: authenticated SDK gateway and live authorization.
- `src/bridge/websocket-client.ts`: loopback sessions, request deadlines, and retry.
- `src/bridge/protocol.ts`: mutual proof and wire limits.
- `src/api/sdk-executor.ts`: allowlisted invocation and bounded serialization.
- `src/api/sdk-capabilities.generated.ts`: generated SDK catalog.
- `src/settings.ts`, `public/manifest.json`: gates, pairing, and official scopes.

Read the SDK declarations before concluding a capability is unavailable. Leave private methods, callbacks, and persistent handles off the JSON boundary.

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:sdk-capabilities
npm run build
```

`./code-quality.sh` runs the same checks plus coverage. Use `source ./node-check.sh` when Node is not already on `PATH`. After an SDK upgrade, regenerate with `npm run generate:sdk-capabilities`. Do not hand-edit the generated catalog. Mocks do not prove native persistence.

## Live Verification

Live checks need an explicit human authorization and a real RemNote session. Install the `remnote-cli-bridge` identity in RemNote desktop and confirm the scope grants. Daily smoke checks use the registered `remnote-cli` command. Development integration suites live in https://github.com/zeefan1555/remnote-cli:

```bash
./run-agent-integration-test.sh --preflight-only
./run-agent-integration-test.sh --yes --command status
./run-agent-integration-test.sh --yes --flashcards-only "EXISTING HOME CONCEPT TITLE"
./run-agent-integration-test.sh --yes --transactions-only
```

The wrapper refuses occupied ports. Leave unknown listeners running. With explicit full-operation authority, record, stop, and restore only a confirmed project-owned previous companion. On a successful install and smoke check, keep this plugin and CLI and leave the old plugin and MCP autostart disabled. Restore recorded assets and settings when installation fails. Preserve plans and exact ids after an uncertain write. Do not retry blindly, and do not open the RemNote database.

## Documentation And Delivery

Keep the README, connection and setup docs, SDK contracts, and `CHANGELOG.md` aligned. A change that crosses the wire boundary also needs a matching change in remnote-cli. Business-only changes belong in that repository.

The [fork adoption workflow](docs/workflows/pr-validation-and-adoption.md) is historical guidance for the original forks. Do not modify those forks or their pull requests. Do not publish this package unless the maintainer asks. Preserve upstream licenses in `LICENSE` and `NOTICE.md`.
