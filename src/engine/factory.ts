import { SearchEngine } from './interface';
import { ElasticsearchEngine } from './elasticsearch';
import { OpenSearchEngine } from './opensearch';
import { ScaledSearchConfig } from '../config/config';

interface DetectedEngine {
  type: 'elasticsearch' | 'opensearch';
  majorVersion: number;
}

function buildAuthHeaders(auth?: { type: string; username?: string; password?: string; apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.type === 'basic' && auth.username && auth.password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  } else if (auth?.type === 'apikey' && auth.apiKey) {
    headers['Authorization'] = `ApiKey ${auth.apiKey}`;
  }
  return headers;
}

async function detectEngine(host: string, auth?: any): Promise<DetectedEngine> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = buildAuthHeaders(auth);
    const res = await fetch(host, { signal: controller.signal, headers });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (${res.status}). Check your auth settings in .scaledsearch/config.yaml`);
    }
    const info = await res.json();
    const version = parseInt(info.version?.number?.split('.')[0] || '9', 10);
    if (info.version?.distribution === 'opensearch') {
      return { type: 'opensearch', majorVersion: version };
    }
    return { type: 'elasticsearch', majorVersion: version };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Cannot reach cluster at ${host} (timed out after 10s). Is it running?`);
    }
    if (err.message?.includes('Authentication failed')) {
      throw err;
    }
    const reason = err.cause?.code || err.code || 'connection failed';
    throw new Error(`${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createEngine(config: ScaledSearchConfig): Promise<SearchEngine> {
  const { host, auth } = config.connection;

  // OpenSearch always uses HTTP adapter
  if (config.engine === 'opensearch') {
    return new OpenSearchEngine(host, auth);
  }

  const detected = await detectEngine(host, auth);

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
