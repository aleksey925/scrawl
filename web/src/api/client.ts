import { mountBase } from '../mount';
import { encodeContentPath } from '../paths';
import { togglesOf } from '../reader/findMatches';

import { ApiError } from './errors';
import type {
  ApiErrorBody,
  DirListing,
  Divergence,
  EntryKind,
  EntryPathResponse,
  ExportFormat,
  FileResponse,
  HistoryResponse,
  HistoryVersionResponse,
  MeResponse,
  MutationState,
  NavResponse,
  PageResponse,
  PreviewRequest,
  PreviewResponse,
  ResetRequest,
  ResetResponse,
  RestoreRequest,
  RestoreResponse,
  SaveFileRequest,
  SaveFileResponse,
  SearchResponse,
  SearchSettings,
  SpaceEntry,
  TreeResponse,
  UploadResponse,
} from './types';

export type UnauthorizedHandler = () => void;

export type UnauthorizedScope = 'shell' | 'screen';

const unauthorizedHandlers = new Map<UnauthorizedScope, UnauthorizedHandler>();

export function installUnauthorizedHandler(
  scope: UnauthorizedScope,
  handler: UnauthorizedHandler,
): () => void {
  unauthorizedHandlers.set(scope, handler);
  return () => {
    if (unauthorizedHandlers.get(scope) === handler) {
      unauthorizedHandlers.delete(scope);
    }
  };
}

function notifyUnauthorized(): void {
  const handler = unauthorizedHandlers.get('screen') ?? unauthorizedHandlers.get('shell');
  handler?.();
}

export interface RequestOptions {
  signal?: AbortSignal;
  background?: boolean;
}

interface CallOptions extends RequestOptions {
  body?: unknown;
  form?: FormData;
  allowStatus?: readonly number[];
}

const backgroundHeader = 'X-Scrawl-Background';

function spaceUrl(path: string): string {
  return mountBase() + path;
}

function globalUrl(path: string): string {
  return path;
}

type QueryValue = string | number | undefined;

function withQuery(url: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(name, String(value));
    }
  }
  const search = params.toString();
  return search === '' ? url : `${url}?${search}`;
}

function searchParams(settings: SearchSettings): Record<string, string | undefined> {
  return {
    mode: settings.mode,
    case: settings.matchCase ? '1' : undefined,
    word: settings.word ? '1' : undefined,
    regex: settings.regex ? '1' : undefined,
    titles: settings.titles ? '1' : undefined,
  };
}

export function settingsOfSearch(params: URLSearchParams): SearchSettings {
  return {
    mode: params.get('mode') === 'exact' ? 'exact' : 'fuzzy',
    ...togglesOf(params),
    titles: params.get('titles') === '1',
  };
}

export function searchTextOf(text: string, settings: SearchSettings): string {
  return settings.mode === 'fuzzy' && !settings.regex ? text.trim() : text;
}

async function errorBody(response: Response): Promise<ApiErrorBody> {
  const fallback = `request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return { ...body, error: body.error !== undefined && body.error !== '' ? body.error : fallback };
  } catch {
    return { error: fallback };
  }
}

async function send(method: string, url: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.background === true) {
    headers[backgroundHeader] = '1';
  }
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
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

  if (response.status === 401 && options.background !== true) {
    notifyUnauthorized();
  }
  const allowed = options.allowStatus?.includes(response.status) ?? false;
  if (!response.ok && !allowed) {
    throw new ApiError(response.status, await errorBody(response));
  }
  return response;
}

async function call<T>(method: string, url: string, options: CallOptions = {}): Promise<T> {
  const response = await send(method, url, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function isPage(body: PageResponse | ApiErrorBody): body is PageResponse {
  return body.kind === 'document' || body.kind === 'missing-document' || body.kind === 'file';
}

function fileUrl(path: string): string {
  return spaceUrl(`/api/file/${encodeContentPath(path)}`);
}

function historyUrl(path: string): string {
  return spaceUrl(`/api/history/${encodeContentPath(path)}`);
}

export type RestoreOutcome = { ok: true; state: MutationState } | { ok: false; current: string };

export interface ScrawlApi {
  page(path: string, options?: RequestOptions): Promise<PageResponse>;
  dir(path: string, options?: RequestOptions): Promise<DirListing>;
  nav(path: string, options?: RequestOptions): Promise<NavResponse>;
  me(options?: RequestOptions): Promise<MeResponse>;
  spaces(options?: RequestOptions): Promise<SpaceEntry[]>;
  tree(options?: RequestOptions): Promise<TreeResponse>;
  file(path: string, options?: RequestOptions): Promise<FileResponse>;
  saveFile(path: string, body: SaveFileRequest, options?: RequestOptions): Promise<SaveFileResponse>;
  createEntry(path: string, kind: EntryKind, options?: RequestOptions): Promise<EntryPathResponse>;
  deleteEntry(path: string, withContents: boolean, options?: RequestOptions): Promise<EntryPathResponse>;
  move(from: string, to: string, options?: RequestOptions): Promise<EntryPathResponse>;
  find(query: string, settings: SearchSettings, limit?: number, options?: RequestOptions): Promise<SearchResponse>;
  history(path: string, options?: RequestOptions): Promise<HistoryResponse>;
  historyVersion(path: string, rev: string, options?: RequestOptions): Promise<HistoryVersionResponse>;
  restoreVersion(path: string, body: RestoreRequest, options?: RequestOptions): Promise<RestoreOutcome>;
  preview(body: PreviewRequest, options?: RequestOptions): Promise<PreviewResponse>;
  upload(dir: string, file: File, doc?: string, options?: RequestOptions): Promise<UploadResponse>;
  syncCheck(options?: RequestOptions): Promise<Divergence>;
  syncReset(body: ResetRequest, options?: RequestOptions): Promise<ResetResponse>;
  exportNote(path: string, format: ExportFormat, options?: RequestOptions): Promise<Blob>;
  logout(options?: RequestOptions): Promise<void>;
}

export const api: ScrawlApi = {
  page: async (path, options) => {
    const body = await call<PageResponse | ApiErrorBody>(
      'GET',
      spaceUrl(`/api/page/${encodeContentPath(path)}`),
      { ...options, allowStatus: [404] },
    );
    if (!isPage(body)) {
      throw new ApiError(404, body);
    }
    return body;
  },

  dir: (path, options) =>
    call<DirListing>('GET', spaceUrl(`/api/dir/${encodeContentPath(path)}`), options),

  nav: (path, options) => call<NavResponse>('GET', withQuery(spaceUrl('/api/nav'), { path }), options),

  me: (options) => call<MeResponse>('GET', spaceUrl('/api/me'), options),

  spaces: (options) => call<SpaceEntry[]>('GET', globalUrl('/api/spaces'), options),

  tree: (options) => call<TreeResponse>('GET', spaceUrl('/api/tree'), options),

  file: (path, options) => call<FileResponse>('GET', fileUrl(path), options),

  saveFile: (path, body, options) => call<SaveFileResponse>('PUT', fileUrl(path), { ...options, body }),

  createEntry: (path, kind, options) =>
    call<EntryPathResponse>('POST', fileUrl(path), { ...options, body: { type: kind } }),

  deleteEntry: (path, withContents, options) =>
    call<EntryPathResponse>(
      'DELETE',
      withQuery(fileUrl(path), { recursive: withContents ? 'true' : undefined }),
      options,
    ),

  move: (from, to, options) =>
    call<EntryPathResponse>('POST', spaceUrl('/api/move'), { ...options, body: { from, to } }),

  find: (query, settings, limit, options) =>
    call<SearchResponse>('GET', withQuery(spaceUrl('/api/search'), { q: query, limit, ...searchParams(settings) }), options),

  history: (path, options) => call<HistoryResponse>('GET', historyUrl(path), options),

  historyVersion: (path, rev, options) =>
    call<HistoryVersionResponse>('GET', withQuery(historyUrl(path), { rev }), options),

  restoreVersion: async (path, body, options) => {
    const res = await call<RestoreResponse | ApiErrorBody>(
      'POST',
      spaceUrl(`/api/history/restore/${encodeContentPath(path)}`),
      { ...options, body, allowStatus: [412] },
    );
    return 'current_content' in res && res.current_content !== undefined
      ? { ok: false, current: res.current_content }
      : { ok: true, state: res as MutationState };
  },

  preview: (body, options) =>
    call<PreviewResponse>('POST', spaceUrl('/api/preview'), { ...options, body }),

  upload: (dir, file, doc, options) => {
    const form = new FormData();
    form.set('file', file);
    const url = withQuery(spaceUrl(`/api/upload/${encodeContentPath(dir)}`), { doc });
    return call<UploadResponse>('POST', url, { ...options, form });
  },

  syncCheck: (options) => call<Divergence>('POST', spaceUrl('/api/sync/check'), options),

  syncReset: (body, options) =>
    call<ResetResponse>('POST', spaceUrl('/api/sync/reset'), { ...options, body }),

  exportNote: async (path, format, options) => {
    const url = withQuery(spaceUrl(`/api/export/${encodeContentPath(path)}`), { format });
    return (await send('GET', url, options)).blob();
  },

  logout: (options) => call<void>('POST', globalUrl('/api/logout'), options),
};
