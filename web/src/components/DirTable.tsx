import {
  useCallback, useRef, useState,
  type JSX, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';

import type { DirEntry } from '../api/types';
import { IconArrowUp, IconClock, IconFile, IconFolder, IconHash } from '../icons';
import { directoryUrl, isHtmlApp, isMarkdown } from '../paths';
import { usePlatform } from '../platform';
import { useReaderExtensions, type RunLinkProps } from '../shell/extensions';
import { useRenamingHere, type Renaming } from '../shell/fileActionsContext';
import { parentOf } from '../shell/naming';
import { SyncBadge } from '../shell/SyncBadge';
import { useLongPress } from '../shell/useLongPress';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './DirTable.module.css';
import { EntryIcon } from './EntryIcon';
import { LiftedRow } from './LiftedRow';
import { NameField } from './NameField';
import { usePointerMenu } from './pointerMenu';
import pressClasses from './PressRow.module.css';
import { RenameField } from './RenameField';
import { absoluteTime, fileSize, shortTime } from './formats';

export interface DirTableProps {
  path: string;
  entries: readonly DirEntry[];
  drafting?: boolean;
  onDraftSubmit?: (name: string) => Promise<boolean>;
  onDraftCancel?: () => void;
}

function opensRow(event: MouseEvent): boolean {
  return !(event.target instanceof Element && event.target.closest('a') !== null);
}

export function DirTable({ path, entries, drafting = false, onDraftSubmit, onDraftCancel }: DirTableProps): JSX.Element {
  const { physicalUrl } = usePlatform();
  const { FileView, RowMenu, RunLink } = useReaderExtensions();
  const filePages = FileView !== undefined;
  const navigate = useNavigate();
  const phone = useBelow(layoutBreakpoints.phone);
  const menu = usePointerMenu<DirEntry>();
  const folders = entries.filter((listed) => listed.is_dir);
  const files = entries.filter((listed) => !listed.is_dir);
  const draftable = drafting && onDraftSubmit !== undefined && onDraftCancel !== undefined;

  const routed = (entry: DirEntry): boolean => filePages || entry.is_dir || isMarkdown(entry.path);
  const runs = (entry: DirEntry): boolean => RunLink !== undefined && !entry.is_dir && isHtmlApp(entry.path);
  const open = (entry: DirEntry): void => {
    if (routed(entry)) {
      void navigate(entry.url);
    } else {
      window.location.assign(physicalUrl(entry.url));
    }
  };

  const row = (entry: DirEntry): JSX.Element => (
    <TableRow
      key={entry.path}
      entry={entry}
      routed={routed(entry)}
      runs={runs(entry)}
      href={physicalUrl(entry.url)}
      menuOpen={menu.opened && menu.target?.path === entry.path}
      onOpen={() => open(entry)}
      onMenu={RowMenu === undefined ? undefined : (event) => menu.open(event, entry)}
    />
  );

  if (phone) {
    return (
      <div data-testid="dir-table" data-variant="list" className={classes.list}>
        {folders.map((entry) => (
          <PhoneRow key={entry.path} entry={entry} routed={routed(entry)} runs={runs(entry)} href={physicalUrl(entry.url)} />
        ))}
        {draftable && <PhoneDraftRow onSubmit={onDraftSubmit} onCancel={onDraftCancel} />}
        {files.map((entry) => (
          <PhoneRow key={entry.path} entry={entry} routed={routed(entry)} runs={runs(entry)} href={physicalUrl(entry.url)} />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="dir-table" className={classes.wrap}>
      <table className={classes.table}>
        <colgroup>
          <col className={classes.colName} />
          <col className={classes.colSize} />
          <col className={classes.colDate} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span>
                <IconFile size={layout.iconSizeColumn} weight="fill" aria-hidden />
                Name
              </span>
            </th>
            <th>
              <span>
                <IconHash size={layout.iconSizeColumn} weight="bold" aria-hidden />
                Size
              </span>
            </th>
            <th>
              <span>
                <IconClock size={layout.iconSizeColumn} weight="fill" aria-hidden />
                Modified
              </span>
            </th>
            <th className={classes.fill} aria-hidden />
          </tr>
        </thead>
        <tbody>
          {path !== '' && (
            <tr
              data-testid="dir-up"
              className={classes.row}
              onClick={(event) => opensRow(event) && void navigate(directoryUrl(parentOf(path)))}
            >
              <td className={classes.name}>
                <span>
                  <IconArrowUp size={layout.iconSizeSmall} aria-hidden />
                  <Link to={directoryUrl(parentOf(path))} className={classes.link} aria-label="Up">
                    ..
                  </Link>
                </span>
              </td>
              <td />
              <td />
              <td className={classes.fill} />
            </tr>
          )}
          {folders.map(row)}
          {draftable && <DraftRow onSubmit={onDraftSubmit} onCancel={onDraftCancel} />}
          {files.map(row)}
        </tbody>
      </table>
      {RowMenu !== undefined && menu.target !== undefined && menu.at !== undefined && (
        <RowMenu
          key={`${menu.at.x}:${menu.at.y}`}
          path={menu.target.path}
          isDir={menu.target.is_dir}
          name={menu.target.name}
          touch={false}
          editUrl={menu.target.edit_url}
          opened={menu.opened}
          onOpenedChange={menu.setOpened}
          at={menu.at}
        />
      )}
    </div>
  );
}

function rowAttributes(entry: DirEntry): { 'data-testid': string; 'data-path': string; 'data-dir': 'true' | 'false' } {
  return { 'data-testid': 'dir-row', 'data-path': entry.path, 'data-dir': entry.is_dir ? 'true' : 'false' };
}

interface TableRowProps {
  entry: DirEntry;
  routed: boolean;
  runs: boolean;
  href: string;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: ((event: MouseEvent) => void) | undefined;
}

function TableRow({ entry, routed, runs, href, menuOpen, onOpen, onMenu }: TableRowProps): JSX.Element {
  const renaming = useRenamingHere('list', entry.path);
  const cells = (
    <>
      <td>{entry.is_dir ? <span className={classes.dim}>-</span> : fileSize(entry.size)}</td>
      <td title={absoluteTime(entry.mod_time)}>
        {shortTime(entry.mod_time)}
      </td>
      <td className={classes.fill} />
    </>
  );

  if (renaming !== undefined) {
    return (
      <tr
        {...rowAttributes(entry)}
        className={classes.draft}
        onContextMenu={(event) => {
          if (!(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
          }
        }}
      >
        <td className={classes.name}>
          <span>
            <RenameField
              session={renaming}
              testId="dir-rename"
              icon={<EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSizeSmall} />}
              className={classes.field}
            />
          </span>
        </td>
        {cells}
      </tr>
    );
  }

  return (
    <tr
      {...rowAttributes(entry)}
      data-menu={menuOpen ? 'true' : 'false'}
      className={classes.row}
      onClick={(event) => opensRow(event) && onOpen()}
      onContextMenu={onMenu}
    >
      <td className={classes.name}>
        <span>
          <EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSizeSmall} />
          {routed ? (
            <Link data-testid="dir-row-name" to={entry.url} className={classes.link}>
              {entry.is_dir ? `${entry.name}/` : entry.name}
            </Link>
          ) : (
            <a data-testid="dir-row-name" href={href} className={classes.link}>
              {entry.name}
            </a>
          )}
          <RowTags entry={entry} />
          {runs && <RunEntry path={entry.path} className={classes.run} />}
        </span>
      </td>
      {cells}
    </tr>
  );
}

function RowTags({ entry }: { entry: DirEntry }): JSX.Element {
  return (
    <>
      {entry.folder_page === true && (
        <span data-testid="dir-folder-page" className={classes.tag}>
          Folder page
        </span>
      )}
      <SyncBadge path={entry.path} />
    </>
  );
}

function RunEntry({ path, className }: RunLinkProps): JSX.Element | null {
  const { RunLink } = useReaderExtensions();
  return RunLink === undefined ? null : <RunLink path={path} className={className} />;
}

function restingRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
}

function onMenuButton(event: MouseEvent | PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest('button, [data-row-action]') !== null;
}

interface PhoneRowProps {
  entry: DirEntry;
  routed: boolean;
  runs: boolean;
  href: string;
}

function PhoneRow({ entry, routed, runs, href }: PhoneRowProps): JSX.Element {
  const renaming = useRenamingHere('list', entry.path);
  return renaming === undefined ? (
    <PhoneLinkRow entry={entry} routed={routed} runs={runs} href={href} />
  ) : (
    <PhoneRenameRow entry={entry} session={renaming} />
  );
}

function PhoneRenameRow({ entry, session }: { entry: DirEntry; session: Renaming }): JSX.Element {
  return (
    <div {...rowAttributes(entry)} className={`${classes.listRow} ${classes.naming}`}>
      <div className={classes.listLink}>
        <RenameField
          session={session}
          testId="dir-rename"
          icon={<EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSize} className={classes.listIcon} />}
          className={classes.listField}
        />
      </div>
    </div>
  );
}

function PhoneLinkRow({ entry, routed, runs, href }: PhoneRowProps): JSX.Element {
  const body = (
    <>
      <EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSize} className={classes.listIcon} />
      <span className={classes.listName}>
        <span data-testid="dir-row-name" className={classes.listLabel}>
          {entry.name}
        </span>
        <RowTags entry={entry} />
      </span>
    </>
  );
  const { RowMenu } = useReaderExtensions();
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const [holding, setHolding] = useState(false);
  const [lifted, setLifted] = useState<DOMRect | undefined>(undefined);
  const lift = useCallback(() => setLifted(rowRef.current === null ? undefined : restingRect(rowRef.current)), []);
  const longPress = useLongPress(lift, setHolding);
  const menu = (opened: boolean, setOpened: (opened: boolean) => void, target?: ReactElement): ReactNode =>
    RowMenu !== undefined && (
      <RowMenu
        path={entry.path}
        isDir={entry.is_dir}
        name={entry.name}
        touch
        editUrl={entry.edit_url}
        opened={opened}
        onOpenedChange={setOpened}
        target={target}
      />
    );
  const link = routed ? (
    <Link className={classes.listLink} to={entry.url}>
      {body}
    </Link>
  ) : (
    <a className={classes.listLink} href={href}>
      {body}
    </a>
  );

  return (
    <>
      <div
        ref={rowRef}
        {...rowAttributes(entry)}
        data-holding={holding ? 'true' : 'false'}
        data-lifted={lifted === undefined ? 'false' : 'true'}
        className={`${classes.listRow} ${pressClasses.row}`}
        {...(RowMenu === undefined
          ? {}
          : {
              ...longPress,
              onPointerDown: (event: PointerEvent) => {
                if (!onMenuButton(event)) {
                  longPress.onPointerDown(event);
                }
              },
              onContextMenu: (event: MouseEvent) => {
                event.preventDefault();
                if (event.currentTarget.contains(event.target as Node) && !onMenuButton(event)) {
                  lift();
                }
              },
            })}
      >
        {link}
        {runs && <RunEntry path={entry.path} className={classes.listRun} />}
        {menu(menuOpened, setMenuOpened)}
      </div>
      {RowMenu !== undefined && lifted !== undefined && (
        <LiftedRow
          rect={lifted}
          onDropped={() => setLifted(undefined)}
          menu={(card, opened, setOpened) => menu(opened, setOpened, card)}
        >
          <div className={classes.listLink}>{body}</div>
        </LiftedRow>
      )}
    </>
  );
}

interface DraftRowProps {
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

function DraftRow({ onSubmit, onCancel }: DraftRowProps): JSX.Element {
  return (
    <tr data-testid="dir-draft" data-entry="dir" className={classes.draft}>
      <td className={classes.name}>
        <span>
          <NameField
            initial=""
            testId="dir-draft"
            icon={<IconFolder size={layout.iconSizeSmall} aria-hidden />}
            className={classes.field}
            placeholder="Folder name"
            label="Name of the new folder"
            keepOnLeave
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </span>
      </td>
      <td />
      <td />
      <td className={classes.fill} />
    </tr>
  );
}

function PhoneDraftRow({ onSubmit, onCancel }: DraftRowProps): JSX.Element {
  return (
    <div data-testid="dir-draft" data-entry="dir" className={`${classes.listRow} ${classes.naming}`}>
      <div className={classes.listLink}>
        <NameField
          initial=""
          testId="dir-draft"
          icon={<IconFolder size={layout.iconSize} className={classes.listIcon} aria-hidden />}
          className={classes.listField}
          placeholder="Folder name"
          label="Name of the new folder"
          keepOnLeave
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
