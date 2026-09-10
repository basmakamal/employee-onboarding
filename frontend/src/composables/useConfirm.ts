import { reactive } from 'vue';
import { i18n } from '../i18n';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Button label; defaults to the translated "Confirm". */
  confirmText?: string;
  cancelText?: string;
  /** Vuetify colour of the action — `error` for destructive, `primary` otherwise. */
  color?: 'primary' | 'error' | 'warning' | 'success';
  icon?: string;
}

interface Resolved extends Required<ConfirmOptions> {}

const state = reactive({
  open: false,
  busy: false,
  options: {
    title: '',
    message: '',
    confirmText: '',
    cancelText: '',
    color: 'primary',
    icon: 'circle-help',
  } as Resolved,
  resolver: null as ((ok: boolean) => void) | null,
  resolve(ok: boolean) {
    state.open = false;
    state.resolver?.(ok);
    state.resolver = null;
  },
});

/** Internal: the dialog component binds to this. */
export function useConfirmState() {
  return state;
}

/**
 * `const ok = await confirm({ title, message, color: 'error' })`.
 * One dialog instance for the whole app; calls queue behind each other
 * only in the sense that a second call closes the first with "false".
 */
export function useConfirm() {
  return function confirm(options: ConfirmOptions): Promise<boolean> {
    const t = i18n.global.t;
    state.resolver?.(false);
    state.options = {
      title: options.title,
      message: options.message ?? '',
      confirmText: options.confirmText ?? t('common.confirm'),
      cancelText: options.cancelText ?? t('common.cancel'),
      color: options.color ?? 'primary',
      icon: options.icon ?? (options.color === 'error' ? 'triangle-alert' : 'circle-help'),
    };
    state.open = true;
    return new Promise<boolean>((resolve) => {
      state.resolver = resolve;
    });
  };
}
