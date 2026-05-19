import { describe, it, expect, vi } from 'vitest';
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
