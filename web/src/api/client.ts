import { encodeContentPath } from '../paths';

import type {
  ApiErrorBody,
  DirResponse,
  EntryKind,
  EntryPathResponse,
  FileResponse,
  HandoffKind,
  HistoryResponse,
  HistoryVersionResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  NavResponse,
  PageResponse,
  PreviewRequest,
  PreviewResponse,
  RestoreRequest,
  RestoreResponse,
  SaveFileRequest,
  SaveFileResponse,
  SearchResponse,
  TreeResponse,
  UploadResponse,
} from './types';

export interface ApiConflict {
  rev: string;
  content: string;
}

function conflictOf(body: ApiErrorBody): ApiConflict | undefined {
  const { current_rev: rev, current_content: content } = body;
  if (typeof rev !== 'string' || typeof content !== 'string') {
    return undefined;
  }
  return { rev, content };
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: HandoffKind | undefined;
  readonly url: string | undefined;
  readonly conflict: ApiConflict | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = 'ApiError';
    this.status = status;
    this.kind = body.kind;
    this.url = body.url;
    this.conflict = conflictOf(body);
  }
}

// a 409 that names a url is the server handing the path over to another view,
// not a failure: the caller navigates there
export function handoffUrl(error: unknown): string | undefined {
  if (error instanceof ApiError && error.status === 409 && error.url !== undefined) {
    return error.url;
  }
  return undefined;
}

export type UnauthorizedHandler = () => void;

// React runs a child's effect before its parent's, so a screen cannot take the
// handler over by registering last: a screen handler wins over the shell's
// whenever one is installed.
export type UnauthorizedScope = 'shell' | 'screen';

const unauthorizedHandlers = new Map<UnauthorizedScope, UnauthorizedHandler>();

export function installUnauthorizedHandler(
  scope: UnauthorizedScope,
  handler: UnauthorizedHandler,
): () => void {
  unauthorizedHandlers.set(scope, handler);
  return () => {
    // a remount installs the next handler before this one is disposed of, and
    // deleting the entry blindly would leave the scope with none
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
}

interface CallOptions extends RequestOptions {
  body?: unknown;
  form?: FormData;
  allowStatus?: readonly number[];
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

async function errorBody(response: Response): Promise<ApiErrorBody> {
  const fallback = `request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return { ...body, error: body.error !== undefined && body.error !== '' ? body.error : fallback };
  } catch {
    // the throttle and any proxy in front answer in plain text, not the envelope
    return { error: fallback };
  }
}

async function call<T>(method: string, url: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // the server checks Sec-Fetch-Site instead of a csrf token, so a mutating
  // request only has to stay same-origin and carry the session cookie
  const response = await fetch(url, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal ?? null,
  });

  if (response.status === 401) {
    notifyUnauthorized();
  }
  const allowed = options.allowStatus?.includes(response.status) ?? false;
  if (!response.ok && !allowed) {
    throw new ApiError(response.status, await errorBody(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function isPage(body: PageResponse | ApiErrorBody): body is PageResponse {
  return body.kind === 'document' || body.kind === 'missing-document';
}

function fileUrl(path: string): string {
  return `/api/file/${encodeContentPath(path)}`;
}

function historyUrl(path: string): string {
  return `/api/history/${encodeContentPath(path)}`;
}

export type RestoreOutcome = { ok: true } | { ok: false; current: string };

export interface ScrawlApi {
  page(path: string, options?: RequestOptions): Promise<PageResponse>;
  dir(path: string, options?: RequestOptions): Promise<DirResponse>;
  nav(path: string, options?: RequestOptions): Promise<NavResponse>;
  me(options?: RequestOptions): Promise<MeResponse>;
  tree(options?: RequestOptions): Promise<TreeResponse>;
  file(path: string, options?: RequestOptions): Promise<FileResponse>;
  saveFile(path: string, body: SaveFileRequest, options?: RequestOptions): Promise<SaveFileResponse>;
  createEntry(path: string, kind: EntryKind, options?: RequestOptions): Promise<string>;
  deleteEntry(path: string, options?: RequestOptions): Promise<void>;
  move(from: string, to: string, options?: RequestOptions): Promise<string>;
  search(query: string, limit?: number, options?: RequestOptions): Promise<SearchResponse>;
  history(path: string, options?: RequestOptions): Promise<HistoryResponse>;
  historyVersion(path: string, rev: string, options?: RequestOptions): Promise<HistoryVersionResponse>;
  restoreVersion(path: string, body: RestoreRequest, options?: RequestOptions): Promise<RestoreOutcome>;
  preview(body: PreviewRequest, options?: RequestOptions): Promise<PreviewResponse>;
  upload(dir: string, file: File, doc?: string, options?: RequestOptions): Promise<UploadResponse>;
  login(body: LoginRequest, options?: RequestOptions): Promise<LoginResponse>;
  logout(options?: RequestOptions): Promise<void>;
}

export const api: ScrawlApi = {
  // a missing document answers 404 with the page shape, which the document view
  // renders as an offer to create it. The browser revalidates it by ETag.
  page: async (path, options) => {
    const body = await call<PageResponse | ApiErrorBody>('GET', `/api/page/${encodeContentPath(path)}`, {
      ...options,
      allowStatus: [404],
    });
    if (!isPage(body)) {
      throw new ApiError(404, body);
    }
    return body;
  },

  dir: (path, options) => call<DirResponse>('GET', `/api/dir/${encodeContentPath(path)}`, options),

  nav: (path, options) => call<NavResponse>('GET', withQuery('/api/nav', { path }), options),

  me: (options) => call<MeResponse>('GET', '/api/me', options),

  tree: (options) => call<TreeResponse>('GET', '/api/tree', options),

  file: (path, options) => call<FileResponse>('GET', fileUrl(path), options),

  saveFile: (path, body, options) => call<SaveFileResponse>('PUT', fileUrl(path), { ...options, body }),

  createEntry: async (path, kind, options) => {
    const res = await call<EntryPathResponse>('POST', fileUrl(path), {
      ...options,
      body: { type: kind },
    });
    return res.path;
  },

  deleteEntry: (path, options) => call<void>('DELETE', fileUrl(path), options),

  move: async (from, to, options) => {
    const res = await call<EntryPathResponse>('POST', '/api/move', { ...options, body: { from, to } });
    return res.path;
  },

  search: (query, limit, options) =>
    call<SearchResponse>('GET', withQuery('/api/search', { q: query, limit }), options),

  history: (path, options) => call<HistoryResponse>('GET', historyUrl(path), options),

  historyVersion: (path, rev, options) =>
    call<HistoryVersionResponse>('GET', withQuery(historyUrl(path), { rev }), options),

  // a restore that collided is not a failure to report as one: the page has to
  // show what stands on disk now, so 412 comes back as an outcome and not a throw
  restoreVersion: async (path, body, options) => {
    const res = await call<RestoreResponse | ApiErrorBody>(
      'POST',
      `/api/history/restore/${encodeContentPath(path)}`,
      { ...options, body, allowStatus: [412] },
    );
    return 'current_content' in res && res.current_content !== undefined
      ? { ok: false, current: res.current_content }
      : { ok: true };
  },

  preview: (body, options) => call<PreviewResponse>('POST', '/api/preview', { ...options, body }),

  upload: (dir, file, doc, options) => {
    const form = new FormData();
    form.set('file', file);
    return call<UploadResponse>('POST', withQuery(`/api/upload/${encodeContentPath(dir)}`, { doc }), {
      ...options,
      form,
    });
  },

  login: (body, options) => call<LoginResponse>('POST', '/api/login', { ...options, body }),

  logout: (options) => call<void>('POST', '/api/logout', options),
};
