/**
 * One way every form handles saving:
 *
 *   const form = useForm();
 *   <v-form :ref="form.bind"> … <v-text-field :rules="[rules.required]" :error-messages="form.errorsFor('code')" />
 *   <FormErrorAlert :form="form" />
 *   <v-btn :loading="form.busy.value" @click="form.submit(save)">Save</v-btn>
 *
 * Save is never silently disabled. Clicking it runs the field rules first —
 * bad fields turn red with their own message and an alert says what to fix;
 * nothing is sent. If the server still refuses, its answer is translated and
 * attached to the same fields (and summarised in the alert). The submit
 * button is busy while a request is in flight, so a double click is ignored.
 */
import { ref, type Ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { describeError } from '../validation/errors';
import { i18n } from '../i18n';

interface FormLike {
  validate(): Promise<{ valid: boolean; errors: Array<{ id: string | number; errorMessages: string[] }> }>;
  resetValidation(): void;
}

export interface UseForm {
  bind: (el: Element | ComponentPublicInstance | null) => void;
  busy: Ref<boolean>;
  error: Ref<string>;
  lines: Ref<string[]>;
  fields: Ref<Record<string, string[]>>;
  errorsFor: (path: string) => string[];
  reset: () => void;
  fail: (e: unknown) => void;
  /** Report problems found by code (fields on a hidden tab, cross-field rules). */
  invalid: (fields: Record<string, string[]>, message?: string) => void;
  submit: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

export function useForm(): UseForm {
  let formEl: FormLike | null = null;
  const busy = ref(false);
  const error = ref('');
  const lines = ref<string[]>([]);
  const fields = ref<Record<string, string[]>>({});

  function bind(el: Element | ComponentPublicInstance | null) {
    formEl = (el as unknown as FormLike) ?? null;
  }

  function reset() {
    error.value = '';
    lines.value = [];
    fields.value = {};
    formEl?.resetValidation?.();
  }

  /** Show any error (server or local) in the alert and on the fields. */
  function fail(e: unknown) {
    const d = describeError(e);
    error.value = d.message;
    lines.value = d.lines;
    fields.value = d.fields;
  }

  function invalid(problems: Record<string, string[]>, message?: string) {
    error.value = message ?? i18n.global.t('errors.fixFields');
    fields.value = problems;
    lines.value = [];
  }

  async function submit<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy.value) return undefined;
    error.value = '';
    lines.value = [];
    fields.value = {};
    if (formEl) {
      const { valid } = await formEl.validate();
      if (!valid) {
        error.value = i18n.global.t('errors.fixFields');
        return undefined;
      }
    }
    busy.value = true;
    try {
      return await fn();
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  return {
    bind,
    busy,
    error,
    lines,
    fields,
    // A list field also collects its items' problems ("ccEmails.1" → "ccEmails").
    errorsFor: (path: string) =>
      Object.entries(fields.value)
        .filter(([p]) => p === path || p.startsWith(`${path}.`))
        .flatMap(([, messages]) => messages),
    reset,
    fail,
    invalid,
    submit,
  } as UseForm;
}
