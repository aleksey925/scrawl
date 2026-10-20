import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useComputedColorScheme } from '@mantine/core';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef, useState, type JSX } from 'react';

import classes from './Editor.module.css';

// the source reads as text with its markup set back: the words in the text
// color, the marks around them faint, a heading and bold by weight alone. The
// colors are the theme's properties, so one style serves every theme.
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: 'var(--scrawl-strong-weight)', color: 'var(--scrawl-text)' },
    { tag: tags.strong, fontWeight: 'var(--scrawl-strong-weight)' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    // a later rule wins on a range two tags share, so the marks and the address
    // inside a link come after the link
    { tag: tags.link, color: 'var(--scrawl-accent)' },
    { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName], color: 'var(--scrawl-text-tertiary)' },
    { tag: [tags.url, tags.meta], color: 'var(--scrawl-text-tertiary)' },
    { tag: tags.monospace, color: 'var(--scrawl-inline-code)' },
    { tag: tags.quote, color: 'var(--scrawl-text-secondary)' },
    { tag: [tags.angleBracket, tags.tagName, tags.attributeName, tags.attributeValue], color: 'var(--scrawl-color-purple)' },
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--scrawl-code-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--scrawl-code-string)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--scrawl-code-comment)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--scrawl-code-function)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--scrawl-code-number)' },
    { tag: [tags.typeName, tags.className, tags.standard(tags.name)], color: 'var(--scrawl-code-builtin)' },
  ]),
);

// the editor's own surface: the page's ground, no box and no gutter fill, a
// caret and a selection in the theme's colors
function surface(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: 'var(--scrawl-text)' },
      '.cm-content': { caretColor: 'var(--scrawl-text)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--scrawl-text)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--scrawl-accent-tint)',
      },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--scrawl-text-faint)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--scrawl-text-tertiary)' },
      '.cm-placeholder': { color: 'var(--scrawl-placeholder)' },
    },
    { dark },
  );
}

export interface DroppedFiles {
  files: File[];
  at: number | undefined;
}

export interface SourceEditorProps {
  value: string;
  readOnly: boolean;
  autoFocus: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onCreate: (view: EditorView) => void;
  onFiles: (dropped: DroppedFiles) => void;
}

export function SourceEditor(props: SourceEditorProps): JSX.Element {
  const { value, readOnly, autoFocus, wrap, onChange, onCreate, onFiles } = props;
  const scheme = useComputedColorScheme('light');
  const [dropping, setDropping] = useState(false);

  const handlers = useRef({ onFiles, readOnly });
  handlers.current = { onFiles, readOnly };

  const extensions = useMemo(() => {
    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      highlighting,
      surface(scheme === 'dark'),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...(readOnly ? [] : [placeholder('Start writing in markdown')]),
      EditorView.domEventHandlers({
        paste: (event) => {
          const data = event.clipboardData;
          const files = Array.from(data?.files ?? []);
          if (files.length === 0 || handlers.current.readOnly) {
            return false;
          }
          // Word and Excel put a screenshot on the clipboard beside the text,
          // and uploading that picture instead of pasting the text is never
          // what was meant
          if (Array.from(data?.types ?? []).includes('text/plain')) {
            return false;
          }
          event.preventDefault();
          handlers.current.onFiles({ files, at: undefined });
          return true;
        },
        dragover: (event) => {
          event.preventDefault();
          setDropping(true);
          return false;
        },
        dragleave: () => {
          setDropping(false);
          return false;
        },
        drop: (event, view) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          setDropping(false);
          if (files.length === 0 || handlers.current.readOnly) {
            return false;
          }
          event.preventDefault();
          const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
          handlers.current.onFiles({ files, at: at ?? undefined });
          return true;
        },
      }),
    ];
  }, [scheme, wrap, readOnly]);

  return (
    <div
      data-testid="editor-source"
      data-dropping={dropping ? 'true' : 'false'}
      className={`${classes.pane} ${classes.grow} ${classes.source} ${dropping ? classes.dropping : ''}`}
    >
      <CodeMirror
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onChange={onChange}
        onCreateEditor={onCreate}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: true }}
        aria-label="Document source"
      />
    </div>
  );
}
