import { ApiError } from '../api/client';
import type { ApiErrorBody } from '../api/types';
import { encodeContentPath } from '../paths';

// the writes and the single version read that ScrawlApi does not carry. They
// belong beside the rest of the client; they live here because api/ is owned
// elsewhere while this work is in flight.

export type EntryKind = 'file' | 'dir';

export interface HistoryVersion {
  path: string;
  rev: string;
  diff: string;
  content?: string;
}

export interface RestoreRequest {
  rev: string;
  version: string;
  from: string;
}

export type RestoreOutcome = { ok: true } | { ok: false; current: string };

interface ConflictBody {
  current_content?: string;
}

interface CallOptions {
  body?: unknown;
  signal?: AbortSignal;
  allowStatus?: readonly number[];
}

async function errorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (typeof body.error === 'string' && body.error !== '') {
      return { error: body.error, kind: body.kind, url: body.url };
    }
  } catch {
    // the throttle and any proxy in front answer in plain text, not the envelope
  }
  return { error: `request failed with status ${response.status}` };
}

async function call<T>(method: string, url: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal ?? null,
  });

  if (!response.ok && !(options.allowStatus?.includes(response.status) ?? false)) {
    throw new ApiError(response.status, await errorBody(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function fileUrl(path: string): string {
  return `/api/file/${encodeContentPath(path)}`;
}

export async function createEntry(path: string, kind: EntryKind): Promise<string> {
  const res = await call<{ path?: string }>('POST', fileUrl(path), { body: { type: kind } });
  return res.path ?? path;
}

export function deleteEntry(path: string): Promise<void> {
  return call<void>('DELETE', fileUrl(path));
}

export async function moveEntry(from: string, to: string): Promise<string> {
  const res = await call<{ path?: string }>('POST', '/api/move', { body: { from, to } });
  return res.path ?? to;
}

// the path is the historical one the entry carries, which is not today's once a
// rename sits between them
export function historyVersion(path: string, rev: string, signal?: AbortSignal): Promise<HistoryVersion> {
  const url = `/api/history/${encodeContentPath(path)}?rev=${encodeURIComponent(rev)}`;
  return call<HistoryVersion>('GET', url, { signal });
}

// a restore that collided is not a failure to report as one: the page has to
// show what stands on disk now, so 412 comes back as an outcome and not a throw
export async function restoreVersion(path: string, req: RestoreRequest): Promise<RestoreOutcome> {
  const url = `/api/history/restore/${encodeContentPath(path)}`;
  const res = await call<ConflictBody>('POST', url, { body: req, allowStatus: [412] });
  return res.current_content === undefined ? { ok: true } : { ok: false, current: res.current_content };
}
