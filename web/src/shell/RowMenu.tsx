import { ActionIcon, Menu } from '@mantine/core';
import type { JSX } from 'react';
import { useLocation, useNavigate } from 'react-router';

import {
  FixedAnchor, pointerPlacement, rectAt, useCloseOnScroll, type MenuPlacement,
} from '../components/pointerMenu';
import { FieldMenuItem, menuRectOf, PopupMenu } from '../components/PopupMenu';
import {
  IconDots, IconEdit, IconFile, IconFolder, IconLink, IconMoveTo, IconPlay, IconTrash,
} from '../icons';
import { directoryUrl, documentUrl, isHtmlApp, runState, runUrl } from '../paths';
import { layout } from '../theme';

import { rowMenuIconSize, type RowMenuProps } from './extensions';
import { useFileActions } from './fileActionsContext';
import { useAccount } from './NavContext';
import { useRunInTab } from './runInTab';

const buttonPlacement: MenuPlacement = { position: 'bottom-end' };
const targetPlacement: MenuPlacement = { position: 'bottom-end', offset: 8 };

export function RowMenu({
  path, isDir, name, touch, inTree = false, editUrl, runPath, opened, onOpenedChange: setOpened, target, at,
}: RowMenuProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { canWrite } = useAccount();
  const actions = useFileActions();
  const runInTab = useRunInTab();
  useCloseOnScroll(opened, setOpened);

  const open = (): void => void navigate(isDir ? directoryUrl(path) : documentUrl(path));
  const runTarget = runPath ?? (!isDir && isHtmlApp(path) ? path : undefined);
  const run = (target: string): void => {
    if (runInTab === undefined) {
      void navigate(runUrl(target), { state: runState(location) });
    } else {
      runInTab(target);
    }
  };
  const placement = at !== undefined ? pointerPlacement : target === undefined ? buttonPlacement : targetPlacement;

  return (
    <PopupMenu
      opened={opened}
      onChange={setOpened}
      {...placement}
      withinPortal
      shadow="md"
      width={layout.menuWidthNarrow}
    >
      <Menu.Target>
        {at !== undefined ? <FixedAnchor rect={rectAt(at)} /> : target ?? (
          <ActionIcon
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
        )}
      </Menu.Target>

      <Menu.Dropdown data-testid="tree-row-menu-dropdown">
        <Menu.Item
          data-testid="tree-row-menu-open"
          leftSection={isDir ? <IconFolder size={rowMenuIconSize} /> : <IconFile size={rowMenuIconSize} />}
          onClick={open}
        >
          Open
        </Menu.Item>
        {runTarget !== undefined && (
          <Menu.Item
            data-testid="tree-row-menu-run"
            leftSection={<IconPlay size={rowMenuIconSize} />}
            onClick={() => run(runTarget)}
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
