/**
 * Pure functions for stack naming and categorization
 */

import { Frame } from './types.js';

export type TitleRule =
  | { skip: string }
  | { trim: string }
  | { fold: string; to: string; while?: string }
  | { find: string; to: string; while?: string };

export type CategoryRule = { skip: string } | { match: string };

/**
 * Determine if a function name represents a Go standard library function
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
 * Check if a function name matches a pattern (supports both literal prefixes and regex)
 */
function matchesPattern(functionName: string, pattern: string): boolean {
  // First try exact literal prefix match - this handles cases like 'util/admission.(*WorkQueue).Admit'
  if (functionName.startsWith(pattern)) {
    return true;
  }

  // If pattern contains regex special characters and literal match failed, try as regex
  if (
    pattern.includes('(') ||
    pattern.includes('[') ||
    pattern.includes('*') ||
    pattern.includes('+') ||
    pattern.includes('?') ||
    pattern.includes('\\')
  ) {
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

/**
 * Generate a stack name from the trace using title manipulation rules
 */
export function generateStackName(trace: Frame[], rules: TitleRule[]): string {
  if (trace.length === 0) return 'empty';
  
  let stackName = '';
  let frameOffset = 0;

  while (frameOffset < trace.length) {
    const frame = trace[frameOffset];
    const frameName = frame.func;

    // For each skip rule, if it matches the frame name: advance frame offset, continue
    let shouldSkip = false;
    for (const rule of rules) {
      if ('skip' in rule && frameName.startsWith(rule.skip)) {
        frameOffset++;
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;

    // If a fold rule matches frame name: prepend its replacement to stackName, advance frame offset by one plus however many match the while pattern
    let foldMatched = false;
    for (const rule of rules) {
      if ('fold' in rule && matchesPattern(frameName, rule.fold)) {
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
            for (const skipRule of rules) {
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
    for (const rule of rules) {
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
          const match = rule.trim.match(/^s\|(.*)\|([^|]*)\|([gimuy]*)$/);
          if (match) {
            try {
              const [, pattern, replacement, flags] = match;
              const regex = new RegExp(pattern, flags || '');
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
      for (const rule of rules) {
        if ('find' in rule && matchesPattern(searchFrame.func, rule.find)) {
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
          for (const skipRule of rules) {
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
 * Apply a match rule with #num syntax for capture group selection and -- comment support
 */
function applyMatchRule(func: string, matchPattern: string): string | null {
  // First, strip any comment suffix (-- comment)
  const commentIndex = matchPattern.indexOf(' --');
  const cleanPattern =
    commentIndex !== -1 ? matchPattern.substring(0, commentIndex).trim() : matchPattern;

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
    captureGroup = 1; // Default to first capture group
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
 * extractCategoryFromFunction is a categorizer of last resort, if the match
 * rules don't match anything.
 */
function extractCategoryFromFunction(func: string): string {
  const firstSlash = func.indexOf('/');
  return firstSlash === -1 ? func : func.substring(0, firstSlash);
}

/**
 * Generate a category name from the trace using category rules
 * The first non-skipped frame determines the category; if a match rule matches this frame
 * its first capture group (or a capture chosen by #num suffix) is used; otherwise the whole frame is used.
 */
export function generateCategoryName(trace: Frame[], rules: CategoryRule[]): string {
  if (trace.length === 0) return '<frameless stack>';

  // Start from the last frame (bottom of stack) and work backwards to find a non-skipped frame
  for (let i = trace.length - 1; i >= 0; i--) {
    const frame = trace[i];
    const func = frame.func;

    // Phase 1: Check if this frame should be skipped (check ALL skip rules)
    const shouldSkip = rules.some(
      rule => 'skip' in rule && func.startsWith(rule.skip)
    );

    if (shouldSkip) {
      continue; // Skip this frame, try the next one
    }

    // Phase 2: Frame is not skipped, check ALL match rules for category
    for (const rule of rules) {
      if ('match' in rule) {
        const result = applyMatchRule(func, rule.match);
        if (result) {
          return result;
        }
      }
    }

    // Phase 3: No match rules applied, fall back to extracting from function name
    return extractCategoryFromFunction(func);
  }

  // If all frames are skipped, fall back to frame 0 (top of stack)
  const topFrame = trace[0];
  return extractCategoryFromFunction(topFrame.func);
}

/**
 * Generate stack-level searchable text (functions, files, filenames only)
 */
export function generateStackSearchableText(trace: Frame[]): string {
  const parts: string[] = [];
  for (const frame of trace) {
    parts.push(frame.func);
    parts.push(`${frame.file}:${frame.line}`);
  }
  return parts.join(' ').toLowerCase();
}