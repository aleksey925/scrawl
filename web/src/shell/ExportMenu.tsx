import { Menu, useMantineColorScheme } from '@mantine/core';
import { IconDownload } from '../icons';
import { useEffect, useRef, type JSX } from 'react';

import { api } from '../api/client';
import type { ExportFormat } from '../api/types';
import { errorText } from '../api/useApi';
import { layout } from '../theme';
import { showToast } from '../toast';

import { exportName, printNote, saveFile } from './exportNote';

export interface NoteExport {
  print: () => void;
  download: (format: ExportFormat) => void;
}

// useNoteExport saves the note on screen as a file: the source and a page of
// its own come from the server, a PDF from the browser's print dialog. It
// lives with the menu's trigger and not in the dropdown, which unmounts as the
// menu closes and would cancel a print still waiting for its formulas.
export function useNoteExport(path: string): NoteExport {
  const { setColorScheme } = useMantineColorScheme();
  const pendingPrint = useRef<AbortController | undefined>(undefined);

  // the dialog would print whatever note is on screen once the wait is over
  useEffect(() => () => pendingPrint.current?.abort(), [path]);

  const print = (): void => {
    pendingPrint.current?.abort();
    const controller = new AbortController();
    pendingPrint.current = controller;
    void printNote(path, setColorScheme, controller.signal);
  };

  const download = (format: ExportFormat): void => {
    void (async () => {
      try {
        saveFile(await api.exportNote(path, format), exportName(path, format));
      } catch (error) {
        showToast('error', { title: 'Nothing was exported', message: errorText(error) });
      }
    })();
  };

  return { print, download };
}

// ExportItems are the exports among the items of a menu
export function ExportItems({ print, download }: NoteExport): JSX.Element {
  return (
    <>
      <Menu.Item
        data-testid="doc-export-md"
        leftSection={<IconDownload size={layout.iconSizeSmall} />}
        onClick={() => download('md')}
      >
        Export as Markdown
      </Menu.Item>
      <Menu.Item
        data-testid="doc-export-html"
        leftSection={<IconDownload size={layout.iconSizeSmall} />}
        onClick={() => download('html')}
      >
        Export as HTML
      </Menu.Item>
      <Menu.Item
        data-testid="doc-export-pdf"
        leftSection={<IconDownload size={layout.iconSizeSmall} />}
        onClick={print}
      >
        Export as PDF
      </Menu.Item>
    </>
  );
}
