/**
 * Zip file handler
 */

import { ExtractResult, ZipFile } from './types.js';

export type JSZipType = typeof import('jszip');

export async function getJSZip(): Promise<JSZipType | null> {
  try {
    // Try bundled dynamic import first
    const mod = await import('jszip');
    return (mod as any).default ?? (mod as any);
  } catch {
    // Fall back to global from CDN tag
    const g = globalThis as any;
    const hasFailed = !!g.__zipCdnFailed;
    const JSZip = g.JSZip ?? null;
    return hasFailed || !JSZip ? null : JSZip;
  }
}

export class ZipHandler {
  static isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  }

  static async extractFiles(file: File, pattern: RegExp = /^(.*\/)?stacks\.txt$/): Promise<ExtractResult> {
    try {
      console.log('ZipHandler: Starting zip extraction for file:', file.name, 'pattern:', pattern);
      const JSZipClass = await getJSZip();
      if (!JSZipClass) {
        throw new Error('JSZip failed to load from CDN. Please check your internet connection and try again.');
      }
      console.log('ZipHandler: Got JSZip class, creating instance');
      const arrayBuffer = await file.arrayBuffer();
      console.log('ZipHandler: Loading zip from array buffer');
      const contents = await new JSZipClass().loadAsync(arrayBuffer);
      console.log('ZipHandler: Zip loaded successfully, extracting files');
      const result = await this.extractFromZip(contents, pattern);
      console.log('ZipHandler: Extraction completed, found', result.files.length, 'files');
      return result;
    } catch (error) {
      console.error('ZipHandler: Error during zip extraction:', error);
      throw new Error(
        `Failed to extract zip file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Extract files from JSZip instance
   */
  private static async extractFromZip(contents: any, pattern: RegExp): Promise<ExtractResult> {
    const extractedFiles: ZipFile[] = [];
    let totalSize = 0;

    console.log('ZipHandler: Scanning zip contents, found', Object.keys(contents.files).length, 'entries');
    
    // Extract matching files
    for (const [path, file] of Object.entries(contents.files)) {
      console.log('ZipHandler: Checking file:', path, 'is dir:', (file as any).dir, 'matches pattern:', pattern.test(path));
      if (!(file as any).dir && pattern.test(path)) {
        console.log('ZipHandler: Extracting matching file:', path);
        const content = await (file as any).async('text');
        extractedFiles.push({ path, content });
        totalSize += content.length;
        console.log('ZipHandler: Extracted file:', path, 'size:', content.length);
      }
    }

    console.log('ZipHandler: Final extraction result:', extractedFiles.length, 'files, total size:', totalSize);
    return { files: extractedFiles, totalSize };
  }

}
