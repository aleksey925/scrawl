import { mountBase } from './mount';

const trail = new Map<number, string>();

function entryIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

export function noteEntry(): void {
  trail.set(entryIndex(), window.location.pathname);
}

export function cameFrom(pathname: string): boolean {
  return trail.get(entryIndex() - 1) === new URL(mountBase() + pathname, window.location.origin).pathname;
}
