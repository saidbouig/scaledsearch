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

  // Loading migrations can throw on malformed YAML, missing required fields,
  // etc. The parser's error message already names the offending file —
  // surface it cleanly instead of letting a raw stack trace escape.
  let migrations;
  try {
    migrations = loadMigrations(migrationsDir);
  } catch (err: any) {
    console.error(chalk.red(`status failed: ${err.message ?? String(err)}`));
    process.exit(1);
  }

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

  // Orphans: versions recorded in history (success OR failed) but no
  // matching file on disk. Surfaces the case where someone deleted an
  // applied migration file, which would otherwise silently inflate the
  // Applied count without contributing a row to the display.
  const onDiskVersions = new Set(migrations.map(m => m.version));
  const orphans = allEntries.filter(e => !onDiskVersions.has(e.version));

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

  // Render orphans as a distinct block so the user sees the inconsistency
  // and the count line below stays internally consistent.
  if (orphans.length > 0) {
    console.log('');
    console.log(chalk.yellow.bold('Orphan history records (applied on cluster but no file on disk):'));
    for (const o of orphans.sort((a, b) => a.version - b.version)) {
      const tag = o.status === 'failed' ? chalk.red('failed') : chalk.green('applied');
      console.log(
        `  V${String(o.version).padStart(3, '0')} | ${tag} | ${o.description} ${chalk.yellow('(file missing)')}`,
      );
    }
  }

  // Count only on-disk migrations so the totals reconcile:
  //   Total = files on disk
  //   Applied + Failed + Pending sum to Total
  //   Orphans are reported separately (not in Total/Applied/Pending).
  const appliedOnDisk = migrations.filter(m => appliedVersions.has(m.version)).length;
  const failedOnDisk = migrations.filter(m => failedVersions.has(m.version)).length;
  const pending = migrations.filter(
    m => !appliedVersions.has(m.version) && !failedVersions.has(m.version),
  );

  console.log('');
  const parts = [`Total: ${migrations.length}`, `Applied: ${appliedOnDisk}`];
  if (failedOnDisk > 0) parts.push(`Failed: ${failedOnDisk}`);
  parts.push(`Pending: ${pending.length}`);
  if (orphans.length > 0) parts.push(chalk.yellow(`Orphans: ${orphans.length}`));
  console.log(parts.join(' | '));

  if (pending.length > 0) {
    console.log(`\nRun ${chalk.cyan('scaledsearch migrate apply')} to apply pending migrations.`);
  }
}
