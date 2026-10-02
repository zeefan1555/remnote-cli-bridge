# Pull Request Guide

Use this guide when a pull request is explicitly requested. The current direct
architecture adoption does not authorize commits, pushes, merges or PR updates.

The plugin owns the official SDK gateway. The companion CLI owns business logic.
A new CLI workflow using existing SDK methods does not need a plugin change.

## Shared Contracts

Changes to the wire protocol, authentication, KB binding, SDK serialization or
generated capability metadata require coordinated contracts and tests in both
repositories. Link companion PRs when those shared boundaries change.

Use [the repository template](../../.github/pull_request_template.md), update the
affected documentation and changelog, and retain contributor attribution.
Protocol/catalog compatibility does not require matching product versions.

## Validation

Run each affected repository's quality checks, generated-file freshness check,
production build and diff check. Test real plugin/CLI interactions through the
[guarded integration wrapper](../../../cli/docs/guides/integration-testing.md)
after explicit live-test authorization. Record exact IDs, readback, replay and
unverified boundaries. Mocks do not prove native RemNote persistence.

The [external contribution workflow](../workflows/pr-validation-and-adoption.md)
remains a separate maintainer process document. Its obsolete MCP/stdio paths are
not current acceptance paths; do not edit that workflow automatically.
