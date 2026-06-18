import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeOperation } from '../../src/migration/executor';
import type { SearchEngine } from '../../src/engine/interface';

function fakeEngine(): SearchEngine {
  return {
    connect: vi.fn(),
    getClusterInfo: vi.fn(),
    ping: vi.fn(),
    createIndex: vi.fn(),
    putMapping: vi.fn(),
    putSettings: vi.fn(),
    deleteIndex: vi.fn(),
    indexExists: vi.fn().mockResolvedValue(false),
    getMapping: vi.fn(),
    getSettings: vi.fn(),
    indexDocument: vi.fn(),
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    search: vi.fn(),
    reindex: vi.fn(),
    reindexAsync: vi.fn(),
    getTask: vi.fn(),
    closeIndex: vi.fn(),
    openIndex: vi.fn(),
    addAlias: vi.fn(),
    removeAlias: vi.fn(),
    swapAlias: vi.fn(),
    putTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    putPipeline: vi.fn(),
    deletePipeline: vi.fn(),
    listIndices: vi.fn(),
    getAliases: vi.fn(),
    apiCall: vi.fn(),
  } as unknown as SearchEngine;
}

describe('executor: create_index payload normalization', () => {
  it('accepts direct mappings field', async () => {
    const engine = fakeEngine();
    await executeOperation(engine, {
      type: 'create_index',
      index: 'users',
      mappings: { properties: { name: { type: 'text' } } },
    });
    expect(engine.createIndex).toHaveBeenCalledWith('users', {
      settings: undefined,
      mappings: { properties: { name: { type: 'text' } } },
    });
  });

  it('unwraps Flyway-style body.mappings without double-nesting', async () => {
    const engine = fakeEngine();
    await executeOperation(engine, {
      type: 'create_index',
      index: 'users',
      body: { mappings: { properties: { name: { type: 'text' } } } },
    });
    expect(engine.createIndex).toHaveBeenCalledWith('users', {
      settings: undefined,
      mappings: { properties: { name: { type: 'text' } } },
    });
  });

  it('accepts body with both mappings and settings', async () => {
    const engine = fakeEngine();
    await executeOperation(engine, {
      type: 'create_index',
      index: 'users',
      body: {
        mappings: { properties: { name: { type: 'text' } } },
        settings: { number_of_shards: 3 },
      },
    });
    expect(engine.createIndex).toHaveBeenCalledWith('users', {
      settings: { number_of_shards: 3 },
      mappings: { properties: { name: { type: 'text' } } },
    });
  });

  it('treats bare body (just properties) as mappings', async () => {
    const engine = fakeEngine();
    await executeOperation(engine, {
      type: 'create_index',
      index: 'users',
      body: { properties: { name: { type: 'text' } } },
    });
    expect(engine.createIndex).toHaveBeenCalledWith('users', {
      settings: undefined,
      mappings: { properties: { name: { type: 'text' } } },
    });
  });

  it('explicit mappings takes precedence over body', async () => {
    const engine = fakeEngine();
    await executeOperation(engine, {
      type: 'create_index',
      index: 'users',
      mappings: { properties: { real: { type: 'text' } } },
      body: { mappings: { properties: { stale: { type: 'text' } } } },
    });
    expect(engine.createIndex).toHaveBeenCalledWith('users', {
      settings: undefined,
      mappings: { properties: { real: { type: 'text' } } },
    });
  });

  it('refuses to create an index that already exists', async () => {
    const engine = fakeEngine();
    engine.indexExists = vi.fn().mockResolvedValue(true);
    await expect(
      executeOperation(engine, { type: 'create_index', index: 'users' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('executor: reindex option forwarding', () => {
  // executeReindex sleeps before its first poll; fake timers keep the test fast.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Drives executeOperation to completion: resolves the async reindex to a task
  // id, reports the task complete on the first poll, and advances timers past
  // the executor's sleeps. Returns the engine so callers can assert on mocks.
  async function runReindex(op: Parameters<typeof executeOperation>[1]) {
    const engine = fakeEngine();
    engine.reindexAsync = vi.fn().mockResolvedValue('task-1');
    engine.getTask = vi.fn().mockResolvedValue({ completed: true, total: 0 });
    const done = executeOperation(engine, op);
    await vi.runAllTimersAsync();
    await done;
    return engine;
  }

  it('forwards op_type, conflicts, version_type, and query to reindexAsync', async () => {
    const engine = await runReindex({
      type: 'reindex',
      index: 'products_v2',
      source: 'products_v1',
      dest: 'products_v2',
      op_type: 'create',
      conflicts: 'proceed',
      version_type: 'external_gte',
      query: { range: { updated_at: { gte: '2026-06-18T10:00:00Z' } } },
    });
    expect(engine.reindexAsync).toHaveBeenCalledWith(
      'products_v1',
      'products_v2',
      undefined,
      {
        opType: 'create',
        conflicts: 'proceed',
        versionType: 'external_gte',
        query: { range: { updated_at: { gte: '2026-06-18T10:00:00Z' } } },
      },
    );
  });

  it('passes an empty options object when no tuning fields are set', async () => {
    const engine = await runReindex({
      type: 'reindex',
      index: 'products_v2',
      source: 'products_v1',
      dest: 'products_v2',
    });
    expect(engine.reindexAsync).toHaveBeenCalledWith(
      'products_v1',
      'products_v2',
      undefined,
      {},
    );
  });
});
