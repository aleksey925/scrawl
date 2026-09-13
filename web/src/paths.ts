export function encodeContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

export function displayName(name: string): string {
  return isMarkdown(name) ? name.slice(0, -'.md'.length) : name;
}

export function documentUrl(path: string): string {
  return isMarkdown(path) ? `/p/${encodeContentPath(path)}` : `/raw/${encodeContentPath(path)}`;
}

export function directoryUrl(path: string): string {
  return path === '' ? '/' : `/p/${encodeContentPath(path)}/`;
}

export function editUrl(path: string): string {
  return `/edit/${encodeContentPath(path)}`;
}

export function historyUrl(path: string): string {
  return `/history/${encodeContentPath(path)}`;
}

export function isDirectoryPath(path: string): boolean {
  return path === '' || path.endsWith('/');
}

export function trimTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}
