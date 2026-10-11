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
import { useEffect, useRef, useState, type ComponentType, type JSX, type RefObject } from 'react';

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
}

interface HiddenEnds {
  start: boolean;
  end: boolean;
}

// useHiddenEnds says which ends of a scrolling strip have more behind them, so
// the strip can fade there: with no scrollbar a cut-off row looks complete
function useHiddenEnds(): [RefObject<HTMLDivElement | null>, HiddenEnds] {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState<HiddenEnds>({ start: false, end: false });

  useEffect(() => {
    const strip = ref.current;
    if (strip === null) {
      return undefined;
    }
    const measure = (): void => {
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setEnds((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    measure();
    strip.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => {
      strip.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  return [ref, ends];
}

export function Toolbar({ onAction, onPickImage, onFormat }: ToolbarProps): JSX.Element {
  const [stripRef, hidden] = useHiddenEnds();

  return (
    <Group
      ref={stripRef}
      data-testid="editor-toolbar"
      data-more-start={hidden.start ? 'true' : 'false'}
      data-more-end={hidden.end ? 'true' : 'false'}
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
          onMouseDown={(event) => event.preventDefault()}
          onClick={onFormat}
        >
          <IconWand size={18} />
        </ActionIcon>
      )}
    </Group>
  );
}
