# Agent Map

This repository is the RemNote CLI Bridge plugin. It connects to the companion CLI at https://github.com/zeefan1555/remnote-cli.

```text
remnote-cli <-> loopback WebSocket <-> plugin <-> official SDK
```

## Design principle

The plugin exposes only atomic RemNote SDK capabilities. Each bridge call invokes one SDK method and passes the arguments through unchanged.

Composition, argument normalization, verification, and workflow logic belong in remnote-cli. The CLI composes multiple atomic plugin calls.

Concurrency is transport-level only. The socket may run several validated requests at once, and each response matches its request id. Workflow batching and cross-call orchestration belong in remnote-cli.

## Ownership

The plugin owns the official SDK, the generated public allowlist, JSON serialization, active knowledge-base identity, and live official permission checks. Native transactions stay disabled because SDK 0.0.46 does not acknowledge rejected callbacks; see [ADR 0003](docs/adr/0003-disable-unsafe-native-transactions.md). CLI business behavior lives in remnote-cli, under `src/business/` in that repository.

The gateway actions are `get_status`, `get_sdk_capabilities`, and `sdk_call`. Transaction begin and end requests fail. There is no MCP transport, business action dispatcher, developer-console executor, or compatibility shim.

The handshake is protocol 2. The CLI sends `hello`; the plugin answers `ready` with its plugin/SDK versions, catalog hash, and active knowledge base. There is no token, proof, pairing setting, URL setting, write switch, or destructive switch. The client always connects to `ws://127.0.0.1:3002/`. Read [ADR 0001](docs/adr/0001-direct-cli.md) before changing this ownership.

The trust boundary is the current operating-system user. Installing the plugin and approving RemNote's official scopes trusts local programs running as that user. The CLI listener rejects ordinary webpage origins, but Origin checks do not isolate native local processes because they can forge a header.

## Code Map

- `src/widgets/index.tsx`: activation and sidebar registration.
- `src/bridge/runtime.ts`: zero-configuration SDK gateway and live KB authorization.
- `src/bridge/websocket-client.ts`: loopback sessions, request deadlines, and retry.
- `src/bridge/protocol.ts`: protocol 2 handshake primitives, fixed endpoint, request IDs, and wire limits.
- `src/api/sdk-executor.ts`: allowlisted invocation and bounded serialization.
- `src/api/sdk-capabilities.generated.ts`: generated SDK catalog.
- `public/manifest.json`: identity and official scopes.

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
