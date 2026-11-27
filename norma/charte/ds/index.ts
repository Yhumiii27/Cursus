// Nocturne design-system primitives (docs/spec/02 DS-CLASSES, C-08, C-19…C-23).
// Server-compatible: Button, ButtonLink, IconButton, Tag, Card, CardTitle, Field, Input, Select, Textarea,
// PseudoInput, Segmented, Table/Th/Td/Tr/CellStack/IdText/Ellipsis, DialogActions, MenuHeader/MenuItem/MenuEmpty.
// Client ('use client'): Dialog, Drawer, CenteredModal, Popover, Toast*, overlay hooks.
export { cx } from './cx';
export { Button, ButtonLink, IconButton } from './Button';
export type { ButtonProps, ButtonLinkProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';
export { Tag } from './Tag';
export type { TagProps, TagSize, TagTone } from './Tag';
export { Card, CardTitle } from './Card';
export type { CardProps, CardTitleProps } from './Card';
export { Field, Input, Select, Textarea, PseudoInput } from './Field';
export type { FieldProps, InputProps, InputSize, SelectOption, SelectProps, TextareaProps, PseudoInputProps } from './Field';
export { Segmented } from './Segmented';
export type { SegmentedOption, SegmentedProps } from './Segmented';
export { Table, TableScroll, Th, Td, Tr, CellStack, IdText, Ellipsis } from './Table';
export type { TableProps, ThProps, TdProps, TrProps } from './Table';
export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';
export { DialogActions } from './DialogParts';
export type { DialogActionsProps } from './DialogParts';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
export { CenteredModal } from './CenteredModal';
export type { CenteredModalProps } from './CenteredModal';
export { Popover } from './Popover';
export type { PopoverProps } from './Popover';
export { MenuHeader, MenuItem, MenuEmpty } from './Menu';
export type { MenuItemProps } from './Menu';
export { ToastProvider, ToastViewport, useToast, showToast, dismissToast, TOAST_MS } from './Toast';
export type { ToastApi } from './Toast';
export { useOverlay, useIsClient } from './overlay';
export type { OverlayOptions } from './overlay';
export { ThemeToggle } from './ThemeToggle';
export { THEMES, THEME_COOKIE, LEGACY_THEME_COOKIE, THEME_COOKIES_READ, DEFAULT_THEME, themeOf, themeFromCookies, themeFromCookieHeader, themeCookie } from './theme';
export type { Theme } from './theme';
// Norma 2.0 — coque commune (charte/COQUE.md, classes de charte/coque.css).
export { AppShell, MobileTopBar, useCoque, COMPACT_MEDIA, SIDEBAR_ID, NAV_TOGGLE_ID, MAIN_ID } from './AppShell';
export type { AppShellProps, MobileTopBarProps } from './AppShell';
export { Sidebar, PageSearch, NavList, NavSections, NavSection, NavGroup, NavEntry, matchPages } from './Sidebar';
export type { SidebarProps, PageSearchProps, PageHit, NavEntryProps, NavSectionProps } from './Sidebar';
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { HeaderActions, HeaderMenuContext, useHeaderMenu, splitActions, MAX_HEADER_BUTTONS } from './HeaderActions';
export type { HeaderActionsProps } from './HeaderActions';
export { HeaderTools, PrefsStack, LangSwitch, ThemeSwitch, StatusDate, THEME_EVENT } from './HeaderTools';
export type { HeaderToolsProps, PrefsStackProps, LangSwitchProps, Lang } from './HeaderTools';
export { FilterBar, FilterGroup, FilterLabel, FilterNote, FilterChips } from './FilterBar';
export type { FilterChipOption } from './FilterBar';
export { KpiGrid, KpiTile } from './Kpi';
export type { KpiTileProps } from './Kpi';
export { EmptyState } from './EmptyState';
/** Side panel of the forms (COQUE.md § 7): the Drawer, 640 px (680 wide), closed on success. */
export { Drawer as SidePanel } from './Drawer';
// Norma 2.4 — tronc commun des menus, « Mes tâches », « Mes approbations » (charte/COQUE.md § 2 bis, contrats/taches-v1.md).
export { BaseNav, BASE_ICONS } from './BaseNav';
export type { BaseNavProps } from './BaseNav';
export { BASE_ENTRIES, TOOL_BASE, TOOL_NAMES, MAX_TOOL_ENTRIES, baseNav, activeEntry, baseNavProblems } from './base-nav';
export type { BaseEntryId, BaseEntryDef, BaseIcon, BaseNavItem, BaseNavOptions, ToolBase } from './base-nav';
export { MyTasks, VIEW_LABELS, BUCKET_LABELS } from './MyTasks';
export type { MyTasksProps } from './MyTasks';
export { MyApprovals, DUE_FILTER_LABELS } from './MyApprovals';
export type { MyApprovalsProps } from './MyApprovals';
export { TaskSource, DueText, StateTag, OpenInTool, SourcesBanner, STATE_LABELS } from './TaskParts';
export * from './task-rules';
export { TACHES_FR } from './taches-fr';
