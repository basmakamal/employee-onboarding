/**
 * WOFF → plain TrueType/OpenType bytes, once. PDFKit's font library reads a
 * WOFF file by inflating the table it needs on every access, in plain
 * JavaScript — about 2 seconds per payslip. Unpacked once with Node's zlib,
 * the same font renders a payslip in a fraction of that.
 *
 * WOFF 1.0 layout: a 44-byte header, then one 20-byte entry per table
 * (tag, offset, compressed length, original length, checksum); a table is
 * zlib-compressed when its compressed length is smaller than the original.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF 1.0 font');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`font table ${woff.toString('latin1', at, at + 4)} has the wrong length`);
    return { tag: woff.subarray(at, at + 4), checksum: woff.readUInt32BE(at + 16), data };
  });

  // The sfnt offset table: version, table count and the binary-search hints.
  const pow2 = 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow2 * 16, 6);
  header.writeUInt16BE(Math.log2(pow2), 8);
  header.writeUInt16BE(numTables * 16 - pow2 * 16, 10);

  const parts: Buffer[] = [header];
  let offset = header.length;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    t.tag.copy(header, rec);
    header.writeUInt32BE(t.checksum, rec + 4);
    header.writeUInt32BE(offset, rec + 8);
    header.writeUInt32BE(t.data.length, rec + 12);
    const padded = (t.data.length + 3) & ~3; // tables start on 4-byte boundaries
    parts.push(t.data, Buffer.alloc(padded - t.data.length));
    offset += padded;
  });
  return Buffer.concat(parts);
}

const unpacked = new Map<string, Buffer>();

/** The font at `path`, unpacked on first use and kept for the life of the process. */
export function sfntFont(path: string): Buffer {
  let font = unpacked.get(path);
  if (!font) unpacked.set(path, (font = woffToSfnt(readFileSync(path))));
  return font;
}
