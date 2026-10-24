import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';

import { DocumentView } from '../components/DocumentView';
import { documentUrl } from '../paths';
import { HistoryDialog } from '../shell/HistoryDialog';

export function Component(): JSX.Element {
  const params = useParams();
  const path = params['*'] ?? '';
  const navigate = useNavigate();
  const [reads, setReads] = useState(0);

  return (
    <>
      <DocumentView key={reads} path={path} />
      <HistoryDialog
        path={path}
        onClose={() => void navigate(documentUrl(path))}
        onNoteChanged={() => setReads((count) => count + 1)}
      />
    </>
  );
}
