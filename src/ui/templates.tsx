/**
 * Templates for UI elements - extracted from index.html to enable better separation
 * between core app structure and deployment configuration
 */

function createElement(type: string, props: any, ...children: any[]): HTMLElement {
  const element = document.createElement(type);
  
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'className') {
        element.className = String(value);
      } else if (key === 'contentEditable') {
        element.contentEditable = String(value);
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }
  
  children.forEach(child => {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child instanceof HTMLElement) {
      element.appendChild(child);
    }
  });
  
  return element;
}

// Helper to create template-like object from JSX element that matches the existing interface
function createTemplateFromElement(element: HTMLElement) {
  return {
    content: {
      cloneNode: (_deep: boolean = true): DocumentFragment => {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(element.cloneNode(true));
        return fragment;
      },
      firstElementChild: element
    }
  };
}

// Template definitions using JSX syntax
const CategoryTemplate = (
  <div className="section expandable category-section">
    <div className="header">
      <div className="category-title"></div>
      <div className="header-right">
        <div className="category-count counts"></div>
        <div className="category-stats"></div>
      </div>
      <button className="pin-button size-large">📌</button>
    </div>
    <div className="section-content category-content"></div>
  </div>
);

const StackTemplate = (
  <div className="section expandable stack-section">
    <div className="header">
      <div className="stack-title"></div>
      <div className="header-right">
        <div className="stack-count counts"></div>
        <div className="stack-stats"></div>
      </div>
      <button className="pin-button size-large">📌</button>
      <button className="copy-button size-large">📋</button>
    </div>
    <div className="section-content stack-content"></div>
  </div>
);

const FileSectionTemplate = (
  <div className="section expandable file-section">
    <div className="header">
      <span className="title">
        <span className="expand-icon"></span>
        <span className="file-name"></span>
      </span>
      <span className="counts"></span>
    </div>
    <div className="section-content"></div>
  </div>
);

const GroupTemplate = (
  <div className="section expandable group-section">
    <div className="header">
      <span className="title">
        <span className="expand-icon"></span>
        <span className="group-header-label"></span>
      </span>
      <span className="group-header-count counts"></span>
      <button className="pin-button size-large">📌</button>
    </div>
    <div className="section-content"></div>
  </div>
);

const GoroutineTemplate = (
  <div className="goroutine-entry">
    <button className="pin-button size-small">📌</button>
    <div className="goroutine-header">
      <div className="goroutine-header-first-line">
        <span className="goroutine-header-left"></span>
        <span className="goroutine-created-by"></span>
      </div>
      <div className="goroutine-header-second-line"></div>
    </div>
  </div>
);

const StackTraceTemplate = (
  <div className="unique-stack-content"></div>
);

const ShowMoreTemplate = (
  <div className="show-more-link">
    <span className="show-more-text">
      Show <span className="show-more-link-clickable"></span> more goroutines ▼
    </span>
  </div>
);

const FileItemTemplate = (
  <div className="file-item">
    <span className="file-name-text" contentEditable={false}></span>
    <div className="file-stats counts"></div>
    <button className="file-remove-btn">×</button>
  </div>
);

const FileEmptyStateTemplate = (
  <div className="empty-state">
    Drop files here or click <strong>+</strong> to add
  </div>
);

const FileDropAreaTemplate = (
  <div className="file-drop-area">
    Drop more files here
  </div>
);

const DropZoneEmptyTemplate = (
  <div className="drop-message">
    <div>📁 Drop Go stack trace files here to get started</div>
    <div className="demo-add-files">or click + to select files</div>
    <div className="demo-add-files">🔒 all analysis is in-browser - nothing is uploaded</div>
    <div className="demo-section-divider">
      <div className="demo-try-demo">⚡️ Or try a quick demo with some example CockroachDB stack dumps:</div>
      <div className="demo-buttons">
        <a id="demoSingleBtn" href="#" className="demo-link">📄 single file →</a>
        <a id="demoZipBtn" href="#" className="demo-link">📦 zip file of 4 stacks →</a>
      </div>
    </div>
  </div>
);

const StateStatsTemplate = (state: string, count: number, total: number) => (
  <div className="stats-item state-item">
    <span className="state-name">{state}</span>: <span className="state-counts">{count} / {total}</span>
  </div>
);

// Container and overlay elements
const ContainerTemplate = (
  <div className="container">
    {/* Floating back button for narrow screens */}
    <button className="narrow-back-btn" id="narrowBackBtn" style="display: none;" disabled 
            title="Go back to previous goroutine (Alt+← or Backspace)">←</button>
    
    {/* Sidebar overlay for narrow screens */}
    <div className="sidebar-overlay" id="sidebarOverlay"></div>
    
    {/* Hide button for narrow mode */}
    <button className="narrow-close-btn" id="narrowCloseBtn" style="display: none;" title="Hide sidebar">‹</button>
    
    <div className="sidebar" id="sidebar"></div>
    <div className="main-content" id="mainContent"></div>
  </div>
);

// Sidebar structure
const SidebarTemplate = (
  <div className="sidebar">
    <div className="filter-section file-section">
      <div className="files-header">
        <div className="files-title">
          <h3>Files <button className="add-file-btn" id="addFileBtn" title="Add more files">+</button></h3>
        </div>
        <button className="clear-all-btn" id="clearAllBtn" title="Clear all files">×</button>
      </div>
      <div className="file-list-container" id="fileListContainer">
        <div className="file-list" id="fileList"></div>
      </div>
    </div>

    <div className="filter-section">
      <div className="filter-header">
        <h3>Filter</h3>
        <button className="clear-all-btn" id="clearFilterBtn" title="Clear filter">×</button>
      </div>
      <input type="text" className="filter-input" id="filterInput" placeholder="e.g. flush wait:>5" />
      <div className="filter-error" id="filterError" style="display: none;"></div>
    </div>

    <div className="filter-section">
      <h3>Statistics</h3>
      <div className="stats" id="stats">
        <div className="stats-item">Stacks: <span id="stackCounts">0 / 0</span></div>
        <div className="stats-item">Goroutines: <span id="goroutineCounts">0 / 0</span></div>
        <div className="state-stats" id="stateStats"></div>
      </div>
    </div>
    
    {/* Narrow screen controls */}
    <h3 className="narrow-controls-header" style="display: none;">Controls</h3>
    <div className="narrow-controls" style="display: none;">
      <div className="narrow-controls-row">
        <button id="narrowExpandAllBtn" className="control-btn">Expand All</button>
        <button id="narrowCollapseAllBtn" className="control-btn">Collapse All</button>
      </div>
      <div className="narrow-controls-row">
        <button id="narrowUnpinAllBtn" className="control-btn">Unpin All</button>
      </div>
      <div className="narrow-controls-row">
        <select id="narrowStackDisplayModeSelect" className="narrow-select" title="Choose how to display stack traces">
          <option value="combined">Combined View</option>
          <option value="side-by-side">Side by Side</option>
          <option value="functions">Functions Only</option>
          <option value="locations">Locations Only</option>
        </select>
      </div>
    </div>

    {/* Settings container */}
    <div className="settings-container">
      <a href="https://github.com/dt/stackgazer" target="_blank" className="github-btn" title="View on GitHub" id="githubBtn">
      </a>
      <button className="theme-toggle-btn" id="themeToggleBtn" title="Toggle light/dark theme">🌙</button>
      <button className="settings-btn" id="settingsBtn" title="Advanced Settings">⚙️</button>
    </div>
  </div>
);

// Main content area
const MainContentTemplate = (
  <div className="main-content">
    <div className="view-controls-bar">
      {/* Narrow screen: menu button + filter input */}
      <div className="narrow-filter-container" style="display: none;">
        <button className="narrow-menu-btn" id="narrowMenuBtn">☰</button>
        <input type="text" className="narrow-filter-input" id="narrowFilterInput" placeholder="Filter stacks (e.g. flush wait:>5)" />
      </div>
      
      <div className="left-controls">
        <button id="backBtn" className="control-btn" disabled
            title="Go back to previous goroutine (Alt+← or Backspace)">
          <span className="back-text">← Back</span>
        </button>
      </div>
      <div className="right-controls">
        <select id="stackDisplayModeSelect" title="Choose how to display stack traces">
          <option value="combined">Combined View</option>
          <option value="side-by-side">Side by Side</option>
          <option value="functions">Functions Only</option>
          <option value="locations">Locations Only</option>
        </select>
        <button id="unpinAllBtn" className="control-btn">Unpin All</button>
        <button id="expandAllBtn" className="control-btn">Expand All</button>
        <button id="collapseAllBtn" className="control-btn">Collapse All</button>
      </div>
    </div>
    <div className="drop-zone" id="dropZone">
      {/* Initial content will be populated by JavaScript */}
    </div>
    <div className="copy-notification" id="copyNotification" style="display: none;">
      📋 Copied to clipboard!
    </div>
  </div>
);

// Settings Modal (complete structure)
const AncestryModalTemplate = (
  <div id="ancestryModal" className="ancestry-modal modal-visible">
    <div className="ancestry-modal-content">
      <button className="ancestry-modal-close">&times;</button>
      <div className="ancestry-tree-container">
        <div className="ancestry-zoom-controls">
          <button className="ancestry-zoom-in">+</button>
          <button className="ancestry-zoom-out">−</button>
          <button className="ancestry-fit-view">⌖</button>
        </div>
      </div>
    </div>
  </div>
);

const AncestryEmptyStateTemplate = (
  <p className="ancestry-empty-state">No ancestry data available</p>
);

const SettingsModalTemplate = (
  <div id="settingsModal" className="modal">
    <div className="modal-content">
      <div className="modal-header">
        <h3>Advanced Settings</h3>
        <button className="modal-close" id="settingsModalCloseBtn">&times;</button>
      </div>
      <div className="modal-body">
        <h4>Categorization + Naming</h4>
        <div className="setting-group">
          <div className="setting-title">
            <span>Category Rules</span>
            <button className="setting-help-icon"
                data-tooltip="Rules to control how stacks are categorized:&#10;&#10;• skip: Skip functions matching this pattern when determining category&#10;• match: match and capture a subset of the frame (supports #N for capture groups and -- comments)&#10;&#10;The first non-skipped frame determines the category. If a match rule matches the category frame: its first capture group (or the capture chosen by optional `#N` suffix) is used. If no match matches the whole frame is the category.">?</button>
          </div>
          <div className="setting-description-prose">
            <p><strong>Categorization</strong> is used to group stacks based on where they originated. Categories help organize related stacks together for easier analysis.</p>
          </div>
          
          <div className="setting-title">
            <span>Skip Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One pattern per line. Frames matching these patterns will be ignored when determining category.">?</button>
          </div>
          
          <div className="setting-description">Skip these patterns when categorizing stacks.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultCategorySkipRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultCategorySkipRules" className="setting-textarea default-rules-textarea" rows="4" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customCategorySkipRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own skip rules here..."></textarea>
            </div>
          </div>
          
          <div className="setting-title">
            <span>Match Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One pattern per line. Format: s|pattern|replacement| where replacement can use $1, $2, etc. for capture groups.">?</button>
          </div>
          
          <div className="setting-description">Extract category names using these patterns.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultCategoryMatchRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultCategoryMatchRules" className="setting-textarea default-rules-textarea" rows="2" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customCategoryMatchRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own match rules here..."></textarea>
            </div>
          </div>
        </div>
        
        {/* Stack Name Rules Group */}
        <div className="setting-group">
          <div className="setting-title">
            <span>Stack Name Rules</span>
            <button className="setting-help-icon"
                data-tooltip="Stack names describe a stack by where it was at the time of profiling, i.e what it was doing or where it was waiting. These rules can help choose names more meaningful or useful at a glance than just e.g. 'semacquire' by skipping common low-level frames or combining frames into a concise description.&#10;&#10;• skip: Skip matching functions&#10;• trim: Remove prefix from function names&#10;• fold: Replace pattern with specified text prepended to name derived from following frame&#10;  → Can specify replacement text&#10;  → Can specify 'while:' condition for continued folding">?</button>
          </div>
          <div className="setting-description-prose">
            <p><strong>Naming</strong> determines the name given to each stack within a category. A name describes what a stack was doing, or where it was blocked, at time of profiling. Multiple, distinct stacks can have the same name if they were in the same place as of profiling.</p>
          </div>
          
          <div className="setting-title">
            <span>Skip Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One pattern per line. Frames matching these patterns will be ignored when building stack names.">?</button>
          </div>
          
          <div className="setting-description">Skip these patterns when naming stacks.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultNameSkipRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultNameSkipRules" className="setting-textarea default-rules-textarea" rows="3" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customNameSkipRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own skip rules here..."></textarea>
            </div>
          </div>
          
          <div className="setting-title">
            <span>Trim Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One pattern per line. Format: 'prefix' to remove prefix, or 's|pattern|replacement|' for regex replacement.">?</button>
          </div>
          
          <div className="setting-description">Trim prefixes or apply regex replacements.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultNameTrimRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultNameTrimRules" className="setting-textarea default-rules-textarea" rows="3" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customNameTrimRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own trim rules here..."></textarea>
            </div>
          </div>
          
          <div className="setting-title">
            <span>Fold Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One rule per line. Format: s|pattern,while-pattern|replacement| where 'while-pattern' specifies what frames to consume after the match.">?</button>
          </div>
          
          <div className="setting-description">Fold frame sequences into concise names.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultNameFoldRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultNameFoldRules" className="setting-textarea default-rules-textarea" rows="4" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customNameFoldRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own fold rules here..."></textarea>
            </div>
          </div>
          
          <div className="setting-title">
            <span>Find Rules</span>
            <button className="setting-help-icon"
                data-tooltip="One rule per line. Format: s|pattern,while-pattern|replacement| to scan remaining frames and pull up matching information.">?</button>
          </div>
          
          <div className="setting-description">Find patterns in remaining frames and prepend to stack name.</div>
          
          {/* Default Rules Section */}
          <div className="default-rules-section settings-collapsed">
            <div className="default-rules-header">
              <div className="default-rules-title">
                <span className="expand-icon">▼</span>
                <h5>Default Rules</h5>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" id="useDefaultNameFindRules" checked />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="default-rules-content collapsed-settings">
              <textarea id="defaultNameFindRules" className="setting-textarea default-rules-textarea" rows="3" 
                  readOnly placeholder="Default rules will appear here..."></textarea>
            </div>
          </div>
          
          {/* Custom Rules Section */}
          <div className="custom-rules-section settings-collapsed">
            <div className="custom-rules-header">
              <div className="custom-rules-title">
                <h5>Custom Rules (0)</h5>
              </div>
            </div>
            <div className="custom-rules-content collapsed-settings">
              <textarea id="customNameFindRules" className="setting-textarea" rows="2" 
                  placeholder="Add your own find rules here..."></textarea>
            </div>
          </div>
        </div>

        <h4>Parsing Options</h4>
        <div className="setting-description-prose">
          <p><strong>Note:</strong> Parsing trim prefixes are applied first during file parsing. The trimmed function and file names are then used as input for all categorization and naming rules above.</p>
        </div>
        <div className="setting-group">
          <div className="setting-title">
            <span>Function Trim Prefixes</span>
            <button className="setting-help-icon"
                data-tooltip="Comma-separated list of prefixes to remove from function names. Example: 'github.com/myorg/,internal/' would trim 'github.com/myorg/mypackage.Function' to 'mypackage.Function'">?</button>
          </div>
          <input type="text" id="functionTrimPrefixes" className="setting-text-input"
              placeholder="github.com/company/,internal/" />
          <div className="setting-description">Remove these prefixes from function names for cleaner display.</div>
        </div>
        <div className="setting-group">
          <div className="setting-title">
            <span>File Trim Prefixes</span>
            <button className="setting-help-icon"
                data-tooltip="Comma-separated list of prefixes to remove from file paths. Example: '/go/src/,/usr/local/' would trim '/go/src/myproject/main.go' to 'myproject/main.go'">?</button>
          </div>
          <input type="text" id="fileTrimPrefixes" className="setting-text-input"
              placeholder="github.com/cockroachdb/cockroach/" />
          <div className="setting-description">Remove these prefixes from file paths for cleaner display.</div>
        </div>
        <div className="setting-group">
          <div className="setting-title">
            <span>Zip File Pattern</span>
            <button className="setting-help-icon"
                data-tooltip="Regex pattern to match files inside zip archives that should be extracted and parsed as stack trace files. Examples: '^(.*\\/)?stacks\\.txt$', '^logs\\/.*\\.txt$', '^.*\\.log$'">?</button>
          </div>
          <input type="text" id="zipFilePattern" className="setting-text-input"
              placeholder="^(.*\\/)?stacks\\.txt$" />
          <div className="setting-description">Pattern to identify stack trace files in zip archives.</div>
        </div>
      </div>
      <div className="settings-actions">
        <button id="resetSettingsBtn" className="btn btn-danger settings-reset-btn">Reset to Defaults</button>
        <button id="saveSettingsBtn" className="btn settings-save-btn">Save Settings</button>
      </div>
    </div>
  </div>
);

// Template mapping for compatibility with existing code
export const templates = {
  category: createTemplateFromElement(CategoryTemplate),
  stack: createTemplateFromElement(StackTemplate),
  fileSection: createTemplateFromElement(FileSectionTemplate),
  group: createTemplateFromElement(GroupTemplate),
  goroutine: createTemplateFromElement(GoroutineTemplate),
  stackTrace: createTemplateFromElement(StackTraceTemplate),
  showMore: createTemplateFromElement(ShowMoreTemplate),
  fileItem: createTemplateFromElement(FileItemTemplate),
  fileEmptyState: createTemplateFromElement(FileEmptyStateTemplate),
  fileDropArea: createTemplateFromElement(FileDropAreaTemplate),
  dropZoneEmpty: createTemplateFromElement(DropZoneEmptyTemplate),
  
  // Layout templates
  container: createTemplateFromElement(ContainerTemplate),
  sidebar: createTemplateFromElement(SidebarTemplate),
  mainContent: createTemplateFromElement(MainContentTemplate),
  settingsModal: createTemplateFromElement(SettingsModalTemplate),
  ancestryModal: createTemplateFromElement(AncestryModalTemplate),
  ancestryEmptyState: createTemplateFromElement(AncestryEmptyStateTemplate),
};

// Template functions for dynamic content
export function createStateStatsElement(state: string, count: number, total: number): HTMLElement {
  return StateStatsTemplate(state, count, total);
}

export function createStateStatsElements(stateEntries: [string, {visible: number, total: number}][]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  stateEntries.forEach(([state, counts]) => {
    const stateDiv = document.createElement('div');
    const stateSpan = document.createElement('span');
    stateSpan.textContent = state;
    const countsSpan = document.createElement('span');
    countsSpan.textContent = `${counts.visible} / ${counts.total}`;
    stateDiv.appendChild(stateSpan);
    stateDiv.appendChild(countsSpan);
    fragment.appendChild(stateDiv);
  });
  return fragment;
}