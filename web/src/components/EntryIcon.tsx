import type { JSX } from 'react';

import { IconFile, IconFileText, IconFolder, IconPhoto } from '../icons';
import { isMarkdown } from '../paths';

const pictureExtension = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

export interface EntryIconProps {
  name: string;
  isDir?: boolean;
  size: number;
  className?: string;
}

// EntryIcon draws an entry the way Notion draws a page: a note with lines in
// it, a picture as a picture, a folder as one, anything else as a plain sheet
export function EntryIcon({ name, isDir = false, size, className }: EntryIconProps): JSX.Element {
  const Icon = isDir ? IconFolder : isMarkdown(name) ? IconFileText : pictureExtension.test(name) ? IconPhoto : IconFile;
  return <Icon size={size} aria-hidden className={className} />;
}
