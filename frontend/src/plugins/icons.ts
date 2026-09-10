/**
 * Icons: Lucide, rendered as inline SVG components (tree-shaken), replacing
 * the 1.3 MB Material Design Icons webfont.
 *
 * Usage stays the Vuetify way — `icon="user-plus"` or `prepend-icon="mail"` —
 * with Lucide's kebab-case names. One stroke width everywhere so every icon
 * looks drawn by the same hand.
 */
import { h, type FunctionalComponent } from 'vue';
import type { IconAliases, IconProps, IconSet } from 'vuetify';
import * as lucide from 'lucide-vue-next';

const STROKE_WIDTH = 1.75;

/** `user-plus` → `UserPlus`; also accepts an already-PascalCase name. */
function toComponentName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

const registry = lucide as unknown as Record<string, FunctionalComponent>;
const warned = new Set<string>();

function resolve(name: string): FunctionalComponent {
  const found = registry[toComponentName(name)];
  if (found) return found;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[icons] unknown Lucide icon "${name}" — showing a placeholder`);
  }
  return registry['Circle'] as FunctionalComponent;
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
