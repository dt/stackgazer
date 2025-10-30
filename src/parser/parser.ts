/**
 * Core parser for Go stack trace files
 */

import { ParsedFile, Result, Group, Frame, Goroutine } from './types.js';
import { Profile } from 'pprof-format';

/**
 * Simple FNV-1a hash implementation as fallback when crypto.subtle is unavailable
 */
function fnvHash(str: string): string {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash *= 16777619; // FNV prime
    hash = hash >>> 0; // Convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Calculate a fingerprint from frames, using SHA-256 if available with FNV fallback.
 */
async function fingerprint(frames: Frame[]): Promise<string> {
  const traceString = frames.map(frame => `${frame.func} ${frame.file}:${frame.line}`).join('\n');

  // Fallback to FNV hash if crypto.subtle is unavailable. The simpler hash ends
  // up slower than the cryptographic hash as the latter is backed by native
  // and often hardware accelerated implementations.
  if (!globalThis.crypto?.subtle) {
    const hash = fnvHash(traceString);
    // Repeat to reach desired length
    const FINGERPRINT_LENGTH = 24;
    return (hash + hash + hash).slice(0, FINGERPRINT_LENGTH);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(traceString);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const FINGERPRINT_LENGTH = 24; // Use last 12 chars for compact but unique fingerprints
  return hashHex.slice(-FINGERPRINT_LENGTH);
}

interface ParserSettings {
  nameExtractionPatterns?: string[];
}

/**
 * File parser
 */
export class FileParser {
  private nameExtractionPatterns: string[];

  constructor(settings?: ParserSettings) {
    // Use provided patterns or empty array as fallback
    this.nameExtractionPatterns = settings?.nameExtractionPatterns || [];
  }

  /**
   * Parse a Blob or File (handles binary detection and decompression)
   */
  async parseFile(blob: Blob, fileName: string): Promise<Result> {
    // Read first 2 bytes to detect gzip magic bytes
    const chunk = await blob.slice(0, 2).arrayBuffer();
    const bytes = new Uint8Array(chunk);
    const isGzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

    // Use provided fileName or default
    let name = fileName || 'unknown';

    // If name is strictly digits, prepend 'n'
    if (/^\d+$/.test(name)) {
      name = 'n' + name;
    }

    if (isGzipped) {
      // Binary format0 - stream decompression
      return await this.parseFormat0(blob, name);
    } else {
      // Text format - read as text and dispatch
      const content = await blob.text();
      return this.parseString(content, name);
    }
  }

  /**
   * Parse string content (detects format1/2 and dispatches)
   */
  async parseString(content: string, fileName: string): Promise<Result> {
    // Handle empty content
    if (!content.trim()) {
      return { success: true, data: { originalName: fileName, groups: [] } };
    }

    if (this.detectFormat1(content)) {
      return await this.parseFormat1(content, fileName);
    } else {
      // Assume format 2, but validate it matches the expected pattern
      if (this.detectFormat2(content)) {
        return await this.parseFormat2(content, fileName);
      } else {
        // Return empty result for unrecognized content instead of error
        return { success: true, data: { originalName: fileName, groups: [] } };
      }
    }
  }

  /**
   * Extract name from a line using configured patterns
   */
  private extractNameFromLine(line: string): string | null {
    for (const patternStr of this.nameExtractionPatterns) {
      try {
        // Parse s|pattern|replacement| format
        if (!patternStr.startsWith('s|')) continue;
        
        const parts = patternStr.slice(2).split('|');
        if (parts.length < 2) continue;
        
        const regexPattern = parts[0];
        const replacement = parts[1];
        
        const regex = new RegExp(regexPattern);
        const match = line.match(regex);
        if (match) {
          // Apply replacement template (e.g., "n$1" becomes "n" + first capture group)
          let result = replacement;
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

  private detectFormat1(content: string): boolean {
    // Format 1 starts with "goroutine profile:" header - check first 18 characters
    return content.startsWith('goroutine profile:');
  }

  private detectFormat2(content: string): boolean {
    // Format 2 has individual goroutine entries with either:
    // 1. Standard format: "goroutine N [state]:"
    // 2. Runtime internal format: "goroutine N gp=0x... m=... mp=0x... [state]:"
    const trimmed = content.trim();
    return /^goroutine \d+ (\[|gp=)/.test(trimmed) || /\ngoroutine \d+ (\[|gp=)/.test(content);
  }

  /**
   * Extract goroutine metadata from go::goroutine* labels (debug=3 format)
   * Returns null if this is not a debug=3 sample (no go::goroutine label)
   */
  private extractGoroutineFromLabels(labels: string[]): { goroutine: Goroutine; filteredLabels: string[] } | null {
    let goroutineId: string | null = null;
    let creatorId = '';
    let state = '';
    let waitMinutes = 0;
    const filteredLabels: string[] = [];

    for (const label of labels) {
      const [key, value] = label.split('=', 2);

      switch (key) {
        case 'go::goroutine':
          goroutineId = value;
          break;
        case 'go::goroutine_created_by':
          creatorId = value;
          break;
        case 'go::goroutine_state':
          state = value;
          break;
        case 'go::goroutine_wait_minutes':
          waitMinutes = parseFloat(value) || 0;
          break;
        default:
          // Keep all other labels
          filteredLabels.push(label);
          break;
      }
    }

    // If no go::goroutine label found, this is not debug=3
    if (goroutineId === null) {
      return null;
    }

    // Transform state like format2 does
    const transformedState = this.transformState(state);

    const goroutine: Goroutine = {
      id: goroutineId,
      state: transformedState,
      waitMinutes,
      creator: creatorId,
      creatorExists: false, // Will be set during post-processing
      created: [], // Will be set during post-processing
    };

    return { goroutine, filteredLabels };
  }

  private async parseFormat0(blob: Blob, fileName: string): Promise<Result> {
    try {
      // Stream decompression - much cleaner!
      const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      const response = new Response(decompressedStream);
      const arrayBuffer = await response.arrayBuffer();
      const decodedData = new Uint8Array(arrayBuffer);

      // Decode the pprof profile
      const profile = Profile.decode(decodedData);

      // Convert pprof data to our internal format
      const groups: Group[] = [];
      // For debug=3 format, collect samples for regrouping
      const debug3Samples: Array<{ traceId: string; trace: Frame[]; goroutine: Goroutine; labels: string[] }> = [];

      // Process samples - each sample represents a stack trace with count
      for (const sample of profile.sample) {
        const frames: Frame[] = [];
        const values = sample.value || [];
        const count = values.length > 0 ? Number(values[0]) : 1;

        // Extract labels from the sample
        const labels: string[] = [];
        const stringTable = (profile.stringTable as any)?.strings || [];

        if (sample.label) {
          for (const label of sample.label) {
            const key = stringTable[Number(label.key) || 0] || '';
            // Check for numeric value first, then fall back to string value
            let value: string;
            if (label.num !== undefined && label.num !== 0) {
              value = String(Number(label.num));
            } else {
              value = stringTable[Number(label.str) || 0] || '';
            }
            if (key && value) {
              labels.push(`${key}=${value}`);
            } else if (key) {
              labels.push(key);
            }
          }
        }

        // Build stack trace from location IDs, skipping initial runtime frames
        let skipInitialRuntimeFrames = true;
        let lastSkippedRuntimeFrame: string | null = null;

        for (const locationId of sample.locationId || []) {
          const location = profile.location.find(loc => loc.id === locationId);
          if (location) {
            for (const line of location.line || []) {
              const func = profile.function.find(f => f.id === line.functionId);
              if (func) {
                // String table access - the pprof format uses string table indexes
                const functionName = stringTable[Number(func.name) || 0] || 'unknown';
                const fileName = stringTable[Number(func.filename) || 0] || 'unknown';

                // Skip initial runtime frames during parsing, but track the last one for label synthesis
                if (skipInitialRuntimeFrames && this.shouldSkipRuntimeFrame(functionName)) {
                  lastSkippedRuntimeFrame = functionName;
                  continue; // Skip this frame, don't allocate it
                }

                // Once we find a non-runtime frame, stop skipping
                skipInitialRuntimeFrames = false;

                frames.push({
                  func: functionName,
                  file: fileName,
                  line: Number(line.line) || 0,
                });
              }
            }
          }
        }

        // Check if this is debug=3 format (has go::goroutine labels)
        if (frames.length > 0) {
          const traceId = await fingerprint(frames);

          // Check for debug=3 first before synthesizing labels
          const isDebug3 = labels.some(l => l.startsWith('go::goroutine='));

          // Add synthesized label for the last skipped runtime frame
          // Only do this for non-debug=3 profiles (debug=0/debug=1)
          if (!isDebug3) {
            if (lastSkippedRuntimeFrame) {
              const label = this.synthesizeRuntimeLabel(lastSkippedRuntimeFrame);
              if (label) {
                labels.push(label);
              }
            } else if (frames[0] && this.isSyscallFrame(frames[0].func)) {
              // If first frame is a syscall (not skipped), synthesize syscall state
              labels.push('state=syscall');
            }
          }

          const goroutineData = this.extractGoroutineFromLabels(labels);

          if (goroutineData) {
            // Debug=3: Collect for regrouping
            debug3Samples.push({
              traceId,
              trace: frames,
              goroutine: goroutineData.goroutine,
              labels: goroutineData.filteredLabels,
            });
          } else {
            // Debug=0: Create group immediately with original behavior
            groups.push({
              traceId,
              count,
              labels,
              goroutines: [],
              trace: frames,
            });
          }
        }
      }

      // Regroup debug=3 samples by (traceId, state, labels)
      if (debug3Samples.length > 0) {
        const regroupMap = new Map<string, { trace: Frame[]; goroutines: Goroutine[]; labels: string[] }>();
        const goroutineMap = new Map<string, boolean>();
        const createdMap = new Map<string, string[]>();

        // First pass: build maps for creator relationships
        for (const sample of debug3Samples) {
          goroutineMap.set(sample.goroutine.id, true);
          const creatorId = sample.goroutine.creator;
          if (creatorId) {
            (createdMap.get(creatorId) ?? createdMap.set(creatorId, []).get(creatorId))!.push(
              sample.goroutine.id
            );
          }
        }

        // Second pass: regroup by stack+state+labels
        for (const sample of debug3Samples) {
          // Create grouping key from traceId, state, and sorted labels
          const labelKey = sample.labels.slice().sort().join(',');
          const groupKey = `${sample.traceId}:${sample.goroutine.state}:${labelKey}`;

          if (!regroupMap.has(groupKey)) {
            regroupMap.set(groupKey, {
              trace: sample.trace,
              goroutines: [],
              labels: [`state=${sample.goroutine.state}`, ...sample.labels],
            });
          }

          regroupMap.get(groupKey)!.goroutines.push(sample.goroutine);
        }

        // Convert regrouped data to Groups
        for (const [groupKey, data] of regroupMap) {
          const traceId = groupKey.split(':')[0];
          groups.push({
            traceId,
            count: data.goroutines.length,
            labels: data.labels,
            goroutines: data.goroutines,
            trace: data.trace,
          });
        }

        // Post-processing: Set creatorExists and created fields
        groups.forEach(group =>
          group.goroutines.forEach(goroutine => {
            goroutine.creatorExists = goroutine.creator ? goroutineMap.has(goroutine.creator) : false;
            goroutine.created = createdMap.get(goroutine.id) ?? [];
          })
        );
      }

      // Try to extract a custom name from labels
      let extractedName: string | null = null;
      for (const group of groups) {
        for (const label of group.labels) {
          const name = this.extractNameFromLine(label);
          if (name) {
            extractedName = name;
            break;
          }
        }
        if (extractedName) break;
      }

      const result: ParsedFile = { 
        originalName: extractedName || fileName, 
        groups 
      };
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse pprof format: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async parseFormat2(content: string, fileName: string): Promise<Result> {
    const lines = content.split('\n');
    const goroutineMap = new Map<string, boolean>(); // Track which goroutine IDs exist
    const createdMap = new Map<string, string[]>(); // Track which goroutine IDs were created
    const parsedGoroutines: Array<{ goroutine: Goroutine; trace: Frame[]; labels: string[] }> = [];
    let extractedName: string | null = null;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Try to extract name from this line if we haven't found one yet
      if (!extractedName) {
        extractedName = this.extractNameFromLine(line);
      }

      // Skip non-goroutine lines (handles test log preamble)
      if (!line.startsWith('goroutine ')) {
        i++;
        continue;
      }

      // Parse goroutine header - two possible formats:
      // 1. Standard: "goroutine 123 [running, 5 minutes]:"
      // 2. Runtime internal: "goroutine 123 gp=0x... m=... mp=0x... [running]:"

      // First try standard format
      let match = line.match(
        /^goroutine (\d+) \[([^\]]+)\]:/
      );

      // If standard format doesn't match, try runtime internal format
      // This format has gp=, m=, mp= fields that can have various values (hex, decimal, nil)
      if (!match) {
        match = line.match(
          /^goroutine (\d+) gp=\S+ m=\S+(?:\s+mp=\S+)? \[([^\]]+)\]:/
        );
      }

      if (!match) {
        i++;
        continue;
      }

      const [, idStr, fullStateStr] = match;
      const id = parseInt(idStr);

      // Parse the state string which can be:
      // - "running"
      // - "select, 7 minutes"
      // - "select, 7 minutes, locked to thread"
      // - "GC worker (idle)"
      // - "GC worker (idle), 5 minutes"
      // - "sync.Cond.Wait, 12 minutes, bubble, \"app\":\"myapp\", \"env\":\"prod,staging\""

      // First split on comma, then recombine quoted strings that contain commas
      const rawParts = fullStateStr.split(',').map(s => s.trim());
      const parts: string[] = [];
      let i_part = 0;
      while (i_part < rawParts.length) {
        let part = rawParts[i_part];
        // Check if this starts with a quote but doesn't end with one
        if (part.startsWith('"') && !part.endsWith('"')) {
          // Recombine with subsequent parts until we find the closing quote
          while (i_part + 1 < rawParts.length) {
            i_part++;
            part += ',' + rawParts[i_part];
            if (rawParts[i_part].endsWith('"')) break;
          }
        }
        parts.push(part);
        i_part++;
      }

      const state = parts[0]; // First part is always the state

      // Look for wait time, quoted labels, and other attributes in the remaining parts
      let waitMinutes = 0;
      const additionalLabels: string[] = [];

      for (let j = 1; j < parts.length; j++) {
        const part = parts[j];

        // Check for quoted label pattern: "key":"value"
        const quotedLabelMatch = part.match(/^"([^"]+)":"([^"]+)"$/);
        if (quotedLabelMatch) {
          const [, key, value] = quotedLabelMatch;
          additionalLabels.push(`${key}=${value}`);
          continue;
        }

        // Check for time pattern
        const timeMatch = part.match(/^(\d+(?:\.\d+)?)\s*minutes?$/);
        if (timeMatch) {
          waitMinutes = parseFloat(timeMatch[1]);
        } else if (part) {
          // Any other non-time attribute becomes a label (flags like "bubble", "locked to thread")
          additionalLabels.push(part);
        }
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
              trace.push({ func, file, line: lineNum });
            }
          }
        }
        i++;
      }

      // Transform common sync states to simpler names
      const transformedState = this.transformState(state);

      // Create goroutine record
      const goroutineId = String(id);
      const goroutine: Goroutine = {
        id: goroutineId,
        state: transformedState,
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

      // Store goroutine with its trace and any additional labels for grouping
      parsedGoroutines.push({ goroutine, trace, labels: additionalLabels });
    }

    // Group goroutines by (stack trace, state, labels)
    const groupMap = new Map<string, { trace: Frame[]; goroutines: Goroutine[]; labels: string[] }>();

    for (const { goroutine, trace, labels } of parsedGoroutines) {
      const traceId = await fingerprint(trace);

      // Create grouping key from traceId, state, and sorted labels
      const labelKey = labels.slice().sort().join(',');
      const groupKey = `${traceId}:${goroutine.state}:${labelKey}`;

      if (!groupMap.has(groupKey)) {
        // Combine state label with any additional labels
        const groupLabels = [`state=${goroutine.state}`];
        groupLabels.push(...labels);

        groupMap.set(groupKey, {
          trace,
          goroutines: [],
          labels: groupLabels,
        });
      }

      groupMap.get(groupKey)!.goroutines.push(goroutine);
    }

    // Create final groups from the grouped goroutines
    const groups: Group[] = [];
    for (const [groupKey, { trace, goroutines, labels }] of groupMap) {
      const traceId = groupKey.split(':')[0];

      groups.push({
        traceId,
        count: goroutines.length,
        labels,
        goroutines,
        trace,
      });
    }

    // Post-processing: Set creatorExists based on the goroutineMap
    groups.forEach(group =>
      group.goroutines.forEach(goroutine => {
        goroutine.creatorExists = goroutine.creator ? goroutineMap.has(goroutine.creator) : false;
        goroutine.created = createdMap.get(goroutine.id) ?? [];
      })
    );

    const result: ParsedFile = { originalName: fileName, groups };
    if (extractedName) {
      // If extracted name is strictly digits, prepend 'n'
      result.extractedName = /^\d+$/.test(extractedName) ? 'n' + extractedName : extractedName;
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
          trace.push({ func, file, line: lineNum });
        }
        i++;
      }

      groups.push({ traceId: await fingerprint(trace), count, labels, goroutines: [], trace });
    }

    const result: ParsedFile = { originalName: fileName, totalGoroutines, groups };
    if (extractedName) {
      // If extracted name is strictly digits, prepend 'n'
      result.extractedName = /^\d+$/.test(extractedName) ? 'n' + extractedName : extractedName;
    }
    return { success: true, data: result };
  }

  /**
   * Transform common sync states to simpler, more readable names
   */
  private transformState(state: string): string {
    // Transform sync.WaitGroup.Wait and sync.Cond.Wait to just 'wait'
    if (state === 'sync.WaitGroup.Wait' || state === 'sync.Cond.Wait') {
      return 'wait';
    }

    // Transform sync.Mutex.Lock to 'semacquire'
    if (state === 'sync.Mutex.Lock') {
      return 'semacquire';
    }

    return state;
  }

  /**
   * Determine if a runtime frame should be skipped
   */
  private shouldSkipRuntimeFrame(functionName: string): boolean {
    return (
      functionName === 'runtime.gopark' ||
      functionName === 'runtime.goparkunlock' ||
      functionName === 'runtime.selectgo' ||
      functionName === 'runtime.chanrecv' ||
      functionName === 'runtime.chanrecv1' ||
      functionName === 'runtime.chanrecv2' ||
      functionName === 'runtime.chansend' ||
      functionName === 'runtime.semacquire' ||
      functionName === 'runtime.semacquire1' ||
      functionName === 'runtime.netpollblock' ||
      functionName === 'runtime.notetsleepg' ||
      functionName === 'runtime.sigNoteSleep'
    );
  }

  /**
   * Check if a function is a syscall frame that should generate a state label
   */
  private isSyscallFrame(functionName: string): boolean {
    return (
      functionName === 'syscall.syscall6' ||
      functionName === 'syscall.Syscall' ||
      functionName === 'syscall.Syscall6' ||
      functionName === 'syscall.RawSyscall' ||
      functionName === 'syscall.RawSyscall6'
    );
  }

  /**
   * Synthesize a descriptive label for a skipped runtime frame
   */
  private synthesizeRuntimeLabel(functionName: string): string | null {
    switch (functionName) {
      case 'runtime.chanrecv':
      case 'runtime.chanrecv1':
      case 'runtime.chanrecv2':
        return 'state=chan receive';
      case 'runtime.chansend':
        return 'state=chan send';
      case 'runtime.selectgo':
        return 'state=select';
      case 'runtime.gopark':
      case 'runtime.goparkunlock':
        return 'state=parked';
      case 'runtime.semacquire':
      case 'runtime.semacquire1':
        return 'state=semacquire';
      case 'runtime.netpollblock':
        return 'state=netpoll';
      case 'runtime.notetsleepg':
        return 'state=sleep';
      case 'runtime.sigNoteSleep':
        return 'state=signal';
      default:
        return null;
    }
  }
}
