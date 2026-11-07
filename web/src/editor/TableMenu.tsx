import { ActionIcon, Menu } from '@mantine/core';
import { Fragment, useState, type ComponentType, type JSX } from 'react';

import { PopupMenu } from '../components/PopupMenu';
import {
  IconColumnLeft,
  IconColumnRight,
  IconColumns,
  IconRowAbove,
  IconRowBelow,
  IconRows,
  IconTable,
  IconTrash,
} from '../icons';
import { layout } from '../theme';

import classes from './Editor.module.css';
import { TableGrid } from './TableGrid';
import type { TableEdit, TableSize } from './table';

interface EditItem {
  edit: TableEdit;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const editGroups: readonly (readonly EditItem[])[] = [
  [
    { edit: 'rowAbove', label: 'Row above', Icon: IconRowAbove },
    { edit: 'rowBelow', label: 'Row below', Icon: IconRowBelow },
    { edit: 'columnLeft', label: 'Column left', Icon: IconColumnLeft },
    { edit: 'columnRight', label: 'Column right', Icon: IconColumnRight },
  ],
  [
    { edit: 'deleteRow', label: 'Delete row', Icon: IconRows },
    { edit: 'deleteColumn', label: 'Delete column', Icon: IconColumns },
    { edit: 'deleteTable', label: 'Delete table', Icon: IconTrash },
  ],
];

export interface TableMenuProps {
  editsAtCursor: () => ReadonlySet<TableEdit> | undefined;
  onEdit: (edit: TableEdit) => void;
  onInsert: (size: TableSize) => void;
}

export function TableMenu({ editsAtCursor, onEdit, onInsert }: TableMenuProps): JSX.Element {
  const [opened, setOpened] = useState(false);
  const [edits, setEdits] = useState<ReadonlySet<TableEdit> | undefined>(undefined);

  return (
    <PopupMenu
      position="bottom-start"
      width={layout.menuWidth}
      withinPortal
      returnFocus={false}
      opened={opened}
      onChange={setOpened}
      onOpen={() => setEdits(editsAtCursor())}
    >
      <Menu.Target>
        <ActionIcon
          data-testid="editor-toolbar-table"
          className={classes.tool}
          variant="subtle"
          color="gray"
          aria-label="Table"
          title="Table"
          onMouseDown={(event) => event.preventDefault()}
        >
          <IconTable size={layout.iconSizeTool} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="editor-table-menu">
        {edits === undefined ? (
          <TableGrid
            onPick={(size) => {
              setOpened(false);
              onInsert(size);
            }}
          />
        ) : (
          editGroups.map((items, index) => (
            <Fragment key={items[0]?.edit}>
              {index > 0 && <Menu.Divider />}
              {items.map(({ edit, label, Icon }) => (
                <Menu.Item
                  key={edit}
                  data-testid={`editor-table-${edit}`}
                  leftSection={<Icon size={layout.iconSizeSmall} />}
                  disabled={!edits.has(edit)}
                  onClick={() => onEdit(edit)}
                >
                  {label}
                </Menu.Item>
              ))}
            </Fragment>
          ))
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
