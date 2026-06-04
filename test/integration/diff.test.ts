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
