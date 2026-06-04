import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ES_HOST,
  esEngine,
  isReachable,
  cleanupIndex,
  uniqueIndexName,
} from '../helpers/cluster';

const reachable = await isReachable(ES_HOST);
const describeIf = reachable ? describe : describe.skip;

describeIf(`Engine adapter — extra methods against ${ES_HOST}`, () => {
  const engine = esEngine();

  describe('putSettings / getSettings', () => {
    const idx = uniqueIndexName('ss_set');

    beforeAll(async () => {
      await cleanupIndex(engine, idx);
      await engine.createIndex(idx, {});
    });
    afterAll(async () => await cleanupIndex(engine, idx));

    it('updates a runtime setting and reads it back', async () => {
      await engine.putSettings(idx, { 'index.number_of_replicas': 0 });
      const settings = await engine.getSettings(idx);
      const replicas = settings[idx].settings.index.number_of_replicas;
      expect(replicas).toBe('0');
    });
  });

  describe('close / open index', () => {
    const idx = uniqueIndexName('ss_co');

    beforeAll(async () => {
      await cleanupIndex(engine, idx);
      await engine.createIndex(idx, {});
    });
    afterAll(async () => await cleanupIndex(engine, idx));

    it('closes and reopens an index', async () => {
      await engine.closeIndex(idx);
      // We can't easily assert closed state through this surface, but reopen must work
      await engine.openIndex(idx);
      expect(await engine.indexExists(idx)).toBe(true);
    });
  });

  describe('swap_alias', () => {
    const idxA = uniqueIndexName('ss_swap_a');
    const idxB = uniqueIndexName('ss_swap_b');
    const aliasName = `ss_swap_alias_${Date.now()}`;

    beforeAll(async () => {
      await cleanupIndex(engine, idxA);
      await cleanupIndex(engine, idxB);
      await engine.createIndex(idxA, {});
      await engine.createIndex(idxB, {});
      await engine.addAlias(idxA, aliasName);
    });

    afterAll(async () => {
      await cleanupIndex(engine, idxA);
      await cleanupIndex(engine, idxB);
    });

    it('atomically moves the alias from A to B', async () => {
      await engine.swapAlias(aliasName, idxA, idxB);

      const aOn = await engine.getAliases(idxA);
      const bOn = await engine.getAliases(idxB);

      expect(aOn).not.toContain(aliasName);
      expect(bOn).toContain(aliasName);
    });
  });

  describe('index template put / delete', () => {
    const templateName = `ss_tpl_${Date.now()}`;

    afterAll(async () => {
      try {
        await engine.deleteTemplate(templateName);
      } catch {
        // already deleted
      }
    });

    it('creates and deletes an index template', async () => {
      await engine.putTemplate(templateName, {
        index_patterns: ['ss_tpl_idx_*'],
        template: {
          settings: { number_of_shards: 1 },
        },
      });
      // Delete must succeed; re-deleting will throw, which proves it existed
      await engine.deleteTemplate(templateName);
      let secondDeleteThrew = false;
      try {
        await engine.deleteTemplate(templateName);
      } catch {
        secondDeleteThrew = true;
      }
      expect(secondDeleteThrew).toBe(true);
    });
  });

  describe('ingest pipeline put / delete', () => {
    const pipelineName = `ss_pipe_${Date.now()}`;

    afterAll(async () => {
      try {
        await engine.deletePipeline(pipelineName);
      } catch {
        // already deleted
      }
    });

    it('creates and deletes an ingest pipeline', async () => {
      await engine.putPipeline(pipelineName, {
        description: 'test pipeline',
        processors: [{ set: { field: 'flag', value: true } }],
      });
      await engine.deletePipeline(pipelineName);
      let secondDeleteThrew = false;
      try {
        await engine.deletePipeline(pipelineName);
      } catch {
        secondDeleteThrew = true;
      }
      expect(secondDeleteThrew).toBe(true);
    });
  });

  describe('reindex (sync small dataset)', () => {
    const src = uniqueIndexName('ss_rx_src');
    const dst = uniqueIndexName('ss_rx_dst');

    beforeAll(async () => {
      await cleanupIndex(engine, src);
      await cleanupIndex(engine, dst);
      await engine.createIndex(src, {
        mappings: { properties: { title: { type: 'text' } } },
      });
      // index a few docs
      await engine.indexDocument(src, '1', { title: 'one' });
      await engine.indexDocument(src, '2', { title: 'two' });
      await engine.indexDocument(src, '3', { title: 'three' });
      await engine.createIndex(dst, {
        mappings: { properties: { title: { type: 'text' } } },
      });
    });

    afterAll(async () => {
      await cleanupIndex(engine, src);
      await cleanupIndex(engine, dst);
    });

    it('copies all documents from source to destination', async () => {
      await engine.reindex(src, dst);
      // reindex does not refresh the destination by default; force a refresh
      // before searching so the assertion sees the freshly indexed docs.
      await engine.apiCall('POST', `/${dst}/_refresh`);
      const result = await engine.search(dst, { query: { match_all: {} } });
      expect(result.hits.total.value).toBe(3);
    });
  });

  describe('apiCall (raw)', () => {
    it('passes through GET requests with parsed JSON', async () => {
      const result = await engine.apiCall('GET', '/_cluster/health');
      expect(result.cluster_name).toBeDefined();
      expect(['green', 'yellow', 'red']).toContain(result.status);
    });
  });

  describe('deleteDocument', () => {
    const idx = uniqueIndexName('ss_del_doc');

    beforeAll(async () => {
      await cleanupIndex(engine, idx);
      await engine.createIndex(idx, {});
      await engine.indexDocument(idx, 'doomed', { x: 1 });
    });
    afterAll(async () => await cleanupIndex(engine, idx));

    it('removes a single document', async () => {
      await engine.deleteDocument(idx, 'doomed');
      const result = await engine.search(idx, {
        query: { ids: { values: ['doomed'] } },
      });
      expect(result.hits.total.value).toBe(0);
    });
  });
});
