import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cn } from '../cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-700 active:bg-blue-700',
  secondary: 'border border-navy-900 bg-white text-navy-900 hover:bg-blue-50',
  ghost: 'bg-transparent text-navy-900 hover:bg-gray-100',
  danger: 'bg-status-critical-text text-white hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  // Hit targets are at least 40px (design system § Rules).
  md: 'min-h-10 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
  icon: 'size-10 p-0',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  fullWidth?: boolean | undefined;
  className?: string | undefined;
} = {}): string {
  return cn(
    'focus-ring inline-flex items-center justify-center gap-2 rounded-control font-semibold',
    'transition-colors duration-150 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-70',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner and blocks activation without removing focus from the button. */
  loading?: boolean;
  /** Replaces the label while loading (e.g. "Checking…"). */
  loadingLabel?: string;
  icon?: ReactNode;
};

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel,
  icon,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }
  return (
    <button
      {...rest}
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      onClick={handleClick}
    >
      {loading ? (
        <LoaderCircle
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className="motion-safe:animate-spin"
        />
      ) : (
        icon
      )}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
