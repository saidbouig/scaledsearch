import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  OS_HOST,
  osEngine,
  isReachable,
  cleanupIndex,
  uniqueIndexName,
} from '../helpers/cluster';

const reachable = await isReachable(OS_HOST);
const describeIf = reachable ? describe : describe.skip;

describeIf(`OpenSearch engine (${OS_HOST})`, () => {
  const engine = osEngine();

  describe('basic ops', () => {
    const indexName = uniqueIndexName('ss_os_test');

    beforeAll(async () => {
      await cleanupIndex(engine, indexName);
    });

    afterAll(async () => {
      await cleanupIndex(engine, indexName);
    });

    it('connects to the cluster', async () => {
      expect(await engine.ping()).toBe(true);
    });

    it('reports cluster info', async () => {
      const info = await engine.getClusterInfo();
      expect(info.engine).toBe('opensearch');
    });

    it('creates and detects an index', async () => {
      await engine.createIndex(indexName, {
        mappings: { properties: { title: { type: 'text' } } },
      });
      expect(await engine.indexExists(indexName)).toBe(true);
    });

    it('indexes and retrieves a document', async () => {
      await engine.indexDocument(indexName, 'doc1', { title: 'hello opensearch' });
      const result = await engine.search(indexName, {
        query: { match: { title: 'opensearch' } },
      });
      expect(result.hits.total.value).toBeGreaterThan(0);
    });

    it('updates mapping', async () => {
      await engine.putMapping(indexName, {
        properties: { author: { type: 'keyword' } },
      });
      const mapping = await engine.getMapping(indexName);
      const props = mapping[indexName].mappings.properties;
      expect(props.author).toBeDefined();
    });

    it('deletes an index', async () => {
      const tmpIndex = uniqueIndexName('ss_os_delete');
      await engine.createIndex(tmpIndex, {});
      await engine.deleteIndex(tmpIndex);
      expect(await engine.indexExists(tmpIndex)).toBe(false);
    });
  });

  describe('putSettings / getSettings', () => {
    const idx = uniqueIndexName('os_set');

    beforeAll(async () => {
      await cleanupIndex(engine, idx);
      await engine.createIndex(idx, {});
    });
    afterAll(async () => await cleanupIndex(engine, idx));

    it('updates and reads a runtime setting (unprefixed form)', async () => {
      // NOTE: divergence vs ES adapter — OpenSearch adapter wraps as
      //   { index: settings }, so `{ index.number_of_replicas: 0 }` becomes
      //   `index.index.number_of_replicas` and ES rejects it. The ES client
      //   normalizes both forms. Until the OpenSearch adapter is hardened,
      //   callers must use the unprefixed form on OS.
      await engine.putSettings(idx, { number_of_replicas: 0 });
      const settings = await engine.getSettings(idx);
      const replicas = settings[idx].settings.index.number_of_replicas;
      expect(replicas).toBe('0');
    });
  });

  describe('close / open index', () => {
    const idx = uniqueIndexName('os_co');

    beforeAll(async () => {
      await cleanupIndex(engine, idx);
      await engine.createIndex(idx, {});
    });
    afterAll(async () => await cleanupIndex(engine, idx));

    it('closes and reopens an index', async () => {
      await engine.closeIndex(idx);
      await engine.openIndex(idx);
      expect(await engine.indexExists(idx)).toBe(true);
    });
  });

  describe('swap_alias', () => {
    const idxA = uniqueIndexName('os_swap_a');
    const idxB = uniqueIndexName('os_swap_b');
    const aliasName = `os_swap_alias_${Date.now()}`;

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
    const templateName = `os_tpl_${Date.now()}`;

    afterAll(async () => {
      try {
        await engine.deleteTemplate(templateName);
      } catch {
        // already deleted
      }
    });

    it('creates and deletes an index template', async () => {
      await engine.putTemplate(templateName, {
        index_patterns: ['os_tpl_idx_*'],
        template: { settings: { number_of_shards: 1 } },
      });
      await engine.deleteTemplate(templateName);
    });
  });

  describe('ingest pipeline put / delete', () => {
    const pipelineName = `os_pipe_${Date.now()}`;

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
    });
  });

  describe('reindex (sync small dataset)', () => {
    const src = uniqueIndexName('os_rx_src');
    const dst = uniqueIndexName('os_rx_dst');

    beforeAll(async () => {
      await cleanupIndex(engine, src);
      await cleanupIndex(engine, dst);
      await engine.createIndex(src, {
        mappings: { properties: { title: { type: 'text' } } },
      });
      await engine.indexDocument(src, '1', { title: 'one' });
      await engine.indexDocument(src, '2', { title: 'two' });
      await engine.createIndex(dst, {
        mappings: { properties: { title: { type: 'text' } } },
      });
    });

    afterAll(async () => {
      await cleanupIndex(engine, src);
      await cleanupIndex(engine, dst);
    });

    it('copies documents from source to destination', async () => {
      await engine.reindex(src, dst);
      await engine.apiCall('POST', `/${dst}/_refresh`);
      const result = await engine.search(dst, { query: { match_all: {} } });
      expect(result.hits.total.value).toBe(2);
    });
  });

  describe('apiCall (raw HTTP)', () => {
    it('passes through GET requests with parsed JSON', async () => {
      const result = await engine.apiCall('GET', '/_cluster/health');
      expect(result.cluster_name).toBeDefined();
      expect(['green', 'yellow', 'red']).toContain(result.status);
    });
  });

  describe('deleteDocument', () => {
    const idx = uniqueIndexName('os_del_doc');

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

  describe('error paths', () => {
    it('throws with a clear message on a non-existent index', async () => {
      await expect(engine.getMapping('does_not_exist_xyz_123')).rejects.toThrow(
        /failed|404|index_not_found/i,
      );
    });

    it('throws timeout-style error when host is unreachable', async () => {
      const { OpenSearchEngine } = await import('../../src/engine/opensearch');
      const bad = new OpenSearchEngine('http://localhost:1');
      await expect(bad.connect()).rejects.toThrow();
    });
  });
});
