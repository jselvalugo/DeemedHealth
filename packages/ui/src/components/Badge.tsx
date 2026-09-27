import { CircleCheck, CircleMinus, Clock, Info, OctagonAlert, type LucideIcon } from 'lucide-react';
import { cn } from '../cn.js';

export type BadgeStatus = 'ok' | 'warn' | 'critical' | 'info' | 'neutral';

const STYLES: Record<BadgeStatus, { box: string; icon: string; Icon: LucideIcon }> = {
  ok: {
    box: 'bg-status-ok-bg text-status-ok-text',
    icon: 'text-status-ok-icon',
    Icon: CircleCheck,
  },
  warn: {
    box: 'bg-status-warn-bg text-status-warn-text',
    icon: 'text-status-warn-icon',
    Icon: Clock,
  },
  critical: {
    box: 'bg-status-critical-bg text-status-critical-text',
    icon: 'text-status-critical-icon',
    Icon: OctagonAlert,
  },
  info: {
    box: 'bg-status-info-bg text-status-info-text',
    icon: 'text-status-info-icon',
    Icon: Info,
  },
  neutral: {
    box: 'bg-status-neutral-bg text-status-neutral-text',
    icon: 'text-status-neutral-icon',
    Icon: CircleMinus,
  },
};

export type BadgeProps = {
  status: BadgeStatus;
  /** The visible label. Required: status is never conveyed by color alone. */
  children: string;
  /** Override the default status icon (still paired with the label). */
  icon?: LucideIcon;
  className?: string;
};

/** Status badge: icon + label + color, always all three (design system §1 Status). */
export function Badge({ status, children, icon, className }: BadgeProps) {
  const s = STYLES[status];
  const Glyph = icon ?? s.Icon;
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        s.box,
        className,
      )}
    >
      <Glyph aria-hidden="true" size={14} strokeWidth={1.75} className={s.icon} />
      {children}
    </span>
  );
}
