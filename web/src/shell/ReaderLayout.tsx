import '../print.css';

import { ActionIcon, AppShell, Drawer } from '@mantine/core';
import { IconMenu2 } from '../icons';
import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState,
  type ComponentType, type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { FindControlProvider, type FindControl } from '../reader/findControl';
import { layout, layoutBreakpoints, useAtLeast, useBelow } from '../theme';

import { PageChromeProvider } from './PageChrome';
import { PhoneTopBar } from './PhoneTopBar';
import classes from './Shell.module.css';
import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { ShortcutHelp } from './ShortcutHelp';
import { appShortcut } from './shortcuts';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';
import { useSidebarHidden } from './useSidebarHidden';

export interface ReaderLayoutState {
  // revealNav puts the tree on screen, where there is one to put
  revealNav: () => void;
  // closePanels puts away the outline sheet
  closePanels: () => void;
  openShortcuts: () => void;
  // openOutline opens the outline as a sheet, where the note has one and the
  // screen has no room for it beside the note
  openOutline: (() => void) | undefined;
}

const ReaderLayoutContext = createContext<ReaderLayoutState | undefined>(undefined);

export function useReaderLayout(): ReaderLayoutState {
  const state = useContext(ReaderLayoutContext);
  if (state === undefined) {
    throw new Error('the layout is only available inside the reader');
  }
  return state;
}

// ReaderChrome is what an entry adds to the shell: the head of the sidebar,
// which opens the space's menu, the end of the topbar, and on a phone what
// stands for the sidebar
export interface ReaderChrome {
  sidebarHead?: ReactNode;
  topbarEnd?: ReactNode;
  // phoneHome is the left of the phone's bar at the root, where there is no
  // folder above to go back to
  phoneHome?: ReactNode;
  // phoneMenu is a menu at the right of the phone's bar after the page's own
  phoneMenu?: ReactNode;
  // phoneBottom is what sits under the thumb on a phone, the app's tab bar
  phoneBottom?: ReactNode;
}

export interface ReaderLayoutProps {
  chrome?: ReaderChrome;
  // providers that need the layout and have to hold the tree, which is what
  // the app's file actions are
  providers?: ComponentType<{ children: ReactNode }>;
  // above the page, the app's banner about the space
  banner?: ReactNode;
  // beside the page, a panel the app opens over it
  overlays?: ReactNode;
  children: ReactNode;
}

// ReaderLayout is the shell of the reader: the sidebar at the left, the full
// height, and the page's column beside it with the topbar on top. A phone has
// no sidebar: a bar on top and the entry's controls at the bottom. The app and
// a site both run it, the app with its own chrome.
export function ReaderLayout({ chrome, providers, banner, overlays, children }: ReaderLayoutProps): JSX.Element {
  const location = useLocation();
  const Providers = providers ?? Fragment;

  const [tocOpened, setTocOpened] = useState(false);
  const [shortcutsOpened, setShortcutsOpened] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tocSlot, setTocSlot] = useState<HTMLElement | null>(null);
  const [tocPresent, setTocPresent] = useState(false);
  const [openFind, setOpenFind] = useState<(() => void) | undefined>(undefined);
  const registerFind = useCallback((open: (() => void) | undefined) => setOpenFind(() => open), []);
  const findControl = useMemo<FindControl>(() => ({ open: openFind, register: registerFind }), [openFind, registerFind]);

  const phone = useBelow(layoutBreakpoints.phone);
  const miniOutline = useAtLeast(layoutBreakpoints.miniOutline);
  const { hidden: navHidden, toggle: toggleNav } = useSidebarHidden();

  const closeToc = useCallback(() => setTocOpened(false), []);
  const openToc = useCallback(() => setTocOpened(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpened(true), []);

  const revealNav = useCallback(() => {
    if (!phone && navHidden) {
      toggleNav();
    }
  }, [phone, navHidden, toggleNav]);

  // a fresh key per navigation, a replace that only moves the hash included;
  // unlike the disclosure handlers it does not change on a plain re-render
  useEffect(() => closeToc(), [location.key, closeToc]);

  // on the document rather than on a button: the key belongs to the app, and
  // the caret is in the editor or the filter box most of the time it is wanted
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'b' || !appShortcut(event) || phone) {
        return;
      }
      event.preventDefault();
      toggleNav();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleNav, phone]);

  const outlineSheet = tocPresent && !miniOutline;
  const layoutState = useMemo<ReaderLayoutState>(
    () => ({ revealNav, closePanels: closeToc, openShortcuts, openOutline: outlineSheet ? openToc : undefined }),
    [revealNav, closeToc, openShortcuts, outlineSheet, openToc],
  );

  const slots = useMemo<ShellSlots>(() => ({ actionsSlot, tocSlot, setTocPresent }), [actionsSlot, tocSlot]);

  // the rail brings itself back from the topbar once it was put away
  const start = navHidden && (
    <ActionIcon
      data-testid="topbar-burger"
      data-opened="false"
      variant="subtle"
      color="gray"
      onClick={toggleNav}
      aria-label="Show the sidebar"
    >
      <IconMenu2 size={layout.iconSize} />
    </ActionIcon>
  );

  return (
    <ReaderLayoutContext.Provider value={layoutState}>
      <Providers>
        <ShellSlotsProvider value={slots}>
          <PageChromeProvider>
            <FindControlProvider value={findControl}>
              <AppShell
                layout="alt"
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
                padding={0}
                classNames={{ header: classes.header, navbar: classes.navbar, main: classes.main }}
              >
                <AppShell.Header data-print="hide">
                  {phone ? (
                    <PhoneTopBar home={chrome?.phoneHome} end={chrome?.topbarEnd} menu={chrome?.phoneMenu} actionsRef={setActionsSlot} />
                  ) : (
                    <Topbar start={start} end={chrome?.topbarEnd} actionsRef={setActionsSlot} />
                  )}
                </AppShell.Header>

                {/* a hidden rail is only moved out of sight, and the rows left in
                    it would still answer the tab key */}
                <AppShell.Navbar data-print="hide">
                  {!phone && !navHidden && <SidebarNav head={chrome?.sidebarHead} onHide={toggleNav} />}
                </AppShell.Navbar>

                <AppShell.Main style={{ minWidth: 0 }}>
                  <div className={classes.banner}>{banner}</div>
                  {children}
                </AppShell.Main>
              </AppShell>

              {phone && chrome?.phoneBottom}

              {!miniOutline && (
                <Drawer
                  data-testid="toc-drawer"
                  opened={tocOpened}
                  onClose={closeToc}
                  position="bottom"
                  size="auto"
                  padding="md"
                  title="Outline"
                  classNames={{ content: classes.sheet, header: classes.sheetHead, title: classes.sheetTitle }}
                >
                  <div ref={setTocSlot} />
                </Drawer>
              )}

              {overlays}
              <ShortcutHelp opened={shortcutsOpened} onOpen={openShortcuts} onClose={() => setShortcutsOpened(false)} />
            </FindControlProvider>
          </PageChromeProvider>
        </ShellSlotsProvider>
      </Providers>
    </ReaderLayoutContext.Provider>
  );
}
