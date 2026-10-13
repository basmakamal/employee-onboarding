/**
 * The active company's placement options for employee forms: the branch /
 * department tree (indented), the job titles, and a manager search. Loaded
 * once per page; the server re-validates every id it receives, so these are
 * conveniences, not controls.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';

interface Unit { id: string; code: string; nameAr: string; nameEn: string; depth: number; active: boolean }
interface Title { id: string; code: string; titleAr: string; titleEn: string; active: boolean }
interface EmployeeHit { id: string; employeeNo: string | null; firstName: string; lastName: string; jobTitle: string | null }

export function useOrgOptions() {
  const { locale } = useI18n();
  const ar = computed(() => locale.value.startsWith('ar'));
  const units = ref<Unit[]>([]);
  const titles = ref<Title[]>([]);
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const [u, t] = await Promise.all([api.get<Unit[]>('/api/org/units'), api.get<Title[]>('/api/org/positions')]);
      units.value = u;
      titles.value = t;
    } catch {
      // Without a company (or the permission) the selects simply stay empty.
    } finally {
      loaded.value = true;
    }
  }

  const unitItems = computed(() =>
    units.value
      .filter((u) => u.active)
      .map((u) => ({ title: `${'— '.repeat(u.depth)}${ar.value ? u.nameAr : u.nameEn}`, value: u.id, props: { subtitle: u.code } })),
  );
  const titleItems = computed(() =>
    titles.value.filter((t) => t.active).map((t) => ({ title: ar.value ? t.titleAr : t.titleEn, value: t.id, props: { subtitle: t.code } })),
  );

  /** Server search for the direct manager — keeps the dropdown small on big companies. */
  const managerHits = ref<Array<{ title: string; value: string; props: { subtitle: string } }>>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function searchManagers(q: string, excludeId?: string) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: EmployeeHit[] }>(`/api/employees?page=1&limit=20&q=${encodeURIComponent(q ?? '')}`);
        managerHits.value = res.items
          .filter((e) => e.id !== excludeId)
          .map((e) => ({ title: `${e.firstName} ${e.lastName}`, value: e.id, props: { subtitle: [e.employeeNo, e.jobTitle].filter(Boolean).join(' · ') } }));
      } catch {
        managerHits.value = [];
      }
    }, 200);
  }
  /** Seed the list with the current manager so the field shows a name, not an id. */
  function presetManager(manager: { id: string; firstName: string; lastName: string } | null | undefined) {
    if (!manager) return;
    managerHits.value = [{ title: `${manager.firstName} ${manager.lastName}`, value: manager.id, props: { subtitle: '' } }];
  }

  return { load, loaded, unitItems, titleItems, managerHits, searchManagers, presetManager, hasUnits: computed(() => units.value.length > 0), hasTitles: computed(() => titles.value.length > 0) };
}
