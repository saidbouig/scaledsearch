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
      expect(parsed.history.index).toBe('.scaledsearch_history');
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
