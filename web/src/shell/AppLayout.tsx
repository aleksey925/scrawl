import { ActionIcon, AppShell, Burger, Drawer } from '@mantine/core';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Outlet, useLocation } from 'react-router';

import { installUnauthorizedHandler } from '../api/client';
import { goToLogin } from '../login';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { FileActionsProvider } from './FileActions';
import { NavProvider } from './NavContext';
import { ProjectAlerts } from './ProjectAlerts';
import { SearchSpotlight } from './SearchSpotlight';
import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { ShortcutHelp } from './ShortcutHelp';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';
import { useSidebarHidden } from './useSidebarHidden';
import { useSwipeToClose } from './useSwipeToClose';

export function AppLayout(): JSX.Element {
  const location = useLocation();

  const [navOpened, setNavOpened] = useState(false);
  const [tocOpened, setTocOpened] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tocSlot, setTocSlot] = useState<HTMLElement | null>(null);
  const [tocPresent, setTocPresent] = useState(false);

  const wideSidebar = useAtLeast(layoutBreakpoints.sidebar);
  const wideToc = useAtLeast(layoutBreakpoints.tocRail);
  const { hidden: navHidden, toggle: toggleSidebar } = useSidebarHidden();

  const closeNav = useCallback(() => setNavOpened(false), []);
  const closeToc = useCallback(() => setTocOpened(false), []);
  const openToc = useCallback(() => setTocOpened(true), []);

  // the drawer is a panel a navigation dismisses, the rail is a preference that
  // outlives one, so the same control means two different things
  const navVisible = wideSidebar ? !navHidden : navOpened;
  const navLabel = navVisible ? 'Hide the file list' : 'Show the file list';
  const toggleNav = useCallback(() => {
    if (wideSidebar) {
      toggleSidebar();
      return;
    }
    setNavOpened((opened) => !opened);
  }, [wideSidebar, toggleSidebar]);

  // a fresh key per navigation, a replace that only moves the hash included;
  // unlike the disclosure handlers it does not change on a plain re-render
  useEffect(() => {
    closeNav();
    closeToc();
  }, [location.key, closeNav, closeToc]);

  // on the document rather than on the burger: the key belongs to the app, and
  // the caret is in the editor or the filter box most of the time it is wanted
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'b') {
        return;
      }
      event.preventDefault();
      toggleNav();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleNav]);

  useEffect(() => installUnauthorizedHandler('shell', goToLogin), []);

  const slots = useMemo<ShellSlots>(
    () => ({ actionsSlot, tocSlot, setTocPresent }),
    [actionsSlot, tocSlot],
  );

  const swipeRef = useSwipeToClose(closeNav);

  return (
    <NavProvider>
      <FileActionsProvider>
        <ShellSlotsProvider value={slots}>
          <AppShell
            header={{
              height: {
                base: layout.topbarHeightCompact,
                [layoutBreakpoints.compactTopbar]: layout.topbarHeight,
              },
            }}
            navbar={{
              width: layout.sidebarWidth,
              breakpoint: layoutBreakpoints.sidebar,
              collapsed: { mobile: true, desktop: navHidden },
            }}
            aside={{
              width: layout.tocWidth,
              breakpoint: layoutBreakpoints.tocRail,
              collapsed: { mobile: true, desktop: !tocPresent },
            }}
            padding="lg"
          >
            <AppShell.Header>
              <Topbar
                burger={
                  // the rail stays where it is put, so it takes the icon for a
                  // panel and not the burger, which stands for a panel that
                  // covers the page and is dismissed again
                  wideSidebar ? (
                    <ActionIcon
                      data-testid="topbar-burger"
                      data-opened={navVisible ? 'true' : 'false'}
                      variant="subtle"
                      color="gray"
                      size="lg"
                      onClick={toggleNav}
                      aria-label={navLabel}
                    >
                      {navVisible ? (
                        <IconLayoutSidebarLeftCollapse size={18} />
                      ) : (
                        <IconLayoutSidebarLeftExpand size={18} />
                      )}
                    </ActionIcon>
                  ) : (
                    <Burger
                      data-testid="topbar-burger"
                      data-opened={navVisible ? 'true' : 'false'}
                      opened={navVisible}
                      onClick={toggleNav}
                      size="sm"
                      aria-label={navLabel}
                    />
                  )
                }
                actionsRef={setActionsSlot}
                tocAvailable={tocPresent && !wideToc}
                onOpenToc={openToc}
              />
            </AppShell.Header>

            {/* a collapsed rail is only moved out of sight, and the rows left
                in it would still answer the tab key */}
            <AppShell.Navbar>{wideSidebar && !navHidden && <SidebarNav />}</AppShell.Navbar>

            <AppShell.Aside p="lg">{wideToc ? <div ref={setTocSlot} /> : null}</AppShell.Aside>

            <AppShell.Main style={{ minWidth: 0 }}>
              <ProjectAlerts />
              <Outlet />
            </AppShell.Main>
          </AppShell>

          {/* Mantine owns the overlay, the focus trap and the inert page behind it */}
          {!wideSidebar && (
            <Drawer
              data-testid="sidebar-drawer"
              opened={navOpened}
              onClose={closeNav}
              size={layout.sidebarWidth}
              title="Navigation"
              padding="md"
            >
              <div
                ref={swipeRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                  touchAction: 'pan-y',
                }}
              >
                <SidebarNav />
              </div>
            </Drawer>
          )}

          {!wideToc && (
            <Drawer
              data-testid="toc-drawer"
              opened={tocOpened}
              onClose={closeToc}
              position="bottom"
              size="60%"
              padding="md"
            >
              <div ref={setTocSlot} />
            </Drawer>
          )}

          <SearchSpotlight />
          <ShortcutHelp />
        </ShellSlotsProvider>
      </FileActionsProvider>
    </NavProvider>
  );
}
