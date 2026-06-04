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
    /index:.*\.scaledsearch_history/,
    `index: "${historyIndex}"`,
  );
  fs.writeFileSync(configPath, updated, 'utf-8');
}

function setHost(tmp: string, host: string) {
  const configPath = path.join(tmp, '.scaledsearch/config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  const updated = content.replace(/host:.*/, `host: ${host}`);
  fs.writeFileSync(configPath, updated, 'utf-8');
}

describe('migrate apply: not initialized', () => {
  it('exits non-zero with a clear message in an empty dir', () => {
    const tmp = makeTmpDir('scaledsearch-noinit-');
    try {
      const result = runCli(tmp, 'migrate apply');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/not initialized/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('migrate apply: no migration files', () => {
  it('reports gracefully with no migrations on disk', () => {
    const tmp = makeTmpDir('scaledsearch-empty-');
    try {
      runCli(tmp, 'migrate init');
      const result = runCli(tmp, 'migrate apply');
      expect(result.stdout).toMatch(/No migration files found/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate apply: target version', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const idxA = uniqueIndexName('ss_ta');
  const idxB = uniqueIndexName('ss_tb');
  const idxC = uniqueIndexName('ss_tc');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-target-');
    historyIndex = `.scaledsearch_history_${Date.now()}_t`;
    for (const i of [idxA, idxB, idxC, historyIndex]) await cleanupIndex(engine, i);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);

    const writeMigration = (file: string, index: string) =>
      fs.writeFileSync(
        path.join(tmp, 'migrations', file),
        `description: create ${index}\noperations:\n  - type: create_index\n    index: ${index}\n`,
        'utf-8',
      );
    writeMigration('V001__a.yaml', idxA);
    writeMigration('V002__b.yaml', idxB);
    writeMigration('V003__c.yaml', idxC);
  });

  afterAll(async () => {
    for (const i of [idxA, idxB, idxC, historyIndex]) await cleanupIndex(engine, i);
    cleanupTmpDir(tmp);
  });

  it('--target V002 applies V001 and V002 only', async () => {
    const result = runCli(tmp, 'migrate apply --target V002');
    expect(result.status).toBe(0);
    expect(await engine.indexExists(idxA)).toBe(true);
    expect(await engine.indexExists(idxB)).toBe(true);
    expect(await engine.indexExists(idxC)).toBe(false);
  });

  it('subsequent apply with no target applies remaining V003', async () => {
    const result = runCli(tmp, 'migrate apply');
    expect(result.status).toBe(0);
    expect(await engine.indexExists(idxC)).toBe(true);
  });

  it('apply when fully up to date reports nothing to do', () => {
    const result = runCli(tmp, 'migrate apply');
    expect(result.stdout).toMatch(/All migrations already applied/i);
  });
});

describeIf('migrate apply: dry-run', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const idx = uniqueIndexName('ss_dry');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-dry-');
    historyIndex = `.scaledsearch_history_${Date.now()}_d`;
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);

    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__create.yaml'),
      `description: create dry index
operations:
  - type: create_index
    index: ${idx}
`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('does NOT create the index in dry-run mode', async () => {
    const result = runCli(tmp, 'migrate apply --dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dry-run|would be applied/i);
    expect(await engine.indexExists(idx)).toBe(false);
  });

  it('dry-run against an unreachable cluster still lists migrations', () => {
    // Point config at a non-listening port to force offline path
    setHost(tmp, 'http://localhost:1');
    const result = runCli(tmp, 'migrate apply --dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/offline|would be applied/i);
    // Restore so afterAll cleanup runs cleanly
    setHost(tmp, ES_HOST);
  });
});

describeIf('migrate apply: connection failure', () => {
  it('exits non-zero with a clear message when cluster is unreachable', () => {
    const tmp = makeTmpDir('scaledsearch-noconn-');
    try {
      runCli(tmp, 'migrate init');
      setHost(tmp, 'http://localhost:1');
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__x.yaml'),
        'description: x\noperations:\n  - type: create_index\n    index: never_created\n',
        'utf-8',
      );
      const result = runCli(tmp, 'migrate apply');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/Cannot connect/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate apply: failing migration leaves clean failure record', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const existing = uniqueIndexName('ss_fail');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-fail-');
    historyIndex = `.scaledsearch_history_${Date.now()}_f`;
    await cleanupIndex(engine, existing);
    await cleanupIndex(engine, historyIndex);

    // Pre-create the index so create_index will fail
    await engine.createIndex(existing, {});

    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);
    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__dup.yaml'),
      `description: will fail (index exists)
operations:
  - type: create_index
    index: ${existing}
`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await cleanupIndex(engine, existing);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('exits non-zero and records the failure', async () => {
    const result = runCli(tmp, 'migrate apply');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/FAILED|already exists/i);
  });

  it('subsequent apply still sees V001 as pending (failed != applied)', () => {
    const status = runCli(tmp, 'migrate status');
    expect(status.stdout.toLowerCase()).toContain('pending');
  });
});
