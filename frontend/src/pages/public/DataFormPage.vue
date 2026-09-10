<script setup lang="ts">
/**
 * Employee Information Form — نموذج استكمال بيانات الموظف
 *
 * The public page behind a DATA_FORM signed link. Split into the six sections
 * HR asked for rather than one long field list, because a new hire filling
 * this on a phone needs to know how much is left.
 *
 * Layout rule: the label sits above the field with a red asterisk, the example
 * lives inside the field as a placeholder, and the line under the field is
 * reserved for the reason something is wrong (or a short description). A
 * filled-in field shows its problem at once; an empty one is flagged only
 * after the first submit attempt, so the page does not open covered in red.
 *
 * The rules mirror the server's data-form.schema.ts — the server remains the
 * authority, this is just fast feedback.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface FormDoc {
  id: string;
  type: string;
  label: string | null;
  required: boolean;
  uploaded: boolean;
}

interface FormContext {
  purpose: string;
  /** Everything already on file — HR can send the form back for corrections. */
  employee: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    nationalId: string | null;
    birthDate: string | null;
    gender: 'MALE' | 'FEMALE' | null;
    nationality: string | null;
    maritalStatus: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | null;
    splAddress: string | null;
    iban: string | null;
    qualification: 'HIGH_SCHOOL' | 'DIPLOMA' | 'BACHELOR' | 'MASTER' | 'PHD' | 'OTHER' | null;
    major: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    project?: string | null;
    preferredLanguage?: 'AR' | 'EN';
  };
  documents: FormDoc[];
}

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'submitting' | 'done' | 'invalid'>('loading');
const ctx = ref<FormContext | null>(null);
const error = ref('');
const showErrors = ref(false);

const fields = ref({
  firstName: '',
  lastName: '',
  nationalId: '',
  birthDate: '',
  gender: '' as '' | 'MALE' | 'FEMALE',
  nationality: '',
  maritalStatus: '' as '' | 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED',
  phone: '',
  email: '',
  splAddress: '',
  qualification: '' as '' | 'HIGH_SCHOOL' | 'DIPLOMA' | 'BACHELOR' | 'MASTER' | 'PHD' | 'OTHER',
  major: '',
  iban: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
});
type FieldKey = keyof typeof fields.value;

const files = ref<Record<string, File | null>>({});

/** Examples shown inside the fields; formats, so they are not translated. */
const EXAMPLE = {
  nationalId: '1234567890',
  phone: '0551234567',
  email: 'name@example.com',
  splAddress: 'RRRD2929',
  iban: 'SA0380000000608010167519',
};

// ── Option lists ────────────────────────────────────────────────────────────
// Values are the Prisma enums; labels come from i18n so they follow the
// page language.
const genderOptions = computed(() =>
  (['MALE', 'FEMALE'] as const).map((v) => ({ value: v, title: t(`enums.gender.${v}`) })),
);

/**
 * Arabic marital status is gendered (أعزب / عزباء), so the label set follows
 * the selected gender rather than using an awkward أعزب(ة).
 */
const maritalOptions = computed(() => {
  const suffix = fields.value.gender === 'FEMALE' ? 'F' : 'M';
  return (['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const).map((v) => ({
    value: v,
    title: t(`enums.marital.${v}_${suffix}`),
  }));
});

const qualificationOptions = computed(() =>
  (['HIGH_SCHOOL', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD', 'OTHER'] as const).map((v) => ({
    value: v,
    title: t(`enums.qualification.${v}`),
  })),
);

/** Saudi first, then the nationalities most common in KSA employment. */
const nationalityOptions = computed(() =>
  [
    'SA', 'YE', 'EG', 'SD', 'SY', 'JO', 'PS', 'LB', 'IQ', 'KW', 'BH', 'QA', 'AE', 'OM',
    'PK', 'IN', 'BD', 'PH', 'LK', 'NP', 'ID', 'MA', 'TN', 'DZ', 'SO', 'ET', 'ER', 'TR',
    'OTHER',
  ].map((code) => ({ value: code, title: t(`nationalities.${code}`) })),
);

// ── Validation — mirrors backend/src/modules/employees/data-form.schema.ts ──
const SAUDI_MOBILE = /^(?:\+?966|0)5\d{8}$/;
const SPL_ADDRESS = /^[A-Za-z]{4}\d{4}$/;
const SAUDI_ID = /^[12]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ISO 13616 mod-97, computed in chunks so it survives 24-digit IBANs. */
function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^SA\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

const REQUIRED_TEXT: FieldKey[] = [
  'firstName', 'lastName', 'nationality', 'major', 'emergencyContactName',
  'birthDate', 'gender', 'maritalStatus', 'qualification',
];

/**
 * One reason per field that is not yet acceptable. Empty → "required";
 * filled but in the wrong shape → the format message.
 */
const problems = computed<Partial<Record<FieldKey, string>>>(() => {
  const f = fields.value;
  const out: Partial<Record<FieldKey, string>> = {};
  const value = (k: FieldKey) => String(f[k] ?? '').trim();
  for (const k of REQUIRED_TEXT) if (!value(k)) out[k] = t('validation.required');
  const check = (k: FieldKey, ok: (v: string) => boolean, message: string) => {
    const v = value(k);
    if (!v) out[k] = t('validation.required');
    else if (!ok(v)) out[k] = message;
  };
  check('nationalId', (v) => SAUDI_ID.test(v), t('validation.nationalId'));
  check('phone', (v) => SAUDI_MOBILE.test(v), t('validation.phone'));
  check('emergencyContactPhone', (v) => SAUDI_MOBILE.test(v), t('validation.phone'));
  check('email', (v) => EMAIL.test(v), t('validation.email'));
  check('splAddress', (v) => SPL_ADDRESS.test(v), t('validation.spl'));
  check('iban', (v) => ibanValid(v), t('validation.iban'));
  return out;
});

/** What the field shows under itself right now. */
function errorsFor(key: FieldKey): string[] {
  const message = problems.value[key];
  if (!message) return [];
  const filled = String(fields.value[key] ?? '').trim() !== '';
  return showErrors.value || filled ? [message] : [];
}

/**
 * A form HR sent back for corrections, rather than a first visit: something
 * only the employee could have supplied is already on file.
 */
const reopened = computed(
  () => !!ctx.value && (!!ctx.value.employee.iban || ctx.value.documents.some((d) => d.uploaded)),
);

/** Which required attachments are still missing. */
const missingDocs = computed(() =>
  (ctx.value?.documents ?? []).filter((d) => d.required && !d.uploaded && !files.value[d.id]),
);

const invalidCount = computed(() => Object.keys(problems.value).length + missingDocs.value.length);
const canSubmit = computed(() => invalidCount.value === 0);

/** Latest sensible birth date — nobody is hired at under 15. */
const maxBirthDate = computed(() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15);
  return d.toISOString().slice(0, 10);
});

onMounted(async () => {
  try {
    const data = await api.get<FormContext>(`/api/link/${token}`);
    if (data.purpose !== 'DATA_FORM') throw new Error();
    ctx.value = data;
    // The form opens in the language HR chose for this person; they can still switch.
    if (data.employee.preferredLanguage) prefs.locale = data.employee.preferredLanguage === 'EN' ? 'en' : 'ar';
    // Everything already on file comes back, so a form sent back for one
    // correction opens filled in rather than blank.
    const e = data.employee;
    fields.value.firstName = e.firstName ?? '';
    fields.value.lastName = e.lastName ?? '';
    fields.value.email = e.email ?? '';
    fields.value.phone = e.phone ?? '';
    fields.value.nationalId = e.nationalId ?? '';
    fields.value.birthDate = e.birthDate?.slice(0, 10) ?? '';
    fields.value.gender = e.gender ?? '';
    fields.value.nationality = e.nationality ?? '';
    fields.value.maritalStatus = e.maritalStatus ?? '';
    fields.value.splAddress = e.splAddress ?? '';
    fields.value.iban = e.iban ?? '';
    fields.value.qualification = e.qualification ?? '';
    fields.value.major = e.major ?? '';
    fields.value.emergencyContactName = e.emergencyContactName ?? '';
    fields.value.emergencyContactPhone = e.emergencyContactPhone ?? '';
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

function onFile(docId: string, fileList: File | File[] | null) {
  files.value[docId] = Array.isArray(fileList) ? (fileList[0] ?? null) : fileList;
}

function docLabel(doc: FormDoc): string {
  return doc.label ?? t(`docTypes.${doc.type}`, doc.type);
}

async function submit() {
  showErrors.value = true;
  if (!canSubmit.value) {
    error.value = t('publicForm.fixErrors');
    // Take the person to the first problem instead of leaving them at the button.
    await nextTick();
    document.querySelector('.v-input--error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  state.value = 'submitting';
  error.value = '';
  const body = new FormData();
  for (const [k, v] of Object.entries(fields.value)) if (v) body.append(k, String(v));
  // The language the person actually used becomes the language of every later email.
  body.append('locale', prefs.locale);
  for (const [docId, file] of Object.entries(files.value)) if (file) body.append(docId, file);

  try {
    await api.post(`/api/link/${token}/form`, body);
    state.value = 'done';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 840px">
    <div class="d-flex justify-end mb-2">
      <v-btn variant="text" size="small" prepend-icon="languages" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
    </div>

    <v-card v-if="state === 'loading'" class="pa-12 text-center">
      <v-progress-circular indeterminate color="primary" />
    </v-card>

    <v-card v-else-if="state === 'invalid'" class="pa-10 text-center">
      <v-icon icon="unlink" size="56" color="error" class="mb-4" />
      <h2 class="text-h6 mb-2">{{ $t('publicForm.invalidTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.invalidHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'done'" class="pa-10 text-center">
      <v-icon icon="circle-check" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('publicForm.doneTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.doneHint') }}</p>
    </v-card>

    <template v-else-if="ctx">
      <v-card class="data-form">
        <!-- Brand header: logo, company, bilingual title -->
        <div class="form-head">
          <img src="/riyada-logo.png" alt="Riyada HR" class="form-logo" />
          <div class="form-head-text">
            <h1 class="form-title">{{ $t('publicForm.formTitle') }}</h1>
            <p class="form-subtitle">{{ $t('publicForm.formTitleAlt') }}</p>
          </div>
        </div>
        <div class="brand-rule"><span></span><i></i></div>

        <v-card-text class="pt-5 px-5 px-sm-7">
          <p class="text-body-1 mb-1">
            {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
          </p>
          <p class="text-body-2 text-medium-emphasis mb-6">
            {{ $t('publicForm.allRequired') }}
            <span class="req-legend"><span class="req">*</span> {{ $t('publicForm.requiredLegend') }}</span>
          </p>

          <v-alert v-if="reopened" type="info" variant="tonal" class="mb-5 text-body-2">
            {{ $t('publicForm.reopened') }}
          </v-alert>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-5">{{ error }}</v-alert>

          <!-- 1 · البيانات الشخصية -->
          <h3 class="sec">{{ $t('publicForm.secPersonal') }}</h3>
          <v-row>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-firstName">{{ $t('fields.firstName') }}<span class="req">*</span></label>
              <v-text-field id="f-firstName" v-model="fields.firstName" :error-messages="errorsFor('firstName')" />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-lastName">{{ $t('fields.lastName') }}<span class="req">*</span></label>
              <v-text-field id="f-lastName" v-model="fields.lastName" :error-messages="errorsFor('lastName')" />
            </v-col>

            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-nationalId">{{ $t('fields.nationalId') }}<span class="req">*</span></label>
              <v-text-field
                id="f-nationalId"
                v-model="fields.nationalId"
                :placeholder="EXAMPLE.nationalId"
                :hint="$t('hints.nationalId')"
                persistent-hint
                :error-messages="errorsFor('nationalId')"
                inputmode="numeric"
                maxlength="10"
                dir="ltr"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-birthDate">{{ $t('fields.birthDate') }}<span class="req">*</span></label>
              <v-text-field
                id="f-birthDate"
                v-model="fields.birthDate"
                type="date"
                :max="maxBirthDate"
                :hint="$t('hints.birthDate')"
                persistent-hint
                :error-messages="errorsFor('birthDate')"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-gender">{{ $t('fields.gender') }}<span class="req">*</span></label>
              <v-select id="f-gender" v-model="fields.gender" :items="genderOptions" :placeholder="$t('publicForm.choose')" :error-messages="errorsFor('gender')" />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-nationality">{{ $t('fields.nationality') }}<span class="req">*</span></label>
              <v-select id="f-nationality" v-model="fields.nationality" :items="nationalityOptions" :placeholder="$t('publicForm.choose')" :error-messages="errorsFor('nationality')" />
            </v-col>

            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-maritalStatus">{{ $t('fields.maritalStatus') }}<span class="req">*</span></label>
              <v-select id="f-maritalStatus" v-model="fields.maritalStatus" :items="maritalOptions" :placeholder="$t('publicForm.choose')" :error-messages="errorsFor('maritalStatus')" />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-phone">{{ $t('fields.phone') }}<span class="req">*</span></label>
              <v-text-field
                id="f-phone"
                v-model="fields.phone"
                :placeholder="EXAMPLE.phone"
                :error-messages="errorsFor('phone')"
                inputmode="tel"
                dir="ltr"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-email">{{ $t('fields.email') }}<span class="req">*</span></label>
              <v-text-field
                id="f-email"
                v-model="fields.email"
                :placeholder="EXAMPLE.email"
                :error-messages="errorsFor('email')"
                inputmode="email"
                dir="ltr"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-splAddress">{{ $t('fields.splAddress') }}<span class="req">*</span></label>
              <v-text-field
                id="f-splAddress"
                v-model="fields.splAddress"
                :placeholder="EXAMPLE.splAddress"
                :hint="$t('hints.splFormat')"
                persistent-hint
                :error-messages="errorsFor('splAddress')"
                maxlength="8"
                dir="ltr"
                class="upper"
              />
            </v-col>
          </v-row>

          <!-- 2 · المؤهلات -->
          <h3 class="sec">{{ $t('publicForm.secQualifications') }}</h3>
          <v-row>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-qualification">{{ $t('fields.qualification') }}<span class="req">*</span></label>
              <v-select id="f-qualification" v-model="fields.qualification" :items="qualificationOptions" :placeholder="$t('publicForm.choose')" :error-messages="errorsFor('qualification')" />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-major">{{ $t('fields.major') }}<span class="req">*</span></label>
              <v-text-field id="f-major" v-model="fields.major" :error-messages="errorsFor('major')" />
            </v-col>
          </v-row>

          <!-- 3 · البيانات البنكية -->
          <h3 class="sec">{{ $t('publicForm.secBank') }}</h3>
          <v-row>
            <v-col cols="12">
              <label class="fld-label" for="f-iban">{{ $t('fields.iban') }}<span class="req">*</span></label>
              <v-text-field
                id="f-iban"
                v-model="fields.iban"
                :placeholder="EXAMPLE.iban"
                :hint="$t('hints.ibanFormat')"
                persistent-hint
                :error-messages="errorsFor('iban')"
                maxlength="24"
                dir="ltr"
                class="upper"
              />
            </v-col>
          </v-row>

          <!-- 4 · جهة الاتصال في الطوارئ -->
          <h3 class="sec">{{ $t('publicForm.secEmergency') }}</h3>
          <v-row>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-emergencyContactName">{{ $t('fields.emergencyContactName') }}<span class="req">*</span></label>
              <v-text-field id="f-emergencyContactName" v-model="fields.emergencyContactName" :error-messages="errorsFor('emergencyContactName')" />
            </v-col>
            <v-col cols="12" sm="6">
              <label class="fld-label" for="f-emergencyContactPhone">{{ $t('fields.emergencyContactPhone') }}<span class="req">*</span></label>
              <v-text-field
                id="f-emergencyContactPhone"
                v-model="fields.emergencyContactPhone"
                :placeholder="EXAMPLE.phone"
                :error-messages="errorsFor('emergencyContactPhone')"
                inputmode="tel"
                dir="ltr"
              />
            </v-col>
          </v-row>

          <!-- 5 · بيانات المشروع — set by HR, shown read-only -->
          <h3 class="sec">{{ $t('publicForm.secProject') }}</h3>
          <v-row>
            <v-col cols="12">
              <label class="fld-label" for="f-project">{{ $t('fields.project') }}</label>
              <v-text-field
                id="f-project"
                :model-value="ctx.employee.project || $t('publicForm.projectPending')"
                readonly
                variant="filled"
                :hint="$t('hints.project')"
                persistent-hint
              />
            </v-col>
          </v-row>

          <!-- 6 · المرفقات -->
          <h3 class="sec">{{ $t('publicForm.secAttachments') }}</h3>
          <p class="text-caption text-medium-emphasis mb-4">{{ $t('publicForm.fileHint') }}</p>
          <v-row>
            <v-col v-for="doc in ctx.documents" :key="doc.id" cols="12" sm="6">
              <label class="fld-label" :for="`f-doc-${doc.id}`">
                {{ docLabel(doc) }}<span v-if="doc.required" class="req">*</span>
                <span v-if="doc.uploaded" class="doc-on-file">
                  <v-icon icon="circle-check" size="14" /> {{ $t('onboarding.uploaded') }}
                </span>
              </label>
              <v-file-input
                :id="`f-doc-${doc.id}`"
                :placeholder="doc.uploaded ? $t('publicForm.replaceFile') : $t('publicForm.chooseFile')"
                :hint="doc.uploaded ? $t('publicForm.replaceHint') : ''"
                :persistent-hint="doc.uploaded"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                prepend-icon=""
                prepend-inner-icon="paperclip"
                :error-messages="showErrors && doc.required && !doc.uploaded && !files[doc.id] ? [$t('validation.required')] : []"
                @update:model-value="onFile(doc.id, $event)"
              />
            </v-col>
          </v-row>
        </v-card-text>

        <v-divider />
        <v-card-actions class="pa-4 px-sm-7 flex-wrap ga-2">
          <span v-if="showErrors && !canSubmit" class="text-body-2 text-error">
            {{ $t('publicForm.remaining', { n: invalidCount }) }}
          </span>
          <v-spacer />
          <v-btn color="primary" size="large" variant="flat" class="px-8"
            :loading="state === 'submitting'" @click="submit">
            {{ $t('common.submit') }}
          </v-btn>
        </v-card-actions>
      </v-card>

      <p class="text-caption text-medium-emphasis text-center mt-3">
        {{ $t('publicForm.requiredHint') }}
      </p>
    </template>
  </v-container>
</template>

<style scoped>
.form-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px 14px;
  flex-wrap: wrap;
}
.form-logo {
  height: 40px;
  width: auto;
  /* The supplied asset is 150x40; cap the height so a larger export drops in
     without changing the layout. */
}
.form-head-text {
  min-width: 0;
}
.form-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.3;
}
.form-subtitle {
  margin: 2px 0 0;
  font-size: 0.82rem;
  opacity: 0.7;
}

/* Two brand colours as a flat rule — matches the email header. */
.brand-rule {
  display: flex;
  height: 3px;
}
.brand-rule span {
  flex: 65;
  background: #35708f;
}
.brand-rule i {
  flex: 35;
  background: #4e9e8f;
}

.sec {
  font-size: 1rem;
  font-weight: 700;
  margin: 30px 0 14px;
  padding-inline-start: 10px;
  border-inline-start: 3px solid #35708f;
  line-height: 1.4;
}
.sec:first-of-type {
  margin-top: 6px;
}

/* Label above the field: the title gets its own line, the example lives inside
   the field, and the line under the field is for the reason something is wrong. */
.fld-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.req {
  color: rgb(var(--v-theme-error));
  margin-inline-start: 4px;
  font-weight: 700;
}
.doc-on-file {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-inline-start: 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgb(var(--v-theme-success));
}
.req-legend {
  display: inline-block;
  margin-inline-start: 8px;
}
.req-legend .req {
  margin-inline-start: 0;
}
.data-form :deep(.v-input__details) {
  padding-inline: 4px;
  padding-top: 4px;
}
.data-form :deep(.v-messages) {
  font-size: 0.78rem;
  line-height: 1.4;
  opacity: 1;
}
.data-form :deep(.v-field input::placeholder) {
  opacity: 0.45;
}

/* IBAN and SPL are stored uppercase; show them that way as they are typed. */
.upper :deep(input) {
  text-transform: uppercase;
}

.pop {
  animation: pop 0.4s ease;
}
@keyframes pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pop {
    animation: none;
  }
}
</style>
