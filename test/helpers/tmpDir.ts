import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function makeTmpDir(prefix = 'scaledsearch-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupTmpDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
