/**
 * Resilience probes for `scaledsearch migrate init` and `migrate create`.
 *
 * These don't need a cluster — they exercise the CLI's filesystem behavior
 * against degraded states (missing dirs, pre-existing content, permission
 * errors). Each was a real bug found during a bug-hunt session.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { makeTmpDir, cleanupTmpDir } from '../helpers/tmpDir';

const CLI = path.resolve(__dirname, '../../src/index.ts');

function runCli(cwd: string, args: string): { stdout: string; status: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout, status: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? '') + (err.stderr ?? ''),
      status: err.status ?? 1,
    };
  }
}

describe('init: self-heals missing migrations directory', () => {
  it('recreates migrations/ when it was deleted after a previous init', () => {
    const tmp = makeTmpDir('scaledsearch-selfheal-');
    try {
      // First init: sets up both dirs cleanly.
      runCli(tmp, 'migrate init');
      const migrationsDir = path.join(tmp, 'migrations');
      expect(fs.existsSync(migrationsDir)).toBe(true);

      // Simulate the dir going missing (git stash, accidental rm, etc).
      fs.rmSync(migrationsDir, { recursive: true });
      expect(fs.existsSync(migrationsDir)).toBe(false);

      // Re-running init must recreate the dir, not just say
      // "Already initialized" and leave the user broken.
      const result = runCli(tmp, 'migrate init');
      expect(result.status).toBe(0);
      expect(fs.existsSync(migrationsDir)).toBe(true);
      expect(result.stdout.toLowerCase()).toMatch(/recreated|migrations/);
    } finally {
      cleanupTmpDir(tmp);
    }
  });

  it('preserves pre-existing migration files when init runs over them', () => {
    const tmp = makeTmpDir('scaledsearch-preexisting-');
    try {
      // Create a migrations dir + file BEFORE the project is initialized,
      // simulating someone migrating from an old layout or copying files in.
      const migrationsDir = path.join(tmp, 'migrations');
      fs.mkdirSync(migrationsDir);
      const existingFile = path.join(migrationsDir, 'V001__legacy.yaml');
      fs.writeFileSync(
        existingFile,
        'description: legacy\noperations:\n  - type: create_index\n    index: legacy\n',
        'utf-8',
      );

      const result = runCli(tmp, 'migrate init');
      expect(result.status).toBe(0);
      expect(fs.existsSync(existingFile)).toBe(true);
      expect(fs.readFileSync(existingFile, 'utf-8')).toContain('legacy');
    } finally {
      cleanupTmpDir(tmp);
    }
  });

  it('init followed by create on a self-healed dir works end-to-end', () => {
    const tmp = makeTmpDir('scaledsearch-selfheal-create-');
    try {
      runCli(tmp, 'migrate init');
      fs.rmSync(path.join(tmp, 'migrations'), { recursive: true });

      // Self-heal path
      runCli(tmp, 'migrate init');

      // Now create should succeed without the raw ENOENT crash.
      const result = runCli(tmp, 'migrate create "hello world"');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('V001');
      const files = fs.readdirSync(path.join(tmp, 'migrations'));
      expect(files.some(f => f.startsWith('V001__'))).toBe(true);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('create: defensively recreates migrations dir', () => {
  it('does not crash when migrations/ vanishes between init and create', () => {
    const tmp = makeTmpDir('scaledsearch-create-vanish-');
    try {
      runCli(tmp, 'migrate init');
      fs.rmSync(path.join(tmp, 'migrations'), { recursive: true });

      // Skipping the heal-by-init step on purpose: create itself should
      // recreate the dir rather than crash with raw ENOENT.
      const result = runCli(tmp, 'migrate create "rescue"');
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(tmp, 'migrations'))).toBe(true);
      const files = fs.readdirSync(path.join(tmp, 'migrations'));
      expect(files.some(f => f.startsWith('V001__'))).toBe(true);
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});

describe('init: surfaces fs errors with a friendly message (not a stack trace)', () => {
  // skip on Windows — chmod 555 doesn't block writes there
  const itIfPosix = process.platform === 'win32' ? it.skip : it;

  itIfPosix('prints "permission denied" instead of an EACCES stack on read-only cwd', () => {
    const tmp = makeTmpDir('scaledsearch-readonly-');
    try {
      // Make the dir read+exec only — mkdir below will EACCES.
      fs.chmodSync(tmp, 0o555);
      try {
        const result = runCli(tmp, 'migrate init');
        expect(result.status).not.toBe(0);
        // No raw Node stack trace
        expect(result.stdout).not.toContain('at Module.');
        expect(result.stdout).not.toContain('node:internal');
        // Friendly message
        expect(result.stdout.toLowerCase()).toMatch(/permission denied/);
      } finally {
        // Restore so cleanup works
        fs.chmodSync(tmp, 0o755);
      }
    } finally {
      cleanupTmpDir(tmp);
    }
  });
});
