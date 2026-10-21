import type { JSX } from 'react';
import { useParams } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { FileResponse, MeResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { EditorScreen } from '../editor';
import { RouteChrome } from '../shell/PageChrome';

interface EditData {
  path: string;
  me: MeResponse;
  file: FileResponse | undefined;
}

export function Component(): JSX.Element {
  const params = useParams();
  const path = params['*'] ?? '';

  const state = useApi<EditData>(async (signal) => {
    const [me, file] = await Promise.all([
      api.me({ signal }),
      // a note that does not exist yet is created from this page, so a 404 is
      // an empty buffer rather than a failure
      api.file(path, { signal }).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          return undefined;
        }
        throw error;
      }),
    ]);
    return { path, me, file };
  }, [path]);
  // the editor takes its text once, on mount, so the answer kept from the note
  // edited before must never reach it
  const current = state.data?.path === path ? state : { ...state, data: undefined };

  return (
    <>
      <RouteChrome />
      <AsyncContent state={current} testId="editor">
        {({ me, file }) => (
          <EditorScreen
            key={path}
            path={path}
            initialContent={file?.content ?? ''}
            initialRev={file?.rev ?? ''}
            isNew={file === undefined}
            readOnly={me.read_only}
            formatOnSave={me.space.format_on_save}
          />
        )}
      </AsyncContent>
    </>
  );
}
