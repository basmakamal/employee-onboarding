<script setup lang="ts">
/**
 * Loading placeholders shaped like the content they stand in for, so the
 * page paints its layout before the data arrives instead of a spinner.
 *   kpis  — a row of stat cards
 *   list  — avatar + two lines, repeated
 *   table — header + rows
 *   card  — a single block
 */
withDefaults(defineProps<{ variant?: 'kpis' | 'list' | 'table' | 'card'; rows?: number }>(), {
  variant: 'card',
  rows: 4,
});
</script>

<template>
  <div class="sk" aria-busy="true" aria-live="polite">
    <template v-if="variant === 'kpis'">
      <div class="sk__kpis">
        <div v-for="i in 4" :key="i" class="sk__card">
          <span class="sk__line w-40" /><span class="sk__line h-lg w-30" /><span class="sk__line w-70" />
        </div>
      </div>
    </template>
    <template v-else-if="variant === 'list'">
      <div v-for="i in rows" :key="i" class="sk__row">
        <span class="sk__avatar" />
        <div class="flex-grow-1"><span class="sk__line w-50" /><span class="sk__line w-30 thin" /></div>
        <span class="sk__line w-15" />
      </div>
    </template>
    <template v-else-if="variant === 'table'">
      <div class="sk__row sk__row--head"><span v-for="i in 4" :key="i" class="sk__line w-20 thin" /></div>
      <div v-for="i in rows" :key="i" class="sk__row"><span v-for="j in 4" :key="j" class="sk__line" :class="j === 1 ? 'w-30' : 'w-15'" /></div>
    </template>
    <template v-else>
      <div class="sk__card"><span class="sk__line w-40" /><span class="sk__line w-90" /><span class="sk__line w-60" /></div>
    </template>
  </div>
</template>

<style scoped>
.sk { display: flex; flex-direction: column; gap: 10px; }
.sk__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.sk__card {
  display: flex; flex-direction: column; gap: 10px; padding: 18px;
  border-radius: 16px; background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.sk__row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; }
.sk__row--head { opacity: .7; }
.sk__avatar { width: 34px; height: 34px; border-radius: 50%; flex: none; }
.sk__line { display: block; height: 12px; border-radius: 6px; }
.sk__line.thin { height: 9px; margin-top: 6px; }
.sk__line.h-lg { height: 24px; }
.w-15 { width: 15%; } .w-20 { width: 20%; } .w-30 { width: 30%; } .w-40 { width: 40%; } .w-50 { width: 50%; } .w-60 { width: 60%; } .w-70 { width: 70%; } .w-90 { width: 90%; }
.sk__avatar, .sk__line {
  background: linear-gradient(90deg, rgba(var(--v-theme-on-surface), .06) 25%, rgba(var(--v-theme-on-surface), .12) 50%, rgba(var(--v-theme-on-surface), .06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .sk__avatar, .sk__line { animation: none; } }
</style>
