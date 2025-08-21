import { ProfileCollection, ProfileCollectionSettings } from '../app/ProfileCollection.js';
import { FileParser } from '../parser/index.js';
import { UniqueStack, Group, FilterChanges, AppState, Goroutine, Filter, Category, Counts } from '../app/types.js';
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

    this.initializeUI();
    this.initializeTheme();
    this.loadUIState();
    this.updateUnpinButtonVisibility(); // Initialize button visibility
    this.createTooltip();
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
      if (filterInput) {
        filterInput.value = savedFilter;
        this.setFilter({ filterString: savedFilter });
      }
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
      if (stackDisplayModeSelect) {
        stackDisplayModeSelect.value = savedStackMode;
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

    // Settings modal
    this.setupSettingsModal();
  }

  private async handleFiles(files: File[]): Promise<void> {
    try {
      for (const file of files) {
        // Check if it's a zip file
        if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
          await this.handleZipFile(file);
        } else {
          // Handle regular text file
          const text = await file.text();
          const result = await this.parser.parseFile(text, file.name);

          if (result.success) {
            this.profileCollection.addFile(result.data);
          } else {
            console.error(`Failed to parse ${file.name}:`, result.error);
            alert(`Failed to parse ${file.name}: ${result.error}`);
          }
        }
      }

      // Render new content but preserve filter state
      this.render();

      // Always reapply current filter to ensure proper visibility state
      this.setFilter({ filterString: this.filterInputValue });
    } catch (error) {
      console.error('Error handling files:', error);
      alert(`Error handling files: ${error}`);
    }
  }

  private async handleZipFile(file: File): Promise<void> {
    try {
      console.log('StackTraceApp: Starting zip file handling for:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      console.log('StackTraceApp: Got array buffer, size:', arrayBuffer.byteLength);
      const JSZipClass = await getJSZip();
      if (!JSZipClass) {
        throw new Error('JSZip failed to load from CDN. Please check your internet connection and try again.');
      }
      console.log('StackTraceApp: Got JSZip class:', typeof JSZipClass);
      const zip = new JSZipClass();
      console.log('StackTraceApp: JSZip instance created:', zip);
      const zipContent = await zip.loadAsync(arrayBuffer);
      console.log('StackTraceApp: Zip loaded successfully');

      // Find stack trace files in the zip (using settings pattern)
      const pattern = this.settingsManager.getZipFilePatternRegex();
      const files = Object.keys(zipContent.files).filter(fileName => {
        return pattern.test(fileName);
      });

      for (const zipFileName of files) {
        const zipFile = zipContent.files[zipFileName];
        if (!zipFile.dir) {
          const content = await zipFile.async('text');
          const baseName = zipFileName.split('/').pop() || zipFileName;
          const result = await this.parser.parseFile(content, baseName);

          if (result.success) {
            this.profileCollection.addFile(result.data);
          } else {
            console.error(`Failed to parse ${baseName} from zip:`, result.error);
            alert(`Failed to parse ${baseName} from zip: ${result.error}`);
          }
        }
      }

      if (files.length === 0) {
        console.warn(`No stack trace files found in zip matching pattern: ${pattern}`);
        alert(`No stack trace files found in zip file. Looking for files matching: ${pattern}`);
      }
    } catch (error) {
      console.error(`Error processing zip file ${file.name}:`, error);
      alert(`Failed to process zip file ${file.name}: ${error}`);
    }
  }

  private debouncedSetFilter(query: string): void {
    // Clear any existing timer
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
    }

    // Set a new timer to apply the filter after a short delay
    this.filterDebounceTimer = window.setTimeout(() => {
      this.setFilter({ filterString: query });
      this.saveUIState();
      this.filterDebounceTimer = null;
    }, 100);
  }

  private setFilter(filter: Filter): void {
    this.profileCollection.setFilter(filter);
    this.updateVisibility();
    this.updateStats();
  }

  private clearFilter(): void {
    // Clear any pending debounced filter
    if (this.filterDebounceTimer !== null) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = null;
    }

    this.filterInputValue = '';
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      filterInput.value = '';
    }

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
    // Progressive expand: if any categories are collapsed, expand all categories
    // Otherwise, expand all stacks
    const categories = document.querySelectorAll('.category-section');
    const hasCollapsedCategories = Array.from(categories).some(cat => cat.classList.contains('collapsed'));
    
    if (hasCollapsedCategories) {
      // Expand all categories
      categories.forEach(section => {
        section.classList.remove('collapsed');
        const header = section.querySelector('.header');
        if (header) {
          header.setAttribute('aria-expanded', 'true');
        }
      });
    } else {
      // Expand all stacks only (not file sections or group sections)
      const stacks = document.querySelectorAll('.stack-section');
      stacks.forEach(section => {
        section.classList.remove('collapsed');
        const header = section.querySelector('.header');
        if (header) {
          header.setAttribute('aria-expanded', 'true');
        }
      });
    }
  }

  private collapseAllStacks(): void {
    // Progressive collapse: if any stacks are expanded, collapse all stacks
    // Otherwise, collapse all categories
    const stacks = document.querySelectorAll('.stack-section');
    const hasExpandedStacks = Array.from(stacks).some(stack => !stack.classList.contains('collapsed'));
    
    if (hasExpandedStacks) {
      // Collapse all stacks only (not file sections or group sections)
      stacks.forEach(section => {
        section.classList.add('collapsed');
        const header = section.querySelector('.header');
        if (header) {
          header.setAttribute('aria-expanded', 'false');
        }
      });
    } else {
      // Collapse all categories
      const categories = document.querySelectorAll('.category-section');
      categories.forEach(section => {
        section.classList.add('collapsed');
        const header = section.querySelector('.header');
        if (header) {
          header.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  private updateVisibility(force: boolean = false): void {
    const categories = this.profileCollection.getCategories();

    // Process each category with hierarchical change detection
    for (const category of categories) {
      if (!force && category.counts.matches === category.counts.priorMatches) {
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
        if (category.counts.priorMatches == 0) {
          categoryElement.classList.remove('filtered');
        }
        this.updateDisplayedCount(categoryElement, category.counts);

        // Process each stack in the category
        for (const stack of category.stacks) {
          if (!force && stack.counts.matches === stack.counts.priorMatches) {
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
            if (stack.counts.priorMatches == 0) {
              stackElement.classList.remove('filtered');
            }
            this.updateDisplayedCount(stackElement, stack.counts);

            for (const fileSection of stack.files) {
              if (!force && fileSection.counts.matches == fileSection.counts.priorMatches) {
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
                if (fileSection.counts.priorMatches === 0) {
                  fileSectionElement.classList.remove('filtered');
                }
                this.updateDisplayedCount(fileSectionElement,fileSection.counts);

                for (const group of fileSection.groups) {
                  if (!force && group.counts.matches === group.counts.priorMatches) {
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
                    if (group.counts.priorMatches === 0) {
                      groupElement.classList.remove('filtered');
                    }
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
                }
              }
            }
          }
        }
      }
    }
    this.profileCollection.clearFilterChanges();
  }

  updateDisplayedCount(element: HTMLElement, counts: Counts): void {
    const countElement =
      element.querySelector(':scope > .header .counts') || element.querySelector('.header .counts');

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
    this.profileCollection.setFilter({ filterString: this.filterInputValue });
    this.updateVisibility(true); // Force update all counts after full render
    this.updateStats();
  }

  private addExpandCollapseHandler(container: HTMLElement): void {
    const header = container.querySelector('.header') as HTMLElement;
    if (!header) return;

    header.addEventListener('click', e => {
      // Check if there's a text selection - if so, allow it instead of toggling
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return; // Don't interfere with text selection
      }

      e.stopPropagation();
      e.preventDefault();

      const wasExpanded = !container.classList.contains('collapsed');
      
      // Simply toggle the collapsed class
      container.classList.toggle('collapsed');

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
            console.log('stack was above the fold: scroll it.')
            const parentCategory = container.closest('.category-section');
            const parentHeader = parentCategory ? parentCategory.querySelector('.header') as HTMLElement : null;
            if (parentHeader) {
              const headerHeight = parentHeader.clientHeight;
              const tmp = header.style.scrollMarginTop ;
              header.style.scrollMarginTop = `${headerHeight-2}px`;
              header.scrollIntoView({ behavior: 'instant', block: 'start' });
              header.style.scrollMarginTop = tmp;
            }
          }
        }
      }

      // Update aria-expanded for accessibility
      const isExpanded = !container.classList.contains('collapsed');
      header.setAttribute('aria-expanded', isExpanded.toString());
    });
  }

  private renderFiles(): void {
    const fileList = document.getElementById('fileList');
    const fileListContainer = document.getElementById('fileListContainer');
    if (!fileList) return;

    const fileNames = this.profileCollection.getFileNames();

    fileList.innerHTML = '';

    if (fileNames.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = 'Drop files here or click <strong>+</strong> to add';
      emptyState.style.cursor = 'pointer';
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
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      fileItem.dataset.fileName = fileName; // Store fileName for lookups

      // Create separate elements for filename and stats
      const fileNameSpan = document.createElement('span');
      fileNameSpan.className = 'file-name-text';
      fileNameSpan.textContent = fileName;
      fileNameSpan.setAttribute('contenteditable', 'false');
      fileNameSpan.addEventListener('click', e => {
        e.stopPropagation(); // Prevent event bubbling
        this.startFileRename(fileNameSpan, fileName);
      });

      // Add file statistics
      const stats = fileStatsByName.get(fileName) || { visible: 0, total: 0 };
      const statsDiv = document.createElement('div');
      statsDiv.className = 'file-stats counts';
      statsDiv.textContent = `${stats.visible} / ${stats.total} goroutines`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation(); // Prevent toggle when clicking remove
        this.profileCollection.removeFile(fileName);
        this.render();
      });

      fileItem.appendChild(fileNameSpan);
      fileItem.appendChild(statsDiv);
      fileItem.appendChild(removeBtn);
      fileList.appendChild(fileItem);
    });

    // Add drop area at the bottom when there are files
    const dropArea = document.createElement('div');
    dropArea.className = 'file-drop-area';
    dropArea.textContent = 'Drop more files here';
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
    const categoryElement = document.createElement('div');
    categoryElement.className = 'section expandable category-section';
    categoryElement.id = category.id;

    // Category header
    const header = document.createElement('div');
    header.className = 'header';

    const title = document.createElement('div');
    title.className = 'category-title';
    title.textContent = category.name;

    // Create count element
    const countElement = document.createElement('div');
    countElement.className = 'category-count counts';

    header.appendChild(title);
    header.appendChild(countElement);
    
    // Create pin button for category
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-button size-large';
    pinButton.innerHTML = '📌';
    pinButton.title = 'Pin/unpin this category';
    pinButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleCategoryPin(category.id);
      categoryElement.classList.toggle('pinned', pinned);
      pinButton.classList.toggle('pinned', pinned);
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    pinButton.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleCategoryPinWithChildren(category.id);
      // Update UI for all affected elements
      this.refreshPinStates();
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    header.appendChild(pinButton);
    categoryElement.appendChild(header);

    // Category content - contains stacks
    const content = document.createElement('div');
    content.className = 'section-content category-content';

    // Render all stacks in this category in existing order (sorted at import time)
    for (const stack of category.stacks) {
      const stackElement = this.createStackElement(stack);
      content.appendChild(stackElement);
    }

    categoryElement.appendChild(content);

    // Add expand/collapse functionality to the category
    this.addExpandCollapseHandler(categoryElement);

    return categoryElement;
  }

  private createStackElement(stack: UniqueStack): HTMLElement {
    const stackElement = document.createElement('div');
    stackElement.className = 'section expandable stack-section';
    stackElement.id = stack.id;

    // Stack header
    const header = document.createElement('div');
    header.className = 'header';

    const title = document.createElement('div');
    title.className = 'stack-title';
    title.textContent = stack.name;

    // Create count element and populate it
    const countElement = document.createElement('div');
    countElement.className = 'stack-count counts';

    header.appendChild(title);
    header.appendChild(countElement);
    
    // Create pin button (now child of header)
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-button size-large';
    pinButton.innerHTML = '📌';
    pinButton.title = 'Pin/unpin this stack';
    pinButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleStackPin(stack.id);
      stackElement.classList.toggle('pinned', pinned);
      pinButton.classList.toggle('pinned', pinned);
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    pinButton.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleStackPinWithChildren(stack.id);
      // Update UI for all affected elements
      this.refreshPinStates();
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    header.appendChild(pinButton);
    
    // Add header to stackElement so updateDisplayedCount can find the count element
    stackElement.appendChild(header);
    
    // Set initial count display
    this.updateDisplayedCount(stackElement, stack.counts);

    // Stack content
    const content = document.createElement('div');
    content.className = 'section-content stack-content';

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

    stackElement.appendChild(content);

    // Add expand/collapse functionality to the stack
    this.addExpandCollapseHandler(stackElement);

    return stackElement;
  }

  private createFileSection(fileId: string, fileName: string, groups: Group[]): HTMLElement {
    const fileSection = document.createElement('div');
    fileSection.className = 'section expandable file-section';
    fileSection.id = fileId;

    // Add single-group class for conditional file header hiding
    if (groups.length === 1) {
      fileSection.classList.add('single-group');
    }


    // File header
    const fileHeader = document.createElement('div');
    fileHeader.className = 'header';

    const leftContent = document.createElement('span');
    leftContent.className = 'title';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'expand-icon';

    const textSpan = document.createElement('span');
    textSpan.textContent = fileName;

    leftContent.appendChild(iconSpan);
    leftContent.appendChild(textSpan);

    const rightContent = document.createElement('span');
    rightContent.className = 'counts';
    
    fileHeader.appendChild(leftContent);
    fileHeader.appendChild(rightContent);

    fileSection.appendChild(fileHeader);

    const fileContent = document.createElement('div');
    fileContent.className = 'section-content';

    groups.forEach(group => {
      const groupSection = this.createGroupSection(group.id, group, fileName);
      fileContent.appendChild(groupSection);
    });

    fileSection.appendChild(fileContent);

    // Add click handler for file header using reusable function AFTER DOM structure is complete
    this.addExpandCollapseHandler(fileSection);

    return fileSection;
  }

  private createGroupSection(id: string, group: Group, fileName?: string): HTMLElement {
    const groupSection = document.createElement('div');
    groupSection.className = 'section expandable group-section';
    groupSection.id = id;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'header';

    const leftContent = document.createElement('span');
    leftContent.className = 'title';

    // Add expand icon for groups with content
    if (group.goroutines.length > 0) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'expand-icon';
      leftContent.appendChild(iconSpan);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'group-header-label';
    
    // Always show filename with group labels for consistency
    if (fileName) {
      const groupLabel = group.labels.length > 0 ? ` [${group.labels.join(', ')}]` : '';
      textSpan.textContent = `${fileName}${groupLabel}`;
    } else if (group.labels.length > 0) {
      textSpan.textContent = `[${group.labels.join(', ')}]`;
    } else {
      textSpan.textContent = 'Goroutines';
    }
    leftContent.appendChild(textSpan);

    const countContent = document.createElement('span');
    countContent.className = 'group-header-count counts';

    groupHeader.appendChild(leftContent);
    groupHeader.appendChild(countContent);
    
    // Create pin button for group (now child of header)
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-button size-large';
    pinButton.innerHTML = '📌';
    pinButton.title = 'Pin/unpin this group';
    pinButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleGroupPin(group.id);
      groupSection.classList.toggle('pinned', pinned);
      pinButton.classList.toggle('pinned', pinned);
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    pinButton.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.profileCollection.toggleGroupPinWithChildren(group.id);
      // Update UI for all affected elements
      this.refreshPinStates();
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });
    
    groupHeader.appendChild(pinButton);
    groupSection.appendChild(groupHeader);

    // Add click handler for expand/collapse if group has content
    if (group.goroutines.length > 0) {
      this.addExpandCollapseHandler(groupSection);
    }

    const groupContent = document.createElement('div');
    groupContent.className = 'section-content';

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
      const showMoreLink = document.createElement('div');
      showMoreLink.className = 'show-more-link';
      showMoreLink.innerHTML = `<span class="show-more-text">Show <span class="show-more-link-clickable">${remainingGoroutines.length} more</span> goroutines ▼</span>`;
      showMoreLink.addEventListener('click', e => {
        e.stopPropagation();
        // Create DOM elements for remaining goroutines (lazy creation)
        remainingGoroutines.forEach(goroutine => {
          const goroutineElement = this.createGoroutineElement(goroutine);
          groupContent.appendChild(goroutineElement);
        });
        // Remove the show more link since all goroutines are now visible
        showMoreLink.remove();
        this.setFilter({ filterString: this.filterInputValue });
      });
      groupContent.appendChild(showMoreLink);
    }

    groupSection.appendChild(groupContent);
    return groupSection;
  }

  private createTraceElement(trace: any[]): HTMLElement {
    const content = document.createElement('div');
    content.className = 'unique-stack-content';
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
    const goroutineElement = document.createElement('div');
    goroutineElement.className = 'goroutine-entry';
    goroutineElement.id = `goroutine-${goroutine.id}`;

    // Create header like old UI
    const header = document.createElement('div');
    header.className = 'goroutine-header';

    // First line with main header info (like old UI)
    const firstLine = document.createElement('div');
    firstLine.className = 'goroutine-header-first-line';

    // Format like old UI: show wait time if > 0, but no state (since it's in the group)
    const waitText = goroutine.waitMinutes > 0 ? ` (${goroutine.waitMinutes} minutes)` : '';
    const headerText = document.createElement('span');
    headerText.className = 'goroutine-header-left';
    headerText.textContent = `${goroutine.id}${waitText}:`;

    // Create pin button for goroutine
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-button size-small';
    pinButton.innerHTML = '📌';
    pinButton.title = 'Pin/unpin this goroutine';
    pinButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = this.profileCollection.toggleGoroutinePin(goroutine.id);
      goroutineElement.classList.toggle('pinned', pinned);
      pinButton.classList.toggle('pinned', pinned);
      this.setFilter({ filterString: this.filterInputValue });
      this.updateVisibility();
      this.updateStats();
    });

    goroutineElement.appendChild(pinButton);

    // Add created by link on the right side (like old UI)
    const createdBySection = document.createElement('span');
    createdBySection.className = 'goroutine-created-by';

    if (goroutine.creator && goroutine.creator !== goroutine.id) {
      createdBySection.innerHTML = 'created by ';

      if (goroutine.creatorExists) {
        const creatorLink = document.createElement('span');
        creatorLink.className = 'creator-link';
        creatorLink.textContent = goroutine.creator;
        creatorLink.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.navigateToGoroutine(goroutine.creator!, goroutine.id);
        });
        this.addTooltipToLink(creatorLink, goroutine.creator);
        createdBySection.appendChild(creatorLink);
      } else {
        const missingCreator = document.createElement('span');
        missingCreator.className = 'creator-missing';
        missingCreator.textContent = goroutine.creator;
        createdBySection.appendChild(missingCreator);
      }
    }

    firstLine.appendChild(headerText);
    if (goroutine.creator && goroutine.creator !== goroutine.id) {
      firstLine.appendChild(createdBySection);
    }
    header.appendChild(firstLine);

    // Second line with created goroutines (if any)
    if (goroutine.created.length > 0) {
      const secondLine = document.createElement('div');
      secondLine.className = 'goroutine-header-second-line';

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
        createdLink.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.navigateToGoroutine(created, goroutine.id);
        });
        this.addTooltipToLink(createdLink, created);
        secondLine.appendChild(createdLink);
      });

      if (goroutine.created.length > maxShow) {
        const moreText = document.createElement('span');
        moreText.textContent = ' and ';

        const moreLink = document.createElement('span');
        moreLink.textContent = `${goroutine.created.length - maxShow} more`;
        moreLink.className = 'created-goroutines-more creator-link';
        moreLink.style.cursor = 'pointer';
        moreLink.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.showAllCreatedGoroutines(goroutine.id, goroutine.created, secondLine);
        });
        secondLine.appendChild(moreText);
        secondLine.appendChild(moreLink);
      }

      header.appendChild(secondLine);
    }

    goroutineElement.appendChild(header);
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
          <div style="margin-top: 25px; padding-top: 5px; border-top: 1px solid #444;">
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

    const totalElement = document.getElementById('totalStacks');
    const visibleElement = document.getElementById('visibleStacks');
    const totalGoroutinesElement = document.getElementById('totalGoroutines');
    const visibleGoroutinesElement = document.getElementById('visibleGoroutines');

    if (totalElement) totalElement.textContent = stats.total.toString();
    if (visibleElement) visibleElement.textContent = stats.visible.toString();
    if (totalGoroutinesElement)
      totalGoroutinesElement.textContent = stats.totalGoroutines.toString();
    if (visibleGoroutinesElement)
      visibleGoroutinesElement.textContent = stats.visibleGoroutines.toString();
    
    // Also update file stats and unpin button visibility
    this.updateFileStats();
    this.updateUnpinButtonVisibility();
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
    if (unpinAllBtn) {
      const hasPinnedItems = this.profileCollection.hasAnyPinnedItems();
      unpinAllBtn.style.display = hasPinnedItems ? 'inline-block' : 'none';
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
          console.error('Demo file load error:', error);
          alert('Failed to load demo file. Please try again or check your internet connection.');
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
        console.log('StackTraceApp: Handling zip file from URL:', fileName);
        const arrayBuffer = await response.arrayBuffer();
        console.log('StackTraceApp: Got array buffer from URL, size:', arrayBuffer.byteLength);
        const JSZipClass = await getJSZip();
        if (!JSZipClass) {
          throw new Error('JSZip failed to load from CDN. Please check your internet connection and try again.');
        }
        console.log('StackTraceApp: Got JSZip class for URL zip:', typeof JSZipClass);
        const zip = new JSZipClass();
        console.log('StackTraceApp: URL JSZip instance created:', zip);
        const zipContent = await zip.loadAsync(arrayBuffer);
        console.log('StackTraceApp: URL zip loaded successfully');

        // Find stack trace files in the zip (using settings pattern)
        const pattern = this.settingsManager.getZipFilePatternRegex();
        const files = Object.keys(zipContent.files).filter(fileName => {
          return pattern.test(fileName);
        });

        for (const zipFileName of files) {
          const file = zipContent.files[zipFileName];
          if (!file.dir) {
            const content = await file.async('text');
            const baseName = zipFileName.split('/').pop() || zipFileName;
            const result = await this.parser.parseFile(content, baseName);

            if (result.success) {
              this.profileCollection.addFile(result.data); // Let extractedName take precedence
            } else {
              console.error(`URL zip - Failed to parse ${baseName}:`, result.error);
            }
          }
        }

        if (files.length === 0) {
          console.warn(`URL zip - No stack trace files found matching pattern: ${pattern}`);
        }
      } else {
        // Handle single text files
        const text = await response.text();
        const result = await this.parser.parseFile(text, fileName);

        if (result.success) {
          this.profileCollection.addFile(result.data);
        } else {
          console.error(`Failed to parse ${fileName}:`, result.error);
          throw new Error(result.error);
        }
      }

      this.render();

      // Always reapply current filter to ensure proper visibility state
      this.setFilter({ filterString: this.filterInputValue });
    } catch (error) {
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
      createdLink.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.navigateToGoroutine(created, creatorId);
      });
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
    if (!g.matches) {
      console.log(`Goroutine ${goroutineId} does not match current filter; forcing it visible...`);
      this.setFilter({ filterString: this.filterInputValue, forcedGoroutine: goroutineId });
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
      if (currentElement.classList.contains('expandable') && 
          currentElement.classList.contains('collapsed')) {
        // Remove the collapsed class to expand
        currentElement.classList.remove('collapsed');
        
        // Update aria-expanded for accessibility
        const header = currentElement.querySelector('.header');
        if (header) {
          header.setAttribute('aria-expanded', 'true');
        }
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
    if (backBtn) {
      const hasHistory = canGoBack !== undefined ? canGoBack : this.appState.canNavigateBack();
      backBtn.disabled = !hasHistory;
    }
  }

  private clearUrlAnchor(): void {
    // Clear any existing anchor in the URL to start fresh
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /**
   * Parse category ignored prefixes string into array
   */
  private parseCategoryIgnoredPrefixes(categoryIgnoredPrefixes: string): string[] {
    if (!categoryIgnoredPrefixes || typeof categoryIgnoredPrefixes !== 'string') {
      return [];
    }

    return categoryIgnoredPrefixes
      .split('\n')
      .map(prefix => prefix.trim())
      .filter(prefix => prefix.length > 0);
  }

  /**
   * Convert AppSettings to ProfileCollectionSettings format
   */
  private convertToProfileCollectionSettings(appSettings: AppSettings): ProfileCollectionSettings {
    return {
      functionPrefixesToTrim: this.settingsManager.getFunctionTrimPrefixes(),
      filePrefixesToTrim: this.settingsManager.getFileTrimPrefixes(),
      titleManipulationRules: this.settingsManager.getTitleManipulationRules(),
      nameExtractionPatterns: appSettings.nameExtractionPatterns,
      zipFilePattern: appSettings.zipFilePattern,
      categoryIgnoredPrefixes: this.parseCategoryIgnoredPrefixes(appSettings.categoryIgnoredPrefixes),
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
        settingsModal.style.display = 'none';
      });
    }

    if (settingsModal) {
      settingsModal.addEventListener('click', e => {
        if (e.target === settingsModal) {
          // Cancel changes - reload original settings
          this.loadSettingsIntoModal();
          settingsModal.style.display = 'none';
        }
      });
    }

    // Close modal with Escape key (cancel changes)
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && settingsModal && settingsModal.style.display === 'block') {
        // Cancel changes - reload original settings
        this.loadSettingsIntoModal();
        settingsModal.style.display = 'none';
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
      settingsModal.style.display = 'block';
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
    titleManipulationRules: {
      type: 'textarea' as const,
      serialize: (value: string) => value,
      deserialize: (value: any) => String(value),
    },
    categoryIgnoredPrefixes: {
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
        element.value = String(config.deserialize(value));
      }
    });
  }

  private saveSettingsFromModal(): void {
    // Collect all settings from the modal using config map
    const updates: Partial<AppSettings> = {};

    Object.entries(this.settingsConfig).forEach(([key, config]) => {
      const element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement;
      if (element) {
        let value: any;

        value = config.serialize(config.deserialize(element.value));

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
      settingsModal.style.display = 'none';
    }
  }

  private resetSettings(): void {
    this.settingsManager.resetToDefaults();
    this.loadSettingsIntoModal();
  }

  private createTooltip(): void {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'goroutine-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  private showTooltip(goroutineId: string, event: MouseEvent): void {
    const goroutine = this.profileCollection.getGoroutineByID(goroutineId);
    if (!goroutine) return;

    const stackTitle = goroutine.stack.name;
    const waitText = goroutine.waitMinutes > 0 ? `, ${goroutine.waitMinutes} mins` : '';
    
    this.tooltip.textContent = `[${goroutine.state}${waitText}] ${stackTitle}`;
    
    // Position off-screen first to measure it
    this.tooltip.style.left = '-9999px';
    this.tooltip.style.top = '-9999px';
    this.tooltip.style.transform = 'none';
    this.tooltip.style.display = 'block';

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
    this.tooltip.style.display = 'none';
  }

  private addTooltipToLink(link: HTMLElement, goroutineId: string): void {
    link.addEventListener('mouseenter', (event) => {
      this.showTooltip(goroutineId, event as MouseEvent);
    });

    link.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });

    link.addEventListener('mousemove', (event) => {
      this.tooltip.style.left = `${(event as MouseEvent).pageX - 20}px`;
      this.tooltip.style.top = `${(event as MouseEvent).pageY + 10}px`;
    });
  }
}
