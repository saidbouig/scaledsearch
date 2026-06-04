import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { stringify } from 'yaml';
import { isInitialized, getMigrationsDir } from '../config/config';
import { getNextVersion } from '../migration/parser';
import { friendlyFsError } from '../util/errors';

const MIGRATION_TEMPLATE = {
  description: '',
  engine: 'elasticsearch',
  target_version: '>=8.0',
  operations: [
    {
      type: 'put_mapping',
      index: 'your_index',
      body: {
        properties: {
          example_field: { type: 'text' },
        },
      },
    },
  ],
};

export async function createCommand(name: string): Promise<void> {
  const cwd = process.cwd();

  if (!isInitialized(cwd)) {
    console.log(chalk.red('Not initialized.') + ` Run ${chalk.cyan('scaledsearch migrate init')} first.`);
    process.exit(1);
  }

  try {
    const migrationsDir = getMigrationsDir(cwd);
    // Defensive: if `migrations/` is missing (deleted out-of-band), recreate
    // it instead of crashing with a raw ENOENT inside writeFileSync.
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const version = getNextVersion(migrationsDir);
    const paddedVersion = String(version).padStart(3, '0');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fileName = `V${paddedVersion}__${slug}.yaml`;
    const filePath = path.join(migrationsDir, fileName);

    const template = { ...MIGRATION_TEMPLATE, description: name };
    const content = stringify(template);

    fs.writeFileSync(filePath, content, 'utf-8');

    console.log(chalk.green(`Created migration:`));
    console.log(`  ${filePath}`);
    console.log('');
    console.log(`Edit the file to define your schema changes, then run ${chalk.cyan('scaledsearch migrate apply')}.`);
  } catch (err: any) {
    console.error(chalk.red(friendlyFsError(err, 'create')));
    process.exit(1);
  }
}
