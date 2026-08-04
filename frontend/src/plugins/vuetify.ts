import { createVuetify } from 'vuetify';
import 'vuetify/styles';

export const vuetify = createVuetify({
  locale: {
    locale: 'ar',
    fallback: 'en',
    rtl: { ar: true },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#1867C0',
          secondary: '#00695C',
          surface: '#FFFFFF',
          background: '#F4F6FA',
          success: '#2E7D32',
          warning: '#ED6C02',
          error: '#C62828',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#5C9EEB',
          secondary: '#26A69A',
          surface: '#161B26',
          background: '#0E1117',
          success: '#66BB6A',
          warning: '#FFA726',
          error: '#EF5350',
        },
      },
    },
  },
  defaults: {
    VCard: { rounded: 'xl' },
    VBtn: { rounded: 'lg' },
  },
});
