<script setup lang="ts">
/**
 * A row of days with the shift(s) of each — the shared cell look used by
 * the team schedule, the employee file and My space. Rest days are muted,
 * holidays marked, days without any schedule left empty.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export interface DayShift { id: string; code: string; nameAr: string; nameEn: string; startTime: string; endTime: string; color: string | null; overnight: boolean }
export interface Day { date: string; assignmentId: string | null; temporary: boolean; shifts: DayShift[]; rest: boolean; holiday: string | null }

const props = defineProps<{ days: Day[]; compact?: boolean }>();
const { locale } = useI18n();
const ar = computed(() => locale.value.startsWith('ar'));
const wd = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
const dm = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
void props;
</script>

<template>
  <div class="strip" :class="{ 'strip--compact': compact }">
    <div v-for="d in days" :key="d.date" class="cell" :class="{ 'cell--today': d.date === today, 'cell--holiday': !!d.holiday, 'cell--rest': d.rest, 'cell--temp': d.temporary }" :title="d.holiday ?? ''">
      <div v-if="!compact" class="cell__date">
        <span class="cell__wd">{{ wd(d.date) }}</span>
        <span class="cell__dm">{{ dm(d.date) }}</span>
      </div>
      <template v-if="d.holiday">
        <span class="cell__tag cell__tag--holiday">{{ compact ? '★' : d.holiday }}</span>
      </template>
      <template v-else-if="d.shifts.length">
        <span v-for="s in d.shifts" :key="s.id" class="cell__tag" :style="{ '--c': s.color ?? '#5b3fd1' }" :title="`${ar ? s.nameAr : s.nameEn} ${s.startTime}–${s.endTime}`">
          <span>{{ s.code }}</span>
          <span v-if="!compact" class="cell__time" dir="ltr">{{ s.startTime }}–{{ s.endTime }}</span>
        </span>
      </template>
      <span v-else-if="d.rest" class="cell__tag cell__tag--rest">{{ $t('shifts.restShort') }}</span>
      <span v-else class="cell__none">—</span>
    </div>
  </div>
</template>

<style scoped>
.strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
.strip--compact { display: flex; gap: 4px; flex-wrap: nowrap; }
.cell { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 4px; min-height: 56px; }
.strip--compact .cell { min-height: 0; width: 46px; flex: 0 0 46px; padding: 4px 2px; align-items: center; justify-content: center; }
.cell--today { border-color: rgb(var(--v-theme-primary)); box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary)); }
.cell--temp { border-style: dashed; }
.cell__date { display: flex; justify-content: space-between; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.6); }
.cell__wd { font-weight: 600; }
.cell__tag { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px; font-size: 11.5px; font-weight: 600; border-radius: 5px; padding: 2px 5px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.cell__time { font-weight: 400; opacity: 0.85; }
.cell__tag--rest { --c: rgb(var(--v-theme-on-surface)); opacity: 0.55; }
.cell__tag--holiday { --c: rgb(var(--v-theme-warning)); }
.cell__none { color: rgba(var(--v-theme-on-surface), 0.35); font-size: 12px; }
</style>
