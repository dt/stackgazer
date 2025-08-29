/**
 * Manages application settings with localStorage persistence
 */

import type { TitleRule, CategoryRule } from './ProfileCollection.js';

export interface NameExtractionPattern {
  regex: string;
  replacement: string;
}

export interface AppSettings {
  // Parsing options
  functionTrimPrefixes: string;
  fileTrimPrefixes: string;
  
  // Text-based rule format - legacy (for backward compatibility)
  categorySkipRules: string;
  categoryMatchRules: string;
  nameSkipRules: string;
  nameTrimRules: string;
  nameFoldRules: string;
  nameFindRules: string;

  // New custom/default rule system
  useDefaultCategorySkipRules: boolean;
  customCategorySkipRules: string;
  useDefaultCategoryMatchRules: boolean;
  customCategoryMatchRules: string;
  useDefaultNameSkipRules: boolean;
  customNameSkipRules: string;
  useDefaultNameTrimRules: boolean;
  customNameTrimRules: string;
  useDefaultNameFoldRules: boolean;
  customNameFoldRules: string;
  useDefaultNameFindRules: boolean;
  customNameFindRules: string;

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

  constructor(customDefaults?: Partial<AppSettings>) {
    this.defaultSettings = { ...this.getBuiltinDefaults(), ...customDefaults };
    this.settings = { ...this.defaultSettings };
    this.loadSettings();
  }

  /**
   * Get built-in default settings values
   */
  private getBuiltinDefaults(): AppSettings {
    const defaultCategorySkipRules = [
      'sync.',
      'internal/',
      'golang.org/x/sync/errgroup',
      'util/stop',
      'util/ctxgroup',
      'jobs.',
      'kv/kvclient/rangefeed',
      'kv/kvpb._',
      'google.golang.org/grpc',
      'rpc.NewServerEx',
      'rpc.internalClientAdapter',
      'rpc.serverStreamInterceptorsChain',
      'rpc.kvAuth',
      'sql/flowinfra.(*FlowBase).StartInternal.func',
      'sql/execinfra.(*ProcessorBaseNoHelper).Run',
      'sql/execinfra.Run'
    ].join('\n');

    return {
      // Parsing options
      functionTrimPrefixes: '',
      fileTrimPrefixes: '',
      
      // Legacy rule format (for backward compatibility)
      categorySkipRules: defaultCategorySkipRules,
      
      categoryMatchRules: 's|^((([^\\/.]*\\\\.[^\\/]*)*\\/)?[^\\/.]+(\\/[^\\/.]+)?)|$1|',
      
      nameSkipRules: [
        'sync.runtime_notifyListWait',
        'sync.runtime_Semacquire', 
        'golang.org/x/sync/errgroup.(*Group).Wait',
        'rpc.NewContext.ClientInterceptor.func8',
        'util/cidr.metricsConn.Read',
        'server.(*Node).batchInternal'
      ].join('\n'),
      
      nameTrimRules: [
        's|\\.func\\d+(\\.\\d+)?$||',
        'util/',
        's|^server\\.\\(\\*Node\\)\\.Batch$|batch|'
      ].join('\n'),
      
      nameFoldRules: [
        's|sync.(*Cond).Wait,|condwait|',
        's|sync.(*WaitGroup).Wait,|waitgroup|',
        's|util/ctxgroup.Group.Wait,|waitgroup|',
        's|util/ctxgroup.GroupWorkers,|waitgroup|',
        's|util/ctxgroup.GoAndWait,|waitgroup|',
        's|net/http,stdlib|net/http|',
        's|syscall.Syscall,stdlib|syscall|',
        's|internal/poll.runtime_pollWait,stdlib|netpoll|',
        's|google.golang.org/grpc/internal/transport.(*Stream).waitOnHeader,google.golang.org/grpc|grpc|',
        's|util/admission.(*WorkQueue).Admit,^(util/admission|kv/kvserver/kvadmission)|AC|'
      ].join('\n'),
      
      nameFindRules: [
        's|kv/kvclient/kvcoord.(*DistSender).Send,^(kv/kvclient/kvcoord|kv\\.)|DistSender|'
      ].join('\n'),

      // New custom/default rule system - all enabled by default with empty custom rules
      useDefaultCategorySkipRules: true,
      customCategorySkipRules: '',
      useDefaultCategoryMatchRules: true,
      customCategoryMatchRules: '',
      useDefaultNameSkipRules: true,
      customNameSkipRules: '',
      useDefaultNameTrimRules: true,
      customNameTrimRules: '',
      useDefaultNameFoldRules: true,
      customNameFoldRules: '',
      useDefaultNameFindRules: true,
      customNameFindRules: '',

      // Name extraction patterns (still used by FileParser)
      nameExtractionPatterns: [
        {
          regex: 'pgwire\\.\\(\\*Server\\)\\.serveImpl.*?\\{0x1,\\s*0x2,\\s*\\{0x([0-9a-fA-F]+),',
          replacement: 'hex:n$1',
        },
        {
          regex: 'pgwire\\.\\(\\*Server\\)\\.serveImpl.*?\\{0x0,\\s*0x4,\\s*\\{0x([0-9a-fA-F]+),',
          replacement: 'hex:n$1',
        },
        {
          regex: '# labels:.*?"n":"([0-9]+)"',
          replacement: 'n$1',
        },
      ],

      // Zip file handling
      zipFilePattern: '^(.*\/)?stacks\.txt$',
    };
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
    if (!combined) {
      return [];
    }

    return combined
      .split('\n')
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
    if (combinedMatchRules) {
      const matchLines = combinedMatchRules
        .split('\n')
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
  parseRegexPrefixes(prefixString: string): RegExp[] {
    if (!prefixString || typeof prefixString !== 'string') {
      return [];
    }

    return prefixString
      .split(',')
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
  parseTextRules(ruleText: string, ruleType: 'skip' | 'trim' | 'fold' | 'find'): TitleRule[] {
    if (!ruleText || typeof ruleText !== 'string') {
      return [];
    }

    const lines = ruleText
      .split('\n')
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
  getDefaultCategorySkipRulesString(): string {
    return this.defaultSettings.categorySkipRules;
  }

  getDefaultCategoryMatchRulesString(): string {
    return this.defaultSettings.categoryMatchRules;
  }

  getDefaultNameSkipRulesString(): string {
    return this.defaultSettings.nameSkipRules;
  }

  getDefaultNameTrimRulesString(): string {
    return this.defaultSettings.nameTrimRules;
  }

  getDefaultNameFoldRulesString(): string {
    return this.defaultSettings.nameFoldRules;
  }

  getDefaultNameFindRulesString(): string {
    return this.defaultSettings.nameFindRules;
  }

  /**
   * Get merged category skip rules (defaults + custom)
   */
  getCombinedCategorySkipRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultCategorySkipRules) {
      combined += this.getDefaultCategorySkipRulesString();
    }
    
    if (this.settings.customCategorySkipRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customCategorySkipRules;
    }
    
    return combined;
  }

  /**
   * Get merged category match rules (defaults + custom)
   */
  getCombinedCategoryMatchRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultCategoryMatchRules) {
      combined += this.getDefaultCategoryMatchRulesString();
    }
    
    if (this.settings.customCategoryMatchRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customCategoryMatchRules;
    }
    
    return combined;
  }

  /**
   * Get merged name skip rules (defaults + custom)
   */
  getCombinedNameSkipRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultNameSkipRules) {
      combined += this.getDefaultNameSkipRulesString();
    }
    
    if (this.settings.customNameSkipRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customNameSkipRules;
    }
    
    return combined;
  }

  /**
   * Get merged name trim rules (defaults + custom)
   */
  getCombinedNameTrimRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultNameTrimRules) {
      combined += this.getDefaultNameTrimRulesString();
    }
    
    if (this.settings.customNameTrimRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customNameTrimRules;
    }
    
    return combined;
  }

  /**
   * Get merged name fold rules (defaults + custom)
   */
  getCombinedNameFoldRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultNameFoldRules) {
      combined += this.getDefaultNameFoldRulesString();
    }
    
    if (this.settings.customNameFoldRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customNameFoldRules;
    }
    
    return combined;
  }

  /**
   * Get merged name find rules (defaults + custom)
   */
  getCombinedNameFindRules(): string {
    let combined = '';
    
    if (this.settings.useDefaultNameFindRules) {
      combined += this.getDefaultNameFindRulesString();
    }
    
    if (this.settings.customNameFindRules.trim()) {
      if (combined) combined += '\n';
      combined += this.settings.customNameFindRules;
    }
    
    return combined;
  }

}
