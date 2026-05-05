#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { createCommand } from './commands/create';
import { statusCommand } from './commands/status';
import { migrateCommand } from './commands/migrate';
import { diffCommand } from './commands/diff';
import { rollbackCommand } from './commands/rollback';
import { validateCommand } from './commands/validate';
import { importCommand } from './commands/import';

const program = new Command();

program
  .name('ss')
  .description('ScaledSearch — The Search Engineer\'s Toolkit for Elasticsearch, OpenSearch, and Solr.')
  .version('0.2.0');

// -- ss migrate <subcommand> --
const migrate = program
  .command('migrate')
  .description('Version-controlled schema migrations');

migrate
  .command('init')
  .description('Initialize ScaledSearch in the current directory')
  .action(initCommand);

migrate
  .command('create <name>')
  .description('Create a new migration file')
  .action(createCommand);

migrate
  .command('status')
  .description('Show migration status (applied vs pending)')
  .action(statusCommand);

migrate
  .command('apply')
  .description('Apply pending migrations to the cluster')
  .option('--dry-run', 'Preview changes without applying')
  .option('--target <version>', 'Migrate up to specific version (e.g. V003)')
  .action(migrateCommand);

migrate
  .command('diff')
  .description('Show pending migration changes in detail')
  .action(diffCommand);

migrate
  .command('validate')
  .description('Validate migration files for errors')
  .action(validateCommand);

migrate
  .command('rollback')
  .description('Rollback the last applied migration')
  .option('--to <version>', 'Rollback to specific version')
  .action(rollbackCommand);

migrate
  .command('import')
  .description('Import existing cluster state as baseline migration (V000)')
  .action(importCommand);

// -- future toolkit commands (stubs) --
// ss audit
// ss bench
// ss monitor
// ss tune
// ss cost

program.parse();
