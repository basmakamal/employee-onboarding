/**
 * Fluent Color icons — Microsoft's multicolour flat set — as a second
 * Vuetify icon set. They carry their own colours, so they are used only
 * where an icon *is* the signpost: sidebar navigation, page and card
 * headers. Buttons, chips and inline actions stay on single-colour Lucide.
 *
 * Usage: `icon="fluent:people"` (the `-24` size suffix of the source set is
 * dropped). Only the icons listed in scripts/gen-fluent-registry.cjs are
 * bundled; an unknown name logs once and renders nothing.
 */
import { h, type FunctionalComponent } from 'vue';
import type { IconProps, IconSet } from 'vuetify';
import { FLUENT_ICONS } from './fluent-registry';

const warned = new Set<string>();

const FluentIcon: FunctionalComponent<IconProps> = (props) => {
  const name = String(props.icon ?? '');
  const icon = FLUENT_ICONS[name];
  if (!icon) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[icons] "fluent:${name}" is not in the Fluent registry — add it to scripts/gen-fluent-registry.cjs`);
    }
    return h('span', { class: 'fluent-icon', 'aria-hidden': 'true' });
  }
  return h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${icon.width} ${icon.height}`,
    width: '1em',
    height: '1em',
    class: 'fluent-icon',
    'aria-hidden': 'true',
    innerHTML: icon.body,
  });
};

export const fluentSet: IconSet = { component: FluentIcon };
