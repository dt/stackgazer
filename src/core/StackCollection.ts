import { FileCollection } from './FileCollection.js';
import { Goroutine, UniqueStack, FilterQuery, FilterTerm, TraceCall, CreatedByInfo } from './types.js';

/**
 * Determine if a function name represents a Go standard library function
 * A function is considered stdlib if it does not have a dot prior to the first slash
 */
export function isStdLib(functionName: string): boolean {
  const firstSlash = functionName.indexOf('/');
  if (firstSlash === -1) {
    // No slash means it's likely a top-level package like "main", "fmt" or "runtime"
    // the only non-stdlib top level package is "main".
    return !functionName.startsWith('main');
  }
  
  // Check if there's a dot before the first slash
  const beforeSlash = functionName.substring(0, firstSlash);
  return !beforeSlash.includes('.');
}

/**
 * Title manipulation rule types
 */
export interface TitleRule {
  type: 'skip' | 'fold' | 'trim' | 'foldstdlib';
  pattern?: string;      // For skip, fold, and foldstdlib
  prefix?: string;       // For fold, trim, and foldstdlib
  replacement?: string;  // For foldstdlib
}

/**
 * Parses title manipulation rules and applies them to generate stack titles
 */
export class TitleManipulator {
  private rules: TitleRule[] = [];

  constructor(rules: string[] = []) {
    this.setRules(rules);
  }

  setRules(ruleStrings: string[]): void {
    this.rules = [];
    for (const ruleString of ruleStrings) {
      const rule = this.parseRule(ruleString);
      if (rule) {
        this.rules.push(rule);
      }
    }
  }

  private parseRule(ruleString: string): TitleRule | null {
    const trimmed = ruleString.trim();
    
    if (trimmed.startsWith('skip:')) {
      const pattern = trimmed.slice(5);
      return { type: 'skip', pattern };
    }
    
    if (trimmed.startsWith('fold:')) {
      const afterColon = trimmed.slice(5);
      const arrowIndex = afterColon.indexOf('->');
      if (arrowIndex !== -1) {
        const pattern = afterColon.slice(0, arrowIndex);
        const prefix = afterColon.slice(arrowIndex + 2);
        return { type: 'fold', pattern, prefix };
      }
    }
    
    if (trimmed.startsWith('foldstdlib:')) {
      const afterColon = trimmed.slice(11);
      const arrowIndex = afterColon.indexOf('->');
      if (arrowIndex !== -1) {
        const pattern = afterColon.slice(0, arrowIndex);
        const replacement = afterColon.slice(arrowIndex + 2);
        return { type: 'foldstdlib', pattern, replacement };
      }
    }
    
    if (trimmed.startsWith('trim:')) {
      const prefix = trimmed.slice(5);
      return { type: 'trim', prefix };
    }
    
    return null;
  }

  generateTitle(calls: TraceCall[]): string {
    let currentPrefix = '';
    let skipStdlib = false;
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      let functionName = call.function;
      let shouldSkip = false;
      
      // Check if we should skip stdlib functions
      if (skipStdlib && isStdLib(functionName)) {
        continue;
      }
      
      // Apply rules in order
      for (const rule of this.rules) {
        if (rule.type === 'skip' && rule.pattern && functionName.startsWith(rule.pattern)) {
          shouldSkip = true;
          break;
        }
        
        if (rule.type === 'fold' && rule.pattern && functionName.startsWith(rule.pattern)) {
          if (rule.prefix) {
            currentPrefix += rule.prefix + ' ';
          }
          shouldSkip = true;
          break;
        }
        
        if (rule.type === 'foldstdlib' && rule.pattern && functionName.startsWith(rule.pattern)) {
          if (rule.replacement) {
            currentPrefix += rule.replacement + ' ';
          }
          skipStdlib = true; // Enable stdlib skipping for subsequent calls
          shouldSkip = true;
          break;
        }
        
        if (rule.type === 'trim' && rule.prefix && functionName.startsWith(rule.prefix)) {
          functionName = functionName.slice(rule.prefix.length);
        }
      }
      
      if (!shouldSkip) {
        return currentPrefix + functionName;
      }
    }
    
    // If all functions were skipped, return the last one (with any accumulated prefix)
    if (calls.length > 0) {
      let lastFunction = calls[calls.length - 1].function;
      // Apply trim rules to the last function
      for (const rule of this.rules) {
        if (rule.type === 'trim' && rule.prefix && lastFunction.startsWith(rule.prefix)) {
          lastFunction = lastFunction.slice(rule.prefix.length);
        }
      }
      return currentPrefix + lastFunction;
    }
    
    return 'Unknown';
  }
}

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

/**
 * Concrete implementation of UniqueStack with searchable content
 */
class UniqueStackImpl implements UniqueStack {
  id: string;
  title: string;
  calls: TraceCall[];
  goroutines: Goroutine[];
  createdBy: CreatedByInfo | null;
  
  constructor(data: Omit<UniqueStack, 'getSearchableContent'>) {
    this.id = data.id;
    this.title = data.title;
    this.calls = data.calls;
    this.goroutines = data.goroutines;
    this.createdBy = data.createdBy;
  }
  
  getSearchableContent(): string {
    // Searchable content is just the stack ID (fingerprint)
    // Since created-by info is now part of the fingerprint, no need to add it separately
    return this.id;
  }
}

/**
 * Manages unique stacks and filtering with proper goroutine-level filtering
 */
export class StackCollection {
  private fileCollection: FileCollection;
  private uniqueStacksCache = new Map<string, UniqueStack>();
  private cacheValid = false;
  private pinnedStacks = new Set<string>();
  private pinnedGoroutines = new Set<string>();
  private temporaryVisible = new Set<string>();
  private hiddenFiles = new Set<string>();
  private currentFilter: FilterQuery | null = null;
  private filterParser = new FilterParser();
  private cachedVisibleGoroutines: Goroutine[] | null = null;
  private createdGoroutinesCache = new Map<string, Goroutine[]>();
  private createdGoroutinesCacheValid = false;
  private titleManipulator = new TitleManipulator();
  private temporaryStateFilter: { state: string; mode: 'only' | 'exclude' } | null = null;

  constructor(fileCollection: FileCollection) {
    this.fileCollection = fileCollection;
  }

  /**
   * Set title manipulation rules
   */
  setTitleRules(rules: string[]): void {
    this.titleManipulator.setRules(rules);
    this.invalidateCaches();
  }
  
  /**
   * Get stack fingerprint for a goroutine
   */
  getStackFingerprint(goroutine: Goroutine): string {
    return stackFingerprint(goroutine);
  }

  /**
   * Get all goroutines from visible files (filters out hidden files)
   */
  getAllGoroutines(): Goroutine[] {
    const allGoroutines = this.fileCollection.getAllGoroutines();
    return allGoroutines.filter(goroutine => !this.hiddenFiles.has(goroutine.fileName));
  }

  /**
   * Get visible goroutines after applying all filters
   * CRITICAL: This applies filters at the individual goroutine level
   */
  getVisibleGoroutines(): Goroutine[] {
    if (this.cachedVisibleGoroutines) {
      return this.cachedVisibleGoroutines;
    }

    const allGoroutines = this.getAllGoroutines();
    
    // Apply temporary state filter first
    let goroutinesToFilter = allGoroutines;
    if (this.temporaryStateFilter) {
      if (this.temporaryStateFilter.mode === 'only') {
        goroutinesToFilter = allGoroutines.filter(g => g.state === this.temporaryStateFilter!.state);
      } else if (this.temporaryStateFilter.mode === 'exclude') {
        goroutinesToFilter = allGoroutines.filter(g => g.state !== this.temporaryStateFilter!.state);
      }
    }
    
    // If no regular filters, return state-filtered goroutines
    if (!this.currentFilter || !this.hasActiveTerms(this.currentFilter)) {
      this.cachedVisibleGoroutines = goroutinesToFilter;
      return goroutinesToFilter;
    }

    // Ensure unique stacks cache is built for text search lookups
    this.ensureUniqueStacksCache();

    // Apply regular filters at goroutine level (this fixes the main bug)
    const filtered = goroutinesToFilter.filter(goroutine => {
      // Check if goroutine matches current filter
      const matchesFilter = this.filterParser.matchesGoroutine(goroutine, this.currentFilter!, this.uniqueStacksCache);
      
      // Always show pinned or temporarily visible goroutines
      const isPinnedStack = this.pinnedStacks.has(stackFingerprint(goroutine));
      const isPinnedGoroutine = this.pinnedGoroutines.has(goroutine.id);
      const isTemporarilyVisible = this.temporaryVisible.has(goroutine.id);
      
      return matchesFilter || isPinnedStack || isPinnedGoroutine || isTemporarilyVisible;
    });

    this.cachedVisibleGoroutines = filtered;
    return filtered;
  }

  /**
   * Get unique stacks grouped by stack similarity
   */
  getUniqueStacks(): UniqueStack[] {
    this.ensureUniqueStacksCache();
    const stacks = Array.from(this.uniqueStacksCache.values());
    // Sort by title alphabetically, then by number of goroutines (largest first) for stable ordering
    return stacks.sort((a, b) => {
      const titleDiff = a.title.localeCompare(b.title);
      if (titleDiff !== 0) return titleDiff;
      return b.goroutines.length - a.goroutines.length;
    });
  }

  /**
   * Get filtered unique stacks where each unique stack only shows visible goroutines
   * This is the corrected approach - filter goroutines first, then group
   */
  getFilteredUniqueStacks(): UniqueStack[] {
    const visibleGoroutines = this.getVisibleGoroutines();
    const filteredStacks = this.buildFilteredUniqueStacks(visibleGoroutines);
    
    // Only return stacks that have at least one visible goroutine
    return filteredStacks.filter(stack => stack.goroutines.length > 0);
  }

  /**
   * Get visible goroutine counts per file
   */
  getVisibleGoroutineCountsByFile(): Map<string, { visible: number; total: number }> {
    const visibleGoroutines = this.getVisibleGoroutines();
    const allGoroutines = this.getAllGoroutines();
    const counts = new Map<string, { visible: number; total: number }>();
    
    // Initialize counts for all files
    const files = this.fileCollection.getFiles();
    files.forEach((file, fileName) => {
      counts.set(fileName, { visible: 0, total: file.goroutines.length });
    });
    
    // Count visible goroutines per file
    visibleGoroutines.forEach(goroutine => {
      const fileName = goroutine.fileName;
      const current = counts.get(fileName);
      if (current) {
        current.visible++;
      }
    });
    
    return counts;
  }

  /**
   * Set filter query and invalidate caches
   */
  setFilter(query: string): FilterQuery {
    const parsed = this.filterParser.parse(query);
    this.currentFilter = parsed;
    this.invalidateCaches();
    return parsed;
  }

  /**
   * Clear current filter
   */
  clearFilter(): void {
    this.currentFilter = null;
    this.invalidateCaches();
  }

  /**
   * Parse filter without applying it
   */
  parseFilter(query: string): FilterQuery {
    return this.filterParser.parse(query);
  }

  /**
   * Find goroutine by ID
   */
  findGoroutineById(id: string): Goroutine | null {
    const allGoroutines = this.getAllGoroutines();
    return allGoroutines.find(g => g.id === id || g.originalId === id) || null;
  }

  /**
   * Find goroutines created by a specific creator (cached for performance)
   */
  findCreatedGoroutines(creatorId: string): Goroutine[] {
    this.ensureCreatedGoroutinesCache();
    return this.createdGoroutinesCache.get(creatorId) || [];
  }

  /**
   * Make a goroutine temporarily visible (for navigation)
   */
  makeTemporarilyVisible(goroutineId: string): void {
    this.temporaryVisible.add(goroutineId);
    this.invalidateCaches();
  }

  /**
   * Clear temporary visibility
   */
  clearTemporaryVisibility(): void {
    this.temporaryVisible.clear();
    this.invalidateCaches();
  }

  /**
   * Pin/unpin a unique stack by fingerprint
   */
  toggleStackPin(stackFingerprint: string): void {
    if (this.pinnedStacks.has(stackFingerprint)) {
      this.pinnedStacks.delete(stackFingerprint);
    } else {
      this.pinnedStacks.add(stackFingerprint);
    }
    this.invalidateCaches();
  }

  /**
   * Pin/unpin an individual goroutine
   */
  toggleGoroutinePin(goroutineId: string): void {
    if (this.pinnedGoroutines.has(goroutineId)) {
      this.pinnedGoroutines.delete(goroutineId);
    } else {
      this.pinnedGoroutines.add(goroutineId);
    }
    this.invalidateCaches();
  }

  /**
   * Get pinned stacks
   */
  getPinnedStacks(): Set<string> {
    return new Set(this.pinnedStacks);
  }

  /**
   * Get pinned goroutines
   */
  getPinnedGoroutines(): Set<string> {
    return new Set(this.pinnedGoroutines);
  }

  /**
   * Toggle file visibility
   */
  toggleFileVisibility(fileName: string): void {
    if (this.hiddenFiles.has(fileName)) {
      this.hiddenFiles.delete(fileName);
    } else {
      this.hiddenFiles.add(fileName);
    }
    this.invalidateCaches();
  }

  /**
   * Get hidden files
   */
  getHiddenFiles(): Set<string> {
    return new Set(this.hiddenFiles);
  }

  /**
   * Set temporary state filter for quick state-only filtering
   */
  setTemporaryStateFilter(state: string, mode: 'only' | 'exclude'): void {
    this.temporaryStateFilter = { state, mode };
    this.invalidateCaches();
  }

  /**
   * Clear temporary state filter
   */
  clearTemporaryStateFilter(): void {
    this.temporaryStateFilter = null;
    this.invalidateCaches();
  }

  /**
   * Get current temporary state filter
   */
  getTemporaryStateFilter(): { state: string; mode: 'only' | 'exclude' } | null {
    return this.temporaryStateFilter ? { ...this.temporaryStateFilter } : null;
  }

  private hasActiveTerms(filterQuery: FilterQuery): boolean {
    return filterQuery.terms.some(term => term.value.trim().length > 0);
  }

  private ensureUniqueStacksCache(): void {
    if (!this.cacheValid) {
      this.rebuildUniqueStacksCache();
      this.cacheValid = true;
    }
  }

  private rebuildUniqueStacksCache(): void {
    this.uniqueStacksCache.clear();
    const allGoroutines = this.getAllGoroutines();
    
    // Group goroutines by stack fingerprint
    const stackMap = new Map<string, Goroutine[]>();
    
    for (const goroutine of allGoroutines) {
      const fingerprint = stackFingerprint(goroutine);
      if (!stackMap.has(fingerprint)) {
        stackMap.set(fingerprint, []);
      }
      stackMap.get(fingerprint)!.push(goroutine);
    }
    
    // Create UniqueStack objects
    for (const [fingerprint, goroutines] of stackMap.entries()) {
      if (goroutines.length > 0) {
        const representative = goroutines[0];
        
        // Generate title using manipulation rules
        const title = this.titleManipulator.generateTitle(representative.calls);
        
        this.uniqueStacksCache.set(fingerprint, new UniqueStackImpl({
          id: fingerprint,
          title,
          calls: representative.calls,
          goroutines,
          createdBy: representative.createdBy
        }));
      }
    }
  }

  private buildFilteredUniqueStacks(goroutines: Goroutine[]): UniqueStack[] {
    // Similar to rebuildUniqueStacksCache but for filtered goroutines
    const stackMap = new Map<string, Goroutine[]>();
    
    for (const goroutine of goroutines) {
      const fingerprint = stackFingerprint(goroutine);
      if (!stackMap.has(fingerprint)) {
        stackMap.set(fingerprint, []);
      }
      stackMap.get(fingerprint)!.push(goroutine);
    }
    
    const filteredStacks: UniqueStack[] = [];
    for (const [fingerprint, stackGoroutines] of stackMap.entries()) {
      if (stackGoroutines.length > 0) {
        const representative = stackGoroutines[0];
        
        // Generate title using manipulation rules
        const title = this.titleManipulator.generateTitle(representative.calls);
        
        filteredStacks.push(new UniqueStackImpl({
          id: fingerprint,
          title,
          calls: representative.calls,
          goroutines: stackGoroutines,
          createdBy: representative.createdBy
        }));
      }
    }
    
    // Sort by title alphabetically, then by number of goroutines (largest first) for stable ordering
    return filteredStacks.sort((a, b) => {
      const titleDiff = a.title.localeCompare(b.title);
      if (titleDiff !== 0) return titleDiff;
      return b.goroutines.length - a.goroutines.length;
    });
  }

  /**
   * Invalidate caches when underlying data changes (e.g., files added/removed)
   */
  invalidateDataCaches(): void {
    this.invalidateCaches();
  }

  private invalidateCaches(): void {
    this.cachedVisibleGoroutines = null;
    this.cacheValid = false;
    this.createdGoroutinesCacheValid = false;
  }

  private ensureCreatedGoroutinesCache(): void {
    if (!this.createdGoroutinesCacheValid) {
      this.rebuildCreatedGoroutinesCache();
      this.createdGoroutinesCacheValid = true;
    }
  }

  private rebuildCreatedGoroutinesCache(): void {
    this.createdGoroutinesCache.clear();
    const allGoroutines = this.getAllGoroutines();
    
    // Build a map of creator ID -> list of created goroutines
    for (const goroutine of allGoroutines) {
      if (goroutine.createdBy) {
        const creatorId = goroutine.createdBy.creatorId;
        if (!this.createdGoroutinesCache.has(creatorId)) {
          this.createdGoroutinesCache.set(creatorId, []);
        }
        this.createdGoroutinesCache.get(creatorId)!.push(goroutine);
      }
    }
  }

}

/**
 * Parses filter queries with simplified syntax:
 * - state:run (partial match)
 * - dur:>5 (duration comparison)
 * - -state:select (negation)
 * - unqualified terms search goroutine ID and stack content
 */
export class FilterParser {
  parse(query: string): FilterQuery {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        rawQuery: query,
        terms: [],
        valid: true
      };
    }

    const terms: FilterTerm[] = [];
    
    try {
      const tokens = this.tokenize(trimmedQuery);
      
      for (const token of tokens) {
        if (token.includes(':')) {
          // Field filter
          terms.push(this.parseFieldTerm(token));
        } else {
          // Text search term
          terms.push(this.parseTextTerm(token));
        }
      }
      
      return {
        rawQuery: query,
        terms,
        valid: true
      };
    } catch (error) {
      return {
        rawQuery: query,
        terms: [],
        valid: false,
        error: error instanceof Error ? error.message : 'Parse error'
      };
    }
  }

  matchesGoroutine(goroutine: Goroutine, query: FilterQuery, uniqueStacksCache?: Map<string, UniqueStack>): boolean {
    if (!query.valid || query.terms.length === 0) {
      return true;
    }

    // AND logic: all terms must match
    return query.terms.every(term => this.matchesTerm(goroutine, term, uniqueStacksCache));
  }

  private tokenize(query: string): string[] {
    // Simple space-based tokenization
    // TODO: Handle quoted strings if needed
    return query.split(/\s+/).filter(token => token.length > 0);
  }

  private parseFieldTerm(token: string): FilterTerm {
    const negated = token.startsWith('-');
    const cleanToken = negated ? token.slice(1) : token;
    
    const colonIndex = cleanToken.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid field term: ${token}`);
    }
    
    const field = cleanToken.slice(0, colonIndex);
    const valueStr = cleanToken.slice(colonIndex + 1);
    
    if (!field || !valueStr) {
      throw new Error(`Invalid field term: ${token}`);
    }
    
    const { operator, value } = this.parseValue(valueStr);
    
    return {
      field,
      value,
      operator,
      negated
    };
  }

  private parseTextTerm(token: string): FilterTerm {
    const negated = token.startsWith('-');
    const value = negated ? token.slice(1) : token;
    
    if (!value) {
      throw new Error(`Empty search term: ${token}`);
    }
    
    return {
      field: undefined, // Search in goroutine ID and stack content
      value,
      operator: 'contains',
      negated
    };
  }

  private parseValue(valueStr: string): { operator: FilterTerm['operator'], value: string } {
    // Handle numeric comparisons for duration
    if (valueStr.startsWith('>=')) {
      return { operator: 'gte', value: valueStr.slice(2) };
    } else if (valueStr.startsWith('<=')) {
      return { operator: 'lte', value: valueStr.slice(2) };
    } else if (valueStr.startsWith('>')) {
      return { operator: 'gt', value: valueStr.slice(1) };
    } else if (valueStr.startsWith('<')) {
      return { operator: 'lt', value: valueStr.slice(1) };
    } else {
      // Default to contains for text fields
      return { operator: 'contains', value: valueStr };
    }
  }

  private matchesTerm(goroutine: Goroutine, term: FilterTerm, uniqueStacksCache?: Map<string, UniqueStack>): boolean {
    let matches = false;
    
    switch (term.field) {
      case 'state':
        matches = goroutine.state.toLowerCase().includes(term.value.toLowerCase());
        break;
        
      case 'dur':
        matches = this.compareNumeric(goroutine.durationMinutes, term.operator, term.value);
        break;
        
      case undefined:
        // Search in goroutine ID and unique stack content
        const searchValue = term.value.toLowerCase();
        
        // Check goroutine ID first
        matches = goroutine.originalId.toLowerCase().includes(searchValue);
        
        // If not found in ID, check the unique stack's searchable content
        if (!matches && uniqueStacksCache) {
          const uniqueStack = uniqueStacksCache.get(stackFingerprint(goroutine));
          if (uniqueStack) {
            matches = uniqueStack.getSearchableContent().toLowerCase().includes(searchValue);
          }
        }
        break;
        
      default:
        // Unknown field, no match
        matches = false;
    }
    
    return term.negated ? !matches : matches;
  }

  private compareNumeric(actualValue: number, operator: FilterTerm['operator'], expectedValue: string): boolean {
    const numericExpected = parseFloat(expectedValue);
    if (isNaN(numericExpected)) {
      return false;
    }
    
    switch (operator) {
      case 'gt': return actualValue > numericExpected;
      case 'gte': return actualValue >= numericExpected;
      case 'lt': return actualValue < numericExpected;
      case 'lte': return actualValue <= numericExpected;
      case 'equals': return actualValue === numericExpected;
      case 'contains': return actualValue.toString().includes(expectedValue);
      default: return false;
    }
  }
}