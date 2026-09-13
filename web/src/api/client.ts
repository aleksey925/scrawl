import { encodeContentPath } from '../paths';

import type {
  ApiErrorBody,
  DirResponse,
  FileResponse,
  HandoffKind,
  HistoryResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  NavResponse,
  PageResponse,
  PreviewRequest,
  PreviewResponse,
  SaveFileRequest,
  SaveFileResponse,
  SearchResponse,
  TreeResponse,
  UploadResponse,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly kind: HandoffKind | undefined;
  readonly url: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = 'ApiError';
    this.status = status;
    this.kind = body.kind;
    this.url = body.url;
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

let unauthorizedHandler: UnauthorizedHandler | undefined;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
  unauthorizedHandler = handler;
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
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (typeof body.error === 'string' && body.error !== '') {
      return { error: body.error, kind: body.kind, url: body.url };
    }
    return { error: `request failed with status ${response.status}`, kind: body.kind, url: body.url };
  } catch {
    // the throttle and any proxy in front answer in plain text, not the envelope
    return { error: `request failed with status ${response.status}` };
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
    unauthorizedHandler?.();
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

export interface ScrawlApi {
  page(path: string, options?: RequestOptions): Promise<PageResponse>;
  dir(path: string, options?: RequestOptions): Promise<DirResponse>;
  nav(path: string, options?: RequestOptions): Promise<NavResponse>;
  me(options?: RequestOptions): Promise<MeResponse>;
  tree(options?: RequestOptions): Promise<TreeResponse>;
  file(path: string, options?: RequestOptions): Promise<FileResponse>;
  saveFile(path: string, body: SaveFileRequest, options?: RequestOptions): Promise<SaveFileResponse>;
  search(query: string, limit?: number, options?: RequestOptions): Promise<SearchResponse>;
  history(path: string, options?: RequestOptions): Promise<HistoryResponse>;
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

  file: (path, options) => call<FileResponse>('GET', `/api/file/${encodeContentPath(path)}`, options),

  saveFile: (path, body, options) =>
    call<SaveFileResponse>('PUT', `/api/file/${encodeContentPath(path)}`, { ...options, body }),

  search: (query, limit, options) =>
    call<SearchResponse>('GET', withQuery('/api/search', { q: query, limit }), options),

  history: (path, options) =>
    call<HistoryResponse>('GET', `/api/history/${encodeContentPath(path)}`, options),

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
