import { AppShell, Burger, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { setUnauthorizedHandler } from '../api/client';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { FileActionsProvider } from './FileActions';
import { NavProvider } from './NavContext';
import { SearchSpotlight } from './SearchSpotlight';
import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const [navOpened, nav] = useDisclosure(false);
  const [tocOpened, toc] = useDisclosure(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tocSlot, setTocSlot] = useState<HTMLElement | null>(null);
  const [tocPresent, setTocPresent] = useState(false);

  const wideSidebar = useAtLeast(layoutBreakpoints.sidebar);
  const wideToc = useAtLeast(layoutBreakpoints.tocRail);

  useEffect(() => {
    nav.close();
    toc.close();
  }, [location.pathname, nav, toc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const from = encodeURIComponent(location.pathname + location.search);
      void navigate(`/login?from=${from}`);
    });
    return () => setUnauthorizedHandler(undefined);
  }, [navigate, location.pathname, location.search]);

  const slots = useMemo<ShellSlots>(
    () => ({ actionsSlot, tocSlot, setTocPresent }),
    [actionsSlot, tocSlot],
  );

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
                    opened={navOpened}
                    onClick={nav.toggle}
                    hiddenFrom={layoutBreakpoints.sidebar}
                    size="sm"
                    aria-label="Open navigation"
                  />
                }
                actionsRef={setActionsSlot}
                tocAvailable={tocPresent && !wideToc}
                onOpenToc={toc.open}
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
              opened={navOpened}
              onClose={nav.close}
              size={layout.sidebarWidth}
              title="Navigation"
              padding="md"
            >
              <SidebarNav />
            </Drawer>
          )}

          {!wideToc && (
            <Drawer
              opened={tocOpened}
              onClose={toc.close}
              position="bottom"
              size="60%"
              padding="md"
            >
              <div ref={setTocSlot} />
            </Drawer>
          )}

          <SearchSpotlight />
        </ShellSlotsProvider>
      </FileActionsProvider>
    </NavProvider>
  );
}
