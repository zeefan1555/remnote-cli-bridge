# Connection Lifecycle

The RemNote plugin cannot listen on a local TCP port, so it connects outward:

```text
RemNote CLI Bridge -> ws://127.0.0.1:3002 <-> current CLI command
```

There is no resident automation daemon. A plugin waiting between commands is
healthy; **CLI connected** is expected only while a command is running.

## Session

1. Plugin activation starts bounded retry attempts to the fixed endpoint.
2. The CLI binds `127.0.0.1:3002` and the plugin opens one WebSocket.
3. The CLI sends protocol 2 `hello` with its product version. The plugin reads
   the live active knowledge base and answers `ready` with plugin version, SDK
   version, SDK catalog hash, knowledge-base id, and knowledge-base name. No
   token, challenge, proof, pairing setting, URL setting, write switch, or
   destructive switch is involved.
4. Requests use canonical positive integer IDs that increase within the session,
   the connected knowledge-base id, and an absolute deadline.
5. Command completion closes the listener and socket; the plugin waits again.

The plugin checks the current knowledge base before each SDK call and again after
it. Concurrent checks share one read, and a successful read is reused for at most
100ms. SDK 0.0.46 has no knowledge-base change event, so a switch is observed on
the next check after the cache expires. A knowledge-base switch, expired deadline,
or closed socket stops later writes. Native in-flight operations may still finish;
no rollback or cancellation is inferred from a connection failure.

Only one CLI session is admitted. Concurrent CLI invocations fail on the occupied
port. Up to 16 validated requests run at once, with at most 16 more waiting. The
frame queue, aggregate queued bytes, individual frames, responses, and request
history are bounded. Frame parsing, handshake, and ping handling stay ordered, and
each response carries its request id. A new session answers its handshake only
after prior individual SDK calls settle and never writes on the closed socket.

## Security Boundary

The trust boundary is the current operating-system user. Installing the plugin
and approving RemNote's official scopes trusts programs running as that user.

The CLI listener inspects the WebSocket HTTP upgrade `Origin` header and rejects
ordinary webpage origins. This prevents an unrelated page from driving the local
endpoint. It does not isolate native local programs: such a program can forge the
header. Do not treat Origin validation as authentication between processes.

Official RemNote scope denial is surfaced as an authorization error. The plugin
does not add a second write or destructive permission model; CLI commands remain
responsible for explicit confirmation before high-risk operations.

## Retry And Recovery

Retry delays grow from 250 ms to at most 1 second. Activity, visibility, and
the sidebar **Reconnect** button can wake a disconnected plugin. Browser
background timer throttling can still delay retries; the CLI waits at most 15
seconds for connection.

Check the fixed localhost endpoint, official `KnowledgeBaseInfo: Read` permission,
and sidebar errors. Product version numbers are informational; protocol and the
live SDK catalog determine compatibility.

Do not disable browser security protections to make localhost requests work.
For local development use the documented local-plugin URL; for a blocked browser
permission, review the specific site permission or use RemNote desktop.

## Transactions

Native transactions are unavailable. SDK 0.0.46 does not acknowledge rejected
callbacks, which can leave the editor blocked. Begin/end requests fail before any
transaction opens. A disconnected or timed-out call never triggers a native abort.
See [ADR 0003](../adr/0003-disable-unsafe-native-transactions.md).

See the [CLI recovery guide](https://github.com/zeefan1555/remnote-cli/blob/main/docs/guides/remnote-cli-troubleshooting.md)
for uncertain writes.
