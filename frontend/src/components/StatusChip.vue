<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useListsStore } from '../stores/lists';

const props = defineProps<{ status: string }>();
const { t } = useI18n();
const lists = useListsStore();

/** The admin's label for this status in the current language, else the built-in one. */
const label = computed(() => lists.label('EMPLOYEE_STATUS', props.status) ?? t(`status.${props.status}`));

const COLORS: Record<string, string> = {
  CREATED: 'grey',
  AWAITING_FORM: 'orange',
  FORM_RECEIVED: 'blue',
  CONTRACT_CREATION: 'indigo',
  AWAITING_CONTRACT_APPROVAL: 'amber',
  EXPIRED: 'error',
  ACTIVE: 'success',
  INACTIVE: 'grey',
  WITHDRAWN: 'error',
};

const color = COLORS[props.status] ?? 'grey';
</script>

<template>
  <v-chip :color="color" size="small" variant="tonal" class="font-weight-medium">
    {{ label }}
  </v-chip>
</template>
