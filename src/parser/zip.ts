/**
 * Zip file handler
 */

import JSZip from 'jszip';
import { ExtractResult, ZipFile } from './types.js';

export class ZipHandler {
  static isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  }

  static async extractFiles(file: File, pattern: string = '**/stacks.txt'): Promise<ExtractResult> {
    try {
      const contents = await new JSZip().loadAsync(file.arrayBuffer());
      return this.extractFromZip(contents, pattern);
    } catch (error) {
      throw new Error(
        `Failed to extract zip file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Extract files from JSZip instance
   */
  private static async extractFromZip(contents: JSZip, pattern: string): Promise<ExtractResult> {
    const extractedFiles: ZipFile[] = [];
    let totalSize = 0;

    // Convert glob pattern to regex for matching
    const regex = this.globToRegex(pattern);

    // Extract matching files
    for (const [path, file] of Object.entries(contents.files)) {
      if (!file.dir && regex.test(path)) {
        const content = await file.async('text');
        extractedFiles.push({ path, content });
        totalSize += content.length;
      }
    }

    return { files: extractedFiles, totalSize };
  }

  /**
   * Convert glob pattern to regex
   */
  private static globToRegex(pattern: string): RegExp {
    // Handle the special case of **/ at the start
    if (pattern.startsWith('**/')) {
      // **/filename should match both "filename" and "path/filename"
      const remainder = pattern.substring(3); // Remove "**/"
      const escapedRemainder = remainder
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');

      // Match either at root or with any path prefix
      return new RegExp(`^(.*?/)?${escapedRemainder}$`);
    }

    // Standard glob to regex conversion
    let regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*?')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');

    return new RegExp(`^${regex}$`);
  }
}
