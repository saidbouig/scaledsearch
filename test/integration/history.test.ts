import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ES_HOST,
  esEngine,
  isReachable,
  cleanupIndex,
  uniqueIndexName,
} from '../helpers/cluster';
import { MigrationHistory } from '../../src/migration/history';

const reachable = await isReachable(ES_HOST);
const describeIf = reachable ? describe : describe.skip;

describeIf(`MigrationHistory against ${ES_HOST}`, () => {
  const engine = esEngine();
  let indexName: string;
  let history: MigrationHistory;

  beforeEach(async () => {
    indexName = uniqueIndexName('ss_hist');
    history = new MigrationHistory(engine, indexName);
  });

  afterEach(async () => {
    await cleanupIndex(engine, indexName);
  });

  describe('ensureIndex', () => {
    it('creates the history index on first use', async () => {
      expect(await engine.indexExists(indexName)).toBe(false);
      await history.ensureIndex();
      expect(await engine.indexExists(indexName)).toBe(true);
    });

    it('is idempotent on second call', async () => {
      await history.ensureIndex();
      await history.ensureIndex(); // must not throw
      expect(await engine.indexExists(indexName)).toBe(true);
    });
  });

  describe('recordSuccess / recordFailure', () => {
    it('persists a success entry that getApplied returns', async () => {
      await history.recordSuccess({
        version: 1,
        description: 'create users',
        checksum: 'abc123',
        applied_at: new Date().toISOString(),
        execution_time_ms: 42,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      });
      const applied = await history.getApplied();
      expect(applied).toHaveLength(1);
      expect(applied[0].version).toBe(1);
      expect(applied[0].status).toBe('success');
      expect(applied[0].checksum).toBe('abc123');
    });

    it('persists a failure entry that getApplied does NOT return but getAllEntries does', async () => {
      await history.recordFailure({
        version: 1,
        description: 'broken',
        checksum: 'xyz',
        applied_at: new Date().toISOString(),
        execution_time_ms: 999,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
        error_message: 'something blew up',
      });
      // getApplied returns only successful migrations — a failed one must not
      // shadow the apply loop into thinking the migration is done.
      const applied = await history.getApplied();
      expect(applied).toHaveLength(0);

      // getAllEntries surfaces failures for status/forensics.
      const all = await history.getAllEntries();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('failed');
      expect(all[0].error_message).toBe('something blew up');
    });

    it('returns entries sorted by version ascending', async () => {
      const now = new Date().toISOString();
      const base = {
        description: 'x',
        checksum: 'c',
        applied_at: now,
        execution_time_ms: 1,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      };
      await history.recordSuccess({ version: 3, ...base });
      await history.recordSuccess({ version: 1, ...base });
      await history.recordSuccess({ version: 2, ...base });
      const applied = await history.getApplied();
      expect(applied.map(a => a.version)).toEqual([1, 2, 3]);
    });

    it('returns empty array when index does not exist', async () => {
      const result = await history.getApplied();
      expect(result).toEqual([]);
    });

    it('overwrites entries with the same version (idempotent)', async () => {
      const base = {
        version: 1,
        description: 'x',
        applied_at: new Date().toISOString(),
        execution_time_ms: 1,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      };
      await history.recordSuccess({ ...base, checksum: 'v1' });
      await history.recordSuccess({ ...base, checksum: 'v2' });
      const applied = await history.getApplied();
      expect(applied).toHaveLength(1);
      expect(applied[0].checksum).toBe('v2');
    });
  });

  describe('removeEntry', () => {
    it('removes a recorded entry', async () => {
      const base = {
        version: 1,
        description: 'x',
        checksum: 'c',
        applied_at: new Date().toISOString(),
        execution_time_ms: 1,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      };
      await history.recordSuccess(base);
      expect(await history.getApplied()).toHaveLength(1);
      await history.removeEntry(1);
      expect(await history.getApplied()).toHaveLength(0);
    });
  });

  describe('acquireLock / releaseLock', () => {
    it('first acquire succeeds', async () => {
      expect(await history.acquireLock()).toBe(true);
      await history.releaseLock();
    });

    it('second acquire while held fails', async () => {
      expect(await history.acquireLock()).toBe(true);
      // Same MigrationHistory simulating a second process attempting to acquire.
      // The second call uses createDocument with op_type=create which must fail.
      const second = new MigrationHistory(engine, indexName);
      expect(await second.acquireLock()).toBe(false);
      await history.releaseLock();
    });

    it('acquire after release succeeds', async () => {
      expect(await history.acquireLock()).toBe(true);
      await history.releaseLock();
      expect(await history.acquireLock()).toBe(true);
      await history.releaseLock();
    });

    it('getApplied filters out the _lock document', async () => {
      await history.acquireLock();
      await history.recordSuccess({
        version: 1,
        description: 'x',
        checksum: 'c',
        applied_at: new Date().toISOString(),
        execution_time_ms: 1,
        engine: 'elasticsearch',
        engine_version: '9.0.0',
      });
      const applied = await history.getApplied();
      // _lock must not appear in applied migrations
      expect(applied.every(a => a.version !== undefined)).toBe(true);
      expect(applied).toHaveLength(1);
      expect(applied[0].version).toBe(1);
      await history.releaseLock();
    });

    it('releaseLock is safe to call when no lock held', async () => {
      // Must not throw even if there's nothing to release.
      await history.releaseLock();
      // Acquire should still work after the no-op release.
      expect(await history.acquireLock()).toBe(true);
      await history.releaseLock();
    });
  });
});
