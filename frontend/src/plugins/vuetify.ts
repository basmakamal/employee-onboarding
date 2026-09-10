import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import { iconAliases, lucideSet } from './icons';

/**
 * The design system in one file.
 *
 * Palette: soft indigo carries the brand, slate blue is the calmer second
 * voice, and every status colour is desaturated and paired with a soft tint so
 * chips and banners never shout. Light sits on a cool off-white; dark is a
 * designed warm dark grey — never pure white, never pure black.
 *
 * Geometry: nothing sharp. Cards are xl, panels lg, controls lg, chips pill.
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
  icons: {
    defaultSet: 'lucide',
    aliases: iconAliases,
    sets: { lucide: lucideSet },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#5B5BD6',
          'on-primary': '#FFFFFF',
          secondary: '#5B7DB1',
          'on-secondary': '#FFFFFF',
          background: '#F5F6FA',
          surface: '#FFFFFF',
          'surface-bright': '#FFFFFF',
          'surface-light': '#F7F8FB',
          'surface-variant': '#EFF1F6',
          'on-surface-variant': '#4B5163',
          success: '#2F8F62',
          warning: '#B27A11',
          error: '#C1465A',
          info: '#5B7DB1',
          'on-background': '#171A29',
          'on-surface': '#171A29',
        },
        variables: {
          'border-color': '#171A29',
          'border-opacity': 0.08,
          'high-emphasis-opacity': 0.92,
          'medium-emphasis-opacity': 0.62,
          'theme-kbd': '#262A33',
          'hover-opacity': 0.04,
          'focus-opacity': 0.08,
          'activated-opacity': 0.1,
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#8B8BF0',
          'on-primary': '#14142E',
          secondary: '#7E9DCB',
          'on-secondary': '#0F1520',
          background: '#16181D',
          surface: '#1E2128',
          'surface-bright': '#2E333D',
          'surface-light': '#22262E',
          'surface-variant': '#262A33',
          'on-surface-variant': '#AEB4C2',
          success: '#5CBF8A',
          warning: '#E0A742',
          error: '#E37079',
          info: '#7E9DCB',
          'on-background': '#E7E9EE',
          'on-surface': '#E7E9EE',
        },
        variables: {
          'border-color': '#E7E9EE',
          'border-opacity': 0.09,
          'high-emphasis-opacity': 0.94,
          'medium-emphasis-opacity': 0.68,
          'hover-opacity': 0.06,
          'focus-opacity': 0.1,
          'activated-opacity': 0.14,
        },
      },
    },
  },
  defaults: {
    global: {
      transition: 'fade-transition',
    },
    VCard: {
      rounded: 'xl',
      variant: 'flat',
    },
    VBtn: {
      rounded: 'lg',
      variant: 'flat',
      class: 'text-none font-weight-semibold',
    },
    VCardActions: {
      VBtn: { variant: 'flat' },
    },
    VTextField: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VTextarea: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VSelect: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VCombobox: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VFileInput: { variant: 'outlined', density: 'comfortable', rounded: 'lg' },
    VChip: {
      rounded: 'pill',
      size: 'small',
      variant: 'tonal',
    },
    VAlert: {
      rounded: 'lg',
      variant: 'tonal',
      border: false,
    },
    VDialog: {
      transition: 'dialog-bottom-transition',
    },
    VSheet: { rounded: 'xl' },
    VList: { rounded: 'lg', density: 'comfortable' },
    VTabs: { sliderColor: 'primary' },
    VTab: { class: 'text-none font-weight-medium' },
    VDataTable: { hover: true, density: 'comfortable' },
    VDataTableServer: { hover: true, density: 'comfortable' },
    VSnackbar: { rounded: 'lg', location: 'bottom', timeout: 3500 },
    VTooltip: { location: 'top' },
    VMenu: { transition: 'slide-y-transition' },
    VProgressLinear: { rounded: true, height: 6 },
    VAvatar: { rounded: 'lg' },
    VIcon: { size: 18 },
  },
});
