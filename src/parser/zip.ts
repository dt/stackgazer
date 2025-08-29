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

  static async extractFiles(
    file: File,
    pattern: RegExp = /^(.*\/)?stacks\.txt$/
  ): Promise<ExtractResult> {
    try {
      const JSZipClass = await getJSZip();
      if (!JSZipClass) {
        throw new Error(
          'JSZip failed to load from CDN. Please check your internet connection and try again.'
        );
      }
      const arrayBuffer = await file.arrayBuffer();
      const contents = await new JSZipClass().loadAsync(arrayBuffer);
      const result = await this.extractFromZip(contents, pattern);
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

    // Extract matching files
    for (const [path, file] of Object.entries(contents.files)) {
      if (!(file as any).dir && pattern.test(path)) {
        const content = await (file as any).async('text');
        extractedFiles.push({ path, content });
        totalSize += content.length;
      }
    }

    return { files: extractedFiles, totalSize };
  }
}
