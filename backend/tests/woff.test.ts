/**
 * The payslip font is unpacked from WOFF once (PDFKit reading WOFF directly
 * cost ~2 s a page). The result must be a valid font file: same flavour and
 * tables, each table where its directory entry says, on a 4-byte boundary.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sfntFont, woffToSfnt } from '../src/modules/payroll/woff.js';

const require = createRequire(import.meta.url);
const FONT = join(dirname(require.resolve('@ibm/plex-sans-arabic/package.json')), 'fonts', 'complete', 'woff', 'IBMPlexSansArabic-Regular.woff');

describe('WOFF unpacking', () => {
  const woff = readFileSync(FONT);
  const ttf = woffToSfnt(woff);

  it('keeps the flavour and every table, laid out as a plain font file', () => {
    expect(ttf.readUInt32BE(0)).toBe(woff.readUInt32BE(4));
    const tables = ttf.readUInt16BE(4);
    expect(tables).toBe(woff.readUInt16BE(12));
    expect(tables).toBeGreaterThan(10);
    const tags: string[] = [];
    for (let i = 0; i < tables; i++) {
      const rec = 12 + i * 16;
      const offset = ttf.readUInt32BE(rec + 8);
      const length = ttf.readUInt32BE(rec + 12);
      tags.push(ttf.toString('latin1', rec, rec + 4));
      expect(offset % 4).toBe(0);
      expect(offset + length).toBeLessThanOrEqual(ttf.length);
    }
    expect(tags).toEqual(expect.arrayContaining(['cmap', 'glyf', 'head', 'GSUB']));
    // 'head' carries a fixed magic number — proof the table landed intact.
    const head = tags.indexOf('head');
    expect(ttf.readUInt32BE(ttf.readUInt32BE(12 + head * 16 + 8) + 12)).toBe(0x5f0f3cf5);
  });

  it('is unpacked once and reused', () => {
    expect(sfntFont(FONT)).toBe(sfntFont(FONT));
  });

  it('refuses anything that is not WOFF 1.0', () => {
    expect(() => woffToSfnt(ttf)).toThrow(/WOFF/);
  });
});
