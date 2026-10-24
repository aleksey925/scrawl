import { ActionIcon, Menu } from '@mantine/core';
import { useEffect, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { PopupMenu } from '../components/PopupMenu';
import {
  IconDots, IconEdit, IconFile, IconFolder, IconFolderPlus, IconLink, IconPlus, IconTrash,
} from '../icons';
import { directoryUrl, documentUrl } from '../paths';
import { layout } from '../theme';

import { rowMenuIconSize, type RowMenuProps } from './extensions';
import { useFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import { parentOf } from './naming';

export function RowMenu({
  path, isDir, name, touch, editUrl, opened, onOpenedChange: setOpened, target,
}: RowMenuProps): JSX.Element {
  const navigate = useNavigate();
  const { canWrite } = useNav();
  const actions = useFileActions();

  useEffect(() => {
    if (!opened) {
      return;
    }
    const close = (): void => setOpened(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [opened, setOpened]);

  const folder = isDir ? path : parentOf(path);
  const open = (): void => void navigate(isDir ? directoryUrl(path) : documentUrl(path));

  return (
    <PopupMenu
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      offset={target === undefined ? undefined : 8}
      withinPortal
      shadow="md"
      width={layout.menuWidthNarrow}
    >
      <Menu.Target>
        {target ?? (
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
        {editUrl !== undefined && canWrite && (
          <Menu.Item
            data-testid="tree-row-menu-edit"
            leftSection={<IconEdit size={rowMenuIconSize} />}
            onClick={() => void navigate(editUrl)}
          >
            Edit
          </Menu.Item>
        )}

        {canWrite && (
          <>
            <Menu.Divider />
            <Menu.Item
              data-testid="tree-row-menu-new-page"
              leftSection={<IconPlus size={rowMenuIconSize} />}
              onClick={() => actions.createPage(folder)}
            >
              New file
            </Menu.Item>
            <Menu.Item
              data-testid="tree-row-menu-new-folder"
              leftSection={<IconFolderPlus size={rowMenuIconSize} />}
              onClick={() => actions.createFolder(folder)}
            >
              New folder
            </Menu.Item>
          </>
        )}

        <Menu.Divider />
        {canWrite && path !== '' && (
          <Menu.Item
            data-testid="tree-row-menu-rename"
            leftSection={<IconEdit size={rowMenuIconSize} />}
            onClick={() => actions.rename(path)}
          >
            Rename
          </Menu.Item>
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
              onClick={() => actions.remove(path, isDir)}
            >
              Delete
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
