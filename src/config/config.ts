import * as fs from 'fs';
import * as path from 'path';
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

  fs.writeFileSync(configPath, stringify(DEFAULT_CONFIG), 'utf-8');
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
    throw new Error(`Invalid config file at ${configPath}. Run 'ss migrate init' to recreate.`);
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
