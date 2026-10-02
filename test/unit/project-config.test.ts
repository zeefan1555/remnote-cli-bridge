import { readFileSync } from 'node:fs';
import { parseManifest } from '@remnote/plugin-sdk';
import { describe, expect, it } from 'vitest';

describe('project config', () => {
  it('uses public registry tarballs so CI does not require a private network', () => {
    expect(readFileSync('.npmrc', 'utf8').trim()).toBe('registry=https://registry.npmjs.org/');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { resolved?: string }>;
    };
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (entry.resolved) {
        expect(new URL(entry.resolved).origin, name).toBe('https://registry.npmjs.org');
      }
    }
  });

  it('requests read-only knowledge-base identity for task journal isolation', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

    expect(parseManifest(manifest).success).toBe(true);
    expect(manifest.id).toBe('zeefan-remnote-sdk-bridge');
    expect(manifest.name).toBe('RemNote SDK Bridge');
    expect(manifest.requiredScopes).toContainEqual({
      type: 'All',
      level: 'ReadCreateModifyDelete',
    });
    expect(manifest.requiredScopes).toContainEqual({ type: 'KnowledgeBaseInfo', level: 'Read' });
  });

  it('includes tests in TypeScript typechecking', () => {
    const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as {
      include: string[];
    };

    expect(tsconfig.include).toEqual(expect.arrayContaining(['src', 'test']));
  });

  it('keeps widget entrypoints visible to coverage', async () => {
    const { default: vitestConfig } = await import('../../vitest.config');
    const config = vitestConfig as { test?: { coverage?: { exclude?: string[] } } };

    expect(config.test?.coverage?.exclude).not.toContain('src/widgets/**/*.tsx');
  });
});
