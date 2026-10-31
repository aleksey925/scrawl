const fragmentRef = /url\(\s*#([^)\s]+)\s*\)/g;

const styleRef = /#([A-Za-z_][\w-]*)/g;

export const paperClass = 'md-diagram-paper';

export function scopeIds(svg: SVGSVGElement, id: string): void {
  const prefix = `${id}-`;
  const renamed = new Map<string, string>();
  for (const node of svg.querySelectorAll('[id]')) {
    renamed.set(node.id, prefix + node.id);
    node.id = prefix + node.id;
  }
  if (svg.id !== '') {
    renamed.set(svg.id, id);
  }
  svg.id = id;
  const follow = (whole: string, ref: string, write: (next: string) => string): string => {
    const next = renamed.get(ref);
    return next === undefined ? whole : write(next);
  };
  for (const node of svg.querySelectorAll('*')) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.localName === 'href' && attr.value.startsWith('#')) {
        attr.value = follow(attr.value, attr.value.slice(1), (next) => `#${next}`);
      } else if (attr.value.includes('url(')) {
        attr.value = attr.value.replace(fragmentRef, (whole, ref: string) =>
          follow(whole, ref, (next) => `url(#${next})`),
        );
      }
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    style.textContent = (style.textContent ?? '').replace(styleRef, (whole, ref: string) =>
      follow(whole, ref, (next) => `#${next}`),
    );
  }
}
