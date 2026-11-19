import { Drawer } from '@mantine/core';
import { useLayoutEffect, useState, type ComponentPropsWithoutRef, type JSX, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

import { IconX, type Icon } from '../icons';
import { layout } from '../theme';

import classes from './Sheet.module.css';
import { useSheetDrag } from './useSheetDrag';

export interface SheetProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  testId?: string;
  overlayTestId?: string;
  tall?: boolean;
  footer?: ReactNode;
  returnFocus?: boolean;
  children: ReactNode;
}

export function Sheet({
  opened, onClose, title, subtitle, icon, testId, overlayTestId, tall = false, footer, returnFocus = true, children,
}: SheetProps): JSX.Element | null {
  const drag = useSheetDrag(opened, onClose);
  const [used, setUsed] = useState(false);
  useLayoutEffect(() => {
    if (opened) {
      setUsed(true);
    }
  }, [opened]);
  if (!used && !opened) {
    return null;
  }
  return (
    <Drawer.Root
      opened={opened && used}
      onClose={onClose}
      returnFocus={returnFocus}
      position="bottom"
      size="auto"
      data-print="hide"
    >
      <Drawer.Overlay data-testid={overlayTestId} />
      <Drawer.Content ref={drag} data-testid={testId} data-tall={tall ? 'true' : 'false'} classNames={{ content: classes.sheet }}>
        <div className={classes.grabber} aria-hidden />
        <Drawer.Header className={classes.head}>
          {icon !== undefined && <span className={classes.headIcon}>{icon}</span>}
          <div className={classes.heading}>
            <Drawer.Title className={classes.title}>{title}</Drawer.Title>
            {subtitle !== undefined && <div className={classes.subtitle}>{subtitle}</div>}
          </div>
          <Drawer.CloseButton data-testid="sheet-close" aria-label="Close" className={classes.close} icon={<IconX size={layout.iconSizeSmall} />} />
        </Drawer.Header>
        <Drawer.Body className={classes.body}>{children}</Drawer.Body>
        {footer !== undefined && <div className={classes.footer}>{footer}</div>}
      </Drawer.Content>
    </Drawer.Root>
  );
}

export interface KeptFocus {
  returnFocus: boolean;
  keepFocus: () => void;
}

export function useKeptFocus(opened: boolean): KeptFocus {
  const [kept, setKept] = useState(false);
  if (opened && kept) {
    setKept(false);
  }
  return { returnFocus: !kept, keepFocus: () => setKept(true) };
}

export function SheetGroup({ children, className, ...rest }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div {...rest} className={className === undefined ? classes.group : `${classes.group} ${className}`}>
      {children}
    </div>
  );
}

export function SheetNote({ children, ...rest }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div {...rest} className={classes.note}>
      {children}
    </div>
  );
}

interface SheetRowBody {
  icon?: Icon;
  lead?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  danger?: boolean;
  testId?: string;
}

export type SheetRowProps = SheetRowBody &
  (
    | { onClick: (event: MouseEvent<HTMLButtonElement>) => void; to?: undefined; href?: undefined; disabled?: boolean }
    | { to: string; onClick?: () => void; href?: undefined; disabled?: undefined }
    | { href: string; download?: string; onClick?: () => void; to?: undefined; disabled?: undefined }
    | { onClick?: undefined; to?: undefined; href?: undefined; disabled?: undefined }
  );

export function SheetRow(props: SheetRowProps): JSX.Element {
  const { icon: RowIcon, lead, label, detail, right, danger = false, testId } = props;
  const body = (
    <>
      {RowIcon !== undefined && <RowIcon size={layout.iconSizeLarge} className={classes.rowIcon} aria-hidden />}
      {lead}
      <span className={classes.rowText}>
        <span className={classes.rowLabel}>{label}</span>
        {detail !== undefined && <span className={classes.rowDetail}>{detail}</span>}
      </span>
      {right !== undefined && <span className={classes.rowRight}>{right}</span>}
    </>
  );
  const common = { 'data-testid': testId, 'data-danger': danger ? 'true' : undefined, className: classes.row };
  if (props.to !== undefined) {
    return (
      <Link {...common} to={props.to} onClick={props.onClick}>
        {body}
      </Link>
    );
  }
  if (props.href !== undefined) {
    return (
      <a {...common} href={props.href} download={props.download} onClick={props.onClick}>
        {body}
      </a>
    );
  }
  if (props.onClick !== undefined) {
    return (
      <button {...common} type="button" disabled={props.disabled} onClick={props.onClick}>
        {body}
      </button>
    );
  }
  return (
    <div {...common} data-static="true">
      {body}
    </div>
  );
}

export function SheetTiles({ children }: { children: ReactNode }): JSX.Element {
  return <div className={classes.tiles}>{children}</div>;
}

export interface SheetTileProps {
  icon: Icon;
  label: string;
  testId?: string;
  big?: boolean;
  onClick: () => void;
}

export function SheetTile({ icon: TileIcon, label, testId, big = false, onClick }: SheetTileProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-big={big ? 'true' : 'false'}
      className={classes.tile}
      onClick={onClick}
    >
      <TileIcon size={big ? layout.iconSizeTile : layout.iconSize} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export interface SheetButtonProps {
  testId?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function SheetButton({ testId, disabled = false, onClick, children }: SheetButtonProps): JSX.Element {
  return (
    <button type="button" data-testid={testId} disabled={disabled} className={classes.button} onClick={onClick}>
      {children}
    </button>
  );
}
