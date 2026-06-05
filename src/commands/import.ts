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
  let engine;
  try {
    engine = await createEngine(config);
    await engine.connect();
  } catch (err: any) {
    console.log(chalk.red(`Cannot connect to ${config.connection.host}: ${err.message}`));
    process.exit(1);
  }

  const clusterInfo = await engine.getClusterInfo();
  console.log(chalk.bold(`Connected: ${clusterInfo.engine} ${clusterInfo.version} (${clusterInfo.name})`));

  // Refuse early if V000 already exists — avoids scanning the cluster only
  // to refuse to write at the end.
  const fileName = 'V000__baseline.yaml';
  const filePath = path.join(migrationsDir, fileName);
  if (fs.existsSync(filePath)) {
    console.log(chalk.red(`\n${fileName} already exists. Delete it first if you want to re-import.`));
    process.exit(1);
  }

  // Get richer index list (name + closed state). Built-in/system filtering
  // happens in the engine layer.
  const indices = await engine.listIndicesDetailed();
  const templates = await engine.listTemplates();
  const pipelines = await engine.listPipelines();

  if (indices.length === 0 && templates.length === 0 && pipelines.length === 0) {
    console.log(chalk.yellow('No user indices, templates, or pipelines found. Nothing to import.'));
    return;
  }

  const indexCount = indices.length;
  const tplCount = templates.length;
  const pipeCount = pipelines.length;
  console.log(
    `\nFound ${indexCount} index(es), ${tplCount} template(s), ${pipeCount} pipeline(s). Generating baseline migration...\n`,
  );

  const operations: MigrationOperation[] = [];

  // Templates first — they may govern auto-created indices below.
  for (const tplName of templates.sort()) {
    process.stdout.write(`  Importing template ${tplName}...`);
    const body = await engine.getTemplate(tplName);
    operations.push({
      type: 'put_template',
      index: '',
      name: tplName,
      body,
    } as MigrationOperation);
    console.log(chalk.green(` done`));
  }

  // Then pipelines.
  for (const pipeName of pipelines.sort()) {
    process.stdout.write(`  Importing pipeline ${pipeName}...`);
    const body = await engine.getPipeline(pipeName);
    operations.push({
      type: 'put_pipeline',
      index: '',
      name: pipeName,
      body,
    } as MigrationOperation);
    console.log(chalk.green(` done`));
  }

  // Then indices, with their aliases (full filter/routing preserved) and a
  // trailing close_index op if the index is currently closed.
  for (const idx of indices.sort((a, b) => a.name.localeCompare(b.name))) {
    process.stdout.write(`  Importing ${idx.name}...`);

    const mappingResult = await engine.getMapping(idx.name);
    const settingsResult = await engine.getSettings(idx.name);

    const mappings = mappingResult[idx.name]?.mappings;
    const rawSettings = settingsResult[idx.name]?.settings;
    const settings = cleanSettings(rawSettings);

    const op: MigrationOperation = {
      type: 'create_index',
      index: idx.name,
    } as MigrationOperation;

    if (settings) (op as any).settings = settings;
    if (mappings?.properties) (op as any).mappings = { properties: mappings.properties };

    operations.push(op);

    // Aliases with all options preserved.
    const aliases = await engine.getAliasesDetailed(idx.name);
    for (const alias of aliases) {
      const aliasOp: any = {
        type: 'add_alias',
        index: idx.name,
        alias: alias.name,
      };
      if (alias.filter !== undefined) aliasOp.filter = alias.filter;
      if (alias.routing !== undefined) aliasOp.routing = alias.routing;
      if (alias.index_routing !== undefined) aliasOp.index_routing = alias.index_routing;
      if (alias.search_routing !== undefined) aliasOp.search_routing = alias.search_routing;
      if (alias.is_write_index !== undefined) aliasOp.is_write_index = alias.is_write_index;
      operations.push(aliasOp as MigrationOperation);
    }

    // If the index was closed on the live cluster, emit close_index after
    // creation so replay reproduces the same state.
    if (idx.closed) {
      operations.push({
        type: 'close_index',
        index: idx.name,
      } as MigrationOperation);
    }

    const notes: string[] = [];
    if (aliases.length > 0) notes.push(`aliases: ${aliases.map(a => a.name).join(', ')}`);
    if (idx.closed) notes.push('closed');
    const noteStr = notes.length > 0 ? ` (${notes.join('; ')})` : '';
    console.log(chalk.green(` done${noteStr}`));
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
  console.log(
    `  ${operations.filter(o => o.type === 'create_index').length} index(es), ` +
      `${operations.filter(o => o.type === 'add_alias').length} alias(es), ` +
      `${operations.filter(o => o.type === 'put_template').length} template(s), ` +
      `${operations.filter(o => o.type === 'put_pipeline').length} pipeline(s)`,
  );
  console.log(`  Marked as applied (V000) — won't be re-executed.`);
  console.log(`\nNext: ${chalk.cyan('scaledsearch migrate create "your-first-change"')} to start versioning.`);
}
