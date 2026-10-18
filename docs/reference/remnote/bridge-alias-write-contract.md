# CLI Alias-Write Contract

Aliases are real alternate names attached to a Rem through the RemNote SDK. They are not child bullets, tags, title
suffixes, or inline references.

Current native aliases are values, not Rem objects. The bridge materializes the
SDK's `getAliases` and `getOrCreateAliasWithText` results as `{text}` snapshots,
without invented IDs or callable Rem methods; the catalog declares `aliasText`.
Recovery records keep the owning Rem ID, and creation verifies the returned text.

These high-level operations are implemented in the companion CLI's [`src/business/rem-adapter.ts`](https://github.com/zeefan1555/remnote-cli/blob/main/src/business/rem-adapter.ts).
The plugin provides the underlying official SDK calls; it does not own alias normalization or workflow policy.

## Create semantics

`create_note.aliases` targets the explicitly supplied title/root Rem. Supplying non-empty aliases without `title` is
rejected because content-only imports may produce multiple top-level Rems.

Before writing, each alias is trimmed and every run of whitespace is collapsed to one ordinary space. Normalized
duplicates and aliases identical to the normalized primary title are ignored. Comparisons remain case-sensitive;
Unicode content is otherwise preserved unchanged.

## Update semantics

`update_note.addAliases` and `update_note.removeAliases` are additive operations. Omitting both leaves aliases
unchanged. Adding an existing normalized alias or removing a missing alias is an idempotent no-op.

The same normalized alias cannot appear in both operations because the intended final state would be
ambiguous. Atomic title/alias updates are currently unavailable under
[ADR 0003](../../adr/0003-disable-unsafe-native-transactions.md).
New-note alias creation uses the additive recovery journal, not a transaction.

## Structural write isolation

`replace_children` replaces only direct content children. Aliases are parent metadata and remain unchanged alongside
the parent Rem ID, title, document status, tags, and properties.

## Capability Boundary

The CLI uses the plugin's generated public SDK catalog. Product versions need not match.
Changes to normalization and workflow behavior belong in the CLI; SDK or permission changes may require a plugin update.
