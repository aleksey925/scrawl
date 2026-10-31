export interface Crumb {
  name: string;
  url: string;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export type HandoffKind = 'document' | 'directory';

export interface HandoffBody {
  error?: string;
  kind: HandoffKind;
  url: string;
}

export interface ApiErrorBody {
  error: string;
  kind?: HandoffKind;
  url?: string;
  current_rev?: string;
  current_content?: string;
}

export interface DocumentFields {
  path: string;
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

export interface FilePageResponse {
  path: string;
  kind: 'file';
  name: string;
  type: 'image' | 'text' | 'other';
  size: number;
  mod_time: string;
  breadcrumbs: Crumb[];
  raw_url: string;
  rev?: string;
  edit_url?: string;
  language?: string;
  lines?: number;
  html?: string;
}

export type PageResponse = DocumentResponse | MissingDocumentResponse | FilePageResponse;

export interface DirEntry {
  name: string;
  path: string;
  url: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  folder_page?: boolean;
  items?: number;
  edit_url?: string;
}

export interface DirListing {
  path: string;
  kind: 'directory';
  title: string;
  entries: DirEntry[];
  breadcrumbs: Crumb[];
}

export interface NavNode {
  name: string;
  path: string;
  url: string;
  is_dir: boolean;
  active: boolean;
  current: boolean;
  folder_page?: boolean;
  children: NavNode[];
}

export interface NavResponse {
  tree: NavNode[];
  breadcrumbs: Crumb[];
}

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
  space: SpaceState;
}

export interface SpaceState {
  name: string;
  label: string;
  kind: SpaceKind;
  read_only: boolean;
  format_on_save: boolean;
  degraded: boolean;
  unpublished: boolean;
  sync_error: string;
  unsynced: Unsynced;
  diverged: boolean;
  can_reset: boolean;
  push_refused: boolean;
}

export interface Divergence {
  head: string;
  remote: string;
  clean: boolean;
  lost: Unsynced;
  can_push_backup: boolean;
}

export interface ResetRequest {
  head: string;
  remote: string;
  push_backup: boolean;
}

export interface ResetResponse {
  backup: string;
  backup_pushed: boolean;
}

export interface Unsynced {
  paths: string[];
  many: boolean;
}

export type SpaceKind = 'local' | 'remote';

export interface SpaceEntry {
  name: string;
  label: string;
  url: string;
  kind: SpaceKind;
  read_only: boolean;
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
  formatted?: boolean;
}

export interface MutationState {
  history_degraded?: boolean;
  unpublished?: boolean;
}

export interface SaveFileResponse extends MutationState {
  rev: string;
  mod_time: string;
  content?: string;
  format_failed?: boolean;
}


export type EntryKind = 'file' | 'dir';

export type ExportFormat = 'md' | 'html';

export interface EntryPathResponse extends MutationState {
  path: string;
  edit_url?: string;
}

export interface SearchSpan {
  text: string;
  hit: boolean;
}

export interface SearchLine {
  line: number;
  url: string;
  spans: SearchSpan[];
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
  url: string;
  title_spans?: SearchSpan[];
  match_count?: number;
  line_count?: number;
  lines?: SearchLine[];
}

export interface SearchResponse {
  hits: SearchHit[];
  elapsed_ms: number;
  truncated?: boolean;
}

export type SearchMode = 'fuzzy' | 'exact';

export interface SearchSettings {
  mode: SearchMode;
  matchCase: boolean;
  word: boolean;
  regex: boolean;
  titles: boolean;
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
  restorable: boolean;
}

export interface HistoryResponse {
  path: string;
  degraded: boolean;
  entries: HistoryEntry[];
}

export interface DiffSide {
  html: string;
  start?: number;
  end?: number;
}

export type DiffKind = 'same' | 'format' | 'changed' | 'added' | 'removed';

export interface DiffRow {
  kind: DiffKind;
  old?: DiffSide;
  new?: DiffSide;
  inline?: DiffSide;
}

export interface HistoryVersionResponse {
  path: string;
  rev: string;
  diff: string;
  changes?: DiffRow[];
  content?: string;
}

export interface RestoreRequest {
  rev: string;
  version: string;
  from: string;
}

export interface RestoreResponse extends MutationState {
  path: string;
  rev: string;
  mod_time: string;
}

export interface PreviewRequest {
  content: string;
  path: string;
}

export interface PreviewResponse {
  html: string;
}

export interface UploadResponse extends MutationState {
  path: string;
  markdown: string;
}
