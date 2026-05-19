import { describe, it, expect } from 'vitest';
import { validateMigrations } from '../../src/migration/validator';
import type { MigrationFile, MigrationOperation } from '../../src/migration/parser';
import type { HistoryEntry } from '../../src/migration/history';

function migration(
  version: number,
  operations: MigrationOperation[],
  checksum = 'abc',
): MigrationFile {
  return {
    version,
    description: `V${version}`,
    operations,
    filePath: `V${version}__test.yaml`,
    fileName: `V${version}__test.yaml`,
    checksum,
  };
}

function historyEntry(version: number, checksum = 'abc'): HistoryEntry {
  return {
    version,
    description: `V${version}`,
    checksum,
    appliedAt: new Date().toISOString(),
    success: true,
  } as HistoryEntry;
}

describe('validator', () => {
  describe('duplicate versions', () => {
    it('flags duplicates as errors', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'a' }]),
          migration(1, [{ type: 'create_index', index: 'b' }]),
        ],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });
  });

  describe('version gaps', () => {
    it('warns on non-contiguous versions', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'a' }]),
          migration(3, [{ type: 'create_index', index: 'b' }]),
        ],
        [],
      );
      expect(result.warnings.some(w => w.includes('Gap'))).toBe(true);
      expect(result.valid).toBe(true); // gap is warning, not error
    });

    it('does not warn on contiguous versions', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'a' }]),
          migration(2, [{ type: 'create_index', index: 'b' }]),
        ],
        [],
      );
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('checksum integrity', () => {
    it('flags checksum mismatch as error', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'create_index', index: 'a' }], 'new-checksum')],
        [historyEntry(1, 'old-checksum')],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Checksum mismatch'))).toBe(true);
    });

    it('warns when applied migration is missing from filesystem', () => {
      const result = validateMigrations([], [historyEntry(1)]);
      expect(result.warnings.some(w => w.includes('not found in filesystem'))).toBe(true);
    });

    it('passes when checksums match', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'create_index', index: 'a' }], 'same')],
        [historyEntry(1, 'same')],
      );
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('operation field requirements', () => {
    it('rejects unknown operation type', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'fly_to_moon' as any, index: 'a' }])],
        [],
      );
      expect(result.errors.some(e => e.includes('Unknown operation type'))).toBe(true);
    });

    it('requires index field for create_index', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'create_index', index: '' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("missing 'index' field"))).toBe(true);
    });

    it('does not require index for api_call', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'api_call', index: '', method: 'GET', path: '/_cluster/health' },
          ]),
        ],
        [],
      );
      expect(result.errors.filter(e => e.includes("'index' field"))).toHaveLength(0);
    });

    it('requires source and dest for reindex', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'reindex', index: '' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("Reindex missing 'source'"))).toBe(true);
      expect(result.errors.some(e => e.includes("Reindex missing 'dest'"))).toBe(true);
    });

    it('accepts reindex with dest derived from index', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'reindex', index: 'dest_idx', source: 'src_idx' }]),
        ],
        [],
      );
      expect(result.errors.filter(e => e.includes('Reindex'))).toHaveLength(0);
    });

    it('requires alias for add_alias / remove_alias', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'add_alias', index: 'idx' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("missing 'alias' field"))).toBe(true);
    });

    it('requires alias + from + to for swap_alias', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'swap_alias', index: '' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("missing 'alias' field"))).toBe(true);
      expect(result.errors.some(e => e.includes("missing 'from' field"))).toBe(true);
      expect(result.errors.some(e => e.includes("missing 'to' field"))).toBe(true);
    });

    it('requires name for template / pipeline ops', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'put_template', index: '' },
            { type: 'put_pipeline', index: '' },
          ]),
        ],
        [],
      );
      expect(result.errors.filter(e => e.includes("missing 'name' field"))).toHaveLength(2);
    });

    it('requires method + path for api_call', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'api_call', index: '' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("missing 'method' field"))).toBe(true);
      expect(result.errors.some(e => e.includes("missing 'path' field"))).toBe(true);
    });
  });

  describe('valid migrations', () => {
    it('passes a fully valid set', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'users' }]),
          migration(2, [
            { type: 'put_mapping', index: 'users', mappings: { properties: {} } },
          ]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
