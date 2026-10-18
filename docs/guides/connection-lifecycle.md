# Connection Lifecycle

The RemNote plugin cannot listen on a local TCP port, so it connects outward:

```text
RemNote CLI Bridge -> loopback listener owned by the current CLI command
```

There is no resident automation daemon. A plugin waiting between commands is
healthy; **CLI connected** is expected only while a command is running.

## Session

1. Plugin activation starts background connection attempts.
2. The CLI binds `127.0.0.1` on the paired port.
3. Fresh HMAC challenges authenticate both peers. The secret is never sent.
   The CLI sends `challenge` with protocol 1, a 64-hex nonce, and a proof of
   `cli:<nonce>`. The plugin answers with `hello`. `hello.identity` contains
   `protocolVersion`, `pluginVersion`, `sdkVersion`, `sdkCatalogHash`,
   `knowledgeBaseId`, `knowledgeBaseName`, `acceptWriteOperations`, and
   `acceptReplaceOperation`. The plugin id is not part of that handshake.
   The plugin proof is `plugin:<nonce>:<JSON identity>`. The CLI then sends
   `ready`. Protocol version stays 1.
4. The CLI requires the intended KB, protocol 1 and a valid live SDK catalog.
   `get_status` returns `pluginId` from the manifest, now `remnote-cli-bridge`.
   A CLI that only displays that field needs no protocol change. A CLI that
   requires `zeefan-remnote-sdk-bridge` must accept `remnote-cli-bridge`.
5. Requests use exact IDs, KB binding and deadlines.
6. Command completion closes the listener and socket; the plugin waits again.

The plugin checks pairing, live permissions and the current KB before and after
each SDK call. Concurrent checks share one read, and a successful read is reused
for at most 100ms. A change to a bridge setting drops that cache immediately. SDK 0.0.46 has
no knowledge-base change event, so a KB switch is observed on the next check after
the cache expires. A token change, KB switch, expired deadline or closed socket
stops further writes. Native in-flight operations may still finish; no rollback or
cancellation is inferred from a connection failure.

Only one CLI session is admitted. Concurrent CLI invocations fail on the occupied
port. Up to 16 validated requests run at once. Frame parsing, the handshake, ping
and request validation stay ordered, and each response carries its request id. A
handler failure answers only that request. A new plugin session waits for prior
individual SDK calls to settle and does not write on the closed socket.

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
See [ADR 0003](../adr/0003-disable-unsafe-native-transactions.md).

See the [CLI recovery guide](https://github.com/zeefan1555/remnote-cli/blob/main/docs/guides/remnote-cli-troubleshooting.md)
for uncertain writes.
