import { api } from '../api/client';
import type { DirEntry, EntryPathResponse, MutationState } from '../api/types';

import { parentOf } from './naming';

export interface Relocation {
  from: string;
  to: string;
}

export interface UndoMark {
  targets: string[];
  stamps: Map<string, Promise<string | undefined>>;
}

export interface Relocated {
  done: Relocation[];
  left: Relocation[];
  failure: unknown;
  changed: boolean;
  state: MutationState;
}

function stampOf(entry: DirEntry): string {
  return entry.is_dir ? 'dir' : `${entry.size}:${entry.mod_time}`;
}

async function stampAt(path: string): Promise<string | undefined> {
  const listing = await api.dir(parentOf(path));
  const found = listing.entries.find((row) => row.path === path);
  return found === undefined ? undefined : stampOf(found);
}

async function stampOrUnknown(path: string): Promise<string | undefined> {
  try {
    return await stampAt(path);
  } catch {
    return undefined;
  }
}

async function unchanged(path: string, was: string | undefined): Promise<boolean> {
  if (was === undefined) {
    return true;
  }
  try {
    return (await stampAt(path)) === was;
  } catch {
    return true;
  }
}

async function relocateAll(
  pairs: readonly Relocation[], valid: (pair: Relocation) => Promise<boolean>, onMoved?: (path: string) => void,
): Promise<Relocated> {
  const res: Relocated = { done: [], left: [], failure: undefined, changed: false, state: {} };
  for (const pair of pairs) {
    if (!(await valid(pair))) {
      res.left.push(pair);
      res.changed = true;
      continue;
    }
    let moved: EntryPathResponse;
    try {
      moved = await api.move(pair.from, pair.to);
    } catch (error) {
      res.left.push(pair);
      res.failure = error;
      continue;
    }
    onMoved?.(moved.path);
    res.done.push({ ...pair, to: moved.path });
    res.state = {
      unpublished: res.state.unpublished === true || moved.unpublished === true,
      history_degraded: res.state.history_degraded === true || moved.history_degraded === true,
    };
  }
  return res;
}

export function replaces(path: string, target: string): boolean {
  return target === path || target.startsWith(`${path}/`);
}

export function pathAfterMove(path: string, from: string, to: string): string | undefined {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}

export function foldersOf(done: readonly Relocation[]): Set<string> {
  return new Set(done.map((pair) => parentOf(pair.to)));
}

export class UndoMarks {
  private readonly marks = new Set<UndoMark>();

  touch(paths: readonly string[], keep?: UndoMark): void {
    for (const mark of this.marks) {
      if (mark !== keep && mark.targets.some((target) => paths.some((path) => replaces(path, target)))) {
        this.marks.delete(mark);
      }
    }
  }

  async move(pairs: readonly Relocation[], undone?: UndoMark): Promise<Relocated & { undo?: MoveUndo }> {
    const back = undone !== undefined;
    const mark: UndoMark = undone ?? { targets: [], stamps: new Map() };
    if (!back) {
      this.marks.add(mark);
    }
    const res = await relocateAll(
      pairs,
      async (pair) => !back || this.stillMarked(mark, pair),
      back ? undefined : (path) => {
        mark.targets.push(path);
        mark.stamps.set(path, stampOrUnknown(path));
      },
    );
    if (res.done.length === 0) {
      if (!back) {
        this.marks.delete(mark);
      }
      return res;
    }
    this.touch(res.done.flatMap((pair) => [pair.from, pair.to]), mark);
    return back ? res : { ...res, undo: new MoveUndo(this, mark, res.done) };
  }

  has(mark: UndoMark): boolean {
    return this.marks.has(mark);
  }

  forget(mark: UndoMark): void {
    this.marks.delete(mark);
  }

  private async stillMarked(mark: UndoMark, pair: Relocation): Promise<boolean> {
    if (!(await unchanged(pair.from, await mark.stamps.get(pair.from)))) {
      this.marks.delete(mark);
    }
    return this.marks.has(mark);
  }
}

export class MoveUndo {
  readonly mark: UndoMark;
  private readonly marks: UndoMarks;
  private pairs: Relocation[];
  private running = false;
  private closed = false;

  constructor(marks: UndoMarks, mark: UndoMark, done: readonly Relocation[]) {
    this.marks = marks;
    this.mark = mark;
    this.pairs = done.map((pair) => ({ ...pair, from: pair.to, to: pair.from })).reverse();
  }

  get stale(): boolean {
    return !this.marks.has(this.mark);
  }

  async run(moveBack: (pairs: readonly Relocation[]) => Promise<Relocation[]>): Promise<boolean> {
    this.running = true;
    this.pairs = await moveBack(this.pairs);
    this.running = false;
    this.mark.targets = this.pairs.map((pair) => pair.from);
    if (this.pairs.length === 0 || this.closed) {
      this.marks.forget(this.mark);
    }
    return this.pairs.length === 0;
  }

  close(): void {
    this.closed = true;
    if (!this.running) {
      this.marks.forget(this.mark);
    }
  }
}
