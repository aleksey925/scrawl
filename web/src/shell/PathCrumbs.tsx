import { Anchor, Box, Breadcrumbs, Text } from '@mantine/core';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import controls from '../controls.module.css';
import { directoryUrl, documentUrl } from '../paths';
import { layoutBreakpoints, useAtLeast } from '../theme';

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

// the topbar keeps the path on one line and truncates the current name: a row
// of crumbs that wraps inside a clipped bar breaks into a column over the page
const topbarStyle = { minWidth: 0, flex: '1 1 auto', overflow: 'hidden', flexWrap: 'nowrap' } as const;
const pageItemStyle = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

export function PathCrumbs({ place }: { place: 'topbar' | 'page' }): JSX.Element {
  const location = useLocation();
  const crumbs = crumbsOf(location.pathname);
  const inTopbar = place === 'topbar';

  return (
    <Breadcrumbs
      data-testid={`${place}-breadcrumbs`}
      className={controls.crumbs}
      separator="/"
      style={inTopbar ? topbarStyle : undefined}
    >
      {crumbs.map((crumb, index) =>
        crumb.url === undefined ? (
          <Text
            key={`${crumb.name}-${index}`}
            data-testid="crumb"
            data-current="true"
            size="sm"
            fw={500}
            truncate={inTopbar}
            style={inTopbar ? undefined : pageItemStyle}
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
            style={inTopbar ? undefined : pageItemStyle}
          >
            {crumb.name}
          </Anchor>
        ),
      )}
    </Breadcrumbs>
  );
}

// PageCrumbs is the path on a phone, where the topbar has no room left for it.
// The root has no path to show, so it gets no row.
export function PageCrumbs(): JSX.Element | null {
  const location = useLocation();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  if (wide || contentPathOf(location.pathname) === '') {
    return null;
  }
  return (
    <Box mb="md">
      <PathCrumbs place="page" />
    </Box>
  );
}
