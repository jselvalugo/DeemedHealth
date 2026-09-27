import { toLocale, type Locale } from '@deemed/i18n';

export const LOCALE_COOKIE = 'dh_lang';

/** Persist the UI language (not sensitive, so readable by the client). */
export function setLocaleCookie(locale: Locale): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** Read the UI language in client-only contexts such as error boundaries. */
export function readLocaleCookie(): Locale {
  if (typeof document === 'undefined') return 'en';
  const match = document.cookie.match(/(?:^|;\s*)dh_lang=([^;]+)/);
  return toLocale(match?.[1]);
}
