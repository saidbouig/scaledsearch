export interface ClusterInfo {
  name: string;
  version: string;
  engine: 'elasticsearch' | 'opensearch';
  distribution?: string;
}

export interface SearchEngine {
  connect(): Promise<void>;
  getClusterInfo(): Promise<ClusterInfo>;
  ping(): Promise<boolean>;
  createIndex(name: string, body: { settings?: any; mappings?: any }): Promise<void>;
  putMapping(index: string, mappings: any): Promise<void>;
  putSettings(index: string, settings: any): Promise<void>;
  deleteIndex(index: string): Promise<void>;
  indexExists(index: string): Promise<boolean>;
  getMapping(index: string): Promise<any>;
  getSettings(index: string): Promise<any>;
  indexDocument(index: string, id: string, doc: any): Promise<void>;
  createDocument(index: string, id: string, doc: any): Promise<void>;
  deleteDocument(index: string, id: string): Promise<void>;
  search(index: string, query: any): Promise<any>;
  reindex(source: string, dest: string, script?: string): Promise<void>;
  closeIndex(index: string): Promise<void>;
  openIndex(index: string): Promise<void>;
  addAlias(index: string, alias: string): Promise<void>;
  removeAlias(index: string, alias: string): Promise<void>;
  swapAlias(alias: string, fromIndex: string, toIndex: string): Promise<void>;
  putTemplate(name: string, body: any): Promise<void>;
  deleteTemplate(name: string): Promise<void>;
  putPipeline(name: string, body: any): Promise<void>;
  deletePipeline(name: string): Promise<void>;
  apiCall(method: string, path: string, body?: any): Promise<any>;
}
