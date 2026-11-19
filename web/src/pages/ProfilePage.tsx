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
import { layout } from '../theme';
import { Avatar } from '../shell/Avatar';
import { spaceLabel, useAccount } from '../shell/NavContext';
import { useOfflineAccess } from '../shell/OfflineAccess';
import { standaloneChrome, usePageChrome } from '../shell/PageChrome';
import { ResetAction } from '../shell/ResetProvider';
import { signOut, useSpaces } from '../shell/SpaceMenu';
import { SpaceTile } from '../shell/SpaceTile';
import { SyncIcon } from '../shell/SyncControl';
import { factText } from '../shell/syncMessage';
import { themeOptions, useTheme } from '../shell/ThemePicker';

import classes from './ProfilePage.module.css';

export function Component(): JSX.Element {
  usePageChrome(standaloneChrome('Profile'));

  return (
    <Page data-testid="profile-page" variant="list" className={classes.page}>
      <PageTitle testId="profile-title">Profile</PageTitle>
      <div className={classes.groups}>
        <AccountCard />
        <SyncGroup />
        <WorkspaceGroup />
        <ThemeGroup />
        <DeviceGroup />
      </div>
    </Page>
  );
}

function Section({ label, testId, children }: { label: string; testId: string; children: ReactNode }): JSX.Element {
  return (
    <section data-testid={testId} className={classes.section}>
      <div className={classes.caption}>{label}</div>
      {children}
    </section>
  );
}

function AccountCard(): JSX.Element {
  const { me } = useAccount();
  const user = me?.user ?? '';

  return (
    <SheetGroup data-testid="profile-account">
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

  if (offline && me?.space.kind === 'remote') {
    return (
      <Section label="Sync" testId="profile-sync">
        <SheetGroup>
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
        <SheetGroup>
          <SheetRow testId="profile-sync-status" lead={icon} label={syncStatus.name} />
        </SheetGroup>
      </Section>
    );
  }
  const paths = me?.space.unsynced.paths ?? [];

  return (
    <Section label="Sync" testId="profile-sync">
      <SheetGroup>
        <div data-testid="profile-sync-status" className={classes.problem}>
          {icon}
          <div className={classes.problemText}>
            <span className={classes.problemTitle}>{sync?.title ?? syncStatus.name}</span>
            {sync?.facts.map((entry) => (
              <div key={entry.kind} className={classes.fact}>
                <span>{factText(entry, paths.length > 0)}</span>
                {entry.reason !== '' && <pre className={classes.reason}>{entry.reason}</pre>}
              </div>
            ))}
            {paths.length > 0 && me?.space.diverged === true && <span className={classes.fact}>Conflicting files:</span>}
            <ResetAction />
          </div>
        </div>
        {paths.map((unsynced) => (
          <SheetRow
            key={unsynced}
            testId="profile-sync-path"
            lead={
              <span className={classes.pathIcon}>
                <IconFile size={layout.iconSize} aria-hidden />
              </span>
            }
            label={unsynced}
            to={documentUrl(unsynced)}
          />
        ))}
      </SheetGroup>
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
      <SheetGroup>
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

function DeviceGroup(): JSX.Element {
  const { me } = useAccount();
  const fromCopy = useReadingCopy();
  const offline = useOfflineAccess();
  const signedIn = me !== undefined && me.user !== '';

  return (
    <SheetGroup data-testid="profile-device">
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
        description={offline.line === undefined ? undefined : <span data-testid="profile-offline-status">{offline.line}</span>}
        classNames={{
          root: classes.switchRow,
          body: classes.switchBody,
          labelWrapper: classes.switchText,
          label: classes.switchName,
          description: classes.switchLine,
        }}
      />
      {!fromCopy && me?.read_only === true && (
        <SheetRow testId="profile-readonly" icon={IconEyeOff} label="Read-only mode" />
      )}
      {!fromCopy &&
        (signedIn ? (
          <SheetRow testId="profile-signout" icon={IconLogout} label="Sign out" danger onClick={() => void signOut()} />
        ) : (
          <SheetRow testId="profile-signin" icon={IconLogin} label="Sign in" onClick={goToLogin} />
        ))}
    </SheetGroup>
  );
}
