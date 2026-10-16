/**
 * Right-to-left text for PDFKit. PDFKit shapes Arabic letters correctly
 * (through fontkit) but lays words out left to right, so a line is first
 * split into directional runs with the Unicode bidi algorithm, the runs put
 * in visual order, the words of a right-to-left run reversed, and brackets
 * inside it mirrored. Each piece is then drawn on its own at an x position.
 */
import bidiImport from 'bidi-js';

/** The two calls used here. */
interface BidiApi {
  getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): { levels: Uint8Array };
  getMirroredCharacter(char: string): string | null;
}
// bidi-js is a UMD bundle: Node's ESM loader hands over the factory itself, some tools wrap it in `default`.
const imported = bidiImport as unknown;
const bidiFactory = (typeof imported === 'function' ? imported : (imported as { default: unknown }).default) as () => BidiApi;
const bidi = bidiFactory();

/** The pieces of one line, left to right as they appear on the page. */
export function visualPieces(text: string, rtl: boolean): string[] {
  if (!text) return [];
  const { levels } = bidi.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr');
  const runs: Array<{ text: string; level: number }> = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || levels[i] !== levels[start]) {
      runs.push({ text: text.slice(start, i), level: levels[start]! });
      start = i;
    }
  }
  // Rule L2: from the highest level down to the lowest odd one, reverse every run of that level or higher.
  const max = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1);
  for (let lv = max; lv >= minOdd; lv--) {
    for (let i = 0; i < runs.length; ) {
      if (runs[i]!.level < lv) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < runs.length && runs[j + 1]!.level >= lv) j++;
      runs.splice(i, j - i + 1, ...runs.slice(i, j + 1).reverse());
      i = j + 1;
    }
  }
  return runs.flatMap((r) => {
    if (r.level % 2 === 0) return [r.text];
    const mirrored = [...r.text].map((ch) => bidi.getMirroredCharacter(ch) ?? ch).join('');
    return mirrored.split(/( +)/).filter(Boolean).reverse();
  });
}

/** Does the text start with a right-to-left letter (Arabic)? */
export const isRtl = (text: string) => /[֐-ࣿ]/.test(text);
