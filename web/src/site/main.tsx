import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// after mantine's own sheet, whose defaults it replaces at equal specificity
import 'virtual:theme-stylesheet.css';
import '../global.css';
import './site.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router';

import { mountNode } from '../mount';
import { Component as DocumentPage } from '../pages/DocumentPage';
import { Component as HomePage } from '../pages/HomePage';
import { Component as NotFoundPage } from '../pages/NotFoundPage';
import { PlatformProvider } from '../platform';
import { ReaderExtensionsProvider, type ReaderExtensions } from '../shell/extensions';
import { NavProvider } from '../shell/NavContext';
import { applyStoredPageWidth, keepPageWidthIn, sitePersistence } from '../shell/pageWidth';
import { ReaderLayout, type ReaderChrome } from '../shell/ReaderLayout';
import { SiteMenu } from '../shell/SiteMenu';
import { theme } from '../theme';
import { keepThemeIn, themeColorSchemeManager } from '../themeChoice';
import { printInLight } from '../print';
import { pagePersistence } from '../themePersistence';

import { readPage } from './data';
import { HistoryPlacement } from './HistoryPlacement';
import { PageRestore } from './PageRestore';
import { PageStore } from './pages';
import { SiteBoundary } from './SiteBoundary';
import { SiteRouter } from './SiteRouter';
import { siteStatus, sitePlatform } from './sitePlatform';

keepThemeIn(pagePersistence());
keepPageWidthIn(sitePersistence());
applyStoredPageWidth();
printInLight();

const page = readPage();
const site = window.scrawlSite ?? { title: 'Notes', tree: [] };
const root = new URL(page.root, window.location.href);
const store = new PageStore();
store.add({ page, title: document.title });
const platform = sitePlatform(root, store, site);
const status = siteStatus(site.title);
const extensions: ReaderExtensions = { DocumentExtras: HistoryPlacement };
const chrome: ReaderChrome = { sidebarHead: <SiteMenu />, phoneMenu: <SiteMenu dots /> };

// the copy kept for a reader without javascript goes before the app draws the
// same note: its headings carry the same ids
document.querySelector('[data-scrawl-static]')?.remove();

createRoot(mountNode()).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      withCssVariables={false}
      colorSchemeManager={themeColorSchemeManager()}
      defaultColorScheme="auto"
    >
      <Notifications position="top-right" />
      <PlatformProvider value={platform}>
        <SiteRouter route={page.route} root={root} store={store}>
          <NavProvider status={status}>
            <ReaderExtensionsProvider value={extensions}>
              <ReaderLayout chrome={chrome} overlays={<PageRestore />}>
                <SiteBoundary>
                  <Routes>
                    <Route index element={<HomePage />} />
                    <Route path="doc/*" element={<DocumentPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </SiteBoundary>
              </ReaderLayout>
            </ReaderExtensionsProvider>
          </NavProvider>
        </SiteRouter>
      </PlatformProvider>
    </MantineProvider>
  </StrictMode>,
);
