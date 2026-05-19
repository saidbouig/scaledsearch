import chalk from 'chalk';
import { SearchEngine } from '../engine/interface';
import { MigrationOperation } from './parser';

const VALID_TYPES = [
  'create_index', 'put_mapping', 'put_settings', 'delete_index',
  'reindex', 'close_index', 'open_index',
  'add_alias', 'remove_alias', 'swap_alias',
  'put_template', 'delete_template',
  'put_pipeline', 'delete_pipeline',
  'api_call',
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatProgress(created: number, total: number): string {
  if (total === 0) return '0%';
  const pct = Math.round((created / total) * 100);
  return `${pct}% (${created.toLocaleString()}/${total.toLocaleString()} docs)`;
}

async function executeReindex(engine: SearchEngine, source: string, dest: string, script?: string): Promise<void> {
  // Start async reindex
  const taskId = await engine.reindexAsync(source, dest, script);

  // Poll for completion
  let lastLog = 0;
  let pollFailures = 0;
  while (true) {
    await sleep(3000);

    let task;
    try {
      task = await engine.getTask(taskId);
      pollFailures = 0;
    } catch (err: any) {
      pollFailures++;
      if (pollFailures >= 5) {
        throw new Error(`Lost connection while polling reindex task ${taskId}. The reindex may still be running on the cluster. Check with: GET /_tasks/${taskId}`);
      }
      continue; // Retry
    }

    if (task.error) {
      throw new Error(`Reindex failed: ${JSON.stringify(task.error)}`);
    }

    if (task.completed) {
      if (task.total && task.total > 0) {
        process.stdout.write(` ${formatProgress(task.created || task.total, task.total)}`);
      }
      return;
    }

    // Log progress every 10 seconds
    const now = Date.now();
    if (task.total && task.total > 0 && now - lastLog > 10000) {
      process.stdout.write(` ${formatProgress(task.created || 0, task.total)}`);
      lastLog = now;
    }
  }
}

export async function executeOperation(engine: SearchEngine, op: MigrationOperation): Promise<void> {
  switch (op.type) {
    case 'create_index': {
      const exists = await engine.indexExists(op.index);
      if (exists) {
        throw new Error(`Index '${op.index}' already exists. Use put_mapping or put_settings to modify, or delete_index first.`);
      }
      // Accept either:
      //   mappings: { properties: { ... } }       (direct)
      //   body:     { mappings: { ... }, settings: { ... } }   (Flyway-style wrapper)
      const fromBody = op.body && typeof op.body === 'object' ? op.body : {};
      const mappings = op.mappings ?? fromBody.mappings ?? (op.body && !fromBody.mappings && !fromBody.settings ? op.body : undefined);
      const settings = op.settings ?? fromBody.settings;
      await engine.createIndex(op.index, { settings, mappings });
      break;
    }
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
      if (!op.source) {
        throw new Error(`Reindex operation missing 'source' field.`);
      }
      await executeReindex(engine, op.source, op.dest || op.index, op.script);
      break;
    case 'add_alias':
      if (!op.alias) throw new Error(`add_alias requires 'alias' field.`);
      await engine.addAlias(op.index, op.alias);
      break;
    case 'remove_alias':
      if (!op.alias) throw new Error(`remove_alias requires 'alias' field.`);
      await engine.removeAlias(op.index, op.alias);
      break;
    case 'swap_alias':
      if (!op.alias) throw new Error(`swap_alias requires 'alias' field.`);
      if (!op.from) throw new Error(`swap_alias requires 'from' field.`);
      if (!op.to) throw new Error(`swap_alias requires 'to' field.`);
      await engine.swapAlias(op.alias, op.from, op.to);
      break;
    case 'put_template':
      if (!op.name) throw new Error(`put_template requires 'name' field.`);
      await engine.putTemplate(op.name, op.body);
      break;
    case 'delete_template':
      if (!op.name) throw new Error(`delete_template requires 'name' field.`);
      await engine.deleteTemplate(op.name);
      break;
    case 'put_pipeline':
      if (!op.name) throw new Error(`put_pipeline requires 'name' field.`);
      await engine.putPipeline(op.name, op.body);
      break;
    case 'delete_pipeline':
      if (!op.name) throw new Error(`delete_pipeline requires 'name' field.`);
      await engine.deletePipeline(op.name);
      break;
    case 'api_call':
      if (!op.method || !op.path) {
        throw new Error(`api_call requires 'method' and 'path' fields.`);
      }
      await engine.apiCall(op.method, op.path, op.body);
      break;
    default:
      throw new Error(`Unknown operation type: '${(op as any).type}'. Valid: ${VALID_TYPES.join(', ')}`);
  }
}
