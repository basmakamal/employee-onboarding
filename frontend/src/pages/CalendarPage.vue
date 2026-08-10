<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import YearCalendar from '../components/YearCalendar.vue';

interface HolidayRow {
  id: string;
  date: string;
  name: string;
}

/** JS getUTCDay() numbering: 0=Sun … 5=Fri, 6=Sat. */
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const { t } = useI18n();
const loaded = ref(false);
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

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  const calendar = await api.get<{ weekendDays: number[]; holidays: HolidayRow[] }>(
    '/api/settings/calendar',
  );
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

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('calendar.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('calendar.subtitle') }}</p>

    <v-card v-if="loaded">
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

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
