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
        // Riyada's own teal and green carry the brand; the greys lean warm so
        // long HR sessions on a white surface do not feel clinical.
        colors: {
          primary: '#35708F',
          'on-primary': '#FFFFFF',
          secondary: '#4E9E8F',
          'on-secondary': '#FFFFFF',
          background: '#F5F4F1',
          surface: '#FFFFFF',
          'surface-bright': '#FFFFFF',
          'surface-light': '#FAF9F7',
          'surface-variant': '#EEEDE9',
          'on-surface-variant': '#505A64',
          success: '#2E7D5B',
          warning: '#9A6700',
          error: '#B3423F',
          info: '#3B6E9E',
          'on-background': '#1F2933',
          'on-surface': '#1F2933',
        },
        variables: {
          'border-color': '#1F2933',
          'border-opacity': 0.1,
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
        // teal is lifted so it reads on dark without glowing.
        colors: {
          primary: '#7FB3CF',
          'on-primary': '#0E2230',
          secondary: '#7CC4B5',
          'on-secondary': '#0D2320',
          background: '#15181C',
          surface: '#1B1F24',
          'surface-bright': '#2B323A',
          'surface-light': '#20252B',
          'surface-variant': '#262C33',
          'on-surface-variant': '#B3BAC3',
          success: '#63B98F',
          warning: '#E1B15A',
          error: '#E58A87',
          info: '#86AED4',
          'on-background': '#E6E8EB',
          'on-surface': '#E6E8EB',
        },
        variables: {
          'border-color': '#E6E8EB',
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
      rounded: 'md',
      variant: 'flat',
      class: 'text-none font-weight-medium',
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
