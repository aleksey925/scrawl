import { ActionIcon, Button, Menu } from '@mantine/core';
import { IconDots, IconDownload, IconEdit, IconFileOff, IconLink, IconPencil, IconTrash, IconZoomIn } from '@tabler/icons-react';
import { useRef, useState, type JSX } from 'react';

import type { FilePageResponse } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { absoluteTime, fileSize, relativeTime } from '../components/formats';
import { Page, PageTitle } from '../components/Page';
import { SheetMenu } from '../components/SheetMenu';
import { usePlatform } from '../platform';
import { useDocumentControls } from '../reader/useDocumentControls';
import { openViewer } from '../reader/viewer';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { EditButton } from './EditButton';
import { useFileActions } from './fileActionsContext';
import classes from './FileView.module.css';
import { useNav } from './NavContext';
import { chromeOf, usePageChrome } from './PageChrome';
import { PageActions } from './ShellSlots';
import { TopbarAction } from './TopbarAction';

// FileView is the page of a file that is not a note: a picture as a preview
// that opens the viewer, a text file as numbered, highlighted lines, and any
// other file as the way to download it
export function FileView({ file }: { file: FilePageResponse }): JSX.Element {
  const { physicalUrl } = usePlatform();
  const raw = physicalUrl(file.raw_url);
  usePageChrome(chromeOf(file.breadcrumbs, file.name));

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
      <span title={absoluteTime(file.mod_time)}>Edited {relativeTime(file.mod_time)}</span>
    </div>
  );
}

function Picture({ file, raw }: { file: FilePageResponse; raw: string }): JSX.Element {
  const image = useRef<HTMLImageElement>(null);
  const [pixels, setPixels] = useState<string | undefined>(undefined);
  const type = file.name.replace(/^.*\./, '').toUpperCase();

  return (
    <>
      <Meta file={file} kind={pixels === undefined ? `${type} image` : `${type} image, ${pixels}`} />
      <button
        type="button"
        data-testid="file-preview"
        className={classes.preview}
        aria-label={`Open ${file.name} full size`}
        onClick={() => image.current !== null && openViewer([image.current], image.current)}
      >
        <img
          ref={image}
          src={raw}
          alt={file.name}
          onLoad={(event) => setPixels(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
        />
      </button>
      <p className={classes.hint}>
        <IconZoomIn size={layout.iconSizeSmall} />
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
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  return (
    <>
      {canWrite && file.edit_url !== undefined && (
        wide ? (
          <TopbarAction testId="file-edit" label="Edit" icon={IconPencil} to={file.edit_url} />
        ) : (
          <EditButton to={file.edit_url} />
        )
      )}
      {wide ? (
        <Button
          data-testid="file-download"
          component="a"
          href={raw}
          download={file.name}
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<IconDownload size={layout.iconSizeSmall} />}
        >
          Download
        </Button>
      ) : (
        <ActionIcon
          data-testid="file-download"
          component="a"
          href={raw}
          download={file.name}
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Download"
        >
          <IconDownload size={layout.iconSize} />
        </ActionIcon>
      )}
      <SheetMenu position="bottom-end" width={220} withinPortal>
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
                onClick={() => actions.rename(file.path, false)}
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
      </SheetMenu>
    </>
  );
}
