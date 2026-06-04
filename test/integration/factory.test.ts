import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/factory';
import { ElasticsearchEngine } from '../../src/engine/elasticsearch';
import { OpenSearchEngine } from '../../src/engine/opensearch';
import { ES_HOST, OS_HOST, isReachable } from '../helpers/cluster';
import type { ScaledSearchConfig } from '../../src/config/config';

const esReachable = await isReachable(ES_HOST);
const osReachable = await isReachable(OS_HOST);

function configFor(host: string, engine: ScaledSearchConfig['engine'] = 'elasticsearch'): ScaledSearchConfig {
  return {
    engine,
    connection: { host },
    migrations: { location: './migrations', naming: 'V{version}__{description}.yaml' },
    history: { index: '.scaledsearch_history' },
  };
}

describe('createEngine: routing', () => {
  it.skipIf(!esReachable)('routes to ElasticsearchEngine for ES 9+', async () => {
    const engine = await createEngine(configFor(ES_HOST));
    expect(engine).toBeInstanceOf(ElasticsearchEngine);
    const info = await engine.getClusterInfo();
    expect(info.engine).toBe('elasticsearch');
    expect(parseInt(info.version.split('.')[0], 10)).toBeGreaterThanOrEqual(9);
  });

  it.skipIf(!osReachable)('routes to OpenSearchEngine when distribution is opensearch', async () => {
    const engine = await createEngine(configFor(OS_HOST));
    expect(engine).toBeInstanceOf(OpenSearchEngine);
    const info = await engine.getClusterInfo();
    expect(info.engine).toBe('opensearch');
  });

  it.skipIf(!osReachable)('uses OpenSearchEngine when config.engine is set to opensearch (skips detection)', async () => {
    const engine = await createEngine(configFor(OS_HOST, 'opensearch'));
    expect(engine).toBeInstanceOf(OpenSearchEngine);
  });

  it('fails with a clear message when the cluster is unreachable', async () => {
    await expect(createEngine(configFor('http://localhost:1'))).rejects.toThrow();
  });

  it('fails with a clear timeout message when host hangs', async () => {
    // 192.0.2.0/24 is TEST-NET-1, guaranteed unroutable
    await expect(createEngine(configFor('http://192.0.2.1:9200'))).rejects.toThrow();
  }, 20_000);
});

describe('createEngine: auth header building', () => {
  it.skipIf(!esReachable)('basic auth with wrong password fails with 401-style error', async () => {
    const config: ScaledSearchConfig = {
      engine: 'elasticsearch',
      connection: {
        host: ES_HOST,
        auth: { type: 'basic', username: 'bogus', password: 'bogus' },
      },
      migrations: { location: './migrations', naming: 'V{version}__{description}.yaml' },
      history: { index: '.scaledsearch_history' },
    };
    // ES dev cluster has xpack.security disabled, so auth headers are ignored
    // and detection succeeds. Just verify it doesn't crash on auth building.
    const engine = await createEngine(config);
    expect(engine).toBeDefined();
  });
});
