import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

export interface MigrationOperation {
  type: 'create_index' | 'put_mapping' | 'put_settings' | 'delete_index' | 'reindex' | 'close_index' | 'open_index';
  index: string;
  settings?: any;
  mappings?: any;
  body?: any;
  source?: string;
  dest?: string;
  script?: string;
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
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parse(content);
  const fileName = path.basename(filePath);

  const versionMatch = fileName.match(/^V(\d+)__/);
  if (!versionMatch) {
    throw new Error(`Invalid migration file name: ${fileName}. Expected format: V{NNN}__{description}.yaml`);
  }

  return {
    version: parseInt(versionMatch[1], 10),
    description: parsed.description || fileName.replace(/^V\d+__/, '').replace(/\.yaml$/, '').replace(/-/g, ' '),
    engine: parsed.engine,
    targetVersion: parsed.target_version,
    operations: parsed.operations || [],
    rollback: parsed.rollback,
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
