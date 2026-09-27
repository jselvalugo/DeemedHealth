import { TriangleAlert } from 'lucide-react';
import { isProduction } from '@deemed/domain';
import { t, type Locale } from '@deemed/i18n';

/**
 * Amber PREVIEW banner (design system §4, ADR-0009). Renders for every DH_ENV except
 * exactly "production"; a missing value counts as non-production (safe default).
 */
export function PreviewBanner({ env, locale }: { env: string | undefined; locale: Locale }) {
  if (isProduction(env)) return null;
  return (
    <div
      role="region"
      aria-label={t(locale, 'preview.label')}
      data-testid="preview-banner"
      className="flex items-center justify-center gap-2 bg-preview-bg px-4 py-2 text-center text-sm font-semibold text-preview-fg"
    >
      <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0" />
      <p>{t(locale, 'preview.banner')}</p>
    </div>
  );
}
