import { ElasticsearchEngine } from '../../src/engine/elasticsearch';
import { OpenSearchEngine } from '../../src/engine/opensearch';
import type { SearchEngine } from '../../src/engine/interface';

export const ES_HOST = process.env.ES_TEST_HOST ?? 'http://localhost:9200';
export const OS_HOST = process.env.OS_TEST_HOST ?? 'http://localhost:9201';

export async function isReachable(host: string): Promise<boolean> {
  try {
    const res = await fetch(`${host}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function esEngine(): SearchEngine {
  return new ElasticsearchEngine(ES_HOST);
}

export function osEngine(): SearchEngine {
  return new OpenSearchEngine(OS_HOST);
}

export async function cleanupIndex(engine: SearchEngine, name: string): Promise<void> {
  try {
    if (await engine.indexExists(name)) {
      await engine.deleteIndex(name);
    }
  } catch {
    // ignore
  }
}

export function uniqueIndexName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
