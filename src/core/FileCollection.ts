import { ParsedFile, TraceCall, FileMetadata, NameExtractor, FileParsingSummary, CreatedByInfo, Goroutine } from './types.js';
import { SettingsManager } from './SettingsManager.js';

/**
 * Compute stack fingerprint for grouping goroutines
 */
function stackFingerprint(goroutine: Goroutine): string {
  const callsFingerprint = goroutine.calls
    .map(call => `${call.function} ${call.file}:${call.line}`)
    .join('\n');
  
  const createdByFingerprint = goroutine.createdBy 
    ? `\ncreated by ${goroutine.createdBy.function}`
    : '';
  
  return callsFingerprint + createdByFingerprint;
}

// Delimiter used to separate file prefix from goroutine ID
const GOROUTINE_ID_DELIMITER = '.';

/**
 * Concrete implementation of ParsedFile with prefix management
 */
class ParsedFileImpl implements ParsedFile {
  name: string;
  originalName: string;
  goroutines: Goroutine[];
  goroutineMap: Map<string, Goroutine>;
  metadata: FileMetadata;

  constructor(data: Omit<ParsedFile, 'setGoroutineIdPrefix'>) {
    this.name = data.name;
    this.originalName = data.originalName;
    this.goroutines = data.goroutines;
    this.goroutineMap = data.goroutineMap;
    this.metadata = data.metadata;
  }

  setGoroutineIdPrefix(newPrefix: string | null): void {
    // Update display IDs for all goroutines
    this.goroutines.forEach(goroutine => {
      if (newPrefix) {
        goroutine.id = `${newPrefix}${GOROUTINE_ID_DELIMITER}${goroutine.originalId}`;
        // Update creator references - we need to find the creator's original ID and prefix it
        if (goroutine.createdBy) {
          // The createdBy.creatorId is initially the raw ID from the stack trace
          // When we have prefixes, we need to figure out which file the creator is from
          // For now, assume creators are in the same file (this is the most common case)
          const creatorOriginalId = goroutine.createdBy.creatorId.split(GOROUTINE_ID_DELIMITER).pop() || goroutine.createdBy.creatorId;
          goroutine.createdBy.creatorId = `${newPrefix}${GOROUTINE_ID_DELIMITER}${creatorOriginalId}`;
        }
      } else {
        goroutine.id = goroutine.originalId;
        // Update creator references - remove prefix
        if (goroutine.createdBy) {
          const creatorOriginalId = goroutine.createdBy.creatorId.split(GOROUTINE_ID_DELIMITER).pop() || goroutine.createdBy.creatorId;
          goroutine.createdBy.creatorId = creatorOriginalId;
        }
      }
    });
  }
}

/**
 * Concrete implementation of Goroutine with stackFingerprint method
 */
class GoroutineImpl implements Goroutine {
  id: string;
  originalId: string;
  state: string;
  durationMinutes: number;
  calls: TraceCall[];
  fileName: string;
  createdBy: CreatedByInfo | null;

  constructor(data: Goroutine) {
    this.id = data.id;
    this.originalId = data.originalId;
    this.state = data.state;
    this.durationMinutes = data.durationMinutes;
    this.calls = data.calls;
    this.fileName = data.fileName;
    this.createdBy = data.createdBy;
  }
}

/**
 * Manages multiple parsed files and handles goroutine ID conflicts
 */
export class FileCollection {
  protected files = new Map<string, ParsedFile>(); // Map<fileName, ParsedFile>
  private nameExtractors: NameExtractor[] = [];
  protected settingsManager?: SettingsManager;

  constructor(nameExtractors: NameExtractor[] = [], settingsManager?: SettingsManager) {
    this.nameExtractors = nameExtractors;
    this.settingsManager = settingsManager;
    // Add built-in node ID extractor
    this.nameExtractors.push(new NodeIdExtractor());
  }

  /**
   * Add a file to the collection (synchronous version)
   */
  addFileSync(text: string, originalName: string): ParsedFile {
    // Parse goroutines first
    const goroutines = this.parseStackTracesForFile(text, originalName);
    
    // Check for duplicates
    const duplicateFileName = this.isDuplicateFile(goroutines);
    if (duplicateFileName) {
      throw new Error(`Duplicate file content detected. This file appears to contain the same goroutines as the already loaded file "${duplicateFileName}".`);
    }
    
    // Try auto-naming
    const autoName = this.extractAutoFileName(goroutines);
    const proposedName = autoName || originalName;
    
    // Handle name conflicts
    let fileName = this.ensureUniqueName(proposedName);
    
    // Create file metadata
    const metadata: FileMetadata = {
      totalGoroutines: goroutines.length,
      parseTime: new Date()
    };
    
    // Create goroutine map for O(1) lookups
    const goroutineMap = new Map<string, Goroutine>();
    goroutines.forEach(goroutine => {
      goroutineMap.set(goroutine.originalId, goroutine);
    });
    
    // Update fileName in goroutines and check creator existence
    goroutines.forEach(g => {
      if (g.createdBy) {
        g.createdBy.creatorExists = goroutineMap.has(g.createdBy.creatorId || '');
      }
      g.fileName = fileName
    });
    

    const parsedFile = new ParsedFileImpl({
      name: fileName,
      originalName,
      goroutines,
      goroutineMap,
      metadata
    });
    
    this.files.set(fileName, parsedFile);
    
    // Handle goroutine ID prefixing logic
    this.updateFilePrefixes();
    
    return parsedFile;
  }

  /**
   * Remove a file from the collection
   */
  removeFile(fileName: string): void {
    this.files.delete(fileName);
    this.updateFilePrefixes();
  }

  /**
   * Rename a file and update all associated goroutine IDs
   */
  renameFile(oldFileName: string, newName: string): void {
    const file = this.files.get(oldFileName);
    if (!file) return;
    
    const uniqueName = this.ensureUniqueName(newName, oldFileName);
    
    // Remove from map with old key
    this.files.delete(oldFileName);
    
    // Update file object
    file.name = uniqueName;
    
    // Update fileName in goroutines
    file.goroutines.forEach(goroutine => {
      goroutine.fileName = uniqueName;
    });
    
    // Add back to map with new key
    this.files.set(uniqueName, file);
    
    // Update all file prefixes
    this.updateFilePrefixes();
  }


  /**
   * Get all goroutines from all files
   */
  getAllGoroutines(): Goroutine[] {
    const result: Goroutine[] = [];
    for (const file of this.files.values()) {
      result.push(...file.goroutines);
    }
    return result;
  }

  /**
   * Get all files
   */
  getFiles(): Map<string, ParsedFile> {
    return new Map(this.files);
  }

  /**
   * Check if file content is duplicate (O(n) lookup using goroutine maps)
   * Returns the name of the matching file if duplicate found, null otherwise
   */
  isDuplicateFile(newGoroutines: Goroutine[]): string | null {
    // If there are no goroutines or no existing files, it's not a duplicate
    if (newGoroutines.length === 0 || this.files.size === 0) {
      return null;
    }
    
    // Check against each existing file
    for (const file of this.files.values()) {
      // Quick size check first
      if (file.goroutines.length !== newGoroutines.length) {
        continue;
      }
      
      // Check if every new goroutine exists in this file with matching fingerprint
      let isCompleteMatch = true;
      for (const newGoroutine of newGoroutines) {
        const existing = file.goroutineMap.get(newGoroutine.originalId);
        if (!existing || stackFingerprint(existing) !== stackFingerprint(newGoroutine)) {
          isCompleteMatch = false;
          break;
        }
      }
      
      if (isCompleteMatch) {
        return file.name; // Return the name of the matching file
      }
    }
    
    return null; // No existing file matches
  }

  private parseStackTracesForFile(text: string, fileName: string): Goroutine[] {
    const goroutines: Goroutine[] = [];
    const stackSections = text.split(/\n\s*\n/);
    let lineOffset = 0;
    
    // Cache prefixes for this parsing session to avoid repeated string parsing
    const functionPrefixes = this.settingsManager ? this.settingsManager.getFunctionTrimPrefixes() : [];
    const filePrefixes = this.settingsManager ? this.settingsManager.getFileTrimPrefixes() : [];
    
    stackSections.forEach((section, index) => {
      if (section.trim()) {
        const lines = section.trim().split('\n');
        const firstLine = lines[0];
        
        if (firstLine.includes('goroutine ') || lines.length > 1) {
          try {
            const parsedGoroutine = this.parseStackSection(lines, fileName, lineOffset + 1, functionPrefixes, filePrefixes);
            if (parsedGoroutine) {
              goroutines.push(parsedGoroutine);
            }
          } catch (error) {
            // Add section context to error message if not already included
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('section starting at line')) {
              const contextualError = new Error(`${message} (section ${index + 1}, starting at line ${lineOffset + 1})`);
              throw contextualError;
            } else {
              // Error already has detailed line info, just re-throw
              throw error;
            }
          }
        }
      }
      
      // Update line offset for next section
      // +1 for each line in section, +1 for the empty line separator (except last section)
      lineOffset += section.split('\n').length + (index < stackSections.length - 1 ? 1 : 0);
    });
    
    return goroutines;
  }

  private parseStackSection(lines: string[], fileName: string, startLineNumber: number, functionPrefixes: string[], filePrefixes: string[]): Goroutine | null {
    if (lines.length === 0) return null;
    
    const firstLine = lines[0];
    
    // Parse goroutine header
    const goroutineMatch = firstLine.match(/^goroutine\s+(\d+)\s+\[([^\]]+)\]:?/);
    
    let goroutineId: string, state: string, durationMinutes = 0;
    if (goroutineMatch) {
      goroutineId = goroutineMatch[1];
      const stateAndDuration = goroutineMatch[2];
      
      // Parse duration if present
      const durationMatch = stateAndDuration.match(/^(.+?),\s*(\d+)\s+minutes?$/);
      if (durationMatch) {
        state = durationMatch[1].trim();
        durationMinutes = parseInt(durationMatch[2]);
      } else {
        state = stateAndDuration.trim();
      }
    } else {
      // Strict parsing: fail on malformed goroutine headers
      const errorLine = startLineNumber; // First line of section
      const errorMessage = `Failed to parse section starting at line ${startLineNumber}, error on line ${errorLine}. Expected goroutine header format: "goroutine <id> [<state>]:" but got: "${firstLine}"`;
      console.error('PARSE ERROR:', errorMessage);
      console.error(`Full malformed section (starting at line ${startLineNumber}):`);
      console.error(lines.join('\n'));
      throw new Error(errorMessage);
    }
    
    // Parse stack trace into structured calls
    let calls: TraceCall[], createdBy: CreatedByInfo | null;
    try {
      const result = this.parseStackTrace(lines.slice(1), functionPrefixes, filePrefixes);
      calls = result.calls;
      createdBy = result.createdBy;
    } catch (stackError) {
      // Add section context to stack parsing errors
      const message = stackError instanceof Error ? stackError.message : String(stackError);
      throw new Error(`Failed to parse section starting at line ${startLineNumber}, stack parsing error: ${message}`);
    }
    
    
    return new GoroutineImpl({
      id: goroutineId,
      originalId: goroutineId,
      state,
      durationMinutes,
      calls,
      fileName,
      createdBy
    });
  }

  private parseStackTrace(lines: string[], functionPrefixes: string[], filePrefixes: string[]): { calls: TraceCall[], createdBy: CreatedByInfo | null } {
    const calls: TraceCall[] = [];
    let createdBy: CreatedByInfo | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (!line.trim()) continue;
      
      // Check for "created by" line
      if (line.trim().startsWith('created by')) {
        const match = line.trim().match(/^created by (.+) in goroutine (\d+)$/);
        if (match) {
          let file = 'unknown';
          let lineNum = 0;
          
          // Look for location on the next line (tab or 4 spaces)
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.startsWith('\t') || nextLine.startsWith('    ')) {
              const locationMatch = this.parseFileLine(nextLine, filePrefixes);
              if (locationMatch) {
                file = locationMatch.file;
                lineNum = locationMatch.line;
                i++; // Skip the location line since we processed it
              }
            }
          }
          
          createdBy = {
            function: this.trimFunctionNameWithPrefixes(match[1], functionPrefixes),
            creatorId: match[2],
            file: file,
            line: lineNum,
            creatorExists: false // Will be updated later
          };
        }
        continue;
      }
      
      // Function line (no leading spaces)
      if (!line.startsWith(' ')) {
        const match = line.trim().match(/^(.+)(\(.*\))$/);  // Allow empty parentheses
        if (match) {
          const functionName = match[1];
          const args = match[2];
          let file = 'unknown';
          let lineNum = 0;
          
          // Look for location on the next line (tab or 4 spaces)
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.startsWith('\t') || nextLine.startsWith('    ')) {
              const locationMatch = this.parseFileLine(nextLine, filePrefixes);
              if (locationMatch) {
                file = locationMatch.file;
                lineNum = locationMatch.line;
                i++; // Skip the location line since we processed it
              }
            }
          }
          
          calls.push({
            function: this.trimFunctionNameWithPrefixes(functionName, functionPrefixes),
            args: args,
            file: file,
            line: lineNum
          });
        }
      }
    }
    
    return { calls, createdBy };
  }

  private parseFileLine(line: string, filePrefixes: string[]): { file: string, line: number } | null {
    // Handle both formats: tabs (from example file) and 4 spaces (from user input)
    // Also handle lines that end immediately after the line number (no +0x offset)
    const match = line.match(/^(?:\t|    )(.+):(\d+)(?:\s|$)/);
    if (match) {
      return {
        file: this.trimFilePathWithPrefixes(match[1], filePrefixes),
        line: parseInt(match[2])
      };
    }
    return null;
  }

  /**
   * Trim configured prefixes from function names (with cached prefixes)
   */
  private trimFunctionNameWithPrefixes(functionName: string, prefixes: string[]): string {
    let trimmed = functionName;
    
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        trimmed = trimmed.slice(prefix.length);
        break; // Only trim the first matching prefix
      }
    }
    
    return trimmed;
  }

  /**
   * Trim configured prefixes from file paths (with cached prefixes)
   */
  private trimFilePathWithPrefixes(filePath: string, prefixes: string[]): string {
    let trimmed = filePath;
    
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        trimmed = trimmed.slice(prefix.length);
        break; // Only trim the first matching prefix
      }
    }
    
    return trimmed;
  }

  /**
   * Trim configured prefixes from function names (legacy method for backwards compatibility)
   */
  private trimFunctionName(functionName: string): string {
    if (!this.settingsManager) return functionName;
    
    const prefixes = this.settingsManager.getFunctionTrimPrefixes();
    return this.trimFunctionNameWithPrefixes(functionName, prefixes);
  }

  /**
   * Trim configured prefixes from file paths (legacy method for backwards compatibility)
   */
  private trimFilePath(filePath: string): string {
    if (!this.settingsManager) return filePath;
    
    const prefixes = this.settingsManager.getFileTrimPrefixes();
    return this.trimFilePathWithPrefixes(filePath, prefixes);
  }

  protected extractAutoFileName(goroutines: Goroutine[]): string | null {
    for (const extractor of this.nameExtractors) {
      const name = extractor.extract(goroutines);
      if (name) return name;
    }
    return null;
  }

  /**
   * Compute the derived name for a file without adding it to the collection
   * Used for sorting files before processing them
   */
  computeDerivedFileName(text: string, originalName: string): string {
    try {
      // Parse goroutines to extract name
      const goroutines = this.parseStackTracesForFile(text, originalName);
      const autoName = this.extractAutoFileName(goroutines);
      return autoName || originalName;
    } catch (error) {
      // If parsing fails, fall back to original name
      console.warn(`Failed to compute derived name for ${originalName}:`, error);
      return originalName;
    }
  }

  protected ensureUniqueName(proposedName: string, excludeFileName?: string): string {
    const existingNames = Array.from(this.files.keys())
      .filter(name => name !== excludeFileName);
    
    if (!existingNames.includes(proposedName)) {
      return proposedName;
    }
    
    let counter = 1;
    const nameParts = proposedName.split('.');
    const extension = nameParts.length > 1 ? '.' + nameParts.pop() : '';
    const baseName = nameParts.join('.');
    
    let uniqueName: string;
    do {
      uniqueName = `${baseName} (${counter})${extension}`;
      counter++;
    } while (existingNames.includes(uniqueName));
    
    return uniqueName;
  }

  /**
   * Update prefixes for all files based on how many files are loaded
   */
  protected updateFilePrefixes(): void {
    const files = Array.from(this.files.values());
    
    if (files.length <= 1) {
      // Single file or no files: no prefixes needed
      files.forEach(file => {
        file.setGoroutineIdPrefix(null);
      });
    } else {
      // Multiple files: use filename (without extension) as prefix
      files.forEach(file => {
        const prefix = file.name.split('.')[0];
        file.setGoroutineIdPrefix(prefix);
      });
    }
  }

}

/**
 * Built-in name extractor for CockroachDB node IDs
 */
class NodeIdExtractor implements NameExtractor {
  name = 'Node ID Extractor';

  extract(goroutines: Goroutine[]): string | null {
    for (const goroutine of goroutines) {
      for (const call of goroutine.calls) {
        if (call.function.includes('pgwire.(*Server).serveImpl')) {
          const nodeId = this.extractNodeIdFromArgs(call.args);
          if (nodeId !== null) {
            return `n${nodeId}`;
          }
        }
      }
    }
    return null;
  }

  private extractNodeIdFromArgs(argsString: string): number | null {
    try {
      // Look for pattern {0x0, 0x4, {0x[NUMBER], in the args
      const match = argsString.match(/\{0x0,\s*0x4,\s*\{0x([0-9a-fA-F]+),/);
      if (match && match[1]) {
        return parseInt(match[1], 16);
      }
    } catch (e) {
      // Parsing failed
    }
    
    return null;
  }
}