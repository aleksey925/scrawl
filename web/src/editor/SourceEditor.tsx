import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useComputedColorScheme } from '@mantine/core';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { codeLanguageOf } from './codeLanguages';
import classes from './Editor.module.css';

const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: 'var(--scrawl-strong-weight)', color: 'var(--scrawl-text)' },
    { tag: tags.strong, fontWeight: 'var(--scrawl-strong-weight)' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
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

export type EditorKind = 'markdown' | 'text';

export interface SourceEditorProps {
  kind: EditorKind;
  name: string;
  value: string;
  readOnly: boolean;
  autoFocus: boolean;
  wrap: boolean;
  onChange: (value: string) => void;
  onCreate: (view: EditorView) => void;
  onFiles?: (dropped: DroppedFiles) => void;
}

function useCodeLanguage(kind: EditorKind, name: string): Extension | undefined {
  const [language, setLanguage] = useState<Extension | undefined>(undefined);
  useEffect(() => {
    setLanguage(undefined);
    const found = kind === 'text' ? codeLanguageOf(name) : null;
    if (found === null) {
      return undefined;
    }
    let live = true;
    void found.load().then(
      (support) => {
        if (live) {
          setLanguage(support);
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [kind, name]);
  return language;
}

export function SourceEditor(props: SourceEditorProps): JSX.Element {
  const { kind, name, value, readOnly, autoFocus, wrap, onChange, onCreate, onFiles } = props;
  const scheme = useComputedColorScheme('light');
  const [dropping, setDropping] = useState(false);

  const handlers = useRef({ onFiles, readOnly });
  handlers.current = { onFiles, readOnly };

  const code = useCodeLanguage(kind, name);

  const extensions = useMemo(() => {
    const markup = kind === 'markdown' ? markdown({ base: markdownLanguage, codeLanguages: languages }) : code;
    return [
      ...(markup === undefined ? [] : [markup]),
      highlighting,
      surface(scheme === 'dark'),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...(readOnly || kind !== 'markdown' ? [] : [placeholder('Start writing in markdown')]),
      EditorView.domEventHandlers({
        paste: (event) => {
          const data = event.clipboardData;
          const files = Array.from(data?.files ?? []);
          const take = handlers.current.onFiles;
          if (files.length === 0 || handlers.current.readOnly || take === undefined) {
            return false;
          }
          if (Array.from(data?.types ?? []).includes('text/plain')) {
            return false;
          }
          event.preventDefault();
          take({ files, at: undefined });
          return true;
        },
        dragover: (event) => {
          event.preventDefault();
          setDropping(handlers.current.onFiles !== undefined);
          return false;
        },
        dragleave: () => {
          setDropping(false);
          return false;
        },
        drop: (event, view) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          setDropping(false);
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          const take = handlers.current.onFiles;
          if (take !== undefined && !handlers.current.readOnly) {
            const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
            take({ files, at: at ?? undefined });
          }
          return true;
        },
      }),
    ];
  }, [kind, code, scheme, wrap, readOnly]);

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
        aria-label={kind === 'markdown' ? 'Document source' : 'File text'}
      />
    </div>
  );
}
