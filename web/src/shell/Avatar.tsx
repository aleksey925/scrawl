import type { JSX } from 'react';

import { IconUserCircle } from '../icons';

export interface AvatarProps {
  name: string;
  size: number;
  className?: string | undefined;
}

export function Avatar({ name, size, className }: AvatarProps): JSX.Element {
  const letter = Array.from(name.trim())[0]?.toUpperCase();
  if (letter === undefined) {
    return <IconUserCircle size={size} aria-hidden />;
  }
  return (
    <span data-testid="avatar" aria-hidden className={className} style={{ width: size, height: size }}>
      {letter}
    </span>
  );
}
