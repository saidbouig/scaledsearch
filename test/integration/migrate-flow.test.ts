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

function runCli(cwd: string, args: string): string {
  return execSync(`npx tsx ${CLI} ${args}`, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

describeIf('End-to-end migration flow against Elasticsearch', () => {
  let tmp: string;
  const indexName = uniqueIndexName('ss_e2e');
  const historyIndex = `.scaledsearch_history_${Date.now()}`;
  const engine = esEngine();

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-e2e-');
    await cleanupIndex(engine, indexName);
    await cleanupIndex(engine, historyIndex);
  });

  afterAll(async () => {
    await cleanupIndex(engine, indexName);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('init creates config + migrations dir', () => {
    runCli(tmp, 'migrate init');
    expect(fs.existsSync(path.join(tmp, '.scaledsearch/config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'migrations'))).toBe(true);
  });

  it('config can be customized to use unique history index', () => {
    const configPath = path.join(tmp, '.scaledsearch/config.yaml');
    const content = fs.readFileSync(configPath, 'utf-8');
    const updated = content.replace(
      /index:.*\.scaledsearch_history/,
      `index: "${historyIndex}"`,
    );
    fs.writeFileSync(configPath, updated, 'utf-8');
  });

  it('create generates a V001 migration file', () => {
    runCli(tmp, 'migrate create "create test index"');
    const files = fs.readdirSync(path.join(tmp, 'migrations'));
    const v001 = files.find(f => f.startsWith('V001__'));
    expect(v001).toBeDefined();
    expect(v001).toMatch(/^V001__create-test-index\.yaml$/);
  });

  it('edited migration creates the real index on apply', async () => {
    const files = fs.readdirSync(path.join(tmp, 'migrations'));
    const v001 = files.find(f => f.startsWith('V001__'))!;
    const v001Path = path.join(tmp, 'migrations', v001);

    fs.writeFileSync(
      v001Path,
      `description: create test index
operations:
  - type: create_index
    index: ${indexName}
    body:
      mappings:
        properties:
          title:
            type: text
`,
      'utf-8',
    );

    runCli(tmp, 'migrate apply');
    expect(await engine.indexExists(indexName)).toBe(true);
  });

  it('status shows V001 as applied', () => {
    const output = runCli(tmp, 'migrate status');
    expect(output).toMatch(/V001|001/);
  });

  it('validate passes on a clean state', () => {
    const output = runCli(tmp, 'migrate validate');
    expect(output.toLowerCase()).not.toMatch(/error|invalid/);
  });
});
