/**
 * Utilities for compressing and decompressing data using modern browser APIs
 */
import { ExtractResult, ZipFile } from './types.js';

export class ZipHandler {
  static isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  }
  // Default: only "stacks.txt" anywhere in the archive
  static async extractFiles(
    file: File,
    patterns: RegExp[] = [/^(.*\/)?stacks\.txt$/]
  ): Promise<ExtractResult> {
    if (typeof (globalThis as any).DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream is required by this app.');
    }

    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    // ---- Locate EOCD (End of Central Directory) ----
    const EOCD_SIG = 0x06054b50;
    const EOCD_MIN = 22;
    const maxSearch = Math.min(buf.byteLength, 0x10000 + EOCD_MIN); // per spec: 64KiB + EOCD
    let eocd = -1;
    for (let i = buf.byteLength - EOCD_MIN; i >= buf.byteLength - maxSearch; i--) {
      if (i < 0) break;
      if (view.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('ZIP: EOCD not found');

    const diskNum = view.getUint16(eocd + 4, true);
    const cdDisk = view.getUint16(eocd + 6, true);
    if (diskNum !== 0 || cdDisk !== 0) {
      throw new Error('ZIP: multi-disk archives are not supported');
    }

    const totalEntries = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);

    // ---- Parse Central Directory entries ----
    const CEN_SIG = 0x02014b50;
    type CEntry = {
      filename: string;
      method: number;
      flags: number;
      compSize: number;
      uncompSize: number;
      lfhOffset: number;
    };
    const entries: CEntry[] = [];
    let p = cdOffset;
    const cdEnd = cdOffset + cdSize;

    const tdUTF8 = new TextDecoder('utf-8');
    while (p < cdEnd && entries.length < totalEntries) {
      if (view.getUint32(p, true) !== CEN_SIG) {
        throw new Error('ZIP: bad central directory signature');
      }
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const uncompSize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const lfhOffset = view.getUint32(p + 42, true);

      const nameStart = p + 46;
      const nameBytes = u8.subarray(nameStart, nameStart + nameLen);
      // If UTF-8 flag (bit 11) is not set, this may be CP437; we'll best-effort decode as ASCII.
      const utf8 = (flags & (1 << 11)) !== 0;
      const filename = utf8 ? tdUTF8.decode(nameBytes) : String.fromCharCode(...nameBytes);

      entries.push({ filename, method, flags, compSize, uncompSize, lfhOffset });

      p = nameStart + nameLen + extraLen + commentLen;
    }

    // ---- Helpers to read Local File Header and payload start ----
    const LOC_SIG = 0x04034b50;
    function getDataStartOffset(lfhOffset: number): number {
      if (view.getUint32(lfhOffset, true) !== LOC_SIG) {
        throw new Error('ZIP: bad local file header');
      }
      const nameLen = view.getUint16(lfhOffset + 26, true);
      const extraLen = view.getUint16(lfhOffset + 28, true);
      return lfhOffset + 30 + nameLen + extraLen;
    }

    // ---- Iterate & extract matches ----
    const files: ZipFile[] = [];
    let totalSize = 0;

    for (const e of entries) {
      if (!patterns.some(pattern => pattern.test(e.filename))) continue;

      if (e.method !== 0 && e.method !== 8) {
        throw new Error(`ZIP: unsupported compression method ${e.method} for ${e.filename}`);
      }

      const dataStart = getDataStartOffset(e.lfhOffset);
      const compressedSlice = (file as Blob).slice(dataStart, dataStart + e.compSize);

      let outBlob: Blob;
      if (e.method === 0) {
        // stored
        outBlob = compressedSlice;
      } else {
        // deflate in ZIP is raw DEFLATE (method 8)
        const ds = new DecompressionStream('deflate-raw');
        const stream = compressedSlice.stream().pipeThrough(ds);
        outBlob = await new Response(stream).blob();
      }

      files.push({ path: e.filename, content: outBlob });
      totalSize += e.uncompSize >>> 0;
    }

    return { files, totalSize };
  }
}
