import chalk from 'chalk';
import { isInitialized, loadConfig, getMigrationsDir } from '../config/config';
import { loadMigrations } from '../migration/parser';
import { MigrationHistory } from '../migration/history';
import { ElasticsearchEngine } from '../engine/elasticsearch';
import { validateMigrations } from '../migration/validator';

export async function validateCommand(): Promise<void> {
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

  // Try to get applied history for checksum validation
  let applied: any[] = [];
  try {
    const engine = new ElasticsearchEngine(config.connection.host, config.connection.auth);
    await engine.connect();
    const history = new MigrationHistory(engine, config.history.index);
    applied = await history.getApplied();
  } catch {
    // Offline — validate filesystem only
  }

  const result = validateMigrations(migrations, applied);

  if (result.errors.length > 0) {
    console.log(chalk.red.bold('Validation FAILED:\n'));
    result.errors.forEach(e => console.log(`  ${chalk.red('✗')} ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow.bold('\nWarnings:\n'));
    result.warnings.forEach(w => console.log(`  ${chalk.yellow('⚠')} ${w}`));
  }

  if (result.valid) {
    console.log(chalk.green(`✓ All ${migrations.length} migration(s) valid.`));
  } else {
    process.exit(1);
  }
}
