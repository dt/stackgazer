/**
 * Utilities for compressing and decompressing data using modern browser APIs
 */
import { ExtractResult, ZipFile } from './types.js';

export class ZipHandler {
  static isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  }
  // Default: only "stacks.txt" anywhere in the archive
  private static async readFileChunk(file: File, start: number, length: number): Promise<ArrayBuffer> {
    const chunk = file.slice(start, start + length);
    return await chunk.arrayBuffer();
  }

  static async extractFiles(
    file: File,
    patterns: RegExp[] = [/^(.*\/)?stacks\.txt$/]
  ): Promise<ExtractResult> {
    if (typeof (globalThis as any).DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream is required by this app.');
    }

    // For large files, avoid loading entire file into memory
    // Read only small chunks as needed
    const fileSize = file.size;
    const maxSearchSize = Math.min(fileSize, 0x10000 + 22); // 64KiB + EOCD minimum
    
    // Read only the end portion that might contain EOCD
    const endBuf = await this.readFileChunk(file, fileSize - maxSearchSize, maxSearchSize);
    const endView = new DataView(endBuf);

    // ---- Locate EOCD (End of Central Directory) ----
    const EOCD_SIG = 0x06054b50;
    const ZIP64_EOCD_SIG = 0x06064b50;
    const ZIP64_EOCDL_SIG = 0x07064b50;
    const EOCD_MIN = 22;
    let eocd = -1;
    for (let i = endBuf.byteLength - EOCD_MIN; i >= 0; i--) {
      if (endView.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('ZIP: EOCD not found');

    const diskNum = endView.getUint16(eocd + 4, true);
    const cdDisk = endView.getUint16(eocd + 6, true);
    if (diskNum !== 0 || cdDisk !== 0) {
      throw new Error('ZIP: multi-disk archives are not supported');
    }

    let totalEntries = endView.getUint16(eocd + 10, true);
    let cdSize = endView.getUint32(eocd + 12, true);
    let cdOffset = endView.getUint32(eocd + 16, true);

    // ---- Check for ZIP64 format ----
    // ZIP64 is used when any field in EOCD is 0xFFFF (16-bit) or 0xFFFFFFFF (32-bit)
    const isZip64 = totalEntries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF;
    
    if (isZip64) {
      // Look for ZIP64 End of Central Directory Locator
      let zip64eocdl = -1;
      for (let i = eocd - 20; i >= Math.max(0, eocd - 200); i--) {
        if (endView.getUint32(i, true) === ZIP64_EOCDL_SIG) {
          zip64eocdl = i;
          break;
        }
      }
      if (zip64eocdl < 0) throw new Error('ZIP: ZIP64 EOCD Locator not found');

      // Read ZIP64 EOCD offset
      const zip64eocdOffset = endView.getUint32(zip64eocdl + 8, true) + (endView.getUint32(zip64eocdl + 12, true) * 0x100000000);
      
      // Read the ZIP64 EOCD record
      const zip64EocdBuf = await this.readFileChunk(file, zip64eocdOffset, 56); // ZIP64 EOCD minimum size
      const zip64EocdView = new DataView(zip64EocdBuf);
      
      // Verify ZIP64 EOCD signature
      if (zip64EocdView.getUint32(0, true) !== ZIP64_EOCD_SIG) {
        throw new Error('ZIP: Invalid ZIP64 EOCD signature');
      }

      // Read 64-bit values from ZIP64 EOCD
      totalEntries = zip64EocdView.getUint32(32, true); // Lower 32 bits only for safety
      cdSize = zip64EocdView.getUint32(40, true) + (zip64EocdView.getUint32(44, true) * 0x100000000);
      cdOffset = zip64EocdView.getUint32(48, true) + (zip64EocdView.getUint32(52, true) * 0x100000000);
    }

    // ---- Parse Central Directory entries ----
    // Read only the central directory portion
    const cdBuf = await this.readFileChunk(file, cdOffset, cdSize);
    const cdView = new DataView(cdBuf);
    const cdU8 = new Uint8Array(cdBuf);
    
    const CEN_SIG = 0x02014b50;
    type CEntry = {
      filename: string;
      method: number;
      flags: number;
      compSize: number;
      uncompSize: number;
      lfhOffset: number;
      hasZip64Extra: boolean;
    };
    const entries: CEntry[] = [];
    let p = 0; // Now relative to cdBuf start
    const cdEnd = cdSize;

    const tdUTF8 = new TextDecoder('utf-8');
    while (p < cdEnd && entries.length < totalEntries) {
      if (cdView.getUint32(p, true) !== CEN_SIG) {
        throw new Error('ZIP: bad central directory signature');
      }
      const flags = cdView.getUint16(p + 8, true);
      const method = cdView.getUint16(p + 10, true);
      let compSize = cdView.getUint32(p + 20, true);
      let uncompSize = cdView.getUint32(p + 24, true);
      const nameLen = cdView.getUint16(p + 28, true);
      const extraLen = cdView.getUint16(p + 30, true);
      const commentLen = cdView.getUint16(p + 32, true);
      let lfhOffset = cdView.getUint32(p + 42, true);

      const nameStart = p + 46;
      const nameBytes = cdU8.subarray(nameStart, nameStart + nameLen);
      // If UTF-8 flag (bit 11) is not set, this may be CP437; we'll best-effort decode as ASCII.
      const utf8 = (flags & (1 << 11)) !== 0;
      const filename = utf8 ? tdUTF8.decode(nameBytes) : String.fromCharCode(...nameBytes);

      // ---- Check for ZIP64 extra field ----
      let hasZip64Extra = false;
      const extraStart = nameStart + nameLen;
      let extraPos = extraStart;
      const extraEnd = extraStart + extraLen;
      
      while (extraPos < extraEnd - 4) {
        const extraId = cdView.getUint16(extraPos, true);
        const extraSize = cdView.getUint16(extraPos + 2, true);
        
        if (extraId === 0x0001) { // ZIP64 extra field
          hasZip64Extra = true;
          let zip64Pos = extraPos + 4;
          
          // Read ZIP64 fields in order: uncompressed size, compressed size, local header offset
          if (uncompSize === 0xFFFFFFFF && zip64Pos + 8 <= extraPos + 4 + extraSize) {
            uncompSize = cdView.getUint32(zip64Pos, true) + (cdView.getUint32(zip64Pos + 4, true) * 0x100000000);
            zip64Pos += 8;
          }
          if (compSize === 0xFFFFFFFF && zip64Pos + 8 <= extraPos + 4 + extraSize) {
            compSize = cdView.getUint32(zip64Pos, true) + (cdView.getUint32(zip64Pos + 4, true) * 0x100000000);
            zip64Pos += 8;
          }
          if (lfhOffset === 0xFFFFFFFF && zip64Pos + 8 <= extraPos + 4 + extraSize) {
            lfhOffset = cdView.getUint32(zip64Pos, true) + (cdView.getUint32(zip64Pos + 4, true) * 0x100000000);
            zip64Pos += 8;
          }
          break;
        }
        
        extraPos += 4 + extraSize;
      }

      entries.push({ filename, method, flags, compSize, uncompSize, lfhOffset, hasZip64Extra });

      p = nameStart + nameLen + extraLen + commentLen;
    }

    // ---- Helpers to read Local File Header and payload start ----
    const LOC_SIG = 0x04034b50;
    const getDataStartOffset = async (lfhOffset: number): Promise<number> => {
      // Read just the local file header (30 bytes minimum)
      const lfhBuf = await this.readFileChunk(file, lfhOffset, 30);
      const lfhView = new DataView(lfhBuf);
      
      if (lfhView.getUint32(0, true) !== LOC_SIG) {
        throw new Error('ZIP: bad local file header');
      }
      const nameLen = lfhView.getUint16(26, true);
      const extraLen = lfhView.getUint16(28, true);
      return lfhOffset + 30 + nameLen + extraLen;
    };

    // ---- Iterate & extract matches ----
    const files: ZipFile[] = [];
    let totalSize = 0;

    for (const e of entries) {
      if (!patterns.some(pattern => pattern.test(e.filename))) continue;

      if (e.method !== 0 && e.method !== 8) {
        throw new Error(`ZIP: unsupported compression method ${e.method} for ${e.filename}`);
      }

      const dataStart = await getDataStartOffset(e.lfhOffset);
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
      // Use safe addition for large files instead of 32-bit truncation
      totalSize = totalSize + e.uncompSize;
    }

    return { files, totalSize };
  }
}
