import { SearchEngine } from '../engine/interface';
import { MigrationOperation } from './parser';

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
    case 'api_call':
      if (!op.method || !op.path) {
        throw new Error(`api_call requires 'method' and 'path' fields.`);
      }
      await engine.apiCall(op.method, op.path, op.body);
      break;
    default:
      throw new Error(`Unknown operation type: '${(op as any).type}'. Valid types: create_index, put_mapping, put_settings, delete_index, reindex, close_index, open_index, api_call`);
  }
}
