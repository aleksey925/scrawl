import { ActionIcon } from '@mantine/core';
import { Fragment, useEffect, useRef, useState, type ComponentType, type JSX, type RefObject } from 'react';

import {
  IconBold,
  IconBraces,
  IconCode,
  IconHeading,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconMinus,
  IconPhoto,
  IconQuote,
  IconWand,
} from '../icons';
import { layout } from '../theme';

import classes from './Editor.module.css';
import type { MarkdownAction } from './markdownActions';

interface ToolItem {
  action: MarkdownAction;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const groups: readonly (readonly ToolItem[])[] = [
  [
    { action: 'heading', label: 'Cycle heading level', Icon: IconHeading },
    { action: 'bold', label: 'Bold', Icon: IconBold },
    { action: 'italic', label: 'Italic', Icon: IconItalic },
    { action: 'code', label: 'Inline code', Icon: IconCode },
    { action: 'link', label: 'Insert link', Icon: IconLink },
  ],
  [
    { action: 'bullet', label: 'Bullet list', Icon: IconList },
    { action: 'ordered', label: 'Numbered list', Icon: IconListNumbers },
    { action: 'quote', label: 'Blockquote', Icon: IconQuote },
    { action: 'fence', label: 'Code block', Icon: IconBraces },
    { action: 'rule', label: 'Horizontal rule', Icon: IconMinus },
  ],
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

function ToolButton({ testId, label, onClick, children }: { testId: string; label: string; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <ActionIcon
      data-testid={testId}
      className={classes.tool}
      variant="subtle"
      color="gray"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </ActionIcon>
  );
}

export function Toolbar({ onAction, onPickImage, onFormat }: ToolbarProps): JSX.Element {
  const [stripRef, hidden] = useHiddenEnds();

  return (
    <div
      ref={stripRef}
      data-testid="editor-toolbar"
      data-more-start={hidden.start ? 'true' : 'false'}
      data-more-end={hidden.end ? 'true' : 'false'}
      className={classes.toolbarScroll}
      role="toolbar"
      aria-label="Markdown formatting"
    >
      {groups.map((tools, index) => (
        <Fragment key={tools[0]?.action}>
          {index > 0 && <span className={classes.toolSeparator} aria-hidden />}
          {tools.map(({ action, label, Icon }) => (
            <ToolButton key={action} testId={`editor-toolbar-${action}`} label={label} onClick={() => onAction(action)}>
              <Icon size={layout.iconSizeTool} />
            </ToolButton>
          ))}
        </Fragment>
      ))}
      <span className={classes.toolSeparator} aria-hidden />
      <ToolButton testId="editor-toolbar-image" label="Upload image" onClick={onPickImage}>
        <IconPhoto size={layout.iconSizeTool} />
      </ToolButton>
      {onFormat !== undefined && (
        <ToolButton testId="editor-toolbar-format" label="Format with prettier" onClick={onFormat}>
          <IconWand size={layout.iconSizeTool} />
        </ToolButton>
      )}
    </div>
  );
}
