import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import { iconAliases, lucideSet } from './icons';
import { fluentSet } from './fluent-icons';

/**
 * The design system in one file.
 *
 * Palette: a deep violet carries the brand, Riyada green is the calmer second
 * voice, and every status colour is desaturated and paired with a soft tint so
 * chips and banners never shout. Light sits on a lilac-tinted off-white; dark
 * is a designed violet-leaning dark grey — never pure white, never pure black.
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
    // `fluent:` — multicolour Fluent Color icons for navigation and headers.
    sets: { lucide: lucideSet, fluent: fluentSet },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        // A deep violet carries the brand (a shade richer and cooler than the
        // usual SaaS lavender); Riyada green stays as the second voice. The
        // greys lean lilac so the page and the accent belong together.
        colors: {
          primary: '#6636D0',
          'on-primary': '#FFFFFF',
          secondary: '#4E9E8F',
          'on-secondary': '#FFFFFF',
          background: '#F6F4FB',
          surface: '#FFFFFF',
          'surface-bright': '#FFFFFF',
          'surface-light': '#FAF9FD',
          'surface-variant': '#EFEBF8',
          'on-surface-variant': '#544C6B',
          success: '#2E7D5B',
          warning: '#9A6700',
          error: '#B3423F',
          info: '#4A6FD8',
          'on-background': '#221C38',
          'on-surface': '#221C38',
        },
        variables: {
          'border-color': '#2A2145',
          'border-opacity': 0.09,
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
        // Three dark levels (page, surface, raised), none of them black; the
        // violet is lifted to lavender so it reads on dark without glowing.
        colors: {
          primary: '#B9A4FF',
          'on-primary': '#22124A',
          secondary: '#7CC4B5',
          'on-secondary': '#0D2320',
          background: '#15131C',
          surface: '#1B1825',
          'surface-bright': '#2B2739',
          'surface-light': '#201C2B',
          'surface-variant': '#272234',
          'on-surface-variant': '#B8B2C8',
          success: '#63B98F',
          warning: '#E1B15A',
          error: '#E58A87',
          info: '#8FA9E8',
          'on-background': '#E8E5F0',
          'on-surface': '#E8E5F0',
        },
        variables: {
          'border-color': '#E8E5F0',
          'border-opacity': 0.1,
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
      rounded: 'lg',
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
    VTextField: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VTextarea: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VSelect: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VCombobox: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VFileInput: { variant: 'outlined', density: 'comfortable', rounded: 'md' },
    VChip: {
      rounded: 'pill',
      size: 'small',
      variant: 'tonal',
    },
    VAlert: {
      rounded: 'md',
      variant: 'tonal',
      border: false,
    },
    VDialog: {
      transition: 'dialog-bottom-transition',
    },
    VSheet: { rounded: 'lg' },
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
