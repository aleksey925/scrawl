export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder.replace(/\/+$/, '')}/${name}`;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

export function basenameOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}

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
  const match = /^\/(?:doc|edit|history)\/(.*)$/.exec(pathname);
  return match === null ? '' : decodeURIComponent(match[1] ?? '').replace(/\/+$/, '');
}

export function folderFor(path: string, isDir: boolean): string {
  return isDir ? path : parentOf(path);
}

export function pageName(name: string, isDir: boolean): string {
  return isDir ? name : name.replace(/\.md$/i, '');
}

export function hasOwnExtension(name: string): boolean {
  return /^[^.].*\.[a-z][a-z0-9]{0,15}$/i.test(basenameOf(name.trim()));
}
