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
    <div>📁 Drop Goroutine profiles here to get started</div>
    <div className="demo-add-files">text and binary pprof profile formats auto-detected</div>
    <div className="demo-add-files">traceback as file suffix (e.g. a crash log) also supported</div>
    <div className="demo-add-files">all analysis done in-browser — nothing is uploaded anywhere</div>
    <div className="demo-section-divider">
      <div className="demo-try-demo">⚡️ Or try a quick demo with some example CockroachDB stack dumps:</div>
      <div className="demo-buttons">
        <a id="demoSingleBtn" href="#" className="demo-link">📄 single node goroutine dump →</a>
        <a id="demoZipBtn" href="#" className="demo-link">📦 zip file of stacks from 4 nodes →</a>
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

// Helper function to create a unified setting component
function createSettingComponent(config: {
  id: string;
  title: string;
  description: string;
  helpTooltip: string;
  defaultRows?: number;
  customRows?: number;
  customPlaceholder?: string;
}): HTMLElement {
  const settingDiv = createElement('div', { className: 'setting-section' },
    // Setting title and help
    createElement('div', { className: 'setting-title' },
      createElement('span', {}, config.title),
      createElement('button', { 
        className: 'setting-help-icon',
        'data-tooltip': config.helpTooltip
      }, '?')
    ),
    
    // Setting description
    createElement('div', { className: 'setting-description' }, config.description),
    
    // Default rules section
    createElement('div', { className: 'default-rules-section settings-collapsed' },
      createElement('div', { className: 'default-rules-header' },
        createElement('div', { className: 'default-rules-title' },
          createElement('span', { className: 'expand-icon' }, '▼'),
          createElement('h5', {}, 'Default Rules')
        ),
        createElement('label', { className: 'toggle-switch' },
          createElement('input', { 
            type: 'checkbox', 
            id: `useDefault${config.id}`,
            checked: true
          }),
          createElement('span', { className: 'toggle-slider' })
        )
      ),
      createElement('div', { className: 'default-rules-content collapsed-settings' },
        createElement('textarea', {
          id: `default${config.id}`,
          className: 'setting-textarea default-rules-textarea',
          rows: config.defaultRows || 3,
          readOnly: true,
          placeholder: 'Default rules will appear here...'
        })
      )
    ),
    
    // Custom rules section
    createElement('div', { className: 'custom-rules-section settings-collapsed' },
      createElement('div', { className: 'custom-rules-header' },
        createElement('div', { className: 'custom-rules-title' },
          createElement('h5', {}, 'Custom Rules (0)')
        )
      ),
      createElement('div', { className: 'custom-rules-content collapsed-settings' },
        createElement('textarea', {
          id: `custom${config.id}`,
          className: 'setting-textarea',
          rows: config.customRows || 2,
          placeholder: config.customPlaceholder || 'Add your own rules here...'
        })
      )
    )
  );
  
  return settingDiv;
}


const SettingsModalTemplate = (
  <div id="settingsModal" className="modal">
    <div className="modal-content">
      <div className="modal-header">
        <h3>Advanced Settings</h3>
        <button className="modal-close" id="settingsModalCloseBtn">&times;</button>
      </div>
      <div className="modal-body" id="settingsModalBody">
        {/* Content will be generated programmatically */}
      </div>
      <div className="settings-actions">
        <button id="resetSettingsBtn" className="btn btn-danger settings-reset-btn">Reset to Defaults</button>
        <button id="saveSettingsBtn" className="btn settings-save-btn">Save Settings</button>
      </div>
    </div>
  </div>
);

// Simple settings modal configuration - exactly what you requested
export const settingsModalConfig = {
  'Categorization': {
    'Skip Rules': {
      description: 'Skip these patterns when categorizing stacks.',
      tooltip: 'One pattern per line. Frames matching these patterns will be ignored when determining category.',
      settingKey: 'categorySkipRules'
    },
    'Match Rules': {
      description: 'Extract category names using these patterns.',
      tooltip: 'One pattern per line. Format: s|pattern|replacement| where replacement can use $1, $2, etc. for capture groups.',
      settingKey: 'categoryMatchRules'
    },
  },
  'Stack Naming': {
    'Skip Rules': {
      description: 'Skip these patterns when naming stacks.',
      tooltip: 'One pattern per line. Frames matching these patterns will be ignored when building stack names.',
      settingKey: 'nameSkipRules'
    },
    'Trim Rules': {
      description: 'Trim prefixes or apply regex replacements.',
      tooltip: 'One pattern per line. Format: \'prefix\' to remove prefix, or \'s|pattern|replacement|\' for regex replacement.',
      settingKey: 'nameTrimRules'
    },
    'Fold Rules': {
      description: 'Fold frame sequences into concise names.',
      tooltip: 'One rule per line. Format: s|pattern,while-pattern|replacement| where \'while-pattern\' specifies what frames to consume after the match.',
      settingKey: 'nameFoldRules'
    },
    'Find Rules': {
      description: 'Find patterns in remaining frames and prepend to stack name.',
      tooltip: 'One rule per line. Format: s|pattern,while-pattern|replacement| to scan remaining frames and pull up matching information.',
      settingKey: 'nameFindRules'
    }
  },
  'Fie Parsing': {
    'Function Trim Prefixes': {
      description: 'Remove these prefixes from function names for cleaner display.',
      tooltip: 'One prefix per line. Example: \'github.com/myorg/\' would trim \'github.com/myorg/mypackage.Function\' to \'mypackage.Function\'',
      settingKey: 'functionTrimPrefixes'
    },
    'File Trim Prefixes': {
      description: 'Remove these prefixes from file paths for cleaner display.',
      tooltip: 'One prefix per line. Example: \'/go/src/\' would trim \'/go/src/myproject/main.go\' to \'myproject/main.go\'',
      settingKey: 'fileTrimPrefixes'
    },
    'File Name Extraction': {
      description: 'File name extraction allows automatic file naming during parsing based on content patterns or labels found in stack traces. When a pattern matches, the extracted name becomes the file name instead of the original filename.',
      tooltip: 'Patterns to extract custom file names from stack trace content or labels during parsing. Format: regex pattern with replacement template. Examples: \'tags=([^,\\s]+)\' with replacement \'$1\' extracts \'n1\' from \'tags=n1\'',
      settingKey: 'nameExtractionPatterns'
    },
    'Zip File Path Patterns': {
      description: 'Pattern to identify stack trace files in zip archives.',
      tooltip: 'Regex pattern to match files inside zip archives that should be extracted and parsed as stack trace files. Examples: \'^(.*\\/)?stacks\\.txt$\', \'^logs\\/.*\\.txt$\', \'^.*\\.log$\'',
      settingKey: 'zipFilePatterns'
    }
  }
};

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

// Export helper functions for programmatic modal generation
export { createSettingComponent };

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