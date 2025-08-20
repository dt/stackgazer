/**
 * Core collection class for managing multiple stack trace files with merged unique stacks
 *
 * Filter Evaluation Logic:
 *
 * How filter matching determines visibility:
 *
 * 1. **Unique Stack Level** (functions, files, locations)
 *    - If filter matches stack trace content → stack is a candidate for visibility
 *    - Stack is visible if ANY of its file sections have visible goroutines
 *
 * 2. **File Level** (within each stack)
 *    - File section is visible if ANY of its groups have visible goroutines
 *    - File sections group goroutines by their source file
 *
 * 3. **Group Level** (labels like state=select)
 *    - If filter matches group labels → group is a candidate for visibility
 *    - Group is visible if it has ANY visible goroutines
 *
 * 4. **Goroutine Level** (specific IDs, states)
 *    - If filter matches goroutine ID or state → goroutine is visible
 *    - Goroutine visibility is: `(stack_match OR group_match OR goroutine_match)`
 *
 * Visibility and Counting:
 * - **Visible**: Boolean flag set on each stack/file/group/goroutine
 * - **Count**: Number of visible goroutines under each container
 */

import { File as ParserFile, Frame as ParserFrame } from '../parser/types.js';
import { UniqueStack, Frame, Group, NameExtractionPattern, Filter, Goroutine, Category } from './types.js';

/**
 * Determine if a function name represents a Go standard library function
 */
function isStdLib(functionName: string): boolean {
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

interface TitleRule {
  type: 'skip' | 'fold' | 'foldstdlib' | 'trim';
  pattern?: string;
  prefix?: string;
  replacement?: string;
}

/**
 * Parses title manipulation rules and applies them to generate stack names
 */
class StackNamer {
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

  generateTitle(trace: Frame[]): string {
    let currentPrefix = '';
    let skipStdlib = false;

    for (let i = 0; i < trace.length; i++) {
      const frame = trace[i];
      let functionName = frame.func;
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
    if (trace.length > 0) {
      let lastFunction = trace[trace.length - 1].func;
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

export interface ProfileCollectionSettings {
  functionPrefixesToTrim: RegExp[];
  filePrefixesToTrim: RegExp[];
  titleManipulationRules: string[];
  nameExtractionPatterns: NameExtractionPattern[];
  zipFilePattern: string;
  categoryIgnoredPrefixes: string[];
}

export class ProfileCollection {
  private categories: Category[] = [];
  private stackForTraceId: Map<string, { category: Category; stack: UniqueStack }> = new Map();
  private parsedFiles = new Map<string, ParserFile>();
  private settings: ProfileCollectionSettings;
  private stackNamer: StackNamer;
  private currentFilter: string = '';
  private nextGroupId: number = 1;
  private nextFileId: number = 1;
  private nextCategoryId: number = 1;
  private goroutinesByID: Map<string, Goroutine> = new Map();

  constructor(settings: ProfileCollectionSettings) {
    this.settings = settings;
    this.stackNamer = new StackNamer(settings.titleManipulationRules);
  }

  /**
   * Generate a stack name from the trace using title manipulation rules
   */
  private generateStackName(trace: Frame[]): string {
    if (trace.length === 0) return 'empty';
    return this.stackNamer.generateTitle(trace);
  }

  /**
   * Generate a category name from the trace using pattern: prefix up to second slash OR first dot
   * Uses prefix up to second slash OR first dot, whichever comes first
   * Skips frames that match any of the categoryIgnoredPrefixes
   */
  private generateCategoryName(trace: Frame[]): string {
    if (trace.length === 0) return 'empty';
    
    // Start from the last frame and work backwards to find a non-ignored frame
    for (let i = trace.length - 1; i >= 0; i--) {
      const frame = trace[i];
      const func = frame.func;
      
      // Check if this frame should be ignored
      const shouldIgnore = this.settings.categoryIgnoredPrefixes.some(prefix => 
        func.startsWith(prefix)
      );
      
      if (!shouldIgnore) {
        // Found a non-ignored frame, use it for categorization
        return this.extractCategoryFromFunction(func);
      }
    }
    
    // If all frames are ignored, fall back to the last frame
    const lastFrame = trace[trace.length - 1];
    return this.extractCategoryFromFunction(lastFrame.func);
  }

  /**
   * Extract category name using pattern: prefix up to second slash OR first dot in second part
   * Pattern: part1/part2 where part2 stops at first dot or slash
   * Returns first part, slash, and second part up to dot or second slash
   */
  private extractCategoryFromFunction(func: string): string {
    // Handle empty string or empty function notation
    if (func === '' || func === '()') {
      return '';
    }
    
    // Handle edge cases that should return empty
    if (func === '/' || func === '.' || func.startsWith('/')) {
      return '';
    }
    
    // Handle double slash case like "a//b" -> "a/"
    if (func.includes('//')) {
      const doubleSlashIndex = func.indexOf('//');
      return func.substring(0, doubleSlashIndex + 1);
    }
    
    const firstDot = func.indexOf('.');
    const firstSlash = func.indexOf('/');
    
    // Special case: if dot comes before slash and there's only one slash, prefer dot rule
    // BUT skip this if the pattern looks like a domain (has multiple dots before first slash)
    if (firstDot !== -1 && firstSlash !== -1 && firstDot < firstSlash) {
      // Count slashes and dots before first slash
      const slashCount = (func.match(/\//g) || []).length;
      const dotsBeforeSlash = func.substring(0, firstSlash).split('.').length - 1;
      if (slashCount === 1 && dotsBeforeSlash === 1) {
        // Only one slash and one dot before it, use dot rule
        return func.substring(0, firstDot);
      }
    }
    
    // Try to match the pattern (([^/.]*\.[^/]*)*/)?[^/.]+(/[^/.]+)?
    // This captures optional domain-like patterns followed by path segments
    const match = func.match(/^((([^\/.]*\.[^\/]*)*\/)?[^\/.]+(\/[^\/.]+)?)/);
    
    if (match) {
      // Found the pattern, return the captured group
      return match[1];
    }
    
    // Fallback: if no slash but has dot, use prefix up to first dot
    if (firstSlash === -1 && firstDot !== -1) {
      // No slash but has dot, use dot rule
      return func.substring(0, firstDot);
    }
    
    // No pattern match, return whole function
    return func;
  }

  /**
   * Process a single frame with trimming settings
   */
  private processFrame(parserFrame: ParserFrame): Frame {
    const f: Frame = { ...parserFrame };

    for (const regex of this.settings.functionPrefixesToTrim) {
      const match = f.func.match(regex);
      if (match) {
        f.func = f.func.substring(match[0].length);
        break; // Only apply first matching pattern
      }
    }

    for (const regex of this.settings.filePrefixesToTrim) {
      const match = f.file.match(regex);
      if (match) {
        f.file = f.file.substring(match[0].length);
        break; // Only apply first matching pattern
      }
    }
    return f;
  }

  /**
   * Process an array of frames with trimming settings
   */
  private processFrames(parserFrames: ParserFrame[]): Frame[] {
    return parserFrames.map(frame => this.processFrame(frame));
  }

  /**
   * Import parser results into app File structure
   */
  private importParsedFile(parserFile: ParserFile, fileName: string, nameInIds: boolean) {
    const fileId = `f${this.nextFileId++}`;

    // Process each stack group
    for (const group of parserFile.groups) {
      const stackId = `s${group.traceId}`;
      let { category, stack } = this.stackForTraceId.get(group.traceId) || {};
      if (!stack) {
        const trace = this.processFrames(group.trace);
        stack = {
          id: stackId,
          name: this.generateStackName(trace),
          trace: trace,
          searchableText: this.generateStackSearchableText(group.trace),
          pinned: false,
          counts: {
            total: 0,
            matches: 0,
            priorMatches: 0,
            filterMatches: 0,
          },
          files: [],
        };
      }
      if (!category) {
        const catName = this.generateCategoryName(stack.trace);
        category = this.categories.find(c => c.name === catName);
        if (!category) {
          category = {
            id: `cat${this.nextCategoryId++}`,
            name: catName,
            stacks: [],
            pinned: false,
            counts: {
              total: 0,
              matches: 0,
              priorMatches: 0,
              filterMatches: 0,
            },
          };
          this.categories.push(category);
          this.stackForTraceId.set(group.traceId, {category, stack });
        }
        category.stacks.push(stack);
      }

      // Now create the group with goroutines that reference the stack
      const g: Group = {
        id: `g${this.nextGroupId++}`,
        labels: group.labels,
        pinned: false,
        counts: {
          total: group.count,
          matches: group.count,
          priorMatches: group.count,
          filterMatches: group.count,
        },
        goroutines: group.goroutines.map(g => {
          // Extract state from group labels
          const stateLabel = group.labels.find(label => label.startsWith('state='));
          const state = stateLabel ? stateLabel.split('=')[1] : group.labels[0] || 'unknown';
          return { ...g, matches: true, pinned: false, stack, state };
        }),
      };

      // Update goroutine IDs and store them
      for (const goroutine of g.goroutines) {
        if (nameInIds) {
          goroutine.id = `${fileName}.${goroutine.id}`;
          // Also prefix creator ID if it exists and isn't empty
          if (goroutine.creator !== '') {
            goroutine.creator = `${fileName}.${goroutine.creator}`;
          }
          goroutine.created = goroutine.created.map(created => `${fileName}.${created}`);
        }
        this.goroutinesByID.set(goroutine.id, goroutine);
      }

      let fileSection = stack.files.find(file => file.fileId === fileId);
      if (!fileSection) {
        fileSection = {
          id: `s${stack.id}-${fileId}`,
          fileId: fileId,
          fileName: fileName,
          groups: [g],
          pinned: false,
          counts: {
            total: g.counts.total,
            matches: g.counts.matches,
            priorMatches: g.counts.priorMatches,
            filterMatches: g.counts.filterMatches,
          },
        };
        stack.files.push(fileSection);
      } else {
        fileSection.groups.push(g);
        fileSection.counts.total += g.counts.total;
        fileSection.counts.matches += g.counts.matches;
        fileSection.counts.priorMatches += g.counts.priorMatches;
        fileSection.counts.filterMatches += g.counts.filterMatches;
      }
      stack.counts.total += g.counts.total;
      stack.counts.matches += g.counts.matches;
      stack.counts.priorMatches += g.counts.priorMatches;
      stack.counts.filterMatches += g.counts.filterMatches;

      category.counts.total += g.counts.total;
      category.counts.matches += g.counts.matches;
      category.counts.priorMatches += g.counts.priorMatches;
      category.counts.filterMatches += g.counts.filterMatches;
    }

  }

  /**
   * Generate stack-level searchable text (functions, files, filenames only)
   */
  private generateStackSearchableText(trace: Frame[]): string {
    const parts: string[] = [];
    for (const frame of trace) {
      parts.push(frame.func);
      parts.push(`${frame.file}:${frame.line}`);
    }
    return parts.join(' ').toLowerCase();
  }

  /**
   * Get all categories in the collection
   */
  getCategories(): Category[] {
    return this.categories;
  }


  getGoroutineByID(id: string): Goroutine | undefined {
    return this.goroutinesByID.get(id);
  }

  /**
   * Get list of file names in the collection, sorted alphabetically
   */
  getFileNames(): string[] {
    return Array.from(this.parsedFiles.keys()).sort();
  }

  lookupGoroutine(id: string): Goroutine | undefined {
    // Return a read-only copy
    const goroutine = this.goroutinesByID.get(id);
    return goroutine ? { ...goroutine } : undefined;
  }

  /**
   * Add a file to the collection with optional custom name
   */
  addFile(parsedFile: ParserFile, customName?: string): void {
    if (this.parsedFiles.size == 1) {
      // If there is only one file, we need to put its name into its ids before
      // we add another.
      const existing = this.parsedFiles.keys().next().value!;
      this.renameFile(existing, existing, true);
    }
    const fileName = customName || parsedFile.extractedName || parsedFile.originalName;
    this.parsedFiles.set(fileName, parsedFile);
    this.importParsedFile(parsedFile, fileName, this.parsedFiles.size > 1);
  }

  /**
   * Remove a file from the collection
   */
  removeFile(fileName: string): boolean {
    if (!this.parsedFiles.has(fileName)) {
      return false;
    }

    this.parsedFiles.delete(fileName);

    // Remove all stacks that only contain this file
    this.categories = this.categories.filter(cat => {
      cat.stacks = cat.stacks.filter(stack => {
        stack.files = stack.files.filter(file => {
          if (file.fileName === fileName) {
            file.groups.forEach(group => {
              group.goroutines.forEach(goroutine => {
                this.goroutinesByID.delete(goroutine.id);
              });
            });
            return false;
          }
          return true;
        });

        if (stack.files.length === 0) {
          return false;
        }
        stack.counts.matches = stack.files.reduce((sum, x) => sum + x.counts.matches, 0);
        stack.counts.total = stack.files.reduce((sum, x) => sum + x.counts.total, 0);
        stack.counts.priorMatches = stack.files.reduce((sum, x) => sum + x.counts.priorMatches, 0);
        stack.counts.filterMatches = stack.files.reduce((sum, x) => sum + x.counts.filterMatches, 0);
        return true;
      });
      if (cat.stacks.length === 0) {
        return false;
      }
      cat.counts.matches = cat.stacks.reduce((sum, x) => sum + x.counts.matches, 0);
      cat.counts.total = cat.stacks.reduce((sum, x) => sum + x.counts.total, 0);
      cat.counts.priorMatches = cat.stacks.reduce((sum, x) => sum + x.counts.priorMatches, 0);
      cat.counts.filterMatches = cat.stacks.reduce((sum, x) => sum + x.counts.filterMatches, 0);
      return true;
    });

    // Rebuild stackForTraceId map to remove references to deleted stacks
    this.rebuildStackForTraceIdMap();

    // If only one file remains, remove prefixes from goroutine IDs
    if (this.parsedFiles.size === 1) {
      const remainingFileName = this.getFileNames()[0];
      this.renameFile(remainingFileName, remainingFileName, false);
    }
    return true;
  }

  /**
   * Rebuild the stackForTraceId map based on current stacks
   */
  private rebuildStackForTraceIdMap(): void {
    this.stackForTraceId.clear();
    
    for (const category of this.categories) {
      for (const stack of category.stacks) {
        // Extract traceId from stack.id (format is "s<traceId>")
        const traceId = stack.id.substring(1);
        this.stackForTraceId.set(traceId, { category, stack });
      }
    }
  }

  /**
   * Rename a file in the collection
   */
  renameFile(from: string, to: string, nameInIds: boolean): void {
    const content = this.parsedFiles.get(from);
    if (!content) {
      return;
    }
    
    this.removeFile(from);
    this.parsedFiles.set(to, content);
    this.importParsedFile(content, to, nameInIds);
  }

  /**
   * Update title manipulation rules
   */
  updateTitleRules(titleRules: string[]): void {
    this.settings.titleManipulationRules = titleRules;
    this.stackNamer.setRules(titleRules);

    // Re-import all files to regenerate stack names
    this.updateSettings(this.settings);
  }

  /**
   * Re-import all files with updated settings
   */
  updateSettings(newSettings: ProfileCollectionSettings): void {
    this.settings = newSettings;
    this.stackNamer.setRules(newSettings.titleManipulationRules);

    // Store current files with their names
    const files: Array<{ name: string; data: ParserFile }> = [];
    for (const [name, data] of this.parsedFiles) {
      files.push({ name, data });
    }

    // Clear collection
    this.categories = [];
    this.parsedFiles.clear();
    this.goroutinesByID.clear();
    this.stackForTraceId.clear();
    this.nextGroupId = 1;
    this.nextFileId = 1;
    this.nextCategoryId = 1;

    // Re-add all files
    for (const file of files) {
      this.addFile(file.data, file.name);
    }
  }

  clearFilterChanges(): void {
    for (const category of this.categories) {
      category.counts.priorMatches = category.counts.matches;
      for (const stack of category.stacks) {
        stack.counts.priorMatches = stack.counts.matches;
        for (const fileSection of stack.files) {
          fileSection.counts.priorMatches = fileSection.counts.matches;
          for (const group of fileSection.groups) {
            group.counts.priorMatches = group.counts.matches;
          }
        }
      }
    }
  }

  setFilter(filterObj: Filter) {
    this.currentFilter = filterObj.filterString.trim().toLowerCase();

    const filter = this.currentFilter === '' ? null : this.currentFilter;

    for (const category of this.categories) {
      for (const stack of category.stacks) {
        // If the stack itself matches, just flip everything to match.
        if (filter == null || stack.searchableText.includes(filter) || category.pinned) {
          stack.counts.matches = stack.counts.total;
          stack.counts.filterMatches = stack.counts.total;
          for (const fileSection of stack.files) {
            fileSection.counts.matches = fileSection.counts.total;
            fileSection.counts.filterMatches = fileSection.counts.total;
            for (const group of fileSection.groups) {
              group.counts.matches = group.counts.total;
              group.counts.filterMatches = group.counts.total;
              for (const goroutine of group.goroutines) {
                goroutine.matches = true;
              }
            }
          }
        } else {
          stack.counts.matches = 0;
          stack.counts.filterMatches = 0;
          for (const fileSection of stack.files) {
            fileSection.counts.matches = 0;
            fileSection.counts.filterMatches = 0;

            for (const group of fileSection.groups) {
              // Use the sophisticated filter evaluation logic
              const groupMatches = group.labels.some(label => label.includes(filter));
              if (groupMatches || group.pinned) {
                // If group matches or is pinned, all goroutines in the group match
                group.counts.matches = group.counts.total;
                group.counts.filterMatches = group.pinned ? 0 : group.counts.total;
                for (const goroutine of group.goroutines) {
                  goroutine.matches = true;
                }
              } else {
                // Check individual goroutines
                group.counts.matches = 0;
                group.counts.filterMatches = 0;
                for (const goroutine of group.goroutines) {
                  // First check normal filter logic
                  goroutine.matches = goroutine.id.includes(filter);
                  if (goroutine.matches) {
                    group.counts.filterMatches++;
                    group.counts.matches++;
                  } else if (
                    filterObj.forcedGoroutine &&
                    goroutine.id === filterObj.forcedGoroutine
                  ) {
                    // Matches forced, but not filter, so only increment matches.
                    goroutine.matches = true;
                    group.counts.matches++;
                  } else if (goroutine.pinned) {
                    // Pinned goroutines are visible but don't count as filter matches
                    goroutine.matches = true;
                    group.counts.matches++;
                  }
                }
              }
              fileSection.counts.matches += group.counts.matches;
              fileSection.counts.filterMatches += group.counts.filterMatches;
            }
            stack.counts.matches += fileSection.counts.matches;
            stack.counts.filterMatches += fileSection.counts.filterMatches;
          }
          
          // If stack is pinned and has no matches from children, make it visible
          if (stack.pinned && stack.counts.matches === 0) {
            stack.counts.matches = stack.counts.total;
            // Don't add to filterMatches since it's pinned, not filter-matched
          }
        }
      }
      category.counts.matches = category.stacks.reduce((sum, x) => sum + x.counts.matches, 0) ;
      category.counts.filterMatches = category.stacks.reduce((sum, x) => sum + x.counts.filterMatches, 0) ;
    }
  }

  /**
   * Clear filter and make all groups visible
   */
  clearFilter() {
    return this.setFilter({ filterString: '' });
  }

  /**
   * Toggle pinned state for a category
   */
  toggleCategoryPin(categoryId: string): boolean {
    const category = this.categories.find(c => c.id === categoryId);
    if (category) {
      category.pinned = !category.pinned;
      return category.pinned;
    }
    return false;
  }

  /**
   * Toggle pinned state for a stack
   */
  toggleStackPin(stackId: string): boolean {
    for (const category of this.categories) {
      const stack = category.stacks.find(s => s.id === stackId);
      if (stack) {
        stack.pinned = !stack.pinned;
        return stack.pinned;
      }
    }
    return false;
  }

  /**
   * Toggle pinned state for a group
   */
  toggleGroupPin(groupId: string): boolean {
    for (const category of this.categories) {
      for (const stack of category.stacks) {
        for (const fileSection of stack.files) {
          const group = fileSection.groups.find(g => g.id === groupId);
          if (group) {
            group.pinned = !group.pinned;
            return group.pinned;
          }
        }
      }
    }
    return false;
  }

  /**
   * Toggle pinned state for a goroutine
   */
  toggleGoroutinePin(goroutineId: string): boolean {
    const goroutine = this.goroutinesByID.get(goroutineId);
    if (goroutine) {
      goroutine.pinned = !goroutine.pinned;
      return goroutine.pinned;
    }
    return false;
  }
  

  /**
   * Toggle pinned state for a stack and all its children (groups and goroutines)
   */
  toggleStackPinWithChildren(stackId: string): boolean {
    this.categories.forEach(category => {
      const stack = category?.stacks.find(s => s.id === stackId);
      if (stack) {
        const newPinnedState = !stack.pinned;
        stack.pinned = newPinnedState;

        // Apply same state to all children
        for (const fileSection of stack.files) {
          for (const group of fileSection.groups) {
            group.pinned = newPinnedState;
            for (const goroutine of group.goroutines) {
              goroutine.pinned = newPinnedState;
            }
          }
        }
      }
    });
    return false;
  }

  /**
   * Toggle pinned state for a group and all its children (goroutines)
   */
  toggleGroupPinWithChildren(groupId: string): boolean {
    for (const cat of this.categories) {
      for (const stack of cat.stacks) {
        // Find the group in the stack
        for (const fileSection of stack.files) {
          const group = fileSection.groups.find(g => g.id === groupId);
          if (group) {
            const newPinnedState = !group.pinned;
            group.pinned = newPinnedState;
            
            // Apply same state to all children
            for (const goroutine of group.goroutines) {
              goroutine.pinned = newPinnedState;
            }
            return newPinnedState;
          }
        }
      }
    }
    return false;
  }

  /**
   * Toggle pinned state for a category and all its children (stacks, groups, goroutines)
   */
  toggleCategoryPinWithChildren(categoryId: string): boolean {
    const category = this.categories.find(c => c.id === categoryId);
    if (category) {
      const newPinnedState = !category.pinned;
      category.pinned = newPinnedState;
      
      // Apply same state to all children
      for (const stack of category.stacks) {
        stack.pinned = newPinnedState;
        for (const fileSection of stack.files) {
          for (const group of fileSection.groups) {
            group.pinned = newPinnedState;
            for (const goroutine of group.goroutines) {
              goroutine.pinned = newPinnedState;
            }
          }
        }
      }
      return newPinnedState;
    }
    return false;
  }

  /**
   * Unpin all categories, stacks, groups, and goroutines
   */
  unpinAllItems(): void {
    for (const category of this.categories) {
      category.pinned = false;
    }
    for (const category of this.categories) {
      for (const stack of category.stacks) {
        stack.pinned = false;
        for (const fileSection of stack.files) {
          fileSection.pinned = false;
          for (const group of fileSection.groups) {
            group.pinned = false;
            for (const goroutine of group.goroutines) {
              goroutine.pinned = false;
            }
          }
        }
      }
    }
  }

  /**
   * Check if any items are currently pinned
   */
  hasAnyPinnedItems(): boolean {
    for (const category of this.categories) {
      if (category.pinned) return true;
      for (const stack of category.stacks) {
        if (stack.pinned) return true;
        for (const fileSection of stack.files) {
          if (fileSection.pinned) return true;
          for (const group of fileSection.groups) {
            if (group.pinned) return true;
            for (const goroutine of group.goroutines) {
              if (goroutine.pinned) return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Get the current filter string
   */
  getCurrentFilter(): string {
    return this.currentFilter;
  }

  /**
   * Get statistics about stacks (total vs visible)
   */
  getStackStatistics(): {
    total: number;
    visible: number;
    totalGoroutines: number;
    visibleGoroutines: number;
  } {
    let total = 0;
    let visible = 0;
    let totalGoroutines = 0;
    let visibleGoroutines = 0;

    // Filter stacks that have visible goroutines and count goroutines
    this.categories.forEach(cat => {
      totalGoroutines += cat.counts.total;
      visibleGoroutines += cat.counts.matches;
      total += cat.stacks.length;
      visible += cat.stacks.filter(stack => stack.counts.matches > 0).length;
    });

    return { total, visible, totalGoroutines, visibleGoroutines };
  }

  /**
   * Clear all data from the collection
   */
  clear(): void {
    this.categories = [];
    this.parsedFiles.clear();
    this.goroutinesByID.clear();
    this.stackForTraceId.clear();
    this.currentFilter = '';
    this.nextGroupId = 1;
    this.nextFileId = 1;
    this.nextCategoryId = 1;
  }

  /**
   * Get statistics about goroutines by file (total vs visible)
   */
  getFileStatistics(): Map<string, { visible: number; total: number }> {
    const stats = new Map<string, { visible: number; total: number }>();

    for (const category of this.categories) {
      for (const stack of category.stacks) {
        for (const file of stack.files) {
          if (!stats.has(file.fileName)) {
            stats.set(file.fileName, { visible: 0, total: 0 });
          }
          const fileStat = stats.get(file.fileName)!;
          fileStat.total += file.counts.total;
          fileStat.visible += file.counts.matches;
        }
      }
    }

    return stats;
  }
}
