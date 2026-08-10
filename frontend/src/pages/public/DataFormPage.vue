<script setup lang="ts">
/**
 * Employee Information Form — نموذج استكمال بيانات الموظف
 *
 * The public page behind a DATA_FORM signed link. Split into the six sections
 * HR asked for rather than one long field list, because a new hire filling
 * this on a phone needs to know how much is left.
 *
 * Every field is mandatory (HR: the whole set is required for employment
 * contracts), so each carries an asterisk and the submit button stays disabled
 * until the form is genuinely complete. The rules below mirror the server's
 * data-form.schema.ts — the server remains the authority, this is just fast
 * feedback.
 */
import { computed, onMounted, ref } from 'vue';
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
  employee: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    nationalId: string | null;
    birthDate: string | null;
    project?: string | null;
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
  fatherName: '',
  grandfatherName: '',
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

const files = ref<Record<string, File | null>>({});

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

const required = (v: unknown) => (String(v ?? '').trim() ? true : t('validation.required'));
const rules = {
  required: [required],
  nationalId: [required, (v: string) => SAUDI_ID.test(String(v).trim()) || t('validation.nationalId')],
  phone: [required, (v: string) => SAUDI_MOBILE.test(String(v).trim()) || t('validation.phone')],
  email: [required, (v: string) => EMAIL.test(String(v).trim()) || t('validation.email')],
  spl: [required, (v: string) => SPL_ADDRESS.test(String(v).trim()) || t('validation.spl')],
  iban: [required, (v: string) => ibanValid(String(v)) || t('validation.iban')],
};

/** Which required attachments are still missing. */
const missingDocs = computed(() =>
  (ctx.value?.documents ?? []).filter((d) => d.required && !d.uploaded && !files.value[d.id]),
);

const invalidFields = computed(() => {
  const f = fields.value;
  const bad: string[] = [];
  const text: Array<keyof typeof f> = [
    'firstName', 'fatherName', 'grandfatherName', 'lastName', 'nationality',
    'major', 'emergencyContactName', 'birthDate', 'gender', 'maritalStatus', 'qualification',
  ];
  for (const key of text) if (!String(f[key] ?? '').trim()) bad.push(key);
  if (!SAUDI_ID.test(f.nationalId.trim())) bad.push('nationalId');
  if (!SAUDI_MOBILE.test(f.phone.trim())) bad.push('phone');
  if (!SAUDI_MOBILE.test(f.emergencyContactPhone.trim())) bad.push('emergencyContactPhone');
  if (!EMAIL.test(f.email.trim())) bad.push('email');
  if (!SPL_ADDRESS.test(f.splAddress.trim())) bad.push('splAddress');
  if (!ibanValid(f.iban)) bad.push('iban');
  return bad;
});

const canSubmit = computed(() => invalidFields.value.length === 0 && missingDocs.value.length === 0);

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
    // Prefill what HR already captured so the employee is not retyping it.
    fields.value.firstName = data.employee.firstName ?? '';
    fields.value.lastName = data.employee.lastName ?? '';
    fields.value.email = data.employee.email ?? '';
    fields.value.phone = data.employee.phone ?? '';
    fields.value.nationalId = data.employee.nationalId ?? '';
    fields.value.birthDate = data.employee.birthDate?.slice(0, 10) ?? '';
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
    return;
  }

  state.value = 'submitting';
  error.value = '';
  const body = new FormData();
  for (const [k, v] of Object.entries(fields.value)) if (v) body.append(k, String(v));
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
      <v-btn variant="text" size="small" prepend-icon="mdi-translate" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
    </div>

    <v-card v-if="state === 'loading'" class="pa-12 text-center">
      <v-progress-circular indeterminate color="primary" />
    </v-card>

    <v-card v-else-if="state === 'invalid'" class="pa-10 text-center">
      <v-icon icon="mdi-link-off" size="56" color="error" class="mb-4" />
      <h2 class="text-h6 mb-2">{{ $t('publicForm.invalidTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.invalidHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'done'" class="pa-10 text-center">
      <v-icon icon="mdi-check-circle" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('publicForm.doneTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.doneHint') }}</p>
    </v-card>

    <template v-else-if="ctx">
      <v-card>
        <!-- Brand header: logo, company, bilingual title -->
        <div class="form-head">
          <img src="/riyada-logo.png" alt="Riyada HR" class="form-logo" />
          <div class="form-head-text">
            <h1 class="form-title">{{ $t('publicForm.formTitle') }}</h1>
            <p class="form-subtitle">{{ $t('publicForm.formTitleAlt') }}</p>
          </div>
        </div>
        <div class="brand-rule"><span></span><i></i></div>

        <v-card-text class="pt-5">
          <p class="text-body-2 mb-1">
            {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
          </p>
          <p class="text-caption text-medium-emphasis mb-5">{{ $t('publicForm.allRequired') }}</p>

          <v-alert v-if="error" type="error" variant="tonal" class="mb-5">{{ error }}</v-alert>

          <!-- 1 · البيانات الشخصية -->
          <h3 class="sec">{{ $t('publicForm.secPersonal') }}</h3>
          <v-row dense>
            <v-col cols="12" sm="6" md="3">
              <v-text-field v-model="fields.firstName" :label="$t('fields.firstName') + ' *'"
                :rules="rules.required" :error="showErrors && !fields.firstName.trim()" />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-text-field v-model="fields.fatherName" :label="$t('fields.fatherName') + ' *'"
                :rules="rules.required" :error="showErrors && !fields.fatherName.trim()" />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-text-field v-model="fields.grandfatherName" :label="$t('fields.grandfatherName') + ' *'"
                :rules="rules.required" :error="showErrors && !fields.grandfatherName.trim()" />
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-text-field v-model="fields.lastName" :label="$t('fields.lastName') + ' *'"
                :rules="rules.required" :error="showErrors && !fields.lastName.trim()" />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.nationalId" :label="$t('fields.nationalId') + ' *'"
                :rules="rules.nationalId" :hint="$t('hints.nationalId')" persistent-hint
                inputmode="numeric" maxlength="10" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.birthDate" type="date" :max="maxBirthDate"
                :label="$t('fields.birthDate') + ' *'" :rules="rules.required"
                :hint="$t('hints.birthDate')" persistent-hint />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select v-model="fields.gender" :items="genderOptions"
                :label="$t('fields.gender') + ' *'" :rules="rules.required" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="fields.nationality" :items="nationalityOptions"
                :label="$t('fields.nationality') + ' *'" :rules="rules.required" />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select v-model="fields.maritalStatus" :items="maritalOptions"
                :label="$t('fields.maritalStatus') + ' *'" :rules="rules.required" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.phone" :label="$t('fields.phone') + ' *'"
                :rules="rules.phone" :hint="$t('hints.phone')" persistent-hint
                inputmode="tel" dir="ltr" />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.email" :label="$t('fields.email') + ' *'"
                :rules="rules.email" inputmode="email" dir="ltr" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.splAddress" :label="$t('fields.splAddress') + ' *'"
                :rules="rules.spl" :hint="$t('hints.spl')" persistent-hint
                maxlength="8" dir="ltr" class="upper" />
            </v-col>
          </v-row>

          <!-- 2 · المؤهلات -->
          <h3 class="sec">{{ $t('publicForm.secQualifications') }}</h3>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select v-model="fields.qualification" :items="qualificationOptions"
                :label="$t('fields.qualification') + ' *'" :rules="rules.required" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.major" :label="$t('fields.major') + ' *'"
                :rules="rules.required" />
            </v-col>
          </v-row>

          <!-- 3 · البيانات البنكية -->
          <h3 class="sec">{{ $t('publicForm.secBank') }}</h3>
          <v-row dense>
            <v-col cols="12">
              <v-text-field v-model="fields.iban" :label="$t('fields.iban') + ' *'"
                :rules="rules.iban" :hint="$t('hints.iban')" persistent-hint
                maxlength="24" dir="ltr" class="upper" />
            </v-col>
          </v-row>

          <!-- 4 · جهة الاتصال في الطوارئ -->
          <h3 class="sec">{{ $t('publicForm.secEmergency') }}</h3>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.emergencyContactName"
                :label="$t('fields.emergencyContactName') + ' *'" :rules="rules.required" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.emergencyContactPhone"
                :label="$t('fields.emergencyContactPhone') + ' *'" :rules="rules.phone"
                :hint="$t('hints.phone')" persistent-hint inputmode="tel" dir="ltr" />
            </v-col>
          </v-row>

          <!-- 5 · بيانات المشروع — set by HR, shown read-only -->
          <h3 class="sec">{{ $t('publicForm.secProject') }}</h3>
          <v-row dense>
            <v-col cols="12">
              <v-text-field :model-value="ctx.employee.project || $t('publicForm.projectPending')"
                :label="$t('fields.project')" readonly variant="filled"
                :hint="$t('hints.project')" persistent-hint />
            </v-col>
          </v-row>

          <!-- 6 · المرفقات -->
          <h3 class="sec">{{ $t('publicForm.secAttachments') }}</h3>
          <div v-for="doc in ctx.documents" :key="doc.id" class="mb-3">
            <v-file-input
              v-if="!doc.uploaded"
              :label="docLabel(doc) + (doc.required ? ' *' : '')"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              prepend-icon="mdi-paperclip"
              density="comfortable"
              :error="showErrors && doc.required && !files[doc.id]"
              @update:model-value="onFile(doc.id, $event)"
            />
            <v-alert v-else type="success" variant="tonal" density="compact">
              {{ docLabel(doc) }} — {{ $t('onboarding.uploaded') }}
            </v-alert>
          </div>
          <p class="text-caption text-medium-emphasis">{{ $t('publicForm.fileHint') }}</p>
        </v-card-text>

        <v-card-actions class="pa-4">
          <span v-if="showErrors && !canSubmit" class="text-caption text-error">
            {{ $t('publicForm.remaining', { n: invalidFields.length + missingDocs.length }) }}
          </span>
          <v-spacer />
          <v-btn color="primary" size="large" variant="flat"
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
  font-size: 0.95rem;
  font-weight: 700;
  margin: 26px 0 10px;
  padding-inline-start: 10px;
  border-inline-start: 3px solid #35708f;
  line-height: 1.4;
}
.sec:first-of-type {
  margin-top: 6px;
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
