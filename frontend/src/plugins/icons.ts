/**
 * Icons: Lucide, rendered as inline SVG components, replacing the 1.3 MB
 * Material Design Icons webfont.
 *
 * Usage stays the Vuetify way — `icon="user-plus"` or `prepend-icon="mail"` —
 * with Lucide's kebab-case names. Only the icons the app actually uses are
 * bundled: `icon-registry.ts` is generated from the source tree, so a new
 * icon name means re-running `gen-icon-registry.cjs` (the console warns when
 * a name is missing and shows a placeholder).
 */
import { h, type FunctionalComponent } from 'vue';
import type { IconAliases, IconProps, IconSet } from 'vuetify';
import { ICONS } from './icon-registry';

const STROKE_WIDTH = 1.75;
const warned = new Set<string>();

function resolve(name: string): FunctionalComponent {
  const found = ICONS[name];
  if (found) return found;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[icons] "${name}" is not in the icon registry — showing a placeholder`);
  }
  return ICONS['circle'] as FunctionalComponent;
}

const LucideIcon: FunctionalComponent<IconProps> = (props) => {
  const name = String(props.icon ?? '');
  return h(resolve(name), {
    'stroke-width': STROKE_WIDTH,
    'aria-hidden': 'true',
    class: 'lucide-icon',
    // Size follows the surrounding font, exactly like an icon font did.
    width: '1em',
    height: '1em',
  });
};

export const lucideSet: IconSet = { component: LucideIcon };

/** Icons Vuetify uses internally (checkboxes, sort arrows, alerts…). */
export const iconAliases: IconAliases = {
  collapse: 'chevron-up',
  treeviewCollapse: 'chevron-down',
  treeviewExpand: 'chevron-right',
  complete: 'check',
  cancel: 'circle-x',
  close: 'x',
  delete: 'circle-x',
  clear: 'circle-x',
  success: 'circle-check',
  info: 'info',
  warning: 'triangle-alert',
  error: 'circle-alert',
  prev: 'chevron-left',
  next: 'chevron-right',
  checkboxOn: 'square-check',
  checkboxOff: 'square',
  checkboxIndeterminate: 'square-minus',
  delimiter: 'circle',
  sortAsc: 'arrow-up',
  sortDesc: 'arrow-down',
  expand: 'chevron-down',
  menu: 'menu',
  subgroup: 'chevron-down',
  dropdown: 'chevron-down',
  radioOn: 'circle-dot',
  radioOff: 'circle',
  edit: 'pencil',
  ratingEmpty: 'star',
  ratingFull: 'star',
  ratingHalf: 'star-half',
  loading: 'loader-circle',
  first: 'chevrons-left',
  last: 'chevrons-right',
  unfold: 'chevrons-up-down',
  file: 'paperclip',
  plus: 'plus',
  minus: 'minus',
  calendar: 'calendar',
  eyeDropper: 'pipette',
  upload: 'upload',
  color: 'palette',
  command: 'command',
  ctrl: 'chevron-up',
  space: 'space',
  shift: 'arrow-big-up',
  alt: 'option',
  enter: 'corner-down-left',
  arrowup: 'arrow-up',
  arrowdown: 'arrow-down',
  arrowleft: 'arrow-left',
  arrowright: 'arrow-right',
  backspace: 'delete',
  play: 'play',
  pause: 'pause',
  fullscreen: 'maximize',
  fullscreenExit: 'minimize',
  volumeHigh: 'volume-2',
  volumeMedium: 'volume-1',
  volumeLow: 'volume',
  volumeOff: 'volume-x',
};
