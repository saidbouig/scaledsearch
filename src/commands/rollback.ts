import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations, MigrationOperation } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { createEngine } from '../engine/factory';
import { SearchEngine } from '../engine/interface';

async function executeOperation(engine: SearchEngine, op: MigrationOperation): Promise<void> {
  switch (op.type) {
    case 'create_index':
      await engine.createIndex(op.index, { settings: op.settings, mappings: op.mappings || op.body });
      break;
    case 'put_mapping':
      await engine.putMapping(op.index, op.body || op.mappings);
      break;
    case 'put_settings':
      await engine.putSettings(op.index, op.settings || op.body);
      break;
    case 'delete_index':
      await engine.deleteIndex(op.index);
      break;
    case 'close_index':
      await engine.closeIndex(op.index);
      break;
    case 'open_index':
      await engine.openIndex(op.index);
      break;
    case 'reindex':
      await engine.reindex(op.source!, op.dest || op.index, op.script);
      break;
    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

export async function rollbackCommand(options: { to?: string }): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('ss init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const migrations = loadMigrations(migrationsDir);
  const engine = await createEngine(config);

  try {
    await engine.connect();
  } catch (err: any) {
    console.log(chalk.red(`Cannot connect to ${config.connection.host}: ${err.message}`));
    process.exit(1);
  }

  const clusterInfo = await engine.getClusterInfo();
  console.log(chalk.bold(`Connected: ${clusterInfo.engine} ${clusterInfo.version} (${clusterInfo.name})`));

  const history = new MigrationHistory(engine, config.history.index);
  const applied = await history.getApplied();

  if (applied.length === 0) {
    console.log(chalk.yellow('No migrations to rollback.'));
    return;
  }

  // Determine which migrations to rollback
  let toRollback = [applied[applied.length - 1]]; // Default: last one

  if (options.to) {
    const targetVersion = parseInt(options.to.replace(/^V/i, ''), 10);
    toRollback = applied.filter(a => a.version > targetVersion).reverse();
  }

  if (toRollback.length === 0) {
    console.log(chalk.yellow('Nothing to rollback.'));
    return;
  }

  // Check that migration files have rollback sections
  const missing: number[] = [];
  for (const entry of toRollback) {
    const file = migrations.find(m => m.version === entry.version);
    if (!file?.rollback || file.rollback.length === 0) {
      missing.push(entry.version);
    }
  }

  if (missing.length > 0) {
    console.log(chalk.red(`Cannot rollback — no rollback section in: ${missing.map(v => `V${String(v).padStart(3, '0')}`).join(', ')}`));
    console.log(chalk.yellow('\nAdd a rollback section to the migration file:'));
    console.log(chalk.gray(`  rollback:\n    - type: delete_index\n      index: your_index`));
    process.exit(1);
  }

  console.log(`\nRolling back ${toRollback.length} migration(s):\n`);

  for (const entry of toRollback) {
    const file = migrations.find(m => m.version === entry.version)!;
    const start = Date.now();
    process.stdout.write(`  Rolling back V${String(entry.version).padStart(3, '0')} ${entry.description}...`);

    try {
      for (const op of file.rollback!) {
        await executeOperation(engine, op);
      }

      await history.removeEntry(entry.version);
      const elapsed = Date.now() - start;
      console.log(chalk.green(` done (${elapsed}ms)`));
    } catch (err: any) {
      console.log(chalk.red(` FAILED`));
      console.log(chalk.red(`\n  Error: ${err.message}`));
      process.exit(1);
    }
  }

  console.log(chalk.green(`\n✓ ${toRollback.length} migration(s) rolled back.`));
}
