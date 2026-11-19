import { isMarkdown, slugify, slugPath, withoutMarkdownExtension } from '../paths';

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

export function hasOwnExtension(name: string): boolean {
  return /^[^.].*\.[a-z][a-z0-9]{0,15}$/i.test(basenameOf(name.trim()));
}

export function renamedPath(path: string, name: string): string {
  const current = basenameOf(path);
  const typed = name.trim();
  if (name === current || typed === current) {
    return path;
  }
  return joinPath(parentOf(path), typed);
}

export function caretOf(name: string, isDir: boolean): number {
  const dot = name.lastIndexOf('.');
  return isDir || dot <= 0 ? name.length : dot;
}

export function nameProblem(name: string): string | undefined {
  if (name.includes('/')) {
    return 'A name cannot hold a slash, use Move to instead';
  }
  return name.trim().startsWith('.') ? 'A name cannot start with a dot' : undefined;
}

export function newFilePath(folder: string, name: string): string {
  if (hasOwnExtension(name) && !isMarkdown(name.trim())) {
    return joinPath(folder, name.trim());
  }
  const slug = slugPath(name);
  if (slug === '') {
    return '';
  }
  return joinPath(folder, isMarkdown(slug) ? slug : `${slug}.md`);
}

export function noteNameOf(text: string): string {
  const line = text.split('\n').find((row) => row.trim() !== '') ?? '';
  const slug = slugify(withoutMarkdownExtension(line.replace(/^\s*#+\s*/, '').trim())).toLowerCase();
  return `${slug === '' ? 'untitled' : slug}.md`;
}

export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let at = 2; ; at += 1) {
    const next = `${stem}-${at}${ext}`;
    if (!taken.has(next.toLowerCase())) {
      return next;
    }
  }
}

export function replaces(path: string, target: string): boolean {
  return target === path || target.startsWith(`${path}/`);
}

export function pathAfterMove(path: string, from: string, to: string): string | undefined {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}
