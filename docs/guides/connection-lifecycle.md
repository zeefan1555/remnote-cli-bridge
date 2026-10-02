# Connection Lifecycle

The RemNote plugin cannot listen on a local TCP port, so it connects outward:

```text
RemNote SDK Bridge -> loopback listener owned by the current CLI command
```

There is no resident automation daemon. A plugin waiting between commands is
healthy; **CLI connected** is expected only while a command is running.

## Session

1. Plugin activation starts background connection attempts.
2. The CLI binds `127.0.0.1` on the paired port.
3. Fresh HMAC challenges authenticate both peers. The secret is never sent.
4. The CLI requires the intended KB, protocol 1 and a valid live SDK catalog.
5. Requests use exact IDs, KB binding and deadlines.
6. Command completion closes the listener and socket; the plugin waits again.

The plugin rereads pairing and live permissions, and checks the current KB before
SDK execution. A token change, KB switch, expired deadline or closed socket stops
further writes. Native in-flight operations may still finish; no rollback or
cancellation is inferred from a connection failure.

Only one CLI session is admitted. Concurrent CLI invocations fail on the occupied
port. A new plugin session waits for prior individual SDK calls to settle.

## Retry And Recovery

Retry delays grow from 250 ms to at most 1.5 seconds, including long idle periods.
There is no ten-minute standby phase. Activity, visibility and the sidebar
**Reconnect** button can wake a disconnected plugin. Browser background timer
throttling can still delay retries; the CLI waits at most 15 seconds for connection.

Check pairing, the exact KB, official `KnowledgeBaseInfo: Read` permission,
the loopback port and panel errors. Product version numbers are informational;
capabilities and protocol determine compatibility.

Do not disable browser security protections to make localhost requests work.
For local development use the documented local-plugin URL; for a blocked browser
permission, have the user review the specific site permission or use RemNote's
desktop app. Never silently change network/security settings.

## Transactions

Native transactions are unavailable. SDK 0.0.46 does not acknowledge rejected
callbacks, which can leave the editor blocked. Begin/end requests fail before any
transaction opens. A disconnected or timed-out call never triggers a native abort.
See [ADR 0003](../../../../docs/adr/0003-disable-unsafe-native-transactions.md).

See the [CLI recovery guide](../../../cli/docs/guides/remnote-cli-troubleshooting.md)
for uncertain writes.
