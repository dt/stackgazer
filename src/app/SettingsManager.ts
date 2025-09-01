/**
 * Manages application settings with localStorage persistence
 */

import type { TitleRule, CategoryRule } from './ProfileCollection.js';
import type { NameExtractionPattern } from './types.js';


export const DEFAULT_SETTINGS: AppSettings = {
  // Parsing options
  functionTrimPrefixes: [],
  fileTrimPrefixes: [],
  // Category rules
  categorySkipRules: [
    // Skip basic Go utilities that launch goroutines.
    'sync.', 'internal/', 'golang.org/x/sync/errgroup',
    // Skip gRPC infra to find the server it is actually starting.
    'google.golang.org/grpc',
  ],
  categoryMatchRules: [
    's|^((([^\/.\\[]*\\.[^\/\\[]*)*\/)?[^\/\\.\\[]+(\/[^\/.\\[]+)?)|$1|'
  ],
  // Title manipulation rules
  nameSkipRules: [
    // Skip common low-level runtime frames.
    'sync.runtime_notifyListWait', 'sync.runtime_Semacquire', 
    'golang.org/x/sync/errgroup.(*Group).Wait',
  ],
  nameTrimRules: [
    's|\\[[^\\]]*\\]||',
    's|\\.func\\d+(\\.\\d+)?$||',
    'util/',
    's|^server.\\(\\*Node\\).Batch$|batch|'
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

  useDefaultCategorySkipRules: true,
  customCategorySkipRules: [],
  useDefaultCategoryMatchRules: true,
  customCategoryMatchRules: [],
  useDefaultNameSkipRules: true,
  customNameSkipRules: [],
  useDefaultNameTrimRules: true,
  customNameTrimRules: [],
  useDefaultNameFoldRules: true,
  customNameFoldRules: [],
  useDefaultNameFindRules: true,
  customNameFindRules: [],

  // Zip file handling
  zipFilePattern: '^(.*\/)?stacks\.txt$',

  // Name extraction patterns
  nameExtractionPatterns: [],
};

export interface AppSettings {
  // Parsing options
  functionTrimPrefixes: string[];
  fileTrimPrefixes: string[];

  // Text-based rule format - legacy (for backward compatibility)
  categorySkipRules: string[];
  categoryMatchRules: string[];
  nameSkipRules: string[];
  nameTrimRules: string[];
  nameFoldRules: string[];
  nameFindRules: string[];

  // New custom/default rule system
  useDefaultCategorySkipRules: boolean;
  customCategorySkipRules: string[];
  useDefaultCategoryMatchRules: boolean;
  customCategoryMatchRules: string[];
  useDefaultNameSkipRules: boolean;
  customNameSkipRules: string[];
  useDefaultNameTrimRules: boolean;
  customNameTrimRules: string[];
  useDefaultNameFoldRules: boolean;
  customNameFoldRules: string[];
  useDefaultNameFindRules: boolean;
  customNameFindRules: string[];

  // Name extraction patterns (still used by FileParser)
  nameExtractionPatterns: NameExtractionPattern[];

  // Zip file handling
  zipFilePattern: string;
}

export class SettingsManager {
  private static readonly STORAGE_KEY = 'stackgazer-settings';
  private settings: AppSettings;
  private changeCallback: ((settings: AppSettings) => void) | null = null;
  private defaultSettings: AppSettings;

  constructor(customizer?: (settings: AppSettings) => AppSettings) {
    const builtinDefaults = this.getBuiltinDefaults();
    const customizedDefaults = customizer ? customizer(builtinDefaults) : builtinDefaults;
    
    // Validate that customizer didn't break our types
    this.validateAppSettings(customizedDefaults, 'customizer');
    
    this.defaultSettings = customizedDefaults;
    this.settings = { ...this.defaultSettings };
    this.loadSettings();
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
        throw new Error(`${source}: '${key}' must be ${expectedType}, got ${actualType}${helpText}`);
      }

      // Additional validation for string arrays
      if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
        if (expectedValue.length > 0 && typeof expectedValue[0] === 'string') {
          if (!actualValue.every(item => typeof item === 'string')) {
            throw new Error(`${source}: '${key}' must be string[], but contains non-string items`);
          }
        }
      }

      // Additional validation for nameExtractionPatterns
      if (key === 'nameExtractionPatterns' && Array.isArray(actualValue)) {
        actualValue.forEach((pattern: any, index: number) => {
          if (!pattern || typeof pattern !== 'object' || typeof pattern.regex !== 'string' || typeof pattern.replacement !== 'string') {
            throw new Error(`${source}: 'nameExtractionPatterns[${index}]' must have {regex: string, replacement: string}`);
          }
        });
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
        const parsed = JSON.parse(saved);
        // Merge with defaults to handle new settings, but only include defined values from localStorage
        this.settings = { ...this.defaultSettings };
        Object.keys(parsed).forEach(key => {
          if (parsed[key] !== undefined && key in this.defaultSettings) {
            (this.settings as any)[key] = parsed[key];
          }
        });
      } else {
        // No saved settings, use defaults (which include custom defaults)
        this.settings = { ...this.defaultSettings };
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
      this.settings = { ...this.defaultSettings };
    }
  }

  /**
   * Save settings to localStorage (only non-default values)
   */
  private saveSettings(): void {
    try {
      const overrides: Partial<AppSettings> = {};

      // Only save values that differ from defaults
      for (const key of Object.keys(this.settings) as Array<keyof AppSettings>) {
        if (this.settings[key] !== this.defaultSettings[key]) {
          (overrides as any)[key] = this.settings[key];
        }
      }

      localStorage.setItem(SettingsManager.STORAGE_KEY, JSON.stringify(overrides));
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

  /**
   * Update a specific setting
   */
  updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.saveSettings();
    this.notifyChange();
  }

  /**
   * Update multiple settings at once
   */
  updateSettings(updates: Partial<AppSettings>): void {
    // Validate the updates before applying them
    this.validateAppSettings(updates, 'updateSettings');
    
    Object.assign(this.settings, updates);
    this.saveSettings();
    this.notifyChange();
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    this.settings = { ...this.defaultSettings };
    // Clear localStorage so new defaults will be used on next load
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
   * Export settings as JSON string
   */
  exportSettings(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  /**
   * Check if a setting has a non-default value
   */
  isModified(key: keyof AppSettings): boolean {
    return this.settings[key] !== this.defaultSettings[key];
  }

  /**
   * Get list of all modified settings
   */
  getModifiedSettings(): Array<{ key: keyof AppSettings; value: any; default: any }> {
    const defaults = this.defaultSettings;
    const modified: Array<{ key: keyof AppSettings; value: any; default: any }> = [];

    for (const key of Object.keys(this.settings) as Array<keyof AppSettings>) {
      if (this.settings[key] !== defaults[key]) {
        modified.push({
          key,
          value: this.settings[key],
          default: defaults[key],
        });
      }
    }

    return modified;
  }

  /**
   * Parse comma-separated prefixes into an array
   */
  parsePrefixes(prefixString: string): string[] {
    if (!prefixString || typeof prefixString !== 'string') {
      return [];
    }

    return prefixString
      .split(',')
      .map(prefix => prefix.trim())
      .filter(prefix => prefix.length > 0);
  }

  /**
   * Get parsed function trim prefixes as compiled regexes
   */
  getFunctionTrimPrefixes(): RegExp[] {
    return this.parseRegexPrefixes(this.settings.functionTrimPrefixes);
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
    const combined = this.getCombinedCategorySkipRules();
    if (!combined || combined.length === 0) {
      return [];
    }

    return combined
      .map(rule => rule.trim())
      .filter(rule => rule.length > 0);
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
    const combinedMatchRules = this.getCombinedCategoryMatchRules();
    if (combinedMatchRules && combinedMatchRules.length > 0) {
      const matchLines = combinedMatchRules
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

    const lines = ruleArray
      .map(line => line.trim())
      .filter(line => line.length > 0);

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
    rules.push(...this.parseTextRules(this.getCombinedNameSkipRules(), 'skip'));

    // Add trim rules
    rules.push(...this.parseTextRules(this.getCombinedNameTrimRules(), 'trim'));

    // Add fold rules
    rules.push(...this.parseTextRules(this.getCombinedNameFoldRules(), 'fold'));

    // Add find rules
    rules.push(...this.parseTextRules(this.getCombinedNameFindRules(), 'find'));

    return rules;
  }

  /**
   * Get zip file pattern as regex
   */
  getZipFilePatternRegex(): RegExp {
    const pattern = this.settings.zipFilePattern;
    if (!pattern || typeof pattern !== 'string') {
      // Default pattern for stacks.txt files
      return /^(.*\/)?stacks\.txt$/;
    }

    try {
      return new RegExp(pattern);
    } catch (e) {
      console.warn(`Invalid zip file pattern regex "${pattern}":`, e);
      // Fallback to default pattern
      return /^(.*\/)?stacks\.txt$/;
    }
  }

  /**
   * Get default rule values from current defaults (including custom defaults from HTML)
   */
  getDefaultCategorySkipRulesArray(): string[] {
    return this.defaultSettings.categorySkipRules;
  }

  getDefaultCategoryMatchRulesArray(): string[] {
    return this.defaultSettings.categoryMatchRules;
  }

  getDefaultNameSkipRulesArray(): string[] {
    return this.defaultSettings.nameSkipRules;
  }

  getDefaultNameTrimRulesArray(): string[] {
    return this.defaultSettings.nameTrimRules;
  }

  getDefaultNameFoldRulesArray(): string[] {
    return this.defaultSettings.nameFoldRules;
  }

  getDefaultNameFindRulesArray(): string[] {
    return this.defaultSettings.nameFindRules;
  }

  /**
   * Get merged category skip rules (defaults + custom)
   */
  getCombinedCategorySkipRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultCategorySkipRules) {
      combined.push(...this.getDefaultCategorySkipRulesArray());
    }

    if (this.settings.customCategorySkipRules.length > 0) {
      combined.push(...this.settings.customCategorySkipRules);
    }

    return combined;
  }

  /**
   * Get merged category match rules (defaults + custom)
   */
  getCombinedCategoryMatchRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultCategoryMatchRules) {
      combined.push(...this.getDefaultCategoryMatchRulesArray());
    }

    if (this.settings.customCategoryMatchRules.length > 0) {
      combined.push(...this.settings.customCategoryMatchRules);
    }

    return combined;
  }

  /**
   * Get merged name skip rules (defaults + custom)
   */
  getCombinedNameSkipRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultNameSkipRules) {
      combined.push(...this.getDefaultNameSkipRulesArray());
    }

    if (this.settings.customNameSkipRules.length > 0) {
      combined.push(...this.settings.customNameSkipRules);
    }

    return combined;
  }

  /**
   * Get merged name trim rules (defaults + custom)
   */
  getCombinedNameTrimRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultNameTrimRules) {
      combined.push(...this.getDefaultNameTrimRulesArray());
    }

    if (this.settings.customNameTrimRules.length > 0) {
      combined.push(...this.settings.customNameTrimRules);
    }

    return combined;
  }

  /**
   * Get merged name fold rules (defaults + custom)
   */
  getCombinedNameFoldRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultNameFoldRules) {
      combined.push(...this.getDefaultNameFoldRulesArray());
    }

    if (this.settings.customNameFoldRules.length > 0) {
      combined.push(...this.settings.customNameFoldRules);
    }

    return combined;
  }

  /**
   * Get merged name find rules (defaults + custom)
   */
  getCombinedNameFindRules(): string[] {
    let combined: string[] = [];

    if (this.settings.useDefaultNameFindRules) {
      combined.push(...this.getDefaultNameFindRulesArray());
    }

    if (this.settings.customNameFindRules.length > 0) {
      combined.push(...this.settings.customNameFindRules);
    }

    return combined;
  }
}
