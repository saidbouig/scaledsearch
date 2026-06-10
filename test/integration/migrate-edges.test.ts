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

  it('status shows V001 as failed (not applied, not silently pending)', () => {
    const status = runCli(tmp, 'migrate status');
    // The previous assertion only checked that the word "pending" appeared
    // anywhere in the output — but "Pending: 0" in the counts line always
    // matched, so the test passed even when failed migrations were treated
    // as successfully applied. Assert against the per-migration line.
    expect(status.stdout).toMatch(/V001\s*\|\s*failed/);
    expect(status.stdout).not.toMatch(/V001\s*\|\s*applied/);
  });

  it('subsequent apply re-runs the failed migration (does not skip it)', () => {
    // A failed migration must not be treated as "already applied" — that would
    // silently leave the user's schema incomplete. Re-running apply should
    // attempt V001 again (and fail again, since the underlying problem is
    // still there).
    const result = runCli(tmp, 'migrate apply');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Applying V001|FAILED|already exists/i);
    expect(result.stdout).not.toMatch(/All migrations already applied/i);
  });
});

describe('migrate apply: malformed migration file', () => {
  it('exits with a friendly error naming the file, not a Node stack trace', () => {
    const tmp = makeTmpDir('scaledsearch-apply-badyaml-');
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

      const result = runCli(tmp, 'migrate apply');
      expect(result.status).not.toBe(0);
      // No raw Node stack trace or parser source location dump
      expect(result.stdout).not.toContain('at Module.');
      expect(result.stdout).not.toContain('node:internal');
      expect(result.stdout).not.toContain('parser.ts:');
      // Names the offending file with the friendly prefix
      expect(result.stdout).toMatch(/V002__broken\.yaml/);
      expect(result.stdout.toLowerCase()).toContain('apply failed');
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describeIf('migrate apply: --target validation', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const idx = uniqueIndexName('ss_tgt');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-apply-tgt-');
    historyIndex = `.scaledsearch_history_${Date.now()}_tgt`;
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);
    fs.writeFileSync(
      path.join(tmp, 'migrations', 'V001__only.yaml'),
      `description: only\noperations:\n  - type: create_index\n    index: ${idx}\n`,
      'utf-8',
    );
  });

  afterAll(async () => {
    await cleanupIndex(engine, idx);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('rejects --target V999 when no such migration exists, and does NOT apply', async () => {
    const result = runCli(tmp, 'migrate apply --target V999');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/V999 does not match any migration/);
    expect(result.stdout).toContain('V001'); // lists available
    // V001 must not have been applied as a side effect
    expect(await engine.indexExists(idx)).toBe(false);
  });

  it('rejects --target abc with a clean error', () => {
    const result = runCli(tmp, 'migrate apply --target abc');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Invalid --target value 'abc'/);
  });

  it('rejects --target V-1 with a clean error', () => {
    const result = runCli(tmp, 'migrate apply --target V-1');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Invalid --target value 'V-1'/);
  });

  it('rejects --target V1.5 with a clean error', () => {
    const result = runCli(tmp, 'migrate apply --target V1.5');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Invalid --target value 'V1\.5'/);
  });

  it('accepts case-insensitive and unpadded forms (V1, v001, 1)', () => {
    // These are valid but V001 isn't applied yet (target validation only).
    // Just check that the parse step doesn't reject — actual applying is
    // exercised in the backward-target suite below.
    for (const form of ['V1', 'v001', '1', 'V001']) {
      const result = runCli(tmp, `migrate apply --target ${form} --dry-run`);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/migration\(s\) would be applied|All migrations already applied/);
    }
  });
});

describeIf('migrate apply: --target backward (below highest applied)', () => {
  const engine = esEngine();
  let tmp: string;
  let historyIndex: string;
  const idxA = uniqueIndexName('ss_tgtb_a');
  const idxB = uniqueIndexName('ss_tgtb_b');

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-apply-tgtb-');
    historyIndex = `.scaledsearch_history_${Date.now()}_tgtb`;
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);
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
    // Apply both up front so V001 and V002 are in history
    runCli(tmp, 'migrate apply');
  });

  afterAll(async () => {
    await cleanupIndex(engine, idxA);
    await cleanupIndex(engine, idxB);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('warns when --target is below the highest applied version', () => {
    const result = runCli(tmp, 'migrate apply --target V001');
    expect(result.status).toBe(0);
    // The output must explicitly call out that the target is below applied
    expect(result.stdout).toMatch(/below the highest applied version V002/);
    expect(result.stdout).toMatch(/migrate rollback/);
    // It must NOT say "All migrations already applied" — that was the
    // misleading message from the original bug.
    expect(result.stdout).not.toMatch(/All migrations already applied/);
  });
});

describeIf('migrate apply: --dry-run honors --target', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = makeTmpDir('scaledsearch-apply-dryrun-tgt-');
    runCli(tmp, 'migrate init');
    for (const v of [1, 2, 3]) {
      fs.writeFileSync(
        path.join(tmp, 'migrations', `V00${v}__m${v}.yaml`),
        `description: m${v}\noperations:\n  - type: create_index\n    index: dr_tgt_${v}\n`,
        'utf-8',
      );
    }
  });

  afterAll(() => {
    cleanupTmpDir(tmp);
  });

  it('plans only up to --target V002 (V003 excluded)', () => {
    const result = runCli(tmp, 'migrate apply --dry-run --target V002');
    expect(result.status).toBe(0);
    // Should plan 2 migrations, not 3
    expect(result.stdout).toMatch(/2 migration\(s\) would be applied/);
    expect(result.stdout).toContain('V001');
    expect(result.stdout).toContain('V002');
    expect(result.stdout).not.toContain('V003');
  });
});
