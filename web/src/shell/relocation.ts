import { api } from '../api/client';
import type { DirEntry, EntryPathResponse, MutationState } from '../api/types';

import { parentOf, replaces } from './naming';

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
  pairs: readonly Relocation[], valid: (step: Relocation) => Promise<boolean>, onMoved?: (path: string) => void,
): Promise<Relocated> {
  const res: Relocated = { done: [], left: [], failure: undefined, changed: false, state: {} };
  for (const step of pairs) {
    if (!(await valid(step))) {
      res.left.push(step);
      res.changed = true;
      continue;
    }
    let moved: EntryPathResponse;
    try {
      moved = await api.move(step.from, step.to);
    } catch (error) {
      res.left.push(step);
      res.failure = error;
      continue;
    }
    onMoved?.(moved.path);
    res.done.push({ ...step, to: moved.path });
    res.state = {
      unpublished: res.state.unpublished === true || moved.unpublished === true,
      history_degraded: res.state.history_degraded === true || moved.history_degraded === true,
    };
  }
  return res;
}

export function parentsOf(done: readonly Relocation[]): Set<string> {
  return new Set(done.map((step) => parentOf(step.to)));
}

export class UndoMarks {
  private readonly marks = new Set<UndoMark>();

  touch(paths: readonly string[], keep?: UndoMark): void {
    for (const held of this.marks) {
      if (held !== keep && held.targets.some((moved) => paths.some((touched) => replaces(touched, moved)))) {
        this.marks.delete(held);
      }
    }
  }

  async move(pairs: readonly Relocation[]): Promise<Relocated & { undo?: MoveUndo }> {
    const mark: UndoMark = { targets: [], stamps: new Map() };
    this.marks.add(mark);
    const res = await relocateAll(pairs, async () => true, (path) => {
      mark.targets.push(path);
      mark.stamps.set(path, stampOrUnknown(path));
    });
    if (res.done.length === 0) {
      this.marks.delete(mark);
      return res;
    }
    this.touch(res.done.flatMap((step) => [step.from, step.to]), mark);
    return { ...res, undo: new MoveUndo(this, mark, res.done) };
  }

  async moveBack(pairs: readonly Relocation[], mark: UndoMark): Promise<Relocated> {
    const res = await relocateAll(pairs, (step) => this.stillMarked(mark, step));
    if (res.done.length > 0) {
      this.touch(res.done.flatMap((step) => [step.from, step.to]), mark);
    }
    return res;
  }

  has(mark: UndoMark): boolean {
    return this.marks.has(mark);
  }

  forget(mark: UndoMark): void {
    this.marks.delete(mark);
  }

  private async stillMarked(mark: UndoMark, step: Relocation): Promise<boolean> {
    if (!(await unchanged(step.from, await mark.stamps.get(step.from)))) {
      this.marks.delete(mark);
    }
    return this.marks.has(mark);
  }
}

export class MoveUndo {
  private readonly marks: UndoMarks;
  private readonly mark: UndoMark;
  private pairs: Relocation[];
  private running = false;
  private closed = false;

  constructor(marks: UndoMarks, mark: UndoMark, done: readonly Relocation[]) {
    this.marks = marks;
    this.mark = mark;
    this.pairs = done.map((step) => ({ ...step, from: step.to, to: step.from })).reverse();
  }

  get stale(): boolean {
    return !this.marks.has(this.mark);
  }

  async run(report: (res: Relocated) => Promise<void>): Promise<boolean> {
    this.running = true;
    const res = await this.marks.moveBack(this.pairs, this.mark);
    await report(res);
    this.running = false;
    this.pairs = res.left;
    this.mark.targets = this.pairs.map((step) => step.from);
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
