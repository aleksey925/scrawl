import { mountBase } from './mount';
import { decodeFragment } from './reader/dom';

const trail = new Map<number, string>();

function entryIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

export function noteEntry(): void {
  trail.set(entryIndex(), window.location.pathname);
}

export function cameFrom(pathname: string): boolean {
  const before = trail.get(entryIndex() - 1);
  return before !== undefined && decodeFragment(before) === decodeFragment(new URL(mountBase() + pathname, window.location.origin).pathname);
}
