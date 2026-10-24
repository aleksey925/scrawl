import { Menu, useMantineColorScheme } from '@mantine/core';
import { useEffect, useRef, type JSX } from 'react';

import { api } from '../api/client';
import type { ExportFormat } from '../api/types';
import { errorText } from '../api/useApi';
import { IconDownload } from '../icons';
import { layout } from '../theme';
import { showToast } from '../toast';

import { exportName, printNote, saveFile } from './exportNote';

export interface NoteExport {
  print: () => void;
  download: (format: ExportFormat) => void;
}

export function useNoteExport(path: string): NoteExport {
  const { setColorScheme } = useMantineColorScheme();
  const pendingPrint = useRef<AbortController | undefined>(undefined);

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
