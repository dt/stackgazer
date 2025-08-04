import { ParsedFile, Goroutine, FileMetadata, NameExtractor } from './types.js';
import { FileCollection } from './FileCollection.js';
import { SettingsManager } from './SettingsManager.js';

interface ParseRequest {
  id: string;
  file: File;
  resolve: (parsedFile: ParsedFile) => void;
  reject: (error: Error) => void;
}

interface ParseProgress {
  fileName: string;
  progress: number; // 0-100
  stage: 'reading' | 'parsing' | 'complete' | 'error';
  error?: string;
}

/**
 * Enhanced FileCollection that uses Web Workers for background parsing
 */
export class BackgroundFileCollection extends FileCollection {
  private parseWorker: Worker | null = null;
  private pendingRequests = new Map<string, ParseRequest>();
  private progressCallback: ((progress: ParseProgress) => void) | null = null;
  
  constructor(nameExtractors: NameExtractor[] = [], settingsManager?: SettingsManager) {
    super(nameExtractors, settingsManager);
    this.initializeWorker();
  }
  
  /**
   * Set callback for parsing progress updates
   */
  setProgressCallback(callback: (progress: ParseProgress) => void): void {
    this.progressCallback = callback;
  }
  
  /**
   * Add a file with background parsing
   */
  async addFile(file: File): Promise<ParsedFile> {
    if (!this.parseWorker) {
      // Fallback to synchronous parsing if worker fails
      const text = await file.text();
      return this.addFileSync(text, file.name);
    }
    
    return new Promise((resolve, reject) => {
      const id = this.generateRequestId();
      
      this.pendingRequests.set(id, {
        id,
        file,
        resolve,
        reject
      });
      
      this.processFileInWorker(id, file);
    });
  }
  
  /**
   * Add multiple files with background parsing and progress tracking
   */
  async addFiles(files: File[]): Promise<ParsedFile[]> {
    const results: ParsedFile[] = [];
    
    for (const file of files) {
      try {
        if (this.progressCallback) {
          this.progressCallback({
            fileName: file.name,
            progress: 0,
            stage: 'reading'
          });
        }
        
        const parsedFile = await this.addFile(file);
        results.push(parsedFile);
        
        if (this.progressCallback) {
          this.progressCallback({
            fileName: file.name,
            progress: 100,
            stage: 'complete'
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (this.progressCallback) {
          this.progressCallback({
            fileName: file.name,
            progress: 0,
            stage: 'error',
            error: errorMessage
          });
        }
        
        // Continue processing other files even if one fails
        console.error(`Failed to parse file ${file.name}:`, error);
      }
    }
    
    return results;
  }
  
  /**
   * Compute the derived name for a file without adding it to the collection
   * Used for sorting files before processing them
   */
  async computeDerivedFileNameFromFile(file: File): Promise<string> {
    try {
      const text = await this.readFileAsText(file);
      return super.computeDerivedFileName(text, file.name);
    } catch (error) {
      console.warn(`Failed to compute derived name for ${file.name}:`, error);
      return file.name;
    }
  }

  /**
   * Read file contents as text
   */
  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Cleanup worker resources
   */
  dispose(): void {
    if (this.parseWorker) {
      this.parseWorker.terminate();
      this.parseWorker = null;
    }
    
    // Reject any pending requests
    this.pendingRequests.forEach(request => {
      request.reject(new Error('Worker terminated'));
    });
    this.pendingRequests.clear();
  }
  
  private initializeWorker(): void {
    try {
      // Create worker from bundled script
      const workerScript = this.createWorkerScript();
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      this.parseWorker = new Worker(workerUrl);
      this.parseWorker.onmessage = (e) => this.handleWorkerMessage(e);
      this.parseWorker.onerror = (e) => this.handleWorkerError(e);
      
      // Clean up blob URL
      URL.revokeObjectURL(workerUrl);
    } catch (error) {
      console.warn('Failed to initialize parse worker, falling back to synchronous parsing:', error);
      this.parseWorker = null;
    }
  }
  
  private async processFileInWorker(id: string, file: File): Promise<void> {
    if (!this.parseWorker) {
      throw new Error('Worker not available');
    }
    
    try {
      // Read file content
      if (this.progressCallback) {
        this.progressCallback({
          fileName: file.name,
          progress: 10,
          stage: 'reading'
        });
      }
      
      const text = await file.text();
      
      if (this.progressCallback) {
        this.progressCallback({
          fileName: file.name,
          progress: 30,
          stage: 'parsing'
        });
      }
      
      // Get current settings for worker
      const settings = this.settingsManager ? {
        functionTrimPrefixes: this.settingsManager.getFunctionTrimPrefixes(),
        fileTrimPrefixes: this.settingsManager.getFileTrimPrefixes()
      } : {
        functionTrimPrefixes: [],
        fileTrimPrefixes: []
      };
      
      // Send to worker
      this.parseWorker.postMessage({
        type: 'PARSE_FILE',
        id,
        text,
        fileName: file.name,
        settings
      });
    } catch (error) {
      const request = this.pendingRequests.get(id);
      if (request) {
        this.pendingRequests.delete(id);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  
  private handleWorkerMessage(e: MessageEvent): void {
    const { type, id, goroutines, error, stats } = e.data;
    const request = this.pendingRequests.get(id);
    
    if (!request) {
      console.warn('Received worker message for unknown request:', id);
      return;
    }
    
    this.pendingRequests.delete(id);
    
    if (type === 'PARSE_COMPLETE' && goroutines) {
      try {
        if (this.progressCallback) {
          this.progressCallback({
            fileName: request.file.name,
            progress: 80,
            stage: 'parsing'
          });
        }
        
        // Process the parsed goroutines through the normal FileCollection flow
        const parsedFile = this.processWorkerResult(goroutines, request.file.name);
        
        if (stats) {
          console.log(`Parsed ${request.file.name}: ${stats.goroutineCount} goroutines in ${stats.parseTimeMs.toFixed(1)}ms`);
        }
        
        request.resolve(parsedFile);
      } catch (processError) {
        request.reject(processError instanceof Error ? processError : new Error(String(processError)));
      }
    } else if (type === 'PARSE_ERROR') {
      request.reject(new Error(error || 'Unknown parsing error'));
    }
  }
  
  private handleWorkerError(e: ErrorEvent): void {
    console.error('Parse worker error:', e);
    
    // Reject all pending requests
    this.pendingRequests.forEach(request => {
      request.reject(new Error(`Worker error: ${e.message}`));
    });
    this.pendingRequests.clear();
    
    // Reinitialize worker
    this.initializeWorker();
  }
  
  private processWorkerResult(goroutineData: any[], fileName: string): ParsedFile {
    // Convert plain objects from worker to proper Goroutine instances
    const goroutines: Goroutine[] = goroutineData;
    
    // Check for duplicates
    const duplicateFileName = this.isDuplicateFile(goroutines);
    if (duplicateFileName) {
      throw new Error(`Duplicate file content detected. This file appears to contain the same goroutines as the already loaded file "${duplicateFileName}".`);
    }
    
    // Try auto-naming
    const autoName = this.extractAutoFileName(goroutines);
    const proposedName = autoName || fileName;
    
    // Handle name conflicts
    const uniqueName = this.ensureUniqueName(proposedName);
    
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
      g.fileName = uniqueName;
    });
    
    // Create ParsedFile implementation
    const parsedFile = {
      name: uniqueName,
      originalName: fileName,
      goroutines,
      goroutineMap,
      metadata,
      setGoroutineIdPrefix: (newPrefix: string | null) => {
        // Update display IDs for all goroutines
        goroutines.forEach(goroutine => {
          if (newPrefix) {
            goroutine.id = `${newPrefix}.${goroutine.originalId}`;
            if (goroutine.createdBy) {
              const creatorOriginalId = goroutine.createdBy.creatorId.split('.').pop() || goroutine.createdBy.creatorId;
              goroutine.createdBy.creatorId = `${newPrefix}.${creatorOriginalId}`;
            }
          } else {
            goroutine.id = goroutine.originalId;
            if (goroutine.createdBy) {
              const creatorOriginalId = goroutine.createdBy.creatorId.split('.').pop() || goroutine.createdBy.creatorId;
              goroutine.createdBy.creatorId = creatorOriginalId;
            }
          }
        });
      }
    };
    
    this.files.set(uniqueName, parsedFile);
    
    // Handle goroutine ID prefixing logic
    this.updateFilePrefixes();
    
    return parsedFile;
  }
  
  private generateRequestId(): string {
    return `parse_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  
  private createWorkerScript(): string {
    // Return the parse worker code as a string for inline worker creation
    // This avoids issues with separate worker files and bundling
    return `
      // Inline worker script for stack trace parsing
      const worker = {
        onMessage: function(e) {
          const { type, id, text, fileName, settings } = e.data;
          
          if (type === 'PARSE_FILE') {
            this.parseFile(id, text, fileName, settings);
          }
        },
        
        parseFile: function(id, text, fileName, settings) {
          const startTime = performance.now();
          
          try {
            const goroutines = this.parseStackTracesForFile(text, fileName, settings);
            const endTime = performance.now();
            
            const result = {
              type: 'PARSE_COMPLETE',
              id,
              goroutines,
              stats: {
                goroutineCount: goroutines.length,
                parseTimeMs: endTime - startTime
              }
            };
            
            self.postMessage(result);
          } catch (error) {
            const result = {
              type: 'PARSE_ERROR',
              id,
              error: error instanceof Error ? error.message : String(error)
            };
            
            self.postMessage(result);
          }
        },
        
        parseStackTracesForFile: function(text, fileName, settings) {
          const goroutines = [];
          const stackSections = text.split(/\\n\\s*\\n/);
          let lineOffset = 0;
          
          stackSections.forEach((section, index) => {
            if (section.trim()) {
              const lines = section.trim().split('\\n');
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
                    const contextualError = new Error(message + ' (section ' + (index + 1) + ', starting at line ' + (lineOffset + 1) + ')');
                    throw contextualError;
                  } else {
                    throw error;
                  }
                }
              }
            }
            
            lineOffset += section.split('\\n').length + (index < stackSections.length - 1 ? 1 : 0);
          });
          
          return goroutines;
        },
        
        parseStackSection: function(lines, fileName, startLineNumber, functionPrefixes, filePrefixes) {
          if (lines.length === 0) return null;
          
          const firstLine = lines[0];
          const goroutineMatch = firstLine.match(/^goroutine\\s+(\\d+)\\s+\\[([^\\]]+)\\]:?/);
          
          let goroutineId, state, durationMinutes = 0;
          if (goroutineMatch) {
            goroutineId = goroutineMatch[1];
            const stateAndDuration = goroutineMatch[2];
            
            const durationMatch = stateAndDuration.match(/^(.+?),\\s*(\\d+)\\s+minutes?$/);
            if (durationMatch) {
              state = durationMatch[1].trim();
              durationMinutes = parseInt(durationMatch[2]);
            } else {
              state = stateAndDuration.trim();
            }
          } else {
            throw new Error('Failed to parse goroutine header: ' + firstLine);
          }
          
          const result = this.parseStackTrace(lines.slice(1), functionPrefixes, filePrefixes);
          
          return {
            id: goroutineId,
            originalId: goroutineId,
            state: state,
            durationMinutes: durationMinutes,
            calls: result.calls,
            fileName: fileName,
            createdBy: result.createdBy
          };
        },
        
        parseStackTrace: function(lines, functionPrefixes, filePrefixes) {
          const calls = [];
          let createdBy = null;
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line.trim()) continue;
            
            if (line.trim().startsWith('created by')) {
              const match = line.trim().match(/^created by (.+) in goroutine (\\d+)$/);
              if (match) {
                let file = 'unknown';
                let lineNum = 0;
                
                if (i + 1 < lines.length) {
                  const nextLine = lines[i + 1];
                  if (nextLine.startsWith('\\t') || nextLine.startsWith('    ')) {
                    const locationMatch = this.parseFileLine(nextLine, filePrefixes);
                    if (locationMatch) {
                      file = locationMatch.file;
                      lineNum = locationMatch.line;
                      i++;
                    }
                  }
                }
                
                createdBy = {
                  function: this.trimFunctionNameWithPrefixes(match[1], functionPrefixes),
                  creatorId: match[2],
                  file: file,
                  line: lineNum,
                  creatorExists: false
                };
              }
              continue;
            }
            
            if (!line.startsWith(' ')) {
              const match = line.trim().match(/^(.+)(\\(.*\\))$/);
              if (match) {
                const functionName = match[1];
                const args = match[2];
                let file = 'unknown';
                let lineNum = 0;
                
                if (i + 1 < lines.length) {
                  const nextLine = lines[i + 1];
                  if (nextLine.startsWith('\\t') || nextLine.startsWith('    ')) {
                    const locationMatch = this.parseFileLine(nextLine, filePrefixes);
                    if (locationMatch) {
                      file = locationMatch.file;
                      lineNum = locationMatch.line;
                      i++;
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
          
          return { calls: calls, createdBy: createdBy };
        },
        
        parseFileLine: function(line, filePrefixes) {
          const match = line.match(/^(?:\\t|    )(.+):(\\d+)(?:\\s|$)/);
          if (match) {
            return {
              file: this.trimFilePathWithPrefixes(match[1], filePrefixes),
              line: parseInt(match[2])
            };
          }
          return null;
        },
        
        trimFunctionNameWithPrefixes: function(functionName, prefixes) {
          let trimmed = functionName;
          
          for (const prefix of prefixes) {
            if (trimmed.startsWith(prefix)) {
              trimmed = trimmed.slice(prefix.length);
              break;
            }
          }
          
          return trimmed;
        },
        
        trimFilePathWithPrefixes: function(filePath, prefixes) {
          let trimmed = filePath;
          
          for (const prefix of prefixes) {
            if (trimmed.startsWith(prefix)) {
              trimmed = trimmed.slice(prefix.length);
              break;
            }
          }
          
          return trimmed;
        }
      };
      
      self.addEventListener('message', (e) => worker.onMessage(e));
    `;
  }
}