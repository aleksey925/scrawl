import type { MantineColorScheme } from '@mantine/core';

import type { ExportFormat } from '../api/types';
import { onDarkScreen, paperTheme } from '../print';
import { trackedDone } from '../reader/pending';
import { previewThemeChoice, restoreThemeChoice } from '../themeChoice';

import { basenameOf } from './naming';

const blobLifetime = 60_000;

const settleLimit = 5_000;

function stemOf(path: string): string {
  return basenameOf(path).replace(/\.md$/i, '');
}

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

async function settle(): Promise<void> {
  const pictures = Array.from(document.images, (image) => {
    image.loading = 'eager';
    return image.decode().catch(() => undefined);
  });
  await nextFrame();
  await nextFrame();
  await Promise.race([Promise.all([trackedDone(), ...pictures]), delay(settleLimit)]);
}

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
