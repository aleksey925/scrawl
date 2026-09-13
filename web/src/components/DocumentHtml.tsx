import { Typography } from '@mantine/core';
import type { JSX } from 'react';

export interface DocumentHtmlProps {
  html: string;
}

export function DocumentHtml({ html }: DocumentHtmlProps): JSX.Element {
  // the one place in the app that injects html. What arrives here was rendered
  // and sanitized on the server by the bluemonday policy in render/policy.go.
  return (
    <Typography>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </Typography>
  );
}
