'use client';

/**
 * Form controls, dialogs, and tabs (design system §5 "still to build", delivered with
 * the records components in S4b). Controls mirror `Input`: a visible label, an optional
 * hint, an inline error linked with aria-describedby, gray-500 borders (3:1), 40px targets.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { OctagonAlert, X } from 'lucide-react';
import {
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../cn.js';

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 text-sm text-status-critical-text">
      <OctagonAlert aria-hidden="true" size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return (
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  );
}

const fieldClasses = (error?: string) =>
  cn(
    'focus-ring mt-1 block min-h-10 w-full rounded-control border bg-white px-3 py-2 text-base text-gray-900',
    'disabled:bg-gray-100',
    error ? 'border-status-critical-text' : 'border-gray-500',
  );

function Label({
  id,
  label,
  required,
}: {
  id: string;
  label: string;
  required?: string | undefined;
}) {
  return (
    <label htmlFor={id} className="block text-sm font-semibold text-gray-900">
      {label}
      {required && <span className="ml-1 font-normal text-gray-700">{required}</span>}
    </label>
  );
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** Visible "(required)" marker text; the control also gets aria-required. */
  requiredText?: string | undefined;
  ref?: Ref<HTMLSelectElement>;
  children: ReactNode;
};

export function Select({
  id,
  label,
  hint,
  error,
  requiredText,
  className,
  ref,
  children,
  ...rest
}: SelectProps) {
  return (
    <div className={className}>
      <Label id={id} label={label} required={requiredText} />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-gray-500">
          {hint}
        </p>
      )}
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-required={requiredText ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={fieldClasses(error)}
        {...rest}
      >
        {children}
      </select>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  requiredText?: string | undefined;
  ref?: Ref<HTMLTextAreaElement>;
};

export function Textarea({
  id,
  label,
  hint,
  error,
  requiredText,
  className,
  ref,
  ...rest
}: TextareaProps) {
  return (
    <div className={className}>
      <Label id={id} label={label} required={requiredText} />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-gray-500">
          {hint}
        </p>
      )}
      <textarea
        ref={ref}
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-required={requiredText ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={fieldClasses(error)}
        {...rest}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/** A checkbox with its label; the 20px box sits in a 40px hit area. */
export function Checkbox({
  id,
  label,
  checked,
  onChange,
  labelHidden = false,
  indeterminate = false,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelHidden?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="inline-flex min-h-10 min-w-10 cursor-pointer items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        aria-checked={indeterminate ? 'mixed' : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring size-5 shrink-0 cursor-pointer rounded-sm border border-gray-500 accent-navy-900"
      />
      <span className={labelHidden ? 'sr-only' : 'text-sm text-gray-900'}>{label}</span>
    </label>
  );
}

/**
 * A modal dialog on Radix Dialog (focus trap, Esc, aria-modal, focus return). Full
 * screen below 640px, like the launcher.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  size = 'md',
  onOpenAutoFocus,
}: {
  /** Where focus goes on open (default: the first focusable element). */
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] motion-safe:animate-fade-in" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
          className={cn(
            'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white p-6 outline-none',
            'sm:inset-auto sm:top-24 sm:left-1/2 sm:max-h-[calc(100dvh-8rem)] sm:-translate-x-1/2 sm:rounded-modal sm:shadow-modal',
            size === 'lg'
              ? 'sm:w-[min(720px,calc(100vw-4rem))]'
              : 'sm:w-[min(520px,calc(100vw-4rem))]',
            'motion-safe:animate-launcher-in',
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-xl font-semibold text-navy-900">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="focus-ring -mt-2 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-control text-gray-700 hover:bg-gray-100"
            >
              <X aria-hidden="true" size={20} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description asChild>
              <div className="mt-2 text-sm text-gray-700">{description}</div>
            </Dialog.Description>
          )}
          <div className="mt-4 flex flex-col gap-4">{children}</div>
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A side drawer (record create and detail), full screen below 640px. */
export function Drawer({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] motion-safe:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-white shadow-modal outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[min(560px,100vw)]"
        >
          <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
            <Dialog.Title className="text-xl font-semibold text-navy-900">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-control text-gray-700 hover:bg-gray-100"
            >
              <X aria-hidden="true" size={20} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type TabItem = { id: string; label: string; badge?: ReactNode };

/**
 * WAI-ARIA tabs with automatic activation: arrow keys move between tabs (wrapping),
 * Home and End jump to the ends, and only the selected tab is in the Tab order.
 */
export function Tabs({
  label,
  tabs,
  selected,
  onSelect,
  panel,
}: {
  label: string;
  tabs: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  panel: ReactNode;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === selected),
  );

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id);
    refs.current[tab.id]?.focus();
  }

  const current = tabs[index];
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-1 border-b border-gray-200"
      >
        {tabs.map((tab) => {
          const active = tab.id === current?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'focus-ring -mb-px inline-flex min-h-11 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold',
                active
                  ? 'border-teal-400 text-navy-900'
                  : 'border-transparent text-gray-700 hover:text-navy-900',
              )}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={current ? `${base}-tab-${current.id}` : undefined}
        tabIndex={0}
        className="pt-6 outline-none focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        {panel}
      </div>
    </div>
  );
}

/** Chip for a catalog requirement id (`CitationChip`, design system §5). */
export function CitationChip({ id, label }: { id: string; label: string }) {
  return (
    <span
      title={label}
      className="inline-flex items-center rounded-full border border-gray-500 bg-white px-2.5 py-0.5 font-mono text-xs font-medium text-navy-900"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{id}</span>
    </span>
  );
}
