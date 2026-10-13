import { createRouter, createWebHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { public: true } },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('../pages/ChangePasswordPage.vue'),
    },
    // The trainee pipeline lives inside the employee lifecycle now.
    { path: '/trainees', redirect: '/employees' },
    { path: '/trainees/:id', redirect: (to) => `/employees/${to.params['id'] as string}` },
    { path: '/employees', name: 'employees', component: () => import('../pages/EmployeesPage.vue') },
    {
      path: '/employees/:id',
      name: 'employee-detail',
      component: () => import('../pages/EmployeeDetailPage.vue'),
    },
    {
      path: '/offboardings/:id',
      name: 'offboarding',
      component: () => import('../pages/OffboardingPage.vue'),
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../pages/ReportsPage.vue'),
      meta: { permission: 'reports.view' },
    },
    {
      path: '/assistant',
      name: 'assistant',
      component: () => import('../pages/AssistantPage.vue'),
      meta: { permission: 'ai.use' },
    },
    {
      path: '/emails',
      name: 'email-log',
      component: () => import('../pages/EmailLogPage.vue'),
      meta: { permission: 'emails.view' },
    },
    {
      path: '/email-templates',
      name: 'email-templates',
      component: () => import('../pages/EmailTemplatesPage.vue'),
      meta: { permission: 'settings.manage' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../pages/SettingsPage.vue'),
      meta: { permission: 'settings.manage' },
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('../pages/AutomationPage.vue'),
      meta: { permission: 'settings.manage' },
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('../pages/CalendarPage.vue'),
      meta: { permission: 'settings.manage' },
    },
    {
      path: '/ownership',
      name: 'ownership',
      component: () => import('../pages/OwnershipPage.vue'),
      meta: { permission: 'settings.manage' },
    },
    {
      path: '/lists',
      name: 'lists',
      component: () => import('../pages/ListsPage.vue'),
      meta: { permission: 'lists.manage' },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('../pages/UsersPage.vue'),
      meta: { permission: 'users.manage' },
    },
    // Public signed-link pages (no staff chrome, token IS the auth).
    {
      path: '/form/:token',
      name: 'public-form',
      component: () => import('../pages/public/DataFormPage.vue'),
      meta: { public: true },
    },
    {
      path: '/contract/:token',
      name: 'public-contract',
      component: () => import('../pages/public/ContractPage.vue'),
      meta: { public: true },
    },
    // DEV ONLY: the design harness (fixtures in place of the API). Tree-shaken out of builds.
    ...(import.meta.env.DEV
      ? [{ path: '/dev/preview', name: 'dev-preview', component: () => import('../dev/DevPreview.vue'), meta: { public: true } }]
      : []),
    {
      path: '/approve-assets/:token',
      name: 'public-asset-approval',
      component: () => import('../pages/public/AssetApprovalPage.vue'),
      meta: { public: true },
    },
    {
      path: '/exit-interview/:token',
      name: 'public-exit-interview',
      component: () => import('../pages/public/ExitInterviewPage.vue'),
      meta: { public: true },
    },
  ],
});

/**
 * Staff routes require a session. On first navigation we try a silent
 * restore (httpOnly refresh cookie) so a page reload keeps you signed in.
 * Routes with meta.permission are additionally gated by permission (what
 * the session reports) — deep links to pages the user may not use bounce
 * home. The server enforces the same rule on every API call.
 */
router.beforeEach(async (to) => {
  if (to.meta['public']) return true;

  const auth = useAuthStore();
  if (!auth.isAuthenticated) await auth.restore();
  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }

  // A temporary (invitation / reset) password must be replaced before
  // anything else — every other page bounces here until it is.
  if (auth.user?.mustChangePassword && to.name !== 'change-password') {
    return { name: 'change-password' };
  }

  const permission = to.meta['permission'] as string | undefined;
  if (permission && !auth.can(permission)) return { name: 'home' };
  return true;
});
