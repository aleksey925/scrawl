import { Button, Menu, Text } from '@mantine/core';
import { IconCheck, IconChevronDown, IconEyeOff } from '@tabler/icons-react';
import type { JSX } from 'react';

import { api } from '../api/client';
import { useApi } from '../api/useApi';
import { layout } from '../theme';

import { useNav } from './NavContext';

// ProjectSwitcher goes to another project's root with a full page load, which
// re-boots the shell with the new basename. There is no client-side
// multi-project state to hold, which is the point of one subtree per project.
export function ProjectSwitcher(): JSX.Element | null {
  const { me } = useNav();
  const state = useApi((signal) => api.projects({ signal }), []);

  const projects = state.data ?? [];
  const current = me?.project;
  // with one project there is nothing to switch to, so the control is not there
  if (projects.length < 2 || current === undefined) {
    return null;
  }

  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        {/* no visibleFrom: a phone is where a reader is most likely to have
            landed in the wrong project, and the theme gives every Button the
            touch minimum on a coarse pointer already. The label truncates
            instead, so the breadcrumbs keep the room they can get. */}
        <Button
          data-testid="topbar-project"
          variant="subtle"
          color="gray"
          size="xs"
          px="xs"
          maw={layout.projectSwitcherWidth}
          rightSection={<IconChevronDown size={14} />}
          styles={{ label: { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        >
          {current.label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown data-testid="topbar-project-menu">
        <Menu.Label>Projects</Menu.Label>
        {projects.map((project) => (
          <Menu.Item
            key={project.name}
            data-testid="topbar-project-item"
            data-project={project.name}
            data-current={project.name === current.name ? 'true' : 'false'}
            component="a"
            href={project.url}
            leftSection={
              project.name === current.name ? <IconCheck size={16} /> : <span style={{ width: 16 }} />
            }
            rightSection={project.read_only ? <IconEyeOff size={14} /> : undefined}
          >
            <Text size="sm">{project.label}</Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
