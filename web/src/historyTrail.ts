import { useEffect } from 'react';
import { useLocation } from 'react-router';

const trail = new Map<number, string>();

function entryIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

function normalized(pathname: string): string {
  return new URL(pathname, window.location.origin).pathname;
}

export function useHistoryTrail(): void {
  const { key, pathname } = useLocation();
  useEffect(() => {
    trail.set(entryIndex(), normalized(pathname));
  }, [key, pathname]);
}

export function cameFrom(pathname: string): boolean {
  return trail.get(entryIndex() - 1) === normalized(pathname);
}
