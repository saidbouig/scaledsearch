import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

export interface MigrationOperation {
  type: 'create_index' | 'put_mapping' | 'put_settings' | 'delete_index' | 'reindex' | 'close_index' | 'open_index' | 'add_alias' | 'remove_alias' | 'swap_alias' | 'put_template' | 'delete_template' | 'put_pipeline' | 'delete_pipeline' | 'api_call';
  index: string;
  settings?: any;
  mappings?: any;
  body?: any;
  source?: string;
  dest?: string;
  script?: string;
  method?: string;
  path?: string;
  alias?: string;
  from?: string;
  to?: string;
  name?: string;
  // Optional alias attachment options (add_alias only). Preserved on import
  // so baseline migrations round-trip filter/routing/is_write_index.
  filter?: any;
  routing?: string;
  index_routing?: string;
  search_routing?: string;
  is_write_index?: boolean;
}

export interface MigrationFile {
  version: number;
  description: string;
  engine?: string;
  targetVersion?: string;
  operations: MigrationOperation[];
  rollback?: MigrationOperation[];
  filePath: string;
  fileName: string;
  checksum: string;
}

function computeChecksum(content: string): string {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(content).digest('hex');
}

export function parseMigrationFile(filePath: string): MigrationFile {
  const fileName = path.basename(filePath);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Cannot read migration file ${fileName}: ${err.message}`);
  }

  const versionMatch = fileName.match(/^V(\d+)__/);
  if (!versionMatch) {
    throw new Error(`Invalid migration file name: ${fileName}. Expected format: V001__description.yaml`);
  }

  let parsed: any;
  try {
    parsed = parse(content);
  } catch (err: any) {
    throw new Error(`Invalid YAML in ${fileName}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Migration file ${fileName} is empty or invalid. It must contain a YAML object with 'operations'.`);
  }

  const operations = parsed.operations;
  if (operations && !Array.isArray(operations)) {
    throw new Error(`'operations' in ${fileName} must be an array.`);
  }

  return {
    version: parseInt(versionMatch[1], 10),
    description: parsed.description || fileName.replace(/^V\d+__/, '').replace(/\.yaml$/, '').replace(/-/g, ' '),
    engine: parsed.engine,
    targetVersion: parsed.target_version,
    operations: operations || [],
    rollback: Array.isArray(parsed.rollback) ? parsed.rollback : undefined,
    filePath,
    fileName,
    checksum: computeChecksum(content),
  };
}

export function loadMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^V\d+__.*\.yaml$/))
    .sort();

  return files.map(f => parseMigrationFile(path.join(migrationsDir, f)));
}

export function getNextVersion(migrationsDir: string): number {
  const migrations = loadMigrations(migrationsDir);
  if (migrations.length === 0) return 1;
  return Math.max(...migrations.map(m => m.version)) + 1;
}
