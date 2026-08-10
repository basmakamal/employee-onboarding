<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  year: number;
  weekendDays: number[];
  /** ISO date (yyyy-mm-dd) → holiday name. */
  holidays: Record<string, string>;
}>();

const { locale } = useI18n();

interface DayCell {
  day: number | null;
  weekend: boolean;
  holiday: string | null;
}

const months = computed(() => {
  const list: Array<{ name: string; cells: DayCell[] }> = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(props.year, m, 1));
    const name = first.toLocaleDateString(locale.value === 'ar' ? 'ar' : 'en', {
      month: 'long',
      timeZone: 'UTC',
    });
    const cells: DayCell[] = [];
    for (let pad = 0; pad < first.getUTCDay(); pad++) {
      cells.push({ day: null, weekend: false, holiday: null });
    }
    const days = new Date(Date.UTC(props.year, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const date = new Date(Date.UTC(props.year, m, d));
      const key = date.toISOString().slice(0, 10);
      cells.push({
        day: d,
        weekend: props.weekendDays.includes(date.getUTCDay()),
        holiday: props.holidays[key] ?? null,
      });
    }
    list.push({ name, cells });
  }
  return list;
});
</script>

<template>
  <div class="year-grid">
    <div v-for="month in months" :key="month.name" class="month">
      <div class="month-name">{{ month.name }}</div>
      <div class="days">
        <div
          v-for="(cell, i) in month.cells"
          :key="i"
          class="day"
          :class="{ weekend: cell.weekend, holiday: cell.holiday, empty: cell.day === null }"
          :title="cell.holiday ?? undefined"
        >
          {{ cell.day ?? '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.year-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
}
.month-name {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 6px;
  text-align: center;
}
.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  border-radius: 4px;
}
.day.weekend {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.day.holiday {
  background: rgba(var(--v-theme-warning), 0.25);
  font-weight: 700;
  cursor: help;
}
.day.empty {
  background: transparent;
}
</style>
