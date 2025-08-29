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
import {
  UniqueStack,
  Frame,
  Group,
  NameExtractionPattern,
  Filter,
  Goroutine,
  Category,
} from './types.js';

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

type TitleRule = 
  | { skip: string }
  | { trim: string }
  | { fold: string; to: string; while?: string }
  | { find: string; to: string; while?: string };

type CategoryRule = 
  | { skip: string }
  | { match: string };

/**
 * Parses title manipulation rules and applies them to generate stack names
 */
class StackNamer {
  private rules: TitleRule[] = [];

  constructor(rules: TitleRule[] = []) {
    this.setRules(rules);
  }

  setRules(rules: TitleRule[]): void {
    this.rules = rules;
  }

  /**
   * Check if a function name matches a pattern (supports both literal prefixes and regex)
   */
  private matchesPattern(functionName: string, pattern: string): boolean {
    // First try exact literal prefix match - this handles cases like 'util/admission.(*WorkQueue).Admit'
    if (functionName.startsWith(pattern)) {
      return true;
    }
    
    // If pattern contains regex special characters and literal match failed, try as regex
    if (pattern.includes('(') || pattern.includes('[') || pattern.includes('*') || pattern.includes('+') || pattern.includes('?')) {
      try {
        const regex = new RegExp(pattern);
        return regex.test(functionName);
      } catch (e) {
        // Invalid regex, already tried prefix matching above
        return false;
      }
    }
    
    // Pattern doesn't contain special chars and prefix match failed
    return false;
  }


  generateTitle(trace: Frame[]): string {
    let stackName = '';
    let frameOffset = 0;
    
    while (frameOffset < trace.length) {
      const frame = trace[frameOffset];
      const frameName = frame.func;
      
      // For each skip rule, if it matches the frame name: advance frame offset, continue
      let shouldSkip = false;
      for (const rule of this.rules) {
        if ('skip' in rule && frameName.startsWith(rule.skip)) {
          frameOffset++;
          shouldSkip = true;
          break;
        }
      }
      if (shouldSkip) continue;
      
      // If a fold rule matches frame name: prepend its replacement to stackName, advance frame offset by one plus however many match the while pattern
      let foldMatched = false;
      for (const rule of this.rules) {
        if ('fold' in rule && this.matchesPattern(frameName, rule.fold)) {
          // Prepend replacement (only if stackName doesn't already start with it)
          if (!stackName.startsWith(rule.to)) {
            stackName = rule.to + (stackName ? ' → ' + stackName : '');
          }
          
          // Advance by 1 plus matching while frames
          frameOffset++;
          if (rule.while) {
            while (frameOffset < trace.length) {
              const nextFrame = trace[frameOffset];
              
              // Check if this frame should be skipped
              let shouldSkip = false;
              for (const skipRule of this.rules) {
                if ('skip' in skipRule && nextFrame.func.startsWith(skipRule.skip)) {
                  shouldSkip = true;
                  break;
                }
              }
              
              if (shouldSkip) {
                frameOffset++;
                continue;
              }
              
              let shouldContinue = false;
              
              if (rule.while === 'stdlib' && isStdLib(nextFrame.func)) {
                shouldContinue = true;
              } else if (rule.while !== 'stdlib') {
                try {
                  const regex = new RegExp(rule.while);
                  shouldContinue = regex.test(nextFrame.func);
                } catch (e) {
                  shouldContinue = nextFrame.func.startsWith(rule.while);
                }
              }
              
              if (shouldContinue) {
                frameOffset++;
              } else {
                break;
              }
            }
          }
          
          foldMatched = true;
          break;
        }
      }
      if (foldMatched) continue;
      
      // Set trimmed name to frame's func, then trim it with each matching trim rule
      let trimmedName = frameName;
      for (const rule of this.rules) {
        if ('trim' in rule) {
          if (rule.trim.startsWith('s/')) {
            const match = rule.trim.match(/^s\/(.+)\/(.*)\/$/);
            if (match) {
              try {
                const [, pattern, replacement] = match;
                const regex = new RegExp(pattern);
                trimmedName = trimmedName.replace(regex, replacement);
              } catch (e) {
                // Invalid regex, ignore this rule
              }
            }
          } else if (rule.trim.startsWith('s|')) {
            const match = rule.trim.match(/^s\|(.*)\|([^|]*)\|$/);
            if (match) {
              try {
                const [, pattern, replacement] = match;
                const regex = new RegExp(pattern);
                trimmedName = trimmedName.replace(regex, replacement);
              } catch (e) {
                // Invalid regex, ignore this rule
              }
            }
          } else if (trimmedName.startsWith(rule.trim)) {
            trimmedName = trimmedName.slice(rule.trim.length);
          }
        }
      }
      
      // Prepend trimmed framename to stackname
      if (!stackName.startsWith(trimmedName)) {
        stackName = trimmedName + (stackName ? ' → ' + stackName : '');
      }
      
      // For each find rule, check if it finds a match; if many match, use the one with the largest offset
      let bestFind = null;
      let bestOffset = -1;
      
      for (let searchOffset = frameOffset + 1; searchOffset < trace.length; searchOffset++) {
        const searchFrame = trace[searchOffset];
        for (const rule of this.rules) {
          if ('find' in rule && this.matchesPattern(searchFrame.func, rule.find)) {
            if (searchOffset > bestOffset) {
              bestFind = rule;
              bestOffset = searchOffset;
            }
          }
        }
      }
      
      if (bestFind) {
        // Prepend the find rule's replacement to stackname
        if (!stackName.startsWith(bestFind.to)) {
          stackName = bestFind.to + (stackName ? ' → ' + stackName : '');
        }
        
        // Advance frame offset by 1 (the match) plus as many following frames match the while pattern
        frameOffset = bestOffset + 1;
        if (bestFind.while) {
          while (frameOffset < trace.length) {
            const nextFrame = trace[frameOffset];
            
            // Check if this frame should be skipped
            let shouldSkip = false;
            for (const skipRule of this.rules) {
              if ('skip' in skipRule && nextFrame.func.startsWith(skipRule.skip)) {
                shouldSkip = true;
                break;
              }
            }
            
            if (shouldSkip) {
              frameOffset++;
              continue;
            }
            
            let shouldContinue = false;
            
            if (bestFind.while === 'stdlib' && isStdLib(nextFrame.func)) {
              shouldContinue = true;
            } else if (bestFind.while !== 'stdlib') {
              try {
                const regex = new RegExp(bestFind.while);
                shouldContinue = regex.test(nextFrame.func);
              } catch (e) {
                shouldContinue = nextFrame.func.startsWith(bestFind.while);
              }
            }
            
            if (shouldContinue) {
              frameOffset++;
            } else {
              break;
            }
          }
        }
        continue;
      }
      
      // Since no find or fold or skip caused a continue: done
      return stackName || (trace.length > 0 ? trace[trace.length - 1].func : '');
    }
    
    return stackName || (trace.length > 0 ? trace[trace.length - 1].func : '');
  }

  /**
   * Scan remaining frames for find rules and return both the result and where to continue
   */
  private findInRemainingFrames(frames: Frame[]): { result: string; skipToIndex: number } | null {
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const functionName = frame.func;
      
      for (const rule of this.rules) {
        if ('find' in rule && this.matchesPattern(functionName, rule.find)) {
          // Found a match, now skip frames according to while pattern
          let skipToIndex = i + 1;
          if (rule.while) {
            while (skipToIndex < frames.length) {
              const skipFrame = frames[skipToIndex];
              let shouldContinueSkipping = false;
              
              if (rule.while === 'stdlib' && isStdLib(skipFrame.func)) {
                shouldContinueSkipping = true;
              } else if (rule.while !== 'stdlib') {
                try {
                  const regex = new RegExp(rule.while);
                  shouldContinueSkipping = regex.test(skipFrame.func);
                } catch (e) {
                  shouldContinueSkipping = skipFrame.func.startsWith(rule.while);
                }
              }
              
              if (shouldContinueSkipping) {
                skipToIndex++;
              } else {
                break;
              }
            }
          }
          
          return { result: rule.to, skipToIndex };
        }
      }
    }
    return null;
  }

  /**
   * Apply find rules to scan remaining frames and extract additional information
   * Returns prefix (to prepend), suffix (to append after arrow), and new determined name if naming resumes
   */
  private applyFindRules(frames: Frame[], initialSuffix: string): { prefix: string; suffix: string; newName?: string } {
    let prefix = '';
    let suffix = initialSuffix;
    let frameIndex = 0;

    while (frameIndex < frames.length) {
      const frame = frames[frameIndex];
      let functionName = frame.func;
      let foundMatch = false;

      // Check find rules
      for (const rule of this.rules) {
        if ('find' in rule && this.matchesPattern(functionName, rule.find)) {
          // Add the find text to prefix
          prefix += (prefix ? ' → ' : '') + rule.to;
          
          // Skip frames matching the while pattern
          let skipIndex = frameIndex + 1;
          if (rule.while) {
            while (skipIndex < frames.length) {
              const skipFrame = frames[skipIndex];
              let shouldContinueSkipping = false;
              
              if (rule.while === 'stdlib' && isStdLib(skipFrame.func)) {
                shouldContinueSkipping = true;
              } else if (rule.while !== 'stdlib') {
                try {
                  const regex = new RegExp(rule.while);
                  shouldContinueSkipping = regex.test(skipFrame.func);
                } catch (e) {
                  // Invalid regex, treat as prefix match for backward compatibility
                  shouldContinueSkipping = skipFrame.func.startsWith(rule.while);
                }
              }
              
              if (shouldContinueSkipping) {
                skipIndex++;
              } else {
                break;
              }
            }
          }
          
          // Insert find prefix into the existing suffix
          // The suffix already contains the determined name, just insert our prefix
          const parts = suffix.split(' → ');
          if (parts.length > 0) {
            // Insert find prefix after the first part (determined name)
            parts.splice(1, 0, rule.to);
            return { prefix: '', suffix: parts.join(' → ') };
          } else {
            return { prefix, suffix };
          }
        }
      }

      if (!foundMatch) {
        frameIndex++;
      }
    }

    return { prefix, suffix };
  }

  /**
   * Resume naming process from given frames (used by find rules)
   */
  private resumeNamingFromFrames(frames: Frame[], initialSuffix: string): { name: string; suffix: string } {
    // Apply the same naming logic as generateTitle but starting from these frames
    const tempNamer = new StackNamer(this.rules);
    const tempName = tempNamer.generateTitle(frames);
    
    // Extract any additional suffix that might have been accumulated
    const arrowIndex = tempName.indexOf(' → ');
    if (arrowIndex !== -1) {
      const name = tempName.substring(0, arrowIndex);
      const newSuffix = tempName.substring(arrowIndex + 3);
      const combinedSuffix = initialSuffix ? newSuffix + ' → ' + initialSuffix : newSuffix;
      return { name, suffix: combinedSuffix };
    } else {
      return { name: tempName, suffix: initialSuffix };
    }
  }
}

export interface ProfileCollectionSettings {
  functionPrefixesToTrim: RegExp[];
  filePrefixesToTrim: RegExp[];
  titleManipulationRules: TitleRule[];
  nameExtractionPatterns: NameExtractionPattern[];
  zipFilePattern: string;
  categoryRules: CategoryRule[];
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
  private goroutineToCategory: Map<string, Category> = new Map();

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
   * Generate a category name from the trace using category rules
   * The first non-skipped frame determines the category; if a match rule matches this frame 
   * its first capture group (or a capture chosen by #num suffix) is used; otherwise the whole frame is used.
   */
  private generateCategoryName(trace: Frame[]): string {
    if (trace.length === 0) return '<frameless stack>';

    // Start from the last frame (bottom of stack) and work backwards to find a non-skipped frame
    for (let i = trace.length - 1; i >= 0; i--) {
      const frame = trace[i];
      const func = frame.func;

      // Phase 1: Check if this frame should be skipped (check ALL skip rules)
      const shouldSkip = this.settings.categoryRules.some(rule => 
        'skip' in rule && func.startsWith(rule.skip)
      );
      
      if (shouldSkip) {
        continue; // Skip this frame, try the next one
      }

      // Phase 2: Frame is not skipped, check ALL match rules for category
      for (const rule of this.settings.categoryRules) {
        if ('match' in rule) {
          const result = this.applyMatchRule(func, rule.match);
          if (result) {
            return result;
          }
        }
      }

      // Phase 3: No match rules applied, fall back to extracting from function name
      return this.extractCategoryFromFunction(func);
    }

    // If all frames are skipped, fall back to frame 0 (top of stack)
    const topFrame = trace[0];
    return this.extractCategoryFromFunction(topFrame.func);
  }

  /**
   * Apply a match rule with #num syntax for capture group selection and -- comment support
   */
  private applyMatchRule(func: string, matchPattern: string): string | null {
    // First, strip any comment suffix (-- comment)
    const commentIndex = matchPattern.indexOf(' --');
    const cleanPattern = commentIndex !== -1 
      ? matchPattern.substring(0, commentIndex).trim()
      : matchPattern;

    // Parse pattern#num syntax
    const hashIndex = cleanPattern.lastIndexOf('#');
    let pattern: string;
    let captureGroup: number;

    if (hashIndex !== -1) {
      pattern = cleanPattern.substring(0, hashIndex);
      const groupStr = cleanPattern.substring(hashIndex + 1);
      captureGroup = parseInt(groupStr, 10);
      if (isNaN(captureGroup)) {
        captureGroup = 0; // Default to whole match if invalid number
      }
    } else {
      pattern = cleanPattern;
      captureGroup = 0; // Default to whole match
    }

    try {
      const regex = new RegExp(pattern);
      const match = func.match(regex);
      
      if (match) {
        // Return the specified capture group or whole match
        return match[captureGroup] || match[0] || '';
      }
    } catch (e) {
      console.warn('Invalid match rule pattern:', pattern, e);
    }

    return null;
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

    // Use default pattern: ^((([^/.]*\.[^/]*)*\/)?[^/.]+(\/?[^/.]+)?)
    try {
      const regex = new RegExp('^((([^\\/.]*\\\\.[^\\/]*)*\\/)?[^\\/.]+(\\/[^\\/.]+)?)');
      const match = func.match(regex);

      if (match && match[1]) {
        // Found the pattern, return the captured group
        return match[1];
      }
    } catch (e) {
      console.warn('Invalid category extraction pattern:', e);
      // Fall through to fallback logic
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

    // Apply function trim prefixes cumulatively
    for (const regex of this.settings.functionPrefixesToTrim) {
      const match = f.func.match(regex);
      if (match) {
        f.func = f.func.substring(match[0].length);
      }
    }

    // Apply file trim prefixes cumulatively
    for (const regex of this.settings.filePrefixesToTrim) {
      const match = f.file.match(regex);
      if (match) {
        f.file = f.file.substring(match[0].length);
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
            pinned: 0,
            minWait: Infinity,
            maxWait: -Infinity,
            minMatchingWait: Infinity,
            maxMatchingWait: -Infinity,
            states: new Map<string, number>(),
            matchingStates: new Map<string, number>(),
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
              pinned: 0,
              minWait: Infinity,
              maxWait: -Infinity,
              minMatchingWait: Infinity,
              maxMatchingWait: -Infinity,
              states: new Map<string, number>(),
              matchingStates: new Map<string, number>(),
            },
          };
          this.categories.push(category);
        }
        category.stacks.push(stack);
        this.stackForTraceId.set(group.traceId, { category, stack });
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
          pinnedCount: 0,
          minWait: Infinity,
          maxWait: -Infinity,
          minMatchingWait: Infinity,
          maxMatchingWait: -Infinity,
          states: new Map<string, number>(),
          matchingStates: new Map<string, number>(),
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
        this.goroutineToCategory.set(goroutine.id, category);
      }

      // Populate initial statistics from goroutines
      for (const goroutine of g.goroutines) {
        // Update wait time bounds
        if (goroutine.waitMinutes < g.counts.minWait) {
          g.counts.minWait = goroutine.waitMinutes;
        }
        if (goroutine.waitMinutes > g.counts.maxWait) {
          g.counts.maxWait = goroutine.waitMinutes;
        }
        
        // Initially all goroutines match (no filter applied)
        if (goroutine.waitMinutes < g.counts.minMatchingWait) {
          g.counts.minMatchingWait = goroutine.waitMinutes;
        }
        if (goroutine.waitMinutes > g.counts.maxMatchingWait) {
          g.counts.maxMatchingWait = goroutine.waitMinutes;
        }

        // Update state counts
        const currentTotalCount = g.counts.states.get(goroutine.state) || 0;
        g.counts.states.set(goroutine.state, currentTotalCount + 1);
        
        const currentMatchingCount = g.counts.matchingStates.get(goroutine.state) || 0;
        g.counts.matchingStates.set(goroutine.state, currentMatchingCount + 1);
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
            pinned: 0,
            minWait: g.counts.minWait,
            maxWait: g.counts.maxWait,
            minMatchingWait: g.counts.minMatchingWait,
            maxMatchingWait: g.counts.maxMatchingWait,
            states: new Map(g.counts.states),
            matchingStates: new Map(g.counts.matchingStates),
          },
        };
        stack.files.push(fileSection);
      } else {
        fileSection.groups.push(g);
        fileSection.counts.total += g.counts.total;
        fileSection.counts.matches += g.counts.matches;
        fileSection.counts.priorMatches += g.counts.priorMatches;
        fileSection.counts.filterMatches += g.counts.filterMatches;
        
        // Update wait time bounds
        if (g.counts.minWait < fileSection.counts.minWait) {
          fileSection.counts.minWait = g.counts.minWait;
        }
        if (g.counts.maxWait > fileSection.counts.maxWait) {
          fileSection.counts.maxWait = g.counts.maxWait;
        }
        if (g.counts.minMatchingWait < fileSection.counts.minMatchingWait) {
          fileSection.counts.minMatchingWait = g.counts.minMatchingWait;
        }
        if (g.counts.maxMatchingWait > fileSection.counts.maxMatchingWait) {
          fileSection.counts.maxMatchingWait = g.counts.maxMatchingWait;
        }
        
        // Aggregate state counts
        for (const [state, count] of g.counts.states) {
          const currentCount = fileSection.counts.states.get(state) || 0;
          fileSection.counts.states.set(state, currentCount + count);
        }
        for (const [state, count] of g.counts.matchingStates) {
          const currentCount = fileSection.counts.matchingStates.get(state) || 0;
          fileSection.counts.matchingStates.set(state, currentCount + count);
        }
      }
      stack.counts.total += g.counts.total;
      stack.counts.matches += g.counts.matches;
      stack.counts.priorMatches += g.counts.priorMatches;
      stack.counts.filterMatches += g.counts.filterMatches;
      
      // Update stack wait time bounds
      if (g.counts.minWait < stack.counts.minWait) {
        stack.counts.minWait = g.counts.minWait;
      }
      if (g.counts.maxWait > stack.counts.maxWait) {
        stack.counts.maxWait = g.counts.maxWait;
      }
      if (g.counts.minMatchingWait < stack.counts.minMatchingWait) {
        stack.counts.minMatchingWait = g.counts.minMatchingWait;
      }
      if (g.counts.maxMatchingWait > stack.counts.maxMatchingWait) {
        stack.counts.maxMatchingWait = g.counts.maxMatchingWait;
      }
      
      // Aggregate stack state counts
      for (const [state, count] of g.counts.states) {
        const currentCount = stack.counts.states.get(state) || 0;
        stack.counts.states.set(state, currentCount + count);
      }
      for (const [state, count] of g.counts.matchingStates) {
        const currentCount = stack.counts.matchingStates.get(state) || 0;
        stack.counts.matchingStates.set(state, currentCount + count);
      }

      category.counts.total += g.counts.total;
      category.counts.matches += g.counts.matches;
      category.counts.priorMatches += g.counts.priorMatches;
      category.counts.filterMatches += g.counts.filterMatches;
      
      // Update category wait time bounds
      if (g.counts.minWait < category.counts.minWait) {
        category.counts.minWait = g.counts.minWait;
      }
      if (g.counts.maxWait > category.counts.maxWait) {
        category.counts.maxWait = g.counts.maxWait;
      }
      if (g.counts.minMatchingWait < category.counts.minMatchingWait) {
        category.counts.minMatchingWait = g.counts.minMatchingWait;
      }
      if (g.counts.maxMatchingWait > category.counts.maxMatchingWait) {
        category.counts.maxMatchingWait = g.counts.maxMatchingWait;
      }
      
      // Aggregate category state counts
      for (const [state, count] of g.counts.states) {
        const currentCount = category.counts.states.get(state) || 0;
        category.counts.states.set(state, currentCount + count);
      }
      for (const [state, count] of g.counts.matchingStates) {
        const currentCount = category.counts.matchingStates.get(state) || 0;
        category.counts.matchingStates.set(state, currentCount + count);
      }
    }

    // Sort all data structures by name for stable ordering
    this.categories.sort((a, b) => a.name.localeCompare(b.name));
    for (const category of this.categories) {
      category.stacks.sort((a, b) => a.name.localeCompare(b.name));
      for (const stack of category.stacks) {
        stack.files.sort((a, b) => a.fileName.localeCompare(b.fileName));
      }
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
                this.goroutineToCategory.delete(goroutine.id);
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
        stack.counts.filterMatches = stack.files.reduce(
          (sum, x) => sum + x.counts.filterMatches,
          0
        );
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
  updateTitleRules(titleRules: TitleRule[]): void {
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
    this.goroutineToCategory.clear();
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
      // Reset category matching statistics
      category.counts.minMatchingWait = Infinity;
      category.counts.maxMatchingWait = -Infinity;
      category.counts.matchingStates.clear();

      for (const stack of category.stacks) {
        // Reset stack matching statistics
        stack.counts.minMatchingWait = Infinity;
        stack.counts.maxMatchingWait = -Infinity;
        stack.counts.matchingStates.clear();

        // If the stack itself matches text filter, still need to check wait/state constraints
        const stackTextMatches = filter == null || stack.searchableText.includes(filter);
        if (stackTextMatches) {
          // If there are no wait/state constraints, all goroutines match
          if (filterObj.minWait === undefined && filterObj.maxWait === undefined && filterObj.states === undefined) {
            stack.counts.matches = stack.counts.total;
            stack.counts.filterMatches = stack.counts.total;
            // Copy all statistics from total to matching
            stack.counts.minMatchingWait = stack.counts.minWait;
            stack.counts.maxMatchingWait = stack.counts.maxWait;
            stack.counts.matchingStates = new Map(stack.counts.states);

            for (const fileSection of stack.files) {
              fileSection.counts.matches = fileSection.counts.total;
              fileSection.counts.filterMatches = fileSection.counts.total;
              // Copy all statistics from total to matching
              fileSection.counts.minMatchingWait = fileSection.counts.minWait;
              fileSection.counts.maxMatchingWait = fileSection.counts.maxWait;
              fileSection.counts.matchingStates = new Map(fileSection.counts.states);

              for (const group of fileSection.groups) {
                group.counts.matches = group.counts.total;
                group.counts.filterMatches = group.counts.total;
                // Copy all statistics from total to matching
                group.counts.minMatchingWait = group.counts.minWait;
                group.counts.maxMatchingWait = group.counts.maxWait;
                group.counts.matchingStates = new Map(group.counts.states);

                for (const goroutine of group.goroutines) {
                  goroutine.matches = true;
                }
              }
            }
          } else {
            // Stack matches text but still need to check wait/state constraints on each goroutine
            stack.counts.matches = 0;
            stack.counts.filterMatches = 0;
            stack.counts.minMatchingWait = Infinity;
            stack.counts.maxMatchingWait = -Infinity;
            stack.counts.matchingStates.clear();

            for (const fileSection of stack.files) {
              fileSection.counts.matches = 0;
              fileSection.counts.filterMatches = 0;
              fileSection.counts.minMatchingWait = Infinity;
              fileSection.counts.maxMatchingWait = -Infinity;
              fileSection.counts.matchingStates.clear();

              for (const group of fileSection.groups) {
                group.counts.matches = 0;
                group.counts.filterMatches = 0;
                group.counts.minMatchingWait = Infinity;
                group.counts.maxMatchingWait = -Infinity;
                group.counts.matchingStates.clear();

                for (const goroutine of group.goroutines) {
                  // Text already matches stack, check wait/state constraints
                  let waitMatches = (filterObj.minWait === undefined || goroutine.waitMinutes >= filterObj.minWait) &&
                                   (filterObj.maxWait === undefined || goroutine.waitMinutes <= filterObj.maxWait);
                  let stateMatches = filterObj.states === undefined || filterObj.states.has(goroutine.state);
                  
                  goroutine.matches = waitMatches && stateMatches;
                  if (goroutine.matches) {
                    group.counts.matches++;
                    group.counts.filterMatches++;
                    
                    // Update matching statistics at all levels
                    [group.counts, fileSection.counts, stack.counts].forEach(counts => {
                      if (goroutine.waitMinutes < counts.minMatchingWait) {
                        counts.minMatchingWait = goroutine.waitMinutes;
                      }
                      if (goroutine.waitMinutes > counts.maxMatchingWait) {
                        counts.maxMatchingWait = goroutine.waitMinutes;
                      }
                      const currentCount = counts.matchingStates.get(goroutine.state) || 0;
                      counts.matchingStates.set(goroutine.state, currentCount + 1);
                    });
                  }
                }
                
                // Reset bounds if no matches at group level
                if (group.counts.matches === 0) {
                  group.counts.minMatchingWait = Infinity;
                  group.counts.maxMatchingWait = -Infinity;
                }
              }
              
              // Aggregate from groups to file
              fileSection.counts.matches = fileSection.groups.reduce((sum, g) => sum + g.counts.matches, 0);
              fileSection.counts.filterMatches = fileSection.groups.reduce((sum, g) => sum + g.counts.filterMatches, 0);
              
              // Reset bounds if no matches at file level
              if (fileSection.counts.matches === 0) {
                fileSection.counts.minMatchingWait = Infinity;
                fileSection.counts.maxMatchingWait = -Infinity;
              }
            }
            
            // Aggregate from files to stack
            stack.counts.matches = stack.files.reduce((sum, f) => sum + f.counts.matches, 0);
            stack.counts.filterMatches = stack.files.reduce((sum, f) => sum + f.counts.filterMatches, 0);
            
            // Reset bounds if no matches at stack level
            if (stack.counts.matches === 0) {
              stack.counts.minMatchingWait = Infinity;
              stack.counts.maxMatchingWait = -Infinity;
            }
          }
          
          // Calculate pinned counts - if stack is pinned, everything is pinned
          if (stack.pinned) {
            stack.counts.pinned = stack.counts.total;
            for (const fileSection of stack.files) {
              fileSection.counts.pinned = fileSection.counts.total;
              for (const group of fileSection.groups) {
                group.counts.pinned = group.counts.total;
              }
            }
          } else {
            stack.counts.pinned = 0;
            for (const fileSection of stack.files) {
              if (fileSection.pinned) {
                fileSection.counts.pinned = fileSection.counts.total;
                for (const group of fileSection.groups) {
                  group.counts.pinned = group.counts.total;
                }
              } else {
                fileSection.counts.pinned = 0;
                for (const group of fileSection.groups) {
                  if (group.pinned) {
                    group.counts.pinned = group.counts.total;
                  } else {
                    group.counts.pinned = group.goroutines.filter(g => g.pinned).length;
                  }
                  fileSection.counts.pinned += group.counts.pinned;
                }
              }
              stack.counts.pinned += fileSection.counts.pinned;
            }
          }
        } else {
          stack.counts.matches = 0;
          stack.counts.filterMatches = 0;

          for (const fileSection of stack.files) {
            fileSection.counts.matches = 0;
            fileSection.counts.filterMatches = 0;
            // Reset file section matching statistics
            fileSection.counts.minMatchingWait = Infinity;
            fileSection.counts.maxMatchingWait = -Infinity;
            fileSection.counts.matchingStates.clear();

            for (const group of fileSection.groups) {
              const groupMatches = group.labels.some(label => label.includes(filter));
              if (groupMatches) {
                // Group matches text, but still need to check wait/state constraints
                if (filterObj.minWait === undefined && filterObj.maxWait === undefined && filterObj.states === undefined) {
                  // No wait/state constraints, all goroutines match
                  group.counts.matches = group.counts.total;
                  group.counts.filterMatches = group.counts.total;
                  // Copy all statistics from total to matching
                  group.counts.minMatchingWait = group.counts.minWait;
                  group.counts.maxMatchingWait = group.counts.maxWait;
                  group.counts.matchingStates = new Map(group.counts.states);

                  for (const goroutine of group.goroutines) {
                    goroutine.matches = true;
                  }
                } else {
                  // Group matches text but still need to check wait/state constraints
                  group.counts.matches = 0;
                  group.counts.filterMatches = 0;
                  group.counts.minMatchingWait = Infinity;
                  group.counts.maxMatchingWait = -Infinity;
                  group.counts.matchingStates.clear();
                  
                  for (const goroutine of group.goroutines) {
                    // Text already matches group, check wait/state constraints
                    let waitMatches = (filterObj.minWait === undefined || goroutine.waitMinutes >= filterObj.minWait) &&
                                     (filterObj.maxWait === undefined || goroutine.waitMinutes <= filterObj.maxWait);
                    let stateMatches = filterObj.states === undefined || filterObj.states.has(goroutine.state);
                    
                    goroutine.matches = waitMatches && stateMatches;
                    if (goroutine.matches) {
                      group.counts.matches++;
                      group.counts.filterMatches++;
                      
                      // Update matching statistics
                      if (goroutine.waitMinutes < group.counts.minMatchingWait) {
                        group.counts.minMatchingWait = goroutine.waitMinutes;
                      }
                      if (goroutine.waitMinutes > group.counts.maxMatchingWait) {
                        group.counts.maxMatchingWait = goroutine.waitMinutes;
                      }
                      const currentCount = group.counts.matchingStates.get(goroutine.state) || 0;
                      group.counts.matchingStates.set(goroutine.state, currentCount + 1);
                    }
                  }
                  
                  // Reset bounds if no matches
                  if (group.counts.matches === 0) {
                    group.counts.minMatchingWait = Infinity;
                    group.counts.maxMatchingWait = -Infinity;
                  }
                }
              } else {
                const isPinned =
                  group.pinned || fileSection.pinned || stack.pinned || category.pinned;

                // Reset group matching statistics
                group.counts.matches = 0;
                group.counts.filterMatches = 0;
                group.counts.minMatchingWait = Infinity;
                group.counts.maxMatchingWait = -Infinity;
                group.counts.matchingStates.clear();

                for (const goroutine of group.goroutines) {
                  // Check all filter constraints
                  let textMatches = filter == null || goroutine.id.includes(filter);
                  let waitMatches = (filterObj.minWait === undefined || goroutine.waitMinutes >= filterObj.minWait) &&
                                   (filterObj.maxWait === undefined || goroutine.waitMinutes <= filterObj.maxWait);
                  let stateMatches = filterObj.states === undefined || filterObj.states.has(goroutine.state);
                  
                  goroutine.matches = textMatches && waitMatches && stateMatches;
                  if (goroutine.matches) {
                    group.counts.filterMatches++;
                    group.counts.matches++;
                  } else if (
                    isPinned ||
                    goroutine.pinned ||
                    (filterObj.forcedGoroutine && goroutine.id === filterObj.forcedGoroutine)
                  ) {
                    // Matches, but not due to filter.
                    goroutine.matches = true;
                    group.counts.matches++;
                  }

                  // Update matching statistics for matching goroutines
                  if (goroutine.matches) {
                    // Update wait time bounds
                    if (goroutine.waitMinutes < group.counts.minMatchingWait) {
                      group.counts.minMatchingWait = goroutine.waitMinutes;
                    }
                    if (goroutine.waitMinutes > group.counts.maxMatchingWait) {
                      group.counts.maxMatchingWait = goroutine.waitMinutes;
                    }

                    // Update state count
                    const currentCount = group.counts.matchingStates.get(goroutine.state) || 0;
                    group.counts.matchingStates.set(goroutine.state, currentCount + 1);
                  }
                }

                // Reset bounds if no matches
                if (group.counts.matches === 0) {
                  group.counts.minMatchingWait = Infinity;
                  group.counts.maxMatchingWait = -Infinity;
                }

                // If we don't have individual goroutines we need to set matches directly.
                if (group.goroutines.length === 0 && isPinned) {
                  group.counts.matches = group.counts.total;
                  // Copy statistics since all are matching
                  group.counts.minMatchingWait = group.counts.minWait;
                  group.counts.maxMatchingWait = group.counts.maxWait;
                  group.counts.matchingStates = new Map(group.counts.states);
                }

                // Calculate pinned count for group
                if (group.pinned) {
                  group.counts.pinned = group.counts.total;
                } else {
                  group.counts.pinned = group.goroutines.filter(g => g.pinned).length;
                }
              }

              // Aggregate group matching statistics up to file section
              if (group.counts.matches > 0) {
                if (group.counts.minMatchingWait < fileSection.counts.minMatchingWait) {
                  fileSection.counts.minMatchingWait = group.counts.minMatchingWait;
                }
                if (group.counts.maxMatchingWait > fileSection.counts.maxMatchingWait) {
                  fileSection.counts.maxMatchingWait = group.counts.maxMatchingWait;
                }
                for (const [state, count] of group.counts.matchingStates) {
                  const currentCount = fileSection.counts.matchingStates.get(state) || 0;
                  fileSection.counts.matchingStates.set(state, currentCount + count);
                }
              }

              fileSection.counts.matches += group.counts.matches;
              fileSection.counts.filterMatches += group.counts.filterMatches;
            }


            // Aggregate file section matching statistics up to stack
            if (fileSection.counts.matches > 0) {
              if (fileSection.counts.minMatchingWait < stack.counts.minMatchingWait) {
                stack.counts.minMatchingWait = fileSection.counts.minMatchingWait;
              }
              if (fileSection.counts.maxMatchingWait > stack.counts.maxMatchingWait) {
                stack.counts.maxMatchingWait = fileSection.counts.maxMatchingWait;
              }
              for (const [state, count] of fileSection.counts.matchingStates) {
                const currentCount = stack.counts.matchingStates.get(state) || 0;
                stack.counts.matchingStates.set(state, currentCount + count);
              }
            }

            stack.counts.matches += fileSection.counts.matches;
            stack.counts.filterMatches += fileSection.counts.filterMatches;
          }

          // Reset stack bounds if no matches
          if (stack.counts.matches === 0) {
            stack.counts.minMatchingWait = Infinity;
            stack.counts.maxMatchingWait = -Infinity;
          }

          // If stack is pinned and has no matches from children, make it visible
          if (stack.pinned && stack.counts.matches === 0) {
            stack.counts.matches = stack.counts.total;
            // Copy statistics since all are matching
            stack.counts.minMatchingWait = stack.counts.minWait;
            stack.counts.maxMatchingWait = stack.counts.maxWait;
            stack.counts.matchingStates = new Map(stack.counts.states);
          }

          // Calculate pinned counts - copy the pattern from matches logic above
          if (stack.pinned) {
            stack.counts.pinned = stack.counts.total;
            for (const fileSection of stack.files) {
              fileSection.counts.pinned = fileSection.counts.total;
              for (const group of fileSection.groups) {
                group.counts.pinned = group.counts.total;
              }
            }
          } else {
            stack.counts.pinned = 0;
            for (const fileSection of stack.files) {
              if (fileSection.pinned) {
                fileSection.counts.pinned = fileSection.counts.total;
                for (const group of fileSection.groups) {
                  group.counts.pinned = group.counts.total;
                }
              } else {
                fileSection.counts.pinned = 0;
                for (const group of fileSection.groups) {
                  if (group.pinned) {
                    group.counts.pinned = group.counts.total;
                  } else {
                    group.counts.pinned = group.goroutines.filter(g => g.pinned).length;
                  }
                  fileSection.counts.pinned += group.counts.pinned;
                }
              }
              stack.counts.pinned += fileSection.counts.pinned;
            }
          }
        }

        // Aggregate stack matching statistics up to category
        if (stack.counts.matches > 0) {
          if (stack.counts.minMatchingWait < category.counts.minMatchingWait) {
            category.counts.minMatchingWait = stack.counts.minMatchingWait;
          }
          if (stack.counts.maxMatchingWait > category.counts.maxMatchingWait) {
            category.counts.maxMatchingWait = stack.counts.maxMatchingWait;
          }
          for (const [state, count] of stack.counts.matchingStates) {
            const currentCount = category.counts.matchingStates.get(state) || 0;
            category.counts.matchingStates.set(state, currentCount + count);
          }
        }
      }

      // Reset category bounds if no matches
      if (category.stacks.every(stack => stack.counts.matches === 0)) {
        category.counts.minMatchingWait = Infinity;
        category.counts.maxMatchingWait = -Infinity;
      }

      category.counts.matches = category.stacks.reduce((sum, x) => sum + x.counts.matches, 0);
      category.counts.filterMatches = category.stacks.reduce(
        (sum, x) => sum + x.counts.filterMatches,
        0
      );

      // Calculate pinned count for category - propagate down like matches logic
      if (category.pinned) {
        category.counts.pinned = category.counts.total;
        // When category is pinned, all stacks within it are pinned too
        for (const stack of category.stacks) {
          stack.counts.pinned = stack.counts.total;
          for (const fileSection of stack.files) {
            fileSection.counts.pinned = fileSection.counts.total;
            for (const group of fileSection.groups) {
              group.counts.pinned = group.counts.total;
            }
          }
        }
      } else {
        category.counts.pinned = category.stacks.reduce((sum, x) => sum + x.counts.pinned, 0);
      }
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
      const oldPinned = goroutine.pinned;
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
    pinnedGoroutines: number;
  } {
    let total = 0;
    let visible = 0;
    let totalGoroutines = 0;
    let visibleGoroutines = 0;
    let pinnedGoroutines = 0;

    // Filter stacks that have visible goroutines and count goroutines
    this.categories.forEach(cat => {
      totalGoroutines += cat.counts.total;
      visibleGoroutines += cat.counts.matches;
      total += cat.stacks.length;
      visible += cat.stacks.filter(stack => stack.counts.matches > 0).length;
      
      // Count goroutines visible due to pinning
      pinnedGoroutines += cat.counts.pinned;
    });

    return { total, visible, totalGoroutines, visibleGoroutines, pinnedGoroutines };
  }

  /**
   * Clear all data from the collection
   */
  clear(): void {
    this.categories = [];
    this.parsedFiles.clear();
    this.goroutinesByID.clear();
    this.goroutineToCategory.clear();
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

  /**
   * Get statistics about goroutines by state (total vs visible)
   */
  getStateStatistics(): Map<string, { visible: number; total: number }> {
    const stats = new Map<string, { visible: number; total: number }>();

    // Aggregate total state counts from all categories
    for (const category of this.categories) {
      for (const [state, count] of category.counts.states) {
        const existing = stats.get(state) || { visible: 0, total: 0 };
        existing.total += count;
        stats.set(state, existing);
      }
    }

    // Aggregate visible (matching) state counts from all categories
    for (const category of this.categories) {
      for (const [state, count] of category.counts.matchingStates) {
        const existing = stats.get(state);
        if (existing) {
          existing.visible += count;
        }
      }
    }

    return stats;
  }

  /**
   * Get the category that contains a given goroutine
   */
  getCategoryForGoroutine(goroutineId: string): Category | undefined {
    return this.goroutineToCategory.get(goroutineId);
  }
}

export type { TitleRule, CategoryRule };
