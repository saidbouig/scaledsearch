#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { createCommand } from './commands/create';
import { statusCommand } from './commands/status';
import { migrateCommand } from './commands/migrate';
import { diffCommand } from './commands/diff';
import { rollbackCommand } from './commands/rollback';

const program = new Command();

program
  .name('ss')
  .description('ScaledSearch — Flyway for Search Engines. Version-controlled schema migrations for Elasticsearch, OpenSearch, and Solr.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ScaledSearch in the current directory')
  .action(initCommand);

program
  .command('create <name>')
  .description('Create a new migration file')
  .action(createCommand);

program
  .command('status')
  .description('Show migration status (applied vs pending)')
  .action(statusCommand);

program
  .command('migrate')
  .description('Apply pending migrations to the cluster')
  .option('--dry-run', 'Preview changes without applying')
  .option('--target <version>', 'Migrate up to specific version (e.g. V003)')
  .action(migrateCommand);

program
  .command('diff')
  .description('Show pending migration changes in detail')
  .action(diffCommand);

program
  .command('rollback')
  .description('Rollback the last applied migration')
  .option('--to <version>', 'Rollback to specific version')
  .action(rollbackCommand);

program.parse();
