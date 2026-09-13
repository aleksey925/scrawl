import { AppShell, Burger, Drawer } from '@mantine/core';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { installUnauthorizedHandler } from '../api/client';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { FileActionsProvider } from './FileActions';
import { NavProvider } from './NavContext';
import { SearchSpotlight } from './SearchSpotlight';
import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { ShortcutHelp } from './ShortcutHelp';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';
import { useSwipeToClose } from './useSwipeToClose';

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const [navOpened, setNavOpened] = useState(false);
  const [tocOpened, setTocOpened] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tocSlot, setTocSlot] = useState<HTMLElement | null>(null);
  const [tocPresent, setTocPresent] = useState(false);

  const wideSidebar = useAtLeast(layoutBreakpoints.sidebar);
  const wideToc = useAtLeast(layoutBreakpoints.tocRail);

  const closeNav = useCallback(() => setNavOpened(false), []);
  const toggleNav = useCallback(() => setNavOpened((opened) => !opened), []);
  const closeToc = useCallback(() => setTocOpened(false), []);
  const openToc = useCallback(() => setTocOpened(true), []);

  // a fresh key per navigation, a replace that only moves the hash included;
  // unlike the disclosure handlers it does not change on a plain re-render
  useEffect(() => {
    closeNav();
    closeToc();
  }, [location.key, closeNav, closeToc]);

  useEffect(
    () =>
      installUnauthorizedHandler('shell', () => {
        const from = encodeURIComponent(location.pathname + location.search);
        void navigate(`/login?from=${from}`);
      }),
    [navigate, location.pathname, location.search],
  );

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
              collapsed: { mobile: true },
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
                  <Burger
                    data-testid="topbar-burger"
                    data-opened={navOpened ? 'true' : 'false'}
                    opened={navOpened}
                    onClick={toggleNav}
                    hiddenFrom={layoutBreakpoints.sidebar}
                    size="sm"
                    aria-label="Open navigation"
                  />
                }
                actionsRef={setActionsSlot}
                tocAvailable={tocPresent && !wideToc}
                onOpenToc={openToc}
              />
            </AppShell.Header>

            <AppShell.Navbar>{wideSidebar && <SidebarNav />}</AppShell.Navbar>

            <AppShell.Aside p="lg">{wideToc ? <div ref={setTocSlot} /> : null}</AppShell.Aside>

            <AppShell.Main style={{ minWidth: 0 }}>
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
