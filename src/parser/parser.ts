/**
 * Core parser for Go stack trace files
 */

import { File, Result, Group, Frame, Goroutine } from './types.js';

/**
 * Calculate a SHA-256 fingerprint from frames
 */
async function fingerprint(frames: Frame[]): Promise<string> {
  const traceString = frames.map(frame => `${frame.func} ${frame.file}:${frame.line}`).join('\n');

  const encoder = new TextEncoder();
  const data = encoder.encode(traceString);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const FINGERPRINT_LENGTH = 24; // Use last 12 chars for compact but unique fingerprints
  return hashHex.slice(-FINGERPRINT_LENGTH);
}

interface NameExtractionPattern {
  regex: string;
  replacement: string;
}

interface ParserSettings {
  nameExtractionPatterns?: NameExtractionPattern[];
}

/**
 * File parser
 */
export class FileParser {
  private nameExtractionPatterns: NameExtractionPattern[];

  constructor(settings?: ParserSettings) {
    // Use provided patterns or empty array as fallback
    this.nameExtractionPatterns = settings?.nameExtractionPatterns || [];
  }

  /**
   * Parse a file and return common data structure
   */
  async parseFile(content: string, fileName: string): Promise<Result> {
    if (this.detectFormat2(content)) {
      return await this.parseFormat2(content, fileName);
    } else {
      return await this.parseFormat1(content, fileName);
    }
  }

  /**
   * Extract name from a line using configured patterns
   */
  private extractNameFromLine(line: string): string | null {
    for (const pattern of this.nameExtractionPatterns) {
      try {
        const regex = new RegExp(pattern.regex);
        const match = line.match(regex);
        if (match) {
          // Apply replacement template (e.g., "n$1" becomes "n" + first capture group)
          let result = pattern.replacement;
          if (result.startsWith('hex:')) {
            result = result.slice(4);
            // Replace $1 with hex-to-decimal conversion
            result = result.replace('$1', parseInt(match[1], 16).toString());
          } else {
            // Simple string replacement for other patterns
            for (let i = 0; i < match.length; i++) {
              result = result.replace(`$${i}`, match[i] || '');
            }
          }

          return result;
        }
      } catch (e) {
        // Continue to next pattern if regex is invalid
        continue;
      }
    }
    return null;
  }

  private detectFormat2(content: string): boolean {
    // Format 2 has individual goroutine entries with "goroutine N ["
    return /^goroutine \d+ \[/.test(content.trim());
  }

  private async parseFormat2(content: string, fileName: string): Promise<Result> {
    const lines = content.split('\n');
    const goroutineMap = new Map<string, boolean>(); // Track which goroutine IDs exist
    const createdMap = new Map<string, string[]>(); // Track which goroutine IDs were created
    const parsedGoroutines: Array<{ goroutine: Goroutine; trace: Frame[] }> = [];
    let extractedName: string | null = null;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Try to extract name from this line if we haven't found one yet
      if (!extractedName) {
        extractedName = this.extractNameFromLine(line);
      }

      if (!line.startsWith('goroutine ')) {
        i++;
        continue;
      }

      // Parse goroutine header: "goroutine 123 [running, 5 minutes]:"
      const match = line.match(
        /^goroutine (\d+) \[([^,\]]+)(?:,\s*(\d+(?:\.\d+)?)\s*minutes?)?\]:/
      );
      if (!match) {
        i++;
        continue;
      }

      const [, idStr, state, minutesStr] = match;
      const id = parseInt(idStr);
      if (isNaN(id)) {
        return { success: false, error: `Invalid goroutine ID: ${idStr} at line ${i + 1}` };
      }
      const waitMinutes = minutesStr ? parseFloat(minutesStr) : 0;
      if (minutesStr && isNaN(waitMinutes)) {
        return { success: false, error: `Invalid wait time: ${minutesStr}` };
      }

      // Parse stack trace
      i++;
      const trace: Frame[] = [];
      let creatorId = '';

      while (i < lines.length && lines[i].trim()) {
        const traceLine = lines[i].trim();

        // Try to extract name from this line if we haven't found one yet
        if (!extractedName) {
          extractedName = this.extractNameFromLine(traceLine);
        }

        if (traceLine.startsWith('created by ')) {
          // Parse creator info: "created by main.worker()"
          const creatorMatch = traceLine.match(/created by .+ in goroutine (\d+)/);
          creatorId = creatorMatch ? creatorMatch[1] : '';
          i++;
          break;
        }

        // Parse function call and location
        if (traceLine && !traceLine.startsWith('\t')) {
          // Separate function name from arguments like the old implementation
          const functionMatch = traceLine.match(/^(.+)(\(.*\))$/);
          let func: string;

          if (functionMatch) {
            // Elide function arguments - only store the function name, not the arguments
            func = functionMatch[1];
          } else {
            // No arguments found, use the full line
            func = traceLine;
          }

          i++;
          if (i < lines.length && lines[i].startsWith('\t')) {
            const locationLine = lines[i].trim();
            const locationMatch = locationLine.match(/^(.+?):(\d+)/);
            if (locationMatch) {
              const [, file, lineStr] = locationMatch;
              const lineNum = parseInt(lineStr);
              if (isNaN(lineNum)) {
                return { success: false, error: `Invalid line number: ${lineStr}` };
              }
              trace.push({ func, file, line: lineNum });
            }
          }
        }
        i++;
      }

      // Create goroutine record
      const goroutineId = String(id);
      const goroutine: Goroutine = {
        id: goroutineId,
        state,
        waitMinutes,
        creator: creatorId,
        creatorExists: false, // updated later.
        created: [], // updated later.
      };

      // Track this goroutine ID as existing
      goroutineMap.set(goroutineId, true);
      (createdMap.get(creatorId) ?? createdMap.set(creatorId, []).get(creatorId))!.push(
        goroutineId
      );

      // Store goroutine with its trace for grouping
      parsedGoroutines.push({ goroutine, trace });
    }

    // Group goroutines by stack trace fingerprint first, then by state
    const stackMap = new Map<string, { trace: Frame[]; goroutines: Goroutine[] }>();

    for (const { goroutine, trace } of parsedGoroutines) {
      const traceId = await fingerprint(trace);

      if (!stackMap.has(traceId)) {
        stackMap.set(traceId, { trace, goroutines: [] });
      }

      stackMap.get(traceId)!.goroutines.push(goroutine);
    }

    // Create final groups - group by state within each stack
    const groups: Group[] = [];
    for (const [traceId, { trace, goroutines }] of stackMap) {
      // Group goroutines by state within this stack trace
      const stateGroups = new Map<string, Goroutine[]>();

      for (const goroutine of goroutines) {
        if (!stateGroups.has(goroutine.state)) {
          stateGroups.set(goroutine.state, []);
        }
        stateGroups.get(goroutine.state)!.push(goroutine);
      }

      // Create a separate group for each state within this stack
      for (const [state, stateGoroutines] of stateGroups) {
        groups.push({
          traceId,
          count: stateGoroutines.length,
          labels: [`state=${state}`], // Synthesized state label
          goroutines: stateGoroutines,
          trace,
        });
      }
    }

    // Post-processing: Set creatorExists based on the goroutineMap
    groups.forEach(group =>
      group.goroutines.forEach(goroutine => {
        goroutine.creatorExists = goroutine.creator ? goroutineMap.has(goroutine.creator) : false;
        goroutine.created = createdMap.get(goroutine.id) ?? [];
      })
    );

    const result: File = { originalName: fileName, groups };
    if (extractedName) {
      result.extractedName = extractedName;
    }
    return { success: true, data: result };
  }

  private async parseFormat1(content: string, fileName: string): Promise<Result> {
    const lines = content.split('\n');
    const groups: Group[] = [];
    let totalGoroutines = 0;
    let extractedName: string | null = null;

    // Extract total from first line if present
    const firstLine = lines[0]?.trim();
    const totalMatch = firstLine?.match(/goroutine profile: total (\d+)/);
    if (totalMatch) {
      totalGoroutines = parseInt(totalMatch[1]);
      if (isNaN(totalGoroutines)) {
        return { success: false, error: `Invalid total goroutines: ${totalMatch[1]}` };
      }
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Try to extract name from this line if we haven't found one yet
      if (!extractedName) {
        extractedName = this.extractNameFromLine(line);
      }

      // Look for count line: "123 @ 0x..." (Format 1) or "123 goroutines in stack:" (alternative format)
      const countMatch = line.match(/^(\d+) @/) || line.match(/^(\d+) goroutines? in stack:/);
      if (!countMatch) {
        i++;
        continue;
      }

      const count = parseInt(countMatch[1]);
      if (isNaN(count)) {
        return { success: false, error: `Invalid goroutine count: ${countMatch[1]}` };
      }
      i++;

      // Parse labels (look for lines starting with # labels:)
      const labels: string[] = [];
      while (i < lines.length) {
        const labelLine = lines[i].trim();

        // Try to extract name from this line if we haven't found one yet
        if (!extractedName) {
          extractedName = this.extractNameFromLine(labelLine);
        }

        if (labelLine.startsWith('# labels:')) {
          // Extract JSON from line like: # labels: {"cluster":"main"}
          const labelsMatch = labelLine.match(/# labels:\s*({.*})/);
          if (labelsMatch) {
            try {
              const labelsObj = JSON.parse(labelsMatch[1]);
              labels.push(...Object.entries(labelsObj).map(([key, value]) => `${key}=${value}`));
            } catch (e) {
              return { success: false, error: `Failed to parse labels: ${labelsMatch[1]}` };
            }
          }
          i++;
          continue;
        }
        break;
      }

      // Parse stack trace (lines starting with #)
      const trace: Frame[] = [];
      while (i < lines.length) {
        const traceLine = lines[i].trim();

        // Try to extract name from this line if we haven't found one yet
        if (!extractedName) {
          extractedName = this.extractNameFromLine(traceLine);
        }

        if (!traceLine.startsWith('#') || traceLine === '#') break;

        // Parse trace line: "#\t0x4ee630\tsync.runtime_notifyListWait+0x150\tGOROOT/src/runtime/sema.go:597"
        const traceMatch = traceLine.match(/^#\s*0x[0-9a-f]+\s+([^\s]+)\s+(.+?):(\d+)/);
        if (traceMatch) {
          let [, func, file, lineStr] = traceMatch;

          // Remove address offset from function name (e.g., "func+0x150" -> "func")
          func = func.replace(/\+0x[0-9a-fA-F]+$/, '');

          const lineNum = parseInt(lineStr);
          if (isNaN(lineNum)) {
            return { success: false, error: `Invalid line number in trace: ${lineStr}` };
          }
          trace.push({ func, file, line: lineNum });
        }
        i++;
      }

      groups.push({ traceId: await fingerprint(trace), count, labels, goroutines: [], trace });
    }

    const result: File = { originalName: fileName, totalGoroutines, groups };
    if (extractedName) {
      result.extractedName = extractedName;
    }
    return { success: true, data: result };
  }
}
