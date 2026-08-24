import { createVuetify } from 'vuetify';
import 'vuetify/styles';

/**
 * The design system in one file.
 *
 * Palette: a soft off-white ground in light mode and a deep slate one in dark —
 * never pure white or pure black, both of which read as harsh on long HR
 * sessions. Surfaces sit a step above the background so cards separate without
 * needing borders to shout.
 *
 * Geometry: nothing sharp. Cards are xl, controls lg, chips pill.
 *
 * The `defaults` block is what keeps 300+ components consistent without a
 * single utility class: set the intent here, not per usage.
 */
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
          primary: '#2563eb',
          secondary: '#0d9488',
          // Off-white, faintly cool — easier on the eye than #FFFFFF.
          background: '#f8fafc',
          surface: '#ffffff',
          'surface-bright': '#ffffff',
          'surface-variant': '#f1f5f9',
          'on-surface-variant': '#475569',
          success: '#15803d',
          warning: '#c2620c',
          error: '#dc2626',
          info: '#0369a1',
          'on-background': '#0f172a',
          'on-surface': '#0f172a',
        },
        variables: {
          'border-color': '#0f172a',
          'border-opacity': 0.08,
          'high-emphasis-opacity': 0.92,
          'medium-emphasis-opacity': 0.66,
          'theme-kbd': '#1e293b',
          'hover-opacity': 0.04,
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#60a5fa',
          secondary: '#2dd4bf',
          // Deep slate, not black: keeps depth without crushing contrast.
          background: '#0f172a',
          surface: '#1a2436',
          'surface-bright': '#243044',
          'surface-variant': '#243044',
          'on-surface-variant': '#cbd5e1',
          success: '#4ade80',
          warning: '#fbbf24',
          error: '#f87171',
          info: '#38bdf8',
          'on-background': '#e8eef7',
          'on-surface': '#e8eef7',
        },
        variables: {
          'border-color': '#e8eef7',
          'border-opacity': 0.1,
          'high-emphasis-opacity': 0.94,
          'medium-emphasis-opacity': 0.7,
          'hover-opacity': 0.06,
        },
      },
    },
  },
  defaults: {
    global: {
      // One transition language across every component.
      transition: 'fade-transition',
    },
    VCard: {
      rounded: 'xl',
      variant: 'flat',
    },
    VBtn: {
      rounded: 'lg',
      // Flat + no shouting caps: buttons read as words, not stamps.
      class: 'text-none font-weight-medium',
      elevation: 0,
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VTextarea: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VAutocomplete: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VCombobox: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VFileInput: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      hideDetails: 'auto',
    },
    VChip: {
      rounded: 'pill',
      size: 'small',
    },
    VAlert: {
      rounded: 'lg',
      variant: 'tonal',
      border: 'start',
    },
    VDialog: {
      transition: 'dialog-bottom-transition',
    },
    VSheet: {
      rounded: 'xl',
    },
    VList: {
      rounded: 'lg',
      density: 'comfortable',
    },
    VTabs: {
      sliderColor: 'primary',
    },
    VTab: {
      class: 'text-none font-weight-medium',
    },
    VDataTable: {
      hover: true,
      density: 'comfortable',
    },
    VSnackbar: {
      rounded: 'lg',
      location: 'bottom',
      timeout: 3500,
    },
    VTooltip: {
      location: 'top',
    },
    VMenu: {
      transition: 'slide-y-transition',
    },
    VProgressLinear: {
      rounded: true,
      height: 6,
    },
    VAvatar: {
      rounded: 'lg',
    },
  },
});
