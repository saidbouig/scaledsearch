import { SearchEngine } from '../engine/interface';

export interface HistoryEntry {
  version: number;
  description: string;
  checksum: string;
  applied_at: string;
  execution_time_ms: number;
  status: 'success' | 'failed';
  engine: string;
  engine_version: string;
}

const HISTORY_MAPPING = {
  mappings: {
    properties: {
      version: { type: 'integer' as const },
      description: { type: 'keyword' as const },
      checksum: { type: 'keyword' as const },
      applied_at: { type: 'date' as const },
      execution_time_ms: { type: 'long' as const },
      status: { type: 'keyword' as const },
      engine: { type: 'keyword' as const },
      engine_version: { type: 'keyword' as const },
    },
  },
};

export class MigrationHistory {
  private engine: SearchEngine;
  private indexName: string;

  constructor(engine: SearchEngine, indexName: string = '.scaledsearch_history') {
    this.engine = engine;
    this.indexName = indexName;
  }

  async ensureIndex(): Promise<void> {
    const exists = await this.engine.indexExists(this.indexName);
    if (!exists) {
      await this.engine.createIndex(this.indexName, HISTORY_MAPPING);
    }
  }

  async getApplied(): Promise<HistoryEntry[]> {
    const exists = await this.engine.indexExists(this.indexName);
    if (!exists) return [];

    const result = await this.engine.search(this.indexName, {
      query: { exists: { field: 'version' } },
      sort: [{ version: 'asc' }],
      size: 10000,
    });

    return result.hits.hits
      .filter((hit: any) => hit._id !== '_lock')
      .map((hit: any) => hit._source as HistoryEntry);
  }

  async recordSuccess(entry: Omit<HistoryEntry, 'status'>): Promise<void> {
    await this.ensureIndex();
    await this.engine.indexDocument(this.indexName, `v${entry.version}`, {
      ...entry,
      status: 'success',
    });
  }

  async recordFailure(entry: Omit<HistoryEntry, 'status'>): Promise<void> {
    await this.ensureIndex();
    await this.engine.indexDocument(this.indexName, `v${entry.version}`, {
      ...entry,
      status: 'failed',
    });
  }

  async removeEntry(version: number): Promise<void> {
    await this.engine.deleteDocument(this.indexName, `v${version}`);
  }

  async acquireLock(): Promise<boolean> {
    await this.ensureIndex();
    // Use create-with-id + op_type=create for atomicity — fails if doc already exists
    try {
      await this.engine.createDocument(this.indexName, '_lock', {
        locked_at: new Date().toISOString(),
        pid: process.pid,
      });
      return true;
    } catch (err: any) {
      // Document already exists — check if stale (> 10 min)
      try {
        const result = await this.engine.search(this.indexName, {
          query: { ids: { values: ['_lock'] } },
        });
        if (result.hits.hits.length > 0) {
          const lock = result.hits.hits[0]._source;
          const lockAge = Date.now() - new Date(lock.locked_at).getTime();
          if (lockAge > 10 * 60 * 1000) {
            // Stale lock — atomically replace it. Delete first, then attempt
            // an op_type=create write. If two processes both see the stale
            // lock and race here, the delete is idempotent but the create
            // is atomic: exactly one process's create succeeds, the other
            // throws and returns false.
            try {
              await this.engine.deleteDocument(this.indexName, '_lock');
            } catch {
              // Already deleted by another racer — fine, the create will
              // either succeed (if no one else has created it yet) or fail
              // (if a racer beat us to it).
            }
            try {
              await this.engine.createDocument(this.indexName, '_lock', {
                locked_at: new Date().toISOString(),
                pid: process.pid,
              });
              return true;
            } catch {
              return false; // Another process won the stale-lock recovery race
            }
          }
        }
        return false; // Active lock held by another process
      } catch {
        return false; // Can't determine lock state — refuse to proceed
      }
    }
  }

  async releaseLock(): Promise<void> {
    try {
      await this.engine.deleteDocument(this.indexName, '_lock');
    } catch {
      // Best-effort cleanup
    }
  }
}
