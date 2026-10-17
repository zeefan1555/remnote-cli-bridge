import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('package bin metadata', () => {
  it('exposes the local production server executable', () => {
    expect(packageJson.name).toBe('remnote-cli-bridge');
    expect(packageJson.version).toBe('0.25.0');
    expect(packageJson.bin).toEqual({
      'remnote-cli-bridge': './bin/remnote-cli-bridge.js',
    });
  });

  it('points the bridge bin metadata at an executable Node wrapper', () => {
    const binPath = packageJson.bin['remnote-cli-bridge'];
    const stats = statSync(binPath);
    const firstLine = readFileSync(binPath, 'utf8').split('\n')[0];

    expect(stats.isFile()).toBe(true);
    expect(stats.mode & 0o111).not.toBe(0);
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('executes the bridge bin version command', () => {
    const result = spawnSync(process.execPath, ['bin/remnote-cli-bridge.js', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('runs quality scripts through local package binaries', () => {
    for (const scriptName of ['lint', 'lint:fix', 'format', 'format:check'] as const) {
      expect(packageJson.scripts[scriptName]).not.toContain('npx ');
    }
    expect(packageJson.scripts.lint).toMatch(/^eslint /);
    expect(packageJson.scripts.format).toMatch(/^prettier /);
  });

  it('validates with the public RemNote SDK parser before building', () => {
    expect(packageJson.scripts.build).not.toContain('npx ');
    expect(packageJson.scripts.build).toMatch(/^npm run validate && /);
    expect(packageJson.scripts.validate).toBe('node scripts/validate-plugin.js');
    expect(packageJson.dependencies['@remnote/plugin-sdk']).toBeDefined();
  });

  it('validates the plugin package from the repository root', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/validate-plugin.js')], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Plugin README and official manifest validation passed.');
  });
});
