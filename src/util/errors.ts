// Format Node fs errors into a single user-friendly line. Strips the stack
// trace and the internal error properties so users see "Permission denied:
// /var/foo" instead of a 20-line Node loader trace.
//
// `context` is a short label for the operation that failed (e.g. "init",
// "create"). Anything we don't recognize falls through to err.message.
export function friendlyFsError(err: any, context: string): string {
  const code = err?.code;
  const path = err?.path;
  const prefix = `${context} failed`;

  switch (code) {
    case 'EACCES':
      return `${prefix}: permission denied${path ? ` (${path})` : ''}.`;
    case 'EPERM':
      return `${prefix}: operation not permitted${path ? ` (${path})` : ''}.`;
    case 'ENOENT':
      return `${prefix}: path not found${path ? ` (${path})` : ''}.`;
    case 'EEXIST':
      return `${prefix}: already exists${path ? ` (${path})` : ''}.`;
    case 'ENOSPC':
      return `${prefix}: no space left on device.`;
    case 'EROFS':
      return `${prefix}: read-only file system${path ? ` (${path})` : ''}.`;
    case 'EISDIR':
      return `${prefix}: expected a file but got a directory${path ? ` (${path})` : ''}.`;
    case 'ENOTDIR':
      return `${prefix}: expected a directory but got a file${path ? ` (${path})` : ''}.`;
    default:
      return `${prefix}: ${err?.message ?? String(err)}`;
  }
}
