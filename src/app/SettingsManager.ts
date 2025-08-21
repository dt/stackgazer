/**
 * Manages application settings with localStorage persistence
 */

export interface NameExtractionPattern {
  regex: string;
  replacement: string;
}

export interface AppSettings {
  // Parsing options
  functionTrimPrefixes: string;
  fileTrimPrefixes: string;
  titleManipulationRules: string;
  nameExtractionPatterns: NameExtractionPattern[];
  categoryIgnoredPrefixes: string;

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
    return {
      // Parsing options
      functionTrimPrefixes: '',
      fileTrimPrefixes: '',
      titleManipulationRules: [
        'skip:sync.runtime_Semacquire',
        'fold:sync.(*WaitGroup).Wait->waitgroup',
        'skip:golang.org/x/sync/errgroup.(*Group).Wait',
        'foldstdlib:net/http->net/http',
        'foldstdlib:syscall.Syscall->syscall',
        'foldstdlib:internal/poll.runtime_pollWait->netpoll',
      ].join('\n'),
      nameExtractionPatterns: [],
      categoryIgnoredPrefixes: ['runtime.', 'sync.', 'reflect.', 'syscall.', 'internal/'].join(
        '\n'
      ),

      // Zip file handling
      zipFilePattern: '^(.*\/)?.*\.txt$',
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
   * Get category ignored prefixes as array of strings
   */
  getCategoryIgnoredPrefixes(): string[] {
    if (
      !this.settings.categoryIgnoredPrefixes ||
      typeof this.settings.categoryIgnoredPrefixes !== 'string'
    ) {
      return [];
    }

    return this.settings.categoryIgnoredPrefixes
      .split('\n')
      .map(prefix => prefix.trim())
      .filter(prefix => prefix.length > 0);
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
   * Get parsed title manipulation rules
   */
  getTitleManipulationRules(): string[] {
    if (
      !this.settings.titleManipulationRules ||
      typeof this.settings.titleManipulationRules !== 'string'
    ) {
      return [];
    }

    // Title rules can be separated by newlines (from UI) or commas (from storage)
    // Try newlines first, then fall back to commas for backward compatibility
    const byNewlines = this.settings.titleManipulationRules
      .split('\n')
      .map(rule => rule.trim())
      .filter(rule => rule.length > 0);

    if (byNewlines.length > 0) {
      return byNewlines;
    }

    // Fall back to comma-separated for backward compatibility
    return this.parsePrefixes(this.settings.titleManipulationRules);
  }

  /**
   * Set title manipulation rules from newline-separated format
   */
  setTitleManipulationRules(rules: string): void {
    this.updateSetting('titleManipulationRules', rules);
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
}
