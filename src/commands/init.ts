import chalk from 'chalk';
import {
  isInitialized,
  initConfig,
  loadConfig,
  getConfigDir,
  getMigrationsDir,
} from '../config/config';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  if (isInitialized(cwd)) {
    console.log(chalk.yellow('Already initialized.') + ` Config at ${getConfigDir(cwd)}`);
    return;
  }

  const configPath = initConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);
  const config = loadConfig(cwd);

  console.log(chalk.green('Initialized ScaledSearch.'));
  console.log(`  Config:     ${configPath}`);
  console.log(`  Migrations: ${migrationsDir}`);
  console.log(`  History:    ${config.history.index}`);
  console.log('');
  console.log(`Next: ${chalk.cyan('scaledsearch migrate create "initial-schema"')} to create your first migration.`);
}
