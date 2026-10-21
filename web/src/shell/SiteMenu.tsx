import { ActionIcon, Menu } from '@mantine/core';
import type { JSX } from 'react';

import { PopupMenu } from '../components/PopupMenu';
import { IconDots, IconListSearch } from '../icons';
import { layout } from '../theme';

import { useNav } from './NavContext';
import { PageWidthControl } from './PageWidthControl';
import { useReaderLayout } from './ReaderLayout';
import { ShortcutsMenuItem } from './ShortcutHelp';
import { useKeyboardPlace } from './shortcuts';
import { SpaceButton } from './SpaceButton';
import { ThemePicker } from './ThemePicker';

// SiteMenu is the head of a site's sidebar: a site has no spaces and nobody
// signs in to it, so its menu holds the theme, the page width and the keys. On
// a phone it is the `⋯` of the top bar and holds the outline too.
export function SiteMenu({ dots = false }: { dots?: boolean }): JSX.Element {
  const { me } = useNav();
  const { openShortcuts, openOutline } = useReaderLayout();
  const keyboard = useKeyboardPlace();
  const name = me?.site_title ?? 'Notes';

  return (
    <PopupMenu position="bottom-start" width={280} withinPortal closeOnItemClick>
      <Menu.Target>
        {dots ? (
          <ActionIcon data-testid="site-menu" variant="subtle" color="gray" size="lg" aria-label="Theme and outline">
            <IconDots size={layout.iconSize} />
          </ActionIcon>
        ) : (
          <SpaceButton name={name} aria-label={`${name}: theme and page width`} />
        )}
      </Menu.Target>
      <Menu.Dropdown data-testid="space-menu-dropdown">
        {dots && openOutline !== undefined && (
          <Menu.Item
            data-testid="site-menu-outline"
            leftSection={<IconListSearch size={layout.iconSizeSmall} />}
            onClick={openOutline}
          >
            Outline
          </Menu.Item>
        )}
        <ThemePicker />
        {!dots && <PageWidthControl />}
        {keyboard && (
          <>
            <Menu.Divider />
            <ShortcutsMenuItem onClick={openShortcuts} />
          </>
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
