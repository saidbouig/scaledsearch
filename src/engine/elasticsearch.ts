import { Client } from '@elastic/elasticsearch';
import { SearchEngine, ClusterInfo } from './interface';

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

  async reindex(source: string, dest: string, script?: string): Promise<void> {
    const body: any = { source: { index: source }, dest: { index: dest } };
    if (script) {
      body.script = { source: script };
    }
    await this.client.reindex(body);
  }

  async closeIndex(index: string): Promise<void> {
    await this.client.indices.close({ index });
  }

  async openIndex(index: string): Promise<void> {
    await this.client.indices.open({ index });
  }

  async addAlias(index: string, alias: string): Promise<void> {
    await this.client.indices.putAlias({ index, name: alias });
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

  async apiCall(method: string, path: string, body?: any): Promise<any> {
    const opts: any = { method, path };
    if (body) opts.body = body;
    return await this.client.transport.request(opts);
  }
}
