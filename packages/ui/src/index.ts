// @deemed/ui: Deemed Health design system (docs/brand/design-system.md).
// Tokens live in ./tokens.css (import '@deemed/ui/tokens.css' after Tailwind).
export const packageName = '@deemed/ui';

export { cn } from './cn.js';
export {
  AUTH_ROUTES,
  MODULES,
  LAUNCHER_STATUSES,
  allPages,
  canViewPage,
  findRoute,
  homeRoute,
  launcherModules,
  matchModule,
  normalizeRoute,
  type LucideIconName,
  type ModuleEntry,
  type PageEntry,
  type PermissionSet,
  type ReleaseStatus,
  type RouteMatch,
} from './module-registry.js';
export { fuzzyMatch, searchModules, type Match, type ModuleResult } from './fuzzy.js';
export { ICONS, Icon } from './icons.js';

export { Alert, type AlertTone } from './components/Alert.js';
export { Badge, type BadgeProps, type BadgeStatus } from './components/Badge.js';
export {
  Button,
  buttonClasses,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button.js';
export { Card, CardTitle } from './components/Card.js';
export { Input, type InputProps } from './components/Input.js';
export { Eyebrow, Highlight, IconTile, Keycap, LogoMark } from './components/misc.js';
export { PreviewBanner } from './components/PreviewBanner.js';
export {
  EmptyState,
  HowItWorks,
  LinkArrow,
  PageHeader,
  StepCard,
  textLinkClasses,
  type Step,
} from './components/scaffolds.js';

export { AppShell, type AppShellProps } from './shell/AppShell.js';
export { Header, initials, type HeaderProps } from './shell/Header.js';
export { ModuleBar, type ModuleBarProps } from './shell/ModuleBar.js';
export { ModuleLauncher, type ModuleLauncherProps } from './shell/ModuleLauncher.js';
export type { LinkComponent, LinkLikeProps, ShellTenant, ShellUser } from './shell/types.js';

export {
  Checkbox,
  CitationChip,
  Drawer,
  Modal,
  Select,
  Tabs,
  Textarea,
  type SelectProps,
  type TabItem,
  type TextareaProps,
} from './components/controls.js';

// Records (ADR-0014 section 3)
export {
  RECORD_NAV,
  isUuid,
  matchRecordRoute,
  recordNav,
  withRecordEntries,
  type RecordNavEntry,
  type RecordRouteMatch,
} from './module-registry.js';
export {
  RecordsProvider,
  listQuery,
  useRecords,
  type ArchivedMode,
  type ListFilterInput,
  type ListParams,
  type RecordMutation,
  type RecordsClient,
  type RecordsContextValue,
  type RecordsError,
  type RecordsErrorCode,
  type RecordsResult,
} from './records/client.js';
export {
  LOCALE_TAGS,
  enumLabel,
  enumLabelKeys,
  fieldLabel,
  formatDate,
  formatInstant,
  formatValue,
  listActionsFor,
  recordTitle,
  statusTone,
  typeName,
  typePlural,
  type ListActions,
} from './records/format.js';
export { RecordForm, type RecordFormProps } from './records/RecordForm.js';
export { HistoryTimeline, RecordPage, type RecordPageProps } from './records/RecordPage.js';
export { RecordTable, type RecordTableProps } from './records/RecordTable.js';
export { RefText, RefValue, recordHref } from './records/refs.js';
