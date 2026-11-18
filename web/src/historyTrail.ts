import { mountBase } from './mount';

const trail = new Map<number, string>();

function entryIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

export function noteEntry(): void {
  trail.set(entryIndex(), window.location.pathname);
}

function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function cameFrom(pathname: string): boolean {
  const before = trail.get(entryIndex() - 1);
  return before !== undefined && decoded(before) === decoded(new URL(mountBase() + pathname, window.location.origin).pathname);
}
