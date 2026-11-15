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
   The CLI sends `challenge` with protocol 2, a 64-hex nonce, and a proof of
   `cli:<nonce>`. The plugin answers with `hello`. `hello.identity` contains
   `protocolVersion`, `pluginVersion`, `sdkVersion`, `sdkCatalogHash`,
   `knowledgeBaseId`, `knowledgeBaseName`, `acceptWriteOperations`, and
   `acceptReplaceOperation`. The plugin id is not part of that handshake.
   The plugin proof is `plugin:<nonce>:<JSON identity>`. The CLI then sends
   `ready`. Both peers reject other protocol versions before dispatch.
4. The CLI requires the intended KB, protocol 2 and a valid live SDK catalog.
   `get_status` returns `pluginId` from the manifest, now `remnote-cli-bridge`.
5. Requests use canonical positive safe-integer decimal IDs, KB binding and deadlines.
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

Request IDs increase in actual wire-send order, from 1 through 9007199254740991.
A single per-session high-water ID rejects duplicates, decreases, noncanonical
strings and unsafe integers before dispatch. Success, SDK errors and expiry all
consume the ID; exhaustion cannot wrap. This follows the monotonic non-reuse
pattern of [RFC 9113 section 5.1.1](https://www.rfc-editor.org/rfc/rfc9113.html#section-5.1.1),
not HTTP/2 framing. There is no cumulative request-count ceiling.

Independent fixed bounds are 16 SDK executions, 16 slot waiters, 32 outstanding
requests, and 32 ordered frames / 8 MiB aggregate queued frame bytes. The CLI
sends at most 16 at a time and admits at most 16 more local waiters. These windows
are based on existing SDK concurrency, not configurable cumulative limits.
Overload closes the session before the offending request can dispatch; prior
native work may still complete. Disconnect cancels waiters, not native execution.
Queued frames from an old socket cannot dispatch or replay on its successor.

The CLI reads strict `schemaVersion: 1` credentials before opening a listener;
the file schema and wire version are separate. Old configuration fails unchanged.
Coordinated installation and re-pairing require explicit authorization.

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
