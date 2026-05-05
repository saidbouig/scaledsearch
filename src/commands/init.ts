import chalk from 'chalk';
import { isInitialized, initConfig, getConfigDir, getMigrationsDir } from '../config/config';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  if (isInitialized(cwd)) {
    console.log(chalk.yellow('Already initialized.') + ` Config at ${getConfigDir(cwd)}`);
    return;
  }

  const configPath = initConfig(cwd);
  const migrationsDir = getMigrationsDir(cwd);

  console.log(chalk.green('Initialized ScaledSearch.'));
  console.log(`  Config:     ${configPath}`);
  console.log(`  Migrations: ${migrationsDir}`);
  console.log('');
  console.log(`Next: ${chalk.cyan('ss migrate create "initial-schema"')} to create your first migration.`);
}
