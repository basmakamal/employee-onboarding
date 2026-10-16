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
    { path: '/employee-changes', name: 'employee-changes', component: () => import('../pages/EmployeeChangesPage.vue') },
    { path: '/contracts', name: 'contracts', component: () => import('../pages/ContractsPage.vue'), meta: { permission: ['contracts.write', 'employees.read'] } },
    { path: '/documents', name: 'documents', component: () => import('../pages/DocumentsRegisterPage.vue'), meta: { permission: 'documents.read' } },
    { path: '/workforce/shifts', name: 'shifts', component: () => import('../pages/ShiftsPage.vue'), meta: { permission: ['schedule.read', 'schedule.manage'] } },
    { path: '/workforce/attendance', name: 'attendance', component: () => import('../pages/AttendancePage.vue'), meta: { permission: ['attendance.read', 'attendance.manage', 'attendance.approve'] } },
    { path: '/workforce/overtime', name: 'overtime', component: () => import('../pages/OvertimePage.vue'), meta: { permission: ['attendance.read', 'attendance.manage', 'attendance.approve'] } },
    { path: '/approvals', name: 'approvals', component: () => import('../pages/ApprovalsPage.vue'), meta: { permission: ['leave.approve', 'attendance.approve', 'pay.approve'] } },
    { path: '/payroll/runs', name: 'payroll-runs', component: () => import('../pages/PayrollRunsPage.vue'), meta: { permission: ['payroll.prepare', 'payroll.approve'] } },
    { path: '/payroll/runs/:id', name: 'payroll-run', component: () => import('../pages/PayrollRunPage.vue'), meta: { permission: ['payroll.prepare', 'payroll.approve'] } },
    { path: '/hr-reports', name: 'hr-reports', component: () => import('../pages/WorkforceReportsPage.vue'), meta: { permission: ['attendance.read', 'attendance.manage', 'attendance.approve', 'leave.read', 'leave.manage', 'leave.approve', 'payroll.prepare', 'payroll.approve', 'compensation.read'] } },
    { path: '/payroll/payslips', name: 'payslips', component: () => import('../pages/PayslipsPage.vue'), meta: { permission: ['payroll.prepare', 'payroll.approve', 'payroll.manage'] } },
    { path: '/payroll/money', name: 'payroll-money', component: () => import('../pages/LoansPage.vue'), meta: { permission: ['compensation.read', 'pay.approve'] } },
    { path: '/payroll/setup', name: 'payroll-setup', component: () => import('../pages/PayrollSetupPage.vue'), meta: { permission: ['payroll.manage', 'compensation.read'] } },
    { path: '/workforce/leave', name: 'leave', component: () => import('../pages/LeavePage.vue'), meta: { permission: ['leave.read', 'leave.manage', 'leave.approve'] } },
    { path: '/workforce/leave-types', name: 'leave-types', component: () => import('../pages/LeaveTypesPage.vue'), meta: { permission: ['leave.read', 'leave.manage', 'leave.approve'] } },
    { path: '/workforce/schedule', name: 'team-schedule', component: () => import('../pages/TeamSchedulePage.vue'), meta: { permission: ['schedule.read', 'schedule.manage'] } },
    { path: '/system-health', name: 'system-health', component: () => import('../pages/SystemHealthPage.vue'), meta: { global: true, permission: 'settings.manage' } },
    { path: '/audit', name: 'audit', component: () => import('../pages/AuditPage.vue'), meta: { permission: 'audit.read' } },
    { path: '/offboardings', name: 'offboardings', component: () => import('../pages/OffboardingsPage.vue'), meta: { permission: ['offboarding.manage', 'settlement.approve'] } },
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

  // One permission, or a list of which any one is enough.
  const permission = to.meta['permission'] as string | string[] | undefined;
  if (permission && !auth.can(...(Array.isArray(permission) ? permission : [permission]))) return { name: auth.user?.activeCompany ? 'home' : 'select-company' };

  // Company-owned pages need a selected workspace. Global administration
  // (companies, users, settings…) is marked meta.global and stays reachable.
  if (!to.meta['global'] && !auth.user?.activeCompany) {
    return { name: 'select-company', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  return true;
});
