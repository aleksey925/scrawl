import { Mark, Text } from '@mantine/core';
import type { JSX } from 'react';

// the server builds the snippet with template.HTMLEscapeString and adds the
// mark tags itself, so the markup is parsed back into elements rather than
// injected: note html has exactly one way into the app and this is not it
const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#34;': '"',
  '&#39;': "'",
};

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|#34|#39);/g, (entity) => entities[entity] ?? entity);
}

export interface SnippetProps {
  snippet: string;
}

export function Snippet({ snippet }: SnippetProps): JSX.Element {
  const parts: JSX.Element[] = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let at = 0;
  let found = pattern.exec(snippet);
  while (found !== null) {
    if (found.index > at) {
      parts.push(<span key={parts.length}>{decode(snippet.slice(at, found.index))}</span>);
    }
    parts.push(<Mark key={parts.length}>{decode(found[1] ?? '')}</Mark>);
    at = found.index + found[0].length;
    found = pattern.exec(snippet);
  }
  if (at < snippet.length) {
    parts.push(<span key={parts.length}>{decode(snippet.slice(at))}</span>);
  }

  return (
    <Text size="sm" c="dimmed">
      {parts}
    </Text>
  );
}
