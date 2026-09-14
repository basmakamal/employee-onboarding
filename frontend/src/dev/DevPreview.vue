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
};
const page = computed(() => pages[(route.query['page'] as keyof typeof pages) ?? 'employees'] ?? pages.employees);
</script>

<template>
  <component :is="page" />
</template>
