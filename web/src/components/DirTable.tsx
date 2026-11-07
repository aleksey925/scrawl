import {
  useCallback, useRef, useState,
  type JSX, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';

import type { DirEntry, EntryKind } from '../api/types';
import { IconArrowUp, IconChevronRight, IconClock, IconFile, IconFileText, IconFolder, IconHash } from '../icons';
import { directoryUrl, isMarkdown } from '../paths';
import { usePlatform } from '../platform';
import { useReaderExtensions } from '../shell/extensions';
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
import { absoluteTime, countOf, fileSize, shortDate, shortTime } from './formats';

export interface DirTableProps {
  path: string;
  entries: readonly DirEntry[];
  draft?: EntryKind;
  onDraftSubmit?: (name: string) => Promise<boolean>;
  onDraftCancel?: () => void;
}

function opensRow(event: MouseEvent): boolean {
  return !(event.target instanceof Element && event.target.closest('a') !== null);
}

export function DirTable({ path, entries, draft, onDraftSubmit, onDraftCancel }: DirTableProps): JSX.Element {
  const { physicalUrl } = usePlatform();
  const { FileView, RowMenu } = useReaderExtensions();
  const filePages = FileView !== undefined;
  const navigate = useNavigate();
  const phone = useBelow(layoutBreakpoints.phone);
  const menu = usePointerMenu<DirEntry>();
  const folders = entries.filter((listed) => listed.is_dir);
  const files = entries.filter((listed) => !listed.is_dir);
  const draftRow =
    draft === undefined || onDraftSubmit === undefined || onDraftCancel === undefined ? null : (
      <DraftRow kind={draft} onSubmit={onDraftSubmit} onCancel={onDraftCancel} />
    );

  const routed = (entry: DirEntry): boolean => filePages || entry.is_dir || isMarkdown(entry.path);
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
      href={physicalUrl(entry.url)}
      menuOpen={menu.opened && menu.target?.path === entry.path}
      onOpen={() => open(entry)}
      onMenu={RowMenu === undefined ? undefined : (event) => menu.open(event, entry)}
    />
  );

  if (phone) {
    return (
      <div data-testid="dir-table" data-variant="list" className={classes.list}>
        {[...folders, ...files].map((entry) => (
          <PhoneRow key={entry.path} entry={entry} routed={routed(entry)} href={physicalUrl(entry.url)} />
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
          {draft === 'dir' && draftRow}
          {files.map(row)}
          {draft === 'file' && draftRow}
        </tbody>
      </table>
      {RowMenu !== undefined && menu.target !== undefined && menu.at !== undefined && (
        <RowMenu
          key={`${menu.at.x}:${menu.at.y}`}
          path={menu.target.path}
          isDir={menu.target.is_dir}
          name={menu.target.name}
          touch={false}
          withCreate={false}
          editUrl={menu.target.edit_url}
          opened={menu.opened}
          onOpenedChange={menu.setOpened}
          at={menu.at}
        />
      )}
    </div>
  );
}

interface TableRowProps {
  entry: DirEntry;
  routed: boolean;
  href: string;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: ((event: MouseEvent) => void) | undefined;
}

function TableRow({ entry, routed, href, menuOpen, onOpen, onMenu }: TableRowProps): JSX.Element {
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
        data-testid="dir-row"
        data-path={entry.path}
        data-dir={entry.is_dir ? 'true' : 'false'}
        className={classes.draft}
        onContextMenu={(event) => {
          if (!(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
          }
        }}
      >
        <td className={classes.name}>
          <span>
            <EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSizeSmall} />
            <RenameField session={renaming} testId="dir-rename" className={classes.field} />
          </span>
        </td>
        {cells}
      </tr>
    );
  }

  return (
    <tr
      data-testid="dir-row"
      data-path={entry.path}
      data-dir={entry.is_dir ? 'true' : 'false'}
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

function restingRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
}

function onMenuButton(event: MouseEvent | PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest('button') !== null;
}

interface PhoneRowProps {
  entry: DirEntry;
  routed: boolean;
  href: string;
}

function PhoneRow({ entry, routed, href }: PhoneRowProps): JSX.Element {
  const renaming = useRenamingHere('list', entry.path);
  return renaming === undefined ? (
    <PhoneLinkRow entry={entry} routed={routed} href={href} />
  ) : (
    <PhoneRenameRow entry={entry} session={renaming} />
  );
}

function PhoneRenameRow({ entry, session }: { entry: DirEntry; session: Renaming }): JSX.Element {
  return (
    <div data-testid="dir-row" data-path={entry.path} data-dir={entry.is_dir ? 'true' : 'false'} className={classes.listRow}>
      <div className={classes.listLink}>
        <EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSize} className={classes.listIcon} />
        <RenameField session={session} testId="dir-rename" className={classes.listField} />
      </div>
    </div>
  );
}

function PhoneLinkRow({ entry, routed, href }: PhoneRowProps): JSX.Element {
  const meta = entry.is_dir ? countOf(entry.items ?? 0, 'item') : `${fileSize(entry.size)} · ${shortDate(entry.mod_time)}`;
  const body = (
    <>
      <EntryIcon name={entry.name} isDir={entry.is_dir} size={layout.iconSize} className={classes.listIcon} />
      <span className={classes.listText}>
        <span className={classes.listName}>
          <span data-testid="dir-row-name" className={classes.listLabel}>
            {entry.name}
          </span>
          <RowTags entry={entry} />
        </span>
        <span data-testid="dir-row-meta" className={classes.listMeta}>
          {meta}
        </span>
      </span>
      {entry.is_dir && <IconChevronRight size={layout.iconSizeSmall} aria-hidden className={classes.listChevron} />}
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
        data-testid="dir-row"
        data-path={entry.path}
        data-dir={entry.is_dir ? 'true' : 'false'}
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
  kind: EntryKind;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

function DraftRow({ kind, onSubmit, onCancel }: DraftRowProps): JSX.Element {
  return (
    <tr data-testid="dir-draft" data-entry={kind} className={classes.draft}>
      <td className={classes.name}>
        <span>
          {kind === 'file' ? <IconFileText size={layout.iconSizeSmall} aria-hidden /> : <IconFolder size={layout.iconSizeSmall} aria-hidden />}
          <NameField
            initial=""
            testId="dir-draft"
            className={classes.field}
            placeholder={kind === 'file' ? 'File name' : 'Folder name'}
            label={kind === 'file' ? 'Name of the new file' : 'Name of the new folder'}
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
