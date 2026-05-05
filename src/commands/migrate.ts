import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations, MigrationFile, MigrationOperation } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { ElasticsearchEngine } from '../engine/elasticsearch';
import { SearchEngine } from '../engine/interface';
import { validateMigrations } from '../migration/validator';

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

export async function migrateCommand(options: { dryRun?: boolean; target?: string }): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('ss init')} first.`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const migrations = loadMigrations(migrationsDir);

  if (migrations.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  // Dry-run can work offline
  if (options.dryRun) {
    const pending = migrations; // In offline dry-run, show all
    console.log(chalk.bold(`\n${pending.length} migration(s) to apply:\n`));
    for (const m of pending) {
      console.log(`  ${chalk.cyan(`V${String(m.version).padStart(3, '0')}`)} ${m.description}`);
      for (const op of m.operations) {
        console.log(`    → ${op.type} ${op.index || ''}`);
      }
    }
    console.log(chalk.yellow('\n(dry-run — no changes applied)'));
    return;
  }

  const engine = new ElasticsearchEngine(config.connection.host, config.connection.auth);

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

  // Validate
  const validation = validateMigrations(migrations, applied);
  if (!validation.valid) {
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

  if (options.target) {
    const targetVersion = parseInt(options.target.replace(/^V/i, ''), 10);
    pending = pending.filter(m => m.version <= targetVersion);
  }

  if (pending.length === 0) {
    console.log(chalk.green('\nAll migrations already applied.'));
    return;
  }

  console.log(`\n${pending.length} pending migration(s):\n`);

  if (options.dryRun) {
    for (const m of pending) {
      console.log(`  ${chalk.cyan(`V${String(m.version).padStart(3, '0')}`)} ${m.description}`);
      for (const op of m.operations) {
        console.log(`    → ${op.type} ${op.index || ''}`);
      }
    }
    console.log(chalk.yellow('\n(dry-run — no changes applied)'));
    return;
  }

  // Execute
  for (const m of pending) {
    const start = Date.now();
    process.stdout.write(`  Applying V${String(m.version).padStart(3, '0')} ${m.description}...`);

    try {
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
      });

      console.log(chalk.red(` FAILED (${elapsed}ms)`));
      console.log(chalk.red(`\n  Error: ${err.message}`));
      console.log(chalk.yellow(`\n  Migration stopped at V${m.version}. Fix the issue and run 'ss migrate' again.`));
      process.exit(1);
    }
  }

  console.log(chalk.green(`\n✓ ${pending.length} migration(s) applied successfully.`));
}
