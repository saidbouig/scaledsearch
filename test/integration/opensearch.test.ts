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
