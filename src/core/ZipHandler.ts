// @ts-ignore
import JSZip from 'https://cdn.skypack.dev/jszip@3.10.1';

/**
 * Utility for handling zip file extraction and pattern matching
 */
export class ZipHandler {
  
  /**
   * Check if a file is a zip file based on its name and/or content
   */
  static isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || 
           file.type === 'application/zip' ||
           file.type === 'application/x-zip-compressed';
  }

  /**
   * Extract files from a zip archive that match the given pattern
   * @param file - The zip file to extract from
   * @param pattern - Glob pattern to match files (e.g., "**\/stacks.txt")
   * @returns Array of extracted files with their content and paths
   */
  static async extractMatchingFiles(file: File, pattern: string): Promise<Array<{content: string, path: string, name: string}>> {
    try {
      const zip = await JSZip.loadAsync(file);
      const matchingFiles: Array<{content: string, path: string, name: string}> = [];
      
      // Convert glob pattern to regex
      const regex = this.globToRegex(pattern);
      
      console.log(`converted glob pattern "${pattern}" to regex "${regex}"`);

      // Check each file in the zip
      const filePromises: Promise<void>[] = [];
      
      zip.forEach((relativePath: string, zipEntry: any) => {
        // Skip directories
        if (zipEntry.dir) {
          return;
        }

        // Check if the file path matches the pattern
        if (regex.test(relativePath)) {
          console.log(`file ${relativePath} in zip file matches pattern "${pattern}", extracting...`);

          const filePromise = zipEntry.async('text').then((content: string) => {
            // Extract just the filename for display, but preserve path for uniqueness
            const fileName = relativePath.split('/').pop() || relativePath;
            
            matchingFiles.push({
              content,
              path: relativePath,
              name: relativePath
            });
          }).catch((error: any) => {
            console.warn(`Failed to extract file ${relativePath}:`, error);
          });
          
          filePromises.push(filePromise);
        } else {
          console.log(`file ${relativePath} in zip file does not match pattern "${pattern}"`);
        }
      });
      
      // Wait for all files to be extracted
      await Promise.all(filePromises);
      
      // Remove common prefix and suffix from file names.
      const filePaths = matchingFiles.map(f => f.name);
      const commonPrefix = this.findCommonPrefix(filePaths);
      const commonSuffix = this.findCommonSuffix(filePaths);
      
      matchingFiles.forEach(f => {
        let cleanName = f.name;
        
        // Remove common prefix
        if (cleanName.startsWith(commonPrefix)) {
          cleanName = cleanName.slice(commonPrefix.length);
        }
        
        // Remove common suffix
        if (cleanName.endsWith(commonSuffix)) {
          cleanName = cleanName.slice(0, -commonSuffix.length);
        }
        
        f.name = cleanName;
      });

      return matchingFiles;

    } catch (error) {
      throw new Error(`Failed to process zip file "${file.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find the longest common suffix in an array of strings
   */
  private static findCommonSuffix(strings: string[]): string {
    if (strings.length === 0) return '';
    if (strings.length === 1) return '';
    
    let suffix = '';
    const minLength = Math.min(...strings.map(s => s.length));
    
    // Work backwards from the end of the strings
    for (let i = 1; i <= minLength; i++) {
      const char = strings[0].charAt(strings[0].length - i);
      const allMatch = strings.every(str => str.charAt(str.length - i) === char);
      
      if (allMatch) {
        suffix = char + suffix;
      } else {
        break;
      }
    }
    
    return suffix;
  }

  /**
   * Find the longest common prefix in an array of strings, but only up to the penultimate /
   * For example: 'a/b/c/1', 'a/b/c/2', 'a/c/1', 'a/c/2' should return 'a/' (not 'a/b/' or 'a/c/')
   */
  private static findCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';
    if (strings.length === 1) return '';
    
    let prefix = '';
    const minLength = Math.min(...strings.map(s => s.length));
    
    // Find character-by-character common prefix
    for (let i = 0; i < minLength; i++) {
      const char = strings[0].charAt(i);
      const allMatch = strings.every(str => str.charAt(i) === char);
      
      if (allMatch) {
        prefix += char;
      } else {
        break;
      }
    }
    
    // Truncate to penultimate slash
    // Count slashes and keep only up to the penultimate one
    const slashIndices = [];
    for (let i = 0; i < prefix.length; i++) {
      if (prefix.charAt(i) === '/') {
        slashIndices.push(i);
      }
    }
    
    // If we have at least 2 slashes, truncate after the penultimate one
    if (slashIndices.length >= 2) {
      const penultimateSlashIndex = slashIndices[slashIndices.length - 2];
      prefix = prefix.slice(0, penultimateSlashIndex + 1);
    }
    
    return prefix;
  }

  /**
   * Convert a glob pattern to a regular expression
   * Supports basic glob syntax: *, **, ?, [abc], [a-z]
   */
  private static globToRegex(pattern: string): RegExp {
    // First handle glob patterns before escaping
    let regexPattern = pattern
      .replace(/\*\*/g, '__DOUBLESTAR__') // Temporarily replace **
      .replace(/\*/g, '__STAR__') // Temporarily replace *
      .replace(/\?/g, '__QUESTION__') // Temporarily replace ?
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/__DOUBLESTAR__/g, '.*') // ** matches anything including path separators
      .replace(/__STAR__/g, '[^/]*') // * matches anything except path separators
      .replace(/__QUESTION__/g, '[^/]'); // ? matches any single character except path separator
    
    // Handle character classes [abc] and [a-z] - need to un-escape the brackets
    regexPattern = regexPattern.replace(/\\\[([^\]]*)\\\]/g, '[$1]');
    
    // Anchor the pattern to match the entire path
    regexPattern = '^' + regexPattern + '$';
    
    return new RegExp(regexPattern, 'i'); // Case insensitive
  }

  /**
   * Get a user-friendly description of what files would match a pattern
   */
  static getPatternDescription(pattern: string): string {
    if (pattern === '**/stacks.txt') {
      return 'Files named "stacks.txt" in any directory';
    } else if (pattern === '*.txt') {
      return 'Text files in the root directory';
    } else if (pattern === '**/*.txt') {
      return 'Text files in any directory';
    } else if (pattern === '**/*.log') {
      return 'Log files in any directory';
    } else if (pattern.includes('**/')) {
      return `Files matching "${pattern.replace('**/', '')}" in any directory`;
    } else if (pattern.includes('*')) {
      return `Files matching "${pattern}" in the root directory`;
    } else {
      return `Files exactly matching "${pattern}"`;
    }
  }

  /**
   * Create virtual File objects from extracted zip content
   * These can be used with the existing file processing pipeline
   */
  static createVirtualFiles(extractedFiles: Array<{content: string, path: string, name: string}>, originalZipName: string): File[] {
    return extractedFiles.map(extracted => {
      // Create a Blob from the content
      const blob = new Blob([extracted.content], { type: 'text/plain' });
      
      // Create a File object with a meaningful name
      // Use the cleaned name (common suffix already removed)
      const fileName = extracted.name || extracted.path;
      
      // Create File with proper constructor
      const file = new File([blob], fileName, {
        type: 'text/plain',
        lastModified: Date.now()
      });
      
      return file;
    });
  }
}