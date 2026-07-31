import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useTheme, useLocale } from 'vuetify';
import { useI18n } from 'vue-i18n';
import type { Locale } from '../i18n';

/**
 * User preferences (language + theme), persisted to localStorage and applied
 * to Vuetify (RTL flip, colors), vue-i18n (texts), and the <html> element
 * (dir/lang) in one place.
 */
export const usePreferencesStore = defineStore('preferences', () => {
  const locale = ref<Locale>((localStorage.getItem('locale') as Locale) ?? 'ar');
  const dark = ref(localStorage.getItem('theme') === 'dark');

  const vuetifyTheme = useTheme();
  const vuetifyLocale = useLocale();
  const { locale: i18nLocale } = useI18n();

  function apply() {
    i18nLocale.value = locale.value;
    vuetifyLocale.current.value = locale.value;
    vuetifyTheme.change(dark.value ? 'dark' : 'light');
    document.documentElement.setAttribute('lang', locale.value);
    document.documentElement.setAttribute('dir', locale.value === 'ar' ? 'rtl' : 'ltr');
    document.title = locale.value === 'ar' ? 'نظام الموارد البشرية' : 'HR System';
  }

  watch(locale, (v) => {
    localStorage.setItem('locale', v);
    apply();
  });

  watch(dark, (v) => {
    localStorage.setItem('theme', v ? 'dark' : 'light');
    apply();
  });

  function toggleLocale() {
    locale.value = locale.value === 'ar' ? 'en' : 'ar';
  }

  function toggleTheme() {
    dark.value = !dark.value;
  }

  return { locale, dark, apply, toggleLocale, toggleTheme };
});
