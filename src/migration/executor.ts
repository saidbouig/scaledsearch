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

export async function executeOperation(engine: SearchEngine, op: MigrationOperation): Promise<void> {
  switch (op.type) {
    case 'create_index': {
      const exists = await engine.indexExists(op.index);
      if (exists) {
        throw new Error(`Index '${op.index}' already exists. Use put_mapping or put_settings to modify, or delete_index first.`);
      }
      await engine.createIndex(op.index, { settings: op.settings, mappings: op.mappings || op.body });
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
      await engine.reindex(op.source, op.dest || op.index, op.script);
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
