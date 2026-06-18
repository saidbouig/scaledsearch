export interface ClusterInfo {
  name: string;
  version: string;
  engine: 'elasticsearch' | 'opensearch';
  distribution?: string;
}

// Full alias attachment shape — captures filter/routing so import can
// round-trip aliases without silent data loss.
export interface AliasInfo {
  name: string;
  filter?: any;
  routing?: string;
  index_routing?: string;
  search_routing?: string;
  is_write_index?: boolean;
}

// listIndices entry — name plus whether the index is currently closed.
// Used by import to emit a `close_index` op when needed.
export interface IndexInfo {
  name: string;
  closed: boolean;
}

// Tuning for the reindex API. All optional; omitted fields fall back to ES
// defaults (op_type=index, conflicts=abort, version_type=internal, no query).
// These enable zero-downtime reindex with live writes: see MigrationOperation.
export interface ReindexOptions {
  opType?: 'create' | 'index';
  conflicts?: 'abort' | 'proceed';
  versionType?: 'internal' | 'external' | 'external_gte';
  query?: any;
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
  reindex(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<void>;
  reindexAsync(source: string, dest: string, script?: string, options?: ReindexOptions): Promise<string>;
  getTask(taskId: string): Promise<{ completed: boolean; total?: number; created?: number; error?: any }>;
  closeIndex(index: string): Promise<void>;
  openIndex(index: string): Promise<void>;
  addAlias(index: string, alias: string, options?: { filter?: any; routing?: string; index_routing?: string; search_routing?: string; is_write_index?: boolean }): Promise<void>;
  removeAlias(index: string, alias: string): Promise<void>;
  swapAlias(alias: string, fromIndex: string, toIndex: string): Promise<void>;
  putTemplate(name: string, body: any): Promise<void>;
  deleteTemplate(name: string): Promise<void>;
  putPipeline(name: string, body: any): Promise<void>;
  deletePipeline(name: string): Promise<void>;
  listIndices(): Promise<string[]>;
  // Richer listing for import — same filters as listIndices(), plus closed state.
  listIndicesDetailed(): Promise<IndexInfo[]>;
  getAliases(index: string): Promise<string[]>;
  // Richer alias info for import — preserves filter/routing/is_write_index.
  getAliasesDetailed(index: string): Promise<AliasInfo[]>;
  // Lists composable index templates managed by the user (built-ins filtered).
  listTemplates(): Promise<string[]>;
  getTemplate(name: string): Promise<any>;
  // Lists ingest pipelines managed by the user (built-ins filtered).
  listPipelines(): Promise<string[]>;
  getPipeline(name: string): Promise<any>;
  apiCall(method: string, path: string, body?: any): Promise<any>;
}
