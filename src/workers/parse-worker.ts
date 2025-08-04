/**
 * Web Worker for background stack trace parsing
 * Handles CPU-intensive parsing operations without blocking the UI
 */

import { Goroutine, TraceCall, CreatedByInfo } from '../core/types.js';

interface ParseWorkerMessage {
  type: 'PARSE_FILE';
  id: string;
  text: string;
  fileName: string;
  settings: {
    functionTrimPrefixes: string[];
    fileTrimPrefixes: string[];
  };
}

interface ParseWorkerResult {
  type: 'PARSE_COMPLETE' | 'PARSE_ERROR';
  id: string;
  goroutines?: Goroutine[];
  error?: string;
  stats?: {
    goroutineCount: number;
    parseTimeMs: number;
    memoryUsageMB?: number;
  };
}

class ParseWorker {
  
  onMessage(e: MessageEvent<ParseWorkerMessage>): void {
    const { type, id, text, fileName, settings } = e.data;
    
    if (type === 'PARSE_FILE') {
      this.parseFile(id, text, fileName, settings);
    }
  }
  
  private async parseFile(
    id: string, 
    text: string, 
    fileName: string, 
    settings: { functionTrimPrefixes: string[]; fileTrimPrefixes: string[] }
  ): Promise<void> {
    const startTime = performance.now();
    const startMemory = (performance as any).memory?.usedJSHeapSize || 0;
    
    try {
      const goroutines = this.parseStackTracesForFile(text, fileName, settings);
      const endTime = performance.now();
      const endMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      const result: ParseWorkerResult = {
        type: 'PARSE_COMPLETE',
        id,
        goroutines,
        stats: {
          goroutineCount: goroutines.length,
          parseTimeMs: endTime - startTime,
          memoryUsageMB: (endMemory - startMemory) / (1024 * 1024)
        }
      };
      
      self.postMessage(result);
    } catch (error) {
      const result: ParseWorkerResult = {
        type: 'PARSE_ERROR',
        id,
        error: error instanceof Error ? error.message : String(error)
      };
      
      self.postMessage(result);
    }
  }
  
  private parseStackTracesForFile(
    text: string, 
    fileName: string,
    settings: { functionTrimPrefixes: string[]; fileTrimPrefixes: string[] }
  ): Goroutine[] {
    const goroutines: Goroutine[] = [];
    const stackSections = text.split(/\n\s*\n/);
    let lineOffset = 0;
    
    stackSections.forEach((section, index) => {
      if (section.trim()) {
        const lines = section.trim().split('\n');
        const firstLine = lines[0];
        
        if (firstLine.includes('goroutine ') || lines.length > 1) {
          try {
            const parsedGoroutine = this.parseStackSection(
              lines, 
              fileName, 
              lineOffset + 1, 
              settings.functionTrimPrefixes,
              settings.fileTrimPrefixes
            );
            if (parsedGoroutine) {
              goroutines.push(parsedGoroutine);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('section starting at line')) {
              const contextualError = new Error(`${message} (section ${index + 1}, starting at line ${lineOffset + 1})`);
              throw contextualError;
            } else {
              throw error;
            }
          }
        }
      }
      
      lineOffset += section.split('\n').length + (index < stackSections.length - 1 ? 1 : 0);
    });
    
    return goroutines;
  }
  
  private parseStackSection(
    lines: string[], 
    fileName: string, 
    startLineNumber: number,
    functionPrefixes: string[],
    filePrefixes: string[]
  ): Goroutine | null {
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
      const errorLine = startLineNumber;
      const errorMessage = `Failed to parse section starting at line ${startLineNumber}, error on line ${errorLine}. Expected goroutine header format: "goroutine <id> [<state>]:" but got: "${firstLine}"`;
      throw new Error(errorMessage);
    }
    
    // Parse stack trace into structured calls
    let calls: TraceCall[], createdBy: CreatedByInfo | null;
    try {
      const result = this.parseStackTrace(lines.slice(1), functionPrefixes, filePrefixes);
      calls = result.calls;
      createdBy = result.createdBy;
    } catch (stackError) {
      const message = stackError instanceof Error ? stackError.message : String(stackError);
      throw new Error(`Failed to parse section starting at line ${startLineNumber}, stack parsing error: ${message}`);
    }
    
    return {
      id: goroutineId,
      originalId: goroutineId,
      state,
      durationMinutes,
      calls,
      fileName,
      createdBy
    };
  }
  
  private parseStackTrace(
    lines: string[], 
    functionPrefixes: string[], 
    filePrefixes: string[]
  ): { calls: TraceCall[], createdBy: CreatedByInfo | null } {
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
          
          // Look for location on the next line
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
        const match = line.trim().match(/^(.+)(\(.*\))$/);
        if (match) {
          const functionName = match[1];
          const args = match[2];
          let file = 'unknown';
          let lineNum = 0;
          
          // Look for location on the next line
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
    const match = line.match(/^(?:\t|    )(.+):(\d+)(?:\s|$)/);
    if (match) {
      return {
        file: this.trimFilePathWithPrefixes(match[1], filePrefixes),
        line: parseInt(match[2])
      };
    }
    return null;
  }
  
  private trimFunctionNameWithPrefixes(functionName: string, prefixes: string[]): string {
    let trimmed = functionName;
    
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        trimmed = trimmed.slice(prefix.length);
        break;
      }
    }
    
    return trimmed;
  }
  
  private trimFilePathWithPrefixes(filePath: string, prefixes: string[]): string {
    let trimmed = filePath;
    
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        trimmed = trimmed.slice(prefix.length);
        break;
      }
    }
    
    return trimmed;
  }
}

// Initialize worker
const worker = new ParseWorker();
self.addEventListener('message', (e) => worker.onMessage(e));