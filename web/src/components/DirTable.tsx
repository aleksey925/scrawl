import { Anchor } from '@mantine/core';
import { IconArrowUp, IconFile, IconFolder } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { DirEntry } from '../api/types';
import { directoryUrl, isMarkdown } from '../paths';
import { usePlatform } from '../platform';
import { parentOf } from '../shell/naming';
import { SyncBadge } from '../shell/SyncBadge';

import classes from './DirTable.module.css';
import { absoluteTime, fileSize, relativeTime } from './formats';
import rows from './rows.module.css';

const iconSize = 18;

export interface DirTableProps {
  // the folder listed, "" for the root, which has nothing above it
  path: string;
  entries: readonly DirEntry[];
}

export function DirTable({ path, entries }: DirTableProps): JSX.Element {
  const { physicalUrl } = usePlatform();

  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th className={classes.name}>Name</th>
          <th className={`${classes.size} ${classes.end}`}>Size</th>
          <th className={classes.end}>Modified</th>
        </tr>
      </thead>
      <tbody>
        {path !== '' && (
          <tr data-testid="dir-up">
            <td className={classes.name}>
              <span>
                <IconArrowUp size={iconSize} className={rows.icon} aria-hidden />
                <Anchor component={Link} to={directoryUrl(parentOf(path))} c="var(--scrawl-text)" aria-label="Up">
                  ..
                </Anchor>
              </span>
            </td>
            <td className={classes.size} />
            <td />
          </tr>
        )}
        {entries.map((entry) => (
          <tr
            key={entry.path}
            data-testid="dir-row"
            data-path={entry.path}
            data-dir={entry.is_dir ? 'true' : 'false'}
          >
            <td className={classes.name}>
              <span>
                {entry.is_dir ? (
                  <IconFolder size={iconSize} className={rows.icon} aria-hidden />
                ) : (
                  <IconFile size={iconSize} className={rows.icon} aria-hidden />
                )}
                {/* a row is a route of the app only when it is a folder or a
                    note; anything else is the /raw/ url the server wrote, which
                    the browser fetches directly and the client has to mount */}
                {entry.is_dir || isMarkdown(entry.path) ? (
                  <Anchor data-testid="dir-row-name" component={Link} to={entry.url} c="var(--scrawl-text)">
                    {entry.name}
                  </Anchor>
                ) : (
                  <Anchor data-testid="dir-row-name" href={physicalUrl(entry.url)} c="var(--scrawl-text)">
                    {entry.name}
                  </Anchor>
                )}
                {/* a directory listing is the only surface that shows
                    attachments, and with a remote an unpushed image is a real
                    case that /raw/ has no chrome to warn about */}
                <SyncBadge path={entry.path} />
              </span>
            </td>
            <td className={`${classes.size} ${classes.end}`}>{entry.is_dir ? '' : fileSize(entry.size)}</td>
            <td className={classes.end} title={absoluteTime(entry.mod_time)}>
              {relativeTime(entry.mod_time)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
