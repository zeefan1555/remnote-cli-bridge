# CLI Task Contracts

Task composition belongs to the companion CLI, not to this plugin.

- [Read receipts](../../../../cli/docs/guides/read-receipts.md)
- [Preview-first task plans](../../../../cli/docs/guides/task-plans.md)
- [Task schemas](../../../../cli/src/schemas/task-schemas.ts)
- [Business implementation](../../../../cli/src/business/task-operations.ts)

The plugin exposes only generated SDK methods and transport-level status,
capabilities and transaction scopes. There are no `inspect_many`,
`verify_scope`, `flashcards_apply` or `wiki_apply` gateway actions.

Task preview, exact-ID/hash validation, local metadata journals, classification and
readback remain CLI responsibilities. Plugin authentication, exact KB binding and
live permission checks still apply to every SDK invocation.
