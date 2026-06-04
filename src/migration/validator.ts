import { MigrationFile, MigrationOperation } from './parser';
import { HistoryEntry } from './history';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Virtual cluster state, simulated from migration files. Used to catch
// preconditions that depend on prior ops — e.g. put_mapping on an index no
// migration ever created, or swap_alias for an alias that isn't attached.
//
// This is *not* a check against the live cluster: it only sees what the
// migration files themselves declare. Drift between files and reality is
// out of scope here.
interface VirtualClusterState {
  indices: Set<string>;
  closedIndices: Set<string>;
  // alias -> set of indices it points at
  aliases: Map<string, Set<string>>;
  templates: Set<string>;
  pipelines: Set<string>;
}

function emptyState(): VirtualClusterState {
  return {
    indices: new Set(),
    closedIndices: new Set(),
    aliases: new Map(),
    templates: new Set(),
    pipelines: new Set(),
  };
}

function aliasIndices(state: VirtualClusterState, alias: string): Set<string> {
  let s = state.aliases.get(alias);
  if (!s) {
    s = new Set();
    state.aliases.set(alias, s);
  }
  return s;
}

// Apply one operation to the virtual state, reporting precondition errors.
// Errors are tagged with the migration version and op index so the message
// points the user straight at the offending YAML.
function applyOp(
  state: VirtualClusterState,
  op: MigrationOperation,
  version: number,
  opIndex: number,
  errors: string[],
): void {
  const tag = `V${version} op[${opIndex}] (${op.type})`;

  switch (op.type) {
    case 'create_index': {
      if (state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' already exists — declared by an earlier migration without a delete_index between.`);
        return;
      }
      state.indices.add(op.index);
      break;
    }
    case 'delete_index': {
      if (!state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' does not exist — no prior migration creates it.`);
        return;
      }
      state.indices.delete(op.index);
      state.closedIndices.delete(op.index);
      // Detach from any aliases
      for (const s of state.aliases.values()) s.delete(op.index);
      break;
    }
    case 'put_mapping':
    case 'put_settings': {
      if (!state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' does not exist — no prior migration creates it.`);
      }
      break;
    }
    case 'close_index': {
      if (!state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' does not exist — no prior migration creates it.`);
        return;
      }
      if (state.closedIndices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' is already closed.`);
        return;
      }
      state.closedIndices.add(op.index);
      break;
    }
    case 'open_index': {
      if (!state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' does not exist — no prior migration creates it.`);
        return;
      }
      state.closedIndices.delete(op.index);
      break;
    }
    case 'add_alias': {
      if (!state.indices.has(op.index)) {
        errors.push(`${tag}: index '${op.index}' does not exist — cannot attach alias to a missing index.`);
        return;
      }
      if (!op.alias) return; // syntactic check already flagged it
      aliasIndices(state, op.alias).add(op.index);
      break;
    }
    case 'remove_alias': {
      if (!op.alias) return;
      const set = state.aliases.get(op.alias);
      if (!set || !set.has(op.index)) {
        errors.push(`${tag}: alias '${op.alias}' is not currently attached to '${op.index}'.`);
        return;
      }
      set.delete(op.index);
      break;
    }
    case 'swap_alias': {
      if (!op.alias || !op.from || !op.to) return;
      if (!state.indices.has(op.from)) {
        errors.push(`${tag}: 'from' index '${op.from}' does not exist.`);
      }
      if (!state.indices.has(op.to)) {
        errors.push(`${tag}: 'to' index '${op.to}' does not exist.`);
      }
      const set = state.aliases.get(op.alias);
      if (!set || !set.has(op.from)) {
        errors.push(`${tag}: alias '${op.alias}' is not currently attached to 'from' index '${op.from}'.`);
        return;
      }
      set.delete(op.from);
      set.add(op.to);
      break;
    }
    case 'reindex': {
      if (op.source && !state.indices.has(op.source)) {
        errors.push(`${tag}: source index '${op.source}' does not exist.`);
      }
      break;
    }
    case 'put_template': {
      if (op.name) state.templates.add(op.name);
      break;
    }
    case 'delete_template': {
      if (!op.name) return;
      if (!state.templates.has(op.name)) {
        errors.push(`${tag}: template '${op.name}' does not exist — no prior migration creates it.`);
        return;
      }
      state.templates.delete(op.name);
      break;
    }
    case 'put_pipeline': {
      if (op.name) state.pipelines.add(op.name);
      break;
    }
    case 'delete_pipeline': {
      if (!op.name) return;
      if (!state.pipelines.has(op.name)) {
        errors.push(`${tag}: pipeline '${op.name}' does not exist — no prior migration creates it.`);
        return;
      }
      state.pipelines.delete(op.name);
      break;
    }
    case 'api_call':
      // Raw HTTP escape hatch — can't reason about effects.
      break;
  }
}

// Walk migrations in version order, simulating cluster state from their ops
// alone. Returns the precondition errors found.
//
// Seeding from V000 baseline (if present): the baseline's create_index ops
// declare the indices that existed at import time, so subsequent migrations
// that reference them validate cleanly. If no V000 exists, state starts empty.
export function simulateFromFiles(files: MigrationFile[]): { errors: string[] } {
  const errors: string[] = [];
  const sorted = [...files].sort((a, b) => a.version - b.version);
  const state = emptyState();
  for (const file of sorted) {
    for (let i = 0; i < file.operations.length; i++) {
      applyOp(state, file.operations[i], file.version, i, errors);
    }
  }
  return { errors };
}

export function validateMigrations(files: MigrationFile[], applied: HistoryEntry[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for duplicate versions
  const versions = files.map(f => f.version);
  const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
  if (duplicates.length > 0) {
    errors.push(`Duplicate migration versions: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Check for gaps in versioning
  const sorted = [...versions].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) {
      warnings.push(`Gap in migration versions between V${sorted[i - 1]} and V${sorted[i]}`);
    }
  }

  // Check checksum integrity of applied migrations
  for (const entry of applied) {
    const file = files.find(f => f.version === entry.version);
    if (!file) {
      warnings.push(`Applied migration V${entry.version} (${entry.description}) not found in filesystem`);
      continue;
    }
    if (file.checksum !== entry.checksum) {
      errors.push(`Checksum mismatch for V${entry.version} (${entry.description}): file was modified after being applied`);
    }
  }

  // Check for operations validity
  const noIndexRequired = ['reindex', 'api_call', 'swap_alias', 'put_template', 'delete_template', 'put_pipeline', 'delete_pipeline'];
  const validTypes = [
    'create_index', 'put_mapping', 'put_settings', 'delete_index',
    'reindex', 'close_index', 'open_index',
    'add_alias', 'remove_alias', 'swap_alias',
    'put_template', 'delete_template',
    'put_pipeline', 'delete_pipeline',
    'api_call',
  ];
  for (const file of files) {
    for (let i = 0; i < file.operations.length; i++) {
      const op = file.operations[i];
      if (!validTypes.includes(op.type)) {
        errors.push(`V${file.version} op[${i}]: Unknown operation type '${op.type}'. Valid: ${validTypes.join(', ')}`);
      }
      if (!op.index && !noIndexRequired.includes(op.type)) {
        errors.push(`V${file.version} op[${i}]: Operation '${op.type}' missing 'index' field`);
      }
      if (op.type === 'reindex') {
        if (!op.source) errors.push(`V${file.version} op[${i}]: Reindex missing 'source' field`);
        if (!op.dest && !op.index) errors.push(`V${file.version} op[${i}]: Reindex missing 'dest' field`);
      }
      if (op.type === 'add_alias' || op.type === 'remove_alias') {
        if (!op.alias) errors.push(`V${file.version} op[${i}]: ${op.type} missing 'alias' field`);
      }
      if (op.type === 'swap_alias') {
        if (!op.alias) errors.push(`V${file.version} op[${i}]: swap_alias missing 'alias' field`);
        if (!op.from) errors.push(`V${file.version} op[${i}]: swap_alias missing 'from' field`);
        if (!op.to) errors.push(`V${file.version} op[${i}]: swap_alias missing 'to' field`);
      }
      if (op.type === 'put_template' || op.type === 'delete_template' || op.type === 'put_pipeline' || op.type === 'delete_pipeline') {
        if (!op.name) errors.push(`V${file.version} op[${i}]: ${op.type} missing 'name' field`);
      }
      if (op.type === 'api_call') {
        if (!op.method) errors.push(`V${file.version} op[${i}]: api_call missing 'method' field`);
        if (!op.path) errors.push(`V${file.version} op[${i}]: api_call missing 'path' field`);
      }
    }
  }

  // Simulate cluster state from the migration files alone and check that
  // every op's precondition holds. Only run if the syntactic checks above
  // didn't already find structural problems — a duplicate version or
  // unknown op type would just produce confusing duplicate errors here.
  if (errors.length === 0) {
    const sim = simulateFromFiles(files);
    errors.push(...sim.errors);
  }

  return { valid: errors.length === 0, errors, warnings };
}
