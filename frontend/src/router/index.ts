import { createRouter, createWebHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/trainees', name: 'trainees', component: () => import('../pages/TraineesPage.vue') },
    {
      path: '/trainees/:id',
      name: 'trainee-detail',
      component: () => import('../pages/TraineeDetailPage.vue'),
    },
  ],
});
