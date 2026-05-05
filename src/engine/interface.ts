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
  search(index: string, query: any): Promise<any>;
  reindex(source: string, dest: string, script?: string): Promise<void>;
  closeIndex(index: string): Promise<void>;
  openIndex(index: string): Promise<void>;
}
