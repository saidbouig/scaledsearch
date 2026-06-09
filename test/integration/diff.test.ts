import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  ES_HOST,
  esEngine,
  isReachable,
  cleanupIndex,
  uniqueIndexName,
} from '../helpers/cluster';
import { makeTmpDir, cleanupTmpDir } from '../helpers/tmpDir';

const reachable = await isReachable(ES_HOST);
const describeIf = reachable ? describe : describe.skip;

const CLI = path.resolve(__dirname, '../../src/index.ts');

function runCli(cwd: string, args: string): { stdout: string; status: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout, status: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), status: err.status ?? 1 };
  }
}

function setHistoryIndex(tmp: string, historyIndex: string) {
  const configPath = path.join(tmp, '.scaledsearch/config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  const updated = content.replace(
    /index:.*$/m,
    `index: "${historyIndex}"`,
  );
  fs.writeFileSync(configPath, updated, 'utf-8');
}

describe('migrate diff: not initialized', () => {
  it('exits with a clear error', () => {
    const tmp = makeTmpDir('scaledsearch-diff-noinit-');
    try {
      const result = runCli(tmp, 'migrate diff');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/not initialized/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('migrate diff: no migration files', () => {
  it('reports nothing to diff', () => {
    const tmp = makeTmpDir('scaledsearch-diff-empty-');
    try {
      runCli(tmp, 'migrate init');
      const result = runCli(tmp, 'migrate diff');
      expect(result.stdout).toMatch(/No migration files/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate diff: shows pending operations', () => {
  const engine = esEngine();
  const idx = uniqueIndexName('ss_diff');
  let tmp: string;
  let historyIndex: string;

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-diff-');
    historyIndex = `.scaledsearch_history_${Date.now()}_diff`;
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);

    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__create.yaml'),
      `description: create index with fields
operations:
  - type: create_index
    index: ${idx}
    mappings:
      properties:
        title: { type: text }
        author: { type: keyword }
`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('lists the pending migration and its operations', () => {
    const result = runCli(tmp, 'migrate diff');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Pending migrations/i);
    expect(result.stdout).toMatch(/V001/);
    expect(result.stdout).toMatch(/CREATE INDEX/i);
    expect(result.stdout).toContain(idx);
  });

  it('shows the field additions in the diff output', () => {
    const result = runCli(tmp, 'migrate diff');
    // Both fields from the migration should appear
    expect(result.stdout).toMatch(/title/);
    expect(result.stdout).toMatch(/author/);
  });

  it('reports up to date once the migration is applied', () => {
    runCli(tmp, 'migrate apply');
    const result = runCli(tmp, 'migrate diff');
    expect(result.stdout).toMatch(/up to date|No pending/i);
  });
});

describe('migrate diff: malformed migration file', () => {
  it('exits with a friendly error naming the file, not a Node stack trace', () => {
    const tmp = makeTmpDir('scaledsearch-diff-badyaml-');
    try {
      runCli(tmp, 'migrate init');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__ok.yaml'),
        'description: ok\noperations:\n  - type: create_index\n    index: a\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V002__broken.yaml'),
        `description: broken
operations:
  - type: create_index
  bad indent: oops
    invalid: : yaml :::
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate diff');
      expect(result.status).not.toBe(0);
      // No raw Node stack trace or parser source location dump
      expect(result.stdout).not.toContain('at Module.');
      expect(result.stdout).not.toContain('node:internal');
      expect(result.stdout).not.toContain('parser.ts:');
      // Names the offending file with the friendly prefix
      expect(result.stdout).toMatch(/V002__broken\.yaml/);
      expect(result.stdout.toLowerCase()).toContain('diff failed');
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('migrate diff: add_alias options visible in preview', () => {
  it('shows filter / routing / is_write_index inline so reviewers see the full semantics', () => {
    const tmp = makeTmpDir('scaledsearch-diff-alias-opts-');
    try {
      runCli(tmp, 'migrate init');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__alias.yaml'),
        `description: alias with options
operations:
  - type: create_index
    index: a
  - type: add_alias
    index: a
    alias: filtered
    filter:
      term:
        active: true
    routing: "tenant_42"
    is_write_index: true
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate diff');
      expect(result.status).toBe(0);
      // The options annotation should mention each non-default option
      expect(result.stdout).toMatch(/ADD ALIAS.*"filtered".*on a/);
      expect(result.stdout).toContain('filter');
      expect(result.stdout).toContain('routing=tenant_42');
      expect(result.stdout).toContain('is_write_index=true');
      // The actual filter expression should appear on a sub-line
      expect(result.stdout).toMatch(/filter:\s*\{"term":\{"active":true\}\}/);
    } finally {
      cleanupTmpDir(tmp);
    }
  });

  it('does not annotate plain add_alias ops with empty option suffix', () => {
    const tmp = makeTmpDir('scaledsearch-diff-alias-plain-');
    try {
      runCli(tmp, 'migrate init');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__plain.yaml'),
        `description: plain alias
operations:
  - type: create_index
    index: a
  - type: add_alias
    index: a
    alias: plain
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate diff');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/ADD ALIAS.*"plain".*on a/);
      // No trailing "( ... )" annotation when no options are set
      expect(result.stdout).not.toMatch(/"plain" on a \(/);
      // No filter sub-line when no filter is set
      expect(result.stdout).not.toMatch(/filter:/);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('migrate diff: reindex script flagged in preview', () => {
  it('appends "(with script)" when reindex carries a Painless transform', () => {
    const tmp = makeTmpDir('scaledsearch-diff-reindex-script-');
    try {
      runCli(tmp, 'migrate init');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__rx.yaml'),
        `description: reindex with script
operations:
  - type: create_index
    index: dest
  - type: reindex
    source: src
    dest: dest
    script: "ctx._source.tag = 'migrated'"
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate diff');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/REINDEX.*src.*→.*dest.*\(with script\)/);
    } finally {
      cleanupTmpDir(tmp);
    }
  });

  it('does not append "(with script)" for plain reindex', () => {
    const tmp = makeTmpDir('scaledsearch-diff-reindex-plain-');
    try {
      runCli(tmp, 'migrate init');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__rx.yaml'),
        `description: plain reindex
operations:
  - type: create_index
    index: dest
  - type: reindex
    source: src
    dest: dest
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate diff');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/REINDEX.*src.*→.*dest/);
      expect(result.stdout).not.toMatch(/\(with script\)/);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});
