<script setup lang="ts">
import { onMounted, ref } from 'vue';

const api = ref<'checking' | 'up' | 'down'>('checking');

onMounted(async () => {
  try {
    const res = await fetch('/api/health');
    api.value = res.ok ? 'up' : 'down';
  } catch {
    api.value = 'down';
  }
});

const stages = [
  { key: 'trainee', icon: 'mdi-school', color: 'primary' },
  { key: 'profile', icon: 'mdi-folder-account', color: 'secondary' },
  { key: 'offboarding', icon: 'mdi-exit-run', color: 'warning' },
] as const;
</script>

<template>
  <v-container class="py-12" style="max-width: 1100px">
    <div class="text-center mb-12 hero">
      <h1 class="text-h3 font-weight-bold mb-3">{{ $t('home.welcome') }} 👋</h1>
      <p class="text-h6 text-medium-emphasis mx-auto" style="max-width: 640px">
        {{ $t('app.tagline') }}
      </p>
      <v-chip
        class="mt-6"
        :color="api === 'up' ? 'success' : api === 'down' ? 'error' : undefined"
        variant="tonal"
        prepend-icon="mdi-heart-pulse"
      >
        {{ $t('home.apiStatus') }}:
        {{ api === 'checking' ? $t('home.checking') : api === 'up' ? $t('home.up') : $t('home.down') }}
      </v-chip>
    </div>

    <v-row>
      <v-col v-for="(stage, i) in stages" :key="stage.key" cols="12" md="4">
        <v-card
          class="stage-card pa-2 h-100"
          :style="{ animationDelay: `${i * 120}ms` }"
          hover
        >
          <v-card-item>
            <v-avatar :color="stage.color" variant="tonal" size="56" class="mb-4">
              <v-icon :icon="stage.icon" size="30" />
            </v-avatar>
            <v-card-title class="text-h6 font-weight-bold px-0">
              {{ $t(`home.stages.${stage.key}.title`) }}
            </v-card-title>
            <v-card-text class="px-0 text-medium-emphasis">
              {{ $t(`home.stages.${stage.key}.desc`) }}
            </v-card-text>
          </v-card-item>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.hero {
  animation: rise 0.5s ease both;
}
.stage-card {
  animation: rise 0.5s ease both;
  transition: transform 0.2s ease;
}
.stage-card:hover {
  transform: translateY(-4px);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
