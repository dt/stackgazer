import { FileCollection } from '../core/FileCollection.js';
import { BackgroundFileCollection } from '../core/BackgroundFileCollection.js';
import { StackCollection } from '../core/StackCollection.js';
import { ViewState } from '../core/ViewState.js';
import { SettingsManager } from '../core/SettingsManager.js';
import { ZipHandler } from '../core/ZipHandler.js';
import { Goroutine, UniqueStack, FilterQuery, AppSettings } from '../core/types.js';

/**
 * Main application class that manages the UI and coordinates between core components
 */
export class StackTraceApp {
  private fileCollection: BackgroundFileCollection;
  private stackCollection: StackCollection;
  private viewState: ViewState;
  private settingsManager: SettingsManager;
  private filterInputValue: string = '';
  private temporaryStateFilter: { state: string; mode: 'only' | 'exclude' } | null = null;

  constructor() {
    this.settingsManager = new SettingsManager();
    this.fileCollection = new BackgroundFileCollection([], this.settingsManager);
    this.stackCollection = new StackCollection(this.fileCollection);
    this.viewState = new ViewState();
    
    // Apply initial settings
    this.applySettingsToStackCollection();
    
    this.setupSettingsCallbacks();
    this.setupParsingProgress();
    this.initializeUI();
    this.loadPersistedState();
    this.clearUrlIfNoFiles();
    this.handleInitialUrl();
  }
  
  /**
   * Cleanup resources when app is destroyed
   */
  dispose(): void {
    this.fileCollection.dispose();
  }

  private setupSettingsCallbacks(): void {
    this.settingsManager.onChange((settings: AppSettings) => {
      this.onSettingsChanged(settings);
    });
  }

  private onSettingsChanged(settings: AppSettings): void {
    // Apply new settings to stack collection
    this.applySettingsToStackCollection();
    
    // Trigger reparse and refilter when settings change
    if (this.fileCollection.getFiles().size > 0) {
      this.reprocessAllFiles();
    }
  }

  private applySettingsToStackCollection(): void {
    const titleRules = this.settingsManager.getTitleManipulationRules();
    this.stackCollection.setTitleRules(titleRules);
  }

  private reprocessAllFiles(): void {
    // Store current files
    const files = this.fileCollection.getFiles();
    const currentFilter = this.filterInputValue;
    
    // Clear everything
    this.fileCollection.dispose();
    this.fileCollection = new BackgroundFileCollection([], this.settingsManager);
    this.setupParsingProgress();
    this.stackCollection = new StackCollection(this.fileCollection);
    
    // Apply settings to new stack collection
    this.applySettingsToStackCollection();
    
    // Re-add all files (this will trigger reparsing with new settings)
    const filePromises: Promise<void>[] = [];
    files.forEach((file, fileName) => {
      // We need to reconstruct file data - this is a limitation
      // In practice, we'd need to store the original file text
      console.log(`Reprocessing would require re-uploading file: ${fileName}`);
    });
    
    // For now, just re-render with current data
    this.render();
    
    // Re-apply filter
    if (currentFilter) {
      this.setFilter(currentFilter);
    }
  }
  
  private setupParsingProgress(): void {
    this.fileCollection.setProgressCallback((progress) => {
      this.updateParsingProgress(progress);
    });
  }
  
  private updateParsingProgress(progress: { fileName: string; progress: number; stage: string; error?: string }): void {
    // Update modal progress
    this.updateFileProcessingModal(progress);
    
    // Update UI to show parsing progress (legacy - kept for backward compatibility)
    const progressElement = document.getElementById('parsingProgress');
    if (progressElement) {
      if (progress.stage === 'error') {
        progressElement.textContent = `Error parsing ${progress.fileName}: ${progress.error}`;
        progressElement.className = 'parsing-progress error';
      } else if (progress.stage === 'complete') {
        progressElement.textContent = `Completed parsing ${progress.fileName}`;
        progressElement.className = 'parsing-progress complete';
        // Hide after a delay
        setTimeout(() => {
          progressElement.textContent = '';
          progressElement.className = 'parsing-progress hidden';
        }, 2000);
      } else {
        progressElement.textContent = `Parsing ${progress.fileName}... ${progress.progress}%`;
        progressElement.className = 'parsing-progress active';
      }
    }
  }

  private initializeUI(): void {
    this.setupEventListeners();
    this.setupBrowserHistory();
  }

  private loadPersistedState(): void {
    // Load filter string from localStorage
    const savedFilter = localStorage.getItem('stacktrace-filter');
    if (savedFilter) {
      this.setFilter(savedFilter);
      const filterInput = document.getElementById('filterInput') as HTMLInputElement;
      if (filterInput) {
        filterInput.value = savedFilter;
      }
    }

    // Load ViewState preferences
    const savedViewState = localStorage.getItem('stacktrace-viewstate');
    if (savedViewState) {
      this.viewState.deserialize(savedViewState);
      
      const stackDisplayModeSelect = document.getElementById('stackDisplayModeSelect') as HTMLSelectElement;
      if (stackDisplayModeSelect) {
        stackDisplayModeSelect.value = this.viewState.getStackDisplayMode();
      }
    }
  }

  private saveState(): void {
    // Save filter string
    localStorage.setItem('stacktrace-filter', this.filterInputValue);
    
    // Save ViewState preferences
    localStorage.setItem('stacktrace-viewstate', this.viewState.serialize());
  }

  private setupEventListeners(): void {
    // File drop zone - click handler only (drag handled by window)
    const dropZone = document.getElementById('dropZone')!;
    
    dropZone.addEventListener('click', (e) => {
      if (!dropZone.classList.contains('has-content') && e.target === dropZone) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.log,.zip';
        input.multiple = true;
        input.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            this.handleFiles(Array.from(files));
          }
        };
        input.click();
      }
    });

    // Filter input
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        this.filterInputValue = value;
        this.setFilter(value);
        this.saveState();
      });
    }

    // Clear filter button
    const clearFilterBtn = document.getElementById('clearFilterBtn');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => {
        this.clearFilter();
      });
    }

    // Filter help button
    const filterHelpBtn = document.getElementById('filterHelpBtn');
    const filterHelpModal = document.getElementById('filterHelpModal');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    
    if (filterHelpBtn && filterHelpModal) {
      filterHelpBtn.addEventListener('click', () => {
        filterHelpModal.style.display = 'block';
      });
    }
    
    if (modalCloseBtn && filterHelpModal) {
      modalCloseBtn.addEventListener('click', () => {
        filterHelpModal.style.display = 'none';
      });
    }
    
    // Close modal when clicking outside of it
    if (filterHelpModal) {
      filterHelpModal.addEventListener('click', (e) => {
        if (e.target === filterHelpModal) {
          filterHelpModal.style.display = 'none';
        }
      });
    }
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filterHelpModal && filterHelpModal.style.display === 'block') {
        filterHelpModal.style.display = 'none';
      }
    });

    // Additional file upload functionality
    const addFileBtn = document.getElementById('addFileBtn');
    const fileListContainer = document.getElementById('fileListContainer');
    
    if (addFileBtn) {
      addFileBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.log,.zip';
        input.multiple = true;
        input.onchange = (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            this.handleFiles(Array.from(files));
          }
        };
        input.click();
      });
    }

    if (fileListContainer) {
      fileListContainer.addEventListener('click', (e) => {
        // Only trigger file picker if clicking in the drop area
        if ((e.target as HTMLElement).classList.contains('file-drop-area') || 
            (e.target as HTMLElement).classList.contains('empty-state')) {
          if (addFileBtn) {
            addFileBtn.click();
          }
        }
      });
    }

    // Global drag and drop handlers to prevent browser file opening
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.handleFiles(Array.from(files));
      }
    });

    // View controls
    const backBtn = document.getElementById('backBtn');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const unpinAllBtn = document.getElementById('unpinAllBtn');
    const stackDisplayModeSelect = document.getElementById('stackDisplayModeSelect') as HTMLSelectElement;
    const clearAllBtn = document.getElementById('clearAllBtn');

    if (backBtn) backBtn.addEventListener('click', () => this.navigateBack());
    if (expandAllBtn) expandAllBtn.addEventListener('click', () => this.expandAll());
    if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => this.collapseAll());
    if (unpinAllBtn) unpinAllBtn.addEventListener('click', () => this.unpinAll());
    if (clearAllBtn) clearAllBtn.addEventListener('click', () => this.clearAll());
    

    if (stackDisplayModeSelect) {
      stackDisplayModeSelect.addEventListener('change', (e) => {
        const mode = (e.target as HTMLSelectElement).value as 'combined' | 'side-by-side' | 'functions' | 'locations';
        this.viewState.setStackDisplayMode(mode);
        this.updateStackDisplayMode(mode); // Use CSS switching instead of re-rendering
        this.saveState();
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if ((e.altKey && e.key === 'ArrowLeft') || 
          (e.key === 'Backspace' && !(e.target as Element)?.matches?.('input, textarea'))) {
        e.preventDefault();
        this.navigateBack();
      }
    });

    // Settings modal
    this.setupSettingsModal();

    // Demo buttons
    this.setupDemoButtons();
  }

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
        settingsModal.style.display = 'none';
      });
    }

    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          settingsModal.style.display = 'none';
        }
      });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsModal && settingsModal.style.display === 'block') {
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

    // Add change listeners to all settings inputs
    this.setupSettingsInputListeners();
  }

  private setupDemoButtons(): void {
    const demoSingleBtn = document.getElementById('demoSingleBtn');
    const demoZipBtn = document.getElementById('demoZipBtn');

    if (demoSingleBtn) {
      demoSingleBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          // Use HTTPS URLs for GitHub raw files - they work from both HTTP and HTTPS pages
          const rawUrl = 'https://raw.githubusercontent.com/dt/crdb-stacks-examples/refs/heads/main/stacks/files/1/stacks.txt';
          await this.loadFromUrl(rawUrl, 'crdb-demo-single.txt');
        } catch (error) {
          console.error('Demo single file load failed:', error);
          alert('Failed to load demo file. Please try again or check your internet connection.');
        }
      });
    }

    if (demoZipBtn) {
      demoZipBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          // Use HTTPS URLs for GitHub raw files - they work from both HTTP and HTTPS pages
          const url = 'https://raw.githubusercontent.com/dt/crdb-stacks-examples/refs/heads/main/stacks.zip';
          await this.loadFromUrl(url, 'crdb-demo.zip');
        } catch (error) {
          console.error('Demo zip file load failed:', error);
          alert('Failed to load demo zip file. Please try again or check your internet connection.');
        }
      });
    }
  }

  private async loadFromUrl(url: string, filename: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const file = new File([arrayBuffer], filename, { 
        type: filename.endsWith('.zip') ? 'application/zip' : 'text/plain' 
      });
      
      await this.handleFiles([file]);
    } catch (error) {
      console.error(`Failed to load file from ${url}:`, error);
      throw error;
    }
  }

  private setupSettingsInputListeners(): void {
    // Checkbox settings
    const checkboxes = [
      'strictParsingMode',
      'preserveArguments', 
      'autoExpandStacks'
    ];

    checkboxes.forEach(id => {
      const element = document.getElementById(id) as HTMLInputElement;
      if (element) {
        element.addEventListener('change', () => {
          this.updateSettingFromInput(id, element.checked);
        });
      }
    });

    // Number input settings
    const numberInputs = [
      'maxInitialGoroutines'
    ];

    numberInputs.forEach(id => {
      const element = document.getElementById(id) as HTMLInputElement;
      if (element) {
        element.addEventListener('input', () => {
          const value = parseInt(element.value, 10);
          if (!isNaN(value)) {
            this.updateSettingFromInput(id, value);
          }
        });
      }
    });

    // Text input settings
    const textInputs = [
      'functionTrimPrefixes',
      'fileTrimPrefixes',
      'zipFilePattern'
    ];
    
    // Textarea settings
    const textareaInputs = [
      'titleManipulationRules'
    ];

    textInputs.forEach(id => {
      const element = document.getElementById(id) as HTMLInputElement;
      if (element) {
        element.addEventListener('input', () => {
          this.updateSettingFromInput(id, element.value);
        });
      }
    });

    textareaInputs.forEach(id => {
      const element = document.getElementById(id) as HTMLTextAreaElement;
      if (element) {
        element.addEventListener('input', () => {
          this.updateSettingFromInput(id, element.value);
        });
      }
    });
  }

  private openSettingsModal(): void {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      this.loadSettingsIntoModal();
      settingsModal.style.display = 'block';
    }
  }

  private loadSettingsIntoModal(): void {
    const settings = this.settingsManager.getSettings();

    // Load all setting values into modal inputs
    Object.entries(settings).forEach(([key, value]) => {
      const element = document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement;
      if (element) {
        if (element.type === 'checkbox') {
          (element as HTMLInputElement).checked = value as boolean;
        } else if (element.type === 'number') {
          element.value = String(value);
        } else if (element.type === 'text' || element.tagName === 'TEXTAREA') {
          element.value = String(value);
        }
      }
    });
  }

  private updateSettingFromInput(settingKey: string, value: any): void {
    this.settingsManager.updateSetting(settingKey as keyof AppSettings, value);
  }

  private saveSettingsFromModal(): void {
    // Settings are saved automatically on change, so just close modal
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.style.display = 'none';
    }
  }

  private resetSettings(): void {
    this.settingsManager.resetToDefaults();
    this.loadSettingsIntoModal();
  }

  private setupBrowserHistory(): void {
    window.addEventListener('popstate', (event) => {
      if (event.state?.id) {
        this.navigateToGoroutine(event.state.id, false);
      } else {
        this.clearSelection();
      }
    });

    history.replaceState({ page: 'initial' }, '', window.location.href);
  }

  private clearUrlIfNoFiles(): void {
    // If no files are loaded and URL contains navigation parameters, clear them
    const allGoroutines = this.stackCollection.getAllGoroutines();
    if (allGoroutines.length === 0 && window.location.hash) {
      const url = new URL(window.location.href);
      if (url.hash.includes('goroutine=')) {
        history.replaceState({ page: 'initial' }, '', window.location.pathname);
      }
    }
  }

  private handleInitialUrl(): void {
    // Handle navigation from URL on page load (only if files are loaded)
    const allGoroutines = this.stackCollection.getAllGoroutines();
    if (allGoroutines.length > 0 && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const goroutineId = params.get('goroutine');
      const fileName = params.get('file');
      
      if (goroutineId) {
        // Try to navigate to the goroutine (don't add to history since it's from URL)
        this.navigateToGoroutine(decodeURIComponent(goroutineId), false);
      }
    }
  }

  private async handleFiles(files: File[]): Promise<void> {
    const operationId = `file-load-${Date.now()}`;
    const totalStartTime = performance.now();
    
    console.group(`🚀 File Loading Operation: ${operationId}`);
    console.log(`📁 Files to process: ${files.length}`);
    console.log(`📊 Total file size: ${this.formatBytes(files.reduce((sum, f) => sum + f.size, 0))}`);
    files.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.name} (${this.formatBytes(file.size)})`);
    });
    
    // Process zip files first
    let filesToProcess: File[] = [];
    const zipFileCount = files.filter(f => ZipHandler.isZipFile(f)).length;
    
    if (zipFileCount > 0) {
      console.log(`📦 Processing ${zipFileCount} zip file(s)...`);
      
      for (const file of files) {
        if (ZipHandler.isZipFile(file)) {
          try {
            const settings = this.settingsManager.getSettings();
            const pattern = settings.zipFilePattern || '**/stacks.txt';
            
            console.log(`📦 Extracting from ${file.name} with pattern: ${pattern}`);
            const extractedFiles = await ZipHandler.extractMatchingFiles(file, pattern);
            
            if (extractedFiles.length === 0) {
              const patternDesc = ZipHandler.getPatternDescription(pattern);
              console.warn(`No files found in ${file.name} matching pattern "${pattern}" (${patternDesc})`);
              
              // Show user-friendly message
              alert(`No stack trace files found in "${file.name}"\n\nPattern: ${pattern}\nExpected: ${patternDesc}\n\nYou can customize the pattern in Advanced Settings.`);
            } else {
              console.log(`📦 Extracted ${extractedFiles.length} file(s) from ${file.name}:`);
              extractedFiles.forEach(extracted => {
                console.log(`  - ${extracted.path} (${this.formatBytes(extracted.content.length)})`);
              });
              
              // Convert extracted content to virtual File objects
              const virtualFiles = ZipHandler.createVirtualFiles(extractedFiles, file.name);
              filesToProcess.push(...virtualFiles);
            }
          } catch (error) {
            console.error(`Error processing zip file ${file.name}:`, error);
            const message = error instanceof Error ? error.message : String(error);
            alert(`Error processing zip file "${file.name}":\n\n${message}`);
          }
        } else {
          // Regular file, add to processing list
          filesToProcess.push(file);
        }
      }
    } else {
      // No zip files, process all files normally
      filesToProcess.push(...files);
    }
    
    console.log(`📄 Final file list for processing: ${filesToProcess.length} file(s)`);
    filesToProcess.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.name} (${this.formatBytes(file.size)})`);
    });
    
    // Sort files by their derived names before processing
    if (filesToProcess.length > 1) {
      console.log(`🔤 Sorting ${filesToProcess.length} files by derived names...`);
      const sortStartTime = performance.now();
      
      // Compute derived names for all files
      const filesWithDerivedNames = await Promise.all(
        filesToProcess.map(async (file) => {
          const derivedName = await this.fileCollection.computeDerivedFileNameFromFile(file);
          return { file, derivedName };
        })
      );
      
      // Sort by derived name
      filesWithDerivedNames.sort((a, b) => a.derivedName.localeCompare(b.derivedName));
      
      // Extract the sorted files
      filesToProcess = filesWithDerivedNames.map(item => item.file);
      
      const sortEndTime = performance.now();
      console.log(`🔤 Sorted files in ${(sortEndTime - sortStartTime).toFixed(1)}ms:`);
      filesWithDerivedNames.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.file.name} → ${item.derivedName}`);
      });
    }
    
    // Show processing modal with final file list
    this.showFileProcessingModal(filesToProcess);
    
    try {
      // Measure parsing phase
      const parseStartTime = performance.now();
      const startMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      console.log(`⚡ Starting background parsing...`);
      this.updateFileProcessingMessage('Parsing files...');
      const parsedFiles = await this.fileCollection.addFiles(filesToProcess);
      
      const parseEndTime = performance.now();
      const parseTime = parseEndTime - parseStartTime;
      const endMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryDelta = endMemory - startMemory;
      
      console.log(`✅ Parsing completed in ${parseTime.toFixed(2)}ms`);
      console.log(`💾 Memory used: ${this.formatBytes(memoryDelta)} (${this.formatBytes(startMemory)} → ${this.formatBytes(endMemory)})`);
      
      // Log parsing results
      let totalGoroutines = 0;
      parsedFiles.forEach((parsedFile, index) => {
        totalGoroutines += parsedFile.goroutines.length;
        console.log(`📄 ${parsedFile.name}: ${parsedFile.goroutines.length} goroutines`);
      });
      
      console.log(`🧵 Total goroutines parsed: ${totalGoroutines}`);
      console.log(`⚡ Parsing rate: ${(totalGoroutines / (parseTime / 1000)).toFixed(0)} goroutines/sec`);

      // Update progress to "parsed"
      this.updateFileProcessingMessage('Parsed successfully!');
      await new Promise(resolve => setTimeout(resolve, 200)); // Brief pause to show "parsed" state

      // Measure cache invalidation
      this.updateFileProcessingMessage('Merging stack traces...');
      const cacheStartTime = performance.now();
      this.stackCollection.invalidateDataCaches();
      const cacheTime = performance.now() - cacheStartTime;
      console.log(`🗑️ Cache invalidation: ${cacheTime.toFixed(2)}ms`);
      
      // Hide file processing modal and show rendering modal
      this.hideFileProcessingModal();
      this.showRenderingModal();
      
      // Small delay to allow UI update before rendering
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Measure rendering phase with detailed breakdown
      const renderStartTime = performance.now();
      console.log(`🎨 Starting UI rendering...`);
      
      // Measure individual render steps with progress updates
      this.updateRenderingMessage('Rendering file list...');
      const renderFilesStart = performance.now();
      this.renderFiles();
      const renderFilesTime = performance.now() - renderFilesStart;
      console.log(`📂 renderFiles(): ${renderFilesTime.toFixed(2)}ms`);
      
      this.updateRenderingMessage('Building stack trace groups...');
      const renderStacksStart = performance.now();
      this.renderStacks();
      const renderStacksTime = performance.now() - renderStacksStart;
      console.log(`📚 renderStacks(): ${renderStacksTime.toFixed(2)}ms`);
      
      this.updateRenderingMessage('Updating interface...');
      const updateDropZoneStart = performance.now();
      this.updateDropZone();
      const updateDropZoneTime = performance.now() - updateDropZoneStart;
      console.log(`💧 updateDropZone(): ${updateDropZoneTime.toFixed(2)}ms`);
      
      this.updateRenderingMessage('Calculating statistics...');
      const updateStatsStart = performance.now();
      this.updateStats();
      const updateStatsTime = performance.now() - updateStatsStart;
      console.log(`📊 updateStats(): ${updateStatsTime.toFixed(2)}ms`);
      
      this.updateRenderingMessage('Finalizing...');
      const updateFileDropZoneStart = performance.now();
      this.updateFileDropZoneVisibility();
      const updateFileDropZoneTime = performance.now() - updateFileDropZoneStart;
      console.log(`👁️ updateFileDropZoneVisibility(): ${updateFileDropZoneTime.toFixed(2)}ms`);
      
      const renderTime = performance.now() - renderStartTime;
      console.log(`✅ Total rendering completed in ${renderTime.toFixed(2)}ms`);
      console.log(`📈 Render breakdown: Files ${(renderFilesTime/renderTime*100).toFixed(1)}%, Stacks ${(renderStacksTime/renderTime*100).toFixed(1)}%, Stats ${(updateStatsTime/renderTime*100).toFixed(1)}%`);
      
      // Calculate total time
      const totalTime = performance.now() - totalStartTime;
      console.log(`⏱️ Total operation time: ${totalTime.toFixed(2)}ms`);
      console.log(`📈 Breakdown: Parse ${(parseTime/totalTime*100).toFixed(1)}%, Render ${(renderTime/totalTime*100).toFixed(1)}%`);
      
      // Hide rendering modal after successful completion
      this.hideRenderingModal();
      
      // Log final memory state
      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
      console.log(`💾 Final memory: ${this.formatBytes(finalMemory)} (net change: ${this.formatBytes(finalMemory - startMemory)})`);
      
      console.groupEnd();
      
    } catch (error) {
      const totalTime = performance.now() - totalStartTime;
      console.error(`❌ File loading failed after ${totalTime.toFixed(2)}ms:`, error);
      console.groupEnd();
      
      const message = error instanceof Error ? error.message : String(error);
      
      // Hide modals first
      this.hideFileProcessingModal();
      this.hideRenderingModal();
      
      // Check if it's a duplicate detection error
      if (message.includes('Duplicate file content detected')) {
        alert(`Duplicate file detected:\n\n${message}`);
      } else {
        const errorMessage = `Parse error:\n\n${message}\n\nCheck the console for details.`;
        alert(errorMessage);
      }
    }
  }

  private updateFileDropZoneVisibility(): void {
    const fileListContainer = document.getElementById('fileListContainer');
    if (fileListContainer) {
      const hasFiles = this.fileCollection.getFiles().size > 0;
      if (hasFiles) {
        fileListContainer.classList.add('has-files');
      } else {
        fileListContainer.classList.remove('has-files');
      }
    }
  }

  private setFilter(query: string): void {
    const filterQuery = this.stackCollection.setFilter(query);
    
    // Show filter validation
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      if (filterQuery.valid) {
        filterInput.classList.remove('error');
        filterInput.title = '';
      } else {
        filterInput.classList.add('error');
        filterInput.title = filterQuery.error || 'Invalid filter';
      }
    }

    this.updateStats();
    this.updateVisibility();
  }

  private clearFilter(): void {
    this.filterInputValue = '';
    this.stackCollection.clearFilter();
    
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      filterInput.value = '';
      filterInput.classList.remove('error');
      filterInput.title = '';
    }

    this.updateStats();
    this.updateVisibility();
    this.saveState();
  }

  private render(): void {
    this.renderFiles();
    this.renderStacks();
    this.updateDropZone();
    this.updateStats();
    this.updateFileDropZoneVisibility();
  }

  private renderFiles(): void {
    const fileList = document.getElementById('fileList')!;
    const files = this.fileCollection.getFiles();
    
    fileList.innerHTML = '';
    
    if (files.size === 0) {
      fileList.innerHTML = '<div class="empty-state">Drop files here or click <strong>+</strong> to add</div>';
      return;
    }

    const goroutineCounts = this.stackCollection.getVisibleGoroutineCountsByFile();

    files.forEach((file, fileName) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      fileItem.dataset.fileName = fileName; // Store the actual fileName key for lookups
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'file-name';
      nameDiv.textContent = file.name;
      
      const counts = goroutineCounts.get(fileName) || { visible: 0, total: file.goroutines.length };
      const statsDiv = document.createElement('div');
      statsDiv.className = 'file-stats';
      statsDiv.textContent = `${counts.visible} / ${counts.total} goroutines`;
      
      // Add stats to the name div for vertical layout
      nameDiv.appendChild(statsDiv);
      
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'file-controls';
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent toggle when clicking remove
        this.fileCollection.removeFile(fileName);
        this.stackCollection.invalidateDataCaches();
        this.render();
      });
      
      controlsDiv.appendChild(removeBtn);
      
      // Check if file is hidden and apply visual styling
      const isHidden = this.stackCollection.getHiddenFiles().has(fileName);
      if (isHidden) {
        fileItem.classList.add('file-hidden');
      }
      
      // Make the whole file item clickable to toggle
      fileItem.style.cursor = 'pointer';
      fileItem.title = isHidden ? 'Click to show this file' : 'Click to hide this file';
      fileItem.addEventListener('click', () => {
        this.stackCollection.toggleFileVisibility(fileName);
        this.updateStats();
        this.updateVisibility();
        this.renderFiles(); // Re-render files to update visual state
      });
      
      fileItem.appendChild(nameDiv);
      fileItem.appendChild(controlsDiv);
      
      fileList.appendChild(fileItem);
    });

    // Add drop area at the bottom when there are files
    const dropArea = document.createElement('div');
    dropArea.className = 'file-drop-area';
    dropArea.textContent = 'Drop more files here';
    fileList.appendChild(dropArea);
  }

  private renderStacks(): void {
    const dropZone = document.getElementById('dropZone')!;
    const allGoroutines = this.stackCollection.getAllGoroutines();
    
    if (allGoroutines.length === 0) {
      this.updateDropZone();
      return;
    }

    dropZone.className = 'drop-zone has-content';
    
    const stackDisplay = document.createElement('div');
    stackDisplay.className = 'stack-display';
    stackDisplay.id = 'stackDisplay';
    
    // Build DOM from ALL unique stacks, not just filtered ones
    const getUniqueStacksStart = performance.now();
    const uniqueStacks = this.stackCollection.getUniqueStacks();
    const getUniqueStacksTime = performance.now() - getUniqueStacksStart;
    console.log(`🔍 getUniqueStacks(): ${getUniqueStacksTime.toFixed(2)}ms for ${uniqueStacks.length} stacks`);
    
    const buildDomStart = performance.now();
    uniqueStacks.forEach((uniqueStack, index) => {
      // Update progress for large datasets
      if (uniqueStacks.length > 50 && index % Math.ceil(uniqueStacks.length / 10) === 0) {
        const progress = Math.round((index / uniqueStacks.length) * 100);
        this.updateRenderingProgress(`<div>Creating stack groups: ${progress}% (${index}/${uniqueStacks.length})</div>`);
      }
      
      const groupElement = this.createUniqueStackGroup(uniqueStack, index);
      stackDisplay.appendChild(groupElement);
    });
    const buildDomTime = performance.now() - buildDomStart;
    console.log(`🏗️ DOM creation: ${buildDomTime.toFixed(2)}ms for ${uniqueStacks.length} groups`);
    
    this.updateRenderingProgress(`<div>Inserting into page...</div>`);
    const domReplaceStart = performance.now();
    dropZone.innerHTML = '';
    dropZone.appendChild(stackDisplay);
    const domReplaceTime = performance.now() - domReplaceStart;
    console.log(`🔄 DOM replacement: ${domReplaceTime.toFixed(2)}ms`);
    
    // After building DOM, apply visibility filtering
    this.updateRenderingProgress(`<div>Applying filters...</div>`);
    const visibilityStart = performance.now();
    this.updateStackVisibility();
    const visibilityTime = performance.now() - visibilityStart;
    console.log(`👁️ updateStackVisibility(): ${visibilityTime.toFixed(2)}ms`);
  }

  private updateStackVisibility(): void {
    const visibleGoroutines = this.stackCollection.getVisibleGoroutines();
    const visibleGoroutineIds = new Set(visibleGoroutines.map(g => g.id));
    const visibleStackFingerprints = new Set(visibleGoroutines.map(g => this.stackCollection.getStackFingerprint(g)));
    
    // Group visible goroutines by stack fingerprint for summary updates
    const visibleGoroutinesByStack = new Map<string, Goroutine[]>();
    visibleGoroutines.forEach(goroutine => {
      const fingerprint = this.stackCollection.getStackFingerprint(goroutine);
      if (!visibleGoroutinesByStack.has(fingerprint)) {
        visibleGoroutinesByStack.set(fingerprint, []);
      }
      visibleGoroutinesByStack.get(fingerprint)!.push(goroutine);
    });
    
    // Show/hide stack groups based on whether they have visible goroutines
    document.querySelectorAll('.stack-group').forEach(groupElement => {
      const groupId = groupElement.getAttribute('data-stack-id');
      const hasVisibleGoroutines = groupId && visibleStackFingerprints.has(groupId);
      
      if (hasVisibleGoroutines) {
        (groupElement as HTMLElement).style.display = '';
        // Update the group to show only visible goroutines
        this.updateGroupGoroutineVisibility(groupElement, visibleGoroutineIds);
        // Update the group header summary with filtered counts
        this.updateGroupSummary(groupElement, visibleGoroutinesByStack.get(groupId!) || []);
      } else {
        (groupElement as HTMLElement).style.display = 'none';
      }
    });
  }

  private updateGroupGoroutineVisibility(groupElement: Element, visibleGoroutineIds: Set<string>): void {
    // Show/hide individual goroutines within the group
    groupElement.querySelectorAll('.goroutine-entry').forEach(goroutineElement => {
      const goroutineId = goroutineElement.getAttribute('data-goroutine-id');
      const isVisible = goroutineId && visibleGoroutineIds.has(goroutineId);
      
      if (isVisible) {
        (goroutineElement as HTMLElement).style.display = '';
      } else {
        (goroutineElement as HTMLElement).style.display = 'none';
      }
    });
    
    // Update state group headers to show correct counts
    this.updateStateGroupCounts(groupElement, visibleGoroutineIds);
  }

  private updateStateGroupCounts(groupElement: Element, visibleGoroutineIds: Set<string>): void {
    groupElement.querySelectorAll('.state-group').forEach(stateGroup => {
      const header = stateGroup.querySelector('.state-group-header span:first-child');
      if (!header) return;
      
      const goroutinesInState = stateGroup.querySelectorAll('.goroutine-entry');
      let visibleCount = 0;
      let totalCount = 0;
      
      goroutinesInState.forEach(goroutineElement => {
        totalCount++;
        const goroutineId = goroutineElement.getAttribute('data-goroutine-id');
        if (goroutineId && visibleGoroutineIds.has(goroutineId)) {
          visibleCount++;
        }
      });
      
      // Extract state name from current header text
      const currentText = header.textContent || '';
      const stateMatch = currentText.match(/^([^-]+)/);
      const stateName = stateMatch ? stateMatch[1].trim() : 'unknown';
      
      // Update header text to show visible/total counts
      if (visibleCount === totalCount) {
        header.textContent = `${stateName} - ${totalCount} goroutine${totalCount > 1 ? 's' : ''}`;
      } else {
        header.textContent = `${stateName} - ${visibleCount}/${totalCount} goroutine${totalCount > 1 ? 's' : ''}`;
      }
      
      // Hide state groups with no visible goroutines
      if (visibleCount === 0) {
        (stateGroup as HTMLElement).style.display = 'none';
      } else {
        (stateGroup as HTMLElement).style.display = '';
      }
    });
  }

  private toggleStackPin(stackId: string): void {
    this.stackCollection.toggleStackPin(stackId);
    this.updateStats();
  }

  private toggleGoroutinePin(goroutineId: string): void {
    this.stackCollection.toggleGoroutinePin(goroutineId);
    this.updateStats();
  }

  private updateStackPinState(pinBtn: HTMLButtonElement, stackId: string): void {
    const pinnedStacks = this.stackCollection.getPinnedStacks();
    if (pinnedStacks.has(stackId)) {
      pinBtn.classList.add('pinned');
      pinBtn.title = 'Unpin this stack group';
    } else {
      pinBtn.classList.remove('pinned');
      pinBtn.title = 'Pin this stack group';
    }
  }

  private updateGoroutinePinState(pinBtn: HTMLButtonElement, goroutineId: string): void {
    const pinnedGoroutines = this.stackCollection.getPinnedGoroutines();
    if (pinnedGoroutines.has(goroutineId)) {
      pinBtn.classList.add('pinned');
      pinBtn.title = 'Unpin this goroutine';
    } else {
      pinBtn.classList.remove('pinned');
      pinBtn.title = 'Pin this goroutine';
    }
  }

  private updateGroupSummary(groupElement: Element, visibleGoroutines: Goroutine[]): void {
    const summarySpan = groupElement.querySelector('.group-title-summary');
    if (!summarySpan) return;
    
    // Generate new summary with filtered goroutines and update the summary span
    const timeSummary = this.generateUniqueStackSummary(visibleGoroutines);
    summarySpan.textContent = timeSummary;
  }

  private updateFileStats(): void {
    const goroutineCounts = this.stackCollection.getVisibleGoroutineCountsByFile();
    
    // Update each file's stats display
    document.querySelectorAll('.file-item').forEach(fileItem => {
      const fileName = (fileItem as HTMLElement).dataset.fileName;
      if (!fileName) return;
      
      const statsDiv = fileItem.querySelector('.file-stats');
      if (!statsDiv) return;
      
      const counts = goroutineCounts.get(fileName);
      if (counts) {
        statsDiv.textContent = `${counts.visible} / ${counts.total} goroutines`;
      }
    });
  }

  private updateStackDisplayMode(mode: string): void {
    // Update the data-display-mode attribute on all unique-stack-content elements
    document.querySelectorAll('.unique-stack-content').forEach(content => {
      content.setAttribute('data-display-mode', mode);
    });
  }

  private createUniqueStackGroup(uniqueStack: UniqueStack, index: number): HTMLElement {
    const createGroupStart = performance.now();
    
    const groupElement = document.createElement('div');
    groupElement.className = 'stack-group';
    groupElement.id = `group-${index}`;
    groupElement.setAttribute('data-stack-id', uniqueStack.id);
    
    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    
    const groupTitle = document.createElement('span');
    groupTitle.className = 'group-title';
    groupTitle.addEventListener('click', () => {
      this.viewState.toggleGroup(uniqueStack.id);
      this.updateGroupVisibility(groupElement, uniqueStack.id);
    });
    
    // Create separate elements for title and summary
    const titleSpan = document.createElement('span');
    titleSpan.className = 'group-title-text';
    titleSpan.textContent = uniqueStack.title;
    
    const summarySpan = document.createElement('span');
    summarySpan.className = 'group-title-summary';
    const timeSummary = this.generateUniqueStackSummary(uniqueStack.goroutines);
    summarySpan.textContent = timeSummary;
    
    groupTitle.appendChild(titleSpan);
    groupTitle.appendChild(summarySpan);
    
    const groupControls = document.createElement('div');
    groupControls.className = 'group-controls';
    
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.textContent = '📌';
    pinBtn.title = 'Pin this stack group';
    pinBtn.dataset.stackId = uniqueStack.id;
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleStackPin(uniqueStack.id);
      this.updateStackPinState(pinBtn, uniqueStack.id);
    });
    
    // Set initial pin state
    this.updateStackPinState(pinBtn, uniqueStack.id);
    
    groupControls.appendChild(pinBtn);
    
    groupHeader.appendChild(groupTitle);
    groupHeader.appendChild(groupControls);
    
    // Group content
    const groupContent = document.createElement('div');
    groupContent.className = 'group-content';
    groupContent.id = `group-content-${index}`;
    
    // Show unique stack first
    const uniqueStackElement = this.createUniqueStackView(uniqueStack);
    groupContent.appendChild(uniqueStackElement);
    
    // Then show goroutines grouped by state
    this.renderStateGroups(groupContent, uniqueStack.goroutines);
    
    groupElement.appendChild(groupHeader);
    groupElement.appendChild(groupContent);
    
    // Expand unique stacks based on settings
    const settings = this.settingsManager.getSettings();
    if (settings.autoExpandStacks && !this.viewState.isGroupExpanded(uniqueStack.id)) {
      this.viewState.expandGroup(uniqueStack.id);
    } else if (!settings.autoExpandStacks && !this.viewState.isGroupExpanded(uniqueStack.id)) {
      // Default behavior: expand by default (backwards compatibility)
      this.viewState.expandGroup(uniqueStack.id);
    }
    
    // Apply initial visibility
    this.updateGroupVisibility(groupElement, uniqueStack.id);
    
    const createGroupTime = performance.now() - createGroupStart;
    if (createGroupTime > 50) { // Only log slow groups
      console.log(`🐌 Slow group creation: ${createGroupTime.toFixed(2)}ms for group ${index} with ${uniqueStack.goroutines.length} goroutines`);
    }
    
    return groupElement;
  }

  private createUniqueStackView(uniqueStack: UniqueStack): HTMLElement {
    const element = document.createElement('div');
    element.className = 'unique-stack-view';
    
    const content = document.createElement('div');
    content.className = 'unique-stack-content';
    content.setAttribute('data-display-mode', this.viewState.getStackDisplayMode());
    
    // Generate ALL display modes and embed them in the DOM
    const formatStart = performance.now();
    const combinedHtml = this.formatCombinedStackTrace(uniqueStack);
    const sideBySideHtml = this.formatSideBySideStackTrace(uniqueStack);
    const functionsHtml = this.formatFunctionsOnlyStackTrace(uniqueStack);
    const locationsHtml = this.formatLocationsOnlyStackTrace(uniqueStack);
    const formatTime = performance.now() - formatStart;
    
    const setInnerHtmlStart = performance.now();
    content.innerHTML = `<div class="stack-display-combined">${combinedHtml}</div><div class="stack-display-side-by-side">${sideBySideHtml}</div><div class="stack-display-functions">${functionsHtml}</div><div class="stack-display-locations">${locationsHtml}</div>`;
    const setInnerHtmlTime = performance.now() - setInnerHtmlStart;
    
    if (formatTime > 20) { // Only log slow formatting
      console.log(`🎨 Slow stack formatting: ${formatTime.toFixed(2)}ms + ${setInnerHtmlTime.toFixed(2)}ms innerHTML for ${uniqueStack.calls.length} calls`);
    }
    
    element.appendChild(content);
    
    return element;
  }

  private generateUniqueStackSummary(goroutines: Goroutine[]): string {
    const total = goroutines.length;
    
    // Group by state
    const stateGroups: { [state: string]: number[] } = {};
    goroutines.forEach(goroutine => {
      if (!stateGroups[goroutine.state]) {
        stateGroups[goroutine.state] = [];
      }
      stateGroups[goroutine.state].push(goroutine.durationMinutes);
    });
    
    const stateEntries = Object.entries(stateGroups);
    
    // If all goroutines are in the same state, use simplified format
    if (stateEntries.length === 1) {
      const [state, durations] = stateEntries[0];
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      
      let summary = `${total} goroutine${total > 1 ? 's' : ''} ${state}`;
      
      // Add duration range if any goroutines have non-zero duration
      if (maxDuration > 0) {
        if (minDuration === maxDuration) {
          summary += ` (${minDuration} min${minDuration > 1 ? 's' : ''})`;
        } else {
          summary += ` (${minDuration}-${maxDuration} mins)`;
        }
      }
      
      return summary;
    }
    
    // Multiple states, use detailed breakdown
    const stateParts: string[] = [];
    
    // Add state breakdowns
    stateEntries.forEach(([state, durations]) => {
      const count = durations.length;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      
      let statePart = `${count} ${state}`;
      
      // Add duration range if any goroutines have non-zero duration
      if (maxDuration > 0) {
        if (minDuration === maxDuration) {
          statePart += ` (${minDuration} min${minDuration > 1 ? 's' : ''})`;
        } else {
          statePart += ` (${minDuration}-${maxDuration} mins)`;
        }
      }
      
      stateParts.push(statePart);
    });
    
    return `${total} goroutine${total > 1 ? 's' : ''}: ${stateParts.join(', ')}`;
  }

  private renderStateGroups(container: HTMLElement, goroutines: Goroutine[]): void {
    if (goroutines.length > 500) { // Only instrument for large groups
      const stateGroupsStart = performance.now();
      
      // Group by state
      const stateGroups = new Map<string, Goroutine[]>();
      goroutines.forEach(goroutine => {
        const state = goroutine.state;
        if (!stateGroups.has(state)) {
          stateGroups.set(state, []);
        }
        stateGroups.get(state)!.push(goroutine);
      });

      // Sort states and render groups
      const sortedStates = Array.from(stateGroups.keys()).sort();
      
      const createStateGroupsStart = performance.now();
      sortedStates.forEach(state => {
        const stateGoroutines = stateGroups.get(state)!;
        const stateElement = this.createStateGroup(state, stateGoroutines);
        container.appendChild(stateElement);
      });
      const createStateGroupsTime = performance.now() - createStateGroupsStart;
      
      const totalTime = performance.now() - stateGroupsStart;
      console.log(`🔧 Large state group rendering: ${totalTime.toFixed(2)}ms for ${goroutines.length} goroutines across ${sortedStates.length} states (${createStateGroupsTime.toFixed(2)}ms in createStateGroup)`);
    } else {
      // Group by state
      const stateGroups = new Map<string, Goroutine[]>();
      goroutines.forEach(goroutine => {
        const state = goroutine.state;
        if (!stateGroups.has(state)) {
          stateGroups.set(state, []);
        }
        stateGroups.get(state)!.push(goroutine);
      });

      // Sort states and render groups
      const sortedStates = Array.from(stateGroups.keys()).sort();
      
      sortedStates.forEach(state => {
        const stateGoroutines = stateGroups.get(state)!;
        const stateElement = this.createStateGroup(state, stateGoroutines);
        container.appendChild(stateElement);
      });
    }
  }

  private createStateGroup(state: string, goroutines: Goroutine[]): HTMLElement {
    const stateElement = document.createElement('div');
    stateElement.className = 'state-group';
    
    const stateHeader = document.createElement('div');
    stateHeader.className = 'state-group-header';
    
    const headerTitle = document.createElement('span');
    headerTitle.textContent = `${state} - ${goroutines.length} goroutine${goroutines.length > 1 ? 's' : ''}`;
    
    const expandIndicator = document.createElement('span');
    expandIndicator.textContent = '▲';
    
    stateHeader.appendChild(headerTitle);
    stateHeader.appendChild(expandIndicator);
    
    stateHeader.addEventListener('click', () => {
      this.toggleStateGroup(stateElement, expandIndicator);
    });
    
    const stateContent = document.createElement('div');
    stateContent.className = 'state-group-content';
    
    // Sort goroutines by duration and ID
    const sortedGoroutines = [...goroutines].sort((a, b) => {
      if (a.durationMinutes !== b.durationMinutes) {
        return a.durationMinutes - b.durationMinutes;
      }
      return a.originalId.localeCompare(b.originalId);
    });
    
    // Show first N goroutines initially, rest behind "show more" link
    const maxInitialShow = this.settingsManager.getSettings().maxInitialGoroutines;
    const initialGoroutines = sortedGoroutines.slice(0, maxInitialShow);
    const remainingGoroutines = sortedGoroutines.slice(maxInitialShow);
    
    // Add initial goroutines
    initialGoroutines.forEach(goroutine => {
      const goroutineElement = this.createGoroutineEntry(goroutine);
      stateContent.appendChild(goroutineElement);
    });
    
    // Add "show more" section if there are remaining goroutines
    if (remainingGoroutines.length > 0) {
      // "Show more" link - DO NOT create DOM elements for remaining goroutines yet!
      const showMoreLink = document.createElement('div');
      showMoreLink.className = 'show-more-link';
      showMoreLink.innerHTML = `<span class="show-more-text">Show ${remainingGoroutines.length} more goroutines ▼</span>`;
      showMoreLink.addEventListener('click', (e) => {
        e.stopPropagation();
        
        const expandStart = performance.now();
        
        // NOW create DOM elements for remaining goroutines (lazy creation)
        remainingGoroutines.forEach(goroutine => {
          const goroutineElement = this.createGoroutineEntry(goroutine);
          stateContent.appendChild(goroutineElement);
        });
        
        const expandTime = performance.now() - expandStart;
        console.log(`⚡ Lazy expansion: ${expandTime.toFixed(2)}ms for ${remainingGoroutines.length} goroutines`);
        
        // Remove the show more link
        showMoreLink.remove();
      });
      
      stateContent.appendChild(showMoreLink);
    }
    
    stateElement.appendChild(stateHeader);
    stateElement.appendChild(stateContent);
    
    return stateElement;
  }

  private createGoroutineEntry(goroutine: Goroutine): HTMLElement {
    const entry = document.createElement('div');
    entry.className = 'goroutine-entry';
    entry.dataset.goroutineId = goroutine.id;
    
    const header = document.createElement('div');
    header.className = 'goroutine-header';
    header.addEventListener('click', () => {
      this.toggleGoroutineStack(entry, goroutine);
    });
    
    // First line with main header info
    const firstLine = document.createElement('div');
    firstLine.className = 'goroutine-header-first-line';
    
    // Left side container for pin button and header text
    const leftContainer = document.createElement('div');
    leftContainer.className = 'goroutine-header-left';
    
    // Add pin button for goroutine
    const pinBtn = document.createElement('button');
    pinBtn.className = 'goroutine-pin-btn';
    pinBtn.textContent = '📌';
    pinBtn.title = 'Pin this goroutine';
    pinBtn.dataset.goroutineId = goroutine.id;
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleGoroutinePin(goroutine.id);
      this.updateGoroutinePinState(pinBtn, goroutine.id);
    });
    
    // Set initial pin state
    this.updateGoroutinePinState(pinBtn, goroutine.id);
    
    const headerText = document.createElement('span');
    headerText.textContent = this.formatGoroutineHeader(goroutine);
    
    leftContainer.appendChild(pinBtn);
    leftContainer.appendChild(headerText);
    
    // Add created by link on the right side
    const createdBySection = document.createElement('span');
    createdBySection.className = 'goroutine-created-by';
    
    if (goroutine.createdBy) {
      const creator = this.stackCollection.findGoroutineById(goroutine.createdBy.creatorId);
      createdBySection.innerHTML = 'created by ';
      
      if (creator) {
        const creatorLink = document.createElement('span');
        creatorLink.className = 'creator-link';
        creatorLink.dataset.creatorId = creator.id;
        creatorLink.textContent = goroutine.createdBy.creatorId;
        creatorLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.navigateToGoroutine(creator.id, true, goroutine.id);
        });
        createdBySection.appendChild(creatorLink);
      } else {
        const missingCreator = document.createElement('span');
        missingCreator.className = 'creator-missing';
        missingCreator.textContent = goroutine.createdBy.creatorId;
        createdBySection.appendChild(missingCreator);
      }
    }
    
    firstLine.appendChild(leftContainer);
    if (goroutine.createdBy) {
      firstLine.appendChild(createdBySection);
    }
    header.appendChild(firstLine);
    
    // Second line with created goroutines (if any)
    const createdGoroutines = this.stackCollection.findCreatedGoroutines(goroutine.id);
    if (createdGoroutines.length > 0) {
      const secondLine = document.createElement('div');
      secondLine.className = 'goroutine-header-second-line';
      
      const createdText = document.createElement('span');
      createdText.className = 'created-goroutines-label';
      createdText.textContent = `created ${createdGoroutines.length} goroutine${createdGoroutines.length > 1 ? 's' : ''}: `;
      secondLine.appendChild(createdText);
      
      // Show first few created goroutines as clickable links
      const maxShow = 5;
      const toShow = createdGoroutines.slice(0, maxShow);
      
      toShow.forEach((created, index) => {
        if (index > 0) {
          const separator = document.createElement('span');
          separator.textContent = ', ';
          secondLine.appendChild(separator);
        }
        
        const createdLink = document.createElement('span');
        createdLink.className = 'creator-link';
        createdLink.dataset.creatorId = created.id;
        createdLink.textContent = created.id;
        createdLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.navigateToGoroutine(created.id, true, goroutine.id);
        });
        secondLine.appendChild(createdLink);
      });
      
      if (createdGoroutines.length > maxShow) {
        const moreText = document.createElement('span');
        moreText.textContent = ` and ${createdGoroutines.length - maxShow} more`;
        moreText.className = 'created-goroutines-more clickable';
        moreText.title = 'Click to show all created goroutines';
        moreText.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Remove the "and x more" text
          moreText.remove();
          
          // Add all remaining created goroutines
          const remainingGoroutines = createdGoroutines.slice(maxShow);
          remainingGoroutines.forEach((created, index) => {
            const separator = document.createElement('span');
            separator.textContent = ', ';
            secondLine.appendChild(separator);
            
            const createdLink = document.createElement('span');
            createdLink.className = 'creator-link';
            createdLink.dataset.creatorId = created.id;
            createdLink.textContent = created.id;
            createdLink.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.navigateToGoroutine(created.id, true, goroutine.id);
            });
            secondLine.appendChild(createdLink);
          });
        });
        secondLine.appendChild(moreText);
      }
      
      header.appendChild(secondLine);
    }
    
    const stack = document.createElement('div');
    stack.className = 'goroutine-stack';
    entry.appendChild(header);
    entry.appendChild(stack);
    
    return entry;
  }

  private formatStackTrace(calls: any[]): string {
    let html = '';
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      html += `<div class="stack-line">`;
      html += `<span class="function-name">${this.escapeHtml(call.function)}</span>`;
      if (call.args) {
        html += `<span class="function-args">${this.escapeHtml(call.args)}</span>`;
      }
      html += `</div>`;
      html += `<div class="stack-line">\t<span class="file-path">${this.escapeHtml(call.file)}</span>:<span class="line-number">${call.line}</span></div>`;
    }
    
    return html;
  }

  private formatGoroutineStack(goroutine: any): string {
    let html = this.formatStackTrace(goroutine.calls);
    
    // Add creator information if available
    if (goroutine.createdBy) {
      html += `<div class="stack-line created-by-line">`;
      html += `<span class="created-by-text">created by </span>`;
      
      // Check if creator exists and make ID clickable or crossed out
      const creator = this.stackCollection.findGoroutineById(goroutine.createdBy.creatorId);
      html += `<span class="creator-function">${this.escapeHtml(goroutine.createdBy.function)}</span>`;
      html += ` in goroutine `;
      if (creator) {
        html += `<span class="creator-link" data-creator-id="${this.escapeHtml(creator.id)}">`;
        html += `${this.escapeHtml(goroutine.createdBy.creatorId)}`;
        html += `</span>`;
      } else {
        // Creator not found - show ID with strikethrough
        html += `<span class="creator-missing">${this.escapeHtml(goroutine.createdBy.creatorId)}</span>`;
      }
      
      html += `</div>`;
      
      // Add creator location if available
      if (goroutine.createdBy.file && goroutine.createdBy.file !== 'unknown') {
        html += `<div class="stack-line">\t<span class="file-path">${this.escapeHtml(goroutine.createdBy.file)}</span>:<span class="line-number">${goroutine.createdBy.line}</span></div>`;
      }
    }
    
    
    return html;
  }


  private formatCombinedStackTrace(uniqueStack: any): string {
    let html = '';
    
    // Format the stack calls
    for (let i = 0; i < uniqueStack.calls.length; i++) {
      const call = uniqueStack.calls[i];
      html += `<div class="stack-line">`;
      html += `<span class="function-name">${this.escapeHtml(call.function)}</span>`;
      html += `</div>`;
      html += `<div class="stack-line">\t<span class="file-path">${this.escapeHtml(call.file)}</span>:<span class="line-number">${call.line}</span></div>`;
    }
    
    // Add creator information if available (but WITHOUT the specific goroutine ID)
    if (uniqueStack.createdBy) {
      html += `<div class="stack-line created-by-line">`;
      html += `<span class="created-by-text">created by </span>`;
      html += `<span class="creator-function">${this.escapeHtml(uniqueStack.createdBy.function)}</span>`;
      html += `</div>`;
      
      // Add creator location if available
      if (uniqueStack.createdBy.file && uniqueStack.createdBy.file !== 'unknown') {
        html += `<div class="stack-line">\t<span class="file-path">${this.escapeHtml(uniqueStack.createdBy.file)}</span>:<span class="line-number">${uniqueStack.createdBy.line}</span></div>`;
      }
    }
    
    return html;
  }

  private formatSideBySideStackTrace(uniqueStack: any): string {
    let html = '<div class="side-by-side-container">';
    
    // Add headers
    html += '<div class="side-by-side-headers">';
    html += '<div class="column-header">Functions</div>';
    html += '<div class="column-header">Locations</div>';
    html += '</div>';
    
    // Format function calls as paired rows
    for (const call of uniqueStack.calls) {
      html += '<div class="side-by-side-row">';
      html += '<div class="function-side">';
      html += `<span class="function-name">${this.escapeHtml(call.function)}</span>`;
      html += '</div>';
      html += '<div class="location-side">';
      html += `<span class="file-path">${this.escapeHtml(call.file)}</span>:<span class="line-number">${call.line}</span>`;
      html += '</div>';
      html += '</div>';
    }
    
    // Add creator row if available
    if (uniqueStack.createdBy) {
      html += '<div class="side-by-side-row">';
      html += '<div class="function-side">';
      html += `<span class="created-by-text">created by </span>`;
      html += `<span class="creator-function">${this.escapeHtml(uniqueStack.createdBy.function)}</span>`;
      html += '</div>';
      html += '<div class="location-side">';
      if (uniqueStack.createdBy.file && uniqueStack.createdBy.file !== 'unknown') {
        html += `<span class="file-path">${this.escapeHtml(uniqueStack.createdBy.file)}</span>:<span class="line-number">${uniqueStack.createdBy.line}</span>`;
      }
      html += '</div>';
      html += '</div>';
    }
    
    html += '</div>';
    
    return html;
  }

  private formatFunctionsOnlyStackTrace(uniqueStack: any): string {
    let html = '';
    
    // Format function calls only
    for (const call of uniqueStack.calls) {
      html += `<div class="stack-line function-only-line">`;
      html += `<span class="function-name">${this.escapeHtml(call.function)}</span>`;
      html += `</div>`;
    }
    
    // Add creator function if available
    if (uniqueStack.createdBy) {
      html += `<div class="stack-line created-by-line">`;
      html += `<span class="created-by-text">created by </span>`;
      html += `<span class="creator-function">${this.escapeHtml(uniqueStack.createdBy.function)}</span>`;
      html += `</div>`;
    }
    
    return html;
  }

  private formatLocationsOnlyStackTrace(uniqueStack: any): string {
    let html = '';
    
    // Format locations only
    for (const call of uniqueStack.calls) {
      html += `<div class="stack-line location-only-line">`;
      html += `<span class="file-path">${this.escapeHtml(call.file)}</span>:<span class="line-number">${call.line}</span>`;
      html += `</div>`;
    }
    
    // Add creator location if available
    if (uniqueStack.createdBy && uniqueStack.createdBy.file && uniqueStack.createdBy.file !== 'unknown') {
      html += `<div class="stack-line location-only-line">`;
      html += `<span class="file-path">${this.escapeHtml(uniqueStack.createdBy.file)}</span>:<span class="line-number">${uniqueStack.createdBy.line}</span>`;
      html += `</div>`;
    }
    
    return html;
  }

  private formatGoroutineHeader(goroutine: any): string {
    // Derive header from goroutine's assigned ID, state, and durationMinutes
    const durationText = goroutine.durationMinutes > 0 ? `, ${goroutine.durationMinutes} minutes` : '';
    return `goroutine ${goroutine.id} [${goroutine.state}${durationText}]:`;
  }

  private toggleGoroutineStack(entry: HTMLElement, goroutine: Goroutine): void {
    const stack = entry.querySelector('.goroutine-stack') as HTMLElement;
    
    if (!stack.hasAttribute('data-loaded')) {
      stack.innerHTML = this.formatGoroutineStack(goroutine);
      stack.setAttribute('data-loaded', 'true');
      
      // Add click handlers for creator links
      stack.querySelectorAll('.creator-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const creatorId = (link as HTMLElement).dataset.creatorId;
          if (creatorId) {
            this.navigateToGoroutine(creatorId, true, goroutine.id);
          }
        });
      });
    }
    
    stack.classList.toggle('expanded');
  }

  private toggleStateGroup(element: HTMLElement, indicator: HTMLElement): void {
    const content = element.querySelector('.state-group-content') as HTMLElement;
    const isCollapsed = content.classList.contains('collapsed');
    
    content.classList.toggle('collapsed', !isCollapsed);
    indicator.textContent = isCollapsed ? '▲' : '▼';
  }

  private updateGroupVisibility(groupElement: HTMLElement, stackId: string): void {
    const content = groupElement.querySelector('.group-content') as HTMLElement;
    const isExpanded = this.viewState.isGroupExpanded(stackId);
    content.classList.toggle('collapsed', !isExpanded);
  }

  private expandAll(): void {
    const allStacks = this.stackCollection.getFilteredUniqueStacks();
    this.viewState.expandAllGroups(allStacks.map(s => s.id));
    
    // Only expand the main stack groups, not the content within them
    document.querySelectorAll('.group-content').forEach(content => {
      content.classList.remove('collapsed');
    });
  }

  private collapseAll(): void {
    this.viewState.collapseAllGroups();
    
    // Only collapse the main stack groups, not the content within them
    document.querySelectorAll('.group-content').forEach(content => {
      content.classList.add('collapsed');
    });
  }

  private unpinAll(): void {
    // Get all currently pinned stacks and goroutines
    const pinnedStacks = this.stackCollection.getPinnedStacks();
    const pinnedGoroutines = this.stackCollection.getPinnedGoroutines();
    
    // Unpin all stacks
    pinnedStacks.forEach(stackId => {
      this.stackCollection.toggleStackPin(stackId);
    });
    
    // Unpin all goroutines
    pinnedGoroutines.forEach(goroutineId => {
      this.stackCollection.toggleGoroutinePin(goroutineId);
    });
    
    // Update all pin button states in the UI
    document.querySelectorAll('.pin-btn').forEach(btn => {
      const stackId = (btn as HTMLElement).dataset.stackId;
      if (stackId) {
        this.updateStackPinState(btn as HTMLButtonElement, stackId);
      }
    });
    
    document.querySelectorAll('.goroutine-pin-btn').forEach(btn => {
      const goroutineId = (btn as HTMLElement).dataset.goroutineId;
      if (goroutineId) {
        this.updateGoroutinePinState(btn as HTMLButtonElement, goroutineId);
      }
    });
    
    // Update statistics to reflect the changes
    this.updateStats();
  }


  private navigateToGoroutine(id: string, addToHistory = true, fromId?: string): void {
    const goroutine = this.stackCollection.findGoroutineById(id);
    if (!goroutine) {
      console.warn(`Goroutine ${id} not found`);
      return;
    }

    if (addToHistory) {
      this.viewState.navigateToGoroutine(goroutine.id, fromId);
      const url = goroutine.fileName ? `#goroutine=${encodeURIComponent(goroutine.id)}&file=${encodeURIComponent(goroutine.fileName)}` : `#goroutine=${encodeURIComponent(goroutine.id)}`;
      history.pushState({ id: goroutine.id, fileName: goroutine.fileName }, '', url);
    }

    // Make temporarily visible if needed
    this.stackCollection.makeTemporarilyVisible(goroutine.id);
    this.updateVisibility();

    // Find and highlight the goroutine
    const goroutineEntry = document.querySelector(`[data-goroutine-id="${goroutine.id}"]`) as HTMLElement;
    if (goroutineEntry) {
      this.expandPathToGoroutine(goroutineEntry);
      goroutineEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      document.querySelectorAll('.goroutine-entry.highlighted').forEach(el => {
        el.classList.remove('highlighted');
      });
      goroutineEntry.classList.add('highlighted');
      this.viewState.highlightGoroutine(goroutine.id);
    }

    this.updateBackButtonVisibility();
  }

  private expandPathToGoroutine(goroutineEntry: HTMLElement): void {
    const stackGroup = goroutineEntry.closest('.stack-group') as HTMLElement;
    if (stackGroup) {
      const groupContent = stackGroup.querySelector('.group-content') as HTMLElement;
      if (groupContent) {
        groupContent.classList.remove('collapsed');
      }
    }

    const stateGroup = goroutineEntry.closest('.state-group') as HTMLElement;
    if (stateGroup) {
      const stateContent = stateGroup.querySelector('.state-group-content') as HTMLElement;
      if (stateContent) {
        stateContent.classList.remove('collapsed');
        const indicator = stateGroup.querySelector('.state-group-header span:last-child') as HTMLElement;
        if (indicator) indicator.textContent = '▲';
      }
    }
  }

  private navigateBack(): void {
    if (this.viewState.canGoBack()) {
      const didGoBack = this.viewState.goBack();
      if (didGoBack) {
        const currentEntry = this.viewState.getCurrentEntry();
        if (currentEntry) {
          this.navigateToGoroutine(currentEntry.id, false);
          
          const goroutine = this.stackCollection.findGoroutineById(currentEntry.id);
          const url = goroutine?.fileName ? 
            `#goroutine=${encodeURIComponent(currentEntry.id)}&file=${encodeURIComponent(goroutine.fileName)}` : 
            `#goroutine=${encodeURIComponent(currentEntry.id)}`;
          history.replaceState({ id: currentEntry.id, fileName: goroutine?.fileName }, '', url);
        } else {
          this.clearSelection();
          history.replaceState({ page: 'initial' }, '', window.location.pathname);
        }
      }
    }
    this.updateBackButtonVisibility();
  }

  private clearSelection(): void {
    document.querySelectorAll('.goroutine-entry.highlighted').forEach(el => {
      el.classList.remove('highlighted');
    });
    this.viewState.clearHighlight();
    this.stackCollection.clearTemporaryVisibility();
    this.updateVisibility();
  }

  private updateBackButtonVisibility(): void {
    const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
    if (backBtn) {
      const canGoBack = this.viewState.canGoBack();
      backBtn.disabled = !canGoBack;
      backBtn.style.opacity = canGoBack ? '1' : '0.5';
    }
  }

  private updateDropZone(): void {
    const dropZone = document.getElementById('dropZone')!;
    const allGoroutines = this.stackCollection.getAllGoroutines();
    
    if (allGoroutines.length === 0) {
      dropZone.classList.remove('has-content');
      dropZone.innerHTML = `
        <div class="drop-message">
          <div>📁 Drop your Go stack trace files or zip archives here</div>
          <div style="margin-top: 10px; font-size: 14px; color: #888;">or click to select files</div>
          <div style="margin-top: 5px; font-size: 12px; color: #666;">Zip files will be automatically extracted based on your pattern settings</div>
        </div>
      `;
    }
  }


  private updateVisibility(): void {
    // Efficiently show/hide existing DOM elements instead of rebuilding
    this.updateStackVisibility();
    // Also update file stats to show current visible/total counts
    this.updateFileStats();
  }

  private updateStats(): void {
    const allGoroutines = this.stackCollection.getAllGoroutines();
    const visibleGoroutines = this.stackCollection.getVisibleGoroutines();
    const uniqueStacks = this.stackCollection.getUniqueStacks();
    const filteredUniqueStacks = this.stackCollection.getFilteredUniqueStacks();

    const totalElement = document.getElementById('totalGoroutines');
    const visibleElement = document.getElementById('visibleGoroutines');
    const hiddenElement = document.getElementById('hiddenGoroutines');
    const uniqueElement = document.getElementById('uniqueStacks');
    const visibleUniqueElement = document.getElementById('visibleUniqueStacks');

    if (totalElement) totalElement.textContent = allGoroutines.length.toString();
    if (visibleElement) visibleElement.textContent = visibleGoroutines.length.toString();
    if (hiddenElement) hiddenElement.textContent = (allGoroutines.length - visibleGoroutines.length).toString();
    if (uniqueElement) uniqueElement.textContent = uniqueStacks.length.toString();
    if (visibleUniqueElement) visibleUniqueElement.textContent = filteredUniqueStacks.length.toString();

    // Update pinned counts
    const pinnedStacks = this.stackCollection.getPinnedStacks();
    const pinnedGoroutines = this.stackCollection.getPinnedGoroutines();
    const pinnedStacksElement = document.getElementById('pinnedStacks');
    const pinnedGoroutinesElement = document.getElementById('pinnedGoroutines');
    
    if (pinnedStacksElement) pinnedStacksElement.textContent = pinnedStacks.size.toString();
    if (pinnedGoroutinesElement) pinnedGoroutinesElement.textContent = pinnedGoroutines.size.toString();

    // Update state breakdown
    const stateBreakdown = new Map<string, number>();
    const visibleStateBreakdown = new Map<string, number>();
    
    allGoroutines.forEach(goroutine => {
      stateBreakdown.set(goroutine.state, (stateBreakdown.get(goroutine.state) || 0) + 1);
    });
    
    visibleGoroutines.forEach(goroutine => {
      visibleStateBreakdown.set(goroutine.state, (visibleStateBreakdown.get(goroutine.state) || 0) + 1);
    });

    const stateListElement = document.getElementById('stateList');
    if (stateListElement) {
      stateListElement.innerHTML = '';
      const sortedStates = Array.from(stateBreakdown.keys()).sort();
      
      sortedStates.forEach(state => {
        const total = stateBreakdown.get(state)!;
        const visible = visibleStateBreakdown.get(state) || 0;
        
        const stateDiv = document.createElement('div');
        stateDiv.className = 'state-item';
        stateDiv.dataset.state = state;
        stateDiv.style.cursor = 'pointer';
        stateDiv.title = `Click to filter by ${state} only. Shift+Click to exclude ${state}. Click again to reset.`;
        
        // Apply visual styling based on temporary filter
        if (this.temporaryStateFilter) {
          if (this.temporaryStateFilter.state === state) {
            if (this.temporaryStateFilter.mode === 'only') {
              stateDiv.classList.add('state-only');
            } else {
              stateDiv.classList.add('state-excluded');
            }
          } else {
            if (this.temporaryStateFilter.mode === 'only') {
              stateDiv.classList.add('state-grayed');
            }
          }
        }
        
        // Set text content - always show visible/total format
        stateDiv.textContent = `${state}: ${visible}/${total}`;
        
        // Apply color styling based on visibility
        if (visible === 0 && !this.temporaryStateFilter) {
          stateDiv.style.color = '#999';
        } else if (visible < total && !this.temporaryStateFilter) {
          stateDiv.style.color = '#999';
        }
        
        // Add click handler
        stateDiv.addEventListener('click', (e) => {
          this.handleStateClick(state, e.shiftKey);
        });
        
        stateListElement.appendChild(stateDiv);
      });
    }
  }

  private handleStateClick(state: string, shiftPressed: boolean): void {
    if (this.temporaryStateFilter && this.temporaryStateFilter.state === state) {
      // Clicking on the currently filtered state - reset
      this.temporaryStateFilter = null;
    } else if (shiftPressed) {
      // Shift+click - exclude this state
      this.temporaryStateFilter = { state, mode: 'exclude' };
    } else {
      // Regular click - show only this state
      this.temporaryStateFilter = { state, mode: 'only' };
    }
    
    // Apply the temporary filter and update display
    this.applyTemporaryStateFilter();
    this.updateStats();
    this.updateVisibility();
  }

  private applyTemporaryStateFilter(): void {
    if (!this.temporaryStateFilter) {
      // Clear any temporary filter from the stack collection
      this.stackCollection.clearTemporaryStateFilter();
      return;
    }

    // Apply the temporary state filter
    this.stackCollection.setTemporaryStateFilter(
      this.temporaryStateFilter.state, 
      this.temporaryStateFilter.mode
    );
  }

  private clearAll(): void {
    this.fileCollection.dispose();
    this.fileCollection = new BackgroundFileCollection([], this.settingsManager);
    this.setupParsingProgress();
    this.stackCollection = new StackCollection(this.fileCollection);
    this.viewState.reset();
    this.filterInputValue = '';
    
    const filterInput = document.getElementById('filterInput') as HTMLInputElement;
    if (filterInput) {
      filterInput.value = '';
      filterInput.classList.remove('error');
    }
    
    this.render();
    this.updateBackButtonVisibility();
    this.saveState();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // File Processing Modal Management
  
  private showFileProcessingModal(files: File[]): void {
    const modal = document.getElementById('fileProcessingModal');
    const filesContainer = document.getElementById('fileProcessingFiles');
    
    if (modal && filesContainer) {
      // Initialize file list
      filesContainer.innerHTML = '';
      files.forEach(file => {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-processing-file';
        fileDiv.id = `file-processing-${this.sanitizeFileName(file.name)}`;
        
        fileDiv.innerHTML = `
          <div class="file-processing-file-name">${this.escapeHtml(file.name)}</div>
          <div class="file-processing-file-status">Waiting...</div>
        `;
        
        filesContainer.appendChild(fileDiv);
      });
      
      modal.classList.remove('hidden');
    }
  }
  
  private hideFileProcessingModal(): void {
    const modal = document.getElementById('fileProcessingModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
  
  private updateFileProcessingMessage(message: string): void {
    const messageElement = document.getElementById('fileProcessingMessage');
    if (messageElement) {
      messageElement.textContent = message;
    }
  }
  
  private updateFileProcessingModal(progress: { fileName: string; progress: number; stage: string; error?: string }): void {
    const fileElement = document.getElementById(`file-processing-${this.sanitizeFileName(progress.fileName)}`);
    if (fileElement) {
      const statusElement = fileElement.querySelector('.file-processing-file-status');
      if (statusElement) {
        switch (progress.stage) {
          case 'reading':
            statusElement.textContent = 'Reading file...';
            break;
          case 'parsing':
            statusElement.textContent = `Parsing... ${progress.progress}%`;
            break;
          case 'complete':
            statusElement.textContent = 'Completed ✓';
            fileElement.classList.add('completed');
            break;
          case 'error':
            statusElement.textContent = `Error: ${progress.error}`;
            fileElement.classList.add('error');
            break;
        }
      }
    }
  }
  
  private sanitizeFileName(fileName: string): string {
    // Create a safe ID from filename by replacing special characters
    return fileName.replace(/[^a-zA-Z0-9-_]/g, '_');
  }
  
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
  
  // Rendering Modal Management
  
  private showRenderingModal(): void {
    const modal = document.getElementById('renderingModal');
    if (modal) {
      this.updateRenderingMessage('Preparing UI components...');
      modal.classList.remove('hidden');
    }
  }
  
  private hideRenderingModal(): void {
    const modal = document.getElementById('renderingModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
  
  private updateRenderingMessage(message: string): void {
    const messageElement = document.getElementById('renderingMessage');
    if (messageElement) {
      messageElement.textContent = message;
    }
  }
  
  private updateRenderingProgress(progress: string): void {
    const progressElement = document.getElementById('renderingProgress');
    if (progressElement) {
      progressElement.innerHTML = progress;
    }
  }
}