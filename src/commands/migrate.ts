import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations, MigrationFile, MigrationOperation } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { createEngine } from '../engine/factory';
import { validateMigrations } from '../migration/validator';
import { executeOperation } from '../migration/executor';

// Parses --target into a version number or throws a clean error.
//   - Strips an optional leading "V" or "v"
//   - Requires a positive integer (rejects "abc", "V-1", "1.5", etc.)
//   - Requires the version to exist on disk (rejects "V999" when max is V3)
// Returns the numeric version when valid.
export function parseTarget(raw: string, migrations: MigrationFile[]): number {
  const cleaned = raw.replace(/^[Vv]/, '');
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(
      `Invalid --target value '${raw}'. Expected a version number like V003 or 3.`,
    );
  }
  const targetVersion = parseInt(cleaned, 10);
  const onDisk = new Set(migrations.map(m => m.version));
  if (!onDisk.has(targetVersion)) {
    const available = migrations.map(m => `V${String(m.version).padStart(3, '0')}`).join(', ');
    throw new Error(
      `--target V${String(targetVersion).padStart(3, '0')} does not match any migration on disk. Available: ${available}`,
    );
  }
  return targetVersion;
}

export async function migrateCommand(options: { dryRun?: boolean; target?: string }): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('scaledsearch migrate init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);

  // Loading migrations can throw on malformed YAML, missing required fields,
  // etc. Same friendly-error pattern as status/diff — the parser already
  // names the offending file in the thrown error.
  let migrations: MigrationFile[];
  try {
    migrations = loadMigrations(migrationsDir);
  } catch (err: any) {
    console.error(chalk.red(`apply failed: ${err.message ?? String(err)}`));
    process.exit(1);
  }

  if (migrations.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  // Validate --target up front so both dry-run and real apply give the same
  // error for bad input. Done before we even attempt to connect.
  let targetVersion: number | undefined;
  if (options.target) {
    try {
      targetVersion = parseTarget(options.target, migrations);
    } catch (err: any) {
      console.error(chalk.red(err.message ?? String(err)));
      process.exit(1);
    }
  }

  // Dry-run: try to connect for accurate pending list, fallback to showing all
  if (options.dryRun) {
    let pending = migrations;
    let appliedMaxVersion = -1;
    try {
      const engine = await createEngine(config);
      await engine.connect();
      const history = new MigrationHistory(engine, config.history.index);
      const applied = await history.getApplied();
      const appliedVersions = new Set(applied.map(a => a.version));
      pending = migrations.filter(m => !appliedVersions.has(m.version));
      if (applied.length > 0) {
        appliedMaxVersion = Math.max(...applied.map(a => a.version));
      }
    } catch {
      console.log(chalk.yellow('(offline — showing all migrations)\n'));
    }
    // Honor --target in dry-run too so the preview matches what a real
    // apply with the same flags would actually do.
    if (targetVersion !== undefined) {
      if (targetVersion < appliedMaxVersion) {
        console.log(
          chalk.yellow(
            `\n⚠ --target V${String(targetVersion).padStart(3, '0')} is below the highest applied version V${String(appliedMaxVersion).padStart(3, '0')}. ` +
              `apply does not undo migrations — use 'scaledsearch migrate rollback' to revert.`,
          ),
        );
      }
      pending = pending.filter(m => m.version <= targetVersion);
    }
    if (pending.length === 0) {
      console.log(chalk.green('All migrations already applied.'));
      return;
    }
    console.log(chalk.bold(`${pending.length} migration(s) would be applied:\n`));
    for (const m of pending) {
      console.log(`  ${chalk.cyan(`V${String(m.version).padStart(3, '0')}`)} ${m.description}`);
      for (const op of m.operations) {
        console.log(`    → ${op.type} ${op.index || ''}`);
      }
    }
    console.log(chalk.yellow('\n(dry-run — no changes applied)'));
    return;
  }

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

  const history = new MigrationHistory(engine, config.history.index);

  // Acquire lock
  const locked = await history.acquireLock();
  if (!locked) {
    console.log(chalk.red('\nAnother migration is in progress. Lock expires after 10 minutes if the process crashed.'));
    process.exit(1);
  }

  const applied = await history.getApplied();

  // Validate
  const validation = validateMigrations(migrations, applied);
  if (!validation.valid) {
    await history.releaseLock();
    console.log(chalk.red('\nValidation errors:'));
    validation.errors.forEach(e => console.log(`  ${chalk.red('✗')} ${e}`));
    process.exit(1);
  }
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => console.log(`  ${chalk.yellow('⚠')} ${w}`));
  }

  // Find pending
  const appliedVersions = new Set(applied.map(a => a.version));
  let pending = migrations.filter(m => !appliedVersions.has(m.version));

  if (targetVersion !== undefined) {
    // If the target is below the highest already-applied version, the user
    // is asking for a no-op that probably isn't what they want. apply only
    // moves forward — surface this explicitly instead of "All migrations
    // already applied."
    const appliedMaxVersion = applied.length > 0
      ? Math.max(...applied.map(a => a.version))
      : -1;
    if (targetVersion < appliedMaxVersion) {
      await history.releaseLock();
      console.log(
        chalk.yellow(
          `\n--target V${String(targetVersion).padStart(3, '0')} is below the highest applied version V${String(appliedMaxVersion).padStart(3, '0')}. ` +
            `apply does not undo migrations — use 'scaledsearch migrate rollback' to revert.`,
        ),
      );
      return;
    }
    pending = pending.filter(m => m.version <= targetVersion);
  }

  if (pending.length === 0) {
    await history.releaseLock();
    console.log(chalk.green('\nAll migrations already applied.'));
    return;
  }

  console.log(`\n${pending.length} pending migration(s):\n`);

  // Execute
  for (const m of pending) {
    const start = Date.now();
    process.stdout.write(`  Applying V${String(m.version).padStart(3, '0')} ${m.description}...`);

    try {
      if (m.operations.length === 0) {
        await history.recordSuccess({
          version: m.version,
          description: m.description,
          checksum: m.checksum,
          applied_at: new Date().toISOString(),
          execution_time_ms: 0,
          engine: clusterInfo.engine,
          engine_version: clusterInfo.version,
        });
        console.log(chalk.yellow(` skipped (no operations)`));
        continue;
      }
      for (const op of m.operations) {
        await executeOperation(engine, op);
      }

      const elapsed = Date.now() - start;
      await history.recordSuccess({
        version: m.version,
        description: m.description,
        checksum: m.checksum,
        applied_at: new Date().toISOString(),
        execution_time_ms: elapsed,
        engine: clusterInfo.engine,
        engine_version: clusterInfo.version,
      });

      console.log(chalk.green(` done (${elapsed}ms)`));
    } catch (err: any) {
      const elapsed = Date.now() - start;
      await history.recordFailure({
        version: m.version,
        description: m.description,
        checksum: m.checksum,
        applied_at: new Date().toISOString(),
        execution_time_ms: elapsed,
        engine: clusterInfo.engine,
        engine_version: clusterInfo.version,
        error_message: err.message,
      });

      console.log(chalk.red(` FAILED (${elapsed}ms)`));
      console.log(chalk.red(`\n  Error: ${err.message}`));
      if (m.operations.length > 1) {
        console.log(chalk.yellow(`\n  Warning: Some operations in V${m.version} may have been partially applied.`));
        console.log(chalk.yellow(`  Check your cluster state before retrying.`));
      }
      console.log(chalk.yellow(`\n  Migration stopped at V${m.version}. Fix the issue and run 'scaledsearch migrate apply' again.`));
      await history.releaseLock();
      process.exit(1);
    }
  }

  await history.releaseLock();
  console.log(chalk.green(`\n✓ ${pending.length} migration(s) applied successfully.`));
}
