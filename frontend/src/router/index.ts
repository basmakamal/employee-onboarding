import { createRouter, createWebHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { public: true } },
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
      meta: { roles: ['HR'] },
    },
    {
      path: '/assistant',
      name: 'assistant',
      component: () => import('../pages/AssistantPage.vue'),
      meta: { roles: ['HR'] },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../pages/SettingsPage.vue'),
      meta: { roles: ['ADMIN'] },
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('../pages/AutomationPage.vue'),
      meta: { roles: ['ADMIN'] },
    },
    {
      path: '/ownership',
      name: 'ownership',
      component: () => import('../pages/OwnershipPage.vue'),
      meta: { roles: ['ADMIN'] },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('../pages/UsersPage.vue'),
      meta: { roles: ['ADMIN'] },
    },
    // Public signed-link pages (no staff chrome, token IS the auth).
    {
      path: '/form/:token',
      name: 'public-form',
      component: () => import('../pages/public/DataFormPage.vue'),
      meta: { public: true },
    },
    {
      path: '/approve-contract/:token',
      name: 'public-approval',
      component: () => import('../pages/public/ContractApprovalPage.vue'),
      meta: { public: true },
    },
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
 * Routes with meta.roles are additionally gated by role group (ADMIN
 * always passes) — deep links to admin pages bounce home.
 */
router.beforeEach(async (to) => {
  if (to.meta['public']) return true;

  const auth = useAuthStore();
  if (!auth.isAuthenticated) await auth.restore();
  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }

  const roles = to.meta['roles'] as string[] | undefined;
  if (roles && !auth.hasRole(...roles)) return { name: 'home' };
  return true;
});
