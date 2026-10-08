import { ActionIcon, Group } from '@mantine/core';
import {
  IconBold,
  IconBraces,
  IconCode,
  IconHeading,
  IconItalic,
  IconLineDashed,
  IconLink,
  IconList,
  IconListNumbers,
  IconPhoto,
  IconQuote,
  IconWand,
} from '@tabler/icons-react';
import type { ComponentType, JSX } from 'react';

import { layout } from '../theme';

import classes from './Editor.module.css';
import type { MarkdownAction } from './markdownActions';

interface ToolItem {
  action: MarkdownAction;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const items: readonly ToolItem[] = [
  { action: 'bold', label: 'Bold', Icon: IconBold },
  { action: 'italic', label: 'Italic', Icon: IconItalic },
  { action: 'heading', label: 'Cycle heading level', Icon: IconHeading },
  { action: 'link', label: 'Insert link', Icon: IconLink },
  { action: 'code', label: 'Inline code', Icon: IconCode },
  { action: 'fence', label: 'Code block', Icon: IconBraces },
  { action: 'bullet', label: 'Bullet list', Icon: IconList },
  { action: 'ordered', label: 'Numbered list', Icon: IconListNumbers },
  { action: 'quote', label: 'Blockquote', Icon: IconQuote },
  { action: 'rule', label: 'Horizontal rule', Icon: IconLineDashed },
];

export interface ToolbarProps {
  onAction: (action: MarkdownAction) => void;
  onPickImage: () => void;
  onFormat: (() => void) | undefined;
  formatting: boolean;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onAction, onPickImage, onFormat, formatting } = props;
  return (
    <Group
      data-testid="editor-toolbar"
      className={classes.toolbarScroll}
      gap={2}
      wrap="nowrap"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      {items.map(({ action, label, Icon }) => (
        <ActionIcon
          key={action}
          data-testid={`editor-toolbar-${action}`}
          size={layout.tapTarget}
          variant="subtle"
          color="gray"
          aria-label={label}
          title={label}
          // the button would otherwise take focus and drop the selection the
          // action is about to operate on
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAction(action)}
        >
          <Icon size={18} />
        </ActionIcon>
      ))}
      <ActionIcon
        data-testid="editor-toolbar-image"
        size={layout.tapTarget}
        variant="subtle"
        color="gray"
        aria-label="Upload image"
        title="Upload image"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPickImage}
      >
        <IconPhoto size={18} />
      </ActionIcon>
      {onFormat !== undefined && (
        <ActionIcon
          data-testid="editor-toolbar-format"
          size={layout.tapTarget}
          variant="subtle"
          color="gray"
          aria-label="Format with prettier"
          title="Format with prettier"
          loading={formatting}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onFormat}
        >
          <IconWand size={18} />
        </ActionIcon>
      )}
    </Group>
  );
}
