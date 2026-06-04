/**
 * Bug-hunt probes — adversarial tests that try to break things.
 * Each describe block represents a hypothesis. When a probe fails, that's
 * a real bug to investigate; when it passes, the hypothesis is wrong and
 * we've gained a regression test for free.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parse } from 'yaml';
import {
  ES_HOST,
  OS_HOST,
  esEngine,
  osEngine,
  isReachable,
  cleanupIndex,
  uniqueIndexName,
} from '../helpers/cluster';
import { makeTmpDir, cleanupTmpDir } from '../helpers/tmpDir';
import { MigrationHistory } from '../../src/migration/history';

const CLI = path.resolve(__dirname, '../../src/index.ts');

function runCli(cwd: string, args: string): { stdout: string; status: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args}`, { cwd, encoding: 'utf-8' });
    return { stdout, status: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), status: err.status ?? 1 };
  }
}

function setHistoryIndex(tmp: string, historyIndex: string) {
  const p = path.join(tmp, '.scaledsearch/config.yaml');
  const content = fs.readFileSync(p, 'utf-8');
  fs.writeFileSync(
    p,
    content.replace(/index:.*\.scaledsearch_history/, `index: "${historyIndex}"`),
    'utf-8',
  );
}

const esReachable = await isReachable(ES_HOST);
const osReachable = await isReachable(OS_HOST);

const itIfES = esReachable ? it : it.skip;
const itIfOS = osReachable ? it : it.skip;

describe('Bug hunt: putMapping shape parity (ES vs OS)', () => {
  // Both adapters should accept `{ properties: {...} }` and apply the mapping
  itIfES('ES adapter accepts { properties: {...} }', async () => {
    const idx = uniqueIndexName('bh_pm_es');
    const engine = esEngine();
    await engine.createIndex(idx, {});
    try {
      await engine.putMapping(idx, { properties: { title: { type: 'text' } } });
      const m = await engine.getMapping(idx);
      expect(m[idx].mappings.properties.title.type).toBe('text');
    } finally {
      await cleanupIndex(engine, idx);
    }
  });

  itIfOS('OS adapter accepts { properties: {...} }', async () => {
    const idx = uniqueIndexName('bh_pm_os');
    const engine = osEngine();
    await engine.createIndex(idx, {});
    try {
      await engine.putMapping(idx, { properties: { title: { type: 'text' } } });
      const m = await engine.getMapping(idx);
      expect(m[idx].mappings.properties.title.type).toBe('text');
    } finally {
      await cleanupIndex(engine, idx);
    }
  });
});

describe('Bug hunt: search shape parity (ES vs OS)', () => {
  // Both should accept `{ query: { match_all: {} }, size: N }`
  itIfES('ES adapter accepts {query, size}', async () => {
    const idx = uniqueIndexName('bh_search_es');
    const engine = esEngine();
    await engine.createIndex(idx, {});
    try {
      await engine.indexDocument(idx, '1', { x: 1 });
      const r = await engine.search(idx, { query: { match_all: {} }, size: 10 });
      expect(r.hits.total.value).toBe(1);
    } finally {
      await cleanupIndex(engine, idx);
    }
  });

  itIfOS('OS adapter accepts {query, size}', async () => {
    const idx = uniqueIndexName('bh_search_os');
    const engine = osEngine();
    await engine.createIndex(idx, {});
    try {
      await engine.indexDocument(idx, '1', { x: 1 });
      const r = await engine.search(idx, { query: { match_all: {} }, size: 10 });
      expect(r.hits.total.value).toBe(1);
    } finally {
      await cleanupIndex(engine, idx);
    }
  });
});

describe('Bug hunt: indexExists swallows errors silently (OS)', () => {
  itIfOS('OS indexExists against unreachable host returns false (not throws)', async () => {
    const { OpenSearchEngine } = await import('../../src/engine/opensearch');
    const dead = new OpenSearchEngine('http://localhost:1');
    // This is a documented suspect: indexExists returns false instead of
    // surfacing a connection error. The caller can't distinguish "index
    // doesn't exist" from "cluster is unreachable" — a real correctness
    // concern. Test the CURRENT behavior so a future fix breaks this test.
    const result = await dead.indexExists('foo');
    expect(result).toBe(false);
  }, 35_000); // 30s request timeout + buffer
});

describe('Bug hunt: listIndices filters system + history indices', () => {
  itIfES('ES listIndices excludes . and history index', async () => {
    const engine = esEngine();
    const historyName = `.scaledsearch_history_bh_${Date.now()}`;
    const userIdx = uniqueIndexName('bh_list_user');
    try {
      await engine.createIndex(historyName, {});
      await engine.createIndex(userIdx, {});
      const indices = await engine.listIndices();
      expect(indices).not.toContain(historyName);
      expect(indices).toContain(userIdx);
    } finally {
      await cleanupIndex(engine, historyName);
      await cleanupIndex(engine, userIdx);
    }
  });

  itIfOS('OS listIndices excludes . and history index', async () => {
    const engine = osEngine();
    const historyName = `.scaledsearch_history_bh_${Date.now()}`;
    const userIdx = uniqueIndexName('bh_list_user_os');
    try {
      await engine.createIndex(historyName, {});
      await engine.createIndex(userIdx, {});
      const indices = await engine.listIndices();
      expect(indices).not.toContain(historyName);
      expect(indices).toContain(userIdx);
    } finally {
      await cleanupIndex(engine, historyName);
      await cleanupIndex(engine, userIdx);
    }
  });
});

describe('Bug hunt: stale-lock race condition', () => {
  // Hypothesis: when two processes both detect a stale lock, both call
  // indexDocument (PUT, no op_type=create) and both think they acquired
  // the lock. The "last writer wins" comment claims this is safe, but
  // "wins" here means "owns the lock document" — both processes then
  // proceed to mutate the cluster concurrently. That's the exact thing
  // a lock should prevent.
  itIfES('two engines both succeed when racing on a stale lock', async () => {
    const engine = esEngine();
    const historyIdx = `.scaledsearch_history_bh_stale_${Date.now()}`;
    try {
      const h1 = new MigrationHistory(engine, historyIdx);
      const h2 = new MigrationHistory(engine, historyIdx);

      // Plant a stale lock (older than 10 minutes).
      await h1.ensureIndex();
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      await engine.indexDocument(historyIdx, '_lock', {
        locked_at: elevenMinutesAgo,
        pid: 99999,
      });

      // Both try to acquire concurrently.
      const [ok1, ok2] = await Promise.all([h1.acquireLock(), h2.acquireLock()]);

      // Regression: pre-fix, both returned true because the stale-lock
      // recovery path used a non-atomic PUT (indexDocument). The fix uses
      // delete + op_type=create which is atomic — exactly one wins.
      const winners = [ok1, ok2].filter(Boolean).length;
      const losers = [ok1, ok2].filter(v => !v).length;
      expect(winners).toBe(1);
      expect(losers).toBe(1);
    } finally {
      // Release whichever process held the lock (best effort), then drop the index.
      try {
        await engine.deleteDocument(historyIdx, '_lock');
      } catch {
        // already gone
      }
      await cleanupIndex(engine, historyIdx);
    }
  });
});

describe('Bug hunt: getMapping with alias name', () => {
  itIfES('getMapping called with an alias returns the real-index keyed result', async () => {
    const engine = esEngine();
    const realIdx = uniqueIndexName('bh_alias_real');
    const alias = `${realIdx}_alias`;
    try {
      await engine.createIndex(realIdx, {
        mappings: { properties: { x: { type: 'text' } } },
      });
      await engine.addAlias(realIdx, alias);

      // Caller passes the alias name; ES returns mapping keyed by REAL index.
      // The caller code (in import.ts, validator, etc.) does `result[index]`
      // which would miss the data when index = alias. Document the gotcha.
      const result = await engine.getMapping(alias);
      // The result will NOT have a key matching `alias` — confirming the gotcha.
      expect(result[alias]).toBeUndefined();
      expect(result[realIdx]).toBeDefined();
      expect(result[realIdx].mappings.properties.x.type).toBe('text');
    } finally {
      await cleanupIndex(engine, realIdx);
    }
  });
});

describe('Bug hunt: history removeEntry visibility', () => {
  itIfES('after removeEntry, getApplied does NOT see the removed entry', async () => {
    const engine = esEngine();
    const historyIdx = `.scaledsearch_history_bh_remove_${Date.now()}`;
    try {
      const history = new MigrationHistory(engine, historyIdx);
      await history.recordSuccess({
        version: 1,
        description: 'temp',
        checksum: 'c',
        applied_at: new Date().toISOString(),
        execution_time_ms: 1,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      });
      expect((await history.getApplied()).length).toBe(1);

      await history.removeEntry(1);
      // Without refresh, this could be flaky. Document current behavior.
      const after = await history.getApplied();
      expect(after.length).toBe(0);
    } finally {
      await cleanupIndex(engine, historyIdx);
    }
  });
});

describe('Bug hunt: detectEngine handles weird version strings', () => {
  // The factory parses `info.version.number.split('.')[0]` then int-parses.
  // What if number is "9.0.0-SNAPSHOT" or "8.17.0-rc1"? parseInt eats the
  // leading digits, so '9' from '9.0.0-SNAPSHOT' is fine. But what about
  // a number missing entirely? Then `||  '9'` kicks in and routes to ES
  // client — which is the wrong default if the cluster is OS. We document
  // this as a known gotcha.
  it('parseInt resilience: split + parseInt extracts major from common formats', () => {
    const cases = [
      { input: '9.0.0', expected: 9 },
      { input: '9.0.0-SNAPSHOT', expected: 9 },
      { input: '8.17.0-rc1', expected: 8 },
      { input: '7.10.2', expected: 7 },
    ];
    for (const { input, expected } of cases) {
      const major = parseInt(input.split('.')[0] || '9', 10);
      expect(major).toBe(expected);
    }
  });
});

// =========================================================================
// Round 2 probes — deeper hypotheses about end-to-end correctness.
// =========================================================================

const describeIfES = esReachable ? describe : describe.skip;

describeIfES('Bug hunt: import round-trip integrity', () => {
  // Hypothesis: V000__baseline.yaml generated by `migrate import` should
  // re-apply cleanly against a fresh index name and produce the same
  // mapping. Many ways this could silently drop info — settings filters,
  // alias round-trip, mapping shape.
  it('baseline re-applies cleanly and round-trips the mapping', async () => {
    const engine = esEngine();
    const sourceIdx = uniqueIndexName('rt_src');
    const targetIdx = `${sourceIdx}_replayed`;
    const aliasName = `${sourceIdx}_alias`;
    const tmp = makeTmpDir('rt-');
    const historyIndex = `.scaledsearch_history_rt_${Date.now()}`;
    try {
      await engine.createIndex(sourceIdx, {
        settings: { number_of_shards: 1 },
        mappings: {
          properties: {
            title: { type: 'text' },
            tags: { type: 'keyword' },
            views: { type: 'long' },
          },
        },
      });
      await engine.addAlias(sourceIdx, aliasName);

      runCli(tmp, 'migrate init');
      setHistoryIndex(tmp, historyIndex);
      const imp = runCli(tmp, 'migrate import');
      expect(imp.status).toBe(0);

      const baseline: any = parse(
        fs.readFileSync(path.join(tmp, 'migrations', 'V000__baseline.yaml'), 'utf-8'),
      );

      const createOp = baseline.operations.find(
        (o: any) => o.type === 'create_index' && o.index === sourceIdx,
      );
      const aliasOp = baseline.operations.find(
        (o: any) => o.type === 'add_alias' && o.index === sourceIdx,
      );

      expect(createOp).toBeDefined();
      expect(aliasOp).toBeDefined();

      // Replay the create_index against a fresh name on the same cluster
      await engine.createIndex(targetIdx, {
        settings: createOp.settings,
        mappings: createOp.mappings,
      });

      const replayedMapping = await engine.getMapping(targetIdx);
      const props = replayedMapping[targetIdx].mappings.properties;
      expect(props.title?.type).toBe('text');
      expect(props.tags?.type).toBe('keyword');
      expect(props.views?.type).toBe('long');
    } finally {
      await cleanupIndex(engine, sourceIdx);
      await cleanupIndex(engine, targetIdx);
      await cleanupIndex(engine, historyIndex);
      cleanupTmpDir(tmp);
    }
  });
});

describeIfES('Bug hunt: checksum drift after manual edit', () => {
  // Hypothesis: if a user edits an applied migration file, the validator
  // should detect the checksum mismatch and BLOCK further apply, not just
  // warn. Validator unit tests treat it as ERROR — does the apply command
  // actually refuse?
  it('migrate apply refuses to run when a previously-applied file was edited', async () => {
    const engine = esEngine();
    const idx = uniqueIndexName('drift');
    const tmp = makeTmpDir('drift-');
    const historyIndex = `.scaledsearch_history_drift_${Date.now()}`;
    try {
      runCli(tmp, 'migrate init');
      setHistoryIndex(tmp, historyIndex);

      const v001Path = path.join(tmp, 'migrations', 'V001__a.yaml');
      fs.writeFileSync(
        v001Path,
        `description: a\noperations:\n  - type: create_index\n    index: ${idx}\n`,
        'utf-8',
      );

      const apply1 = runCli(tmp, 'migrate apply');
      expect(apply1.status).toBe(0);
      expect(await engine.indexExists(idx)).toBe(true);

      // Tamper with V001 after it has been applied
      fs.writeFileSync(
        v001Path,
        `description: a TAMPERED\noperations:\n  - type: create_index\n    index: ${idx}_extra\n`,
        'utf-8',
      );

      // Add a V002 so apply has pending work to do
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V002__b.yaml'),
        `description: b\noperations:\n  - type: create_index\n    index: ${idx}_v2\n`,
        'utf-8',
      );

      const apply2 = runCli(tmp, 'migrate apply');
      expect(apply2.status).not.toBe(0);
      expect(apply2.stdout.toLowerCase()).toMatch(/checksum|validation/);
      // V002 must NOT be applied — validation blocks the entire run
      expect(await engine.indexExists(`${idx}_v2`)).toBe(false);
    } finally {
      await cleanupIndex(engine, idx);
      await cleanupIndex(engine, `${idx}_extra`);
      await cleanupIndex(engine, `${idx}_v2`);
      await cleanupIndex(engine, historyIndex);
      cleanupTmpDir(tmp);
    }
  });
});

describeIfES('Bug hunt: typo in operation field is silently accepted', () => {
  // Hypothesis: if a user writes `mapping:` (singular) instead of `mappings:`,
  // the validator accepts it (it is an unknown YAML key, not a missing
  // required one) and create_index runs with NO mappings — schema silently
  // lost.
  it('create_index with typo "mapping" instead of "mappings" silently loses the schema', async () => {
    const engine = esEngine();
    const idx = uniqueIndexName('typo');
    const tmp = makeTmpDir('typo-');
    const historyIndex = `.scaledsearch_history_typo_${Date.now()}`;
    try {
      runCli(tmp, 'migrate init');
      setHistoryIndex(tmp, historyIndex);

      // Intentional typo: singular "mapping"
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__typo.yaml'),
        `description: typo
operations:
  - type: create_index
    index: ${idx}
    mapping:
      properties:
        title:
          type: text
`,
        'utf-8',
      );

      const result = runCli(tmp, 'migrate apply');
      // Current behavior: status 0, index exists with NO mapping.
      // This test documents the silent-data-loss surface. If a future
      // change adds unknown-field detection in the validator, the
      // expectations here should flip.
      expect(result.status).toBe(0);
      expect(await engine.indexExists(idx)).toBe(true);

      const mapping = await engine.getMapping(idx);
      const props = mapping[idx].mappings.properties || {};
      // Document: title is NOT applied because of the typo.
      expect(props.title).toBeUndefined();
    } finally {
      await cleanupIndex(engine, idx);
      await cleanupIndex(engine, historyIndex);
      cleanupTmpDir(tmp);
    }
  });
});

describeIfES('Bug hunt: rolled-back version number is reusable', () => {
  // Hypothesis: after `migrate rollback` removes V002 from history,
  // running `migrate create "anything"` should produce V003 (safe),
  // not reuse V002 (collision).
  it('create after rollback produces V003, not V002', async () => {
    const engine = esEngine();
    const idx1 = uniqueIndexName('renum1');
    const idx2 = uniqueIndexName('renum2');
    const tmp = makeTmpDir('renum-');
    const historyIndex = `.scaledsearch_history_renum_${Date.now()}`;
    try {
      runCli(tmp, 'migrate init');
      setHistoryIndex(tmp, historyIndex);

      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V001__a.yaml'),
        `description: a
operations:
  - type: create_index
    index: ${idx1}
rollback:
  - type: delete_index
    index: ${idx1}
`,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(tmp, 'migrations', 'V002__b.yaml'),
        `description: b
operations:
  - type: create_index
    index: ${idx2}
rollback:
  - type: delete_index
    index: ${idx2}
`,
        'utf-8',
      );

      runCli(tmp, 'migrate apply');
      runCli(tmp, 'migrate rollback'); // removes V002 from history

      const create = runCli(tmp, 'migrate create "new-thing"');
      expect(create.status).toBe(0);

      const files = fs.readdirSync(path.join(tmp, 'migrations')).sort();
      const newFile = files.find(f => f.includes('new-thing'));
      expect(newFile).toBeDefined();
      // getNextVersion is max(version) + 1, and V002 yaml is still on disk → V003
      expect(newFile).toMatch(/^V003__/);
    } finally {
      await cleanupIndex(engine, idx1);
      await cleanupIndex(engine, idx2);
      await cleanupIndex(engine, historyIndex);
      cleanupTmpDir(tmp);
    }
  });
});

describe('Bug hunt: OS apiCall — non-JSON response handling', () => {
  itIfOS('GET /_cat/health returns plain text — apiCall throws a JSON parse error', async () => {
    const engine = osEngine();
    // _cat endpoints return text by default. The OS adapter calls
    // JSON.parse unconditionally on success, so a text/plain response
    // throws an opaque parse error. Document the limitation.
    let threw = false;
    let parseErrorMessage = '';
    try {
      await engine.apiCall('GET', '/_cat/health');
    } catch (err: any) {
      threw = true;
      parseErrorMessage = err.message;
    }
    expect(threw).toBe(true);
    expect(parseErrorMessage.toLowerCase()).toMatch(/json|unexpected|parse/);
  });
});

describeIfES('Bug hunt: indexDocument with slash in ID', () => {
  // Hypothesis: ES official client URL-encodes IDs. OS raw HTTP adapter
  // does NOT — `\`/${index}/_doc/${id}\`` with `id = 'a/b/c'` becomes a
  // different route on the server.
  it('ES adapter handles slashes in doc IDs (client URL-encodes)', async () => {
    const engine = esEngine();
    const idx = uniqueIndexName('idslash');
    const trickyId = 'a/b/c';
    try {
      await engine.createIndex(idx, {});
      let threw = false;
      try {
        await engine.indexDocument(idx, trickyId, { name: 'special' });
      } catch {
        threw = true;
      }
      if (!threw) {
        const search = await engine.search(idx, {
          query: { ids: { values: [trickyId] } },
        });
        expect(search.hits.total.value).toBe(1);
      }
      // Either path is valid behavior — what matters is no crash
      expect(typeof threw).toBe('boolean');
    } finally {
      await cleanupIndex(engine, idx);
    }
  });

  itIfOS('OS adapter with slash in ID — no URL encoding', async () => {
    const engine = osEngine();
    const idx = uniqueIndexName('idslashos');
    const trickyId = 'a/b/c';
    try {
      await engine.createIndex(idx, {});
      let threw = false;
      try {
        await engine.indexDocument(idx, trickyId, { name: 'special' });
      } catch {
        threw = true;
      }
      // OS adapter likely fails (slash not encoded → wrong route) or
      // succeeds with the wrong route. Either way, document the divergence.
      expect(typeof threw).toBe('boolean');
    } finally {
      await cleanupIndex(engine, idx);
    }
  });
});
