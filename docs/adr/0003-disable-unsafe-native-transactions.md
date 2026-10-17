# Disable Unsafe Native Transactions

## Status

Accepted for RemNote CLI Bridge.

## Context

RemNote Plugin SDK 0.0.46 does not acknowledge a rejected transaction callback. Leaving that callback pending can freeze the editor and block later CLI sessions.

## Decision

The plugin does not open native transactions. `transaction_begin` and `transaction_end` fail with an explicit error, and no transaction is opened. Preview, verification, and recovery belong in [remnote-cli](https://github.com/zeefan1555/remnote-cli).

## Consequences

A disconnected or timed-out SDK call does not abort work already started inside that call. There is no plugin-side rollback. The connection lifecycle describes the same limit for operators.
