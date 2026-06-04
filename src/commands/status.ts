import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { createEngine } from '../engine/factory';

export async function statusCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('scaledsearch migrate init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const migrations = loadMigrations(migrationsDir);

  if (migrations.length === 0) {
    console.log(chalk.yellow('No migration files found.') + ` Create one with ${chalk.cyan('scaledsearch migrate create <name>')}`);
    return;
  }

  // Try to connect to cluster for applied status
  let applied: any[] = [];
  let allEntries: any[] = [];
  let connected = false;
  try {
    const engine = await createEngine(config);
    await engine.connect();
    const history = new MigrationHistory(engine, config.history.index);
    applied = await history.getApplied();
    allEntries = await history.getAllEntries();
    connected = true;
  } catch {
    // Offline mode — just show filesystem state
  }

  const appliedVersions = new Set(applied.map(a => a.version));
  const failedVersions = new Set(
    allEntries.filter(e => e.status === 'failed').map(e => e.version),
  );

  console.log(chalk.bold('Migration Status'));
  if (connected) {
    console.log(chalk.green(`Connected to ${config.connection.host}`));
  } else {
    console.log(chalk.yellow(`Offline (cannot reach ${config.connection.host})`));
  }
  console.log('');

  for (const m of migrations) {
    let status: string;
    if (appliedVersions.has(m.version)) {
      status = chalk.green('applied');
    } else if (failedVersions.has(m.version)) {
      status = chalk.red('failed');
    } else {
      status = chalk.yellow('pending');
    }
    console.log(`  V${String(m.version).padStart(3, '0')} | ${status} | ${m.description}`);
  }

  const pending = migrations.filter(
    m => !appliedVersions.has(m.version) && !failedVersions.has(m.version),
  );
  const failedCount = migrations.filter(m => failedVersions.has(m.version)).length;
  console.log('');
  const parts = [`Total: ${migrations.length}`, `Applied: ${applied.length}`];
  if (failedCount > 0) parts.push(`Failed: ${failedCount}`);
  parts.push(`Pending: ${pending.length}`);
  console.log(parts.join(' | '));

  if (pending.length > 0) {
    console.log(`\nRun ${chalk.cyan('scaledsearch migrate apply')} to apply pending migrations.`);
  }
}
