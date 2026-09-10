<script setup lang="ts">
/**
 * Email templates & status triggers (ADMIN).
 *
 * Templates: the built-in set can be overridden per key. The editor works in
 * both languages, inserts placeholders at the cursor, previews the rendered
 * email with sample data, and can send a test to the signed-in admin.
 *
 * Triggers: "when <process> enters <status>, send <template> to <recipient>".
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../composables/useConfirm';

type Audience = 'employee' | 'staff';
type Lang = 'ar' | 'en';

interface TemplateRow {
  key: string;
  audience: Audience;
  nameAr: string;
  nameEn: string;
  hasCta: boolean;
  customized: boolean;
  active: boolean;
  version: number | null;
  updatedAt: string | null;
}

interface Placeholder {
  key: string;
  ar: string;
  en: string;
  sample: { ar: string; en: string };
}

interface Draft {
  name: string;
  subjectAr: string;
  subjectEn: string;
  bodyAr: string;
  bodyEn: string;
  ctaLabelAr: string;
  ctaLabelEn: string;
  active: boolean;
}

interface TemplateDetail {
  key: string;
  meta: { audience: Audience; nameAr: string; nameEn: string; hasCta: boolean };
  row: (Partial<Draft> & { version: number; ctaLabelAr: string | null; ctaLabelEn: string | null }) | null;
  defaults: { subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string };
  placeholders: Placeholder[];
}

interface Trigger {
  id: string;
  processKey: string;
  status: string;
  templateKey: string;
  recipient: 'SUBJECT' | 'ROLE';
  role: string | null;
  /** Comma-separated extra recipients (server storage format). */
  ccEmails: string | null;
  active: boolean;
}

function ccList(value: string | null): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

interface TriggerOptions {
  processes: Record<string, string[]>;
  roles: string[];
  templates: Array<{ key: string; nameAr: string; nameEn: string; audience: Audience }>;
}

const { t, locale } = useI18n();
const confirm = useConfirm();
const lang = computed<Lang>(() => (locale.value === 'ar' ? 'ar' : 'en'));

const templates = ref<TemplateRow[]>([]);
const triggers = ref<Trigger[]>([]);
const options = ref<TriggerOptions>({ processes: {}, roles: [], templates: [] });
const loaded = ref(false);
const snackbar = ref({ show: false, text: '', color: 'success' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}
function fail(e: unknown) {
  notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
}
function templateName(tpl: { nameAr: string; nameEn: string }) {
  return lang.value === 'ar' ? tpl.nameAr : tpl.nameEn;
}
function nameOfKey(key: string): string {
  const tpl = options.value.templates.find((x) => x.key === key);
  return tpl ? templateName(tpl) : key;
}

async function load() {
  [templates.value, triggers.value, options.value] = await Promise.all([
    api.get<TemplateRow[]>('/api/email-templates'),
    api.get<Trigger[]>('/api/email-triggers'),
    api.get<TriggerOptions>('/api/email-triggers/options'),
  ]);
  loaded.value = true;
}
onMounted(load);

// ── editor ───────────────────────────────────────────────────────────────────
const editor = ref<{
  show: boolean;
  key: string;
  detail: TemplateDetail | null;
  draft: Draft;
  tab: Lang;
  saving: boolean;
  testing: boolean;
  previewing: boolean;
  preview: { subject: string; text: string; html?: string } | null;
}>({
  show: false,
  key: '',
  detail: null,
  draft: emptyDraft(),
  tab: 'ar',
  saving: false,
  testing: false,
  previewing: false,
  preview: null,
});

function emptyDraft(): Draft {
  return { name: '', subjectAr: '', subjectEn: '', bodyAr: '', bodyEn: '', ctaLabelAr: '', ctaLabelEn: '', active: true };
}

async function openEditor(key: string) {
  try {
    const detail = await api.get<TemplateDetail>(`/api/email-templates/${key}`);
    const r = detail.row;
    editor.value = {
      show: true,
      key,
      detail,
      tab: lang.value,
      saving: false,
      testing: false,
      previewing: false,
      preview: null,
      draft: {
        name: r?.name ?? templateName(detail.meta),
        subjectAr: r?.subjectAr ?? detail.defaults.subjectAr,
        subjectEn: r?.subjectEn ?? detail.defaults.subjectEn,
        bodyAr: r?.bodyAr ?? detail.defaults.bodyAr,
        bodyEn: r?.bodyEn ?? detail.defaults.bodyEn,
        ctaLabelAr: r?.ctaLabelAr ?? '',
        ctaLabelEn: r?.ctaLabelEn ?? '',
        active: r?.active ?? true,
      },
    };
  } catch (e) {
    fail(e);
  }
}

/** Where the next placeholder goes: the field that last had focus. */
const focusTarget = ref<'subject' | 'body'>('body');
const subjectFieldAr = ref<{ $el: HTMLElement } | null>(null);
const subjectFieldEn = ref<{ $el: HTMLElement } | null>(null);
const bodyFieldAr = ref<{ $el: HTMLElement } | null>(null);
const bodyFieldEn = ref<{ $el: HTMLElement } | null>(null);

/** The literal token text — built here because "}}" inside a template
 *  interpolation would end the interpolation early. */
function tokenOf(key: string): string {
  return `{{${key}}}`;
}

function insertPlaceholder(key: string) {
  const token = tokenOf(key);
  const tab = editor.value.tab;
  const isSubject = focusTarget.value === 'subject';
  const comp = isSubject
    ? (tab === 'ar' ? subjectFieldAr.value : subjectFieldEn.value)
    : (tab === 'ar' ? bodyFieldAr.value : bodyFieldEn.value);
  const field = (isSubject ? 'subject' : 'body') + (tab === 'ar' ? 'Ar' : 'En');
  const draftKey = field as keyof Draft;
  const current = String(editor.value.draft[draftKey] ?? '');
  const el = comp?.$el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  (editor.value.draft as unknown as Record<string, string | boolean>)[field] = next;
  void nextTick(() => {
    if (!el) return;
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

async function preview() {
  editor.value.previewing = true;
  try {
    const d = editor.value.draft;
    editor.value.preview = await api.post(`/api/email-templates/${editor.value.key}/preview`, {
      locale: editor.value.tab,
      draft: {
        name: d.name, subjectAr: d.subjectAr, subjectEn: d.subjectEn, bodyAr: d.bodyAr, bodyEn: d.bodyEn,
        ctaLabelAr: d.ctaLabelAr || null, ctaLabelEn: d.ctaLabelEn || null,
      },
    });
  } catch (e) {
    fail(e);
  } finally {
    editor.value.previewing = false;
  }
}

async function save() {
  editor.value.saving = true;
  try {
    const d = editor.value.draft;
    await api.put(`/api/email-templates/${editor.value.key}`, {
      ...d,
      ctaLabelAr: d.ctaLabelAr || null,
      ctaLabelEn: d.ctaLabelEn || null,
    });
    notify(t('emailTemplates.saved'));
    editor.value.show = false;
    await load();
  } catch (e) {
    fail(e);
  } finally {
    editor.value.saving = false;
  }
}

async function sendTest() {
  editor.value.testing = true;
  try {
    const res = await api.post<{ sentTo: string }>(`/api/email-templates/${editor.value.key}/test`, {
      locale: editor.value.tab,
    });
    notify(t('emailTemplates.testSent', { email: res.sentTo }));
  } catch (e) {
    fail(e);
  } finally {
    editor.value.testing = false;
  }
}

async function revert(key: string) {
  if (!(await confirm({ title: t('emailTemplates.revert'), message: t('emailTemplates.revertConfirm'), color: 'error', confirmText: t('emailTemplates.revert') }))) return;
  try {
    await api.delete(`/api/email-templates/${key}`);
    notify(t('emailTemplates.reverted'));
    editor.value.show = false;
    await load();
  } catch (e) {
    fail(e);
  }
}

const canSave = computed(() => {
  const d = editor.value.draft;
  return !!(d.subjectAr.trim() && d.subjectEn.trim() && d.bodyAr.trim() && d.bodyEn.trim());
});

// ── triggers ─────────────────────────────────────────────────────────────────
const triggerDialog = ref(false);
const savingTrigger = ref(false);
const busyTrigger = ref('');
const newTrigger = ref({
  processKey: 'EMPLOYEE',
  status: 'CREATED',
  templateKey: 'custom.status_change',
  recipient: 'SUBJECT' as 'SUBJECT' | 'ROLE',
  role: 'HR',
  ccEmails: [] as string[],
});

const triggerStatuses = computed(() => options.value.processes[newTrigger.value.processKey] ?? []);

function onTriggerProcessChange() {
  newTrigger.value.status = triggerStatuses.value[0] ?? '';
}

function statusLabel(processKey: string, status: string): string {
  const key = processKey === 'OFFBOARDING' ? `offboardingStatus.${status}` : `status.${status}`;
  return t(key, t(`processStatus.${status}`, t(`assetStatus.${status}`, status)));
}

async function createTrigger() {
  savingTrigger.value = true;
  try {
    const n = newTrigger.value;
    await api.post('/api/email-triggers', {
      processKey: n.processKey,
      status: n.status,
      templateKey: n.templateKey,
      recipient: n.recipient,
      role: n.recipient === 'ROLE' ? n.role : null,
      ccEmails: n.ccEmails,
    });
    triggerDialog.value = false;
    notify(t('emailTemplates.triggers.created'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    savingTrigger.value = false;
  }
}

/** Add or remove copy recipients inline — e.g. yourself while checking the wording. */
async function updateTriggerCc(trigger: Trigger, ccEmails: string[]) {
  busyTrigger.value = trigger.id;
  try {
    await api.put(`/api/email-triggers/${trigger.id}`, { ccEmails });
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
    await load();
  } finally {
    busyTrigger.value = '';
  }
}

async function toggleTrigger(trigger: Trigger, active: boolean) {
  busyTrigger.value = trigger.id;
  try {
    await api.put(`/api/email-triggers/${trigger.id}`, { active });
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busyTrigger.value = '';
  }
}

async function removeTrigger(trigger: Trigger) {
  if (!(await confirm({ title: t('emailTemplates.triggers.remove'), message: t('emailTemplates.triggers.removeConfirm'), color: 'error', confirmText: t('emailTemplates.triggers.remove') }))) return;
  busyTrigger.value = trigger.id;
  try {
    await api.delete(`/api/email-triggers/${trigger.id}`);
    notify(t('emailTemplates.triggers.removed'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busyTrigger.value = '';
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex align-center flex-wrap ga-3 mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('emailTemplates.title') }}</h1>
        <p class="text-medium-emphasis mt-1 mb-0">{{ $t('emailTemplates.subtitle') }}</p>
      </div>
      <v-spacer />
      <!-- The most frequent action lives up here, not under the templates list. -->
      <v-btn color="primary" prepend-icon="plus" @click="triggerDialog = true">
        {{ $t('emailTemplates.triggers.add') }}
      </v-btn>
    </div>

    <template v-if="loaded">
      <!-- ── Templates ─────────────────────────────────────────────────── -->
      <v-card class="mb-6">
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('emailTemplates.name') }}</th>
              <th>{{ $t('emailTemplates.audienceCol') }}</th>
              <th>{{ $t('emailLog.status') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tpl in templates" :key="tpl.key">
              <td>
                <div class="font-weight-medium">{{ templateName(tpl) }}</div>
                <div class="text-caption text-medium-emphasis" dir="ltr">{{ tpl.key }}</div>
              </td>
              <td>
                <v-chip size="x-small" variant="tonal" :color="tpl.audience === 'employee' ? 'primary' : 'secondary'">
                  {{ $t(`emailTemplates.audience.${tpl.audience}`) }}
                </v-chip>
              </td>
              <td>
                <v-chip
                  v-if="tpl.customized && tpl.active"
                  size="x-small"
                  color="success"
                  variant="tonal"
                  prepend-icon="pencil"
                >
                  {{ $t('emailTemplates.customized') }} · v{{ tpl.version }}
                </v-chip>
                <v-chip v-else-if="tpl.customized" size="x-small" color="warning" variant="tonal">
                  {{ $t('emailTemplates.disabledOverride') }}
                </v-chip>
                <span v-else class="text-caption text-medium-emphasis">{{ $t('emailTemplates.builtIn') }}</span>
              </td>
              <td class="text-end">
                <v-btn size="small" variant="tonal" prepend-icon="pencil" @click="openEditor(tpl.key)">
                  {{ $t('emailTemplates.edit') }}
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <!-- ── Triggers ──────────────────────────────────────────────────── -->
      <div class="d-flex align-center flex-wrap ga-2 mb-3">
        <div>
          <h2 class="text-h6 font-weight-bold">{{ $t('emailTemplates.triggers.title') }}</h2>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ $t('emailTemplates.triggers.subtitle') }}</p>
        </div>
      </div>

      <v-card>
        <v-table v-if="triggers.length" density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('emailTemplates.triggers.process') }}</th>
              <th>{{ $t('emailTemplates.triggers.status') }}</th>
              <th>{{ $t('emailTemplates.triggers.template') }}</th>
              <th>{{ $t('emailTemplates.triggers.recipient') }}</th>
              <th style="width: 260px">{{ $t('emailTemplates.triggers.cc') }}</th>
              <th>{{ $t('emailTemplates.triggers.active') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tr in triggers" :key="tr.id">
              <td class="font-weight-medium">{{ $t(`entities.${tr.processKey}`, tr.processKey) }}</td>
              <td>{{ statusLabel(tr.processKey, tr.status) }}</td>
              <td>{{ nameOfKey(tr.templateKey) }}</td>
              <td>
                <template v-if="tr.recipient === 'SUBJECT'">{{ $t('emailTemplates.triggers.subjectRecipient') }}</template>
                <template v-else>{{ $t(`roles.${tr.role}`, tr.role ?? '') }}</template>
              </td>
              <td>
                <!-- Type an address + Enter to add; click the × on a chip to remove. -->
                <v-combobox
                  :model-value="ccList(tr.ccEmails)"
                  :placeholder="$t('emailTemplates.triggers.ccNone')"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  hide-details
                  variant="plain"
                  dir="ltr"
                  :disabled="busyTrigger === tr.id"
                  @update:model-value="(v: string[]) => updateTriggerCc(tr, v)"
                />
              </td>
              <td>
                <v-switch
                  :model-value="tr.active"
                  color="success"
                  density="compact"
                  hide-details
                  :disabled="busyTrigger === tr.id"
                  @update:model-value="(v: unknown) => toggleTrigger(tr, Boolean(v))"
                />
              </td>
              <td class="text-end">
                <v-btn
                  size="small"
                  variant="text"
                  color="error"
                  icon="trash-2"
                  :disabled="busyTrigger === tr.id"
                  @click="removeTrigger(tr)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text v-else class="py-10 text-center">
          <v-icon icon="zap" size="40" class="mb-3 text-medium-emphasis" />
          <div class="text-subtitle-1 font-weight-medium">{{ $t('emailTemplates.triggers.empty') }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ $t('emailTemplates.triggers.emptyHint') }}</div>
        </v-card-text>
        <v-card-text class="text-caption text-medium-emphasis pt-0">
          {{ $t('emailTemplates.triggers.note') }}
        </v-card-text>
      </v-card>
    </template>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <!-- ── Template editor ─────────────────────────────────────────────── -->
    <v-dialog v-model="editor.show" max-width="1080" scrollable>
      <v-card v-if="editor.detail">
        <div class="d-flex align-center ga-3 px-6 pt-6 pb-2">
          <v-avatar color="primary" variant="tonal" size="42" rounded="lg">
            <v-icon icon="mail-open" size="22" />
          </v-avatar>
          <div class="min-w-0">
            <h2 class="text-subtitle-1 font-weight-bold">{{ templateName(editor.detail.meta) }}</h2>
            <p class="text-caption text-medium-emphasis mb-0" dir="ltr">{{ editor.key }}</p>
          </div>
          <v-spacer />
          <v-btn-toggle v-model="editor.tab" mandatory density="compact" variant="outlined" divided rounded="lg">
            <v-btn value="ar" size="small">{{ $t('emailTemplates.arabic') }}</v-btn>
            <v-btn value="en" size="small">{{ $t('emailTemplates.english') }}</v-btn>
          </v-btn-toggle>
        </div>

        <v-card-text class="pt-4">
          <v-row>
            <v-col cols="12" md="7">
              <v-text-field v-model="editor.draft.name" :label="$t('emailTemplates.name')" class="mb-1" />

              <!-- Arabic pane -->
              <template v-if="editor.tab === 'ar'">
                <v-text-field
                  ref="subjectFieldAr"
                  v-model="editor.draft.subjectAr"
                  :label="$t('emailTemplates.subject')"
                  dir="rtl"
                  class="mb-1"
                  @focus="focusTarget = 'subject'"
                />
                <v-textarea
                  ref="bodyFieldAr"
                  v-model="editor.draft.bodyAr"
                  :label="$t('emailTemplates.body')"
                  :hint="$t('emailTemplates.bodyHint')"
                  persistent-hint
                  rows="10"
                  auto-grow
                  dir="rtl"
                  @focus="focusTarget = 'body'"
                />
                <v-text-field
                  v-if="editor.detail.meta.hasCta"
                  v-model="editor.draft.ctaLabelAr"
                  :label="$t('emailTemplates.ctaLabel')"
                  :hint="$t('emailTemplates.ctaHint')"
                  persistent-hint
                  dir="rtl"
                  class="mt-3"
                />
              </template>

              <!-- English pane -->
              <template v-else>
                <v-text-field
                  ref="subjectFieldEn"
                  v-model="editor.draft.subjectEn"
                  :label="$t('emailTemplates.subject')"
                  dir="ltr"
                  class="mb-1"
                  @focus="focusTarget = 'subject'"
                />
                <v-textarea
                  ref="bodyFieldEn"
                  v-model="editor.draft.bodyEn"
                  :label="$t('emailTemplates.body')"
                  :hint="$t('emailTemplates.bodyHint')"
                  persistent-hint
                  rows="10"
                  auto-grow
                  dir="ltr"
                  @focus="focusTarget = 'body'"
                />
                <v-text-field
                  v-if="editor.detail.meta.hasCta"
                  v-model="editor.draft.ctaLabelEn"
                  :label="$t('emailTemplates.ctaLabel')"
                  :hint="$t('emailTemplates.ctaHint')"
                  persistent-hint
                  dir="ltr"
                  class="mt-3"
                />
              </template>

              <div class="mt-4">
                <div class="text-caption font-weight-medium text-medium-emphasis mb-2">
                  {{ $t('emailTemplates.placeholders') }}
                </div>
                <div class="d-flex flex-wrap ga-2">
                  <v-chip
                    v-for="p in editor.detail.placeholders"
                    :key="p.key"
                    size="small"
                    variant="tonal"
                    color="primary"
                    @click="insertPlaceholder(p.key)"
                  >
                    <span dir="ltr" class="font-weight-medium">{{ tokenOf(p.key) }}</span>
                    <span class="ms-2 text-medium-emphasis">{{ lang === 'ar' ? p.ar : p.en }}</span>
                  </v-chip>
                </div>
              </div>

              <div class="access-panel mt-4 px-4 py-3 rounded-lg">
                <v-switch v-model="editor.draft.active" color="success" hide-details density="comfortable">
                  <template #label>
                    <div class="ms-2">
                      <div class="text-body-2 font-weight-medium">{{ $t('emailTemplates.useEdited') }}</div>
                      <div class="text-caption text-medium-emphasis">{{ $t('emailTemplates.useEditedHint') }}</div>
                    </div>
                  </template>
                </v-switch>
              </div>
            </v-col>

            <!-- Preview -->
            <v-col cols="12" md="5">
              <div class="d-flex align-center mb-2">
                <div>
                  <div class="text-subtitle-2 font-weight-bold">{{ $t('emailTemplates.previewTitle') }}</div>
                  <div class="text-caption text-medium-emphasis">{{ $t('emailTemplates.previewHint') }}</div>
                </div>
                <v-spacer />
                <v-btn size="small" variant="tonal" prepend-icon="refresh-cw" :loading="editor.previewing" @click="preview">
                  {{ $t('emailTemplates.preview') }}
                </v-btn>
              </div>
              <div class="preview-frame rounded-lg">
                <template v-if="editor.preview">
                  <div class="px-4 py-3 text-body-2 font-weight-medium preview-subject">
                    {{ editor.preview.subject }}
                  </div>
                  <iframe
                    v-if="editor.preview.html"
                    :srcdoc="editor.preview.html"
                    sandbox=""
                    title="preview"
                    class="preview-iframe"
                  />
                  <pre v-else class="px-4 py-3 text-body-2 preview-text">{{ editor.preview.text }}</pre>
                </template>
                <div v-else class="pa-8 text-center text-medium-emphasis text-body-2">
                  <v-icon icon="eye" size="32" class="mb-2" />
                  <div>{{ $t('emailTemplates.preview') }}</div>
                </div>
              </div>
            </v-col>
          </v-row>
        </v-card-text>

        <v-card-actions class="px-6 pb-5 pt-2 flex-wrap ga-2">
          <v-btn
            v-if="editor.detail.row"
            variant="text"
            color="error"
            prepend-icon="rotate-ccw"
            @click="revert(editor.key)"
          >
            {{ $t('emailTemplates.revert') }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" prepend-icon="mail-check" :loading="editor.testing" @click="sendTest">
            {{ $t('emailTemplates.test') }}
          </v-btn>
          <v-btn variant="text" @click="editor.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn variant="flat" color="primary" class="px-5" :loading="editor.saving" :disabled="!canSave" @click="save">
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── New trigger ─────────────────────────────────────────────────── -->
    <v-dialog v-model="triggerDialog" max-width="560">
      <v-card>
        <div class="px-6 pt-6 pb-2">
          <h2 class="text-subtitle-1 font-weight-bold">{{ $t('emailTemplates.triggers.add') }}</h2>
          <p class="text-caption text-medium-emphasis mb-0">{{ $t('emailTemplates.triggers.subtitle') }}</p>
        </div>
        <v-card-text class="pt-4">
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newTrigger.processKey"
                :items="Object.keys(options.processes).map((k) => ({ title: $t(`entities.${k}`, k), value: k }))"
                :label="$t('emailTemplates.triggers.process')"
                @update:model-value="onTriggerProcessChange"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newTrigger.status"
                :items="triggerStatuses.map((s) => ({ title: statusLabel(newTrigger.processKey, s), value: s }))"
                :label="$t('emailTemplates.triggers.status')"
              />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="newTrigger.templateKey"
                :items="options.templates.map((tpl) => ({ title: templateName(tpl), value: tpl.key, props: { subtitle: tpl.key } }))"
                :label="$t('emailTemplates.triggers.template')"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="newTrigger.recipient"
                :items="[
                  { title: $t('emailTemplates.triggers.subjectRecipient'), value: 'SUBJECT' },
                  { title: $t('emailTemplates.triggers.roleRecipient'), value: 'ROLE' },
                ]"
                :label="$t('emailTemplates.triggers.recipient')"
              />
            </v-col>
            <v-col v-if="newTrigger.recipient === 'ROLE'" cols="12" sm="6">
              <v-select
                v-model="newTrigger.role"
                :items="options.roles.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                :label="$t('emailTemplates.triggers.role')"
              />
            </v-col>
            <v-col cols="12">
              <v-combobox
                v-model="newTrigger.ccEmails"
                :label="$t('emailTemplates.triggers.cc')"
                :hint="$t('emailTemplates.triggers.ccHint')"
                persistent-hint
                multiple
                chips
                closable-chips
                dir="ltr"
                prepend-inner-icon="mail-plus"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions class="px-6 pb-5 pt-2">
          <v-spacer />
          <v-btn variant="text" @click="triggerDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn variant="flat" color="primary" class="px-5" :loading="savingTrigger" @click="createTrigger">
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.access-panel {
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.preview-frame {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-surface-variant), 0.35);
  overflow: hidden;
  min-height: 320px;
}
.preview-subject {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}
.preview-iframe {
  width: 100%;
  height: 560px;
  border: 0;
  background: #f4f7f7;
}
.preview-text {
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.75;
}
</style>
