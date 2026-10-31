import '../print.css';

import { ActionIcon, AppShell, Drawer } from '@mantine/core';
import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState,
  type ComponentType, type JSX, type ReactNode,
} from 'react';
import { useLocation } from 'react-router';

import { IconMenu } from '../icons';
import { FindControlProvider, type FindControl } from '../reader/findControl';
import { layout, layoutBreakpoints, useAtLeast, useBelow } from '../theme';

import { PageChromeProvider } from './PageChrome';
import { PhoneTopBar } from './PhoneTopBar';
import classes from './Shell.module.css';
import { ShellSlotsProvider, type ShellSlots } from './ShellSlots';
import { ShortcutHelp } from './ShortcutHelp';
import { appShortcut, modChord } from './shortcuts';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';
import { useSidebarHidden } from './useSidebarHidden';

export interface ReaderLayoutState {
  revealNav: () => void;
  closePanels: () => void;
  openShortcuts: () => void;
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

export interface ReaderChrome {
  sidebarFoot?: ReactNode;
  topbarEnd?: ReactNode;
  phoneMenu?: ReactNode;
  phoneBottom?: ReactNode;
}

export interface ReaderLayoutProps {
  chrome?: ReaderChrome;
  providers?: ComponentType<{ children: ReactNode }>;
  banner?: ReactNode;
  overlays?: ReactNode;
  children: ReactNode;
}

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

  useEffect(() => closeToc(), [location.key, closeToc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!modChord(event, 'b') || !appShortcut(event) || phone) {
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

  const start = navHidden && (
    <ActionIcon
      data-testid="topbar-burger"
      variant="subtle"
      color="gray"
      onClick={toggleNav}
      aria-label="Show the sidebar"
    >
      <IconMenu size={layout.iconSize} />
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
                    <PhoneTopBar end={chrome?.topbarEnd} menu={chrome?.phoneMenu} actionsRef={setActionsSlot} />
                  ) : (
                    <Topbar start={start} end={chrome?.topbarEnd} actionsRef={setActionsSlot} />
                  )}
                </AppShell.Header>

                <AppShell.Navbar data-print="hide">
                  {!phone && !navHidden && <SidebarNav foot={chrome?.sidebarFoot} onHide={toggleNav} />}
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
