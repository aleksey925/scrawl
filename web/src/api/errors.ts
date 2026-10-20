import type { ApiErrorBody, HandoffKind } from './types';

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
// not a failure: the caller goes there. An attachment is the one kind whose
// url is a server route rather than one of the app's, so the caller is told
// which of the two it got.
export interface Handoff {
  kind: HandoffKind;
  url: string;
}

export function handoffOf(error: unknown): Handoff | undefined {
  if (error instanceof ApiError && error.status === 409 && error.url !== undefined && error.kind !== undefined) {
    return { kind: error.kind, url: error.url };
  }
  return undefined;
}
