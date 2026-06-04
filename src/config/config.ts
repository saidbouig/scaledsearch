import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parse, stringify } from 'yaml';

export interface ScaledSearchConfig {
  engine: 'elasticsearch' | 'opensearch' | 'solr';
  connection: {
    host: string;
    auth?: {
      type: 'basic' | 'apikey' | 'none';
      username?: string;
      password?: string;
      apiKey?: string;
    };
  };
  migrations: {
    location: string;
    naming: string;
  };
  history: {
    index: string;
  };
}

const DEFAULT_CONFIG: ScaledSearchConfig = {
  engine: 'elasticsearch',
  connection: {
    host: 'http://localhost:9200',
  },
  migrations: {
    location: './migrations',
    naming: 'V{version}__{description}.yaml',
  },
  history: {
    index: '.scaledsearch_history',
  },
};

const CONFIG_DIR = '.scaledsearch';
const CONFIG_FILE = 'config.yaml';

export function getConfigDir(cwd: string = process.cwd()): string {
  return path.join(cwd, CONFIG_DIR);
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(getConfigDir(cwd), CONFIG_FILE);
}

export function getMigrationsDir(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return path.resolve(cwd, config.migrations.location);
}

export function isInitialized(cwd: string = process.cwd()): boolean {
  return fs.existsSync(getConfigPath(cwd));
}

// Derive a project-unique history-index name so two projects pointed at the
// same cluster don't collide on a shared `.scaledsearch_history`. Two unrelated
// projects both naturally have a V001 — sharing one history index makes the
// validator see a "checksum mismatch" between unrelated migrations and refuse
// to apply anything.
//
// Shape: .scaledsearch_history_<project>_<hash6>
// - project = package.json "name" if present, else cwd basename
// - hash6 = first 6 hex chars of sha256(absolute project path) — disambiguates
//   two repos with the same name (e.g. multiple `api/` directories)
export function deriveHistoryIndexName(cwd: string = process.cwd()): string {
  let projectName: string | undefined;
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.name === 'string' && pkg.name.length > 0) {
        // Strip npm scope: "@acme/payments" -> "payments"
        projectName = pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // Malformed package.json — fall through to basename
    }
  }
  if (!projectName) {
    projectName = path.basename(path.resolve(cwd));
  }

  // ES index name rules: lowercase, no whitespace, no `\/?*<>|,#:"`. Be strict —
  // collapse anything non-[a-z0-9_-] to `_`, then trim leading/trailing `_-`.
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 50) || 'project';

  // Resolve symlinks before hashing so a project accessed via a symlinked
  // path (common in monorepos with `packages/*` symlinked under `services/*`,
  // or macOS `/var` -> `/private/var`) hashes to the same name as when
  // accessed via its canonical path. Fall back to path.resolve if the dir
  // somehow doesn't exist yet.
  let canonical: string;
  try {
    canonical = fs.realpathSync(path.resolve(cwd));
  } catch {
    canonical = path.resolve(cwd);
  }
  const hash = crypto
    .createHash('sha256')
    .update(canonical)
    .digest('hex')
    .slice(0, 6);

  return `.scaledsearch_history_${sanitized}_${hash}`;
}

export function initConfig(cwd: string = process.cwd()): string {
  const configDir = getConfigDir(cwd);
  const configPath = getConfigPath(cwd);
  const migrationsDir = path.resolve(cwd, DEFAULT_CONFIG.migrations.location);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const config: ScaledSearchConfig = {
    ...DEFAULT_CONFIG,
    history: { index: deriveHistoryIndexName(cwd) },
  };
  fs.writeFileSync(configPath, stringify(config), 'utf-8');
  return configPath;
}

export function loadConfig(cwd: string = process.cwd()): ScaledSearchConfig {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid config file at ${configPath}. Run 'scaledsearch migrate init' to recreate.`);
  }
  const config = { ...DEFAULT_CONFIG, ...parsed };
  if (parsed.connection) {
    config.connection = { ...DEFAULT_CONFIG.connection, ...parsed.connection };
  }
  const validEngines = ['elasticsearch', 'opensearch', 'solr'];
  if (!validEngines.includes(config.engine)) {
    throw new Error(`Invalid engine '${config.engine}' in config. Must be one of: ${validEngines.join(', ')}`);
  }
  return config;
}
