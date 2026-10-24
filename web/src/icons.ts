// The app's icons, the one place that says which drawing each one is. They are
// Phosphor's regular weight, the open set closest to the icons Notion draws:
// round ends and joins, a light even line, and room inside each shape.
import { IconBase, type Icon, type IconWeight } from '@phosphor-icons/react';
import { createElement, forwardRef } from 'react';

export type { Icon } from '@phosphor-icons/react';

export {
  ArrowUDownLeftIcon as IconTextWrap,
  ArrowUpIcon as IconArrowUp,
  ArrowsHorizontalIcon as IconTextWrapDisabled,
  ArrowsInSimpleIcon as IconMinimize,
  ArrowsOutSimpleIcon as IconMaximize,
  CaretDownIcon as IconChevronDown,
  CaretLeftIcon as IconChevronLeft,
  CaretRightIcon as IconChevronRight,
  CaretUpIcon as IconChevronUp,
  CheckIcon as IconCheck,
  ClockCounterClockwiseIcon as IconHistory,
  ClockIcon as IconClock,
  CloudArrowUpIcon as IconCloudUp,
  CloudSlashIcon as IconCloudOff,
  CodeBlockIcon as IconBraces,
  CodeIcon as IconCode,
  ColumnsIcon as IconColumns,
  DotsThreeIcon as IconDots,
  DownloadSimpleIcon as IconDownload,
  EyeIcon as IconEye,
  EyeSlashIcon as IconEyeOff,
  FileIcon as IconFile,
  FilePlusIcon as IconFilePlus,
  FileTextIcon as IconFileText,
  FileXIcon as IconFileOff,
  FolderIcon as IconFolder,
  FolderOpenIcon as IconFolderOpen,
  FolderPlusIcon as IconFolderPlus,
  HashIcon as IconHash,
  HouseIcon as IconHome,
  ImageIcon as IconPhoto,
  KeyboardIcon as IconKeyboard,
  LinkSimpleIcon as IconLink,
  ListBulletsIcon as IconList,
  ListIcon as IconMenu,
  ListMagnifyingGlassIcon as IconListSearch,
  ListNumbersIcon as IconListNumbers,
  MagicWandIcon as IconWand,
  MagnifyingGlassIcon as IconSearch,
  MinusIcon as IconMinus,
  MonitorIcon as IconDeviceDesktop,
  MoonIcon as IconMoon,
  PencilSimpleIcon as IconPencil,
  PencilSimpleLineIcon as IconEdit,
  PlusIcon as IconPlus,
  QuotesIcon as IconQuote,
  SidebarSimpleIcon as IconSidebar,
  SignInIcon as IconLogin,
  SignOutIcon as IconLogout,
  SunIcon as IconSun,
  TableIcon as IconTable,
  TextBIcon as IconBold,
  TextHIcon as IconHeading,
  TextItalicIcon as IconItalic,
  TrashIcon as IconTrash,
  UserCircleIcon as IconUserCircle,
  WarningIcon as IconAlertTriangle,
  XIcon as IconX,
} from '@phosphor-icons/react';

// a new note is drawn here and not taken from Phosphor: its NotePencil has a
// square with sharp inner corners, and the compose icon of Notion's and Apple's
// apps is a rounded square with a slim pencil, in the same line as the rest
const composeDrawing = createElement(
  'g',
  { fill: 'none', stroke: 'currentColor', strokeWidth: 16, strokeLinecap: 'round', strokeLinejoin: 'round' },
  createElement('path', { d: 'M124,40H72A32,32,0,0,0,40,72V184a32,32,0,0,0,32,32H184a32,32,0,0,0,32-32V132' }),
  createElement('path', { d: 'M141.9,133.9L221.9,53.9A14,14,0,0,0,202.1,34.1L122.1,114.1L112,144Z' }),
);

const composeWeights = new Map<IconWeight, ReturnType<typeof createElement>>(
  (['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const).map((weight) => [weight, composeDrawing]),
);

export const IconCompose: Icon = forwardRef((props, ref) =>
  createElement(IconBase, { ref, ...props, weights: composeWeights }),
);
IconCompose.displayName = 'IconCompose';
