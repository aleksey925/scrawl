export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder.replace(/\/+$/, '')}/${name}`;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

// the last segment, which is what a path keeps when it moves to another folder
export function basenameOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
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

// the pathname react-router hands over has the project basename stripped off
// already, so this reads the route words and nothing else.
//
// A directory is addressed with a trailing slash and the same folder is one
// path in the tree, in the store and in the unsynced set, so it comes off here:
// every caller compares this against one of those.
export function contentPathOf(pathname: string): string {
  const match = /^\/(?:doc|edit|history)\/(.*)$/.exec(pathname);
  return match === null ? '' : decodeURIComponent(match[1] ?? '').replace(/\/+$/, '');
}
