<script setup lang="ts">
/**
 * Reporting lines: who reports to whom, as an indented tree of the active
 * people the user may see. Someone whose manager is outside that view (or
 * who has none) starts a branch at the top. Rows open the employee file.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import EmptyState from './EmptyState.vue';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string | null;
  managerId: string | null;
  position: { titleAr: string; titleEn: string } | null;
  orgUnit: { nameAr: string; nameEn: string } | null;
}
interface Row { person: Person; depth: number; reports: number }

const { locale } = useI18n();
const people = ref<Person[]>([]);
const loading = ref(true);
const q = ref('');
const collapsed = ref<Set<string>>(new Set());

onMounted(async () => {
  try {
    people.value = await api.get<Person[]>('/api/org/reporting');
  } finally {
    loading.value = false;
  }
});

const ar = computed(() => locale.value.startsWith('ar'));
const byManager = computed(() => {
  const ids = new Set(people.value.map((p) => p.id));
  const map = new Map<string | null, Person[]>();
  for (const p of people.value) {
    const parent = p.managerId && ids.has(p.managerId) && p.managerId !== p.id ? p.managerId : null;
    map.set(parent, [...(map.get(parent) ?? []), p]);
  }
  return map;
});

/** Depth-first rows; a loop in the data (A→B→A) is cut where it repeats. */
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const p of byManager.value.get(parent) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const reports = byManager.value.get(p.id)?.length ?? 0;
      out.push({ person: p, depth, reports });
      if (!collapsed.value.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

const filtered = computed(() => {
  const term = q.value.trim().toLowerCase();
  if (!term) return rows.value;
  return rows.value.filter(({ person: p }) => `${p.firstName} ${p.lastName} ${p.employeeNo ?? ''}`.toLowerCase().includes(term));
});

function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}
const title = (p: Person) => (p.position ? (ar.value ? p.position.titleAr : p.position.titleEn) : '');
const unit = (p: Person) => (p.orgUnit ? (ar.value ? p.orgUnit.nameAr : p.orgUnit.nameEn) : '');
</script>

<template>
  <v-card>
    <div class="pa-4 pb-0">
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 320px" />
    </div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mt-3" />
    <EmptyState v-else-if="people.length === 0" icon="fluent:people-team" :title="$t('org.reportingEmpty')" compact />
    <v-list v-else density="compact" class="py-2">
      <v-list-item
        v-for="r in filtered"
        :key="r.person.id"
        :to="`/employees/${r.person.id}`"
        :style="{ paddingInlineStart: `${16 + (q ? 0 : r.depth) * 24}px` }"
      >
        <template #prepend>
          <v-btn
            v-if="r.reports && !q"
            :icon="collapsed.has(r.person.id) ? 'chevron-right' : 'chevron-down'"
            variant="text"
            size="x-small"
            class="flip-rtl me-1"
            @click.prevent.stop="toggle(r.person.id)"
          />
          <span v-else class="d-inline-block me-1" style="width: 28px" />
        </template>
        <v-list-item-title class="text-body-2 font-weight-medium">
          {{ r.person.firstName }} {{ r.person.lastName }}
          <span v-if="r.reports" class="text-caption text-medium-emphasis ms-1">· {{ $t('org.reportsCount', { n: r.reports }) }}</span>
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">{{ [title(r.person), unit(r.person)].filter(Boolean).join(' · ') }}</v-list-item-subtitle>
      </v-list-item>
    </v-list>
  </v-card>
</template>
