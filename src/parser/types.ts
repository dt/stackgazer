/**
 * Types for the parser module
 */

export interface Frame {
  func: string;
  file: string;
  line: number;
}

export interface Goroutine {
  id: string;
  state: string;
  waitMinutes: number;
  creator: string;
  creatorExists: boolean;
  created: string[];
}

export interface Group {
  traceId: string; // Hash of the stack trace for grouping
  count: number; // Number of goroutines in this group
  labels: string[]; // Labels like "cluster=main" (Format 1 only)
  goroutines: Goroutine[]; // Individual goroutines (Format 2 only, empty for Format 1)
  trace: Frame[]; // Stack trace frames (common to both)
}

export interface ParsedFile {
  originalName: string;
  extractedName?: string; // Auto-extracted name during parsing (e.g., node ID)
  totalGoroutines?: number; // Total count if available (Format 1)
  groups: Group[]; // All stack groups
}

// Result type that can represent success or failure
export type Result = { success: true; data: ParsedFile } | { success: false; error: string };

// Zip extraction types
export interface ZipFile {
  path: string;
  content: Blob;
}

export interface ExtractResult {
  files: ZipFile[];
  totalSize: number;
}
