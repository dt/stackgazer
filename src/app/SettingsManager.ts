/**
 * Manages application settings with localStorage persistence
 */

import type { TitleRule, CategoryRule } from './naming.js';

export const DEFAULT_SETTINGS: AppSettings = {
  // Parsing options
  functionTrimPrefixes: [],
  fileTrimPrefixes: [],
  // Category rules
  categorySkipRules: [
    // Skip basic Go utilities that launch goroutines.
    'runtime.goexit',
    'sync.',
    'internal/',
    'golang.org/x/sync/errgroup',
    // Skip gRPC infra to find the server it is actually starting.
    'google.golang.org/grpc',
  ],
  categoryMatchRules: ['s|^((([^\/.\\[]*\\.[^\/\\[]*)*\/)?[^\/\\.\\[]+(\/[^\/.\\[]+)?)|$1|'],
  // Title manipulation rules
  nameSkipRules: [
    // Skip common low-level runtime frames.
    'runtime.gopark',
    'runtime.selectgo',
    'sync.runtime_notifyListWait',
    'sync.runtime_Semacquire',
    'golang.org/x/sync/errgroup.(*Group).Wait',
  ],
  nameTrimRules: [
    's|\\[[^\\]]*\\]||',
    's|\\.func\\d+(\\.\\d+)?$||',
    'util/',
    's|^server.\\(\\*Node\\).Batch$|batch|',
  ],
  nameFoldRules: [
    's|sync.(*Cond).Wait,|condwait|',
    's|sync.(*WaitGroup).Wait,|waitgroup|',
    's|net/http,stdlib|net/http|',
    's|syscall.Syscall,stdlib|syscall|',
    's|internal/poll.runtime_pollWait,stdlib|netpoll|',
    's|google.golang.org/grpc/internal/transport.(*Stream).waitOnHeader,google.golang.org/grpc|grpc|',
    's|google.golang.org/grpc/internal/transport.(*recvBufferReader).read,(google.golang.org/grpc.*|io.Read)|recv|',
  ],
  nameFindRules: [],

  // Zip file handling
  zipFilePatterns: ['^(.*\/)?stacks\.txt$'] ,

  // Name extraction patterns
  nameExtractionPatterns: [],
};

// Generic override for persistence
export interface Override {
  ignoreDefault?: boolean;  // undefined = false = use defaults
  custom?: string[];              // undefined = [] for arrays
}

// What gets stored in localStorage
export interface StoredSettings {
  // Simple overrides
  functionTrimPrefixes?: Override;
  fileTrimPrefixes?: Override;
  zipFilePatterns?: Override;

  // Rule overrides
  categorySkipRules?: Override;
  categoryMatchRules?: Override;
  nameSkipRules?: Override;
  nameTrimRules?: Override;
  nameFoldRules?: Override;
  nameFindRules?: Override;
  nameExtractionPatterns?: Override;
}

// Resolved settings interface (clean, no override fields)
export interface AppSettings {
  // Parsing options
  functionTrimPrefixes: string[];
  fileTrimPrefixes: string[];

  // Resolved rule arrays
  categorySkipRules: string[];
  categoryMatchRules: string[];
  nameSkipRules: string[];
  nameTrimRules: string[];
  nameFoldRules: string[];
  nameFindRules: string[];

  // Name extraction patterns
  nameExtractionPatterns: string[];

  // Zip file handling
  zipFilePatterns: string[];
}

function resolveOverride(defaults: string[], override?: Override): string[] {
  const result: string[] = [];
  if (!override?.ignoreDefault) {
    result.push(...defaults);
  }
  // Add custom rules
  if (override?.custom) {
    result.push(...override.custom);
  }
  return result;
}

function resolveSettings(defaults: AppSettings, stored: StoredSettings): AppSettings {
  return {
    // Simple fields - stored overrides default
    functionTrimPrefixes: resolveOverride(defaults.functionTrimPrefixes, stored.functionTrimPrefixes),
    fileTrimPrefixes: resolveOverride(defaults.fileTrimPrefixes, stored.fileTrimPrefixes),
    zipFilePatterns: resolveOverride(defaults.zipFilePatterns, stored.zipFilePatterns),

    // Rule arrays - resolve override pattern
    categorySkipRules: resolveOverride(defaults.categorySkipRules, stored.categorySkipRules),
    categoryMatchRules: resolveOverride(defaults.categoryMatchRules, stored.categoryMatchRules),
    nameSkipRules: resolveOverride(defaults.nameSkipRules, stored.nameSkipRules),
    nameTrimRules: resolveOverride(defaults.nameTrimRules, stored.nameTrimRules),
    nameFoldRules: resolveOverride(defaults.nameFoldRules, stored.nameFoldRules),
    nameFindRules: resolveOverride(defaults.nameFindRules, stored.nameFindRules),
    nameExtractionPatterns: resolveOverride(defaults.nameExtractionPatterns, stored.nameExtractionPatterns),
  };
}

export class SettingsManager {
  private static readonly STORAGE_KEY = 'stackgazer-settings';
  private settings: AppSettings;
  private storedSettings: StoredSettings = {};
  private changeCallback: ((settings: AppSettings) => void) | null = null;
  private defaultSettings: AppSettings;

  constructor(customizer?: (settings: AppSettings) => AppSettings, skipLoad?: boolean) {
    const builtinDefaults = this.getBuiltinDefaults();
    const customizedDefaults = customizer ? customizer(builtinDefaults) : builtinDefaults;

    // Validate that customizer didn't break our types
    this.validateAppSettings(customizedDefaults, 'customizer');

    this.defaultSettings = customizedDefaults;
    this.settings = { ...this.defaultSettings };
    if (!skipLoad) {
      this.loadSettings();
    }
  }

  /**
   * Get built-in default settings values
   */
  private getBuiltinDefaults(): AppSettings {
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Validate AppSettings object has correct types by comparing against builtin defaults
   */
  private validateAppSettings(settings: any, source: string): void {
    if (!settings || typeof settings !== 'object') {
      throw new Error(`${source} must return an object, got ${typeof settings}`);
    }

    const builtinDefaults = this.getBuiltinDefaults();

    // Check each field that exists in the settings
    for (const key in settings) {
      if (!(key in builtinDefaults)) {
        continue; // Allow extra fields
      }

      const expectedValue = (builtinDefaults as any)[key];
      const actualValue = settings[key];
      if (!this.typesMatch(expectedValue, actualValue)) {
        const expectedType = this.getTypeDescription(expectedValue);
        const actualType = this.getTypeDescription(actualValue);
        let helpText = '';
        if (expectedType.includes('[]') && actualType === 'string') {
          helpText = ` If you're migrating from the old string format, convert "rule1\\nrule2" to ["rule1", "rule2"]`;
        }
        throw new Error(
          `${source}: '${key}' must be ${expectedType}, got ${actualType}${helpText}`
        );
      }

      // Additional validation for string arrays
      if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
        if (expectedValue.length > 0 && typeof expectedValue[0] === 'string') {
          if (!actualValue.every(item => typeof item === 'string')) {
            throw new Error(`${source}: '${key}' must be string[], but contains non-string items`);
          }
        }
      }
    }
  }

  /**
   * Check if two values have compatible types
   */
  private typesMatch(expected: any, actual: any): boolean {
    // Handle null/undefined
    if (expected === null || expected === undefined) {
      return actual === null || actual === undefined;
    }

    // Both must be arrays or both must not be arrays
    if (Array.isArray(expected) !== Array.isArray(actual)) {
      return false;
    }

    // If arrays, check element types
    if (Array.isArray(expected) && Array.isArray(actual)) {
      // Empty arrays are compatible with any array
      if (expected.length === 0 || actual.length === 0) {
        return true;
      }
      // Check if all elements have compatible types
      const expectedElementType = typeof expected[0];
      return actual.every(item => typeof item === expectedElementType);
    }

    // For objects, do a basic structure check
    if (typeof expected === 'object' && typeof actual === 'object') {
      return true; // Basic compatibility for now
    }

    // For primitives, check exact type match
    return typeof expected === typeof actual;
  }

  /**
   * Get a type description for validation error messages
   */
  private getTypeDescription(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      if (value.length === 0) return 'array (empty)';
      const firstType = typeof value[0];
      if (value.every(item => typeof item === firstType)) {
        return `${firstType}[]`;
      }
      return 'mixed[]';
    }
    return typeof value;
  }


  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    try {
      const saved = localStorage.getItem(SettingsManager.STORAGE_KEY);
      if (saved) {
        this.storedSettings = JSON.parse(saved);
      } else {
        this.storedSettings = {};
      }
      this.settings = resolveSettings(this.defaultSettings, this.storedSettings);
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
      this.storedSettings = {};
      this.settings = { ...this.defaultSettings };
    }
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(SettingsManager.STORAGE_KEY, JSON.stringify(this.storedSettings));
    } catch (error) {
      console.warn('Failed to save settings to localStorage:', error);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSetting(key: keyof StoredSettings, override: Override): void {
    // Only store if we have an override: ignoreDefault=true OR custom has values
    if (override.ignoreDefault || (override.custom && override.custom.length > 0)) {
      this.storedSettings[key] = override;
    } else {
      // No override needed - using defaults with no custom rules
      delete this.storedSettings[key];
    }
        
    this.settings = resolveSettings(this.defaultSettings, this.storedSettings);
    this.saveSettings();
    this.notifyChange();
  }

  /**
   * Get current stored settings
   */
  getStoredSettings(): StoredSettings {
    return { ...this.storedSettings };
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    this.storedSettings = {};
    this.settings = { ...this.defaultSettings };
    localStorage.removeItem(SettingsManager.STORAGE_KEY);
    this.notifyChange();
  }

  /**
   * Set callback for when settings change
   */
  onChange(callback: (settings: AppSettings) => void): void {
    this.changeCallback = callback;
  }

  /**
   * Notify callback of settings change
   */
  private notifyChange(): void {
    if (this.changeCallback) {
      this.changeCallback(this.getSettings());
    }
  }

  /**
   * Import settings from JSON string
   */
  importSettings(jsonString: string): boolean {
    try {
      const imported = JSON.parse(jsonString);

      // Validate that imported data has expected shape
      const defaults = this.defaultSettings;
      const validKeys = Object.keys(defaults);
      const importedKeys = Object.keys(imported);

      // Check if all imported keys are valid
      for (const key of importedKeys) {
        if (!validKeys.includes(key)) {
          throw new Error(`Unknown setting: ${key}`);
        }
      }

      // Merge with defaults
      this.settings = { ...defaults, ...imported };
      this.saveSettings();
      this.notifyChange();

      return true;
    } catch (error) {
      console.error('Failed to import settings:', error);
      return false;
    }
  }

  /**
   * Get parsed function trim prefixes as compiled regexes
   */
  getFunctionTrimPrefixes(): RegExp[] {
    return this.parseRegexPrefixes(this.settings.functionTrimPrefixes);
  }

  getZipFilePatterns(): RegExp[] {
    return this.parseRegexPrefixes(this.settings.zipFilePatterns);
  }

  /**
   * Get parsed file trim prefixes as compiled regexes
   */
  getFileTrimPrefixes(): RegExp[] {
    return this.parseRegexPrefixes(this.settings.fileTrimPrefixes);
  }

  /**
   * Get category skip rules as array of strings
   */
  getCategorySkipRules(): string[] {
    return this.settings.categorySkipRules.map(rule => rule.trim()).filter(rule => rule.length > 0);
  }

  /**
   * Parse text-based category rules into CategoryRule objects
   */
  getCategoryRules(): CategoryRule[] {
    const rules: CategoryRule[] = [];

    // Add skip rules
    const skipRules = this.getCategorySkipRules();
    for (const rule of skipRules) {
      rules.push({ skip: rule });
    }

    // Add match rules
    const matchLines = this.settings.categoryMatchRules
      .map(line => line.trim())
      .filter(line => line.length > 0);

    for (const line of matchLines) {
      if (line.startsWith('s|')) {
        // Parse s|pattern|replacement| format and convert to match rule
        const match = line.match(/^s\|([^|]+)\|([^|]*)\|$/);
        if (match) {
          const [, pattern] = match;
          rules.push({ match: pattern });
        }
      } else {
        rules.push({ match: line });
      }
    }

    return rules;
  }

  /**
   * Parse comma-separated regex patterns into compiled RegExp objects
   */
  parseRegexPrefixes(prefixArray: string[]): RegExp[] {
    if (!prefixArray || !Array.isArray(prefixArray)) {
      return [];
    }

    return prefixArray
      .map(pattern => pattern.trim())
      .filter(pattern => pattern.length > 0)
      .map(pattern => {
        try {
          // If pattern doesn't start with ^, add it to anchor to beginning
          const anchoredPattern = pattern.startsWith('^') ? pattern : `^${pattern}`;
          return new RegExp(anchoredPattern);
        } catch (e) {
          console.warn(`Invalid regex pattern "${pattern}":`, e);
          // Fallback to literal string matching
          const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`^${escapedPattern}`);
        }
      });
  }

  /**
   * Parse text-based rule lines into TitleRule objects
   */
  parseTextRules(ruleArray: string[], ruleType: 'skip' | 'trim' | 'fold' | 'find'): TitleRule[] {
    if (!ruleArray || !Array.isArray(ruleArray)) {
      return [];
    }

    const lines = ruleArray.map(line => line.trim()).filter(line => line.length > 0);

    const rules: TitleRule[] = [];

    for (const line of lines) {
      if (line.startsWith('s|')) {
        // Parse s|pattern,while|replacement| format - handle pipe chars in pattern/while
        const match = line.match(/^s\|(.*)\|([^|]*)\|$/);
        if (match) {
          const [, patternPart, replacement] = match;
          const parts = patternPart.split(',');
          const pattern = parts[0];
          const whilePattern = parts[1] || undefined;

          if (ruleType === 'fold') {
            rules.push({ fold: pattern, to: replacement, while: whilePattern });
          } else if (ruleType === 'find') {
            rules.push({ find: pattern, to: replacement, while: whilePattern });
          } else if (ruleType === 'trim') {
            // For trim rules in s|pattern|replacement| format, we need to handle them differently
            // Store the full line for processing later in the trim logic
            rules.push({ trim: line });
          }
        }
      } else {
        // Simple prefix format
        if (ruleType === 'skip') {
          rules.push({ skip: line });
        } else if (ruleType === 'trim') {
          rules.push({ trim: line });
        }
      }
    }

    return rules;
  }

  /**
   * Get all title manipulation rules combined from text-based settings
   */
  getTitleManipulationRules(): TitleRule[] {
    const rules: TitleRule[] = [];

    // Add skip rules
    rules.push(...this.parseTextRules(this.settings.nameSkipRules, 'skip'));

    // Add trim rules
    rules.push(...this.parseTextRules(this.settings.nameTrimRules, 'trim'));

    // Add fold rules
    rules.push(...this.parseTextRules(this.settings.nameFoldRules, 'fold'));

    // Add find rules
    rules.push(...this.parseTextRules(this.settings.nameFindRules, 'find'));

    return rules;
  }

  /**
   * Get zip file pattern as regex
   */
  getZipFilePatternRegex(): RegExp[] {
    const patterns = this.settings.zipFilePatterns;
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
      // Default pattern for stacks.txt files
      return [/^(.*\/)?stacks\.txt$/];
    }

    return patterns.map(pattern => {
      try {
        return new RegExp(pattern);
      } catch (e) {
        console.warn(`Invalid zip file pattern regex "${pattern}":`, e);
        // Fallback to default pattern
        return /^(.*\/)?stacks\.txt$/;
      }
    });
  }

  /**
   * Get default settings
   */
  getDefaults(): AppSettings {
    return { ...this.defaultSettings };
  }

}
