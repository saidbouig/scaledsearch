import { SearchEngine, ClusterInfo } from './interface';

/**
 * OpenSearch adapter using raw HTTP calls.
 * OpenSearch is API-compatible with ES 7.x, so we use fetch directly
 * to avoid @elastic/elasticsearch client version conflicts.
 */
export class OpenSearchEngine implements SearchEngine {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(host: string, auth?: { type: string; username?: string; password?: string }) {
    this.baseUrl = host.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (auth?.type === 'basic' && auth.username && auth.password) {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      this.headers['Authorization'] = `Basic ${encoded}`;
    }
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const opts: RequestInit = { method, headers: this.headers, signal: controller.signal };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text)?.error?.reason || text; } catch {}
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Authentication failed (${res.status}). Check your credentials in .scaledsearch/config.yaml`);
        }
        throw new Error(`${method} ${path} failed (${res.status}): ${msg}`);
      }
      return text ? JSON.parse(text) : {};
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after 30s: ${method} ${path}. Check if your cluster is reachable at ${this.baseUrl}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async connect(): Promise<void> {
    await this.request('GET', '/');
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('GET', '/');
      return true;
    } catch {
      return false;
    }
  }

  async getClusterInfo(): Promise<ClusterInfo> {
    const info = await this.request('GET', '/');
    const isOpenSearch = info.version.distribution === 'opensearch';
    return {
      name: info.cluster_name,
      version: info.version.number,
      engine: isOpenSearch ? 'opensearch' : 'elasticsearch',
      distribution: info.version.distribution,
    };
  }

  async createIndex(name: string, body: { settings?: any; mappings?: any }): Promise<void> {
    await this.request('PUT', `/${name}`, body);
  }

  async putMapping(index: string, mappings: any): Promise<void> {
    await this.request('PUT', `/${index}/_mapping`, mappings);
  }

  async putSettings(index: string, settings: any): Promise<void> {
    await this.request('PUT', `/${index}/_settings`, { index: settings });
  }

  async deleteIndex(index: string): Promise<void> {
    await this.request('DELETE', `/${index}`);
  }

  async indexExists(index: string): Promise<boolean> {
    try {
      await this.request('HEAD', `/${index}`);
      return true;
    } catch {
      return false;
    }
  }

  async getMapping(index: string): Promise<any> {
    return await this.request('GET', `/${index}/_mapping`);
  }

  async getSettings(index: string): Promise<any> {
    return await this.request('GET', `/${index}/_settings`);
  }

  async indexDocument(index: string, id: string, doc: any): Promise<void> {
    await this.request('PUT', `/${index}/_doc/${id}?refresh=true`, doc);
  }

  async createDocument(index: string, id: string, doc: any): Promise<void> {
    await this.request('PUT', `/${index}/_doc/${id}?refresh=true&op_type=create`, doc);
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    await this.request('DELETE', `/${index}/_doc/${id}?refresh=true`);
  }

  async search(index: string, query: any): Promise<any> {
    return await this.request('POST', `/${index}/_search`, query);
  }

  async reindex(source: string, dest: string, script?: string): Promise<void> {
    const body: any = { source: { index: source }, dest: { index: dest } };
    if (script) body.script = { source: script };
    await this.request('POST', '/_reindex', body);
  }

  async closeIndex(index: string): Promise<void> {
    await this.request('POST', `/${index}/_close`);
  }

  async openIndex(index: string): Promise<void> {
    await this.request('POST', `/${index}/_open`);
  }
}
