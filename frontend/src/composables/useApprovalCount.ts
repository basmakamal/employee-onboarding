/**
 * How many requests wait for the signed-in approver — one shared count for
 * the menu badge, the home page and the approvals inbox. It refreshes every
 * minute while the app is open, and right after a decision (`refresh()`).
 */
import { ref } from 'vue';
import { api } from '../api/client';

const count = ref({ leave: 0, overtime: 0, total: 0 });
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    count.value = await api.get('/api/approvals/count');
  } catch {
    /* a failed refresh keeps the last count; the next one tries again */
  }
}

export function useApprovalCount() {
  return {
    count,
    refresh,
    /** Start the minute-by-minute refresh (idempotent). */
    start() {
      void refresh();
      if (!timer) timer = setInterval(() => void refresh(), 60_000);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      count.value = { leave: 0, overtime: 0, total: 0 };
    },
  };
}
