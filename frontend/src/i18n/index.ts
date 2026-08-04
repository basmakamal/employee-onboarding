import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import ar from './locales/ar.json';

export type Locale = 'ar' | 'en';

export const i18n = createI18n({
  legacy: false,
  locale: (localStorage.getItem('locale') as Locale) ?? 'ar',
  fallbackLocale: 'en',
  messages: { en, ar },
});
