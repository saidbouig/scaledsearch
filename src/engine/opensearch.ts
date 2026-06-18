import { SearchEngine, ClusterInfo, AliasInfo, IndexInfo, ReindexOptions } from './interface';
import { isBuiltinIndex, isBuiltinPipeline, isBuiltinTemplate } from './builtin-filters';

// Build a _reindex request body from source/dest plus optional tuning.
// OpenSearch's reindex API mirrors Elasticsearch's: op_type/version_type on
// `dest`, conflicts top-level, query on `source`. Kept in sync with the ES
// adapter's buildReindexBody.
function buildReindexBody(source: string, dest: string, script?: string, options?: ReindexOptions): any {
  const src: any = { index: source };
  if (options?.query !== undefined) src.query = options.query;

  const dst: any = { index: dest };
  if (options?.opType !== undefined) dst.op_type = options.opType;
  if (options?.versionType !== undefined) dst.version_type = options.versionType;

  const body: any = { source: src, dest: dst };
  if (options?.conflicts !== undefined) body.conflicts = options.conflicts;
  if (script) body.script = { source: script };
  return body;
}

/**
 * OpenSearch adapter using raw HTTP calls.
 * OpenSearch is API-compatible with ES 7.x, so we use fetch directly
 * to avoid @elastic/elasticsearch client version conflicts.
 */
export class OpenSearchEngine implements SearchEngine {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(host: string, auth?: { type: string; username?: string; password?: string; apiKey?: string }) {
    this.baseUrl = host.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (auth?.type === 'basic' && auth.username && auth.password) {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      this.headers['Authorization'] = `Basic ${encoded}`;
    } else if (auth?.type === 'apikey' && auth.apiKey) {
      this.headers['Authorization'] = `ApiKey ${auth.apiKey}`;
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

  async reindex(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<void> {
    await this.request('POST', '/_reindex', buildReindexBody(source, dest, script, options));
  }

  async reindexAsync(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<string> {
    const body = buildReindexBody(source, dest, script, options);
    const result = await this.request('POST', '/_reindex?wait_for_completion=false', body);
    return result.task;
  }

  async getTask(taskId: string): Promise<{ completed: boolean; total?: number; created?: number; error?: any }> {
    const result = await this.request('GET', `/_tasks/${taskId}`);
    const status = result.task?.status;
    return {
      completed: result.completed,
      total: status?.total,
      created: status?.created,
      error: result.error,
    };
  }

  async closeIndex(index: string): Promise<void> {
    await this.request('POST', `/${index}/_close`);
  }

  async openIndex(index: string): Promise<void> {
    await this.request('POST', `/${index}/_open`);
  }

  async addAlias(
    index: string,
    alias: string,
    options?: { filter?: any; routing?: string; index_routing?: string; search_routing?: string; is_write_index?: boolean },
  ): Promise<void> {
    const add: any = { index, alias };
    if (options?.filter !== undefined) add.filter = options.filter;
    if (options?.routing !== undefined) add.routing = options.routing;
    if (options?.index_routing !== undefined) add.index_routing = options.index_routing;
    if (options?.search_routing !== undefined) add.search_routing = options.search_routing;
    if (options?.is_write_index !== undefined) add.is_write_index = options.is_write_index;
    await this.request('POST', '/_aliases', { actions: [{ add }] });
  }

  async removeAlias(index: string, alias: string): Promise<void> {
    await this.request('POST', '/_aliases', {
      actions: [{ remove: { index, alias } }],
    });
  }

  async swapAlias(alias: string, fromIndex: string, toIndex: string): Promise<void> {
    await this.request('POST', '/_aliases', {
      actions: [
        { remove: { index: fromIndex, alias } },
        { add: { index: toIndex, alias } },
      ],
    });
  }

  async putTemplate(name: string, body: any): Promise<void> {
    await this.request('PUT', `/_index_template/${name}`, body);
  }

  async deleteTemplate(name: string): Promise<void> {
    await this.request('DELETE', `/_index_template/${name}`);
  }

  async putPipeline(name: string, body: any): Promise<void> {
    await this.request('PUT', `/_ingest/pipeline/${name}`, body);
  }

  async deletePipeline(name: string): Promise<void> {
    await this.request('DELETE', `/_ingest/pipeline/${name}`);
  }

  async listIndices(): Promise<string[]> {
    const result = await this.request('GET', '/_cat/indices?format=json');
    return (result as any[])
      .map((i: any) => i.index as string)
      .filter((name: string) => !isBuiltinIndex(name));
  }

  async listIndicesDetailed(): Promise<IndexInfo[]> {
    // expand_wildcards=all surfaces closed indices in _cat/indices.
    const result = await this.request('GET', '/_cat/indices?format=json&expand_wildcards=all');
    return (result as any[])
      .map((i: any) => ({ name: i.index as string, closed: i.status === 'close' }))
      .filter(i => !isBuiltinIndex(i.name));
  }

  async getAliases(index: string): Promise<string[]> {
    const result = await this.request('GET', `/${index}/_alias`);
    const entry = result[index];
    if (!entry || !entry.aliases) return [];
    return Object.getOwnPropertyNames(entry.aliases);
  }

  async getAliasesDetailed(index: string): Promise<AliasInfo[]> {
    const result = await this.request('GET', `/${index}/_alias`);
    const entry = result[index];
    if (!entry || !entry.aliases) return [];
    return Object.entries(entry.aliases as Record<string, any>).map(([name, body]) => {
      const info: AliasInfo = { name };
      if (body?.filter !== undefined) info.filter = body.filter;
      if (body?.routing !== undefined) info.routing = body.routing;
      if (body?.index_routing !== undefined) info.index_routing = body.index_routing;
      if (body?.search_routing !== undefined) info.search_routing = body.search_routing;
      if (body?.is_write_index !== undefined) info.is_write_index = body.is_write_index;
      return info;
    });
  }

  async listTemplates(): Promise<string[]> {
    let result: any;
    try {
      result = await this.request('GET', '/_index_template');
    } catch {
      return [];
    }
    const templates = (result?.index_templates ?? []) as Array<{ name: string }>;
    return templates
      .map(t => t.name)
      .filter(name => !isBuiltinTemplate(name));
  }

  async getTemplate(name: string): Promise<any> {
    const result: any = await this.request('GET', `/_index_template/${name}`);
    const entry = (result?.index_templates ?? [])[0];
    return entry?.index_template ?? {};
  }

  async listPipelines(): Promise<string[]> {
    let result: any;
    try {
      result = await this.request('GET', '/_ingest/pipeline');
    } catch {
      return [];
    }
    return Object.getOwnPropertyNames(result ?? {}).filter(name => !isBuiltinPipeline(name));
  }

  async getPipeline(name: string): Promise<any> {
    const result: any = await this.request('GET', `/_ingest/pipeline/${name}`);
    return result?.[name] ?? {};
  }

  async apiCall(method: string, path: string, body?: any): Promise<any> {
    return await this.request(method.toUpperCase(), path, body);
  }
}
