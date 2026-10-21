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
  // a write that collided answers 412 or 409 with the file as it stands on
  // disk, so the caller settles it without reading the file back
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

// FilePageResponse is the page of a file that is not a note. It is not
// FileResponse, which is the source the editor loads.
export interface FilePageResponse {
  path: string;
  kind: 'file';
  name: string;
  type: 'image' | 'text' | 'other';
  size: number;
  mod_time: string;
  breadcrumbs: Crumb[];
  // a physical url, fetched by the browser itself
  raw_url: string;
  rev?: string;
  edit_url?: string;
  language?: string;
  lines?: number;
  // one pre with one element per line, highlighted or plain
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
  // the folder's own note, its index.md
  folder_page?: boolean;
  // how many entries a folder shows one level down, left out when none
  items?: number;
  // where the file is edited, left out of one the editor cannot open
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
  // the folder's own note, its index.md
  folder_page?: boolean;
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
  // the effective mode of the space on screen: the server-wide guard or the
  // space's own, whichever refuses first
  read_only: boolean;
  history_on: boolean;
  history_degraded: boolean;
  site_title: string;
  version: string;
  space: SpaceState;
}

// SpaceState is the space the app runs under and what is true of it now.
export interface SpaceState {
  name: string;
  label: string;
  kind: SpaceKind;
  read_only: boolean;
  format_on_save: boolean;
  degraded: boolean;
  unpublished: boolean;
  // already redacted by the server, so it is safe to render
  sync_error: string;
  unsynced: Unsynced;
  // measured by the server, never read off sync_error: a merge fails for other
  // reasons too, and only this offers a reset
  diverged: boolean;
  // whether this reader is one the reset routes accept
  can_reset: boolean;
  // the remote turned the push away for want of a credential that may write,
  // which no retry fixes
  push_refused: boolean;
}

// Divergence is what a reset to the remote version would lose. clean can be
// false with nothing in lost: the paths are hidden, or the check did not finish.
export interface Divergence {
  // sent back with the reset untouched, so it acts on this state or not at all
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
  // the branch that keeps what this copy held, empty when nothing was lost
  backup: string;
  backup_pushed: boolean;
}

// Unsynced is which notes the remote is missing. It rides on /api/me and on
// nothing else, so one poll refreshes every badge in the app; paths is empty
// and many is true above the server's cap, where a per-file badge stops
// answering the reader's question.
export interface Unsynced {
  paths: string[];
  many: boolean;
}

export type SpaceKind = 'local' | 'remote';

// SpaceEntry is one row of the switcher: configured facts only, so the list
// is the same for every reader and needs no refresh.
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
  // the editor ran prettier over content itself, so the server does not
  formatted?: boolean;
}

// MutationState is what every change that reached the disk says about where
// else it got to. Two failures with two fixes: history_degraded is a commit
// that failed, so the change is on disk and not in git; unpublished is a commit
// the remote does not have.
export interface MutationState {
  history_degraded?: boolean;
  unpublished?: boolean;
}

export interface SaveFileResponse extends MutationState {
  rev: string;
  mod_time: string;
  // only when the server formatted the note into something else than was sent
  content?: string;
  // prettier gave up on the note, which was stored as it was written
  format_failed?: boolean;
}


export type EntryKind = 'file' | 'dir';

// the formats the server exports a note in; a PDF is printed in the browser
export type ExportFormat = 'md' | 'html';

export interface EntryPathResponse extends MutationState {
  path: string;
  // edit_url is where a created file is edited, left out of one the editor cannot open
  edit_url?: string;
}

export interface SearchSpan {
  text: string;
  hit: boolean;
}

// SearchLine is a line of a note that matched, by its line in the source, with
// the url that opens the note at it
export interface SearchLine {
  line: number;
  url: string;
  spans: SearchSpan[];
}

export interface SearchHit {
  path: string;
  title: string;
  // escaped html with the matches marked
  snippet: string;
  score: number;
  // opens the note; with a mode named, with its find bar filled in
  url: string;
  // these come with a request that names a mode or a toggle
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

// SearchSettings are the mode and the toggles of a search of the space
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
  // restorable is the server's word that writing the version back changes the
  // note: it holds content, and not the content the file has now
  restorable: boolean;
}

export interface HistoryResponse {
  path: string;
  // a commit the server could not record leaves this list behind the document
  degraded: boolean;
  entries: HistoryEntry[];
}

// one block of a rendered diff as htmldiff answers it: the html with the changed
// words marked, and the source lines it was rendered from
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
  // a changed block once, its lost words and its new ones both marked; absent
  // when the pair was too long to compare word by word
  inline?: DiffSide;
}

export interface HistoryVersionResponse {
  path: string;
  rev: string;
  diff: string;
  // absent when either side could not be rendered, too large or too slow
  changes?: DiffRow[];
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
