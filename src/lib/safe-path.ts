import path from 'path';

/**
 * True when `resolved` is `base` or a descendant of `base`.
 * Uses path.relative so `/tmp/audit-evil` is not treated as inside `/tmp/audit`.
 */
export function isPathInside(resolved: string, base: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(resolved));
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/**
 * Resolve `inputPath` (relative paths against cwd) and return it only if it
 * stays under one of `bases`. Rejects `..` traversal and absolute paths that
 * escape the intended directory.
 */
export function confinePath(inputPath: string, bases: readonly string[]): string {
  const resolved = path.resolve(inputPath);
  if (bases.some((base) => isPathInside(resolved, base))) {
    return resolved;
  }
  throw new Error(
    'Path traversal rejected: path is outside the allowed base directory'
  );
}
