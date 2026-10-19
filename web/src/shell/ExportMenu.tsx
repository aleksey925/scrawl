import { Menu, useMantineColorScheme } from '@mantine/core';
import { IconDownload, IconFileTypeHtml, IconFileTypePdf, IconMarkdown } from '@tabler/icons-react';
import { useEffect, useRef, type JSX } from 'react';

import { api } from '../api/client';
import type { ExportFormat } from '../api/types';
import { errorText } from '../api/useApi';
import { showToast } from '../toast';

import { exportName, printNote, saveFile } from './exportNote';
import { TopbarAction } from './TopbarAction';

// ExportMenu saves the note on screen as a file: the source and a page of its
// own come from the server, a PDF from the browser's print dialog
export function ExportMenu({ path }: { path: string }): JSX.Element {
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

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <TopbarAction testId="doc-export" label="Export" icon={IconDownload} />
      </Menu.Target>
      <Menu.Dropdown data-testid="doc-export-menu">
        <Menu.Item
          data-testid="doc-export-md"
          leftSection={<IconMarkdown size={16} />}
          onClick={() => download('md')}
        >
          Markdown
        </Menu.Item>
        <Menu.Item
          data-testid="doc-export-html"
          leftSection={<IconFileTypeHtml size={16} />}
          onClick={() => download('html')}
        >
          HTML
        </Menu.Item>
        <Menu.Item
          data-testid="doc-export-pdf"
          leftSection={<IconFileTypePdf size={16} />}
          onClick={print}
        >
          PDF / Print
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
