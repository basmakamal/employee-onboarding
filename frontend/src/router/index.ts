import { createRouter, createWebHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { public: true } },
    // Reachable without a selected company — it is how you get one.
    { path: '/select-company', name: 'select-company', component: () => import('../pages/SelectCompanyPage.vue'), meta: { global: true } },
    { path: '/companies', name: 'companies', component: () => import('../pages/CompaniesPage.vue'), meta: { global: true, permission: 'companies.manage' } },
    { path: '/roles', name: 'roles', component: () => import('../pages/RolesPage.vue'), meta: { global: true, permission: 'users.manage' } },
    { path: '/organisation', name: 'organisation', component: () => import('../pages/OrganisationPage.vue'), meta: { permission: 'org.read' } },
    {
      path: '/change-password',
      meta: { global: true },
      name: 'change-password',
      component: () => import('../pages/ChangePasswordPage.vue'),
    },
    // The trainee pipeline lives inside the employee lifecycle now.
    { path: '/trainees', redirect: '/employees' },
    { path: '/trainees/:id', redirect: (to) => `/employees/${to.params['id'] as string}` },
    { path: '/employees', name: 'employees', component: () => import('../pages/EmployeesPage.vue') },
    { path: '/me', name: 'my-space', component: () => import('../pages/MySpacePage.vue'), meta: { self: true } },
    { path: '/employee-changes', name: 'employee-changes', component: () => import('../pages/EmployeeChangesPage.vue') },
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
      meta: { global: true, permission: 'settings.manage' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../pages/SettingsPage.vue'),
      meta: { global: true, permission: 'settings.manage' },
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('../pages/AutomationPage.vue'),
      meta: { global: true, permission: 'settings.manage' },
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('../pages/CalendarPage.vue'),
      meta: { global: true, permission: 'settings.manage' },
    },
    {
      path: '/ownership',
      name: 'ownership',
      component: () => import('../pages/OwnershipPage.vue'),
      meta: { global: true, permission: 'settings.manage' },
    },
    {
      path: '/lists',
      name: 'lists',
      component: () => import('../pages/ListsPage.vue'),
      meta: { global: true, permission: 'lists.manage' },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('../pages/UsersPage.vue'),
      meta: { global: true, permission: 'users.manage' },
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

  // An employee's self-service sign-in lives in "My space" only (the server
  // refuses it everywhere else anyway); staff have no "My space".
  const selfService = !!auth.user?.employeeId;
  if (selfService && !to.meta['self'] && to.name !== 'change-password') return { name: 'my-space' };
  if (!selfService && to.meta['self']) return { name: 'home' };

  const permission = to.meta['permission'] as string | undefined;
  if (permission && !auth.can(permission)) return { name: auth.user?.activeCompany ? 'home' : 'select-company' };

  // Company-owned pages need a selected workspace. Global administration
  // (companies, users, settings…) is marked meta.global and stays reachable.
  if (!to.meta['global'] && !auth.user?.activeCompany) {
    return { name: 'select-company', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  return true;
});
