import { readFileSync } from 'node:fs';
import { parseManifest } from '@remnote/plugin-sdk';
import { describe, expect, it } from 'vitest';

describe('project config', () => {
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
