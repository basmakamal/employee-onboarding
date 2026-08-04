<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';

interface SlaRuleRow {
  id: string;
  processKey: string;
  status: string;
  afterValue: number;
  afterUnit: 'HOURS' | 'CALENDAR_DAYS' | 'WORKING_DAYS';
  action: string;
  notifySubject: boolean;
  notifyRole: string;
  escalateToRole: string | null;
  active: boolean;
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];
const UNITS = ['HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS'];

const { t } = useI18n();
const rules = ref<SlaRuleRow[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  rules.value = await api.get<SlaRuleRow[]>('/api/settings/sla');
  loaded.value = true;
}

async function updateRule(rule: SlaRuleRow, changes: Partial<SlaRuleRow>) {
  busy.value = rule.id;
  try {
    await api.put(`/api/settings/sla/${rule.id}`, changes);
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    await load();
  }
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('sla.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('sla.subtitle') }}</p>

    <v-card v-if="loaded">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('sla.watch') }}</th>
            <th>{{ $t('sla.action') }}</th>
            <th style="width: 220px">{{ $t('sla.after') }}</th>
            <th>{{ $t('sla.notify') }}</th>
            <th>{{ $t('sla.active') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>
              <div class="font-weight-medium">{{ $t(`entities.${rule.processKey}`, rule.processKey) }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ $t(`status.${rule.status}`, $t(`offboardingStatus.${rule.status}`, $t(`processStatus.${rule.status}`, rule.status))) }}
              </div>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="rule.action === 'EXPIRE' ? 'error' : rule.action === 'ESCALATE' ? 'warning' : 'primary'"
              >
                {{ $t(`sla.actions.${rule.action}`) }}
              </v-chip>
            </td>
            <td>
              <div class="d-flex align-center" style="gap: 6px">
                <v-text-field
                  :model-value="rule.afterValue"
                  type="number"
                  min="1"
                  density="compact"
                  hide-details
                  style="max-width: 76px"
                  :disabled="busy === rule.id"
                  @change="(e: Event) => updateRule(rule, { afterValue: Number((e.target as HTMLInputElement).value) })"
                />
                <v-select
                  :model-value="rule.afterUnit"
                  :items="UNITS.map((u) => ({ title: $t(`sla.units.${u}`), value: u }))"
                  density="compact"
                  hide-details
                  variant="plain"
                  :disabled="busy === rule.id"
                  @update:model-value="(afterUnit: SlaRuleRow['afterUnit']) => updateRule(rule, { afterUnit })"
                />
              </div>
            </td>
            <td>
              <v-select
                v-if="rule.action !== 'ESCALATE'"
                :model-value="rule.notifyRole"
                :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                density="compact"
                hide-details
                variant="plain"
                style="max-width: 170px"
                :disabled="busy === rule.id"
                @update:model-value="(notifyRole: string) => updateRule(rule, { notifyRole })"
              />
              <v-select
                v-else
                :model-value="rule.escalateToRole ?? 'ADMIN'"
                :items="ROLES.map((r) => ({ title: `⬆ ${$t(`roles.${r}`)}`, value: r }))"
                density="compact"
                hide-details
                variant="plain"
                style="max-width: 170px"
                :disabled="busy === rule.id"
                @update:model-value="(escalateToRole: string) => updateRule(rule, { escalateToRole })"
              />
            </td>
            <td>
              <v-switch
                :model-value="rule.active"
                color="success"
                density="compact"
                hide-details
                :disabled="busy === rule.id"
                @update:model-value="(active: unknown) => updateRule(rule, { active: Boolean(active) })"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text class="text-caption text-medium-emphasis">
        {{ $t('sla.hint') }}
      </v-card-text>
    </v-card>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
