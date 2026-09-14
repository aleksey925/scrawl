export interface Crumb {
  name: string;
  url: string;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

// the server answers a path it cannot serve with a 409 that names where the
// content actually lives, so the client follows the url instead of failing
export type HandoffKind = 'document' | 'directory' | 'attachment';

export interface HandoffBody {
  error?: string;
  kind: HandoffKind;
  url: string;
}

export interface ApiErrorBody {
  error: string;
  kind?: HandoffKind;
  url?: string;
  // a write that collided answers 412 or 409 with the file as it stands on
  // disk, so the caller settles it without reading the file back
  current_rev?: string;
  current_content?: string;
}

export interface DocumentFields {
  path: string;
  // the file this was rendered from. It differs from path when a directory is
  // served as its index.md, and it is what history is asked about: the
  // directory has no version of its own.
  doc_path: string;
  title: string;
  html: string;
  toc: Heading[];
  show_toc: boolean;
  rev: string;
  mod_time: string;
  breadcrumbs: Crumb[];
  edit_url: string;
  missing: boolean;
  can_create: boolean;
}

export interface DocumentResponse extends DocumentFields {
  kind: 'document';
}

export interface MissingDocumentResponse extends DocumentFields {
  kind: 'missing-document';
}

export type PageResponse = DocumentResponse | MissingDocumentResponse;

export interface DirEntry {
  name: string;
  path: string;
  url: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
}

export interface DirListing {
  path: string;
  kind: 'directory';
  title: string;
  entries: DirEntry[];
  readme_html: string;
  has_readme: boolean;
  breadcrumbs: Crumb[];
}

// a directory holding an index.md is served as that document under the
// directory's own path, so one route answers in two shapes
export type DirResponse = DirListing | DocumentResponse;

export interface NavNode {
  name: string;
  path: string;
  url: string;
  is_dir: boolean;
  active: boolean;
  current: boolean;
  children: NavNode[];
}

export interface NavResponse {
  tree: NavNode[];
  breadcrumbs: Crumb[];
}

// /api/tree answers api token clients and carries its own shape; the sidebar
// is built from /api/nav
export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[];
}

export interface TreeResponse {
  tree: TreeNode[];
}

export interface MeResponse {
  user: string;
  auth_on: boolean;
  read_only: boolean;
  history_on: boolean;
  history_degraded: boolean;
  site_title: string;
  version: string;
}

export interface FileResponse {
  path: string;
  content: string;
  rev: string;
  size: number;
  mod_time: string;
}

export interface SaveFileRequest {
  content: string;
  rev: string;
}

export interface SaveFileResponse {
  rev: string;
  mod_time: string;
  history_recorded?: boolean;
}

export type EntryKind = 'file' | 'dir';

export interface EntryPathResponse {
  path: string;
  history_degraded?: boolean;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
  url: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  elapsed_ms: number;
}

export interface HistoryEntry {
  rev: string;
  short: string;
  blob: string;
  actor: string;
  message: string;
  path: string;
  kind: string;
  at: string;
}

export interface HistoryResponse {
  path: string;
  // a commit the server could not record leaves this list behind the document
  degraded: boolean;
  entries: HistoryEntry[];
}

export interface HistoryVersionResponse {
  path: string;
  rev: string;
  diff: string;
  // absent for a deletion, which recorded none, and for a version too large to
  // escape into a json string
  content?: string;
}

// Version is the commit that recorded the content and From the path the
// document had at it, which is not today's once a rename sits between them. Rev
// is the revision on disk the page was built from.
export interface RestoreRequest {
  rev: string;
  version: string;
  from: string;
}

export interface RestoreResponse {
  path: string;
  rev: string;
  mod_time: string;
  history_degraded?: boolean;
}

export interface PreviewRequest {
  content: string;
  path: string;
}

export interface PreviewResponse {
  html: string;
}

export interface UploadResponse {
  path: string;
  markdown: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: string;
}
