import { ActionIcon, Box, Group, ScrollArea, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconFolder } from '@tabler/icons-react';
import { useState, type JSX } from 'react';

import type { NavNode } from '../api/types';

import { ancestorsOf } from './naming';

export function foldersOf(nodes: readonly NavNode[]): NavNode[] {
  return nodes
    .filter((node) => node.is_dir)
    .map((node) => ({ ...node, children: foldersOf(node.children) }));
}

interface RowsProps {
  nodes: readonly NavNode[];
  depth: number;
  value: string;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onPick: (path: string) => void;
}

function PickerRow({
  path, name, depth, hasChildren, selected, expanded, onToggle, onPick,
}: {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  selected: boolean;
  expanded: boolean;
  onToggle: (path: string) => void;
  onPick: (path: string) => void;
}): JSX.Element {
  return (
    <Group gap={2} wrap="nowrap" style={{ paddingLeft: depth * 16, minWidth: 0 }}>
      {hasChildren ? (
        <ActionIcon
          data-testid="modal-folder-twisty"
          data-open={expanded ? 'true' : 'false'}
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(path)}
        >
          <IconChevronRight
            size={14}
            style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
          />
        </ActionIcon>
      ) : (
        <Box w={22} style={{ flex: 'none' }} />
      )}
      <UnstyledButton
        data-testid="modal-folder-row"
        data-path={path}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onPick(path)}
        aria-pressed={selected}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          padding: '6px 8px',
          borderRadius: 'var(--mantine-radius-sm)',
          fontSize: 'var(--mantine-font-size-sm)',
          background: selected ? 'var(--scrawl-accent-subtle)' : undefined,
          color: selected ? 'var(--scrawl-accent)' : undefined,
        }}
      >
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <IconFolder size={16} style={{ flex: 'none' }} />
          <Box style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
        </Group>
      </UnstyledButton>
    </Group>
  );
}

function PickerRows({ nodes, depth, value, expanded, onToggle, onPick }: RowsProps): JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <Box key={node.path}>
          <PickerRow
            path={node.path}
            name={node.name}
            depth={depth}
            hasChildren={node.children.length > 0}
            selected={node.path === value}
            expanded={expanded.has(node.path)}
            onToggle={onToggle}
            onPick={onPick}
          />
          {expanded.has(node.path) && node.children.length > 0 && (
            <PickerRows
              nodes={node.children}
              depth={depth + 1}
              value={value}
              expanded={expanded}
              onToggle={onToggle}
              onPick={onPick}
            />
          )}
        </Box>
      ))}
    </>
  );
}

export interface FolderPickerProps {
  folders: readonly NavNode[];
  value: string;
  onChange: (path: string) => void;
}

// only the branch the dialog opens on is expanded. A corpus with thousands of
// folders would otherwise build every one of them into the dialog at once.
export function FolderPicker({ folders, value, onChange }: FolderPickerProps): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(ancestorsOf(value)));

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <ScrollArea.Autosize
      data-testid="modal-folder-picker"
      mah={220}
      type="auto"
      style={{
        border: '1px solid var(--scrawl-border)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      <Box p={4} style={{ minWidth: 0 }}>
        <PickerRow
          path=""
          name="/"
          depth={0}
          hasChildren={folders.length > 0}
          selected={value === ''}
          expanded={expanded.has('')}
          onToggle={toggle}
          onPick={onChange}
        />
        {expanded.has('') && (
          <PickerRows
            nodes={folders}
            depth={1}
            value={value}
            expanded={expanded}
            onToggle={toggle}
            onPick={onChange}
          />
        )}
      </Box>
    </ScrollArea.Autosize>
  );
}
