# CLI Alias-Write Contract

Aliases are real alternate names attached to a Rem through the RemNote SDK. They are not child bullets, tags, title
suffixes, or inline references.

These high-level operations are implemented in the companion CLI's `src/business/rem-adapter.ts`.
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

Removal matches normalized alias text exactly and removes every matching alias Rem. It never changes the primary
title. The same normalized alias cannot appear in both operations because the intended final state would be
ambiguous. A title change and alias changes execute in one RemNote transaction.

## Structural write isolation

`replace_children` replaces only direct content children. Aliases are parent metadata and remain unchanged alongside
the parent Rem ID, title, document status, tags, and properties.

## Capability Boundary

The CLI uses the plugin's generated public SDK catalog. Product versions need not match.
Changes to normalization and workflow behavior belong in the CLI; SDK or permission changes may require a plugin update.
