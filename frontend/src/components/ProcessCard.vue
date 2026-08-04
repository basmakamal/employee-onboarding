<script setup lang="ts">
import { ref } from 'vue';

interface ProcessData {
  status: string;
  holdReason?: string | null;
  holdNote?: string | null;
}

const props = defineProps<{
  title: string;
  icon: string;
  process: ProcessData | null;
  actions: string[];
  /** i18n keys of selectable hold reasons (empty = no HOLD support). */
  holdReasons: string[];
  busy: boolean;
}>();

const emit = defineEmits<{
  act: [action: string, payload?: { holdReason?: string; holdNote?: string }];
}>();

const holdDialog = ref(false);
const holdReason = ref('');
const holdNote = ref('');

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'orange',
  DONE: 'success',
  ON_HOLD: 'warning',
  CANCELLED: 'grey',
  TRAINING: 'blue',
  REQUEST_SENT: 'indigo',
};

const ACTION_META: Record<string, { icon: string; color: string }> = {
  COMPLETE: { icon: 'mdi-check', color: 'success' },
  HOLD: { icon: 'mdi-pause-circle', color: 'warning' },
  RESUME: { icon: 'mdi-play-circle', color: 'primary' },
  CANCEL: { icon: 'mdi-close-circle', color: 'error' },
  SEND_REQUEST: { icon: 'mdi-send', color: 'primary' },
  MARK_PENDING: { icon: 'mdi-clock-outline', color: 'indigo' },
};

function onAction(action: string) {
  if (action === 'HOLD') {
    holdReason.value = props.holdReasons[0] ?? 'OTHER';
    holdNote.value = '';
    holdDialog.value = true;
    return;
  }
  emit('act', action);
}

function confirmHold() {
  holdDialog.value = false;
  emit('act', 'HOLD', { holdReason: holdReason.value, holdNote: holdNote.value || undefined });
}
</script>

<template>
  <v-card class="h-100 process-card">
    <v-card-item>
      <template #prepend>
        <v-avatar :color="STATUS_COLORS[process?.status ?? ''] ?? 'grey'" variant="tonal">
          <v-icon :icon="icon" />
        </v-avatar>
      </template>
      <v-card-title class="text-subtitle-1 font-weight-bold">{{ title }}</v-card-title>
      <v-card-subtitle>
        <v-chip
          :color="STATUS_COLORS[process?.status ?? ''] ?? 'grey'"
          size="x-small"
          variant="tonal"
          class="font-weight-medium"
        >
          {{ $t(`processStatus.${process?.status ?? 'PENDING'}`) }}
        </v-chip>
      </v-card-subtitle>
    </v-card-item>

    <v-card-text v-if="process?.holdReason" class="pt-0">
      <v-alert type="warning" variant="tonal" density="compact">
        {{ $t(`holdReasons.${process.holdReason}`) }}
        <div v-if="process.holdNote" class="text-caption mt-1">{{ process.holdNote }}</div>
      </v-alert>
    </v-card-text>

    <v-card-actions v-if="actions.length" class="flex-wrap" style="gap: 4px">
      <v-btn
        v-for="action in actions"
        :key="action"
        :color="ACTION_META[action]?.color"
        :prepend-icon="ACTION_META[action]?.icon"
        :loading="busy"
        size="small"
        variant="tonal"
        @click="onAction(action)"
      >
        {{ $t(`processActions.${action}`) }}
      </v-btn>
    </v-card-actions>

    <v-dialog v-model="holdDialog" max-width="440">
      <v-card :title="$t('processActions.HOLD')" class="pa-2">
        <v-card-text>
          <v-select
            v-model="holdReason"
            :items="holdReasons.map((r) => ({ title: $t(`holdReasons.${r}`), value: r }))"
            :label="$t('employees.holdReason')"
          />
          <v-textarea v-model="holdNote" :label="$t('employees.holdNote')" rows="2" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="holdDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="warning" @click="confirmHold">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.process-card {
  transition: transform 0.2s ease;
}
.process-card:hover {
  transform: translateY(-2px);
}
</style>
