import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

describeIf('Rollback flow against Elasticsearch', () => {
  const engine = esEngine();
  let tmp: string;
  let indexName: string;
  let historyIndex: string;

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-rollback-');
    indexName = uniqueIndexName('ss_rb');
    historyIndex = `.scaledsearch_history_${Date.now()}`;
    await cleanupIndex(engine, indexName);
    await cleanupIndex(engine, historyIndex);

    // init project
    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);
  });

  afterAll(async () => {
    await cleanupIndex(engine, indexName);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('refuses to rollback when no migrations are applied', () => {
    const result = runCli(tmp, 'migrate rollback');
    expect(result.stdout).toMatch(/No migrations to rollback/i);
  });

  it('refuses to rollback a migration that has no rollback section', async () => {
    const v001 = path.join(tmp, 'migrations', 'V001__create-index.yaml');
    fs.writeFileSync(
      v001,
      `description: create index
operations:
  - type: create_index
    index: ${indexName}
    body:
      mappings:
        properties:
          name:
            type: text
`,
      'utf-8',
    );

    const apply = runCli(tmp, 'migrate apply');
    expect(apply.status).toBe(0);
    expect(await engine.indexExists(indexName)).toBe(true);

    const rb = runCli(tmp, 'migrate rollback');
    expect(rb.status).not.toBe(0);
    expect(rb.stdout).toMatch(/no rollback section/i);
    // Index must NOT be deleted because rollback refused
    expect(await engine.indexExists(indexName)).toBe(true);
  });

  it('rolls back the last applied migration when a rollback section exists', async () => {
    // Add V002 with a rollback section that drops the index created in V001
    const v002 = path.join(tmp, 'migrations', 'V002__add-mapping.yaml');
    const aliasName = `${indexName}_alias`;
    fs.writeFileSync(
      v002,
      `description: add alias
operations:
  - type: add_alias
    index: ${indexName}
    alias: ${aliasName}
rollback:
  - type: remove_alias
    index: ${indexName}
    alias: ${aliasName}
`,
      'utf-8',
    );

    const apply = runCli(tmp, 'migrate apply');
    expect(apply.status).toBe(0);
    const aliasesAfterApply = await engine.getAliases(indexName);
    expect(aliasesAfterApply).toContain(aliasName);

    const rb = runCli(tmp, 'migrate rollback');
    expect(rb.status).toBe(0);
    const aliasesAfterRollback = await engine.getAliases(indexName);
    expect(aliasesAfterRollback).not.toContain(aliasName);
  });

  it('status no longer shows V002 after rollback', () => {
    const status = runCli(tmp, 'migrate status');
    // V002 should be marked pending again, V001 still applied
    expect(status.stdout).toMatch(/V002|002/);
    expect(status.stdout.toLowerCase()).toContain('pending');
  });
});
