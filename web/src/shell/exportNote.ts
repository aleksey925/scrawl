import type { MantineColorScheme } from '@mantine/core';

import type { ExportFormat } from '../api/types';
import { onDarkScreen, paperTheme } from '../print';
import { trackedDone } from '../reader/pending';
import { previewThemeChoice, restoreThemeChoice } from '../themeChoice';

import { basenameOf } from './naming';

// a blob's address has to outlive the click: the browser reads it for the
// download after the click has returned
const blobLifetime = 60_000;

// the longest a print waits for the pictures and the diagrams, so that one
// which never loads cannot keep the print dialog from opening
const settleLimit = 5_000;

function stemOf(path: string): string {
  return basenameOf(path).replace(/\.md$/i, '');
}

// exportName is what an exported note is saved as: its own name, with the
// extension of the format
export function exportName(path: string, format: ExportFormat): string {
  return format === 'md' ? basenameOf(path) : `${stemOf(path)}.${format}`;
}

export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), blobLifetime);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// settle waits for what a print would otherwise catch half done: a picture
// below the screen is loaded lazily, a formula is typeset once katex arrives
// and a diagram is redrawn for the paper
async function settle(): Promise<void> {
  const pictures = Array.from(document.images, (image) => {
    image.loading = 'eager';
    return image.decode().catch(() => undefined);
  });
  // the redraw starts in an effect of the render the theme change asked for
  await nextFrame();
  await nextFrame();
  await Promise.race([Promise.all([trackedDone(), ...pictures]), delay(settleLimit)]);
}

// printNote opens the print dialog on the note on screen, where the browser
// saves it as a PDF named after the note. An abort, sent when the note leaves
// the screen during the wait, prints nothing and puts the title and the theme
// back at once, before a print started next reads them.
export async function printNote(
  path: string,
  setColorScheme: (value: MantineColorScheme) => void,
  signal: AbortSignal,
): Promise<void> {
  const title = document.title;
  const dark = onDarkScreen();
  const undo = (): void => {
    document.title = title;
    if (dark) {
      restoreThemeChoice(setColorScheme);
    }
  };
  if (dark) {
    previewThemeChoice(paperTheme, setColorScheme);
  }
  document.title = stemOf(path);
  signal.addEventListener('abort', undo, { once: true });
  await settle();
  if (signal.aborted) {
    return;
  }
  signal.removeEventListener('abort', undo);
  window.addEventListener('afterprint', undo, { once: true });
  window.print();
}
