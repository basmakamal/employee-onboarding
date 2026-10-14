import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { api } from '../api/client';
import { useAuthStore } from './auth';
import { usePreferencesStore } from './preferences';

export interface ListValueDto {
  id?: string;
  code: string;
  labelAr: string;
  labelEn: string;
  sortOrder: number;
  active: boolean;
  system?: boolean;
}

export interface ListDto {
  key: string;
  kind: 'enum' | 'free';
  nameAr: string;
  nameEn: string;
  publicForm: boolean;
  allowOther: boolean;
  values: ListValueDto[];
}

export interface SelectItem {
  title: string;
  value: string;
}

/**
 * The dropdown lists of the selected company (each company has its own),
 * fetched once and read everywhere a form needs choices or a chip needs a
 * label. Switching company drops them so the next read fetches the new
 * company's lists. The public data form loads its subset through its link.
 */
export const useListsStore = defineStore('lists', () => {
  const lists = ref<ListDto[]>([]);
  const loaded = ref(false);
  let pending: Promise<void> | null = null;

  const prefs = usePreferencesStore();
  const auth = useAuthStore();

  function fetch(url: string): Promise<void> {
    if (pending) return pending;
    pending = api
      .get<{ lists: ListDto[] }>(url)
      .then((res) => {
        lists.value = res.lists;
        loaded.value = true;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  /** Every list, for signed-in staff. */
  function load(force = false): Promise<void> {
    if (loaded.value && !force) return Promise.resolve();
    return fetch('/api/lists');
  }

  /** The data form's lists — the new hire's company, found through their signed link. */
  function loadPublic(token: string): Promise<void> {
    return fetch(`/api/link/${encodeURIComponent(token)}/lists`);
  }

  // Another company was selected (or the user signed out): its lists are different.
  watch(
    () => auth.user?.activeCompany?.id ?? null,
    (now, before) => {
      if (now === before) return;
      lists.value = [];
      loaded.value = false;
    },
  );

  /** First read from a signed-in page pulls the lists in; public pages load explicitly. */
  function ensureLoaded() {
    if (!loaded.value && !pending && auth.user) void load().catch(() => undefined);
  }

  const byKey = computed(() => new Map(lists.value.map((l) => [l.key, l])));

  function labelOf(v: ListValueDto): string {
    return prefs.locale === 'ar' ? v.labelAr : v.labelEn;
  }

  function nameOf(l: ListDto): string {
    return prefs.locale === 'ar' ? l.nameAr : l.nameEn;
  }

  /** Active values of one list, in order. */
  function values(key: string): ListValueDto[] {
    ensureLoaded();
    return byKey.value.get(key)?.values.filter((v) => v.active) ?? [];
  }

  /** Ready for a v-select / v-combobox: title in the current language, value = code. */
  function items(key: string): SelectItem[] {
    return values(key).map((v) => ({ title: labelOf(v), value: v.code }));
  }

  /** The label for a stored code, or undefined when the code is not in the list. */
  function label(key: string, code: string | null | undefined): string | undefined {
    if (!code) return undefined;
    ensureLoaded();
    const v = byKey.value.get(key)?.values.find((x) => x.code === code);
    return v ? labelOf(v) : undefined;
  }

  function allowOther(key: string): boolean {
    return byKey.value.get(key)?.allowOther ?? false;
  }

  return { lists, loaded, load, loadPublic, values, items, label, labelOf, nameOf, allowOther };
});
