export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder.replace(/\/+$/, '')}/${name}`;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

// the folders that have to be open for a path to be on screen, the root included
export function ancestorsOf(path: string): string[] {
  const res = [''];
  let at = '';
  for (const part of path.split('/').filter((segment) => segment !== '')) {
    at = at === '' ? part : `${at}/${part}`;
    res.push(at);
  }
  return res;
}

export function contentPathOf(pathname: string): string {
  const match = /^\/(?:p|edit|history)\/(.*)$/.exec(pathname);
  return match === null ? '' : decodeURIComponent(match[1] ?? '');
}
