# Attribution

RemNote Direct is an independently maintained derivative, not a from-scratch
implementation or an official RemNote product.

- `packages/cli` derives from Robert Spiegel's
  [remnote-mcp-server](https://github.com/robert7/remnote-mcp-server), through
  [zeefan1555's fork](https://github.com/zeefan1555/remnote-mcp-server).
- `packages/plugin` derives from
  [robert7/remnote-mcp-bridge](https://github.com/robert7/remnote-mcp-bridge),
  whose fork source is
  [quentintou/remnote-mcp-bridge](https://github.com/quentintou/remnote-mcp-bridge),
  through [zeefan1555's fork](https://github.com/zeefan1555/remnote-mcp-bridge).
- Both core imports are MIT licensed. Their original copyright notices and
  license text are retained unchanged in each package's `LICENSE`.
- Bundled third-party material, including `packages/cli/skills/skill-creator`,
  retains its own license. The root license does not replace those notices.
- The official `@remnote/plugin-sdk` dependency retains its own licensing terms.

See [provenance](docs/upstream.md) for the precise imported baselines. Historical
package changelogs document their origins, not supported MCP runtime paths.
