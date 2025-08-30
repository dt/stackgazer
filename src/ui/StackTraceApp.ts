import { ProfileCollection, ProfileCollectionSettings } from '../app/ProfileCollection.js';
import type { TitleRule, CategoryRule } from '../app/ProfileCollection.js';
import { FileParser } from '../parser/index.js';
import {
  UniqueStack,
  Group,
  FilterChanges,
  AppState,
  Goroutine,
  Filter,
  Category,
  Counts,
  sortStateEntries,
} from '../app/types.js';
import { SettingsManager, AppSettings } from '../app/SettingsManager.js';
import { getJSZip } from '../parser/zip.js';

export interface StackTraceAppOptions extends Partial<AppSettings> {
  initialTheme?: 'dark' | 'light';
}

/**
 * Main application class that manages the UI and coordinates with ProfileCollection
 */
export class StackTraceApp {
  private profileCollection: ProfileCollection;
  private parser: FileParser;
  private settingsManager: SettingsManager;
  private appState: AppState;
  private filterInputValue: string = '';
  private stackDisplayMode: 'combined' | 'side-by-side' | 'functions' | 'locations' = 'combined';
  private filterDebounceTimer: number | null = null;
  private tooltip!: HTMLElement;
  private currentTheme: 'dark' | 'light' = 'dark';
  private initialTheme?: 'dark' | 'light';
  private templates!: {
    category: HTMLTemplateElement;
    stack: HTMLTemplateElement;
    fileSection: HTMLTemplateElement;
    group: HTMLTemplateElement;
    goroutine: HTMLTemplateElement;
    stackTrace: HTMLTemplateElement;
    showMore: HTMLTemplateElement;
    fileItem: HTMLTemplateElement;
    fileEmptyState: HTMLTemplateElement;
    fileDropArea: HTMLTemplateElement;
  };

  constructor(options?: StackTraceAppOptions) {
    // Extract theme setting and settings defaults
    const { initialTheme, ...customDefaults } = options || {};
    this.initialTheme = initialTheme;

    // Initialize settings manager and app state
    this.settingsManager = new SettingsManager(customDefaults);
    this.appState = new AppState();

    // Convert settings to ProfileCollectionSettings format
    const appSettings = this.settingsManager.getSettings();
    const profileSettings = this.convertToProfileCollectionSettings(appSettings);

    this.profileCollection = new ProfileCollection(profileSettings);
    this.parser = new FileParser({
      nameExtractionPatterns: profileSettings.nameExtractionPatterns,
    });

    // Expose for debugging
    (window as any).debugProfileCollection = this.profileCollection;
    (window as any).debugApp = this;

    // Setup settings change callback
    this.settingsManager.onChange((settings: AppSettings) => {
      this.onSettingsChanged(settings);
    });

    this.initializeTemplates();
    this.initializeUI();
    this.initializeTheme();
    this.loadUIState();
    this.updateUnpinButtonVisibility(); // Initialize button visibility
    this.createTooltip();
  }

  private initializeTemplates(): void {
    this.templates = {
      category: this.getTemplate('category-template'),
      stack: this.getTemplate('stack-template'),
      fileSection: this.getTemplate('file-section-template'),
      group: this.getTemplate('group-template'),
      goroutine: this.getTemplate('goroutine-template'),
      stackTrace: this.getTemplate('stack-trace-template'),
      showMore: this.getTemplate('show-more-template'),
      fileItem: this.getTemplate('file-item-template'),
      fileEmptyState: this.getTemplate('file-empty-state-template'),
      fileDropArea: this.getTemplate('file-drop-area-template'),
    };

    // Normalize templates once to remove whitespace text nodes
    Object.values(this.templates).forEach(template => {
      this.normalizeTemplate(template);
    });
  }

  private getTemplate(id: string): HTMLTemplateElement {
    const template = document.getElementById(id) as HTMLTemplateElement;
    if (!template) {
      throw new Error(`Template with id '${id}' not found`);
    }
    return template;
  }

  /**
   * Removes whitespace-only text nodes from template content to prevent layout issues.
   *
   * When HTML templates are formatted with indentation and newlines for readability,
   * the whitespace creates text nodes in the DOM. These can cause unexpected spacing
   * when cloning templates, as CSS may treat them as content. By normalizing templates
   * once during initialization, we get clean DOM structure without sacrificing
   * template readability.
   */
  private normalizeTemplate(template: HTMLTemplateElement): void {
    const removeWhitespaceNodes = (node: Node): void => {
      const childNodes = Array.from(node.childNodes);
      for (const child of childNodes) {
        if (child.nodeType === Node.TEXT_NODE && /^\s*$/.test(child.textContent || '')) {
          child.parentNode?.removeChild(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          removeWhitespaceNodes(child);
        }
      }
    };

    removeWhitespaceNodes(template.content);
  }

  private initializeUI(): void {
    this.clearUrlAnchor();
    this.setupEventListeners();
    this.updateDropZone();
    this.setupNavigationHistory();

    // Initialize main-content with filtered class so that filtering works by default
    const mainContent = document.querySelector('.main-content') as HTMLElement;
    if (mainContent) {
      mainContent.classList.add('filtered');
    }
  }

  private loadUIState(): void {
    // Load filter string from localStorage
    const savedFilter = localStorage.getItem('stacktrace-filter');
    if (savedFilter) {
      this.filterInputValue = savedFilter;
      const filterInput = document.getElementById('filterInput') as HTMLInputElement;
      const narrowFilterInput = document.getElementById('narrowFilterInput') as HTMLInputElement;

      if (filterInput) {
        filterInput.value = savedFilter;
      }
      if (narrowFilterInput) {
        narrowFilterInput.value = savedFilter;
      }

      this.setFilter({ filterString: savedFilter });
    }

    // Load stack display mode from localStorage
    const savedStackMode = localStorage.getItem('stacktrace-display-mode');
    if (
      savedStackMode &&
      ['combined', 'side-by-side', 'functions', 'locations'].includes(savedStackMode)
    ) {
      this.stackDisplayMode = savedStackMode as
        | 'combined'
        | 'side-by-side'
        | 'functions'
        | 'locations';
      const stackDisplayModeSelect = document.getElementById(
        'stackDisplayModeSelect'
      ) as HTMLSelectElement;
      const narrowStackDisplayModeSelect = document.getElementById(
        'narrowStackDisplayModeSelect'
      ) as HTMLSelectElement;

      if (stackDisplayModeSelect) {
        stackDisplayModeSelect.value = savedStackMode;
      }
      if (narrowStackDisplayModeSelect) {
        narrowStackDisplayModeSelect.value = savedStackMode;
      }
      this.updateStackDisplayMode(this.stackDisplayMode);
    }
  }

  private saveUIState(): void {
    localStorage.setItem('stacktrace-filter', this.filterInputValue);
    localStorage.setItem('stacktrace-display-mode', this.stackDisplayMode);
  }

  private openFileDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.log';
    input.multiple = true;
    input.onchange = e => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        this.handleFiles(Array.from(files));
      }
    };
    input.click();
  }

  private setupEventListeners(): void {
    // Filter input
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      filterInput.addEventListener('input', e => {
        const value = (e.target as HTMLInputElement).value;
        this.filterInputValue = value;
        this.debouncedSetFilter(value);
        this.syncFilterInputs();
      });
    }

    // Clear filter button
    const clearFilterBtn = document.getElementById('clearFilterBtn');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => {
        this.clearFilter();
      });
    }

    // Clear all files button
    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.clearAllFiles();
      });
    }

    // Expand all button
    const expandAllBtn = document.getElementById('expandAllBtn');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', () => {
        this.expandAllStacks();
      });
    }

    // Collapse all button
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', () => {
        this.collapseAllStacks();
      });
    }

    // Unpin all button
    const unpinAllBtn = document.getElementById('unpinAllBtn');
    if (unpinAllBtn) {
      unpinAllBtn.addEventListener('click', () => {
        this.unpinAllItems();
      });
    }

    // File input handling
    const addFileBtn = document.getElementById('addFileBtn');
    if (addFileBtn) {
      addFileBtn.addEventListener('click', () => {
        this.openFileDialog();
      });
    }

    // Stack display mode toggle
    const stackDisplayModeSelect = document.getElementById(
      'stackDisplayModeSelect'
    ) as HTMLSelectElement;
    if (stackDisplayModeSelect) {
      stackDisplayModeSelect.addEventListener('change', e => {
        const mode = (e.target as HTMLSelectElement).value as
          | 'combined'
          | 'side-by-side'
          | 'functions'
          | 'locations';
        this.stackDisplayMode = mode;
        this.updateStackDisplayMode(mode);
        this.saveUIState();

        // Sync with narrow select
        const narrowStackDisplayModeSelect = document.getElementById(
          'narrowStackDisplayModeSelect'
        ) as HTMLSelectElement;
        if (narrowStackDisplayModeSelect) {
          narrowStackDisplayModeSelect.value = mode;
        }
      });
    }

    // Theme toggle button
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Global drag and drop
    window.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.handleFiles(Array.from(files));
      }
    });

    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.navigateBack();
      });
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', e => {
      // Alt+Left Arrow or Backspace (when not in input) for back navigation
      if (
        (e.altKey && e.key === 'ArrowLeft') ||
        (e.key === 'Backspace' &&
          !(e.target as HTMLElement).matches('input, textarea, [contenteditable="true"]'))
      ) {
        e.preventDefault();
        this.navigateBack();
      }
    });

    // Narrow screen menu toggle
    const narrowMenuBtn = document.getElementById('narrowMenuBtn');
    if (narrowMenuBtn) {
      narrowMenuBtn.addEventListener('click', () => {
        this.toggleNarrowSidebar();
      });
    }

    // Sidebar overlay click to close
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        this.closeNarrowSidebar();
      });
    }

    // Narrow sidebar close button
    const narrowCloseBtn = document.getElementById('narrowCloseBtn');
    if (narrowCloseBtn) {
      narrowCloseBtn.addEventListener('click', () => {
        this.closeNarrowSidebar();
      });
    }

    // Narrow screen filter input
    const narrowFilterInput = document.getElementById('narrowFilterInput') as HTMLInputElement;
    if (narrowFilterInput) {
      narrowFilterInput.addEventListener('input', e => {
        const value = (e.target as HTMLInputElement).value;
        this.filterInputValue = value;
        this.debouncedSetFilter(value);
        this.syncFilterInputs();
      });
    }

    // Narrow screen control buttons in sidebar
    const narrowExpandAllBtn = document.getElementById('narrowExpandAllBtn');
    if (narrowExpandAllBtn) {
      narrowExpandAllBtn.addEventListener('click', () => {
        this.expandAllStacks();
      });
    }

    const narrowCollapseAllBtn = document.getElementById('narrowCollapseAllBtn');
    if (narrowCollapseAllBtn) {
      narrowCollapseAllBtn.addEventListener('click', () => {
        this.collapseAllStacks();
      });
    }

    const narrowUnpinAllBtn = document.getElementById('narrowUnpinAllBtn');
    if (narrowUnpinAllBtn) {
      narrowUnpinAllBtn.addEventListener('click', () => {
        this.unpinAllItems();
      });
    }

    // Narrow screen floating back button
    const narrowBackBtn = document.getElementById('narrowBackBtn');
    if (narrowBackBtn) {
      narrowBackBtn.addEventListener('click', () => {
        this.navigateBack();
      });
    }

    // Narrow screen stack display mode select
    const narrowStackDisplayModeSelect = document.getElementById(
      'narrowStackDisplayModeSelect'
    ) as HTMLSelectElement;
    if (narrowStackDisplayModeSelect) {
      narrowStackDisplayModeSelect.addEventListener('change', e => {
        const mode = (e.target as HTMLSelectElement).value as
          | 'combined'
          | 'side-by-side'
          | 'functions'
          | 'locations';
        this.stackDisplayMode = mode;
        this.updateStackDisplayMode(mode);
        this.saveUIState();

        // Sync with desktop select
        const desktopStackDisplayModeSelect = document.getElementById(
          'stackDisplayModeSelect'
        ) as HTMLSelectElement;
        if (desktopStackDisplayModeSelect) {
          desktopStackDisplayModeSelect.value = mode;
        }
      });
    }

    // Handle window resize for responsive layout
    window.addEventListener('resize', () => {
      this.handleResizeForNarrowMode();
    });

    // Settings modal
    this.setupSettingsModal();
  }

  private handleCopyButtonClick(e: Event): void {
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    const stackId = button.dataset.stackId;
    const categoryId = button.dataset.categoryId;

    if (!stackId || !categoryId) return;

    // Use O(n) lookup for now since we don't have category/stack maps in UI layer
    // TODO: Consider adding fast lookup maps if this becomes a bottleneck
    const categories = this.profileCollection.getCategories();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const stack = category.stacks.find(s => s.id === stackId);
    if (!stack) return;

    this.copyStackToClipboard(stack, category);
  }

  private handlePinButtonClick(e: Event): void {
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    const pinContainer = button.closest('[data-pin-type]') as HTMLElement;
    if (!pinContainer) return;

    const pinType = pinContainer.dataset.pinType;
    const pinId = pinContainer.dataset.pinId;
    if (!pinType || !pinId) return;

    let pinned = false;
    switch (pinType) {
      case 'category':
        pinned = this.profileCollection.toggleCategoryPin(pinId);
        break;
      case 'stack':
        pinned = this.profileCollection.toggleStackPin(pinId);
        break;
      case 'group':
        pinned = this.profileCollection.toggleGroupPin(pinId);
        break;
      case 'goroutine':
        pinned = this.profileCollection.toggleGoroutinePin(pinId);
        break;
      default:
        return;
    }

    pinContainer.classList.toggle('pinned', pinned);
    button.classList.toggle('pinned', pinned);
    this.setFilter(this.buildCurrentFilter());
    this.updateVisibility();
    this.updateStats();
  }

  private handlePinButtonDoubleClick(e: Event): void {
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    const pinContainer = button.closest('[data-pin-type]') as HTMLElement;
    if (!pinContainer) return;

    const pinType = pinContainer.dataset.pinType;
    const pinId = pinContainer.dataset.pinId;
    if (!pinType || !pinId) return;

    switch (pinType) {
      case 'category':
        // Category double-click uses special method that pins/unpins with children
        this.profileCollection.toggleCategoryPinWithChildren(pinId);
        // Update UI for all affected elements
        this.refreshPinStates();
        break;
      case 'stack':
        // Stack double-click uses special method that pins/unpins with children
        this.profileCollection.toggleStackPinWithChildren(pinId);
        // Update UI for all affected elements
        this.refreshPinStates();
        break;
      case 'group':
        // Group double-click uses special method that pins/unpins with children
        this.profileCollection.toggleGroupPinWithChildren(pinId);
        // Update UI for all affected elements
        this.refreshPinStates();
        break;
      // Goroutines don't have children to unpin
    }

    this.setFilter(this.buildCurrentFilter());
    this.updateVisibility();
    this.updateStats();
  }

  private handleNavigationClick(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    const link = e.currentTarget as HTMLElement;
    const targetId = link.dataset.targetId;
    const sourceId = link.dataset.sourceId;
    if (targetId && sourceId) {
      this.navigateToGoroutine(targetId, sourceId);
    }
  }

  private handleShowAllCreatedClick(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    const link = e.currentTarget as HTMLElement;
    const creatorId = link.dataset.creatorId;
    const secondLineId = link.dataset.secondLineId;

    if (creatorId && secondLineId) {
      const goroutine = this.profileCollection.getGoroutineByID(creatorId);
      if (goroutine) {
        const secondLine = document.getElementById(secondLineId) as HTMLElement;
        if (secondLine) {
          this.showAllCreatedGoroutines(creatorId, goroutine.created, secondLine);
        }
      }
    }
  }

  private handleTooltipMouseEnter(e: MouseEvent): void {
    const link = e.currentTarget as HTMLElement;
    const goroutineId = link.dataset.tooltipGoroutineId;
    if (goroutineId) {
      this.showGoroutinePreviewTooltip(goroutineId, e);
    }
  }

  private handleTooltipMouseLeave(): void {
    this.hideTooltip();
  }

  private handleTooltipMouseMove(e: MouseEvent): void {
    this.tooltip.style.left = `${e.pageX - 20}px`;
    this.tooltip.style.top = `${e.pageY + 10}px`;
  }

  private handleShowMoreClick(e: Event): void {
    e.stopPropagation();
    const showMoreLink = e.currentTarget as HTMLElement;
    const groupId = showMoreLink.dataset.groupId;

    if (!groupId) return;

    const groupContent = showMoreLink.parentElement as HTMLElement;
    if (!groupContent) return;

    // Find the group in the data model
    const group = this.findGroupById(groupId);
    if (!group) return;

    // Get currently visible goroutines to determine which ones to add
    const visibleGoroutineIds = new Set(
      Array.from(groupContent.querySelectorAll('.goroutine-entry')).map(el =>
        el.id.replace('goroutine-', '')
      )
    );

    // Add remaining goroutines that aren't already visible
    group.goroutines.forEach(goroutine => {
      if (!visibleGoroutineIds.has(goroutine.id)) {
        const goroutineElement = this.createGoroutineElement(goroutine);
        groupContent.appendChild(goroutineElement);
      }
    });

    // Remove the show more link since all goroutines are now visible
    showMoreLink.remove();
    this.setFilter(this.buildCurrentFilter());
  }

  private findGroupById(groupId: string): Group | null {
    const categories = this.profileCollection.getCategories();
    for (const category of categories) {
      for (const stack of category.stacks) {
        for (const fileSection of stack.files) {
          for (const group of fileSection.groups) {
            if (group.id === groupId) {
              return group;
            }
          }
        }
      }
    }
    return null;
  }

  private handleFileRenameClick(e: Event): void {
    e.stopPropagation();
    const fileNameSpan = e.currentTarget as HTMLElement;
    const fileName = fileNameSpan.dataset.fileName;
    if (fileName) {
      this.startFileRename(fileNameSpan, fileName);
    }
  }

  private handleFileRemoveClick(e: Event): void {
    e.stopPropagation();
    const removeBtn = e.currentTarget as HTMLElement;
    const fileName = removeBtn.dataset.fileName;
    if (fileName) {
      this.profileCollection.removeFile(fileName);
      this.render();
    }
  }

  private handleRuleRemoveClick(e: Event): void {
    const removeBtn = e.currentTarget as HTMLElement;
    const ruleElement = removeBtn.closest('.rule-item') as HTMLElement;
    const listType = removeBtn.dataset.listType || 'rulesList';

    if (ruleElement) {
      ruleElement.remove();
      // Update rule count after removal
      const rulesList = document.getElementById(listType);
      if (rulesList) {
        const remainingRules = rulesList.querySelectorAll('.rule-item').length;
        this.updateRuleListHeader(listType, remainingRules);
      }
    }
  }

  private toggleNarrowSidebar(): void {
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const overlay = document.getElementById('sidebarOverlay') as HTMLElement;
    const menuBtn = document.getElementById('narrowMenuBtn') as HTMLElement;
    const closeBtn = document.getElementById('narrowCloseBtn') as HTMLElement;

    if (sidebar && overlay && menuBtn) {
      const isOpen = sidebar.classList.contains('narrow-open');

      if (isOpen) {
        this.closeNarrowSidebar();
      } else {
        // Open sidebar
        sidebar.classList.add('narrow-open');
        overlay.classList.add('active');
        menuBtn.classList.add('active');
        if (closeBtn) {
          closeBtn.classList.add('visible');
        }
      }
    }
  }

  private closeNarrowSidebar(): void {
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const overlay = document.getElementById('sidebarOverlay') as HTMLElement;
    const menuBtn = document.getElementById('narrowMenuBtn') as HTMLElement;
    const closeBtn = document.getElementById('narrowCloseBtn') as HTMLElement;

    if (sidebar && overlay && menuBtn) {
      sidebar.classList.remove('narrow-open');
      overlay.classList.remove('active');
      menuBtn.classList.remove('active');
      if (closeBtn) {
        closeBtn.classList.remove('visible');
      }
    }
  }

  private handleResizeForNarrowMode(): void {
    // If we're switching from narrow to wide, make sure sidebar is closed
    if (window.innerWidth > 900) {
      this.closeNarrowSidebar();
    }

    // Sync filter values between narrow and desktop inputs
    this.syncFilterInputs();
  }

  private syncFilterInputs(): void {
    const desktopFilter = document.getElementById('filterInput') as HTMLInputElement;
    const narrowFilter = document.getElementById('narrowFilterInput') as HTMLInputElement;

    if (desktopFilter && narrowFilter) {
      // Always sync both inputs to the master filter value
      desktopFilter.value = this.filterInputValue;
      narrowFilter.value = this.filterInputValue;
    }
  }

  private async handleFiles(files: File[]): Promise<void> {
    try {
      for (const file of files) {
        // Check if it's a zip file
        if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
          await this.handleZipFile(file);
        } else {
          // Handle regular text file
          console.time(`📄 File Import: ${file.name}`);
          const text = await file.text();
          const result = await this.parser.parseFile(text, file.name);

          if (result.success) {
            this.profileCollection.addFile(result.data);
            console.timeEnd(`📄 File Import: ${file.name}`);
          } else {
            console.timeEnd(`📄 File Import: ${file.name}`);
            console.error(`Failed to parse ${file.name}:`, result.error);
            alert(`Failed to parse ${file.name}: ${result.error}`);
          }
        }
      }

      // Render new content but preserve filter state
      this.render();

      // Always reapply current filter to ensure proper visibility state
      this.setFilter(this.buildCurrentFilter());
    } catch (error) {
      console.error('Error handling files:', error);
      alert(`Error handling files: ${error}`);
    }
  }

  private async handleZipFile(file: File): Promise<void> {
    try {
      console.time(`🗜 Zip Import: ${file.name}`);
      const arrayBuffer = await file.arrayBuffer();
      const JSZipClass = await getJSZip();
      if (!JSZipClass) {
        throw new Error(
          'JSZip failed to load from CDN. Please check your internet connection and try again.'
        );
      }
      const zip = new JSZipClass();
      const zipContent = await zip.loadAsync(arrayBuffer);

      // Find stack trace files in the zip (using settings pattern)
      const pattern = this.settingsManager.getZipFilePatternRegex();
      const files = Object.keys(zipContent.files).filter(fileName => {
        return pattern.test(fileName);
      });

      for (const zipFileName of files) {
        const zipFile = zipContent.files[zipFileName];
        if (!zipFile.dir) {
          const baseName = zipFileName.split('/').pop() || zipFileName;
          console.time(`  📄 Zip Entry: ${baseName}`);
          const content = await zipFile.async('text');
          const result = await this.parser.parseFile(content, baseName);

          if (result.success) {
            this.profileCollection.addFile(result.data);
            console.timeEnd(`  📄 Zip Entry: ${baseName}`);
          } else {
            console.timeEnd(`  📄 Zip Entry: ${baseName}`);
            console.error(`Failed to parse ${baseName} from zip:`, result.error);
            alert(`Failed to parse ${baseName} from zip: ${result.error}`);
          }
        }
      }

      if (files.length === 0) {
        console.warn(`No stack trace files found in zip matching pattern: ${pattern}`);
        alert(`No stack trace files found in zip file. Looking for files matching: ${pattern}`);
      }
      console.timeEnd(`🗜 Zip Import: ${file.name}`);
    } catch (error) {
      console.timeEnd(`🗜 Zip Import: ${file.name}`);
      console.error(`Error processing zip file ${file.name}:`, error);
      alert(`Failed to process zip file ${file.name}: ${error}`);
    }
  }

  private debouncedSetFilter(query: string): void {
    // Clear any existing timer
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
    }

    // Immediate validation - show errors right away
    const parsed = this.parseFilterString(query);
    this.showFilterError(parsed.error);

    // Only set filter if valid
    if (!parsed.error) {
      // Set a new timer to apply the filter after a short delay
      this.filterDebounceTimer = window.setTimeout(() => {
        // Re-parse the current filter value to handle rapid changes
        const currentParsed = this.parseFilterString(this.filterInputValue);
        if (!currentParsed.error) {
          this.setFilter({
            filterString: currentParsed.filterString,
            minWait: currentParsed.minWait,
            maxWait: currentParsed.maxWait,
          });
        }
        this.saveUIState();
        this.filterDebounceTimer = null;
      }, 300);
    }
  }

  private showFilterError(error?: string): void {
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    const filterError = document.getElementById('filterError') as HTMLElement;

    if (error) {
      filterInput.classList.add('error');
      filterError.textContent = error;
      filterError.style.display = 'block';
    } else {
      filterInput.classList.remove('error');
      filterError.style.display = 'none';
    }
  }

  private setFilter(filter: Filter): void {
    this.profileCollection.setFilter(filter);
    this.updateVisibility();
    this.updateStats();
  }

  private parseWaitValue(value: string): number | null {
    // More strict parsing than parseFloat - reject strings with invalid characters
    if (!/^\d*\.?\d+$/.test(value.trim())) {
      return null;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  private parseFilterString(input: string): {
    filterString: string;
    minWait?: number;
    maxWait?: number;
    error?: string;
  } {
    const parts = input
      .split(' ')
      .map(p => p.trim())
      .filter(p => p.length > 0);
    const waitParts: string[] = [];
    const textParts: string[] = [];

    let minWait: number | undefined;
    let maxWait: number | undefined;
    let hasMinConstraint = false;
    let hasMaxConstraint = false;
    let hasExactConstraint = false;

    for (const part of parts) {
      if (part.startsWith('wait:')) {
        waitParts.push(part);
        const waitSpec = part.substring(5); // Remove 'wait:' prefix

        if (waitSpec.startsWith('>')) {
          if (hasMinConstraint) {
            return {
              filterString: '',
              error: 'Multiple minimum wait constraints not allowed (e.g., wait:>5 wait:>10)',
            };
          }
          if (hasExactConstraint) {
            return {
              filterString: '',
              error: 'Exact wait time cannot be combined with other wait constraints',
            };
          }
          const value = this.parseWaitValue(waitSpec.substring(1));
          if (value === null) {
            return { filterString: '', error: `Invalid wait filter: ${part}` };
          }
          minWait = value + 1;
          hasMinConstraint = true;
        } else if (waitSpec.startsWith('<')) {
          if (hasMaxConstraint) {
            return {
              filterString: '',
              error: 'Multiple maximum wait constraints not allowed (e.g., wait:<5 wait:<10)',
            };
          }
          if (hasExactConstraint) {
            return {
              filterString: '',
              error: 'Exact wait time cannot be combined with other wait constraints',
            };
          }
          const value = this.parseWaitValue(waitSpec.substring(1));
          if (value === null) {
            return { filterString: '', error: `Invalid wait filter: ${part}` };
          }
          maxWait = value - 1;
          hasMaxConstraint = true;
        } else if (waitSpec.endsWith('+')) {
          // wait:5+ means >= 5 (same as wait:>4)
          if (hasMinConstraint) {
            return {
              filterString: '',
              error: 'Multiple minimum wait constraints not allowed (e.g., wait:5+ wait:>10)',
            };
          }
          if (hasExactConstraint) {
            return {
              filterString: '',
              error: 'Exact wait time cannot be combined with other wait constraints',
            };
          }
          const value = this.parseWaitValue(waitSpec.slice(0, -1));
          if (value === null) {
            return { filterString: '', error: `Invalid wait filter: ${part}` };
          }
          minWait = value;
          hasMinConstraint = true;
        } else if (waitSpec.includes('-')) {
          // wait:4-9 means >= 4 and <= 9
          if (hasMinConstraint || hasMaxConstraint) {
            return {
              filterString: '',
              error: 'Range wait constraint cannot be combined with other wait constraints',
            };
          }
          if (hasExactConstraint) {
            return {
              filterString: '',
              error: 'Exact wait time cannot be combined with other wait constraints',
            };
          }
          const parts = waitSpec.split('-');
          if (parts.length !== 2) {
            return { filterString: '', error: `Invalid range format: ${part} (use wait:min-max)` };
          }
          const minValue = this.parseWaitValue(parts[0]);
          const maxValue = this.parseWaitValue(parts[1]);
          if (minValue === null || maxValue === null) {
            return { filterString: '', error: `Invalid wait filter: ${part}` };
          }
          if (minValue > maxValue) {
            return {
              filterString: '',
              error: `Invalid range: minimum (${minValue}) cannot be greater than maximum (${maxValue})`,
            };
          }
          minWait = minValue;
          maxWait = maxValue;
          hasMinConstraint = true;
          hasMaxConstraint = true;
        } else {
          if (hasExactConstraint) {
            return {
              filterString: '',
              error: 'Multiple exact wait constraints not allowed (e.g., wait:5 wait:10)',
            };
          }
          if (hasMinConstraint || hasMaxConstraint) {
            return {
              filterString: '',
              error: 'Exact wait time cannot be combined with other wait constraints',
            };
          }
          const value = this.parseWaitValue(waitSpec);
          if (value === null) {
            return { filterString: '', error: `Invalid wait filter: ${part}` };
          }
          minWait = value;
          maxWait = value;
          hasExactConstraint = true;
        }
      } else {
        textParts.push(part);
      }
    }

    // Validation: only one non-wait string allowed
    if (textParts.length > 1) {
      return { filterString: '', error: 'Only one search term allowed (plus wait: filters)' };
    }

    // Validation: 0 <= min <= max
    if (minWait !== undefined && minWait < 0) {
      return { filterString: '', error: 'Minimum wait time cannot be negative' };
    }
    if (maxWait !== undefined && maxWait < 0) {
      return { filterString: '', error: 'Maximum wait time cannot be negative' };
    }
    if (minWait !== undefined && maxWait !== undefined && minWait > maxWait) {
      return { filterString: '', error: 'Minimum wait time cannot be greater than maximum' };
    }

    return {
      filterString: textParts.join(' '),
      minWait,
      maxWait,
    };
  }

  private buildCurrentFilter(overrides: Partial<Filter> = {}): Filter {
    const parsed = this.parseFilterString(this.filterInputValue);
    return {
      filterString: parsed.filterString,
      minWait: parsed.minWait,
      maxWait: parsed.maxWait,
      ...overrides,
    };
  }

  private clearFilter(): void {
    // Clear any pending debounced filter
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = null;
    }

    this.filterInputValue = '';
    this.syncFilterInputs();

    this.showFilterError(); // Clear any error display
    this.profileCollection.clearFilter();

    this.updateVisibility();
    this.updateStats();
    this.saveUIState();
  }

  private clearAllFiles(): void {
    // Clear the profile collection
    this.profileCollection.clear();

    // Update the drop zone - this will restore the initial state with demo buttons
    this.updateDropZone();

    // Update the file list - this will show the empty state with drop target
    this.renderFiles();

    // Update stats
    this.updateStats();

    this.saveUIState();
  }

  private initializeTheme(): void {
    // Priority: savedTheme > initialTheme > 'dark' default
    const savedTheme = localStorage.getItem('stackgazer-theme') as 'dark' | 'light' | null;
    this.currentTheme = savedTheme || this.initialTheme || 'dark';
    this.applyTheme(this.currentTheme);
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(this.currentTheme);
    localStorage.setItem('stackgazer-theme', this.currentTheme);
  }

  private applyTheme(theme: 'dark' | 'light'): void {
    const body = document.body;
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    if (theme === 'light') {
      body.setAttribute('data-theme', 'light');
      if (themeToggleBtn) {
        themeToggleBtn.textContent = '☀️';
        themeToggleBtn.title = 'Switch to dark theme';
      }
    } else {
      body.removeAttribute('data-theme');
      if (themeToggleBtn) {
        themeToggleBtn.textContent = '🌙';
        themeToggleBtn.title = 'Switch to light theme';
      }
    }
  }

  private expandAllStacks(): void {
    const categories = document.querySelectorAll('.category-section');
    const hasCollapsedCategories = Array.from(categories).some(cat =>
      cat.classList.contains('container-collapsed')
    );

    if (hasCollapsedCategories) {
      categories.forEach(section => {
        // PERFORMANCE FIX: Set styles directly to avoid CSS cascade
        const content = section.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = '';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes

        section.classList.remove('container-collapsed');

        // Skip aria updates for performance
      });
    } else {
      const stacks = document.querySelectorAll('.stack-section');
      stacks.forEach(section => {
        // PERFORMANCE FIX: Set styles directly to avoid CSS cascade
        const content = section.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = '';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes

        section.classList.remove('container-collapsed');

        // Skip aria updates for performance
      });
    }
  }

  private collapseAllStacks(): void {
    const stacks = document.querySelectorAll('.stack-section');
    const hasExpandedStacks = Array.from(stacks).some(
      stack => !stack.classList.contains('container-collapsed')
    );

    if (hasExpandedStacks) {
      // Collapse stacks using consistent CSS class approach
      stacks.forEach(section => {
        const content = section.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = 'none';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes

        // Use consistent CSS class for all containers
        section.classList.add('container-collapsed');
      });
    } else {
      const categories = document.querySelectorAll('.category-section');

      categories.forEach(section => {
        const content = section.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = 'none';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes

        section.classList.add('container-collapsed');
      });
    }
  }

  private toggleContainerCollapse(container: HTMLElement): void {
    // Determine if this is a container (category/stack) or section (file/group)
    const isContainer =
      container.classList.contains('category-section') ||
      container.classList.contains('stack-section');

    if (isContainer) {
      // Use consistent CSS class approach for all containers
      const wasCollapsed = container.classList.contains('container-collapsed');

      if (wasCollapsed) {
        // Expand: Remove collapse class and reset display
        container.classList.remove('container-collapsed');

        const content = container.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = '';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes
      } else {
        // Collapse: Add CSS class and hide content
        container.classList.add('container-collapsed');

        const content = container.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = 'none';
        }

        // Icon is handled by CSS pseudo-elements based on collapsed classes
      }
    } else {
      container.classList.toggle('section-collapsed');
    }
  }

  private updateVisibility(force: boolean = false): void {
    const categories = this.profileCollection.getCategories();

    // Smart propagation: Only check if any groups are dirty first
    let hasAnyDirtyGroups = false;
    for (const category of categories) {
      for (const stack of category.stacks) {
        for (const fileSection of stack.files) {
          for (const group of fileSection.groups) {
            if (group.counts.visibilityChanged) {
              hasAnyDirtyGroups = true;
              break;
            }
          }
          if (hasAnyDirtyGroups) break;
        }
        if (hasAnyDirtyGroups) break;
      }
      if (hasAnyDirtyGroups) break;
    }

    // Only do expensive propagation if needed
    if (hasAnyDirtyGroups) {
      for (const category of categories) {
        for (const stack of category.stacks) {
          for (const fileSection of stack.files) {
            // Propagate dirty state from groups to file section
            fileSection.counts.visibilityChanged = fileSection.groups.reduce(
              (dirty, group) => dirty || group.counts.visibilityChanged,
              false
            );
          }
          // Propagate dirty state from file sections to stack
          stack.counts.visibilityChanged = stack.files.reduce(
            (dirty, fileSection) => dirty || fileSection.counts.visibilityChanged,
            false
          );
        }
        // Propagate dirty state from stacks to category
        category.counts.visibilityChanged = category.stacks.reduce(
          (dirty, stack) => dirty || stack.counts.visibilityChanged,
          false
        );
      }
    }

    // Process each category with hierarchical change detection
    for (const category of categories) {
      // Use new visibilityChanged approach
      if (!force && !category.counts.visibilityChanged) {
        continue;
      }
      const categoryElement = document.getElementById(category.id) as HTMLElement;
      if (!categoryElement) {
        continue;
      }

      if (category.counts.matches == 0) {
        // Hide the whole category; nothing else to do.
        categoryElement.classList.add('filtered');
      } else {
        // Unhide if needed and set the header.
        categoryElement.classList.remove('filtered');
        this.updateDisplayedCount(categoryElement, category.counts);

        // Process each stack in the category
        for (const stack of category.stacks) {
          // Use new visibilityChanged approach
          if (!force && !stack.counts.visibilityChanged) {
            continue;
          }
          const stackElement = document.getElementById(stack.id) as HTMLElement;
          if (!stackElement) {
            continue;
          }

          if (stack.counts.matches == 0) {
            // Hide the whole stack; nothing else to do.
            stackElement.classList.add('filtered');
          } else {
            // Unhide if needed and set the header.
            stackElement.classList.remove('filtered');
            this.updateDisplayedCount(stackElement, stack.counts);

            for (const fileSection of stack.files) {
              if (!force && !fileSection.counts.visibilityChanged) {
                continue;
              }
              const fileSectionElement = document.getElementById(fileSection.id) as HTMLElement;
              if (!fileSectionElement) {
                continue;
              }

              if (fileSection.counts.matches === 0) {
                fileSectionElement.classList.add('filtered');
              } else {
                // Unhide if needed and set the header.
                fileSectionElement.classList.remove('filtered');
                this.updateDisplayedCount(fileSectionElement, fileSection.counts);

                for (const group of fileSection.groups) {
                  if (!force && !group.counts.visibilityChanged) {
                    continue;
                  }
                  const groupElement = document.getElementById(group.id) as HTMLElement;
                  if (!groupElement) {
                    continue;
                  }
                  if (group.counts.matches === 0) {
                    groupElement.classList.add('filtered');
                  } else {
                    // Unhide if needed and set the header.
                    groupElement.classList.remove('filtered');
                    this.updateDisplayedCount(groupElement, group.counts);

                    for (const goroutine of group.goroutines) {
                      const goroutineElement = document.getElementById(
                        `goroutine-${goroutine.id}`
                      ) as HTMLElement;
                      if (goroutineElement) {
                        goroutineElement.classList.toggle('filtered', !goroutine.matches);
                      }
                    }
                  }
                  // Reset group dirty flag after processing
                  group.counts.visibilityChanged = false;
                }
                // Reset file section dirty flag after processing
                fileSection.counts.visibilityChanged = false;
              }
            }
            // Reset stack dirty flag after processing
            stack.counts.visibilityChanged = false;
          }
        }
        // Reset category dirty flag after processing
        category.counts.visibilityChanged = false;
      }
    }
  }

  updateDisplayedCount(element: HTMLElement, counts: Counts): void {
    const countElement = element.querySelector('.counts');

    if (countElement) {
      if (counts.total === counts.filterMatches) {
        countElement.textContent = `${counts.total} goroutines`;
      } else {
        countElement.textContent = `${counts.filterMatches} (of ${counts.total}) goroutines`;
      }
    }
  }

  private render(): void {
    this.renderFiles();
    this.renderStacks();
    this.updateDropZone();
    this.profileCollection.setFilter(this.buildCurrentFilter());
    this.updateVisibility(true); // Force update all counts after full render
    this.updateStats();
  }

  private addExpandCollapseHandler(container: HTMLElement): void {
    const header = container.querySelector('.header') as HTMLElement;
    if (!header) return;

    // Store selection state on the header element
    header.addEventListener('mousedown', this.handleHeaderMouseDown.bind(this));
    header.addEventListener('mouseup', this.handleHeaderMouseUp.bind(this));
  }

  private handleHeaderMouseDown(e: MouseEvent): void {
    const header = e.currentTarget as HTMLElement;
    const selection = window.getSelection();
    // Store selection state on the header element
    (header as any).__selectionAtMouseDown = selection ? selection.toString() : '';
  }

  private handleHeaderMouseUp(e: MouseEvent): void {
    const header = e.currentTarget as HTMLElement;
    const container = header.closest('.section') as HTMLElement;
    if (!container) return;

    // Don't toggle if clicking on a button (pin, copy, etc.)
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) {
      return;
    }

    // Check if selection changed during the drag
    const selection = window.getSelection();
    const selectionAtMouseUp = selection ? selection.toString() : '';
    const selectionAtMouseDown = (header as any).__selectionAtMouseDown || '';

    // If selection changed during drag, don't toggle
    if (selectionAtMouseDown !== selectionAtMouseUp) {
      return; // User was selecting text
    }

    // No selection change - proceed with toggle
    e.stopPropagation();
    e.preventDefault();

    const wasExpanded =
      !container.classList.contains('container-collapsed') ||
      container.classList.contains('section-collapsed');

    // Simply toggle the collapsed class
    this.toggleContainerCollapse(container);

    // If we just collapsed and the header is above the viewport, scroll to it
    if (wasExpanded) {
      const headerRect = header.getBoundingClientRect();
      if (headerRect.top < 0) {
        header.scrollIntoView({ behavior: 'instant', block: 'start' });
        // For stack headers that are above viewport, scrolling "into view"
        // still leaves them behind the category header, so if that happens,
        // we can scroll them again but this time with a scroll margin set to
        // the height of the cat header (or just a tad less to avoid a gap),
        // then restore its scroll margin.
        if (container.classList.contains('stack-section')) {
          const parentCategory = container.closest('.category-section');
          const parentHeader = parentCategory
            ? (parentCategory.querySelector('.header') as HTMLElement)
            : null;
          if (parentHeader) {
            const headerHeight = parentHeader.clientHeight;
            const tmp = header.style.scrollMarginTop;
            header.style.scrollMarginTop = `${headerHeight - 2}px`;
            header.scrollIntoView({ behavior: 'instant', block: 'start' });
            header.style.scrollMarginTop = tmp;
          }
        }
      }
    }

    // Skip aria-expanded for performance
  }

  private renderFiles(): void {
    const fileList = document.getElementById('fileList');
    const fileListContainer = document.getElementById('fileListContainer');
    if (!fileList) return;

    const fileNames = this.profileCollection.getFileNames();

    fileList.innerHTML = '';

    if (fileNames.length === 0) {
      // Clone empty state template
      const emptyClone = this.templates.fileEmptyState.content.cloneNode(true) as DocumentFragment;
      const emptyState = emptyClone.firstElementChild as HTMLElement;

      emptyState.classList.add('cursor-pointer');
      emptyState.addEventListener('click', () => {
        this.openFileDialog();
      });
      fileList.appendChild(emptyState);

      // Keep has-files class even when empty to maintain drop target styling
      if (fileListContainer) {
        fileListContainer.classList.add('has-files');
      }
      return;
    }

    // Add has-files class when files exist to show drop area
    if (fileListContainer) {
      fileListContainer.classList.add('has-files');
    }

    // Get visible counts by file (need to implement this in ProfileCollection)
    const fileStatsByName = this.getFileStatistics();

    fileNames.forEach(fileName => {
      // Clone file item template
      const itemClone = this.templates.fileItem.content.cloneNode(true) as DocumentFragment;
      const fileItem = itemClone.firstElementChild as HTMLElement;

      fileItem.dataset.fileName = fileName; // Store fileName for lookups

      // Set file name
      const fileNameSpan = fileItem.querySelector('.file-name-text') as HTMLElement;
      fileNameSpan.textContent = fileName;
      fileNameSpan.dataset.fileName = fileName;
      fileNameSpan.addEventListener('click', this.handleFileRenameClick.bind(this));

      // Set file statistics
      const stats = fileStatsByName.get(fileName) || { visible: 0, total: 0 };
      const statsDiv = fileItem.querySelector('.file-stats') as HTMLElement;
      statsDiv.textContent = `${stats.visible} / ${stats.total} goroutines`;

      // Setup remove button
      const removeBtn = fileItem.querySelector('.file-remove-btn') as HTMLButtonElement;
      removeBtn.dataset.fileName = fileName;
      removeBtn.addEventListener('click', this.handleFileRemoveClick.bind(this));

      fileList.appendChild(fileItem);
    });

    // Add drop area at the bottom when there are files
    const dropClone = this.templates.fileDropArea.content.cloneNode(true) as DocumentFragment;
    const dropArea = dropClone.firstElementChild as HTMLElement;
    fileList.appendChild(dropArea);
  }

  private renderStacks(): void {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    const categories = this.profileCollection.getCategories();

    if (categories.length === 0) {
      this.updateDropZone();
      return;
    }

    dropZone.className = 'drop-zone has-content';

    const stackDisplay = document.createElement('div');
    stackDisplay.className = 'stack-display';
    stackDisplay.id = 'stackDisplay';

    // Render categories in existing order (sorted at import time)
    categories.forEach(category => {
      const categoryElement = this.createCategoryElement(category);
      stackDisplay.appendChild(categoryElement);
    });

    dropZone.innerHTML = '';
    dropZone.appendChild(stackDisplay);
  }

  private createCategoryElement(category: Category): HTMLElement {
    // Clone template
    const clone = this.templates.category.content.cloneNode(true) as DocumentFragment;
    const categoryElement = clone.firstElementChild as HTMLElement;

    // Set category-specific attributes
    categoryElement.id = category.id;
    categoryElement.dataset.pinType = 'category';
    categoryElement.dataset.pinId = category.id;

    // Set content
    const title = categoryElement.querySelector('.category-title') as HTMLElement;
    title.textContent = category.name;

    // Setup pin button with bound method (no closure allocation)
    const pinButton = categoryElement.querySelector('.pin-button') as HTMLButtonElement;
    pinButton.title = 'Pin/unpin this category';
    pinButton.addEventListener('click', this.handlePinButtonClick.bind(this));
    pinButton.addEventListener('dblclick', this.handlePinButtonDoubleClick.bind(this));

    // Set initial count display
    this.updateDisplayedCount(categoryElement, category.counts);

    // Get content area and add stacks
    const content = categoryElement.querySelector('.category-content') as HTMLElement;

    // Render all stacks in this category in existing order (sorted at import time)
    for (const stack of category.stacks) {
      const stackElement = this.createStackElement(stack, category);
      content.appendChild(stackElement);
    }

    // Add expand/collapse functionality to the category
    this.addExpandCollapseHandler(categoryElement);

    return categoryElement;
  }

  private createStackElement(stack: UniqueStack, category: Category): HTMLElement {
    // Clone template
    const clone = this.templates.stack.content.cloneNode(true) as DocumentFragment;
    const stackElement = clone.firstElementChild as HTMLElement;

    // Set stack-specific attributes
    stackElement.id = stack.id;
    stackElement.dataset.pinType = 'stack';
    stackElement.dataset.pinId = stack.id;

    // Set content
    const title = stackElement.querySelector('.stack-title') as HTMLElement;
    title.textContent = stack.name;

    // Setup pin button with bound method (no closure allocation)
    const pinButton = stackElement.querySelector('.pin-button') as HTMLButtonElement;
    pinButton.title = 'Pin/unpin this stack';
    pinButton.addEventListener('click', this.handlePinButtonClick.bind(this));
    pinButton.addEventListener('dblclick', this.handlePinButtonDoubleClick.bind(this));

    // Setup copy button with bound method (no closure allocation)
    const copyButton = stackElement.querySelector('.copy-button') as HTMLButtonElement;
    copyButton.title = 'Copy stack name and trace to clipboard';
    copyButton.dataset.stackId = stack.id;
    copyButton.dataset.categoryId = category.id;
    copyButton.addEventListener('click', this.handleCopyButtonClick.bind(this));

    // Set initial count display
    this.updateDisplayedCount(stackElement, stack.counts);

    // Get content area and add stack trace + file sections
    const content = stackElement.querySelector('.stack-content') as HTMLElement;

    // Render stack trace
    const traceElement = this.createTraceElement(stack.trace);
    content.appendChild(traceElement);

    // Render all groups in existing order (sorted at import time)
    const fileEntries = stack.files;

    for (const fileSection of fileEntries) {
      // Create file section DOM element
      const fileSectionElement = this.createFileSection(
        fileSection.id,
        fileSection.fileName,
        fileSection.groups
      );
      content.appendChild(fileSectionElement);
    }

    // Add expand/collapse functionality to the stack
    this.addExpandCollapseHandler(stackElement);

    return stackElement;
  }

  private createFileSection(fileId: string, fileName: string, groups: Group[]): HTMLElement {
    // Clone template
    const clone = this.templates.fileSection.content.cloneNode(true) as DocumentFragment;
    const fileSection = clone.firstElementChild as HTMLElement;

    // Set file-specific attributes
    fileSection.id = fileId;

    // Add single-group class for conditional file header hiding
    if (groups.length === 1) {
      fileSection.classList.add('single-group');
    }

    // Set file name
    const fileNameElement = fileSection.querySelector('.file-name') as HTMLElement;
    fileNameElement.textContent = fileName;

    // Get content area and add groups
    const fileContent = fileSection.querySelector('.section-content') as HTMLElement;

    groups.forEach(group => {
      const groupSection = this.createGroupSection(group.id, group, fileName);
      fileContent.appendChild(groupSection);
    });

    // Add click handler for file header using reusable function AFTER DOM structure is complete
    this.addExpandCollapseHandler(fileSection);

    return fileSection;
  }

  private createGroupSection(id: string, group: Group, fileName?: string): HTMLElement {
    // Clone template
    const clone = this.templates.group.content.cloneNode(true) as DocumentFragment;
    const groupSection = clone.firstElementChild as HTMLElement;

    // Set group-specific attributes
    groupSection.id = id;
    groupSection.dataset.pinType = 'group';
    groupSection.dataset.pinId = group.id;

    // Handle expand icon for groups with content
    const expandIcon = groupSection.querySelector('.expand-icon') as HTMLElement;
    if (group.goroutines.length === 0) {
      expandIcon.remove();
    }

    // Set group label text
    const textSpan = groupSection.querySelector('.group-header-label') as HTMLElement;

    // Always show filename with group labels for consistency
    if (fileName) {
      const groupLabel = group.labels.length > 0 ? ` [${group.labels.join(', ')}]` : '';
      textSpan.textContent = `${fileName}${groupLabel}`;
    } else if (group.labels.length > 0) {
      textSpan.textContent = `[${group.labels.join(', ')}]`;
    } else {
      textSpan.textContent = 'Goroutines';
    }

    // Setup pin button with bound method (no closure allocation)
    const pinButton = groupSection.querySelector('.pin-button') as HTMLButtonElement;
    pinButton.title = 'Pin/unpin this group';
    pinButton.addEventListener('click', this.handlePinButtonClick.bind(this));
    pinButton.addEventListener('dblclick', this.handlePinButtonDoubleClick.bind(this));

    // Add click handler for expand/collapse if group has content
    if (group.goroutines.length > 0) {
      this.addExpandCollapseHandler(groupSection);
    }

    // Get content area and add goroutines
    const groupContent = groupSection.querySelector('.section-content') as HTMLElement;

    const maxInitialShow = 4;
    const initialGoroutines = group.goroutines.slice(0, maxInitialShow);
    const remainingGoroutines = group.goroutines.slice(maxInitialShow);

    // Add initial visible goroutines
    initialGoroutines.forEach(goroutine => {
      const goroutineElement = this.createGoroutineElement(goroutine);
      groupContent.appendChild(goroutineElement);
    });

    // Add "show more" section if there are remaining goroutines
    if (remainingGoroutines.length > 0) {
      const showMoreClone = this.templates.showMore.content.cloneNode(true) as DocumentFragment;
      const showMoreLink = showMoreClone.firstElementChild as HTMLElement;

      const countSpan = showMoreLink.querySelector('.show-more-link-clickable') as HTMLElement;
      countSpan.textContent = remainingGoroutines.length.toString();

      // Store group ID to find group in data model
      showMoreLink.dataset.groupId = group.id;
      showMoreLink.addEventListener('click', this.handleShowMoreClick.bind(this));
      groupContent.appendChild(showMoreLink);
    }

    return groupSection;
  }

  private createTraceElement(trace: any[]): HTMLElement {
    // Clone template
    const clone = this.templates.stackTrace.content.cloneNode(true) as DocumentFragment;
    const content = clone.firstElementChild as HTMLElement;

    content.setAttribute('data-display-mode', this.stackDisplayMode);

    // Store trace data for later regeneration
    (content as any).__traceData = trace;

    // Generate the current display mode content
    this.updateTraceElementContent(content, trace);

    return content;
  }

  private updateTraceElementContent(content: HTMLElement, trace: any[]): void {
    const mode = content.getAttribute('data-display-mode') || 'combined';

    let html = '';
    switch (mode) {
      case 'combined':
        html = this.formatStackCombined(trace);
        break;
      case 'side-by-side':
        html = this.formatStackSideBySide(trace);
        break;
      case 'functions':
        html = this.formatStackFunctions(trace);
        break;
      case 'locations':
        html = this.formatStackLocations(trace);
        break;
      default:
        html = this.formatStackCombined(trace);
    }

    content.innerHTML = html;
  }

  private createGoroutineElement(goroutine: Goroutine): HTMLElement {
    // Clone template
    const clone = this.templates.goroutine.content.cloneNode(true) as DocumentFragment;
    const goroutineElement = clone.firstElementChild as HTMLElement;

    // Set goroutine-specific attributes
    goroutineElement.id = `goroutine-${goroutine.id}`;
    goroutineElement.dataset.pinType = 'goroutine';
    goroutineElement.dataset.pinId = goroutine.id;

    // Setup pin button with bound method (no closure allocation)
    const pinButton = goroutineElement.querySelector('.pin-button') as HTMLButtonElement;
    pinButton.title = 'Pin/unpin this goroutine';
    pinButton.addEventListener('click', this.handlePinButtonClick.bind(this));

    // Set header text
    const waitText = goroutine.waitMinutes > 0 ? ` (${goroutine.waitMinutes} minutes)` : '';
    const headerLeft = goroutineElement.querySelector('.goroutine-header-left') as HTMLElement;
    headerLeft.textContent = `${goroutine.id}${waitText}:`;

    // Handle created by section
    const createdBySection = goroutineElement.querySelector('.goroutine-created-by') as HTMLElement;

    if (goroutine.creator && goroutine.creator !== goroutine.id) {
      createdBySection.innerHTML = 'created by ';

      if (goroutine.creatorExists) {
        const creatorLink = document.createElement('span');
        creatorLink.className = 'creator-link';
        creatorLink.textContent = goroutine.creator;
        creatorLink.dataset.targetId = goroutine.creator;
        creatorLink.dataset.sourceId = goroutine.id;
        creatorLink.addEventListener('click', this.handleNavigationClick.bind(this));
        this.addTooltipToLink(creatorLink, goroutine.creator);
        createdBySection.appendChild(creatorLink);
      } else {
        const missingCreator = document.createElement('span');
        missingCreator.className = 'creator-missing';
        missingCreator.textContent = goroutine.creator;
        createdBySection.appendChild(missingCreator);
      }
    } else {
      // Remove the created by section if no creator
      createdBySection.remove();
    }

    // Handle second line with created goroutines
    const secondLine = goroutineElement.querySelector(
      '.goroutine-header-second-line'
    ) as HTMLElement;

    if (goroutine.created.length > 0) {
      // Generate unique ID for the second line for "show more" functionality
      const secondLineId = `second-line-${goroutine.id}`;
      secondLine.id = secondLineId;
      const createdText = document.createElement('span');
      createdText.className = 'created-goroutines-label';
      createdText.textContent = `created ${goroutine.created.length} goroutine${goroutine.created.length > 1 ? 's' : ''}: `;
      secondLine.appendChild(createdText);

      // Show first few created goroutines as clickable links
      const maxShow = 5;
      const toShow = goroutine.created.slice(0, maxShow);

      toShow.forEach((created, index) => {
        if (index > 0) {
          const separator = document.createElement('span');
          separator.textContent = ', ';
          secondLine.appendChild(separator);
        }

        const createdLink = document.createElement('span');
        createdLink.className = 'creator-link';
        createdLink.textContent = created;
        createdLink.dataset.targetId = created;
        createdLink.dataset.sourceId = goroutine.id;
        createdLink.addEventListener('click', this.handleNavigationClick.bind(this));
        this.addTooltipToLink(createdLink, created);
        secondLine.appendChild(createdLink);
      });

      if (goroutine.created.length > maxShow) {
        const moreText = document.createElement('span');
        moreText.textContent = ' and ';

        const moreLink = document.createElement('span');
        moreLink.textContent = `${goroutine.created.length - maxShow} more`;
        moreLink.className = 'created-goroutines-more creator-link';
        moreLink.classList.add('cursor-pointer');
        moreLink.dataset.creatorId = goroutine.id;
        moreLink.dataset.secondLineId = secondLineId;
        moreLink.addEventListener('click', this.handleShowAllCreatedClick.bind(this));
        secondLine.appendChild(moreText);
        secondLine.appendChild(moreLink);
      }
    } else {
      // Remove the second line if no created goroutines
      secondLine.remove();
    }

    return goroutineElement;
  }

  private updateDropZone(): void {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    const categories = this.profileCollection.getCategories();

    if (categories.length === 0) {
      dropZone.classList.remove('has-content');
      dropZone.innerHTML = `
        <div class="drop-message">
          <div>📁 Drop Go stack trace files here to get started</div>
          <div class="demo-add-files">or click + to select files</div>
          <div class="demo-add-files">🔒 all analysis is in-browser - nothing is uploaded</div>
          <div class="demo-section-divider">
            <div class="demo-try-demo">⚡️ Or try a quick demo with some example CockroachDB stack dumps:</div>
            <div class="demo-buttons">
              <a id="demoSingleBtn" href="#" class="demo-link">📄 single file →</a>
              <a id="demoZipBtn" href="#" class="demo-link">📦 zip file of 4 stacks →</a>
            </div>
          </div>
        </div>
      `;

      // Setup demo button event listeners
      this.setupDemoButtons();
    }
  }

  private updateStats(): void {
    const stats = this.profileCollection.getStackStatistics();

    const stackCountsElement = document.getElementById('stackCounts');
    const goroutineCountsElement = document.getElementById('goroutineCounts');

    if (stackCountsElement) {
      // Calculate pinned stacks (stacks visible due to pinning)
      let pinnedStacks = 0;
      this.profileCollection.getCategories().forEach(cat => {
        for (const stack of cat.stacks) {
          if (stack.counts.pinned > 0) {
            pinnedStacks++;
          }
        }
      });

      if (pinnedStacks > 0) {
        stackCountsElement.textContent = `${stats.visible} (${pinnedStacks}📌) / ${stats.total}`;
      } else {
        stackCountsElement.textContent = `${stats.visible} / ${stats.total}`;
      }
    }
    if (goroutineCountsElement) {
      if (stats.pinnedGoroutines > 0) {
        goroutineCountsElement.textContent = `${stats.visibleGoroutines} (${stats.pinnedGoroutines}📌) / ${stats.totalGoroutines}`;
      } else {
        goroutineCountsElement.textContent = `${stats.visibleGoroutines} / ${stats.totalGoroutines}`;
      }
    }

    // Update state statistics in headers and sidebar
    this.updateStateStats();
    this.updateSidebarStateStats();

    // Also update file stats and unpin button visibility
    this.updateFileStats();
    this.updateUnpinButtonVisibility();
  }

  private updateStateStats(): void {
    // Update state stats in category and stack headers
    const categories = this.profileCollection.getCategories();

    for (const category of categories) {
      this.updateCategoryStateStats(category);

      for (const stack of category.stacks) {
        this.updateStackStateStats(stack);
      }
    }
  }

  private updateCategoryStateStats(category: Category): void {
    const categoryElement = document.getElementById(category.id);
    if (!categoryElement) return;

    const statsElement = categoryElement.querySelector('.category-stats') as HTMLElement;
    if (!statsElement) return;

    // Get state counts from category
    const stateEntries = Array.from(category.counts.matchingStates.entries());
    const sortedEntries = sortStateEntries(stateEntries);

    if (sortedEntries.length === 0) {
      statsElement.textContent = '';
      return;
    }

    const stateElements = sortedEntries.map(([state, count]) => {
      return `${count} ${state}`;
    });

    // Add wait time range
    const waitText = this.formatWaitTime(
      category.counts.minMatchingWait,
      category.counts.maxMatchingWait
    );
    statsElement.textContent = waitText
      ? `${stateElements.join(', ')} • ${waitText}`
      : stateElements.join(', ');
  }

  private updateStackStateStats(stack: UniqueStack): void {
    const stackElement = document.getElementById(stack.id);
    if (!stackElement) return;

    const statsElement = stackElement.querySelector('.stack-stats') as HTMLElement;
    if (!statsElement) return;

    // Get state counts from stack
    const stateEntries = Array.from(stack.counts.matchingStates.entries());
    const sortedEntries = sortStateEntries(stateEntries);

    if (sortedEntries.length === 0) {
      statsElement.textContent = '';
      return;
    }

    const stateElements = sortedEntries.map(([state, count]) => {
      return `${count} ${state}`;
    });

    // Add wait time range
    const waitText = this.formatWaitTime(
      stack.counts.minMatchingWait,
      stack.counts.maxMatchingWait
    );
    statsElement.textContent = waitText
      ? `${stateElements.join(', ')} • ${waitText}`
      : stateElements.join(', ');
  }

  private formatWaitTime(minWait: number, maxWait: number): string {
    if (minWait === 0 && maxWait === 0) return '';
    if (minWait === maxWait) return `${minWait}mins`;
    return `${minWait}-${maxWait}mins`;
  }

  private updateSidebarStateStats(): void {
    const sidebarStateStats = document.getElementById('stateStats');
    if (!sidebarStateStats) return;

    // Get aggregate state statistics from ProfileCollection
    const stateStats = this.profileCollection.getStateStatistics();

    if (stateStats.size === 0) {
      sidebarStateStats.textContent = '';
      return;
    }

    // Convert to sorted array using the sortStateEntries function from types
    const sortedStates = Array.from(stateStats.entries());
    const sortedEntries = sortStateEntries(sortedStates);

    const stateElements = sortedEntries.map(([state, counts]) => {
      return `<div><span>${state}</span><span>${counts.visible} / ${counts.total}</span></div>`;
    });

    sidebarStateStats.innerHTML = stateElements.join('');
  }

  /**
   * Refresh pin states for all DOM elements to match the data model
   */
  private refreshPinStates(): void {
    // Update all category pin states
    const categories = this.profileCollection.getCategories();
    for (const category of categories) {
      const categoryElement = document.getElementById(category.id);
      const categoryPinButton = categoryElement?.querySelector('.pin-button');
      if (categoryElement && categoryPinButton) {
        categoryElement.classList.toggle('pinned', category.pinned);
        categoryPinButton.classList.toggle('pinned', category.pinned);
      }
      for (const stack of category.stacks) {
        const stackElement = document.getElementById(stack.id);
        const stackPinButton = stackElement?.querySelector('.pin-button');
        if (stackElement && stackPinButton) {
          stackElement.classList.toggle('pinned', stack.pinned);
          stackPinButton.classList.toggle('pinned', stack.pinned);
        }

        // Update all group pin states
        for (const fileSection of stack.files) {
          for (const group of fileSection.groups) {
            const groupElement = document.getElementById(group.id);
            const groupPinButton = groupElement?.querySelector('.pin-button');
            if (groupElement && groupPinButton) {
              groupElement.classList.toggle('pinned', group.pinned);
              groupPinButton.classList.toggle('pinned', group.pinned);
            }

            // Update all goroutine pin states
            for (const goroutine of group.goroutines) {
              const goroutineElement = document.getElementById(`goroutine-${goroutine.id}`);
              const goroutinePinButton = goroutineElement?.querySelector('.pin-button');
              if (goroutineElement && goroutinePinButton) {
                goroutineElement.classList.toggle('pinned', goroutine.pinned);
                goroutinePinButton.classList.toggle('pinned', goroutine.pinned);
              }
            }
          }
        }
      }
    }
  }

  private updateFileStats(): void {
    const fileStatsByName = this.getFileStatistics();

    // Update existing file items without full re-render
    const fileItems = document.querySelectorAll('.file-item');
    fileItems.forEach(fileItem => {
      const fileName = (fileItem as HTMLElement).dataset.fileName;
      if (fileName) {
        const statsElement = fileItem.querySelector('.file-stats');
        if (statsElement) {
          const stats = fileStatsByName.get(fileName) || { visible: 0, total: 0 };
          statsElement.textContent = `${stats.visible} / ${stats.total} goroutines`;
        }
      }
    });
  }

  private getFileStatistics(): Map<string, { visible: number; total: number }> {
    return this.profileCollection.getFileStatistics();
  }

  private updateUnpinButtonVisibility(): void {
    const unpinAllBtn = document.getElementById('unpinAllBtn');
    const narrowUnpinAllBtn = document.getElementById('narrowUnpinAllBtn');
    const hasPinnedItems = this.profileCollection.hasAnyPinnedItems();

    if (unpinAllBtn) {
      unpinAllBtn.classList.toggle('hidden', !hasPinnedItems);
    }
    if (narrowUnpinAllBtn) {
      narrowUnpinAllBtn.classList.toggle('hidden', !hasPinnedItems);
    }
  }

  private unpinAllItems(): void {
    this.profileCollection.unpinAllItems();

    // Remove pinned classes from all DOM elements
    document.querySelectorAll('.pinned').forEach(el => {
      el.classList.remove('pinned');
    });

    // Reapply current filter and update UI
    this.setFilter({ filterString: this.filterInputValue });
    this.updateVisibility();
    this.updateStats();
  }

  private updateStackDisplayMode(mode: string): void {
    // Update all unique-stack-content elements
    document.querySelectorAll('.unique-stack-content').forEach(content => {
      content.setAttribute('data-display-mode', mode);

      // Regenerate content with new display mode
      const traceData = (content as any).__traceData;
      if (traceData) {
        this.updateTraceElementContent(content as HTMLElement, traceData);
      }
    });
  }

  private formatStackCombined(trace: any[]): string {
    let html = '';
    for (const frame of trace) {
      html += `<div class="stack-line">`;
      html += `<span class="function-name">${this.escapeHtml(frame.func)}</span>`;
      html += `</div>`;
      html += `<div class="stack-line">\t<span class="file-path">${this.escapeHtml(frame.file)}</span>:<span class="line-number">${frame.line}</span></div>`;
    }
    return html;
  }

  private formatStackSideBySide(trace: any[]): string {
    let html = '<div class="side-by-side-container">';

    // Add headers
    html += '<div class="side-by-side-headers">';
    html += '<div class="column-header">Functions</div>';
    html += '<div class="column-header">Locations</div>';
    html += '</div>';

    // Format function calls as paired rows
    for (const frame of trace) {
      html += '<div class="side-by-side-row">';
      html += '<div class="function-side">';
      html += `<span class="function-name">${this.escapeHtml(frame.func)}</span>`;
      html += '</div>';
      html += '<div class="location-side">';
      html += `<span class="file-path">${this.escapeHtml(frame.file)}</span>:<span class="line-number">${frame.line}</span>`;
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  private formatStackFunctions(trace: any[]): string {
    let html = '';
    for (const frame of trace) {
      html += `<div class="stack-line">`;
      html += `<span class="function-name">${this.escapeHtml(frame.func)}</span>`;
      html += `</div>`;
    }
    return html;
  }

  private formatStackLocations(trace: any[]): string {
    let html = '';
    for (const frame of trace) {
      html += `<div class="stack-line">`;
      html += `<span class="file-path">${this.escapeHtml(frame.file)}</span>:<span class="line-number">${frame.line}</span>`;
      html += `</div>`;
    }
    return html;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private startFileRename(fileNameSpan: HTMLElement, currentFileName: string): void {
    // Don't start rename if already editing
    if (fileNameSpan.getAttribute('contenteditable') === 'true') {
      return;
    }

    // Store original text and make editable
    const originalText = fileNameSpan.textContent || '';
    fileNameSpan.setAttribute('contenteditable', 'true');
    fileNameSpan.classList.add('editing');
    fileNameSpan.setAttribute('title', 'Press Enter to save, Escape to cancel');
    fileNameSpan.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(fileNameSpan);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Handle finishing the rename
    const finishRename = () => {
      const newText = fileNameSpan.textContent?.trim() || '';
      fileNameSpan.setAttribute('contenteditable', 'false');
      fileNameSpan.classList.remove('editing');
      fileNameSpan.removeAttribute('title');

      // If name changed and is valid, update it
      if (newText && newText !== originalText) {
        // Check if new name already exists (excluding current file)
        const existingNames = this.profileCollection
          .getFileNames()
          .filter(name => name !== currentFileName);
        if (existingNames.includes(newText)) {
          alert(`A file named "${newText}" already exists.`);
          fileNameSpan.textContent = originalText;
          return;
        }

        // Rename the file
        this.profileCollection.renameFile(
          currentFileName,
          newText,
          this.profileCollection.getFileNames().length > 1
        );
        this.render(); // Re-render to update all references
      } else {
        // Revert to original text if no change was made
        fileNameSpan.textContent = originalText;
      }
    };

    // Handle keyboard events
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRename();
        fileNameSpan.removeEventListener('keydown', onKeyDown);
        fileNameSpan.removeEventListener('blur', onBlur);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        fileNameSpan.textContent = originalText;
        fileNameSpan.setAttribute('contenteditable', 'false');
        fileNameSpan.classList.remove('editing');
        fileNameSpan.removeAttribute('title');
        fileNameSpan.removeEventListener('keydown', onKeyDown);
        fileNameSpan.removeEventListener('blur', onBlur);
      }
    };

    // Handle losing focus
    const onBlur = () => {
      finishRename();
      fileNameSpan.removeEventListener('keydown', onKeyDown);
      fileNameSpan.removeEventListener('blur', onBlur);
    };

    fileNameSpan.addEventListener('keydown', onKeyDown);
    fileNameSpan.addEventListener('blur', onBlur);
  }

  private setupDemoButtons(): void {
    const demoSingleBtn = document.getElementById('demoSingleBtn');
    const demoZipBtn = document.getElementById('demoZipBtn');

    if (demoSingleBtn) {
      demoSingleBtn.addEventListener('click', async e => {
        e.preventDefault();
        try {
          const rawUrl =
            'https://raw.githubusercontent.com/dt/crdb-stacks-examples/refs/heads/main/stacks/files/1/stacks.txt';
          await this.loadFromUrl(rawUrl, 'crdb-demo-single.txt');
        } catch (error) {
          const msg = error && (error as any).message ? (error as any).message : String(error);
          console.error('Demo file load error:', error);
          alert(
            `Failed to load demo file. Please try again or check your internet connection (${msg}).`
          );
        }
      });
    }

    if (demoZipBtn) {
      demoZipBtn.addEventListener('click', async e => {
        e.preventDefault();
        try {
          const url =
            'https://raw.githubusercontent.com/dt/crdb-stacks-examples/refs/heads/main/stacks.zip';
          await this.loadFromUrl(url, 'crdb-demo.zip');
        } catch (error) {
          console.error('Demo zip load error:', error);
          alert(
            'Failed to load demo zip file. Please try again or check your internet connection.'
          );
        }
      });
    }
  }

  private async loadFromUrl(url: string, fileName: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (fileName.endsWith('.zip')) {
        // Handle zip files
        console.time(`🌐 URL Zip Import: ${fileName}`);
        const arrayBuffer = await response.arrayBuffer();
        const JSZipClass = await getJSZip();
        if (!JSZipClass) {
          throw new Error(
            'JSZip failed to load from CDN. Please check your internet connection and try again.'
          );
        }
        const zip = new JSZipClass();
        const zipContent = await zip.loadAsync(arrayBuffer);

        // Find stack trace files in the zip (using settings pattern)
        const pattern = this.settingsManager.getZipFilePatternRegex();
        const files = Object.keys(zipContent.files).filter(fileName => {
          return pattern.test(fileName);
        });

        for (const zipFileName of files) {
          const file = zipContent.files[zipFileName];
          if (!file.dir) {
            const baseName = zipFileName.split('/').pop() || zipFileName;
            console.time(`  📄 URL Zip Entry: ${baseName}`);
            const content = await file.async('text');
            const result = await this.parser.parseFile(content, baseName);

            if (result.success) {
              this.profileCollection.addFile(result.data); // Let extractedName take precedence
              console.timeEnd(`  📄 URL Zip Entry: ${baseName}`);
            } else {
              console.timeEnd(`  📄 URL Zip Entry: ${baseName}`);
              console.error(`URL zip - Failed to parse ${baseName}:`, result.error);
            }
          }
        }

        if (files.length === 0) {
          console.warn(`URL zip - No stack trace files found matching pattern: ${pattern}`);
        }
        console.timeEnd(`🌐 URL Zip Import: ${fileName}`);
      } else {
        // Handle single text files
        console.time(`🌐 URL File Import: ${fileName}`);
        const text = await response.text();
        const result = await this.parser.parseFile(text, fileName);

        if (result.success) {
          this.profileCollection.addFile(result.data);
          console.timeEnd(`🌐 URL File Import: ${fileName}`);
        } else {
          console.timeEnd(`🌐 URL File Import: ${fileName}`);
          console.error(`Failed to parse ${fileName}:`, result.error);
          throw new Error(result.error);
        }
      }

      this.render();

      // Always reapply current filter to ensure proper visibility state
      this.setFilter(this.buildCurrentFilter());
    } catch (error) {
      // End any ongoing timers in case of error
      if (fileName.endsWith('.zip')) {
        console.timeEnd(`🌐 URL Zip Import: ${fileName}`);
      } else {
        console.timeEnd(`🌐 URL File Import: ${fileName}`);
      }
      console.error('URL load error:', error);
      throw error;
    }
  }

  private showAllCreatedGoroutines(
    creatorId: string,
    createdGoroutines: string[],
    secondLine: HTMLElement
  ): void {
    // Clear existing content of the second line
    secondLine.innerHTML = '';

    const createdText = document.createElement('span');
    createdText.className = 'created-goroutines-label';
    createdText.textContent = `created ${createdGoroutines.length} goroutine${createdGoroutines.length > 1 ? 's' : ''}: `;
    secondLine.appendChild(createdText);

    // Show all created goroutines as clickable links
    createdGoroutines.forEach((created, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.textContent = ', ';
        secondLine.appendChild(separator);
      }

      const createdLink = document.createElement('span');
      createdLink.className = 'creator-link';
      createdLink.textContent = created;
      createdLink.dataset.targetId = created;
      createdLink.dataset.sourceId = creatorId;
      createdLink.addEventListener('click', this.handleNavigationClick.bind(this));
      this.addTooltipToLink(createdLink, created);
      secondLine.appendChild(createdLink);
    });
  }

  private setupNavigationHistory(): void {
    // Handle browser back/forward
    window.addEventListener('popstate', e => {
      if (e.state && e.state.goroutineId) {
        this.navigateToGoroutineInternal(e.state.goroutineId, false, undefined);
      }
    });
  }

  private navigateToGoroutine(goroutineId: string, sourceGoroutineId?: string): void {
    this.navigateToGoroutineInternal(goroutineId, true, sourceGoroutineId);
  }

  private navigateToGoroutineInternal(
    goroutineId: string,
    addToHistory: boolean,
    sourceGoroutineId?: string
  ): void {
    if (addToHistory && sourceGoroutineId) {
      // internalStack.push(fromID)
      this.addToNavigationHistory(sourceGoroutineId);

      // browser.pushState(fromID)
      history.pushState(
        { goroutineId: sourceGoroutineId },
        `Goroutine ${sourceGoroutineId}`,
        `#goroutine-${sourceGoroutineId}`
      );
    }

    const g = this.profileCollection.lookupGoroutine(goroutineId);
    if (!g) {
      console.warn(`Goroutine ${goroutineId} not found in profile collection`);
      return;
    }
    // Always unforce any existing forced goroutine first
    this.setFilter(this.buildCurrentFilter({ forcedGoroutine: undefined }));

    if (!g.matches) {
      // Now force this goroutine to be visible
      this.setFilter(this.buildCurrentFilter({ forcedGoroutine: goroutineId }));
    }

    // Find the goroutine element by its unique ID
    let goroutineElement = document.getElementById(`goroutine-${goroutineId}`) as HTMLElement;

    if (!goroutineElement) {
      console.warn(`Goroutine ${goroutineId} not found in DOM - might be filtered out`);
      this.expandGroupsContainingGoroutine(goroutineId);
      goroutineElement = document.getElementById(`goroutine-${goroutineId}`) as HTMLElement;
      if (!goroutineElement) {
        alert(`Goroutine ${goroutineId} not found in DOM after expanding groups`);
        return;
      }
    }

    // Expand any collapsed parent containers before scrolling
    this.expandParentContainers(goroutineElement);

    this.scrollToAndHighlightGoroutine(goroutineElement, goroutineId, addToHistory);
  }

  private expandGroupsContainingGoroutine(_goroutineId: string): void {
    // Find all "show more" links and click them to expand collapsed groups
    const showMoreLinks = document.querySelectorAll('.show-more-link');
    showMoreLinks.forEach(link => {
      // Check if this group might contain the goroutine by looking at its text
      const linkElement = link as HTMLElement;
      // Click the link to expand the group
      linkElement.click();
    });
  }

  private expandParentContainers(goroutineElement: HTMLElement): void {
    // Walk up the DOM tree and expand any collapsed parent containers
    let currentElement: HTMLElement | null = goroutineElement;

    while (currentElement) {
      // Look for parent sections with the expandable class and collapsed class
      if (
        currentElement.classList.contains('expandable') &&
        (currentElement.classList.contains('container-collapsed') ||
          currentElement.classList.contains('section-collapsed'))
      ) {
        // Remove the appropriate collapsed class to expand
        currentElement.classList.remove('container-collapsed');
        currentElement.classList.remove('section-collapsed');

        // Also reset any inline display styles that might have been set during collapse
        const content = currentElement.querySelector('.section-content') as HTMLElement;
        if (content) {
          content.style.display = '';
        }

        // The expand icon is handled by CSS pseudo-elements based on collapsed classes

        // Skip aria-expanded for performance
      }

      // Move to parent element
      currentElement = currentElement.parentElement;
    }
  }

  private scrollToAndHighlightGoroutine(
    element: HTMLElement,
    goroutineId: string,
    addToHistory: boolean
  ): void {
    // browser.scrollTo(toID); browser.pushState(toID);
    if (addToHistory) {
      history.pushState({ goroutineId }, `Goroutine ${goroutineId}`, `#goroutine-${goroutineId}`);
    }

    // Remove any existing highlights
    document.querySelectorAll('.goroutine-entry.highlighted').forEach(el => {
      el.classList.remove('highlighted');
    });
    // Highlight the target goroutine
    element.classList.add('highlighted');
    // Scroll to the element
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    // Update back button state
    this.updateBackButtonState();

    // Fade out highlight after 3 seconds
    setTimeout(() => {
      element.classList.remove('highlighted');
    }, 3000);
  }

  private addToNavigationHistory(goroutineId: string): void {
    const changes = this.appState.addToNavigationHistory(goroutineId);
    this.updateBackButtonState(changes.canGoBack);
  }

  private navigateBack(): void {
    const result = this.appState.navigateBack();
    if (result.targetGoroutineId) {
      this.navigateToGoroutineInternal(result.targetGoroutineId, false, undefined);

      // Update browser history - use pushState to maintain browser back/forward
      history.pushState(
        { goroutineId: result.targetGoroutineId },
        `Goroutine ${result.targetGoroutineId}`,
        `#goroutine-${result.targetGoroutineId}`
      );
    }
    this.updateBackButtonState(result.canGoBack);
  }

  private updateBackButtonState(canGoBack?: boolean): void {
    const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
    const narrowBackBtn = document.getElementById('narrowBackBtn') as HTMLButtonElement;

    const hasHistory = canGoBack !== undefined ? canGoBack : this.appState.canNavigateBack();

    if (backBtn) {
      backBtn.disabled = !hasHistory;
    }
    if (narrowBackBtn) {
      narrowBackBtn.disabled = !hasHistory;
    }
  }

  private clearUrlAnchor(): void {
    // Clear any existing anchor in the URL to start fresh
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /**
   * Convert AppSettings to ProfileCollectionSettings format
   */
  private convertToProfileCollectionSettings(appSettings: AppSettings): ProfileCollectionSettings {
    return {
      functionPrefixesToTrim: this.settingsManager.getFunctionTrimPrefixes(),
      filePrefixesToTrim: this.settingsManager.getFileTrimPrefixes(),
      titleManipulationRules: this.settingsManager.getTitleManipulationRules(),
      nameExtractionPatterns: appSettings.nameExtractionPatterns || [],
      zipFilePattern: appSettings.zipFilePattern,
      categoryRules: this.settingsManager.getCategoryRules(),
    };
  }

  /**
   * Handle settings changes
   */
  private onSettingsChanged(settings: AppSettings): void {
    // Apply new settings to ProfileCollection
    const profileSettings = this.convertToProfileCollectionSettings(settings);
    this.profileCollection.updateSettings(profileSettings);

    // Re-render the current display if we have content
    const stacks = this.profileCollection.getCategories();
    if (stacks.length > 0) {
      this.render();
    }
  }

  /**
   * Setup settings modal event handlers
   */
  private setupSettingsModal(): void {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const settingsModalCloseBtn = document.getElementById('settingsModalCloseBtn');
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    if (settingsBtn && settingsModal) {
      settingsBtn.addEventListener('click', () => {
        this.openSettingsModal();
      });
    }

    if (settingsModalCloseBtn && settingsModal) {
      settingsModalCloseBtn.addEventListener('click', () => {
        // Cancel changes - reload original settings
        this.loadSettingsIntoModal();
        settingsModal.classList.add('modal-hidden');
        settingsModal.classList.remove('modal-visible');
      });
    }

    if (settingsModal) {
      settingsModal.addEventListener('click', e => {
        if (e.target === settingsModal) {
          // Cancel changes - reload original settings
          this.loadSettingsIntoModal();
          settingsModal.classList.add('modal-hidden');
          settingsModal.classList.remove('modal-visible');
        }
      });
    }

    // Close modal with Escape key (cancel changes)
    document.addEventListener('keydown', e => {
      if (
        e.key === 'Escape' &&
        settingsModal &&
        settingsModal.classList.contains('modal-visible')
      ) {
        // Cancel changes - reload original settings
        this.loadSettingsIntoModal();
        settingsModal.classList.add('modal-hidden');
        settingsModal.classList.remove('modal-visible');
      }
    });

    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        this.saveSettingsFromModal();
      });
    }
  }

  private openSettingsModal(): void {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      // Load current settings into modal
      this.loadSettingsIntoModal();
      settingsModal.classList.add('modal-visible');
      settingsModal.classList.remove('modal-hidden');
    }
  }

  // Settings configuration map for data-driven modal handling
  private readonly settingsConfig = {
    functionTrimPrefixes: {
      type: 'text' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    fileTrimPrefixes: {
      type: 'text' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    zipFilePattern: {
      type: 'text' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    // Legacy rule fields (for backward compatibility)
    categorySkipRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    categoryMatchRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    nameSkipRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    nameTrimRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    nameFoldRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    nameFindRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    // New custom/default rule fields
    useDefaultCategorySkipRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customCategorySkipRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    useDefaultCategoryMatchRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customCategoryMatchRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    useDefaultNameSkipRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customNameSkipRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    useDefaultNameTrimRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customNameTrimRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    useDefaultNameFoldRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customNameFoldRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    useDefaultNameFindRules: {
      type: 'checkbox' as const,
      serialize: (value: boolean) => value,
      deserialize: (value: any) => Boolean(value),
    },
    customNameFindRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
  } as const;

  private loadSettingsIntoModal(): void {
    const settings = this.settingsManager.getSettings();

    // Load all setting values into modal inputs using config map
    Object.entries(this.settingsConfig).forEach(([key, config]) => {
      const element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement;
      if (element && key in settings) {
        const value = (settings as any)[key];
        if (config.type === 'checkbox') {
          (element as HTMLInputElement).checked = Boolean(config.deserialize(value));
        } else {
          element.value = String(config.deserialize(value));
        }
      }
    });

    // Populate default rule textareas with read-only default values
    this.populateDefaultRuleTextareas();

    // Setup toggle event handlers
    this.setupDefaultRuleToggles();

    // Setup collapsible sections
    this.setupCollapsibleSections();

    // Update rule counts after populating
    this.updateAllRuleCounts();
  }

  private saveSettingsFromModal(): void {
    // Collect all settings from the modal using config map
    const updates: Partial<AppSettings> = {};

    Object.entries(this.settingsConfig).forEach(([key, config]) => {
      const element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement;
      if (element) {
        let value: any;
        if (config.type === 'checkbox') {
          value = config.serialize((element as HTMLInputElement).checked);
        } else {
          value = config.serialize(config.deserialize(element.value));
        }
        if (value !== undefined) {
          (updates as any)[key] = value;
        }
      }
    });

    // Apply all settings at once
    this.settingsManager.updateSettings(updates);

    // Close modal
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.classList.add('modal-hidden');
      settingsModal.classList.remove('modal-visible');
    }
  }

  private resetSettings(): void {
    this.settingsManager.resetToDefaults();
    this.loadSettingsIntoModal();
  }

  private createTooltip(): void {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'goroutine-tooltip';
    this.tooltip.classList.add('hidden');
    document.body.appendChild(this.tooltip);
  }

  private showGoroutinePreviewTooltip(goroutineId: string, event: MouseEvent): void {
    const goroutine = this.profileCollection.getGoroutineByID(goroutineId);
    if (!goroutine) return;

    const category = this.profileCollection.getCategoryForGoroutine(goroutineId);
    const categoryPrefix = category ? `${category.name} → ` : '';
    const stackTitle = goroutine.stack.name;
    const waitText = goroutine.waitMinutes > 0 ? `, ${goroutine.waitMinutes} mins` : '';

    this.tooltip.textContent = `[${goroutine.state}${waitText}] ${categoryPrefix}${stackTitle}`;

    // Position off-screen first to measure it
    this.tooltip.style.left = '-9999px';
    this.tooltip.style.top = '-9999px';
    this.tooltip.style.transform = 'none';
    this.tooltip.classList.remove('hidden');

    // Get accurate measurements
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate position relative to cursor
    let offsetX = -20;
    let offsetY = 10;

    // Check if tooltip would go off right edge
    if (event.clientX - 20 + tooltipRect.width > viewportWidth) {
      // Flip to left side of cursor, ending just to the right of cursor
      offsetX = -tooltipRect.width + 15;

      // If still goes off left edge, clamp to left margin
      if (event.clientX + offsetX < 0) {
        offsetX = -event.clientX + 10;
      }
    }

    // Check if tooltip would go off bottom edge
    if (event.clientY + 10 + tooltipRect.height > viewportHeight) {
      // Flip above cursor
      offsetY = -tooltipRect.height - 10;

      // If still goes off top, clamp to top margin
      if (event.clientY + offsetY < 0) {
        offsetY = -event.clientY + 10;
      }
    }

    // Position the tooltip
    this.tooltip.style.left = `${event.pageX}px`;
    this.tooltip.style.top = `${event.pageY}px`;
    this.tooltip.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.add('hidden');
  }

  private addTooltipToLink(link: HTMLElement, goroutineId: string): void {
    link.dataset.tooltipGoroutineId = goroutineId;
    link.addEventListener('mouseenter', this.handleTooltipMouseEnter.bind(this));
    link.addEventListener('mouseleave', this.handleTooltipMouseLeave.bind(this));
    link.addEventListener('mousemove', this.handleTooltipMouseMove.bind(this));
  }

  /**
   * Load rules into the rule editor
   */
  private loadRulesIntoEditor(rules: TitleRule[]): void {
    const rulesList = document.getElementById('rulesList');
    if (!rulesList) return;

    // Clear existing rule items only (not the add buttons)
    const ruleItems = rulesList.querySelectorAll('.rule-item');
    ruleItems.forEach(item => item.remove());

    // Add each rule to the editor
    rules.forEach(rule => this.addRuleToEditor(rule));

    // Setup add button if not already done
    this.setupRuleEditor();

    // Update rule count in header
    this.updateRuleListHeader('rulesList', rules.length);
  }

  /**
   * Get rules from the rule editor
   */
  private getRulesFromEditor(): TitleRule[] {
    const rulesList = document.getElementById('rulesList');
    if (!rulesList) return [];

    const rules: TitleRule[] = [];
    const ruleItems = rulesList.querySelectorAll('.rule-item');

    ruleItems.forEach(ruleItem => {
      // Determine rule type based on CSS class
      if (ruleItem.classList.contains('skip-rule')) {
        const ruleInput = ruleItem.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput && ruleInput.value.trim()) {
          rules.push({ skip: ruleInput.value.trim() });
        }
      } else if (ruleItem.classList.contains('trim-rule')) {
        const ruleInput = ruleItem.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput && ruleInput.value.trim()) {
          rules.push({ trim: ruleInput.value.trim() });
        }
      } else if (ruleItem.classList.contains('fold-rule')) {
        // For fold rules, get pattern, replacement, and optional while condition from separate inputs
        const patternInput = ruleItem.querySelector('.rule-pattern-input') as HTMLInputElement;
        const replacementInput = ruleItem.querySelector(
          '.rule-replacement-input'
        ) as HTMLInputElement;
        const whileInput = ruleItem.querySelector('.rule-while-input') as HTMLInputElement;

        if (patternInput && patternInput.value.trim()) {
          const pattern = patternInput.value.trim();
          const replacement = replacementInput ? replacementInput.value.trim() : '';
          const whileCondition = whileInput ? whileInput.value.trim() : '';

          const rule: any = { fold: pattern, to: replacement };
          if (whileCondition) {
            rule.while = whileCondition;
          }
          rules.push(rule);
        }
      } else if (ruleItem.classList.contains('find-rule')) {
        // For find rules, get pattern, replacement, and optional while condition from separate inputs
        const patternInput = ruleItem.querySelector('.rule-pattern-input') as HTMLInputElement;
        const replacementInput = ruleItem.querySelector(
          '.rule-replacement-input'
        ) as HTMLInputElement;
        const whileInput = ruleItem.querySelector('.rule-while-input') as HTMLInputElement;

        if (patternInput && patternInput.value.trim()) {
          const pattern = patternInput.value.trim();
          const replacement = replacementInput ? replacementInput.value.trim() : '';
          const whileCondition = whileInput ? whileInput.value.trim() : '';

          const rule: any = { find: pattern, to: replacement };
          if (whileCondition) {
            rule.while = whileCondition;
          }
          rules.push(rule);
        }
      }
    });

    return rules;
  }

  /**
   * Add a rule to the editor
   */
  private addRuleToEditor(rule?: TitleRule, ruleType?: 'skip' | 'trim' | 'fold' | 'find'): void {
    const rulesList = document.getElementById('rulesList');
    if (!rulesList) return;

    // Determine the rule type and template to use
    let templateId: string;

    if (rule) {
      if ('skip' in rule) {
        templateId = 'skip-rule-template';
      } else if ('trim' in rule) {
        templateId = 'trim-rule-template';
      } else if ('fold' in rule) {
        templateId = 'fold-rule-template';
      } else if ('find' in rule) {
        templateId = 'find-rule-template';
      } else {
        return; // Invalid rule
      }
    } else if (ruleType) {
      templateId = `${ruleType}-rule-template`;
    } else {
      return; // Need either rule or ruleType
    }

    const template = document.getElementById(templateId) as HTMLTemplateElement;
    if (!template) return;

    const ruleItem = template.content.cloneNode(true) as DocumentFragment;
    const ruleElement = ruleItem.querySelector('.rule-item') as HTMLElement;

    // Populate values based on rule type
    if (rule) {
      if ('skip' in rule) {
        const ruleInput = ruleElement.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput) ruleInput.value = rule.skip;
      } else if ('trim' in rule) {
        const ruleInput = ruleElement.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput) ruleInput.value = rule.trim;
      } else if ('fold' in rule) {
        const patternInput = ruleElement.querySelector('.rule-pattern-input') as HTMLInputElement;
        const replacementInput = ruleElement.querySelector(
          '.rule-replacement-input'
        ) as HTMLInputElement;
        const whileInput = ruleElement.querySelector('.rule-while-input') as HTMLInputElement;
        if (patternInput) patternInput.value = rule.fold;
        if (replacementInput) replacementInput.value = rule.to || '';
        if (whileInput && rule.while) whileInput.value = rule.while;
      } else if ('find' in rule) {
        const patternInput = ruleElement.querySelector('.rule-pattern-input') as HTMLInputElement;
        const replacementInput = ruleElement.querySelector(
          '.rule-replacement-input'
        ) as HTMLInputElement;
        const whileInput = ruleElement.querySelector('.rule-while-input') as HTMLInputElement;
        if (patternInput) patternInput.value = rule.find;
        if (replacementInput) replacementInput.value = rule.to || '';
        if (whileInput && rule.while) whileInput.value = rule.while;
      }
    }

    // Setup remove button event listener
    const removeBtn = ruleElement.querySelector('.remove-rule-btn') as HTMLButtonElement;
    if (removeBtn) {
      removeBtn.dataset.listType = 'rulesList';
      removeBtn.addEventListener('click', this.handleRuleRemoveClick.bind(this));
    }

    // Insert before add buttons
    const addButtons = rulesList.querySelector('.add-rule-buttons');
    if (addButtons) {
      rulesList.insertBefore(ruleItem, addButtons);
    } else {
      rulesList.appendChild(ruleItem);
    }

    // Update rule count after addition
    const remainingRules = rulesList.querySelectorAll('.rule-item').length;
    this.updateRuleListHeader('rulesList', remainingRules);
  }

  /**
   * Setup the rule editor
   */
  private setupRuleEditor(): void {
    const addSkipBtn = document.getElementById('addSkipBtn');
    const addTrimBtn = document.getElementById('addTrimBtn');
    const addFoldBtn = document.getElementById('addFoldBtn');
    const addFindBtn = document.getElementById('addFindBtn');

    if (!addSkipBtn || !addTrimBtn || !addFoldBtn || !addFindBtn) return;

    // Remove existing listeners to prevent duplicates
    addSkipBtn.replaceWith(addSkipBtn.cloneNode(true));
    addTrimBtn.replaceWith(addTrimBtn.cloneNode(true));
    addFoldBtn.replaceWith(addFoldBtn.cloneNode(true));
    addFindBtn.replaceWith(addFindBtn.cloneNode(true));

    const newAddSkipBtn = document.getElementById('addSkipBtn');
    const newAddTrimBtn = document.getElementById('addTrimBtn');
    const newAddFoldBtn = document.getElementById('addFoldBtn');
    const newAddFindBtn = document.getElementById('addFindBtn');

    newAddSkipBtn?.addEventListener('click', () => {
      this.addRuleToEditor(undefined, 'skip');
    });

    newAddTrimBtn?.addEventListener('click', () => {
      this.addRuleToEditor(undefined, 'trim');
    });

    newAddFoldBtn?.addEventListener('click', () => {
      this.addRuleToEditor(undefined, 'fold');
    });

    newAddFindBtn?.addEventListener('click', () => {
      this.addRuleToEditor(undefined, 'find');
    });
  }

  /**
   * Load category rules into the category rule editor
   */
  private loadCategoryRulesIntoEditor(rules: CategoryRule[]): void {
    const categoryRulesList = document.getElementById('categoryRulesList');
    if (!categoryRulesList) return;

    // Clear existing rule items only (not the add buttons)
    const ruleItems = categoryRulesList.querySelectorAll('.rule-item');
    ruleItems.forEach(item => item.remove());

    // Add each rule to the editor
    rules.forEach(rule => this.addCategoryRuleToEditor(rule));

    // Setup add button if not already done
    this.setupCategoryRuleEditor();

    // Update rule count in header
    this.updateRuleListHeader('categoryRulesList', rules.length);
  }

  /**
   * Get category rules from the category rule editor
   */
  private getCategoryRulesFromEditor(): CategoryRule[] {
    const categoryRulesList = document.getElementById('categoryRulesList');
    if (!categoryRulesList) return [];

    const rules: CategoryRule[] = [];
    const ruleItems = categoryRulesList.querySelectorAll('.rule-item');

    ruleItems.forEach(ruleItem => {
      if (ruleItem.classList.contains('skip-rule')) {
        const ruleInput = ruleItem.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput && ruleInput.value.trim()) {
          rules.push({ skip: ruleInput.value.trim() });
        }
      } else if (ruleItem.classList.contains('match-rule')) {
        const ruleInput = ruleItem.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput && ruleInput.value.trim()) {
          rules.push({ match: ruleInput.value.trim() });
        }
      } else if (ruleItem.classList.contains('unknown-rule')) {
        const jsonInput = ruleItem.querySelector('.rule-json-input') as HTMLTextAreaElement;
        if (jsonInput && jsonInput.value.trim()) {
          try {
            const parsedRule = JSON.parse(jsonInput.value.trim());
            rules.push(parsedRule);
          } catch (e) {
            console.warn('Invalid JSON in unknown rule, skipping:', jsonInput.value);
          }
        }
      }
    });

    return rules;
  }

  /**
   * Add a category rule to the editor
   */
  private addCategoryRuleToEditor(rule?: CategoryRule, ruleType?: 'skip' | 'match'): void {
    const categoryRulesList = document.getElementById('categoryRulesList');
    if (!categoryRulesList) return;

    // Determine the rule type and template to use
    let templateId: string;

    if (rule) {
      if ('skip' in rule) {
        templateId = 'category-skip-rule-template';
      } else if ('match' in rule) {
        templateId = 'category-match-rule-template';
      } else {
        // Unknown rule type - use fallback template
        templateId = 'category-unknown-rule-template';
      }
    } else if (ruleType) {
      templateId = `category-${ruleType}-rule-template`;
    } else {
      return; // Need either rule or ruleType
    }

    const template = document.getElementById(templateId) as HTMLTemplateElement;
    if (!template) return;

    const ruleItem = template.content.cloneNode(true) as DocumentFragment;
    const ruleElement = ruleItem.querySelector('.rule-item') as HTMLElement;

    // Populate values based on rule type
    if (rule) {
      if ('skip' in rule) {
        const ruleInput = ruleElement.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput) ruleInput.value = rule.skip;
      } else if ('match' in rule) {
        const ruleInput = ruleElement.querySelector('.rule-input') as HTMLInputElement;
        if (ruleInput) ruleInput.value = rule.match;
      } else {
        // Unknown rule type - show as JSON
        const jsonInput = ruleElement.querySelector('.rule-json-input') as HTMLTextAreaElement;
        if (jsonInput) jsonInput.value = JSON.stringify(rule, null, 2);
      }
    }

    // Setup remove button event listener
    const removeBtn = ruleElement.querySelector('.remove-rule-btn') as HTMLButtonElement;
    if (removeBtn) {
      removeBtn.dataset.listType = 'categoryRulesList';
      removeBtn.addEventListener('click', this.handleRuleRemoveClick.bind(this));
    }

    // Insert before add buttons
    const addButtons = categoryRulesList.querySelector('.add-rule-buttons');
    if (addButtons) {
      categoryRulesList.insertBefore(ruleItem, addButtons);
    } else {
      categoryRulesList.appendChild(ruleItem);
    }

    // Update rule count after addition
    const categoryRulesList2 = document.getElementById('categoryRulesList');
    if (categoryRulesList2) {
      const remainingRules = categoryRulesList2.querySelectorAll('.rule-item').length;
      this.updateRuleListHeader('categoryRulesList', remainingRules);
    }
  }

  /**
   * Setup the category rule editor
   */
  private setupCategoryRuleEditor(): void {
    const addCategorySkipBtn = document.getElementById('addCategorySkipBtn');
    const addCategoryMatchBtn = document.getElementById('addCategoryMatchBtn');

    if (!addCategorySkipBtn || !addCategoryMatchBtn) return;

    // Remove existing listeners to prevent duplicates
    addCategorySkipBtn.replaceWith(addCategorySkipBtn.cloneNode(true));
    addCategoryMatchBtn.replaceWith(addCategoryMatchBtn.cloneNode(true));

    const newAddCategorySkipBtn = document.getElementById('addCategorySkipBtn');
    const newAddCategoryMatchBtn = document.getElementById('addCategoryMatchBtn');

    newAddCategorySkipBtn?.addEventListener('click', () => {
      this.addCategoryRuleToEditor(undefined, 'skip');
    });

    newAddCategoryMatchBtn?.addEventListener('click', () => {
      this.addCategoryRuleToEditor(undefined, 'match');
    });
  }

  /**
   * Setup collapsible sections
   */
  private setupCollapsibleSections(): void {
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

    collapsibleHeaders.forEach(header => {
      // Check if this header already has event listener setup
      if ((header as any).__collapsibleSetup) {
        return;
      }

      const clickHandler = () => {
        // Find the rule-editor container
        const ruleEditor = header.closest('.rules-editor');
        if (!ruleEditor) return;

        const isCollapsed = ruleEditor.classList.contains('collapsed-settings');

        if (isCollapsed) {
          ruleEditor.classList.remove('collapsed-settings');
          header.classList.remove('collapsed-settings');
        } else {
          ruleEditor.classList.add('collapsed-settings');
          header.classList.add('collapsed-settings');
        }
      };

      header.addEventListener('click', clickHandler);
      // Mark this header as having event listener setup
      (header as any).__collapsibleSetup = true;
    });
  }

  /**
   * Update rule list header with rule count
   */
  private updateRuleListHeader(listId: string, count: number): void {
    const targetId = listId === 'rulesList' ? 'rulesEditor' : 'categoryRulesEditor';
    const header = document.querySelector(`#${targetId} .collapsible-header`) as HTMLElement;
    if (header) {
      const textSpan = header.querySelector('span:last-child');
      if (textSpan) {
        textSpan.textContent = `Rules (${count})`;
      }
    }
  }

  /**
   * Populate default rule textareas with read-only default values
   */
  private populateDefaultRuleTextareas(): void {
    // Category skip rules
    const defaultCategorySkipRules = document.getElementById(
      'defaultCategorySkipRules'
    ) as HTMLTextAreaElement;
    if (defaultCategorySkipRules) {
      defaultCategorySkipRules.value = this.settingsManager.getDefaultCategorySkipRulesString();
    }

    // Category match rules
    const defaultCategoryMatchRules = document.getElementById(
      'defaultCategoryMatchRules'
    ) as HTMLTextAreaElement;
    if (defaultCategoryMatchRules) {
      defaultCategoryMatchRules.value = this.settingsManager.getDefaultCategoryMatchRulesString();
    }

    // Name skip rules
    const defaultNameSkipRules = document.getElementById(
      'defaultNameSkipRules'
    ) as HTMLTextAreaElement;
    if (defaultNameSkipRules) {
      defaultNameSkipRules.value = this.settingsManager.getDefaultNameSkipRulesString();
    }

    // Name trim rules
    const defaultNameTrimRules = document.getElementById(
      'defaultNameTrimRules'
    ) as HTMLTextAreaElement;
    if (defaultNameTrimRules) {
      defaultNameTrimRules.value = this.settingsManager.getDefaultNameTrimRulesString();
    }

    // Name fold rules
    const defaultNameFoldRules = document.getElementById(
      'defaultNameFoldRules'
    ) as HTMLTextAreaElement;
    if (defaultNameFoldRules) {
      defaultNameFoldRules.value = this.settingsManager.getDefaultNameFoldRulesString();
    }

    // Name find rules
    const defaultNameFindRules = document.getElementById(
      'defaultNameFindRules'
    ) as HTMLTextAreaElement;
    if (defaultNameFindRules) {
      defaultNameFindRules.value = this.settingsManager.getDefaultNameFindRulesString();
    }
  }

  /**
   * Setup toggle event handlers for default rule sections
   */
  private setupDefaultRuleToggles(): void {
    // Helper function to setup toggle for a rule type
    const setupToggle = (ruleType: string) => {
      const toggle = document.getElementById(`useDefault${ruleType}Rules`) as HTMLInputElement;

      if (toggle) {
        // Check if this toggle already has event listener setup
        if ((toggle as any).__defaultRuleToggleSetup) {
          return;
        }

        // Find the closest default-rules-section to this toggle
        const section = toggle.closest('.default-rules-section');
        if (section) {
          const header = section.querySelector('.default-rules-header') as HTMLElement;
          const content = section.querySelector('.default-rules-content') as HTMLElement;

          if (header && content) {
            // Update initial state
            this.updateDefaultRuleToggleState(toggle, header, content);

            // Add click handler to header for collapsing
            const headerClickHandler = (e: Event) => {
              // Don't toggle if clicking on toggle switch or if rules are disabled
              if (e.target !== toggle && !toggle.contains(e.target as Node) && toggle.checked) {
                content.classList.toggle('collapsed-settings');
                // Update section class using settings-specific class
                section.classList.toggle(
                  'settings-collapsed',
                  content.classList.contains('collapsed-settings')
                );
              }
            };

            header.addEventListener('click', headerClickHandler);

            // Add change handler to toggle
            const toggleChangeHandler = () => {
              this.updateDefaultRuleToggleState(toggle, header, content);
            };

            toggle.addEventListener('change', toggleChangeHandler);

            // Mark this toggle as having event listener setup
            (toggle as any).__defaultRuleToggleSetup = true;
          }
        }
      }
    };

    // Setup toggles for each rule type
    setupToggle('CategorySkip');
    setupToggle('CategoryMatch');
    setupToggle('NameSkip');
    setupToggle('NameTrim');
    setupToggle('NameFold');
    setupToggle('NameFind');

    // Setup custom rules expand/collapse handlers and update counts
    this.setupCustomRulesHandlers();
    this.updateAllRuleCounts();
  }

  /**
   * Update the visual state of a default rule toggle
   */
  private updateDefaultRuleToggleState(
    toggle: HTMLInputElement,
    header: HTMLElement,
    content: HTMLElement
  ): void {
    const section = toggle.closest('.default-rules-section');

    if (toggle.checked) {
      header.classList.remove('disabled');
      content.style.opacity = '1';
    } else {
      header.classList.add('disabled');
      content.style.opacity = '0.5';
      // Always collapse when disabled
      content.classList.add('collapsed-settings');
      if (section) {
        section.classList.add('settings-collapsed');
      }
    }
  }

  /**
   * Setup expand/collapse handlers for custom rules sections
   */
  private setupCustomRulesHandlers(): void {
    const customRulesSections = document.querySelectorAll('.custom-rules-section');

    customRulesSections.forEach(section => {
      // Check if this section already has event listener setup
      if ((section as any).__customRulesSetup) {
        return;
      }

      const header = section.querySelector('.custom-rules-header') as HTMLElement;
      const content = section.querySelector('.custom-rules-content') as HTMLElement;

      if (header && content) {
        const headerClickHandler = () => {
          const isCollapsed = content.classList.contains('collapsed-settings');

          if (isCollapsed) {
            content.classList.remove('collapsed-settings');
            section.classList.remove('settings-collapsed');
          } else {
            content.classList.add('collapsed-settings');
            section.classList.add('settings-collapsed');
          }
        };

        header.addEventListener('click', headerClickHandler);

        // Add input event listener to textarea to update rule counts
        const textarea = content.querySelector('textarea') as HTMLTextAreaElement;
        if (textarea) {
          const textareaInputHandler = () => {
            this.updateRuleCount(section, textarea);
          };

          textarea.addEventListener('input', textareaInputHandler);
        }

        // Mark this section as having event listener setup
        (section as any).__customRulesSetup = true;
      }
    });
  }

  /**
   * Update rule count for a specific custom rules section
   */
  private updateRuleCount(section: Element, textarea: HTMLTextAreaElement): void {
    const titleElement = section.querySelector('.custom-rules-title h5') as HTMLElement;
    if (titleElement) {
      const ruleText = textarea.value.trim();
      const ruleCount = ruleText ? ruleText.split('\n').filter(line => line.trim()).length : 0;

      // Extract the base title (everything before the count)
      const baseTitle = titleElement.textContent?.replace(/\s*\(\d+\)$/, '') || 'Custom Rules';
      titleElement.textContent = `${baseTitle} (${ruleCount})`;
    }
  }

  /**
   * Copy stack name and trace to clipboard
   */
  private async copyStackToClipboard(stack: UniqueStack, category: Category): Promise<void> {
    try {
      // Add markdown title with # prefix, including category
      const stackTitle = `# ${category.name} → ${stack.name}`;

      // Group goroutines by file, then by state and wait time
      let goroutineInfo = '';

      if (stack.files.length > 0) {
        const goroutineLines: string[] = [];

        for (const fileSection of stack.files) {
          // Group goroutines within this file by state and wait
          const fileGroups = new Map<string, Goroutine[]>();

          for (const group of fileSection.groups) {
            for (const goroutine of group.goroutines) {
              const waitText = goroutine.waitMinutes > 0 ? `, ${goroutine.waitMinutes}m` : '';
              const key = `${goroutine.state}${waitText}`;

              if (!fileGroups.has(key)) {
                fileGroups.set(key, []);
              }
              fileGroups.get(key)!.push(goroutine);
            }
          }

          if (fileGroups.size > 0) {
            // Add file header if there are multiple files
            if (stack.files.length > 1) {
              goroutineLines.push(`# ${fileSection.fileName}`);
            }

            // Sort groups by state then by wait time (ascending)
            const sortedEntries = Array.from(fileGroups.entries()).sort(
              ([keyA, goroutinesA], [keyB, goroutinesB]) => {
                const stateA = goroutinesA[0].state;
                const stateB = goroutinesB[0].state;
                const waitA = goroutinesA[0].waitMinutes;
                const waitB = goroutinesB[0].waitMinutes;

                // First sort by state
                if (stateA !== stateB) {
                  return stateA.localeCompare(stateB);
                }

                // Then sort by wait time (ascending)
                return waitA - waitB;
              }
            );

            for (const [stateWait, goroutines] of sortedEntries) {
              const ids = goroutines.map(g => g.id);

              // If more than 12 goroutines, chunk them
              if (ids.length > 12) {
                for (let i = 0; i < ids.length; i += 12) {
                  const chunk = ids.slice(i, i + 12);
                  const chunkIds = chunk.join(',');
                  goroutineLines.push(`goroutine ${chunkIds} [${stateWait}]:`);
                }
              } else {
                const allIds = ids.join(',');
                goroutineLines.push(`goroutine ${allIds} [${stateWait}]:`);
              }
            }
          }
        }

        goroutineInfo = goroutineLines.join('\n');
      }

      // Format the stack trace
      const stackTrace = this.formatStackTraceForCopy(stack.trace);

      // Combine all parts
      const parts = [stackTitle];
      if (goroutineInfo) {
        parts.push(goroutineInfo);
      }
      parts.push(stackTrace);

      const combinedText = parts.join('\n\n');

      // Copy to clipboard
      await navigator.clipboard.writeText(combinedText);

      // Show brief visual feedback
      this.showCopyFeedback();
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers or when clipboard API fails
      this.fallbackCopyToClipboard(stack);
    }
  }

  /**
   * Group goroutines by state and wait time
   */
  private groupGoroutinesByStateAndWait(stack: UniqueStack): Map<string, Goroutine[]> {
    const groups = new Map<string, Goroutine[]>();

    for (const fileSection of stack.files) {
      for (const group of fileSection.groups) {
        for (const goroutine of group.goroutines) {
          const waitText = goroutine.waitMinutes > 0 ? `, ${goroutine.waitMinutes} minutes` : '';
          const key = `${goroutine.state}${waitText}`;

          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(goroutine);
        }
      }
    }

    return groups;
  }

  /**
   * Format stack trace for copying to clipboard
   */
  private formatStackTraceForCopy(trace: any[]): string {
    return trace.map(frame => `${frame.func}\n\t${frame.file}:${frame.line}`).join('\n');
  }

  /**
   * Show brief visual feedback for copy operation
   */
  private showCopyFeedback(): void {
    // Create a temporary feedback element
    const feedback = document.createElement('div');
    feedback.textContent = '📋 Copied to clipboard!';
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--accent-success);
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

    document.body.appendChild(feedback);

    // Trigger animation
    requestAnimationFrame(() => {
      feedback.style.opacity = '1';
    });

    // Remove after 2 seconds
    setTimeout(() => {
      feedback.style.opacity = '0';
      setTimeout(() => feedback.remove(), 300);
    }, 2000);
  }

  /**
   * Fallback copy method for older browsers
   */
  private fallbackCopyToClipboard(stack: UniqueStack): void {
    // Add markdown title with # prefix
    const stackTitle = `# ${stack.name}`;

    // Group goroutines by state and wait time
    let goroutineInfo = '';
    const goroutineGroups = this.groupGoroutinesByStateAndWait(stack);

    if (goroutineGroups.size > 0) {
      const goroutineLines: string[] = [];

      // Sort groups by state then by wait time (ascending)
      const sortedEntries = Array.from(goroutineGroups.entries()).sort(
        ([keyA, goroutinesA], [keyB, goroutinesB]) => {
          const stateA = goroutinesA[0].state;
          const stateB = goroutinesB[0].state;
          const waitA = goroutinesA[0].waitMinutes;
          const waitB = goroutinesB[0].waitMinutes;

          // First sort by state
          if (stateA !== stateB) {
            return stateA.localeCompare(stateB);
          }

          // Then sort by wait time (ascending)
          return waitA - waitB;
        }
      );

      for (const [stateWait, goroutines] of sortedEntries) {
        const ids = goroutines.map(g => g.id).join(',');
        goroutineLines.push(`goroutine ${ids} [${stateWait}]:`);
      }
      goroutineInfo = goroutineLines.join('\n');
    }

    // Format the stack trace
    const stackTrace = this.formatStackTraceForCopy(stack.trace);

    // Combine all parts
    const parts = [stackTitle];
    if (goroutineInfo) {
      parts.push(goroutineInfo);
    }
    parts.push(stackTrace);

    const combinedText = parts.join('\n\n');

    // Create a temporary textarea
    const textarea = document.createElement('textarea');
    textarea.value = combinedText;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    try {
      textarea.select();
      document.execCommand('copy');
      this.showCopyFeedback();
    } catch (error) {
      console.error('Fallback copy failed:', error);
      alert('Copy failed. Please select and copy the text manually.');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  /**
   * Update all rule counts for custom and default sections
   */
  private updateAllRuleCounts(): void {
    // Update custom rules counts
    const customRulesSections = document.querySelectorAll('.custom-rules-section');
    customRulesSections.forEach(section => {
      const textarea = section.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        this.updateRuleCount(section, textarea);
      }
    });

    // Update default rules counts (based on displayed content)
    const defaultRulesSections = document.querySelectorAll('.default-rules-section');
    defaultRulesSections.forEach(section => {
      const textarea = section.querySelector('.default-rules-textarea') as HTMLTextAreaElement;
      const titleElement = section.querySelector('.default-rules-title h5') as HTMLElement;

      if (textarea && titleElement) {
        const ruleText = textarea.value.trim();
        const ruleCount = ruleText ? ruleText.split('\n').filter(line => line.trim()).length : 0;

        // Extract the base title (everything before the count)
        const baseTitle = titleElement.textContent?.replace(/\s*\(\d+\)$/, '') || 'Default Rules';
        titleElement.textContent = `${baseTitle} (${ruleCount})`;
      }
    });
  }
}
