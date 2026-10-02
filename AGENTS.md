# Agent Map

This package is the RemNote SDK Bridge plugin in the RemNote Direct repository.
Shared repository guidance lives in [the root agent map](../../AGENTS.md).

```text
../cli (CLI) <-> loopback WebSocket <-> plugin <-> official SDK
```

## Ownership

The plugin owns the official SDK, generated public allowlist, JSON serialization,
mutual authentication, KB binding and live permission checks. Native transactions
are disabled by shared ADR 0003. CLI business behavior lives in the companion's `src/business/`.

The complete gateway action surface is `get_status`,
`get_sdk_capabilities` and `sdk_call`; transaction begin/end requests explicitly fail.
No MCP transport, business action dispatcher, developer-console executor,
compatibility shim or matching product version is maintained.

## Code Map

- `src/widgets/index.tsx`: activation, settings and sidebar registration.
- `src/bridge/runtime.ts`: authenticated SDK gateway and live authorization.
- `src/bridge/websocket-client.ts`: loopback sessions, request deadlines and retry.
- `src/bridge/protocol.ts`: mutual proof and wire limits.
- `src/api/sdk-executor.ts`: allowlisted invocation and bounded serialization.
- `src/api/sdk-capabilities.generated.ts`: generated SDK catalog.
- `src/settings.ts`, `public/manifest.json`: gates, pairing and official scopes.

Read [the approved ADR](docs/adr/0001-direct-cli.md) before changing ownership.
Read the actual SDK declarations before concluding a capability is unavailable.
Do not expose private methods, callbacks or persistent handles over JSON.

## Checks

```bash
./code-quality.sh
npm run check:sdk-capabilities
npm run build
```

Use `source ./node-check.sh` if needed. After an SDK upgrade regenerate with
`npm run generate:sdk-capabilities`; never hand-edit generated output.
Mocks do not prove native persistence or transaction rollback.

Live verification requires explicit human authorization and a real RemNote
session. Reload changed plugin assets through Computer Use, subject to its
confirmation policy. Install the independent `zeefan-remnote-sdk-bridge` identity
in RemNote desktop and verify actual scope grants. All live commands use the sibling guarded wrapper:

```bash
../cli/run-agent-integration-test.sh --preflight-only
../cli/run-agent-integration-test.sh --yes --command status
../cli/run-agent-integration-test.sh --yes --flashcards-only "EXISTING HOME CONCEPT TITLE"
../cli/run-agent-integration-test.sh --yes --transactions-only
```

The wrapper refuses occupied ports. Never stop unknown listeners. With explicit
full-operation authority, record/stop/restore only a confirmed project-owned old
companion. For the approved local adoption, retain the new plugin/CLI on success
and leave the old plugin disabled and MCP service stopped. Restore recorded prior
assets/settings only on failure; ordinary temporary tests still restore them. Preserve
plans and exact IDs after uncertain writes; never blind-retry or access the
RemNote database.

## Documentation And Delivery

Keep README, connection/setup docs, SDK contracts and `CHANGELOG.md` aligned.
For cross-boundary changes, update the companion CLI, schemas, tests and
`skills/remnote/SKILL.md`. Business-only changes belong in the CLI.

Use the root quality/build commands and shared CI for changes in this repository.
The retained [fork adoption workflow](docs/workflows/pr-validation-and-adoption.md)
is historical guidance for the original forks, not this repository's delivery
contract. Do not modify those forks or their PRs. Commit and push to this
independent repository are now explicitly authorized. Package publication is not
authorized; daily installation requires all native acceptance gates. Preserve
existing dirty work and upstream licenses.
