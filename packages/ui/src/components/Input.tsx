import { OctagonAlert } from 'lucide-react';
import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../cn.js';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string | undefined;
  /** Inline validation message. Sets aria-invalid and is announced with the field. */
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
};

/**
 * Labelled text input with hint and inline error. The border is gray-500 (not
 * gray-200) so the field boundary meets 3:1 non-text contrast (WCAG 1.4.11).
 */
export function Input({ id, label, hint, error, className, ref, ...rest }: InputProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-900">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-gray-500">
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'focus-ring mt-1 block min-h-10 w-full rounded-control border bg-white px-3 py-2 text-base text-gray-900',
          'placeholder:text-gray-500 disabled:bg-gray-100',
          error ? 'border-status-critical-text' : 'border-gray-500',
        )}
        {...rest}
      />
      {error && (
        <p id={errorId} className="mt-1 flex items-start gap-1.5 text-sm text-status-critical-text">
          <OctagonAlert
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0"
          />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
