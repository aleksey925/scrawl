import { Anchor, Box, Breadcrumbs, Text } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import controls from '../controls.module.css';
import { directoryUrl, documentUrl } from '../paths';

import { contentPathOf } from './naming';

interface Crumb {
  name: string;
  url?: string;
}

function crumbsOf(pathname: string): Crumb[] {
  const content = contentPathOf(pathname);
  const segments = content.split('/').filter((segment) => segment !== '');

  const res: Crumb[] = [{ name: 'Home', url: '/' }];
  let prefix = '';
  segments.forEach((segment, index) => {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    const last = index === segments.length - 1;
    res.push({
      name: segment,
      url: last ? undefined : directoryUrl(prefix),
    });
  });
  if (segments.length > 0) {
    const last = res[res.length - 1];
    if (last !== undefined && content.endsWith('/')) {
      last.url = documentUrl(content);
    }
  }
  return res;
}

const itemStyle = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

function PathCrumbs({ pathname }: { pathname: string }): JSX.Element {
  const crumbs = crumbsOf(pathname);

  return (
    <Breadcrumbs data-testid="page-breadcrumbs" className={controls.pageCrumbs} separator="/" separatorMargin="xs">
      {crumbs.map((crumb, index) =>
        crumb.url === undefined ? (
          <Text
            key={`${crumb.name}-${index}`}
            data-testid="crumb"
            data-current="true"
            size="sm"
            c="var(--scrawl-text)"
            style={itemStyle}
          >
            {crumb.name}
          </Text>
        ) : (
          <Anchor
            key={`${crumb.name}-${index}`}
            data-testid="crumb"
            data-current="false"
            component={Link}
            to={crumb.url}
            size="sm"
            c="dimmed"
            style={itemStyle}
          >
            {crumb.name}
          </Anchor>
        ),
      )}
    </Breadcrumbs>
  );
}

// NoteCrumbs is the path alone, for the head of the card a note is read in.
// The root has no path to show.
export function NoteCrumbs(): JSX.Element | null {
  const location = useLocation();
  return contentPathOf(location.pathname) === '' ? null : <PathCrumbs pathname={location.pathname} />;
}

// PageCrumbs is the path as a row above a page that is not a note: a folder
// and a note that does not exist yet
export function PageCrumbs(): JSX.Element | null {
  const location = useLocation();

  if (contentPathOf(location.pathname) === '') {
    return null;
  }
  return (
    <Box mb="lg" data-print="hide">
      <PathCrumbs pathname={location.pathname} />
    </Box>
  );
}
