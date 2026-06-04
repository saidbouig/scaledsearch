import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import {
  initConfig,
  loadConfig,
  isInitialized,
  getConfigPath,
  getConfigDir,
  getMigrationsDir,
  deriveHistoryIndexName,
} from '../../src/config/config';
import { makeTmpDir, cleanupTmpDir } from '../helpers/tmpDir';

describe('config', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmp);
  });

  describe('isInitialized', () => {
    it('returns false in an empty directory', () => {
      expect(isInitialized(tmp)).toBe(false);
    });

    it('returns true after initConfig', () => {
      initConfig(tmp);
      expect(isInitialized(tmp)).toBe(true);
    });
  });

  describe('initConfig', () => {
    it('creates .scaledsearch/config.yaml', () => {
      initConfig(tmp);
      expect(fs.existsSync(getConfigPath(tmp))).toBe(true);
    });

    it('creates a migrations directory', () => {
      initConfig(tmp);
      expect(fs.existsSync(path.join(tmp, 'migrations'))).toBe(true);
    });

    it('writes valid YAML with defaults', () => {
      const configPath = initConfig(tmp);
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = parse(raw);
      expect(parsed.engine).toBe('elasticsearch');
      expect(parsed.connection.host).toBe('http://localhost:9200');
      expect(parsed.migrations.location).toBe('./migrations');
      // History index is project-scoped: <prefix>_<name>_<hash6>
      expect(parsed.history.index).toMatch(/^\.scaledsearch_history_[a-z0-9_-]+_[0-9a-f]{6}$/);
    });

    it('writes a project-scoped history index that includes the project name', () => {
      const configPath = initConfig(tmp);
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = parse(raw);
      // Tmp dir basename is something like `scaledsearch-test-xxxxxx`;
      // a sanitized form of it should appear in the index name.
      const basename = path.basename(tmp).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      expect(parsed.history.index).toContain(basename.slice(0, 20));
    });
  });

  describe('deriveHistoryIndexName', () => {
    it('uses cwd basename when no package.json is present', () => {
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_[a-z0-9_-]+_[0-9a-f]{6}$/);
    });

    it('uses package.json name when present', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'acme-payments' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_acme-payments_[0-9a-f]{6}$/);
    });

    it('strips npm scope from scoped package names', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: '@acme/payments' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_payments_[0-9a-f]{6}$/);
    });

    it('sanitizes illegal characters', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'My Project!@#$%' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      // Only [a-z0-9_-] allowed between the prefix and hash
      expect(name).toMatch(/^\.scaledsearch_history_[a-z0-9_-]+_[0-9a-f]{6}$/);
    });

    it('falls back to basename when package.json is malformed', () => {
      fs.writeFileSync(path.join(tmp, 'package.json'), '{not valid json', 'utf-8');
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_[a-z0-9_-]+_[0-9a-f]{6}$/);
    });

    it('falls back to basename when package.json has no name field', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ version: '1.0.0' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_[a-z0-9_-]+_[0-9a-f]{6}$/);
    });

    it('two different paths with the same project name produce different hashes', () => {
      const tmp2 = makeTmpDir();
      try {
        fs.writeFileSync(
          path.join(tmp, 'package.json'),
          JSON.stringify({ name: 'api' }),
          'utf-8',
        );
        fs.writeFileSync(
          path.join(tmp2, 'package.json'),
          JSON.stringify({ name: 'api' }),
          'utf-8',
        );
        const a = deriveHistoryIndexName(tmp);
        const b = deriveHistoryIndexName(tmp2);
        expect(a).not.toBe(b);
        expect(a).toMatch(/^\.scaledsearch_history_api_[0-9a-f]{6}$/);
        expect(b).toMatch(/^\.scaledsearch_history_api_[0-9a-f]{6}$/);
      } finally {
        cleanupTmpDir(tmp2);
      }
    });

    it('the same path produces the same name across calls (deterministic)', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'stable' }),
        'utf-8',
      );
      expect(deriveHistoryIndexName(tmp)).toBe(deriveHistoryIndexName(tmp));
    });

    it('a symlinked path produces the same name as the canonical path', () => {
      // Real-world case: monorepos with `packages/*` symlinked under
      // `services/*`, or macOS `/var` -> `/private/var`. The same project
      // accessed two ways must hash identically — otherwise users on Linux
      // and macOS would get different history indices for the same project.
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'symlinked' }),
        'utf-8',
      );
      const linkPath = `${tmp}_link`;
      fs.symlinkSync(tmp, linkPath, 'dir');
      try {
        expect(deriveHistoryIndexName(linkPath)).toBe(deriveHistoryIndexName(tmp));
      } finally {
        fs.unlinkSync(linkPath);
      }
    });

    it('caps very long project names at 50 chars (well under ES 255-byte limit)', () => {
      const longName = 'a'.repeat(200);
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: longName }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      // .scaledsearch_history_ (22) + name (≤50) + _ (1) + hash (6) = ≤79
      expect(name.length).toBeLessThanOrEqual(79);
      expect(name).toMatch(/^\.scaledsearch_history_a{50}_[0-9a-f]{6}$/);
    });

    it('falls back to "project" when sanitized name is empty', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: '@@@///' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_project_[0-9a-f]{6}$/);
    });

    it('falls back to "project" when package.json name is whitespace only', () => {
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: '   ' }),
        'utf-8',
      );
      const name = deriveHistoryIndexName(tmp);
      expect(name).toMatch(/^\.scaledsearch_history_project_[0-9a-f]{6}$/);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = loadConfig(tmp);
      expect(config.engine).toBe('elasticsearch');
      expect(config.connection.host).toBe('http://localhost:9200');
    });

    it('reads back what initConfig wrote', () => {
      initConfig(tmp);
      const config = loadConfig(tmp);
      expect(config.engine).toBe('elasticsearch');
    });

    it('preserves a pre-1.0.6 config with the old shared default history index', () => {
      // Upgrade path: a user on an older scaledsearch ran `ss init` and got
      // the hard-coded `.scaledsearch_history` default. After upgrading, that
      // existing config file is untouched on disk, so loadConfig must keep
      // returning the old value — otherwise their applied-migration history
      // would appear lost.
      const configDir = getConfigDir(tmp);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        getConfigPath(tmp),
        `engine: elasticsearch
connection:
  host: http://localhost:9200
migrations:
  location: ./migrations
  naming: V{version}__{description}.yaml
history:
  index: .scaledsearch_history
`,
        'utf-8',
      );
      const config = loadConfig(tmp);
      expect(config.history.index).toBe('.scaledsearch_history');
    });

    it('merges user config over defaults', () => {
      const configDir = getConfigDir(tmp);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        getConfigPath(tmp),
        'engine: opensearch\nconnection:\n  host: http://opensearch:9201\n',
        'utf-8',
      );
      const config = loadConfig(tmp);
      expect(config.engine).toBe('opensearch');
      expect(config.connection.host).toBe('http://opensearch:9201');
      expect(config.migrations.location).toBe('./migrations'); // default preserved
    });

    it('throws on invalid engine', () => {
      const configDir = getConfigDir(tmp);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(getConfigPath(tmp), 'engine: redis\n', 'utf-8');
      expect(() => loadConfig(tmp)).toThrow(/Invalid engine/);
    });

    it('throws on non-object YAML', () => {
      const configDir = getConfigDir(tmp);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(getConfigPath(tmp), 'just a string\n', 'utf-8');
      expect(() => loadConfig(tmp)).toThrow(/Invalid config/);
    });
  });

  describe('getMigrationsDir', () => {
    it('returns absolute path from config relative location', () => {
      initConfig(tmp);
      const dir = getMigrationsDir(tmp);
      expect(path.isAbsolute(dir)).toBe(true);
      expect(dir).toBe(path.join(tmp, 'migrations'));
    });
  });
});
