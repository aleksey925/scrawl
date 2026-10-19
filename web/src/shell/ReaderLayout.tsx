import '../print.css';

import { ActionIcon, AppShell, Burger, Drawer, ScrollArea } from '@mantine/core';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState,
  type ComponentType, type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { iconEdgeInset, layout, layoutBreakpoints, useAtLeast } from '../theme';

import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { ShortcutHelp } from './ShortcutHelp';
import { SidebarNav } from './SidebarNav';
import { Topbar, type TopbarChrome } from './Topbar';
import { useSidebarHidden } from './useSidebarHidden';
import { useSwipeToClose } from './useSwipeToClose';

export interface ReaderLayoutState {
  // revealNav puts the tree on screen, as a rail or as the drawer
  revealNav: () => void;
  // closePanels puts away the drawer and the outline sheet
  closePanels: () => void;
}

const ReaderLayoutContext = createContext<ReaderLayoutState | undefined>(undefined);

export function useReaderLayout(): ReaderLayoutState {
  const state = useContext(ReaderLayoutContext);
  if (state === undefined) {
    throw new Error('the layout is only available inside the reader');
  }
  return state;
}

export interface ReaderLayoutProps {
  // the app's own controls in the topbar
  chrome?: TopbarChrome;
  // providers that need the layout and have to hold the tree, which is what
  // the app's file actions are
  providers?: ComponentType<{ children: ReactNode }>;
  // above the page, the app's banner about the space
  banner?: ReactNode;
  // beside the page, a panel the app opens over it
  overlays?: ReactNode;
  children: ReactNode;
}

// ReaderLayout is the shell of the reader: the topbar, the tree as a rail or a
// drawer, the outline as a rail or a sheet, and the page between them. The app
// and a site both run it, the app with its own controls in it.
export function ReaderLayout({ chrome, providers, banner, overlays, children }: ReaderLayoutProps): JSX.Element {
  const location = useLocation();
  const Providers = providers ?? Fragment;

  const [navOpened, setNavOpened] = useState(false);
  const [tocOpened, setTocOpened] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tocSlot, setTocSlot] = useState<HTMLElement | null>(null);
  const [tocPresent, setTocPresent] = useState(false);

  const wideSidebar = useAtLeast(layoutBreakpoints.sidebar);
  const wideToc = useAtLeast(layoutBreakpoints.tocRail);
  const wideTopbar = useAtLeast(layoutBreakpoints.compactTopbar);
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
  const revealNav = useCallback(() => {
    if (!navVisible) {
      toggleNav();
    }
  }, [navVisible, toggleNav]);

  const closePanels = useCallback(() => {
    closeNav();
    closeToc();
  }, [closeNav, closeToc]);

  // a fresh key per navigation, a replace that only moves the hash included;
  // unlike the disclosure handlers it does not change on a plain re-render
  useEffect(() => closePanels(), [location.key, closePanels]);

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

  const layoutState = useMemo<ReaderLayoutState>(() => ({ revealNav, closePanels }), [revealNav, closePanels]);

  const slots = useMemo<ShellSlots>(
    () => ({ actionsSlot, tocSlot, setTocPresent }),
    [actionsSlot, tocSlot],
  );

  const swipeRef = useSwipeToClose(closeNav);

  return (
    <ReaderLayoutContext.Provider value={layoutState}>
      <Providers>
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
                        <IconLayoutSidebarLeftCollapse size={layout.topbarIconSize} />
                      ) : (
                        <IconLayoutSidebarLeftExpand size={layout.topbarIconSize} />
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
                chrome={chrome}
                actionsRef={setActionsSlot}
                tocAvailable={tocPresent && !wideToc}
                onOpenToc={openToc}
              />
            </AppShell.Header>

            {/* a collapsed rail is only moved out of sight, and the rows left
                in it would still answer the tab key */}
            <AppShell.Navbar>{wideSidebar && !navHidden && <SidebarNav />}</AppShell.Navbar>

            {/* the rail is fixed beside the note, so an outline longer than the
                window has to scroll inside it or the last headings are simply
                unreachable */}
            <AppShell.Aside>
              {wideToc ? (
                <ScrollArea type="hover" h="100%">
                  <div ref={setTocSlot} style={{ padding: 'var(--mantine-spacing-lg)' }} />
                </ScrollArea>
              ) : null}
            </AppShell.Aside>

            <AppShell.Main style={{ minWidth: 0 }}>
              {banner}
              {children}
            </AppShell.Main>
          </AppShell>

          {/* Mantine owns the overlay, the focus trap and the inert page behind it */}
          {!wideSidebar && (
            <Drawer
              data-testid="sidebar-drawer"
              opened={navOpened}
              onClose={closeNav}
              // a phone is too narrow to share with the page it covers anyway:
              // at the rail's width every second name was cut off
              size={wideTopbar ? layout.sidebarWidth : '100%'}
              title="Navigation"
              padding="lg"
              styles={{
                header: { paddingInlineEnd: iconEdgeInset(layout.topbarIconSize) },
                body: { paddingInline: 0 },
              }}
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

          {overlays}
          <ShortcutHelp />
        </ShellSlotsProvider>
      </Providers>
    </ReaderLayoutContext.Provider>
  );
}
