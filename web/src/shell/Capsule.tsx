import type { JSX, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';

import type { Icon } from '../icons';
import { layout } from '../theme';

import classes from './Capsule.module.css';

export interface CapsuleProps {
  testId: string;
  label: string;
  kind: 'tabs' | 'actions';
  withNew?: boolean;
  children: ReactNode;
}

export function Capsule({ testId, label, kind, withNew = false, children }: CapsuleProps): JSX.Element {
  return (
    <nav
      data-testid={testId}
      aria-label={label}
      data-kind={kind}
      data-with-new={withNew ? 'true' : 'false'}
      className={classes.capsule}
      data-print="hide"
    >
      {children}
    </nav>
  );
}

interface CapsuleActionBody {
  testId: string;
  label: string;
  icon: Icon;
}

export type CapsuleActionProps = CapsuleActionBody &
  (
    | { to: string; onClick?: () => void }
    | { to?: undefined; onClick: (event: MouseEvent<HTMLButtonElement>) => void; expanded?: boolean }
  );

export function CapsuleAction(props: CapsuleActionProps): JSX.Element {
  const { testId, label, icon: ActionIcon } = props;
  const body = <ActionIcon size={layout.iconSizeLarge} aria-hidden />;
  if (props.to !== undefined) {
    return (
      <Link data-testid={testId} to={props.to} onClick={props.onClick} aria-label={label} title={label} className={classes.action}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-expanded={props.expanded}
      className={classes.action}
      onClick={props.onClick}
    >
      {body}
    </button>
  );
}

export const capsuleClasses = classes;
