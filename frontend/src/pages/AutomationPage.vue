<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import YearCalendar from '../components/YearCalendar.vue';

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

interface HolidayRow {
  id: string;
  date: string;
  name: string;
}

/** JS getUTCDay() numbering: 0=Sun … 5=Fri, 6=Sat. */
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const { t } = useI18n();
const rules = ref<SlaRuleRow[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

const weekendDays = ref<number[]>([5, 6]);
const holidays = ref<HolidayRow[]>([]);
const newHoliday = ref({ date: '', name: '' });
const calendarBusy = ref(false);
const viewYear = ref(new Date().getFullYear());
const showYearView = ref(false);

const holidayMap = computed(() =>
  Object.fromEntries(holidays.value.map((h) => [h.date.slice(0, 10), h.name])),
);

async function generateYear() {
  calendarBusy.value = true;
  try {
    const result = await api.post<{ created: number }>('/api/settings/holidays/generate', {
      year: viewYear.value,
    });
    notify(t('calendar.generated', { n: result.created }));
    showYearView.value = true;
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    calendarBusy.value = false;
  }
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  const [ruleRows, calendar] = await Promise.all([
    api.get<SlaRuleRow[]>('/api/settings/sla'),
    api.get<{ weekendDays: number[]; holidays: HolidayRow[] }>('/api/settings/calendar'),
  ]);
  rules.value = ruleRows;
  weekendDays.value = calendar.weekendDays;
  holidays.value = calendar.holidays;
  loaded.value = true;
}

async function saveWeekend(days: number[]) {
  if (days.length > 6) return;
  calendarBusy.value = true;
  try {
    await api.put('/api/settings/calendar', { weekendDays: days });
    weekendDays.value = days;
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    calendarBusy.value = false;
  }
}

async function addHoliday() {
  calendarBusy.value = true;
  try {
    await api.post('/api/settings/holidays', {
      date: newHoliday.value.date,
      name: newHoliday.value.name.trim(),
    });
    newHoliday.value = { date: '', name: '' };
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    calendarBusy.value = false;
  }
}

async function removeHoliday(id: string) {
  calendarBusy.value = true;
  try {
    await api.delete(`/api/settings/holidays/${id}`);
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    calendarBusy.value = false;
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
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('sla.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('sla.subtitle') }}</p>

    <!-- Work calendar: the system's definition of "working days" -->
    <v-card v-if="loaded" class="mb-6" :title="$t('calendar.title')" :subtitle="$t('calendar.subtitle')">
      <v-card-text>
        <div class="text-subtitle-2 font-weight-bold mb-2">{{ $t('calendar.weekend') }}</div>
        <v-chip-group
          :model-value="weekendDays"
          multiple
          column
          selected-class="text-primary"
          :disabled="calendarBusy"
          @update:model-value="(days: unknown) => saveWeekend(days as number[])"
        >
          <v-chip v-for="day in DAYS" :key="day" :value="day" filter variant="tonal">
            {{ $t(`calendar.days.${day}`) }}
          </v-chip>
        </v-chip-group>
        <p class="text-caption text-medium-emphasis mt-1">{{ $t('calendar.weekendHint') }}</p>

        <v-divider class="my-4" />

        <div class="text-subtitle-2 font-weight-bold mb-2">{{ $t('calendar.holidays') }}</div>
        <v-list v-if="holidays.length" density="compact">
          <v-list-item v-for="holiday in holidays" :key="holiday.id">
            <template #prepend>
              <v-icon icon="mdi-calendar-star" color="warning" />
            </template>
            <v-list-item-title>{{ holiday.name }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ new Date(holiday.date).toLocaleDateString() }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn
                icon="mdi-delete"
                variant="text"
                size="small"
                color="error"
                :disabled="calendarBusy"
                @click="removeHoliday(holiday.id)"
              />
            </template>
          </v-list-item>
        </v-list>
        <p v-else class="text-medium-emphasis mb-3">{{ $t('calendar.noHolidays') }}</p>

        <div class="d-flex align-center flex-wrap mt-2" style="gap: 8px">
          <v-text-field
            v-model="newHoliday.date"
            :label="$t('calendar.date')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 200px"
          />
          <v-text-field
            v-model="newHoliday.name"
            :label="$t('calendar.name')"
            density="compact"
            hide-details
            style="max-width: 280px"
          />
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-plus"
            :loading="calendarBusy"
            :disabled="!newHoliday.date || !newHoliday.name.trim()"
            @click="addHoliday"
          >
            {{ $t('calendar.add') }}
          </v-btn>
        </div>

        <v-divider class="my-4" />

        <!-- Auto-generate + year view -->
        <div class="d-flex align-center flex-wrap" style="gap: 8px">
          <v-text-field
            v-model.number="viewYear"
            :label="$t('calendar.year')"
            type="number"
            density="compact"
            hide-details
            style="max-width: 130px"
          />
          <v-btn
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-calendar-import"
            :loading="calendarBusy"
            @click="generateYear"
          >
            {{ $t('calendar.generate') }}
          </v-btn>
          <v-btn
            variant="text"
            :prepend-icon="showYearView ? 'mdi-eye-off' : 'mdi-calendar-month'"
            @click="showYearView = !showYearView"
          >
            {{ showYearView ? $t('calendar.hideYear') : $t('calendar.showYear') }}
          </v-btn>
        </div>
        <p class="text-caption text-medium-emphasis mt-1">{{ $t('calendar.generateHint') }}</p>

        <YearCalendar
          v-if="showYearView"
          class="mt-4"
          :year="viewYear"
          :weekend-days="weekendDays"
          :holidays="holidayMap"
        />
      </v-card-text>
    </v-card>

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
