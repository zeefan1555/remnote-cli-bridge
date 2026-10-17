# CLI Task Contracts

Task composition belongs to the companion CLI, not to this plugin.

- [Read receipts](https://github.com/zeefan1555/remnote-cli/blob/master/docs/guides/read-receipts.md)
- [Preview-first task plans](https://github.com/zeefan1555/remnote-cli/blob/master/docs/guides/task-plans.md)
- [Task schemas](https://github.com/zeefan1555/remnote-cli/blob/master/src/schemas/task-schemas.ts)
- [Business implementation](https://github.com/zeefan1555/remnote-cli/blob/master/src/business/task-operations.ts)

The plugin exposes only generated SDK methods and transport-level status,
capabilities. Native transactions are rejected under
[ADR 0003](../../adr/0003-disable-unsafe-native-transactions.md). There are no `inspect_many`,
`verify_scope`, `flashcards_apply` or `wiki_apply` gateway actions.

Task preview, exact-ID/hash validation, local metadata journals, classification and
readback remain CLI responsibilities. Plugin authentication, exact KB binding and
live permission checks still apply to every SDK invocation.
