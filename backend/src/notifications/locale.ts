import type { Locale } from './templates.js';

/**
 * Which language a person's emails go out in. Chosen by HR when the record is
 * created and confirmed by the language the person used on their data form;
 * Arabic when nothing says otherwise.
 */
export function localeOf(person: { preferredLanguage?: string | null } | null | undefined): Locale {
  return person?.preferredLanguage === 'EN' ? 'en' : 'ar';
}

/** 'ar' | 'en' from the UI → the stored enum value. */
export function languageFromLocale(locale: string | undefined): 'AR' | 'EN' | undefined {
  if (locale === 'en') return 'EN';
  if (locale === 'ar') return 'AR';
  return undefined;
}
