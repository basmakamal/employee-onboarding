<script setup lang="ts">
/**
 * Lists — every dropdown in the system, in both languages.
 *
 * Two kinds of list. Fixed lists are the codes the workflow and the database
 * rely on (statuses, user groups, gender…): their labels and order can
 * change, nothing else. Open lists (departments, nationalities, asset
 * types…) grow: admins add here, staff add by typing in a form, and the
 * public data form may offer "Other" where a new hire cannot add anything.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useListsStore, type ListDto, type ListValueDto } from '../stores/lists';
import { useConfirm } from '../composables/useConfirm';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const lists = useListsStore();
const confirm = useConfirm();

const selectedKey = ref('');
const search = ref('');
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const adding = ref({ labelAr: '', labelEn: '' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

void lists.load(true);

watch(
  () => lists.lists,
  (all) => {
    if (!selectedKey.value && all.length) selectedKey.value = all[0]!.key;
  },
  { immediate: true },
);

const selected = computed<ListDto | undefined>(() => lists.lists.find((l) => l.key === selectedKey.value));
const isFree = computed(() => selected.value?.kind === 'free');

/** Editable copies of the rows, so a typo is not saved keystroke by keystroke. */
const rows = ref<ListValueDto[]>([]);
watch(
  selected,
  (l) => {
    rows.value = (l?.values ?? []).map((v) => ({ ...v }));
    adding.value = { labelAr: '', labelEn: '' };
  },
  { immediate: true },
);

const visibleRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(
    (r) => r.code.toLowerCase().includes(q) || r.labelAr.includes(q) || r.labelEn.toLowerCase().includes(q),
  );
});

function original(id: string | undefined): ListValueDto | undefined {
  return selected.value?.values.find((v) => v.id === id);
}

function dirty(row: ListValueDto): boolean {
  const o = original(row.id);
  return !!o && (o.labelAr !== row.labelAr || o.labelEn !== row.labelEn);
}

async function save(row: ListValueDto, patch?: Partial<ListValueDto>) {
  if (!selected.value || !row.id) return;
  busy.value = row.id;
  try {
    await api.put(`/api/lists/${selected.value.key}/values/${row.id}`, {
      labelAr: row.labelAr,
      labelEn: row.labelEn,
      ...(patch ?? {}),
    });
    await lists.load(true);
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function move(row: ListValueDto, dir: -1 | 1) {
  const i = rows.value.findIndex((r) => r.id === row.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.value.length || !selected.value) return;
  const a = rows.value[i]!;
  const b = rows.value[j]!;
  busy.value = a.id ?? '';
  try {
    // Swap the two sort orders; the list re-sorts on reload.
    await Promise.all([
      api.put(`/api/lists/${selected.value.key}/values/${a.id}`, { sortOrder: b.sortOrder }),
      api.put(`/api/lists/${selected.value.key}/values/${b.id}`, { sortOrder: a.sortOrder }),
    ]);
    await lists.load(true);
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function add() {
  if (!selected.value) return;
  const labelAr = adding.value.labelAr.trim();
  const labelEn = adding.value.labelEn.trim();
  if (!labelAr && !labelEn) return;
  busy.value = 'add';
  try {
    await api.post(`/api/lists/${selected.value.key}/values`, {
      labelAr: labelAr || labelEn,
      labelEn: labelEn || labelAr,
    });
    adding.value = { labelAr: '', labelEn: '' };
    await lists.load(true);
    notify(t('lists.added'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function remove(row: ListValueDto) {
  if (!selected.value || !row.id) return;
  const ok = await confirm({
    title: t('lists.deleteTitle'),
    message: t('lists.deleteConfirm', { name: lists.labelOf(row) }),
    color: 'error',
    confirmText: t('common.delete'),
  });
  if (!ok) return;
  busy.value = row.id;
  try {
    await api.delete(`/api/lists/${selected.value.key}/values/${row.id}`);
    await lists.load(true);
    notify(t('lists.deleted'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <v-container fluid class="pa-4 pa-md-6">
    <PageHeader :title="$t('lists.title')" :subtitle="$t('lists.subtitle')" />

    <v-row>
      <!-- Which list -->
      <v-col cols="12" md="4" lg="3">
        <v-card>
          <v-list density="compact" nav :selected="[selectedKey]" @update:selected="(v) => (selectedKey = String(v[0] ?? selectedKey))">
            <v-list-item
              v-for="l in lists.lists"
              :key="l.key"
              :value="l.key"
              :title="lists.nameOf(l)"
              :subtitle="$t('lists.valuesCount', { n: l.values.length })"
              :prepend-icon="l.kind === 'enum' ? 'lock' : 'list-checks'"
            />
          </v-list>
        </v-card>
      </v-col>

      <!-- The values -->
      <v-col cols="12" md="8" lg="9">
        <v-card v-if="selected">
          <v-card-item>
            <v-card-title class="d-flex align-center ga-2 flex-wrap">
              {{ lists.nameOf(selected) }}
              <v-chip size="x-small" variant="tonal" :color="isFree ? 'primary' : 'secondary'">
                {{ isFree ? $t('lists.kindFree') : $t('lists.kindEnum') }}
              </v-chip>
              <v-chip v-if="selected.publicForm" size="x-small" variant="tonal" color="info">
                {{ $t('lists.publicForm') }}
              </v-chip>
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              {{ isFree ? $t('lists.freeHint') : $t('lists.fixedHint') }}
              <template v-if="selected.allowOther"> {{ $t('lists.otherHint') }}</template>
            </v-card-subtitle>
          </v-card-item>

          <v-card-text>
            <v-text-field
              v-model="search"
              :placeholder="$t('common.search')"
              prepend-inner-icon="search"
              density="compact"
              hide-details
              clearable
              class="mb-4"
              style="max-width: 360px"
            />

            <div class="table-wrap">
              <table class="values">
                <thead>
                  <tr>
                    <th class="text-start" style="width: 22%">{{ $t('lists.code') }}</th>
                    <th class="text-start">{{ $t('lists.labelAr') }}</th>
                    <th class="text-start">{{ $t('lists.labelEn') }}</th>
                    <th v-if="isFree" class="text-center" style="width: 90px">{{ $t('lists.active') }}</th>
                    <th style="width: 150px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in visibleRows" :key="row.id ?? row.code" :class="{ 'row--off': !row.active }">
                    <td dir="ltr" class="code">{{ row.code }}</td>
                    <td>
                      <v-text-field v-model="row.labelAr" density="compact" hide-details variant="outlined" dir="rtl" @keyup.enter="save(row)" />
                    </td>
                    <td>
                      <v-text-field v-model="row.labelEn" density="compact" hide-details variant="outlined" dir="ltr" @keyup.enter="save(row)" />
                    </td>
                    <td v-if="isFree" class="text-center">
                      <v-switch
                        :model-value="row.active"
                        hide-details
                        density="compact"
                        color="primary"
                        class="d-inline-flex"
                        :disabled="busy === row.id"
                        @update:model-value="(v) => save(row, { active: !!v })"
                      />
                    </td>
                    <td>
                      <div class="d-flex justify-end ga-1 flex-nowrap">
                        <v-tooltip :text="$t('common.save')" location="top">
                          <template #activator="{ props }">
                            <v-btn
                              v-bind="props"
                              icon="check"
                              size="small"
                              variant="text"
                              density="comfortable"
                              color="primary"
                              :disabled="!dirty(row)"
                              :loading="busy === row.id"
                              :aria-label="$t('common.save')"
                              @click="save(row)"
                            />
                          </template>
                        </v-tooltip>
                        <v-btn icon="chevron-up" size="small" variant="text" density="comfortable" :disabled="i === 0 || !!search" :aria-label="$t('lists.moveUp')" @click="move(row, -1)" />
                        <v-btn icon="chevron-down" size="small" variant="text" density="comfortable" :disabled="i === visibleRows.length - 1 || !!search" :aria-label="$t('lists.moveDown')" @click="move(row, 1)" />
                        <v-tooltip v-if="isFree && !row.system" :text="$t('common.delete')" location="top">
                          <template #activator="{ props }">
                            <v-btn
                              v-bind="props"
                              icon="trash-2"
                              size="small"
                              variant="text"
                              density="comfortable"
                              color="error"
                              :aria-label="$t('common.delete')"
                              @click="remove(row)"
                            />
                          </template>
                        </v-tooltip>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="visibleRows.length === 0">
                    <td :colspan="isFree ? 5 : 4" class="text-center text-medium-emphasis py-6">{{ $t('lists.empty') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Add to an open list -->
            <div v-if="isFree" class="add mt-5">
              <div class="text-body-2 font-weight-semibold mb-2">{{ $t('lists.addValue') }}</div>
              <div class="d-flex flex-wrap ga-2 align-center">
                <v-text-field v-model="adding.labelAr" :label="$t('lists.labelAr')" density="compact" hide-details dir="rtl" style="min-width: 220px" @keyup.enter="add" />
                <v-text-field v-model="adding.labelEn" :label="$t('lists.labelEn')" density="compact" hide-details dir="ltr" style="min-width: 220px" @keyup.enter="add" />
                <v-btn color="primary" variant="flat" prepend-icon="plus" :loading="busy === 'add'" :disabled="!adding.labelAr.trim() && !adding.labelEn.trim()" @click="add">
                  {{ $t('lists.add') }}
                </v-btn>
              </div>
              <p class="text-caption text-medium-emphasis mt-2 mb-0">{{ $t('lists.addHint') }}</p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.table-wrap { overflow-x: auto; }
.values { width: 100%; border-collapse: collapse; }
.values th {
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 6px 8px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.values td { padding: 6px 8px; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); vertical-align: middle; }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: rgba(var(--v-theme-on-surface), 0.7); }
.row--off td { opacity: 0.55; }
.add {
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 12px;
  padding: 14px 16px;
}
</style>
