import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { stringify } from 'yaml';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { createEngine } from '../engine/factory';
import { MigrationHistory } from '../migration/history';
import { MigrationOperation } from '../migration/parser';

function cleanSettings(settings: any): any {
  if (!settings) return undefined;
  const indexSettings = settings.index || settings;
  const clean: any = {};

  // Only keep user-configurable settings
  const keep = [
    'number_of_shards', 'number_of_replicas',
    'refresh_interval', 'max_result_window',
    'analysis',
  ];

  for (const k of keep) {
    if (indexSettings[k] !== undefined) {
      clean[k] = indexSettings[k];
    }
  }

  return Object.getOwnPropertyNames(clean).length > 0 ? clean : undefined;
}

export async function importCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('scaledsearch migrate init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const engine = await createEngine(config);

  try {
    await engine.connect();
  } catch (err: any) {
    console.log(chalk.red(`Cannot connect to ${config.connection.host}: ${err.message}`));
    process.exit(1);
  }

  const clusterInfo = await engine.getClusterInfo();
  console.log(chalk.bold(`Connected: ${clusterInfo.engine} ${clusterInfo.version} (${clusterInfo.name})`));

  // Get all user indices (skip system indices starting with .)
  const indices = await engine.listIndices();

  if (indices.length === 0) {
    console.log(chalk.yellow('No user indices found. Nothing to import.'));
    return;
  }

  console.log(`\nFound ${indices.length} index(es). Generating baseline migration...\n`);

  const operations: MigrationOperation[] = [];

  for (const index of indices.sort()) {
    process.stdout.write(`  Importing ${index}...`);

    const mappingResult = await engine.getMapping(index);
    const settingsResult = await engine.getSettings(index);

    const mappings = mappingResult[index]?.mappings;
    const rawSettings = settingsResult[index]?.settings;
    const settings = cleanSettings(rawSettings);

    // Create index operation
    const op: MigrationOperation = {
      type: 'create_index',
      index,
    } as MigrationOperation;

    if (settings) (op as any).settings = settings;
    if (mappings?.properties) (op as any).mappings = { properties: mappings.properties };

    operations.push(op);

    // Check for aliases
    const aliases = await engine.getAliases(index);
    for (const alias of aliases) {
      operations.push({
        type: 'add_alias',
        index,
        alias,
      } as MigrationOperation);
    }

    const aliasInfo = aliases.length > 0 ? ` (aliases: ${aliases.join(', ')})` : '';
    console.log(chalk.green(` done${aliasInfo}`));
  }

  // Write baseline migration file
  const fileName = 'V000__baseline.yaml';
  const filePath = path.join(migrationsDir, fileName);

  if (fs.existsSync(filePath)) {
    console.log(chalk.red(`\n${fileName} already exists. Delete it first if you want to re-import.`));
    process.exit(1);
  }

  const migration = {
    description: `Baseline import from ${clusterInfo.engine} ${clusterInfo.version}`,
    engine: clusterInfo.engine,
    operations,
  };

  fs.writeFileSync(filePath, stringify(migration), 'utf-8');

  // Mark as already applied in history
  const history = new MigrationHistory(engine, config.history.index);
  const crypto = require('crypto');
  const checksum = crypto.createHash('md5').update(fs.readFileSync(filePath, 'utf-8')).digest('hex');

  await history.recordSuccess({
    version: 0,
    description: migration.description,
    checksum,
    applied_at: new Date().toISOString(),
    execution_time_ms: 0,
    engine: clusterInfo.engine,
    engine_version: clusterInfo.version,
  });

  console.log(chalk.green(`\n✓ Baseline imported: ${filePath}`));
  console.log(`  ${operations.filter(o => o.type === 'create_index').length} index(es), ${operations.filter(o => o.type === 'add_alias').length} alias(es)`);
  console.log(`  Marked as applied (V000) — won't be re-executed.`);
  console.log(`\nNext: ${chalk.cyan('scaledsearch migrate create "your-first-change"')} to start versioning.`);
}
