import { describe, it, expect } from 'bun:test';
import os from 'os';
import path from 'path';
import { confinePath, isPathInside } from './safe-path';

describe('isPathInside', () => {
  it('treats a file under the base as inside', () => {
    expect(isPathInside(path.join(process.cwd(), '.audit', 'ledger.jsonl'), process.cwd())).toBe(
      true
    );
  });

  it('does not treat a sibling prefix as inside', () => {
    expect(isPathInside('/tmp/audit-evil/secret', '/tmp/audit')).toBe(false);
  });
});

describe('confinePath', () => {
  const bases = [process.cwd(), os.tmpdir()];

  it('resolves a legitimate in-tree relative path', () => {
    const resolved = confinePath(path.join('.audit', 'incident-ledger.jsonl'), bases);
    expect(resolved).toBe(path.join(process.cwd(), '.audit', 'incident-ledger.jsonl'));
    expect(resolved.startsWith(path.resolve(process.cwd()) + path.sep)).toBe(true);
  });

  it('rejects relative traversal', () => {
    expect(() => confinePath('../../../../etc/passwd', bases)).toThrow(
      /Path traversal rejected/
    );
  });

  it('rejects an absolute path outside the bases', () => {
    expect(() => confinePath('/etc/passwd', bases)).toThrow(/Path traversal rejected/);
  });

  it('allows a path under the OS temp dir', () => {
    const tmpFile = path.join(os.tmpdir(), 'audit-confine-test', 'ledger.jsonl');
    expect(confinePath(tmpFile, bases)).toBe(path.resolve(tmpFile));
  });
});
