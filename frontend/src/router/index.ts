import { createRouter, createWebHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue'), meta: { public: true } },
    { path: '/trainees', name: 'trainees', component: () => import('../pages/TraineesPage.vue') },
    {
      path: '/trainees/:id',
      name: 'trainee-detail',
      component: () => import('../pages/TraineeDetailPage.vue'),
    },
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
 */
router.beforeEach(async (to) => {
  if (to.meta['public']) return true;

  const auth = useAuthStore();
  if (!auth.isAuthenticated) await auth.restore();
  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  return true;
});
