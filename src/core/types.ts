/**
 * Core type definitions for the Go Stack Trace Viewer
 */

export interface Goroutine {
  fileName: string        // File this came from (also used as file identifier; empty if only one file is active)
  id: string              // Unique globally (file-prefixed if multiple files)
  originalId: string     // Original numeric ID from stack trace
  state: string           // e.g., "running", "select", "chan receive"
  durationMinutes: number // How long in current state
  calls: TraceCall[]      // Stack trace as structured function calls
  createdBy: CreatedByInfo | null // Creator information, null if goroutine has no creator
}

export interface TraceCall {
  function: string        // Full package-qualified function name (e.g., "main.serveHTTP")
  args: string           // Function arguments (e.g., "(0xc000123456, 0x1234567)")
  file: string           // File path (e.g., "/app/main.go")
  line: number           // Line number (e.g., 42)
}

export interface CreatedByInfo {
  function: string        // Creating function name
  creatorId: string      // Creator goroutine ID (unique, potentially file-prefixed)
  file: string           // File path where creation occurred
  line: number           // Line number where creation occurred
  creatorExists: boolean // Whether creator is in current data set
}

export interface ParsedFile {
  name: string           // File name (used as identifier, may be auto-extracted)
  originalName: string   // Original filename from upload
  goroutines: Goroutine[]
  goroutineMap: Map<string, Goroutine>  // Map of goroutineId to Goroutine for O(1) lookup
  metadata: FileMetadata
  
  // Method to set ID prefix for all goroutines in this file
  setGoroutineIdPrefix(newPrefix: string | null): void;
}

export interface FileMetadata {
  nodeId?: number        // Auto-extracted node ID if available
  totalGoroutines: number
  parseTime: Date
}

export interface UniqueStack {
  id: string             // Stack fingerprint
  title: string          // Representative function name (first non-GOROOT function)
  calls: TraceCall[]     // The actual stack trace calls
  goroutines: Goroutine[] // All goroutines with this stack
  createdBy: CreatedByInfo | null // Creator information from representative goroutine
  
  // Method to get searchable content for text filtering
  getSearchableContent(): string;
}

export interface FilterQuery {
  rawQuery: string       // Original filter string
  terms: FilterTerm[]    // Parsed terms
  valid: boolean         // Whether query parsed successfully
  error?: string         // Parse error if invalid
}

export interface FilterTerm {
  field?: string         // "state", "dur", or undefined for text search
  value: string          // The search value
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'
  negated: boolean       // Whether prefixed with -
}

export interface NavigationEntry {
  id: string  // Unique goroutine ID (potentially file-prefixed)
  fromId?: string  // The goroutine ID we navigated from (for back navigation)
  timestamp: number
}

export interface FileParsingSummary {
  totalGoroutines: number
  uniqueStacks: number
  parseTimeMs: number
  memoryUsageMB?: number
}

export interface NameExtractor {
  name: string
  extract(goroutines: Goroutine[]): string | null
}

export interface PerformanceIndexes {
  byId: Map<string, Goroutine>           // O(1) goroutine lookup
  byState: Map<string, Goroutine[]>      // O(1) state filtering
  byFile: Map<string, Goroutine[]>       // O(1) file filtering  
  byCreator: Map<string, Goroutine[]>    // O(1) creator/created navigation
  byStackId: Map<string, Goroutine[]>    // O(1) unique stack grouping
}

export type StackDisplayMode = 'combined' | 'side-by-side' | 'functions' | 'locations';

export interface AppSettings {
  // Parsing options
  functionTrimPrefixes: string;
  fileTrimPrefixes: string;
  titleManipulationRules: string;
  
  // Display options
  maxInitialGoroutines: number;
  autoExpandStacks: boolean;
  
  // Zip file handling
  zipFilePattern: string;
}