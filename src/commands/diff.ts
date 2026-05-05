import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { createEngine } from '../engine/factory';

export async function diffCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('ss migrate init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const migrations = loadMigrations(migrationsDir);

  if (migrations.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  let applied: any[] = [];
  try {
    const engine = await createEngine(config);
    await engine.connect();
    const history = new MigrationHistory(engine, config.history.index);
    applied = await history.getApplied();
  } catch {
    // Offline — show all as pending
  }

  const appliedVersions = new Set(applied.map(a => a.version));
  const pending = migrations.filter(m => !appliedVersions.has(m.version));

  if (pending.length === 0) {
    console.log(chalk.green('No pending migrations. Everything is up to date.'));
    return;
  }

  console.log(chalk.bold(`Pending migrations (${pending.length}):\n`));

  for (const m of pending) {
    console.log(`  ${chalk.cyan(`V${String(m.version).padStart(3, '0')}__${m.fileName.replace(/^V\d+__/, '')}`)}`);
    for (const op of m.operations) {
      if (op.type === 'api_call') {
        console.log(`    → ${chalk.yellow(op.method?.toUpperCase() || 'API')} ${op.path}`);
      } else if (op.type === 'swap_alias') {
        console.log(`    → ${chalk.yellow('SWAP ALIAS')} "${op.alias}" ${op.from} → ${op.to}`);
      } else if (op.type === 'add_alias' || op.type === 'remove_alias') {
        const action = op.type === 'add_alias' ? 'ADD ALIAS' : 'REMOVE ALIAS';
        console.log(`    → ${chalk.yellow(action)} "${op.alias}" on ${op.index}`);
      } else if (op.type === 'put_template' || op.type === 'delete_template') {
        const action = op.type === 'put_template' ? 'PUT TEMPLATE' : 'DELETE TEMPLATE';
        console.log(`    → ${chalk.yellow(action)} ${op.name}`);
      } else if (op.type === 'put_pipeline' || op.type === 'delete_pipeline') {
        const action = op.type === 'put_pipeline' ? 'PUT PIPELINE' : 'DELETE PIPELINE';
        console.log(`    → ${chalk.yellow(action)} ${op.name}`);
      } else {
        const action = op.type.replace(/_/g, ' ').toUpperCase();
        const target = op.index || `${op.source} → ${op.dest}`;
        console.log(`    → ${chalk.yellow(action)} ${target}`);
      }

      if (op.body?.properties || op.mappings?.properties) {
        const props = op.body?.properties || op.mappings?.properties;
        for (const [field, def] of Object.entries(props)) {
          console.log(`      ${chalk.green('+')} ${field}: ${(def as any).type}`);
        }
      }
      if (op.settings) {
        for (const [key, val] of Object.entries(op.settings)) {
          console.log(`      ${chalk.green('+')} ${key}: ${val}`);
        }
      }
    }
    console.log('');
  }

  console.log(`Run ${chalk.cyan('ss migrate apply')} to apply these changes.`);
}
