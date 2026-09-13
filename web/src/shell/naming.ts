// the table store/upload.go uses for attachment names, letter for letter: a
// page and the image beside it must not romanize the same word two ways
const translit: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya',
};

export function slugify(title: string): string {
  let out = '';
  for (const letter of title.toLowerCase()) {
    out += translit[letter] ?? letter;
  }
  return out
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// a name may carry nesting of its own, which is how a page reaches a folder
// that does not exist yet: the store creates the missing parents
export function slugPath(name: string): string {
  return name
    .split('/')
    .map(slugify)
    .filter((part) => part !== '')
    .join('/');
}

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
