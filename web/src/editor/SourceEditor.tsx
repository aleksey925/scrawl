import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { useComputedColorScheme } from '@mantine/core';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef, useState, type JSX } from 'react';

import { styleNonce } from '../nonce';

import classes from './Editor.module.css';

export interface DroppedFiles {
  files: File[];
  at: number | undefined;
}

export interface SourceEditorProps {
  value: string;
  readOnly: boolean;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onCreate: (view: EditorView) => void;
  onFiles: (dropped: DroppedFiles) => void;
}

export function SourceEditor(props: SourceEditorProps): JSX.Element {
  const { value, readOnly, autoFocus, onChange, onCreate, onFiles } = props;
  const scheme = useComputedColorScheme('light');
  const [dropping, setDropping] = useState(false);

  const handlers = useRef({ onFiles, readOnly });
  handlers.current = { onFiles, readOnly };

  const extensions = useMemo(() => {
    const nonce = styleNonce();
    return [
      // codemirror mounts its theme as a <style> element, which style-src-elem
      // refuses without the nonce. A blocked sheet is not merely unstyled: the
      // line heights it carries are what lineBlockAt measures, so restoring the
      // reading position lands at zero.
      ...(nonce === undefined ? [] : [EditorView.cspNonce.of(nonce)]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
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
  }, []);

  return (
    <div className={`${classes.pane} ${classes.grow} ${classes.source} ${dropping ? classes.dropping : ''}`}>
      <CodeMirror
        value={value}
        height="100%"
        theme={scheme === 'dark' ? 'dark' : 'light'}
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onChange={onChange}
        onCreateEditor={onCreate}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
        aria-label="Document source"
      />
    </div>
  );
}
