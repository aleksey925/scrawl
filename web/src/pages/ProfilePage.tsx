import { Badge, Switch } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import { Page, PageTitle } from '../components/Page';
import { Segmented } from '../components/Segmented';
import { SheetGroup, SheetRow } from '../components/Sheet';
import {
  IconCheck, IconCloudDown, IconCloudOff, IconEyeOff, IconFile, IconLogin, IconLogout,
} from '../icons';
import { goToLogin } from '../login';
import { useConnection, useReadingCopy } from '../offline/connection';
import { documentUrl } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';
import { Avatar } from '../shell/Avatar';
import { spaceLabel, useAccount } from '../shell/NavContext';
import { useOfflineAccess } from '../shell/OfflineAccess';
import { standaloneChrome, usePageChrome } from '../shell/PageChrome';
import { useResetOpener } from '../shell/ResetProvider';
import { signOut, useSpaces } from '../shell/SpaceMenu';
import { SpaceTile } from '../shell/SpaceTile';
import { SyncIcon } from '../shell/SyncControl';
import { factText } from '../shell/syncMessage';
import { themeOptions, useTheme } from '../shell/ThemePicker';

import classes from './ProfilePage.module.css';

export function Component(): JSX.Element {
  usePageChrome(standaloneChrome('Profile'));
  const phone = useBelow(layoutBreakpoints.phone);

  return (
    <Page data-testid="profile-page" variant="list" className={classes.page}>
      {!phone && <PageTitle testId="profile-title">Profile</PageTitle>}
      <div className={classes.groups}>
        <AccountCard />
        <SyncGroup />
        <WorkspaceGroup />
        <ThemeGroup />
        <DeviceGroups />
      </div>
    </Page>
  );
}

function Section({ label, testId, children }: { label: string; testId: string; children: ReactNode }): JSX.Element {
  return (
    <section data-testid={testId} className={classes.section}>
      <div className={classes.caption}>{label}</div>
      <div className={classes.stack}>{children}</div>
    </section>
  );
}

function AccountCard(): JSX.Element {
  const { me } = useAccount();
  const user = me?.user ?? '';

  return (
    <SheetGroup className={classes.card} data-testid="profile-account">
      <div className={classes.account}>
        <Avatar name={user} size={48} className={classes.avatar} />
        <div className={classes.accountText}>
          <span data-testid="profile-user" className={classes.user}>
            {user === '' ? 'Not signed in' : user}
          </span>
          <span className={classes.space}>Space: {spaceLabel(me)}</span>
        </div>
      </div>
    </SheetGroup>
  );
}

function SyncGroup(): JSX.Element | null {
  const { syncStatus, sync, me } = useAccount();
  const offline = useConnection() === 'offline';
  const reset = useResetOpener();

  if (offline && me?.space.kind === 'remote') {
    return (
      <Section label="Sync" testId="profile-sync">
        <SheetGroup className={classes.card}>
          <SheetRow testId="profile-sync-status" icon={IconCloudOff} label="Offline" />
        </SheetGroup>
      </Section>
    );
  }
  if (syncStatus === undefined) {
    return null;
  }
  const icon = (
    <span className={classes.syncIcon} data-state={syncStatus.state}>
      <SyncIcon state={syncStatus.state} size={layout.iconSizeLarge} />
    </span>
  );
  if (syncStatus.state === 'sent' || syncStatus.state === 'sending') {
    return (
      <Section label="Sync" testId="profile-sync">
        <SheetGroup className={classes.card}>
          <SheetRow testId="profile-sync-status" lead={icon} label={syncStatus.name} />
        </SheetGroup>
      </Section>
    );
  }
  const paths = me?.space.unsynced.paths ?? [];
  const facts = sync?.facts ?? [];

  return (
    <Section label="Sync" testId="profile-sync">
      <div>
        <SheetGroup className={classes.card}>
          <SheetRow testId="profile-sync-status" lead={icon} label={sync?.title ?? syncStatus.name} />
        </SheetGroup>
        {facts.length > 0 && (
          <div data-testid="profile-sync-facts" className={classes.footer}>
            {facts.map((entry) => (
              <div key={entry.kind} className={classes.fact}>
                <span>{factText(entry, paths.length > 0)}</span>
                {entry.reason !== '' && <pre className={classes.reason}>{entry.reason}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>
      {paths.length > 0 && (
        <div className={classes.section}>
          {me?.space.diverged === true && <div className={classes.caption}>Conflicting files</div>}
          <SheetGroup className={classes.card}>
            {paths.map((unsynced) => (
              <SheetRow
                key={unsynced}
                testId="profile-sync-path"
                icon={IconFile}
                label={unsynced}
                to={documentUrl(unsynced)}
              />
            ))}
          </SheetGroup>
        </div>
      )}
      {reset !== undefined && (
        <SheetGroup className={classes.card}>
          <SheetRow testId="sync-reset" label="Replace local copy…" danger onClick={reset} />
        </SheetGroup>
      )}
    </Section>
  );
}

function WorkspaceGroup(): JSX.Element | null {
  const { me } = useAccount();
  const spaces = useSpaces();
  if (spaces.length === 0) {
    return null;
  }

  return (
    <Section label="Workspace" testId="profile-spaces">
      <SheetGroup className={classes.card}>
        {spaces.map((entry) => (
          <SheetRow
            key={entry.name}
            testId="profile-space-item"
            href={entry.url}
            lead={
              <span className={classes.spaceTile}>
                <SpaceTile name={entry.label} />
              </span>
            }
            label={entry.label}
            right={
              entry.name === me?.space.name ? (
                <IconCheck data-testid="profile-space-current" size={layout.iconSize} className={classes.check} aria-label="Current" />
              ) : entry.read_only ? (
                <Badge size="sm" variant="light" color="gray">
                  read-only
                </Badge>
              ) : undefined
            }
          />
        ))}
      </SheetGroup>
    </Section>
  );
}

const textThemeOptions = themeOptions.map(({ value, label }) => ({ value, label }));

function ThemeGroup(): JSX.Element {
  const { choice, choose } = useTheme();

  return (
    <Section label="Theme" testId="profile-theme-group">
      <Segmented
        data-testid="profile-theme"
        data-theme={choice}
        fullWidth
        radius="xl"
        classNames={{ root: classes.themeTrack, indicator: classes.themeThumb, label: classes.themeLabel }}
        value={choice}
        onChange={choose}
        aria-label="Theme"
        options={textThemeOptions}
      />
    </Section>
  );
}

function DeviceGroups(): JSX.Element {
  const { me } = useAccount();
  const fromCopy = useReadingCopy();
  const offline = useOfflineAccess();
  const signedIn = me !== undefined && me.user !== '';

  return (
    <>
      <div data-testid="profile-device">
        <SheetGroup className={classes.card}>
          <Switch
            data-testid="profile-offline"
            checked={offline.wanted}
            disabled={!offline.supported}
            onChange={offline.toggle}
            size="lg"
            withThumbIndicator={false}
            labelPosition="left"
            label={
              <span className={classes.switchLabel}>
                <IconCloudDown size={layout.iconSizeLarge} aria-hidden className={classes.rowIcon} />
                Offline access
              </span>
            }
            classNames={{
              root: classes.switchRow,
              body: classes.switchBody,
              track: classes.switchTrack,
              labelWrapper: classes.switchText,
              label: classes.switchName,
            }}
          />
        </SheetGroup>
        {offline.line !== undefined && (
          <div data-testid="profile-offline-status" className={classes.footer}>
            {offline.line}
          </div>
        )}
      </div>
      {!fromCopy && me?.read_only === true && (
        <SheetGroup className={`${classes.card} ${classes.short}`}>
          <SheetRow testId="profile-readonly" icon={IconEyeOff} label="Read-only mode" />
        </SheetGroup>
      )}
      {!fromCopy && (
        <SheetGroup className={`${classes.card} ${classes.short}`}>
          {signedIn ? (
            <SheetRow testId="profile-signout" icon={IconLogout} label="Sign out" danger onClick={() => void signOut()} />
          ) : (
            <SheetRow testId="profile-signin" icon={IconLogin} label="Sign in" onClick={goToLogin} />
          )}
        </SheetGroup>
      )}
    </>
  );
}
