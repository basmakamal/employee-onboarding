import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';
import { i18n } from './i18n';
import { router } from './router';
import '@mdi/font/css/materialdesignicons.css';

createApp(App).use(createPinia()).use(router).use(i18n).use(vuetify).mount('#app');
