<script setup lang="ts">
/**
 * One number that matters, with an optional trend line and a chip that says
 * whether that is good news. The sparkline is drawn from raw counts; it has
 * no axis on purpose — it shows direction, the number shows magnitude.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value: number | string;
    to?: string;
    /** Weekly counts, oldest first. */
    trend?: number[];
    trendLabel?: string;
    /** Semantic tone for the value / chip. */
    tone?: 'neutral' | 'good' | 'warn' | 'bad';
    chip?: string;
  }>(),
  { tone: 'neutral' },
);

const W = 120;
const H = 34;

const line = computed(() => {
  const t = props.trend;
  if (!t || t.length < 2) return null;
  const max = Math.max(...t, 1);
  const step = W / (t.length - 1);
  const pts = t.map((v, i) => [i * step, H - 4 - (v / max) * (H - 8)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  return { d, area: `${d} L${W} ${H} L0 ${H} Z`, last };
});

const toneColor = computed(
  () =>
    ({ neutral: 'primary', good: 'success', warn: 'warning', bad: 'error' })[props.tone],
);
</script>

<template>
  <v-card :to="to" class="kpi" :class="[`kpi--${tone}`, { 'kpi--link': !!to }]">
    <div class="kpi__top">
      <span class="kpi__label">{{ label }}</span>
      <v-chip v-if="chip" size="x-small" :color="toneColor" class="font-weight-semibold">{{ chip }}</v-chip>
    </div>
    <div class="kpi__value display-number tnum">{{ value }}</div>
    <svg v-if="line" class="kpi__spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
      <path :d="line.area" class="kpi__area" />
      <path :d="line.d" class="kpi__line" />
      <circle :cx="line.last[0]" :cy="line.last[1]" r="3" class="kpi__dot" />
    </svg>
    <div v-if="trendLabel" class="kpi__trend-label text-caption text-medium-emphasis">{{ trendLabel }}</div>
  </v-card>
</template>

<style scoped>
.kpi {
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 118px;
  transition: transform 180ms var(--app-ease), box-shadow 180ms var(--app-ease);
}
.kpi--link:hover { transform: translateY(-2px); box-shadow: var(--app-shadow-md) !important; }
.kpi__top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.kpi__label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.kpi__value { font-size: 28px; font-weight: 700; line-height: 1; }
.kpi--warn .kpi__value { color: rgb(var(--v-theme-warning)); }
.kpi--bad .kpi__value { color: rgb(var(--v-theme-error)); }
.kpi__spark { width: 100%; height: 34px; margin-top: 2px; }
.kpi__line { fill: none; stroke: rgb(var(--v-theme-primary)); stroke-width: 2; stroke-linejoin: round; }
.kpi__area { fill: rgb(var(--v-theme-primary)); opacity: 0.12; }
.kpi__dot { fill: rgb(var(--v-theme-primary)); }
.kpi--warn .kpi__line, .kpi--warn .kpi__dot { stroke: rgb(var(--v-theme-warning)); fill: rgb(var(--v-theme-warning)); }
.kpi--warn .kpi__line { fill: none; }
.kpi--warn .kpi__area { fill: rgb(var(--v-theme-warning)); }
.kpi__trend-label { margin-top: -2px; }
</style>
