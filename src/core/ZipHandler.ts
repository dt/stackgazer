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
            const displayName = fileName === relativePath ? fileName : `${relativePath}`;
            
            matchingFiles.push({
              content,
              path: relativePath,
              name: displayName
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
      
      return matchingFiles;
    } catch (error) {
      throw new Error(`Failed to process zip file "${file.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
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
      // Include zip name and path to make it unique and traceable
      const fileName = `${originalZipName}:${extracted.path}`;
      
      // Create File with proper constructor
      const file = new File([blob], fileName, {
        type: 'text/plain',
        lastModified: Date.now()
      });
      
      return file;
    });
  }
}