import { Menu } from '@mantine/core';
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

import { TableGrid } from './TableGrid';
import type { TableEdit, TableSize } from './table';
import { ToolButton } from './ToolButton';

interface EditItem {
  edit: TableEdit;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  color?: 'red';
}

const editGroups: readonly (readonly EditItem[])[] = [
  [
    { edit: 'rowAbove', label: 'Row above', Icon: IconRowAbove },
    { edit: 'rowBelow', label: 'Row below', Icon: IconRowBelow },
    { edit: 'columnLeft', label: 'Column left', Icon: IconColumnLeft },
    { edit: 'columnRight', label: 'Column right', Icon: IconColumnRight },
  ],
  [
    { edit: 'deleteRow', label: 'Delete row', Icon: IconRows, color: 'red' },
    { edit: 'deleteColumn', label: 'Delete column', Icon: IconColumns, color: 'red' },
    { edit: 'deleteTable', label: 'Delete table', Icon: IconTrash, color: 'red' },
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
      withInitialFocusPlaceholder={edits !== undefined}
      opened={opened}
      onChange={setOpened}
      onOpen={() => setEdits(editsAtCursor())}
    >
      <Menu.Target>
        <ToolButton testId="editor-toolbar-table" label="Table">
          <IconTable size={layout.iconSizeTool} />
        </ToolButton>
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
              {items.map(({ edit, label, Icon, color }) => (
                <Menu.Item
                  key={edit}
                  data-testid={`editor-table-${edit}`}
                  color={color}
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
