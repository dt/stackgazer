import { AppSettings } from './types.js';

/**
 * Manages application settings with localStorage persistence
 */
export class SettingsManager {
  private static readonly STORAGE_KEY = 'stacktrace-settings';
  private settings: AppSettings;
  private changeCallback: ((settings: AppSettings) => void) | null = null;

  constructor() {
    this.settings = this.getDefaultSettings();
    this.loadSettings();
  }

  /**
   * Get default settings values
   */
  private getDefaultSettings(): AppSettings {
    return {
      // Parsing options
      functionTrimPrefixes: '',
      fileTrimPrefixes: 'github.com/cockroachdb/cockroach/',
      titleManipulationRules: 
        [
          'skip:sync.runtime_Semacquire',
          'fold:sync.(*WaitGroup).Wait->waitgroup',
          'skip:golang.org/x/sync/errgroup.(*Group).Wait',
          'foldstdlib:net/http->net/http',
          'foldstdlib:syscall.Syscall->syscall',
          'foldstdlib:internal/poll.runtime_pollWait->netpoll',
          'fold:github.com/cockroachdb/cockroach/pkg/util/ctxgroup.Group.Wait->ctxgroup',
          'fold:github.com/cockroachdb/cockroach/pkg/util/ctxgroup.GroupWorkers->GroupWorkers',
          'fold:github.com/cockroachdb/cockroach/pkg/util/ctxgroup.GoAndWait->GoAndWait',
          'skip:github.com/cockroachdb/cockroach/pkg/util/cidr.metricsConn.Read',
          'trim:github.com/cockroachdb/cockroach/'
        ].join('\n'),
      
      // Display options
      maxInitialGoroutines: 5,
      autoExpandStacks: false,
      
      // Zip file handling
      zipFilePattern: '**/stacks.txt',
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
        // Merge with defaults to handle new settings
        this.settings = { ...this.getDefaultSettings(), ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(SettingsManager.STORAGE_KEY, JSON.stringify(this.settings));
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
    this.settings = this.getDefaultSettings();
    this.saveSettings();
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
      const defaults = this.getDefaultSettings();
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
    const defaults = this.getDefaultSettings();
    return this.settings[key] !== defaults[key];
  }

  /**
   * Get list of all modified settings
   */
  getModifiedSettings(): Array<{ key: keyof AppSettings; value: any; default: any }> {
    const defaults = this.getDefaultSettings();
    const modified: Array<{ key: keyof AppSettings; value: any; default: any }> = [];
    
    for (const key of Object.keys(this.settings) as Array<keyof AppSettings>) {
      if (this.settings[key] !== defaults[key]) {
        modified.push({
          key,
          value: this.settings[key],
          default: defaults[key]
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
   * Get parsed function trim prefixes
   */
  getFunctionTrimPrefixes(): string[] {
    return this.parsePrefixes(this.settings.functionTrimPrefixes);
  }

  /**
   * Get parsed file trim prefixes
   */
  getFileTrimPrefixes(): string[] {
    return this.parsePrefixes(this.settings.fileTrimPrefixes);
  }

  /**
   * Get parsed title manipulation rules
   */
  getTitleManipulationRules(): string[] {
    if (!this.settings.titleManipulationRules || typeof this.settings.titleManipulationRules !== 'string') {
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
}