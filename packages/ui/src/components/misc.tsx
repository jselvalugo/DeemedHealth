import type { ReactNode } from 'react';
import { cn } from '../cn.js';
import { Icon } from '../icons.js';
import type { LucideIconName } from '../module-registry.js';
import type { Range } from '../fuzzy.js';

/** 40px icon tile: blue-50 fill, navy icon (launcher module rows, §4.3). */
export function IconTile({ name, className }: { name: LucideIconName; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-card bg-blue-50 text-navy-900',
        className,
      )}
    >
      <Icon name={name} size={20} />
    </span>
  );
}

/** Keyboard hint (`Ctrl K`, `Esc`) in JetBrains Mono. */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs font-medium text-gray-500',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** 12px uppercase eyebrow in gray-500 (§2). Text stays in sentence case for screen readers. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-xs font-semibold tracking-[0.08em] text-gray-500 uppercase', className)}>
      {children}
    </p>
  );
}

/** Text with fuzzy-match ranges wrapped in <mark>. */
export function Highlight({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly Range[] | undefined;
}) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <mark key={i} className="rounded-sm bg-blue-50 font-bold text-navy-900 underline">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * The Deemed Health "D" mark with its cross and checkmark, drawn with currentColor
 * for the D and teal-400 for the check. Used white-on-navy in the module bar.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <mask id="dh-logo-mark-cross">
          <rect width="32" height="32" fill="white" />
          <rect x="10.5" y="8" width="7" height="17" rx="1.5" fill="black" />
          <rect x="5.5" y="13" width="17" height="7" rx="1.5" fill="black" />
        </mask>
      </defs>
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3H15c7.18 0 13 5.82 13 13.5S22.18 30 15 30H5.5A2.5 2.5 0 0 1 3 27.5z"
        fill="currentColor"
        mask="url(#dh-logo-mark-cross)"
      />
      <path
        d="M9.5 16.5l3.2 3 7.3-7.5"
        fill="none"
        className="stroke-teal-400"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
