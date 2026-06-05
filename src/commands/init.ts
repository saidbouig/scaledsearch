import * as fs from 'fs';
import chalk from 'chalk';
import {
  isInitialized,
  initConfig,
  loadConfig,
  getConfigDir,
  getMigrationsDir,
} from '../config/config';
import { friendlyFsError } from '../util/errors';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    if (isInitialized(cwd)) {
      // Init is idempotent for missing subdirs. If `migrations/` was deleted
      // (e.g. `git stash`, accidental `rm`), recreate it instead of telling
      // the user they're "already initialized" and leaving downstream
      // commands to crash with a raw ENOENT.
      const migrationsDir = getMigrationsDir(cwd);
      const recreated = !fs.existsSync(migrationsDir);
      if (recreated) {
        fs.mkdirSync(migrationsDir, { recursive: true });
      }
      console.log(
        chalk.yellow('Already initialized.') + ` Config at ${getConfigDir(cwd)}`,
      );
      if (recreated) {
        console.log(chalk.green(`Recreated missing migrations directory: ${migrationsDir}`));
      }
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
  } catch (err: any) {
    console.error(chalk.red(friendlyFsError(err, 'init')));
    process.exit(1);
  }
}
