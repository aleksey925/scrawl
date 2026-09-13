import type { JSX } from 'react';
import { useParams } from 'react-router';

import { ApiError, api } from '../api/client';
import type { FileResponse, MeResponse } from '../api/types';
import { useApi } from '../api/useApi';
import { AsyncContent } from '../components/AsyncContent';
import { EditorScreen } from '../editor';

interface EditData {
  me: MeResponse;
  file: FileResponse | undefined;
}

export function Component(): JSX.Element {
  const params = useParams();
  const path = decodeURIComponent(params['*'] ?? '');

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
    return { me, file };
  }, [path]);

  return (
    <AsyncContent state={state}>
      {({ me, file }) => (
        <EditorScreen
          key={path}
          path={path}
          initialContent={file?.content ?? ''}
          initialRev={file?.rev ?? ''}
          isNew={file === undefined}
          readOnly={me.read_only}
        />
      )}
    </AsyncContent>
  );
}
