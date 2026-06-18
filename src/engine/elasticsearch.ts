import { Client } from '@elastic/elasticsearch';
import { SearchEngine, ClusterInfo, AliasInfo, IndexInfo, ReindexOptions } from './interface';
import { isBuiltinIndex, isBuiltinPipeline, isBuiltinTemplate } from './builtin-filters';

// Build a _reindex request body from source/dest plus optional tuning.
// Shared by reindex() and reindexAsync() so both honor op_type/conflicts/
// version_type/query identically. version_type and op_type live on `dest`;
// conflicts is top-level; query filters `source`.
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

export class ElasticsearchEngine implements SearchEngine {
  private client: Client;

  constructor(host: string, auth?: { type: string; username?: string; password?: string; apiKey?: string }) {
    const opts: any = { node: host };
    if (auth?.type === 'basic' && auth.username && auth.password) {
      opts.auth = { username: auth.username, password: auth.password };
    } else if (auth?.type === 'apikey' && auth.apiKey) {
      opts.auth = { apiKey: auth.apiKey };
    }
    this.client = new Client(opts);
  }

  async connect(): Promise<void> {
    await this.client.ping();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async getClusterInfo(): Promise<ClusterInfo> {
    const info = await this.client.info();
    const version = info.version.number;
    const distribution = info.version.distribution;
    const engine = distribution === 'opensearch' ? 'opensearch' : 'elasticsearch';
    return {
      name: info.cluster_name,
      version,
      engine,
      distribution,
    };
  }

  async createIndex(name: string, body: { settings?: any; mappings?: any }): Promise<void> {
    await this.client.indices.create({ index: name, ...body });
  }

  async putMapping(index: string, mappings: any): Promise<void> {
    await this.client.indices.putMapping({ index, ...mappings });
  }

  async putSettings(index: string, settings: any): Promise<void> {
    await this.client.indices.putSettings({ index, settings });
  }

  async deleteIndex(index: string): Promise<void> {
    await this.client.indices.delete({ index });
  }

  async indexExists(index: string): Promise<boolean> {
    return await this.client.indices.exists({ index });
  }

  async getMapping(index: string): Promise<any> {
    return await this.client.indices.getMapping({ index });
  }

  async getSettings(index: string): Promise<any> {
    return await this.client.indices.getSettings({ index });
  }

  async indexDocument(index: string, id: string, doc: any): Promise<void> {
    await this.client.index({ index, id, document: doc, refresh: 'true' });
  }

  async createDocument(index: string, id: string, doc: any): Promise<void> {
    await this.client.index({ index, id, document: doc, refresh: 'true', op_type: 'create' });
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    await this.client.delete({ index, id, refresh: 'true' });
  }

  async search(index: string, query: any): Promise<any> {
    return await this.client.search({ index, ...query });
  }

  async reindex(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<void> {
    await this.client.reindex(buildReindexBody(source, dest, script, options));
  }

  async reindexAsync(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<string> {
    const body = buildReindexBody(source, dest, script, options);
    const result = await this.client.reindex({ ...body, wait_for_completion: false } as any);
    return (result as any).task;
  }

  async getTask(taskId: string): Promise<{ completed: boolean; total?: number; created?: number; error?: any }> {
    const result: any = await this.client.tasks.get({ task_id: taskId });
    const status = result.task?.status;
    return {
      completed: result.completed,
      total: status?.total,
      created: status?.created,
      error: result.error,
    };
  }

  async closeIndex(index: string): Promise<void> {
    await this.client.indices.close({ index });
  }

  async openIndex(index: string): Promise<void> {
    await this.client.indices.open({ index });
  }

  async addAlias(
    index: string,
    alias: string,
    options?: { filter?: any; routing?: string; index_routing?: string; search_routing?: string; is_write_index?: boolean },
  ): Promise<void> {
    const body: any = { index, name: alias };
    if (options?.filter !== undefined) body.filter = options.filter;
    if (options?.routing !== undefined) body.routing = options.routing;
    if (options?.index_routing !== undefined) body.index_routing = options.index_routing;
    if (options?.search_routing !== undefined) body.search_routing = options.search_routing;
    if (options?.is_write_index !== undefined) body.is_write_index = options.is_write_index;
    await this.client.indices.putAlias(body);
  }

  async removeAlias(index: string, alias: string): Promise<void> {
    await this.client.indices.deleteAlias({ index, name: alias });
  }

  async swapAlias(alias: string, fromIndex: string, toIndex: string): Promise<void> {
    await this.client.indices.updateAliases({
      actions: [
        { remove: { index: fromIndex, alias } },
        { add: { index: toIndex, alias } },
      ],
    });
  }

  async putTemplate(name: string, body: any): Promise<void> {
    await this.client.indices.putIndexTemplate({ name, ...body });
  }

  async deleteTemplate(name: string): Promise<void> {
    await this.client.indices.deleteIndexTemplate({ name });
  }

  async putPipeline(name: string, body: any): Promise<void> {
    await this.client.ingest.putPipeline({ id: name, ...body });
  }

  async deletePipeline(name: string): Promise<void> {
    await this.client.ingest.deletePipeline({ id: name });
  }

  async listIndices(): Promise<string[]> {
    const result = await this.client.cat.indices({ format: 'json' });
    return (result as any[])
      .map((i: any) => i.index as string)
      .filter((name: string) => !isBuiltinIndex(name));
  }

  async listIndicesDetailed(): Promise<IndexInfo[]> {
    // `expand_wildcards=all` makes cat.indices return closed indices too.
    const result = await this.client.cat.indices({ format: 'json', expand_wildcards: 'all' });
    return (result as any[])
      .map((i: any) => ({ name: i.index as string, closed: i.status === 'close' }))
      .filter(i => !isBuiltinIndex(i.name));
  }

  async getAliases(index: string): Promise<string[]> {
    const result = await this.client.indices.getAlias({ index });
    const entry = (result as any)[index];
    if (!entry || !entry.aliases) return [];
    return Object.getOwnPropertyNames(entry.aliases);
  }

  async getAliasesDetailed(index: string): Promise<AliasInfo[]> {
    const result = await this.client.indices.getAlias({ index });
    const entry = (result as any)[index];
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
    const result: any = await this.client.indices.getIndexTemplate();
    const templates = (result?.index_templates ?? []) as Array<{ name: string }>;
    return templates
      .map(t => t.name)
      .filter(name => !isBuiltinTemplate(name));
  }

  async getTemplate(name: string): Promise<any> {
    const result: any = await this.client.indices.getIndexTemplate({ name });
    const entry = (result?.index_templates ?? [])[0];
    return entry?.index_template ?? {};
  }

  async listPipelines(): Promise<string[]> {
    let result: any;
    try {
      result = await this.client.ingest.getPipeline();
    } catch {
      return [];
    }
    return Object.getOwnPropertyNames(result ?? {}).filter(name => !isBuiltinPipeline(name));
  }

  async getPipeline(name: string): Promise<any> {
    const result: any = await this.client.ingest.getPipeline({ id: name });
    return result?.[name] ?? {};
  }

  async apiCall(method: string, path: string, body?: any): Promise<any> {
    const opts: any = { method, path };
    if (body) opts.body = body;
    return await this.client.transport.request(opts);
  }
}
