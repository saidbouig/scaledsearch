import chalk from 'chalk';

export async function rollbackCommand(_options: { to?: string }): Promise<void> {
  console.log(chalk.yellow('Rollback support coming in v0.2.0'));
  console.log('For now, create a new migration that reverses the changes.');
}
