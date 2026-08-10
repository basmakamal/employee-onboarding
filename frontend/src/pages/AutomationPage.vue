<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
const ACTIONS = ['REMIND', 'REMIND_DAILY', 'ESCALATE', 'EXPIRE'];

/** What each watcher can watch — statuses per registered state machine. */
const WATCHABLE: Record<string, string[]> = {
  EMPLOYEE: ['CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL'],
  OFFBOARDING: ['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT'],
  GOSI: ['PENDING', 'ON_HOLD'],
  MEDICAL_INSURANCE: ['PENDING', 'ON_HOLD'],
  DOCUMENT_EXPIRY: ['ANY', 'IQAMA', 'NATIONAL_ID', 'PASSPORT', 'CONTRACT', 'WORK_PERMIT', 'DRIVING_LICENSE'],
};

const { t } = useI18n();
const rules = ref<SlaRuleRow[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

const newDialog = ref(false);
const saving = ref(false);
const newRule = ref({
  processKey: 'EMPLOYEE',
  status: 'AWAITING_FORM',
  afterValue: 3,
  afterUnit: 'CALENDAR_DAYS' as SlaRuleRow['afterUnit'],
  action: 'REMIND',
  notifySubject: false,
  notifyRole: 'HR',
  escalateToRole: 'ADMIN',
});

const statusOptions = computed(() => WATCHABLE[newRule.value.processKey] ?? []);

function statusLabel(processKey: string, status: string): string {
  if (processKey === 'DOCUMENT_EXPIRY') {
    return status === 'ANY' ? t('sla.anyType') : t(`expiryDocs.types.${status}`, status);
  }
  return t(
    `status.${status}`,
    t(`offboardingStatus.${status}`, t(`processStatus.${status}`, status)),
  );
}

function onProcessChange() {
  newRule.value.status = statusOptions.value[0] ?? '';
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  rules.value = await api.get<SlaRuleRow[]>('/api/settings/sla');
  loaded.value = true;
}

async function createRule() {
  saving.value = true;
  try {
    const body = {
      ...newRule.value,
      escalateToRole: newRule.value.action === 'ESCALATE' ? newRule.value.escalateToRole : null,
    };
    await api.post('/api/settings/sla', body);
    newDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    saving.value = false;
  }
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
    <div class="d-flex align-center flex-wrap mb-6" style="gap: 8px">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('sla.title') }}</h1>
        <p class="text-medium-emphasis mt-1">{{ $t('sla.subtitle') }}</p>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="newDialog = true">
        {{ $t('sla.addRule') }}
      </v-btn>
    </div>

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
                {{ statusLabel(rule.processKey, rule.status) }}
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

    <!-- New rule (watcher) dialog -->
    <v-dialog v-model="newDialog" max-width="560">
      <v-card :title="$t('sla.addRule')" class="pa-2">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newRule.processKey"
                :items="Object.keys(WATCHABLE).map((k) => ({ title: $t(`entities.${k}`, k), value: k }))"
                :label="$t('sla.processKey')"
                @update:model-value="onProcessChange"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newRule.status"
                :items="statusOptions.map((s) => ({ title: statusLabel(newRule.processKey, s), value: s }))"
                :label="$t('sla.status')"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newRule.action"
                :items="ACTIONS.map((a) => ({ title: $t(`sla.actions.${a}`), value: a }))"
                :label="$t('sla.action')"
              />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="newRule.afterValue" :label="$t('sla.after')" type="number" min="1" />
            </v-col>
            <v-col cols="6" sm="3">
              <v-select
                v-model="newRule.afterUnit"
                :items="UNITS.map((u) => ({ title: $t(`sla.units.${u}`), value: u }))"
                :label="$t('sla.units.WORKING_DAYS')"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-if="newRule.action !== 'ESCALATE'"
                v-model="newRule.notifyRole"
                :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                :label="$t('sla.notify')"
              />
              <v-select
                v-else
                v-model="newRule.escalateToRole"
                :items="ROLES.map((r) => ({ title: `⬆ ${$t(`roles.${r}`)}`, value: r }))"
                :label="$t('sla.notify')"
              />
            </v-col>
            <v-col cols="12" sm="6" class="d-flex align-center">
              <v-checkbox
                v-model="newRule.notifySubject"
                :label="$t('sla.notifySubject')"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
          <v-alert
            v-if="newRule.action === 'EXPIRE'"
            type="warning"
            variant="tonal"
            density="compact"
          >
            {{ $t('sla.expireHint') }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="newDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="!newRule.status || newRule.afterValue < 1"
            @click="createRule"
          >
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
