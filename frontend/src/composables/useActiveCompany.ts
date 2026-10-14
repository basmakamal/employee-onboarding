import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';
import { usePreferencesStore } from '../stores/preferences';

/**
 * The selected company's name in the current language. Pages whose data
 * belongs to one company (lists, automation, templates, calendar, mail
 * settings…) say whose data they show.
 */
export function useActiveCompanyName() {
  const auth = useAuthStore();
  const prefs = usePreferencesStore();
  return computed(() => {
    const c = auth.user?.activeCompany;
    if (!c) return '';
    return prefs.locale === 'ar' ? c.nameAr : c.nameEn;
  });
}
