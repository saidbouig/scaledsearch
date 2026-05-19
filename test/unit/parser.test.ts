import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseMigrationFile,
  loadMigrations,
  getNextVersion,
} from '../../src/migration/parser';
import { makeTmpDir, cleanupTmpDir } from '../helpers/tmpDir';

function writeMigration(dir: string, name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

describe('migration parser', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmp);
  });

  describe('parseMigrationFile', () => {
    it('parses a valid file with version + operations', () => {
      const file = writeMigration(
        tmp,
        'V001__create_index.yaml',
        'description: create users index\noperations:\n  - type: create_index\n    index: users\n',
      );
      const parsed = parseMigrationFile(file);
      expect(parsed.version).toBe(1);
      expect(parsed.description).toBe('create users index');
      expect(parsed.operations).toHaveLength(1);
      expect(parsed.operations[0].type).toBe('create_index');
      expect(parsed.checksum).toMatch(/^[a-f0-9]{32}$/);
    });

    it('falls back to filename when description missing', () => {
      const file = writeMigration(
        tmp,
        'V002__add-products-mapping.yaml',
        'operations:\n  - type: put_mapping\n    index: products\n',
      );
      const parsed = parseMigrationFile(file);
      expect(parsed.description).toBe('add products mapping');
    });

    it('rejects invalid filename format', () => {
      const file = writeMigration(tmp, 'bad-name.yaml', 'operations: []\n');
      expect(() => parseMigrationFile(file)).toThrow(/Invalid migration file name/);
    });

    it('rejects invalid YAML', () => {
      const file = writeMigration(tmp, 'V001__broken.yaml', 'key: [unclosed\n');
      expect(() => parseMigrationFile(file)).toThrow(/Invalid YAML/);
    });

    it('rejects empty file', () => {
      const file = writeMigration(tmp, 'V001__empty.yaml', '');
      expect(() => parseMigrationFile(file)).toThrow(/empty or invalid/);
    });

    it('rejects non-array operations', () => {
      const file = writeMigration(
        tmp,
        'V001__bad_ops.yaml',
        'operations: not_an_array\n',
      );
      expect(() => parseMigrationFile(file)).toThrow(/must be an array/);
    });

    it('parses rollback when array', () => {
      const file = writeMigration(
        tmp,
        'V001__with_rollback.yaml',
        `operations:
  - type: create_index
    index: users
rollback:
  - type: delete_index
    index: users
`,
      );
      const parsed = parseMigrationFile(file);
      expect(parsed.rollback).toHaveLength(1);
      expect(parsed.rollback?.[0].type).toBe('delete_index');
    });

    it('ignores rollback when not an array', () => {
      const file = writeMigration(
        tmp,
        'V001__bad_rollback.yaml',
        `operations: []
rollback: not_an_array
`,
      );
      const parsed = parseMigrationFile(file);
      expect(parsed.rollback).toBeUndefined();
    });

    it('produces stable checksum for identical content', () => {
      const a = writeMigration(tmp, 'V001__a.yaml', 'operations: []\n');
      const b = writeMigration(tmp, 'V002__a.yaml', 'operations: []\n');
      const pa = parseMigrationFile(a);
      const pb = parseMigrationFile(b);
      expect(pa.checksum).toBe(pb.checksum);
    });

    it('produces different checksums for different content', () => {
      const a = writeMigration(tmp, 'V001__a.yaml', 'operations: []\n');
      const b = writeMigration(tmp, 'V002__b.yaml', 'operations:\n  - type: create_index\n    index: x\n');
      const pa = parseMigrationFile(a);
      const pb = parseMigrationFile(b);
      expect(pa.checksum).not.toBe(pb.checksum);
    });
  });

  describe('loadMigrations', () => {
    it('returns empty array when directory missing', () => {
      const result = loadMigrations(path.join(tmp, 'does-not-exist'));
      expect(result).toEqual([]);
    });

    it('returns migrations sorted by version', () => {
      writeMigration(tmp, 'V003__c.yaml', 'operations: []\n');
      writeMigration(tmp, 'V001__a.yaml', 'operations: []\n');
      writeMigration(tmp, 'V002__b.yaml', 'operations: []\n');
      const migrations = loadMigrations(tmp);
      expect(migrations.map(m => m.version)).toEqual([1, 2, 3]);
    });

    it('ignores non-migration files', () => {
      writeMigration(tmp, 'V001__valid.yaml', 'operations: []\n');
      writeMigration(tmp, 'README.md', '# notes\n');
      writeMigration(tmp, 'bad-name.yaml', 'operations: []\n');
      const migrations = loadMigrations(tmp);
      expect(migrations).toHaveLength(1);
      expect(migrations[0].version).toBe(1);
    });
  });

  describe('getNextVersion', () => {
    it('returns 1 when no migrations exist', () => {
      expect(getNextVersion(tmp)).toBe(1);
    });

    it('returns max + 1 for existing migrations', () => {
      writeMigration(tmp, 'V001__a.yaml', 'operations: []\n');
      writeMigration(tmp, 'V005__b.yaml', 'operations: []\n');
      writeMigration(tmp, 'V003__c.yaml', 'operations: []\n');
      expect(getNextVersion(tmp)).toBe(6);
    });
  });
});
