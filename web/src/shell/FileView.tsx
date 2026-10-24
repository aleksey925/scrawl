import { ActionIcon, Button, Menu } from '@mantine/core';
import { useEffect, useRef, useState, type JSX } from 'react';

import type { FilePageResponse } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { absoluteTime, fileSize, shortTime } from '../components/formats';
import { Page, PageTitle } from '../components/Page';
import { PopupMenu } from '../components/PopupMenu';
import { IconDots, IconDownload, IconEdit, IconFileOff, IconLink, IconTrash } from '../icons';
import { usePlatform } from '../platform';
import { useDocumentControls } from '../reader/useDocumentControls';
import { openViewer } from '../reader/viewer';
import { layout } from '../theme';

import { EditAction } from './EditButton';
import { useFileActions } from './fileActionsContext';
import classes from './FileView.module.css';
import { useNav } from './NavContext';
import { chromeOf, usePageChrome } from './PageChrome';
import { PageActions } from './ShellSlots';

// FileView is the page of a file that is not a note: a picture as a preview
// that opens the viewer, a text file as numbered, highlighted lines, and any
// other file as the way to download it
export function FileView({ file }: { file: FilePageResponse }): JSX.Element {
  const { physicalUrl } = usePlatform();
  const raw = physicalUrl(file.raw_url);
  usePageChrome(chromeOf(file.breadcrumbs, file.name, true));

  return (
    <>
      <PageActions>
        <FileActionsBar file={file} raw={raw} />
      </PageActions>
      <Page data-testid="file" data-type={file.type}>
        <PageTitle testId="file-title">{file.name}</PageTitle>
        {file.type === 'image' && <Picture file={file} raw={raw} />}
        {file.type === 'text' && <TextLines file={file} />}
        {file.type === 'other' && (
          <>
            <Meta file={file} />
            <EmptyState
              testId="file-other"
              icon={IconFileOff}
              title="This file cannot be shown here"
              actions={
                <Button
                  data-testid="file-other-download"
                  component="a"
                  href={raw}
                  download={file.name}
                  leftSection={<IconDownload size={layout.iconSizeSmall} />}
                >
                  Download
                </Button>
              }
            >
              It is not a picture and not text this page can show.
            </EmptyState>
          </>
        )}
      </Page>
    </>
  );
}

function Meta({ file, kind }: { file: FilePageResponse; kind?: string }): JSX.Element {
  return (
    <div data-testid="file-meta" className={classes.meta}>
      {kind !== undefined && <span>{kind}</span>}
      <span>{fileSize(file.size)}</span>
      <span title={absoluteTime(file.mod_time)}>Edited {shortTime(file.mod_time)}</span>
    </div>
  );
}

// a picture smaller than this is drawn bigger, by whole steps and with sharp
// pixels, so an icon is seen and not a speck
const smallPicture = 128;

function Picture({ file, raw }: { file: FilePageResponse; raw: string }): JSX.Element {
  const image = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);
  const pixels = size === undefined ? undefined : `${size.width} × ${size.height} px`;
  const scale = size === undefined || size.width === 0 ? 1 : Math.max(1, Math.floor(smallPicture / Math.max(size.width, size.height)));
  const type = file.name.replace(/^.*\./, '').toUpperCase();
  const closeViewer = useRef<(() => void) | null>(null);
  // the viewer is a dialog on the body, so it outlives a picture it is not closed with
  useEffect(
    () => () => {
      closeViewer.current?.();
      closeViewer.current = null;
    },
    [raw],
  );

  return (
    <>
      <Meta file={file} kind={pixels === undefined ? `${type} image` : `${type} image, ${pixels}`} />
      <button
        type="button"
        data-testid="file-preview"
        className={classes.preview}
        aria-label={`Open ${file.name} full size`}
        onClick={() => {
          if (image.current !== null) {
            closeViewer.current = openViewer([image.current], image.current);
          }
        }}
      >
        <img
          ref={image}
          src={raw}
          alt={file.name}
          style={scale > 1 && size !== undefined ? { width: size.width * scale, imageRendering: 'pixelated' } : undefined}
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      </button>
      <p className={classes.hint}>
        Click the picture to see it full size.
      </p>
    </>
  );
}

function TextLines({ file }: { file: FilePageResponse }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const html = file.html ?? '';
  const lines = file.lines ?? 0;
  useDocumentControls(root, html, () => undefined);

  return (
    <>
      <Meta file={file} kind={`${file.language ?? 'Text'}, ${lines} ${lines === 1 ? 'line' : 'lines'}`} />
      {/* rendered and sanitized on the server, the way a note is */}
      <div ref={root} data-testid="file-code" className={`markdown-document ${classes.code}`}>
        <div
          className="code-block"
          data-lang={file.language}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </>
  );
}

// FileActionsBar is what the topbar offers on a file's page
function FileActionsBar({ file, raw }: { file: FilePageResponse; raw: string }): JSX.Element {
  const { canWrite } = useNav();
  const actions = useFileActions();

  return (
    <>
      {canWrite && file.edit_url !== undefined && <EditAction testId="file-edit" to={file.edit_url} />}
      <ActionIcon
        data-testid="file-download"
        component="a"
        href={raw}
        download={file.name}
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Download"
        title="Download"
      >
        <IconDownload size={layout.iconSize} />
      </ActionIcon>
      <PopupMenu position="bottom-end" width={layout.menuWidth} withinPortal>
        <Menu.Target>
          <ActionIcon data-testid="file-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
            <IconDots size={layout.iconSize} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown data-testid="file-menu-dropdown">
          <Menu.Item
            data-testid="file-menu-copy-link"
            leftSection={<IconLink size={layout.iconSizeSmall} />}
            onClick={() => actions.copyLink(file.path, false)}
          >
            Copy link
          </Menu.Item>
          {canWrite && (
            <>
              <Menu.Item
                data-testid="file-menu-rename"
                leftSection={<IconEdit size={layout.iconSizeSmall} />}
                onClick={() => actions.rename(file.path)}
              >
                Rename
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                data-testid="file-menu-delete"
                color="red"
                leftSection={<IconTrash size={layout.iconSizeSmall} />}
                onClick={() => actions.remove(file.path, false)}
              >
                Delete
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </PopupMenu>
    </>
  );
}
