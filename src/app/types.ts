/**
 * Core type definitions for the Go Stack Trace Viewer App
 */

// Core Data Model Types

export interface Counts {
  total: number;
  matches: number;
  priorMatches: number;
  filterMatches: number;
}

export interface Filter {
  filterString: string;
  forcedGoroutine?: string;
}

export interface Goroutine {
  id: string;
  creator: string;
  creatorExists: boolean;
  created: string[];
  waitMinutes: number;
  matches: boolean;
  pinned: boolean;
}

export interface Group {
  id: string; // globally unique group ID
  labels: string[]; // "k1=v1", "k2=v2", ...
  goroutines: Goroutine[];
  pinned: boolean;

  counts: Counts;
}

export interface FileSection {
  id: string; // unique ID for this file section
  fileId: string; // ID of the file this section belongs to
  fileName: string;
  groups: Group[];
  pinned: boolean;

  counts: Counts;
}

export interface Frame {
  func: string;
  file: string;
  line: number;
}
export interface UniqueStack {
  id: string;
  name: string;
  trace: Frame[];

  files: FileSection[];
  searchableText: string;
  pinned: boolean;

  counts: Counts;
}

export interface File {
  name: string;
  stacks: UniqueStack[];
}

// Filtering change tracking
export interface FilterChanges {
  changedStacks: Set<string>; // Stack IDs that had visibility changes
  changedGroups: Array<{
    groupId: string;
    visible: boolean;
  }>;
}

// Settings and metadata types
export interface NameExtractionPattern {
  regex: string; // Regex pattern as string for JSON serialization
  replacement: string; // Template for replacement, e.g. "n$1" where $1 is first capture group
  description: string; // Human-readable description
}

export interface AppSettings {
  functionPrefixesToTrim: string[];
  filePrefixesToTrim: string[];
  titleManipulationRules: string[];
  zipFilePattern: string;
  nameExtractionPatterns: NameExtractionPattern[];
}

// Re-export AppState types
export { AppState, NavigationStateChanges, ExpansionStateChanges } from './AppState.js';
