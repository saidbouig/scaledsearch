import { SearchEngine } from './interface';
import { ElasticsearchEngine } from './elasticsearch';
import { OpenSearchEngine } from './opensearch';
import { ScaledSearchConfig } from '../config/config';

async function detectEngine(host: string): Promise<'elasticsearch' | 'opensearch'> {
  try {
    const res = await fetch(host);
    const info = await res.json();
    if (info.version?.distribution === 'opensearch') {
      return 'opensearch';
    }
    return 'elasticsearch';
  } catch {
    return 'elasticsearch';
  }
}

export async function createEngine(config: ScaledSearchConfig): Promise<SearchEngine> {
  const { host, auth } = config.connection;

  if (config.engine === 'opensearch') {
    return new OpenSearchEngine(host, auth);
  }

  const detected = await detectEngine(host);
  if (detected === 'opensearch') {
    return new OpenSearchEngine(host, auth);
  }
  return new ElasticsearchEngine(host, auth);
}
