import { useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react';

import classes from './Editor.module.css';
import type { TableSize } from './table';

const gridColumns = 8;
const gridRows = 8;

export interface TableGridProps {
  onPick: (size: TableSize) => void;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 1), max);
}

function sizeAt(grid: Element, x: number, y: number): TableSize {
  const box = grid.getBoundingClientRect();
  return {
    columns: clamp(Math.ceil(((x - box.left) / box.width) * gridColumns), gridColumns),
    rows: clamp(Math.ceil(((y - box.top) / box.height) * gridRows), gridRows),
  };
}

function pointerSize(event: MouseEvent<HTMLDivElement>): TableSize {
  return sizeAt(event.currentTarget, event.clientX, event.clientY);
}

const steps: Readonly<Record<string, TableSize>> = {
  ArrowLeft: { columns: -1, rows: 0 },
  ArrowRight: { columns: 1, rows: 0 },
  ArrowUp: { columns: 0, rows: -1 },
  ArrowDown: { columns: 0, rows: 1 },
};

export function TableGrid({ onPick }: TableGridProps): JSX.Element {
  const [size, setSize] = useState<TableSize | undefined>(undefined);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setSize((was) => ({
        columns: clamp((was?.columns ?? 0) + step.columns, gridColumns),
        rows: clamp((was?.rows ?? 0) + step.rows, gridRows),
      }));
    } else if ((event.key === 'Enter' || event.key === ' ') && size !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onPick(size);
    }
  }

  return (
    <div className={classes.tableGridBox}>
      <div
        data-testid="editor-table-grid"
        data-autofocus
        className={classes.tableGrid}
        style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
        role="button"
        tabIndex={0}
        aria-label={size === undefined ? 'Insert table' : `Insert a table of ${size.columns} columns and ${size.rows} rows`}
        onPointerDown={(event) => setSize(pointerSize(event))}
        onPointerMove={(event) => setSize(pointerSize(event))}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            setSize(undefined);
          }
        }}
        onClick={(event) => onPick(pointerSize(event))}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (touch !== undefined) {
            event.preventDefault();
            onPick(sizeAt(event.currentTarget, touch.clientX, touch.clientY));
          }
        }}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: gridRows * gridColumns }, (_, index) => {
          const column = (index % gridColumns) + 1;
          const row = Math.floor(index / gridColumns) + 1;
          const active = size !== undefined && column <= size.columns && row <= size.rows;
          return (
            <span
              key={index}
              className={classes.tableCell}
              data-column={column}
              data-row={row}
              data-active={active ? 'true' : 'false'}
            />
          );
        })}
      </div>
      <div data-testid="editor-table-size" className={classes.tableSize} aria-hidden>
        {size === undefined ? 'Insert table' : `${size.columns} × ${size.rows}`}
      </div>
    </div>
  );
}
