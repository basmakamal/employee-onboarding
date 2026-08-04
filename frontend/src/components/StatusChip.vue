<script setup lang="ts">
const props = defineProps<{ status: string }>();

const COLORS: Record<string, string> = {
  CREATED: 'grey',
  AWAITING_FORM: 'orange',
  FORM_RECEIVED: 'blue',
  CONTRACT_CREATION: 'indigo',
  AWAITING_CONTRACT_APPROVAL: 'amber',
  EMPLOYEE_CREATED: 'success',
  EXPIRED: 'error',
};

const color = COLORS[props.status] ?? 'grey';
</script>

<template>
  <v-chip :color="color" size="small" variant="tonal" class="font-weight-medium">
    {{ $t(`status.${status}`) }}
  </v-chip>
</template>
