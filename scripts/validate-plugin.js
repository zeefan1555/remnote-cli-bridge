const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseManifest } = require('@remnote/plugin-sdk/dist/lib');

const root = resolve(__dirname, '..');
assert.ok(readFileSync(resolve(root, 'README.md'), 'utf8').trim(), 'Plugin README is empty');
const result = parseManifest(
  JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'))
);
assert.ok(result.success, `Invalid plugin manifest: ${JSON.stringify(result.errors)}`);
console.log('Plugin README and official manifest validation passed.');
