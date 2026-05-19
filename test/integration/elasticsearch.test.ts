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

describeIf(`Elasticsearch engine (${ES_HOST})`, () => {
  const engine = esEngine();
  const indexName = uniqueIndexName('ss_es_test');

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
    expect(info.engine).toBe('elasticsearch');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('creates and detects an index', async () => {
    await engine.createIndex(indexName, {
      mappings: { properties: { title: { type: 'text' } } },
    });
    expect(await engine.indexExists(indexName)).toBe(true);
  });

  it('indexes and retrieves a document', async () => {
    await engine.indexDocument(indexName, 'doc1', { title: 'hello world' });
    const result = await engine.search(indexName, {
      query: { match: { title: 'hello' } },
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
    expect(props.author.type).toBe('keyword');
  });

  it('manages aliases', async () => {
    const alias = `${indexName}_alias`;
    await engine.addAlias(indexName, alias);
    const aliases = await engine.getAliases(indexName);
    expect(aliases).toContain(alias);
    await engine.removeAlias(indexName, alias);
    const after = await engine.getAliases(indexName);
    expect(after).not.toContain(alias);
  });

  it('lists indices', async () => {
    const indices = await engine.listIndices();
    expect(indices).toContain(indexName);
  });

  it('deletes an index', async () => {
    const tmpIndex = uniqueIndexName('ss_es_delete');
    await engine.createIndex(tmpIndex, {});
    expect(await engine.indexExists(tmpIndex)).toBe(true);
    await engine.deleteIndex(tmpIndex);
    expect(await engine.indexExists(tmpIndex)).toBe(false);
  });
});
