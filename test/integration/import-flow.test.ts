import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parse } from 'yaml';
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

describeIf('migrate import: baseline from live cluster', () => {
  const engine = esEngine();
  const idx1 = uniqueIndexName('ss_imp_a');
  const idx2 = uniqueIndexName('ss_imp_b');
  const aliasName = `${idx1}_alias`;
  let tmp: string;
  let historyIndex: string;

  beforeAll(async () => {
    tmp = makeTmpDir('scaledsearch-import-');
    historyIndex = `.scaledsearch_history_${Date.now()}_imp`;
    await cleanupIndex(engine, idx1);
    await cleanupIndex(engine, idx2);
    await cleanupIndex(engine, historyIndex);

    // Create two indices with mappings + an alias
    await engine.createIndex(idx1, {
      mappings: {
        properties: {
          title: { type: 'text' },
          created_at: { type: 'date' },
        },
      },
    });
    await engine.createIndex(idx2, {
      mappings: { properties: { id: { type: 'keyword' } } },
    });
    await engine.addAlias(idx1, aliasName);

    runCli(tmp, 'migrate init');
    setHistoryIndex(tmp, historyIndex);
  });

  afterAll(async () => {
    await cleanupIndex(engine, idx1);
    await cleanupIndex(engine, idx2);
    await cleanupIndex(engine, historyIndex);
    cleanupTmpDir(tmp);
  });

  it('generates V000__baseline.yaml from live indices', async () => {
    const result = runCli(tmp, 'migrate import');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Baseline imported/i);

    const baselinePath = path.join(tmp, 'migrations', 'V000__baseline.yaml');
    expect(fs.existsSync(baselinePath)).toBe(true);

    const parsed: any = parse(fs.readFileSync(baselinePath, 'utf-8'));
    expect(parsed.engine).toBe('elasticsearch');
    expect(Array.isArray(parsed.operations)).toBe(true);

    // Should contain create_index ops for both user indices
    const createOps = parsed.operations.filter((o: any) => o.type === 'create_index');
    const importedNames = createOps.map((o: any) => o.index);
    expect(importedNames).toContain(idx1);
    expect(importedNames).toContain(idx2);

    // Should contain the alias op
    const aliasOps = parsed.operations.filter((o: any) => o.type === 'add_alias');
    expect(aliasOps.some((o: any) => o.alias === aliasName && o.index === idx1)).toBe(true);

    // Mappings should be present on the index that had them
    const op1 = createOps.find((o: any) => o.index === idx1);
    expect(op1.mappings?.properties?.title?.type).toBe('text');
    expect(op1.mappings?.properties?.created_at?.type).toBe('date');
  });

  it('marks the baseline as applied so it does not re-execute', async () => {
    // Apply should see "All migrations already applied"
    const result = runCli(tmp, 'migrate apply');
    expect(result.stdout).toMatch(/All migrations already applied/i);
  });

  it('refuses to re-import when V000 already exists', () => {
    const result = runCli(tmp, 'migrate import');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/already exists/i);
  });
});

// "Empty cluster" can't be tested reliably against a shared docker cluster —
// other test files leave indices behind that this command would import. Skip
// rather than encode a flaky assertion about cluster-wide state.
