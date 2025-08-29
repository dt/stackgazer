/**
 * Core type definitions for the Go Stack Trace Viewer App
 */

// Core Data Model Types

export interface Counts {
  total: number;
  matches: number;
  priorMatches: number;
  filterMatches: number;
  minWait: number;
  maxWait: number;
  minMatchingWait: number;
  maxMatchingWait: number;
  states: Map<string, number>; // state -> count
  matchingStates: Map<string, number>; // state -> count
}

export interface Filter {
  filterString: string;
  forcedGoroutine?: string;
  minWait?: number;
  maxWait?: number;
  states?: Set<string>;
}

export interface Goroutine {
  id: string;
  creator: string;
  creatorExists: boolean;
  created: string[];
  state: string;
  waitMinutes: number;
  matches: boolean;
  pinned: boolean;
  stack: UniqueStack;
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
export interface Category {
  id: string;
  name: string;
  stacks: UniqueStack[];
  pinned: boolean;
  counts: Counts;
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
  categoryIgnoredPrefixes: string[];
}

// State sorting utility
const STATE_SORT_ORDER = [
  'running',
  'runnable', 
  'syscall',
  'IO wait',
  'semacquire',
  'select',
  'chan receive',
  'chan send',
  'wait'
];

/**
 * Get the sort priority for a goroutine state.
 * Returns a number for defined states (lower = higher priority) or Infinity for unknown states.
 */
export function getStateSortPriority(state: string): number {
  const index = STATE_SORT_ORDER.indexOf(state);
  return index === -1 ? Infinity : index;
}

/**
 * Sort function for goroutine states according to the defined priority order.
 * Unknown states are sorted alphabetically after known states.
 */
export function sortStates(states: string[]): string[] {
  return states.sort((a, b) => {
    const priorityA = getStateSortPriority(a);
    const priorityB = getStateSortPriority(b);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Both have same priority (likely both unknown), sort alphabetically
    return a.localeCompare(b);
  });
}

/**
 * Sort state entries (state, count pairs) according to the defined priority order.
 */
export function sortStateEntries<T>(entries: [string, T][]): [string, T][] {
  return entries.sort(([stateA], [stateB]) => {
    const priorityA = getStateSortPriority(stateA);
    const priorityB = getStateSortPriority(stateB);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Both have same priority (likely both unknown), sort alphabetically
    return stateA.localeCompare(stateB);
  });
}

// Re-export AppState types
export { AppState, NavigationStateChanges, ExpansionStateChanges } from './AppState.js';
