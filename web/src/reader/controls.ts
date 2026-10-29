import { copyText } from './clipboard';
import { headingsOf, imagesOf } from './dom';

export const anchorClass = 'md-anchor';
export const copyClass = 'md-copy';
export const codeHeadClass = 'md-code-head';
const tableWrapClass = 'table-wrap';
const copyLabel = 'Copy';
const copiedLabel = 'Copied';

const copiedFor = 1500;

type Teardown = () => void;

export function injectControls(root: HTMLElement): Teardown {
  const teardowns = [injectHeadingAnchors(root), injectCopyButtons(root), wrapTables(root), prepareImages(root)];
  return () => {
    for (const teardown of teardowns) {
      teardown();
    }
  };
}

function tagged(): { tag: (element: HTMLElement, testid: string) => void; untag: Teardown } {
  const elements: HTMLElement[] = [];
  return {
    tag: (element, testid) => {
      element.dataset.testid = testid;
      elements.push(element);
    },
    untag: () => {
      for (const element of elements) {
        delete element.dataset.testid;
      }
    },
  };
}

function removing(added: readonly HTMLElement[], untag: Teardown): Teardown {
  return () => {
    for (const node of added) {
      node.remove();
    }
    untag();
  };
}

export function injectHeadingAnchors(root: HTMLElement): Teardown {
  const added: HTMLElement[] = [];
  const { tag, untag } = tagged();
  for (const heading of headingsOf(root)) {
    if (heading.querySelector(`.${anchorClass}`) !== null) {
      continue;
    }
    tag(heading, 'doc-heading');
    const anchor = document.createElement('a');
    anchor.className = anchorClass;
    anchor.dataset.testid = 'doc-heading-anchor';
    anchor.setAttribute('href', `#${encodeURIComponent(heading.id)}`);
    anchor.dataset.headingId = heading.id;
    anchor.setAttribute('aria-label', 'Copy a link to this section');
    heading.append(anchor);
    added.push(anchor);
  }
  return removing(added, untag);
}

export function injectCopyButtons(root: HTMLElement): Teardown {
  const added: HTMLElement[] = [];
  const { tag, untag } = tagged();
  for (const block of root.querySelectorAll<HTMLElement>('.code-block')) {
    const code = block.querySelector('pre');
    if (code === null || code.matches('.mermaid, .plantuml')) {
      continue;
    }
    if (block.querySelector(`.${codeHeadClass}`) !== null) {
      continue;
    }
    tag(block, 'doc-code');
    const head = document.createElement('div');
    head.className = codeHeadClass;
    const language = document.createElement('span');
    language.dataset.testid = 'code-language';
    language.textContent = block.dataset.lang ?? '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = copyClass;
    button.dataset.testid = 'code-copy';
    button.dataset.done = 'false';
    button.textContent = copyLabel;
    head.append(language, button);
    block.prepend(head);
    added.push(head);
  }
  return removing(added, untag);
}

export function wrapTables(root: HTMLElement): Teardown {
  const wrapped: HTMLElement[] = [];
  for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
    if (table.parentElement?.classList.contains(tableWrapClass) === true) {
      continue;
    }
    const wrap = document.createElement('div');
    wrap.className = tableWrapClass;
    table.replaceWith(wrap);
    wrap.append(table);
    wrapped.push(wrap);
  }
  return () => {
    for (const wrap of wrapped) {
      wrap.replaceWith(...wrap.childNodes);
    }
  };
}

export function prepareImages(root: HTMLElement): Teardown {
  const prepared: HTMLImageElement[] = [];
  const { tag, untag } = tagged();
  for (const image of imagesOf(root)) {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', image.alt === '' ? 'Open image' : `Open image: ${image.alt}`);
    tag(image, 'doc-image');
    prepared.push(image);
  }
  return () => {
    for (const image of prepared) {
      image.removeAttribute('tabindex');
      image.removeAttribute('role');
      image.removeAttribute('aria-label');
    }
    untag();
  };
}

export async function copyCode(button: HTMLElement, timers: Set<number>): Promise<boolean> {
  const code = button.closest('.code-block')?.querySelector('pre');
  if (!(await copyText(code?.textContent ?? ''))) {
    return false;
  }
  button.dataset.done = 'true';
  button.textContent = copiedLabel;
  const timer = window.setTimeout(() => {
    button.dataset.done = 'false';
    button.textContent = copyLabel;
    timers.delete(timer);
  }, copiedFor);
  timers.add(timer);
  return true;
}

export function pictureOf(target: EventTarget | null): HTMLImageElement | undefined {
  const image = target instanceof Element ? target.closest('img') : null;
  return image instanceof HTMLImageElement && image.closest('a') === null ? image : undefined;
}

export function pictureKeyed(event: KeyboardEvent): HTMLImageElement | undefined {
  return event.key === 'Enter' || event.key === ' ' ? pictureOf(event.target) : undefined;
}

export function sectionLink(id: string): string {
  return `${window.location.href.split(/[?#]/)[0] ?? ''}#${id}`;
}
