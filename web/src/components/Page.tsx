import { useRef, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';

import classes from './Page.module.css';
import { useScreenEnter } from './screenMotion';

export type PageVariant = 'note' | 'list' | 'text';

export interface PageProps extends ComponentPropsWithoutRef<'div'> {
  variant?: PageVariant;
  children: ReactNode;
}

export function Page({ variant = 'note', className, children, ...rest }: PageProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useScreenEnter(ref);
  return (
    <div
      {...rest}
      ref={ref}
      data-screen
      className={className === undefined ? classes.page : `${classes.page} ${className}`}
      data-variant={variant}
    >
      {children}
    </div>
  );
}

export interface PageTitleProps {
  children: ReactNode;
  faint?: boolean;
  testId?: string;
}

export function PageTitle({ children, faint = false, testId }: PageTitleProps): JSX.Element {
  return (
    <h1 data-testid={testId} className={faint ? `${classes.title} ${classes.faint}` : classes.title}>
      {children}
    </h1>
  );
}
