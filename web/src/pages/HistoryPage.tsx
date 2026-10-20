import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';

import { DocumentView } from '../components/DocumentView';
import { documentUrl } from '../paths';
import { HistoryDialog } from '../shell/HistoryDialog';

// the history keeps its own address, so a link and Back reach it, and shows
// over the note it belongs to
export function Component(): JSX.Element {
  const params = useParams();
  const path = params['*'] ?? '';
  const navigate = useNavigate();
  const [restored, setRestored] = useState(0);

  return (
    <>
      <DocumentView key={restored} path={path} />
      <HistoryDialog
        path={path}
        onClose={() => void navigate(documentUrl(path))}
        onRestored={() => setRestored((count) => count + 1)}
      />
    </>
  );
}
