import { ActionIcon, Menu } from '@mantine/core';
import { useState, type ComponentPropsWithRef, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { EntryIcon } from '../components/EntryIcon';
import {
  FixedAnchor, pointerPlacement, rectAt, useCloseOnScroll, type MenuPlacement,
} from '../components/pointerMenu';
import { FieldMenuItem, menuRectOf, PopupMenu } from '../components/PopupMenu';
import { Sheet, SheetGroup, SheetRow } from '../components/Sheet';
import {
  IconDots, IconEdit, IconFile, IconFolder, IconLink, IconMoveTo, IconPlay, IconTrash,
} from '../icons';
import { directoryUrl, documentUrl, runState, runUrl } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { rowMenuIconSize, type RowMenuProps } from './extensions';
import { useFileActions } from './fileActionsContext';
import { parentOf } from './naming';
import { spaceLabel, useAccount } from './NavContext';
import { useRunInTab } from './runInTab';

const buttonPlacement: MenuPlacement = { position: 'bottom-end' };

function useRowActions(path: string, isDir: boolean): { open: () => void; run: (app: string) => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const runInTab = useRunInTab();
  return {
    open: () => void navigate(isDir ? directoryUrl(path) : documentUrl(path)),
    run: (app) => {
      if (runInTab === undefined) {
        void navigate(runUrl(app), { state: runState(location) });
      } else {
        runInTab(app);
      }
    },
  };
}

export function RowMenu(props: RowMenuProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  return phone && props.inTree !== true ? <RowSheet {...props} /> : <RowDropdown {...props} />;
}

type RowTriggerProps = Pick<RowMenuProps, 'path' | 'name' | 'touch' | 'opened'> & Omit<ComponentPropsWithRef<'button'>, 'name'>;

function RowTrigger({ path, name, touch, opened, ...rest }: RowTriggerProps): JSX.Element {
  return (
    <ActionIcon
      {...rest}
      data-testid="tree-row-menu"
      data-path={path}
      data-opened={opened ? 'true' : 'false'}
      variant="subtle"
      color="gray"
      size={touch ? 'lg' : 'sm'}
      style={{ flex: 'none' }}
      aria-label={`Actions for ${name}`}
    >
      <IconDots size={rowMenuIconSize} />
    </ActionIcon>
  );
}

function folderLabel(path: string, spaceName: string): string {
  return `in ${[spaceName, ...parentOf(path).split('/').filter((step) => step !== '')].join(' / ')}`;
}

function RowSheet({
  path, isDir, name, touch, editUrl, runPath, opened, onOpenedChange: setOpened,
}: RowMenuProps): JSX.Element {
  const navigate = useNavigate();
  const { me, canWrite } = useAccount();
  const actions = useFileActions();
  const { open, run } = useRowActions(path, isDir);
  const [keepFocus, setKeepFocus] = useState(false);
  const writable = canWrite && path !== '';

  const pick = (action: () => void): void => {
    setOpened(false);
    action();
  };

  return (
    <>
      <RowTrigger
        path={path}
        name={name}
        touch={touch}
        opened={opened}
        onClick={() => {
          setKeepFocus(false);
          setOpened(true);
        }}
      />
      <Sheet
        opened={opened}
        onClose={() => setOpened(false)}
        testId="tree-row-menu-dropdown"
        icon={<EntryIcon name={name} isDir={isDir} size={layout.iconSizeLarge} />}
        title={name}
        subtitle={folderLabel(path, spaceLabel(me))}
        returnFocus={!keepFocus}
      >
        <SheetGroup>
          <SheetRow testId="tree-row-menu-open" icon={isDir ? IconFolder : IconFile} label="Open" onClick={() => pick(open)} />
        </SheetGroup>
        <SheetGroup>
          {runPath !== undefined && (
            <SheetRow testId="tree-row-menu-run" icon={IconPlay} label="Run" onClick={() => pick(() => run(runPath))} />
          )}
          {editUrl !== undefined && canWrite && (
            <SheetRow
              testId="tree-row-menu-edit"
              icon={IconEdit}
              label="Edit"
              onClick={() => pick(() => void navigate(editUrl))}
            />
          )}
          {writable && (
            <>
              <SheetRow
                testId="tree-row-menu-rename"
                icon={IconEdit}
                label="Rename"
                onClick={() => {
                  setKeepFocus(true);
                  pick(() => actions.startRename(path, isDir, 'list'));
                }}
              />
              <SheetRow
                testId="tree-row-menu-move"
                icon={IconMoveTo}
                label="Move to…"
                onClick={(event) => {
                  const anchor = event.currentTarget.getBoundingClientRect();
                  pick(() => actions.moveTo(path, anchor));
                }}
              />
            </>
          )}
          <SheetRow
            testId="tree-row-menu-copy-link"
            icon={IconLink}
            label="Copy link"
            onClick={() => pick(() => actions.copyLink(path, isDir))}
          />
        </SheetGroup>
        {writable && (
          <SheetGroup>
            <SheetRow testId="tree-row-menu-delete" icon={IconTrash} label="Delete" danger onClick={() => pick(() => actions.remove(path))} />
          </SheetGroup>
        )}
      </Sheet>
    </>
  );
}

function RowDropdown({
  path, isDir, name, touch, inTree = false, editUrl, runPath, opened, onOpenedChange: setOpened, at,
}: RowMenuProps): JSX.Element {
  const navigate = useNavigate();
  const { canWrite } = useAccount();
  const actions = useFileActions();
  const { open, run } = useRowActions(path, isDir);
  useCloseOnScroll(opened, setOpened);

  return (
    <PopupMenu
      opened={opened}
      onChange={setOpened}
      {...(at !== undefined ? pointerPlacement : buttonPlacement)}
      withinPortal
      shadow="md"
      width={layout.menuWidthNarrow}
    >
      <Menu.Target>
        {at !== undefined ? <FixedAnchor rect={rectAt(at)} /> : <RowTrigger path={path} name={name} touch={touch} opened={opened} />}
      </Menu.Target>

      <Menu.Dropdown data-testid="tree-row-menu-dropdown">
        <Menu.Item
          data-testid="tree-row-menu-open"
          leftSection={isDir ? <IconFolder size={rowMenuIconSize} /> : <IconFile size={rowMenuIconSize} />}
          onClick={open}
        >
          Open
        </Menu.Item>
        {runPath !== undefined && (
          <Menu.Item
            data-testid="tree-row-menu-run"
            leftSection={<IconPlay size={rowMenuIconSize} />}
            onClick={() => run(runPath)}
          >
            Run
          </Menu.Item>
        )}
        {editUrl !== undefined && canWrite && (
          <Menu.Item
            data-testid="tree-row-menu-edit"
            leftSection={<IconEdit size={rowMenuIconSize} />}
            onClick={() => void navigate(editUrl)}
          >
            Edit
          </Menu.Item>
        )}

        <Menu.Divider />
        {canWrite && path !== '' && (
          <>
            <FieldMenuItem
              data-testid="tree-row-menu-rename"
              leftSection={<IconEdit size={rowMenuIconSize} />}
              onClick={() => actions.startRename(path, isDir, inTree ? 'tree' : 'list')}
            >
              Rename
            </FieldMenuItem>
            <Menu.Item
              data-testid="tree-row-menu-move"
              leftSection={<IconMoveTo size={rowMenuIconSize} />}
              onClick={(event) => actions.moveTo(path, menuRectOf(event.currentTarget))}
            >
              Move to
            </Menu.Item>
          </>
        )}
        <Menu.Item
          data-testid="tree-row-menu-copy-link"
          leftSection={<IconLink size={rowMenuIconSize} />}
          onClick={() => actions.copyLink(path, isDir)}
        >
          Copy link
        </Menu.Item>

        {canWrite && path !== '' && (
          <>
            <Menu.Divider />
            <Menu.Item
              data-testid="tree-row-menu-delete"
              color="red"
              leftSection={<IconTrash size={rowMenuIconSize} />}
              onClick={() => actions.remove(path)}
            >
              Delete
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
