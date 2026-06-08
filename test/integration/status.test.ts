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

function setHost(tmp: string, host: string) {
  const configPath = path.join(tmp, '.scaledsearch/config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  const updated = content.replace(/host:.*/, `host: ${host}`);
  fs.writeFileSync(configPath, updated, 'utf-8');
}

describe('migrate status: not initialized', () => {
  it('exits non-zero with clear error', () => {
    const tmp = makeTmpDir('scaledsearch-status-noinit-');
    try {
      const result = runCli(tmp, 'migrate status');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/not initialized/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('migrate status: no migration files', () => {
  it('reports nothing exists yet', () => {
    const tmp = makeTmpDir('scaledsearch-status-empty-');
    try {
      runCli(tmp, 'migrate init');
      const result = runCli(tmp, 'migrate status');
      expect(result.stdout).toMatch(/No migration files/i);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate status: shows applied vs pending', () => {
  const engine = esEngine();
  const idxA = uniqueIndexName('ss_st_a');
  const idxB = uniqueIndexName('ss_st_b');
  let tmp: string;
  let historyIndex: string;

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-status-');
    historyIndex = `.scaledsearch_history_${Date.now()}_st`;
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);

    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__a.yaml'),
      `description: create a\noperations:\n  - type: create_index\n    index: ${idxA}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V002__b.yaml'),
      `description: create b\noperations:\n  - type: create_index\n    index: ${idxB}\n`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('initially shows both migrations as pending', () => {
    const result = runCli(tmp, 'migrate status');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/V001/);
    expect(result.stdout).toMatch(/V002/);
    expect(result.stdout.toLowerCase()).toContain('pending');
    expect(result.stdout).toMatch(/Connected/);
  });

  it('shows V001 as applied after applying it', () => {
    runCli(tmp, 'migrate apply --target V001');
    const result = runCli(tmp, 'migrate status');
    expect(result.stdout).toMatch(/V001.*applied/i);
    expect(result.stdout).toMatch(/V002.*pending/i);
  });

  it('shows counts at the bottom', () => {
    const result = runCli(tmp, 'migrate status');
    // After previous test: 2 total, 1 applied, 1 pending
    expect(result.stdout).toMatch(/Total:\s*2/);
    expect(result.stdout).toMatch(/Applied:\s*1/);
    expect(result.stdout).toMatch(/Pending:\s*1/);
  });

  it('falls back to offline mode when cluster is unreachable', () => {
    setHost(tmp, 'http://localhost:1');
    const result = runCli(tmp, 'migrate status');
    expect(result.status).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('offline');
    // Restore for cleanup
    setHost(tmp, ES_HOST);
  });
});

describe('migrate status: malformed migration file', () => {
  it('exits with a friendly error naming the file, not a Node stack trace', () => {
    const tmp = makeTmpDir('scaledsearch-status-badyaml-');
    try {
      runCli(tmp, 'migrate init');
      // Plant a valid V001 and a broken V002.
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

      const result = runCli(tmp, 'migrate status');
      expect(result.status).not.toBe(0);
      // No raw Node stack trace
      expect(result.stdout).not.toContain('at Module.');
      expect(result.stdout).not.toContain('node:internal');
      // The error names the offending file
      expect(result.stdout).toMatch(/V002__broken\.yaml/);
      // Friendly prefix (added by status.ts)
      expect(result.stdout.toLowerCase()).toContain('status failed');
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate status: orphan history records', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const idxA = uniqueIndexName('ss_orph_a');
  const idxB = uniqueIndexName('ss_orph_b');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-status-orphan-');
    historyIndex = `.scaledsearch_history_${Date.now()}_orph`;
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);

    // V001 and V002 — apply both
    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__a.yaml'),
      `description: a\noperations:\n  - type: create_index\n    index: ${idxA}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V002__b.yaml'),
      `description: b\noperations:\n  - type: create_index\n    index: ${idxB}\n`,
      'utf-8',
    );
    runCli(tmp, 'migrate apply');

    // Now simulate the orphan: V002 was applied but the file is gone (force
    // push removed it, accidental delete, etc.)
    fs.unlinkSync(path.join(tmp, 'migrations', 'V002__b.yaml'));
  });

  afterAll(async () => {
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('surfaces orphans as a distinct block in the output', () => {
    const result = runCli(tmp, 'migrate status');
    expect(result.status).toBe(0);
    // The orphan label appears
    expect(result.stdout.toLowerCase()).toContain('orphan');
    // V002 shown with "(file missing)" note
    expect(result.stdout).toMatch(/V002.*file missing/);
  });

  it('counts reconcile: Total = Applied + Failed + Pending, orphans separate', () => {
    const result = runCli(tmp, 'migrate status');
    // V001 on disk and applied → Total: 1, Applied: 1, Pending: 0
    // V002 orphan → Orphans: 1, NOT in the Applied count
    expect(result.stdout).toMatch(/Total:\s*1/);
    expect(result.stdout).toMatch(/Applied:\s*1/);
    expect(result.stdout).toMatch(/Pending:\s*0/);
    expect(result.stdout).toMatch(/Orphans:\s*1/);
  });
});
