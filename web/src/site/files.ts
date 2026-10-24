const markdown = /\.md$/i;
const folderIndex = 'index.md';
const folderPage = 'index.html';
const indexPage = 'index.md.html';

export function fileOf(pathname: string): string {
  if (pathname.startsWith('/raw/')) {
    return pathname.slice('/raw/'.length);
  }
  if (!pathname.startsWith('/doc/')) {
    return folderPage;
  }
  const rest = pathname.slice('/doc/'.length);
  if (rest === '' || rest.endsWith('/')) {
    return rest + folderPage;
  }
  const at = rest.lastIndexOf('/') + 1;
  if (rest.slice(at).toLowerCase() === folderIndex) {
    return rest.slice(0, at) + indexPage;
  }
  return rest.replace(markdown, '.html');
}

export function isFolderRoute(route: string): boolean {
  return route === '/' || route.endsWith('/');
}
