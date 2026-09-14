<script setup lang="ts">
/**
 * DEV ONLY — a design harness. Renders a real page (the same component the
 * app uses) inside the real shell, with the API answered from fixtures, so
 * the visual work can be checked without a live sign-in. Registered by the
 * router only when `import.meta.env.DEV` is true; never part of a build.
 *
 *   /dev/preview?page=employees   the directory
 *   /dev/preview?page=home        the dashboard
 */
import { computed, defineAsyncComponent, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { setAccessToken } from '../api/client';
import { useAuthStore } from '../stores/auth';
import html2canvas from 'html2canvas';

const route = useRoute();
const auth = useAuthStore();

// A pretend session so the shell and role gates render as for an admin.
auth.user = {
  id: 'dev',
  name: 'Basma Kamal',
  email: 'basma.kamal@riyada-ksa.com',
  role: 'ADMIN',
  mustChangePassword: false,
  hasPhoto: false,
};
setAccessToken('dev-preview');

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

const people = [
  ['Ahmed', 'Hassan', 'Customer Service', 'Customer Service Agent', 'ACTIVE', 'EMP-0041', 12],
  ['Sarah', 'Ali', 'HR', 'HR Specialist', 'ACTIVE', 'EMP-0038', 40],
  ['Omar', 'Khaled', 'IT', 'Support Engineer', 'ACTIVE', 'EMP-0035', 95],
  ['Nora', 'Alqahtani', 'Finance', 'Accountant', 'ACTIVE', 'EMP-0033', 140],
  ['Faisal', 'Alharbi', 'Operations', 'Team Lead', 'ACTIVE', 'EMP-0029', 400],
  ['Layla', 'Mohammed', 'Customer Service', 'Agent', 'AWAITING_FORM', null, 2],
  ['Yousef', 'Alzahrani', 'IT', 'Network Engineer', 'FORM_RECEIVED', null, 5],
  ['Reem', 'Alotaibi', 'HR', 'Recruiter', 'CONTRACT_CREATION', null, 9],
  ['Khalid', 'Aldossari', 'Operations', 'Coordinator', 'AWAITING_CONTRACT_APPROVAL', null, 15],
  ['Maha', 'Alshehri', 'Finance', 'Payroll Officer', 'INACTIVE', 'EMP-0012', 700],
  ['Salem', 'Alghamdi', 'Customer Service', 'Agent', 'EXPIRED', null, 30],
  ['Hind', 'Alsubaie', 'IT', 'QA Analyst', 'ACTIVE', 'EMP-0044', 3],
] as const;

const employees = people.map(([firstName, lastName, department, jobTitle, status, employeeNo, days], i) => ({
  id: `e${i + 1}`,
  employeeNo,
  firstName,
  lastName,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@riyada-ksa.com`,
  department,
  jobTitle,
  status,
  hireDate: employeeNo ? ago(days) : null,
}));

const counts = {
  all: employees.length,
  onboarding: employees.filter((e) => !['ACTIVE', 'INACTIVE', 'WITHDRAWN'].includes(e.status)).length,
  active: employees.filter((e) => e.status === 'ACTIVE').length,
  inactive: employees.filter((e) => e.status === 'INACTIVE').length,
};

const dashboard = {
  onboarding: { AWAITING_FORM: 1, FORM_RECEIVED: 1, CONTRACT_CREATION: 1, AWAITING_CONTRACT_APPROVAL: 1, EXPIRED: 1 },
  employees: { ACTIVE: counts.active, INACTIVE: 1 },
  processes: { gosi: { PENDING: 2, DONE: 5 }, medical: { PENDING: 1, DONE: 6 }, criminal: { REQUEST_SENT: 1, DONE: 6 } },
  attention: [
    { kind: 'stalled', employeeId: 'e9', name: 'Khalid Aldossari', status: 'AWAITING_CONTRACT_APPROVAL', days: 15, to: '/employees/e9' },
    { kind: 'expiring', employeeId: 'e3', name: 'Omar Khaled', status: 'IQAMA', days: 12, to: '/employees/e3' },
    { kind: 'custody', employeeId: 'e1', name: 'Ahmed Hassan', status: 'SENT', days: 4, to: '/employees/e1' },
    { kind: 'expiring', employeeId: 'e2', name: 'Sarah Ali', status: 'PASSPORT', days: 26, to: '/employees/e2' },
  ],
  counts: { stalled: 1, expiringDocs: 2, custodyWaiting: 1, joinedThisMonth: 2 },
  recentJoiners: employees
    .filter((e) => e.hireDate)
    .sort((a, b) => (b.hireDate ?? '').localeCompare(a.hireDate ?? ''))
    .slice(0, 5)
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, jobTitle: e.jobTitle, department: e.department, hireDate: e.hireDate })),
  recent: [
    { id: 'a1', entity: 'EMPLOYEE', action: 'STATUS_TRANSITION', toStatus: 'FORM_RECEIVED', actorType: 'LINK', actorName: null, at: ago(0.1), subject: 'Yousef Alzahrani' },
    { id: 'a2', entity: 'EMPLOYEE', action: 'LINK_SENT', toStatus: null, actorType: 'USER', actorName: 'Basma Kamal', at: ago(0.3), subject: 'Layla Mohammed' },
    { id: 'a3', entity: 'ASSET_FORM', action: 'STATUS_TRANSITION', toStatus: 'APPROVED', actorType: 'LINK', actorName: null, at: ago(1.2), subject: 'Ahmed Hassan' },
    { id: 'a4', entity: 'EMPLOYEE', action: 'ACTIVATED', toStatus: 'ACTIVE', actorType: 'USER', actorName: 'Ayman Saleh', at: ago(2.5), subject: 'Hind Alsubaie' },
  ],
};

// One active employee's whole file, for the profile page.
const profile = {
  ...employees[0],
  project: 'Riyada',
  directManager: 'Faisal Alharbi',
  employmentType: 'FULL_TIME',
  preferredLanguage: 'EN',
  photoKey: null,
  nationalId: '1098765432',
  birthDate: '1994-03-12T00:00:00.000Z',
  phone: '0551234567',
  gender: 'MALE',
  nationality: 'SA',
  maritalStatus: 'MARRIED',
  splAddress: 'RRRD2929',
  iban: 'SA0380000000608010167519',
  qualification: 'BACHELOR',
  major: 'Business Administration',
  emergencyContactName: 'Mona Hassan',
  emergencyContactPhone: '0559876543',
  contract: {
    startDate: ago(12), durationMonths: 12, terms: 'Full time, probation 90 days.', salary: 9000,
    sentAt: ago(20), approvedAt: ago(14), status: 'ACTIVE', statusChangedAt: ago(14), rejectReason: null,
    externalRef: 'C-2026-114', storageKey: 'contracts/c1.pdf',
  },
  onboardingDocuments: [
    { id: 'd1', type: 'NATIONAL_ID', label: null, required: true, uploaded: true },
    { id: 'd2', type: 'QUALIFICATION', label: null, required: true, uploaded: true },
    { id: 'd3', type: 'PHOTO', label: null, required: true, uploaded: true },
    { id: 'd4', type: 'IBAN_LETTER', label: null, required: true, uploaded: true },
  ],
  requests: [
    { id: 'r1', type: 'SALARY_LETTER', notes: 'For a bank loan', createdAt: ago(3), createdBy: { name: 'Basma Kamal' } },
  ],
  gosi: { status: 'DONE', certificateStorageKey: 'g.pdf' },
  medical: { status: 'PENDING', holdReason: null, holdNote: null, certificateStorageKey: null },
  criminalRecord: { status: 'REQUEST_SENT', certificateStorageKey: null },
  assetForms: [
    {
      id: 'f1', status: 'APPROVED', deliveryDate: ago(10), rejectReason: null, createdAt: ago(11), sentAt: ago(11), decidedAt: ago(10),
      items: [
        { id: 'i1', type: 'LAPTOP', name: 'ThinkPad T14', serialNumber: 'PF3K8891', quantity: 1, condition: 'NEW', notes: null },
        { id: 'i2', type: 'HEADPHONE', name: 'Jabra Evolve 40', serialNumber: '7784893', quantity: 1, condition: 'NEW', notes: null },
      ],
    },
  ],
  offboardings: [],
  auditLogs: [
    { id: 't1', kind: 'AUDIT', at: ago(3), entity: 'EMPLOYEE_REQUEST', action: 'CREATE', fromStatus: null, toStatus: null, actorType: 'USER', actorName: 'Basma Kamal' },
    { id: 't2', kind: 'EMAIL', at: ago(10), subject: 'Asset custody approved – Ahmed Hassan', templateKey: 'hr.asset_approved', deliveryStatus: 'SENT', recipientName: 'Rawan Alamri', recipientEmail: 'rawan@riyada-ksa.com' },
    { id: 't3', kind: 'AUDIT', at: ago(10), entity: 'ASSET_FORM', action: 'STATUS_TRANSITION', fromStatus: 'PENDING_EMPLOYEE_APPROVAL', toStatus: 'APPROVED', actorType: 'LINK', actorName: null },
    { id: 't4', kind: 'AUDIT', at: ago(14), entity: 'EMPLOYEE', action: 'ACTIVATED', fromStatus: 'AWAITING_CONTRACT_APPROVAL', toStatus: 'ACTIVE', actorType: 'USER', actorName: 'Ayman Saleh' },
    { id: 't5', kind: 'EMAIL', at: ago(20), subject: 'Your employment contract – Riyada HR', templateKey: 'employee.contract_approval_reminder', deliveryStatus: 'SENT', recipientName: null, recipientEmail: 'ahmed.hassan@riyada-ksa.com' },
  ],
  auditTotal: 5,
  availableActions: ['WITHDRAW'],
  processActions: { gosi: [], medical: ['COMPLETE', 'HOLD', 'CANCEL'], criminal: ['MARK_PENDING', 'COMPLETE'] },
};
const expiryDocs = [
  { id: 'x1', type: 'IQAMA', number: '2382910044', expiryDate: ago(-12).slice(0, 10), notes: null },
  { id: 'x2', type: 'PASSPORT', number: 'A1234567', expiryDate: ago(-400).slice(0, 10), notes: null },
];
const users = [
  { id: 'u1', name: 'Basma Kamal', email: 'basma.kamal@riyada-ksa.com', role: 'ADMIN', active: true, mustChangePassword: false, invitedAt: null, passwordChangedAt: ago(40), lastLoginAt: ago(0.2) },
  { id: 'u2', name: 'Ayman Saleh', email: 'ayman@riyada-ksa.com', role: 'HR', active: true, mustChangePassword: false, invitedAt: ago(30), passwordChangedAt: ago(29), lastLoginAt: ago(1) },
  { id: 'u3', name: 'Rawan Alamri', email: 'rawan@riyada-ksa.com', role: 'IT', active: true, mustChangePassword: true, invitedAt: ago(2), passwordChangedAt: null, lastLoginAt: null },
  { id: 'u4', name: 'Fatoon Alharbi', email: 'fatoon@riyada-ksa.com', role: 'INSURANCE', active: false, mustChangePassword: false, invitedAt: ago(200), passwordChangedAt: ago(199), lastLoginAt: ago(60) },
];
const emailLog = Array.from({ length: 9 }, (_, i) => ({
  id: `n${i}`,
  channel: 'EMAIL',
  status: i === 5 ? 'FAILED' : 'SENT',
  recipientEmail: i % 3 === 0 ? 'ayman@riyada-ksa.com' : `${employees[i % employees.length]!.email}`,
  recipient: i % 3 === 0 ? { name: 'Ayman Saleh', email: 'ayman@riyada-ksa.com' } : null,
  locale: i % 2 ? 'ar' : 'en',
  subject: ['Complete your data form', 'تم استكمال بيانات المتدرب – Layla', 'Your employment contract', 'Asset custody form', 'Reminder – data form'][i % 5],
  body: 'Hello, ...',
  entity: 'EMPLOYEE',
  entityId: 'e1',
  templateKey: ['employee.form_invite', 'hr.form_submitted', 'employee.contract_approval_reminder', 'employee.asset_approval', 'employee.form_reminder'][i % 5],
  templateVersion: i % 4 === 0 ? 2 : null,
  sentAt: ago(i * 0.4),
  createdAt: ago(i * 0.4 + 0.01),
}));
const reportSummary = {
  headcountByDepartment: [
    { department: 'Customer Service', active: 24, inactive: 3 },
    { department: 'IT', active: 9, inactive: 1 },
    { department: 'HR', active: 5, inactive: 0 },
    { department: 'Finance', active: 6, inactive: 1 },
    { department: 'Operations', active: 12, inactive: 2 },
  ],
  onboardingFunnel: { CREATED: 1, AWAITING_FORM: 2, FORM_RECEIVED: 1, CONTRACT_CREATION: 1, AWAITING_CONTRACT_APPROVAL: 1 },
  processes: { gosi: { PENDING: 3, DONE: 40, ON_HOLD: 1 }, medical: { PENDING: 5, DONE: 38 }, criminal: { TRAINING: 2, REQUEST_SENT: 3, PENDING: 1, DONE: 36 } },
  assetForms: { APPROVED: 31, SENT: 2, PENDING_EMPLOYEE_APPROVAL: 1, REJECTED: 1 },
  unreturnedAssetItems: 4,
  offboardingByReason: { RESIGNATION: 4, CONTRACT_EXPIRY: 2, TERMINATION: 1 },
  expiringDocuments: { expired: 1, in30: 2, in60: 4, in90: 7 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/api/employees/options')) {
    return Promise.resolve(json({ departments: [...new Set(employees.map((e) => e.department))], jobTitles: [], projects: [] }));
  }
  if (path.startsWith('/api/employees?')) {
    const q = new URLSearchParams(path.split('?')[1]);
    const filter = q.get('filter') ?? 'all';
    const text = (q.get('q') ?? '').toLowerCase();
    const dept = q.get('department');
    const status = q.get('status');
    const items = employees.filter((e) => {
      const onboarding = !['ACTIVE', 'INACTIVE', 'WITHDRAWN'].includes(e.status);
      if (filter === 'onboarding' && !onboarding) return false;
      if (filter === 'active' && e.status !== 'ACTIVE') return false;
      if (filter === 'inactive' && e.status !== 'INACTIVE') return false;
      if (status && e.status !== status) return false;
      if (dept && e.department !== dept) return false;
      if (text && !`${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(text)) return false;
      return true;
    });
    return Promise.resolve(json({ items, total: items.length, counts }));
  }
  if (/^\/api\/employees\/[^/?]+\/documents/.test(path)) return Promise.resolve(json(expiryDocs));
  if (/^\/api\/employees\/[^/?]+\/photo/.test(path)) return Promise.resolve(json({ error: 'none' }, 404));
  if (/^\/api\/employees\/[^/?]+\/audit/.test(path)) return Promise.resolve(json({ items: profile.auditLogs, total: profile.auditTotal }));
  if (/^\/api\/employees\/[^/?]+$/.test(path)) return Promise.resolve(json(profile));
  if (path.startsWith('/api/users')) return Promise.resolve(json({ items: users, total: users.length }));
  if (path.startsWith('/api/notifications/log')) return Promise.resolve(json({ items: emailLog, total: emailLog.length }));
  if (path.startsWith('/api/reports/summary')) return Promise.resolve(json(reportSummary));
  if (path.startsWith('/api/dashboard')) return Promise.resolve(json(dashboard));
  if (path.startsWith('/api/lists')) return Promise.resolve(json({ lists: [] }));
  if (path.startsWith('/api/notifications')) return Promise.resolve(json({ items: [], unread: 0 }));
  // No live stream in the harness: a bodiless 204 makes the bell retry quietly every 5 s.
  if (path.startsWith('/api/events')) return Promise.resolve(new Response(null, { status: 204 }));
  if (path.startsWith('/api/auth/me/photo')) return Promise.resolve(json({ error: 'none' }, 404));
  return realFetch(input, init);
};
onBeforeUnmount(() => {
  window.fetch = realFetch;
});


/**
 * window.__capture(name): rasterise the page and POST it to the local capture
 * sink (scratchpad/capture-server.cjs), so the design can be reviewed as an
 * image when the pane cannot screenshot a busy page.
 */
(window as unknown as { __capture: (name: string, selector?: string) => Promise<unknown> }).__capture = async (name: string, selector = 'body') => {
  const target = (document.querySelector(selector) as HTMLElement | null) ?? document.body;
  const canvas = await html2canvas(target, { scale: 1, useCORS: true, logging: false, backgroundColor: null });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  const res = await fetch(`http://localhost:3999/shot?name=${name}`, { method: 'POST', body: blob });
  return res.json();
};

const pages = {
  employees: defineAsyncComponent(() => import('../pages/EmployeesPage.vue')),
  home: defineAsyncComponent(() => import('../pages/HomePage.vue')),
  profile: defineAsyncComponent(() => import('../pages/EmployeeDetailPage.vue')),
  emails: defineAsyncComponent(() => import('../pages/EmailLogPage.vue')),
  reports: defineAsyncComponent(() => import('../pages/ReportsPage.vue')),
  users: defineAsyncComponent(() => import('../pages/UsersPage.vue')),
  lists: defineAsyncComponent(() => import('../pages/ListsPage.vue')),
};
const page = computed(() => pages[(route.query['page'] as keyof typeof pages) ?? 'employees'] ?? pages.employees);
</script>

<template>
  <component :is="page" />
</template>
