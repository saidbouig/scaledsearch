import { MigrationFile } from './parser';
import { HistoryEntry } from './history';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
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
  const validTypes = ['create_index', 'put_mapping', 'put_settings', 'delete_index', 'reindex', 'close_index', 'open_index'];
  for (const file of files) {
    for (const op of file.operations) {
      if (!validTypes.includes(op.type)) {
        errors.push(`V${file.version}: Unknown operation type '${op.type}'`);
      }
      if (!op.index && op.type !== 'reindex') {
        errors.push(`V${file.version}: Operation '${op.type}' missing 'index' field`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
