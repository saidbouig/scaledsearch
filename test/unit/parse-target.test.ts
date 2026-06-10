import { describe, it, expect } from 'vitest';
import { parseTarget } from '../../src/commands/migrate';
import type { MigrationFile } from '../../src/migration/parser';

function fakeMigration(version: number): MigrationFile {
  return {
    version,
    description: `m${version}`,
    operations: [],
    filePath: `V${version}__m.yaml`,
    fileName: `V${version}__m.yaml`,
    checksum: 'abc',
  };
}

describe('parseTarget', () => {
  const migrations = [fakeMigration(1), fakeMigration(2), fakeMigration(3)];

  describe('valid forms', () => {
    it('accepts V001 style', () => {
      expect(parseTarget('V001', migrations)).toBe(1);
    });

    it('accepts V1 style (no padding)', () => {
      expect(parseTarget('V1', migrations)).toBe(1);
    });

    it('accepts lowercase v', () => {
      expect(parseTarget('v003', migrations)).toBe(3);
    });

    it('accepts plain integer', () => {
      expect(parseTarget('2', migrations)).toBe(2);
    });
  });

  describe('invalid syntax', () => {
    it('rejects non-numeric values', () => {
      expect(() => parseTarget('abc', migrations)).toThrow(/Invalid --target value 'abc'/);
    });

    it('rejects negative versions', () => {
      expect(() => parseTarget('V-1', migrations)).toThrow(/Invalid --target value 'V-1'/);
    });

    it('rejects decimal versions', () => {
      expect(() => parseTarget('V1.5', migrations)).toThrow(/Invalid --target value 'V1\.5'/);
    });

    it('rejects empty string', () => {
      expect(() => parseTarget('', migrations)).toThrow(/Invalid --target value ''/);
    });

    it('rejects strings with extra whitespace', () => {
      expect(() => parseTarget('V 1', migrations)).toThrow(/Invalid --target value 'V 1'/);
    });

    it('rejects scientific notation', () => {
      expect(() => parseTarget('V1e2', migrations)).toThrow(/Invalid --target value/);
    });
  });

  describe('nonexistent versions', () => {
    it('rejects a version higher than max on disk', () => {
      expect(() => parseTarget('V999', migrations)).toThrow(
        /V999 does not match any migration on disk\. Available: V001, V002, V003/,
      );
    });

    it('rejects a version skipped in the middle (V002 missing)', () => {
      const sparse = [fakeMigration(1), fakeMigration(3)];
      expect(() => parseTarget('V2', sparse)).toThrow(
        /V002 does not match any migration on disk\. Available: V001, V003/,
      );
    });

    it('rejects V0 when V0 has no file (common typo)', () => {
      expect(() => parseTarget('V0', migrations)).toThrow(
        /V000 does not match any migration on disk/,
      );
    });
  });

  describe('messages', () => {
    it('lists all available versions in the error', () => {
      try {
        parseTarget('V999', migrations);
        expect.fail('expected throw');
      } catch (err: any) {
        expect(err.message).toContain('V001');
        expect(err.message).toContain('V002');
        expect(err.message).toContain('V003');
      }
    });

    it('pads the missing version to 3 digits in the error', () => {
      try {
        parseTarget('V5', migrations);
        expect.fail('expected throw');
      } catch (err: any) {
        expect(err.message).toContain('V005');
      }
    });
  });
});
