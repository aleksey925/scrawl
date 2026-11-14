export function rangeOf(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') {
    return undefined;
  }
  if (from === '') {
    return { start: Math.max(size - Number(to), 0), end: size - 1 };
  }
  return { start: Number(from), end: to === '' ? size - 1 : Math.min(Number(to), size - 1) };
}

export async function rangeAnswer(request: Request, stored: Response): Promise<Response> {
  const header = request.headers.get('range');
  if (header === null) {
    return stored;
  }
  const body = await stored.blob();
  const range = rangeOf(header, body.size);
  if (range === undefined) {
    return new Response(body, { status: stored.status, headers: stored.headers });
  }
  if (range.start >= body.size || range.start > range.end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.size}` } });
  }
  const headers = new Headers(stored.headers);
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${body.size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return new Response(body.slice(range.start, range.end + 1), { status: 206, headers });
}
