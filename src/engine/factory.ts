import { SearchEngine } from './interface';
import { ElasticsearchEngine } from './elasticsearch';
import { OpenSearchEngine } from './opensearch';
import { ScaledSearchConfig } from '../config/config';

interface DetectedEngine {
  type: 'elasticsearch' | 'opensearch';
  majorVersion: number;
}

async function detectEngine(host: string): Promise<DetectedEngine> {
  try {
    const res = await fetch(host);
    const info = await res.json();
    const version = parseInt(info.version?.number?.split('.')[0] || '9', 10);
    if (info.version?.distribution === 'opensearch') {
      return { type: 'opensearch', majorVersion: version };
    }
    return { type: 'elasticsearch', majorVersion: version };
  } catch {
    return { type: 'elasticsearch', majorVersion: 9 };
  }
}

export async function createEngine(config: ScaledSearchConfig): Promise<SearchEngine> {
  const { host, auth } = config.connection;

  // OpenSearch always uses HTTP adapter
  if (config.engine === 'opensearch') {
    return new OpenSearchEngine(host, auth);
  }

  const detected = await detectEngine(host);

  // OpenSearch → HTTP adapter
  if (detected.type === 'opensearch') {
    return new OpenSearchEngine(host, auth);
  }

  // ES 7-8 → HTTP adapter (ES client v9 is incompatible with ES 7/8)
  if (detected.majorVersion < 9) {
    return new OpenSearchEngine(host, auth);
  }

  // ES 9+ → official ES client
  return new ElasticsearchEngine(host, auth);
}
