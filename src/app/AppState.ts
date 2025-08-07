/**
 * Application state management - handles UI state that should be managed by the app layer
 */

export interface NavigationStateChanges {
  canGoBack: boolean;
}

export interface ExpansionStateChanges {
  expandedGroups: Set<string>;
  expandedFiles: Set<string>;
}

/**
 * Manages navigation, expansion state, and other UI state that affects business logic
 */
export class AppState {
  private navigationHistory: string[] = [];
  private expandedGroups: Set<string> = new Set();
  private expandedFiles: Set<string> = new Set();

  /**
   * Navigation History Management
   */
  addToNavigationHistory(goroutineId: string): NavigationStateChanges {
    // Don't add duplicate consecutive entries
    if (
      this.navigationHistory.length > 0 &&
      this.navigationHistory[this.navigationHistory.length - 1] === goroutineId
    ) {
      return { canGoBack: this.navigationHistory.length > 0 };
    }

    this.navigationHistory.push(goroutineId);
    return { canGoBack: this.navigationHistory.length > 0 };
  }

  navigateBack(): { targetGoroutineId: string | null; canGoBack: boolean } {
    if (this.navigationHistory.length === 0) {
      return { targetGoroutineId: null, canGoBack: false };
    }

    const targetGoroutineId = this.navigationHistory.pop()!;
    return {
      targetGoroutineId,
      canGoBack: this.navigationHistory.length > 0,
    };
  }

  canNavigateBack(): boolean {
    return this.navigationHistory.length > 0;
  }

  /**
   * Expansion State Management
   */
  toggleGroupExpansion(groupId: string): { isExpanded: boolean } {
    const isExpanded = this.expandedGroups.has(groupId);

    if (isExpanded) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }

    return { isExpanded: !isExpanded };
  }

  toggleFileExpansion(fileId: string): { isExpanded: boolean } {
    const isExpanded = this.expandedFiles.has(fileId);

    if (isExpanded) {
      this.expandedFiles.delete(fileId);
    } else {
      this.expandedFiles.add(fileId);
    }

    return { isExpanded: !isExpanded };
  }

  isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups.has(groupId);
  }

  isFileExpanded(fileId: string): boolean {
    return this.expandedFiles.has(fileId);
  }

  /**
   * Bulk Operations
   */
  expandAllGroups(groupIds: string[]): ExpansionStateChanges {
    groupIds.forEach(id => this.expandedGroups.add(id));
    return {
      expandedGroups: new Set(this.expandedGroups),
      expandedFiles: new Set(this.expandedFiles),
    };
  }

  collapseAllGroups(): ExpansionStateChanges {
    this.expandedGroups.clear();
    return {
      expandedGroups: new Set(this.expandedGroups),
      expandedFiles: new Set(this.expandedFiles),
    };
  }

  /**
   * Reset state (when loading new files, etc.)
   */
  reset(): void {
    this.navigationHistory = [];
    this.expandedGroups.clear();
    this.expandedFiles.clear();
  }
}
