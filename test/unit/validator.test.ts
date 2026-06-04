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

  describe('file-only state simulation', () => {
    it('flags put_mapping on an index no prior migration creates', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'put_mapping', index: 'ghost', body: { properties: {} } },
          ]),
        ],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("'ghost' does not exist"))).toBe(true);
    });

    it('flags put_settings on a missing index', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'put_settings', index: 'ghost', settings: {} }])],
        [],
      );
      expect(result.errors.some(e => e.includes("'ghost' does not exist"))).toBe(true);
    });

    it('flags delete_index on a missing index', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'delete_index', index: 'ghost' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("'ghost' does not exist"))).toBe(true);
    });

    it('flags double create_index without a delete between', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'users' }]),
          migration(2, [{ type: 'create_index', index: 'users' }]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("already exists"))).toBe(true);
    });

    it('allows create → delete → create across migrations', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'users' }]),
          migration(2, [{ type: 'delete_index', index: 'users' }]),
          migration(3, [{ type: 'create_index', index: 'users' }]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('handles intra-migration dependencies (create then put_mapping)', () => {
      // V001 creates the index AND puts a mapping on it in the same file —
      // the put_mapping must see the just-created index as existing.
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'create_index', index: 'orders' },
            { type: 'put_mapping', index: 'orders', body: { properties: {} } },
          ]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('reports the offending version + op index in the error', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'users' }]),
          migration(2, [
            { type: 'create_index', index: 'orders' },
            { type: 'put_mapping', index: 'ghost', body: { properties: {} } },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.startsWith('V2 op[1]'))).toBe(true);
    });

    it('flags reindex from a missing source', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'dst' }]),
          migration(2, [
            { type: 'reindex', index: 'dst', source: 'missing_src', dest: 'dst' },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("source index 'missing_src'"))).toBe(true);
    });

    it('flags add_alias on a missing index', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'add_alias', index: 'ghost', alias: 'current' },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("cannot attach alias"))).toBe(true);
    });

    it('flags remove_alias for an alias not currently attached', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'create_index', index: 'a' }]),
          migration(2, [
            { type: 'remove_alias', index: 'a', alias: 'never_attached' },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("not currently attached"))).toBe(true);
    });

    it('flags swap_alias when the alias is not on the from index', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'create_index', index: 'v1' },
            { type: 'create_index', index: 'v2' },
          ]),
          migration(2, [
            { type: 'swap_alias', index: '', alias: 'current', from: 'v1', to: 'v2' },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("not currently attached"))).toBe(true);
    });

    it('handles a full alias-swap migration cleanly', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'create_index', index: 'v1' },
            { type: 'add_alias', index: 'v1', alias: 'current' },
          ]),
          migration(2, [
            { type: 'create_index', index: 'v2' },
            { type: 'reindex', index: 'v2', source: 'v1', dest: 'v2' },
            { type: 'swap_alias', index: '', alias: 'current', from: 'v1', to: 'v2' },
            { type: 'delete_index', index: 'v1' },
          ]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('flags close_index / open_index against a missing index', () => {
      const r1 = validateMigrations(
        [migration(1, [{ type: 'close_index', index: 'ghost' }])],
        [],
      );
      expect(r1.errors.some(e => e.includes("'ghost' does not exist"))).toBe(true);
      const r2 = validateMigrations(
        [migration(1, [{ type: 'open_index', index: 'ghost' }])],
        [],
      );
      expect(r2.errors.some(e => e.includes("'ghost' does not exist"))).toBe(true);
    });

    it('flags double close_index', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'create_index', index: 'a' },
            { type: 'close_index', index: 'a' },
            { type: 'close_index', index: 'a' },
          ]),
        ],
        [],
      );
      expect(result.errors.some(e => e.includes("already closed"))).toBe(true);
    });

    it('flags delete_template before put_template', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'delete_template', index: '', name: 'logs' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("template 'logs' does not exist"))).toBe(true);
    });

    it('flags delete_pipeline before put_pipeline', () => {
      const result = validateMigrations(
        [migration(1, [{ type: 'delete_pipeline', index: '', name: 'enrich' }])],
        [],
      );
      expect(result.errors.some(e => e.includes("pipeline 'enrich' does not exist"))).toBe(true);
    });

    it('ignores api_call (cannot reason about raw HTTP)', () => {
      const result = validateMigrations(
        [
          migration(1, [
            { type: 'api_call', index: '', method: 'POST', path: '/_anything' },
          ]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('does NOT run simulation when syntactic checks already failed', () => {
      // Unknown op type → syntactic error. Simulator should be skipped to
      // avoid noisy duplicate errors.
      const result = validateMigrations(
        [migration(1, [{ type: 'fly_to_moon' as any, index: 'a' }])],
        [],
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unknown operation type');
    });

    it('treats put_template as upsert (no precondition)', () => {
      const result = validateMigrations(
        [
          migration(1, [{ type: 'put_template', index: '', name: 'logs' }]),
          migration(2, [{ type: 'put_template', index: '', name: 'logs' }]),
        ],
        [],
      );
      expect(result.valid).toBe(true);
    });
  });
});
