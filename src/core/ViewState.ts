import { NavigationEntry } from './types.js';

/**
 * Manages UI state and navigation for the Go Stack Trace Viewer
 */
export class ViewState {
  private navigationHistory: NavigationEntry[] = [];  // History of visited goroutines
  private navHistoryIndex = -1;                       // Current position in navigation history
  private highlightedGoroutine: string | null = null; // Currently highlighted goroutine for cross-references
  private expandedGroups = new Set<string>();         // Set of expanded unique stack IDs
  private stackDisplayMode: 'combined' | 'side-by-side' | 'functions' | 'locations' = 'combined'; // Display mode for unique stack traces

  /**
   * Navigate to a specific goroutine
   */
  navigateToGoroutine(id: string, fromId?: string): void {
    // Remove any entries after current index (when navigating from middle of history)
    this.navigationHistory = this.navigationHistory.slice(0, this.navHistoryIndex + 1);
    
    // If we have a fromId and no history yet, create a virtual entry for the source
    if (fromId && this.navigationHistory.length === 0) {
      const sourceEntry: NavigationEntry = {
        id: fromId,
        timestamp: Date.now() - 1 // Slightly earlier timestamp
      };
      this.navigationHistory.push(sourceEntry);
      this.navHistoryIndex = 0;
    }
    
    const entry: NavigationEntry = {
      id,
      fromId,
      timestamp: Date.now()
    };
    
    // Add new entry
    this.navigationHistory.push(entry);
    this.navHistoryIndex = this.navigationHistory.length - 1;
    
    // Limit history size to prevent memory bloat
    const MAX_HISTORY = 100;
    if (this.navigationHistory.length > MAX_HISTORY) {
      const excess = this.navigationHistory.length - MAX_HISTORY;
      this.navigationHistory = this.navigationHistory.slice(excess);
      this.navHistoryIndex -= excess;
    }
  }

  /**
   * Go back in navigation history
   */
  goBack(): boolean {
    if (this.canGoBack()) {
      this.navHistoryIndex--;
      return true;
    }
    return false;
  }

  /**
   * Go forward in navigation history
   */
  goForward(): boolean {
    if (this.canGoForward()) {
      this.navHistoryIndex++;
      return true;
    }
    return false;
  }

  /**
   * Check if can go back
   */
  canGoBack(): boolean {
    return this.navHistoryIndex > 0;
  }

  /**
   * Check if can go forward
   */
  canGoForward(): boolean {
    return this.navHistoryIndex < this.navigationHistory.length - 1;
  }

  /**
   * Get current navigation entry
   */
  getCurrentEntry(): NavigationEntry | null {
    if (this.navHistoryIndex >= 0 && this.navHistoryIndex < this.navigationHistory.length) {
      return this.navigationHistory[this.navHistoryIndex];
    }
    return null;
  }

  /**
   * Get navigation history
   */
  getNavigationHistory(): NavigationEntry[] {
    return [...this.navigationHistory];
  }

  /**
   * Clear navigation history
   */
  clearNavigationHistory(): void {
    this.navigationHistory = [];
    this.navHistoryIndex = -1;
  }

  /**
   * Highlight a specific goroutine
   */
  highlightGoroutine(goroutineId: string): void {
    this.highlightedGoroutine = goroutineId;
  }

  /**
   * Clear current highlight
   */
  clearHighlight(): void {
    this.highlightedGoroutine = null;
  }

  /**
   * Get currently highlighted goroutine
   */
  getHighlightedGoroutine(): string | null {
    return this.highlightedGoroutine;
  }

  /**
   * Expand a group (unique stack)
   */
  expandGroup(groupId: string): void {
    this.expandedGroups.add(groupId);
  }

  /**
   * Collapse a group (unique stack)
   */
  collapseGroup(groupId: string): void {
    this.expandedGroups.delete(groupId);
  }

  /**
   * Toggle group expansion
   */
  toggleGroup(groupId: string): void {
    if (this.expandedGroups.has(groupId)) {
      this.collapseGroup(groupId);
    } else {
      this.expandGroup(groupId);
    }
  }

  /**
   * Check if group is expanded
   */
  isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups.has(groupId);
  }

  /**
   * Get all expanded groups
   */
  getExpandedGroups(): Set<string> {
    return new Set(this.expandedGroups);
  }


  /**
   * Set stack display mode
   */
  setStackDisplayMode(mode: 'combined' | 'side-by-side' | 'functions' | 'locations'): void {
    this.stackDisplayMode = mode;
  }

  /**
   * Get stack display mode
   */
  getStackDisplayMode(): 'combined' | 'side-by-side' | 'functions' | 'locations' {
    return this.stackDisplayMode;
  }

  /**
   * Expand all groups
   */
  expandAllGroups(groupIds: string[]): void {
    groupIds.forEach(id => this.expandedGroups.add(id));
  }

  /**
   * Collapse all groups
   */
  collapseAllGroups(): void {
    this.expandedGroups.clear();
  }

  /**
   * Reset all UI state
   */
  reset(): void {
    this.clearNavigationHistory();
    this.clearHighlight();
    this.collapseAllGroups();
    this.stackDisplayMode = 'combined';
  }

  /**
   * Serialize state for persistence (only UI preferences, not session-specific data)
   */
  serialize(): string {
    return JSON.stringify({
      stackDisplayMode: this.stackDisplayMode
    });
  }

  /**
   * Restore state from serialized data (only UI preferences)
   */
  deserialize(serialized: string): void {
    try {
      const data = JSON.parse(serialized);
      this.stackDisplayMode = data.stackDisplayMode ?? 'combined';
      // Don't restore session-specific data like navigation, highlights, or expanded groups
    } catch (error) {
      console.warn('Failed to deserialize ViewState:', error);
      this.stackDisplayMode = 'combined';
    }
  }
}