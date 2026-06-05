import { describe, it, expect } from 'vitest';
import { friendlyFsError } from '../../src/util/errors';

describe('friendlyFsError', () => {
  it('formats EACCES with the path', () => {
    expect(friendlyFsError({ code: 'EACCES', path: '/tmp/x' }, 'init')).toBe(
      'init failed: permission denied (/tmp/x).',
    );
  });

  it('formats EACCES without a path', () => {
    expect(friendlyFsError({ code: 'EACCES' }, 'init')).toBe(
      'init failed: permission denied.',
    );
  });

  it('formats ENOENT with the path', () => {
    expect(friendlyFsError({ code: 'ENOENT', path: '/missing' }, 'create')).toBe(
      'create failed: path not found (/missing).',
    );
  });

  it('formats EEXIST', () => {
    expect(friendlyFsError({ code: 'EEXIST', path: '/x' }, 'init')).toBe(
      'init failed: already exists (/x).',
    );
  });

  it('formats EROFS', () => {
    expect(friendlyFsError({ code: 'EROFS', path: '/cdrom' }, 'init')).toBe(
      'init failed: read-only file system (/cdrom).',
    );
  });

  it('formats ENOSPC without needing a path', () => {
    expect(friendlyFsError({ code: 'ENOSPC' }, 'apply')).toBe(
      'apply failed: no space left on device.',
    );
  });

  it('formats EISDIR and ENOTDIR distinctly', () => {
    expect(friendlyFsError({ code: 'EISDIR', path: '/x' }, 'init')).toBe(
      'init failed: expected a file but got a directory (/x).',
    );
    expect(friendlyFsError({ code: 'ENOTDIR', path: '/x' }, 'init')).toBe(
      'init failed: expected a directory but got a file (/x).',
    );
  });

  it('formats EPERM', () => {
    expect(friendlyFsError({ code: 'EPERM', path: '/x' }, 'init')).toBe(
      'init failed: operation not permitted (/x).',
    );
  });

  it('falls through to err.message for unknown codes', () => {
    expect(friendlyFsError({ code: 'EWEIRD', message: 'something weird' }, 'init')).toBe(
      'init failed: something weird',
    );
  });

  it('handles errors with no message gracefully', () => {
    expect(friendlyFsError({}, 'init')).toBe('init failed: [object Object]');
  });

  it('does not include stack traces or internal error fields', () => {
    const err = {
      code: 'EACCES',
      path: '/x',
      stack: 'Error: at internal...\n  at lots of stuff',
      syscall: 'mkdir',
      errno: -13,
    };
    const out = friendlyFsError(err, 'init');
    expect(out).not.toContain('stack');
    expect(out).not.toContain('syscall');
    expect(out).not.toContain('errno');
    expect(out).not.toContain('mkdir');
  });
});
