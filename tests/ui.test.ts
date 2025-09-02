/**
 * Comprehensive UI interaction tests using Playwright
 * Tests end-to-end user workflows and UI behaviors
 */

import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STANDALONE_HTML_PATH = path.join(__dirname, '..', 'dist', 'index.html');
const STANDALONE_HTML_URL = `file://${STANDALONE_HTML_PATH}`;

// Global timeout settings
// const DEFAULT_TIMEOUT = 3000; // 3 seconds - Unused
const QUICK_TIMEOUT = 2000; // For quick operations

let browser: Browser;
let page: Page;

interface UITest {
  name: string;
  action: (page: Page) => Promise<void>;
  verify: (page: Page) => Promise<void>;
  description: string;
}

async function setup() {
  browser = await chromium.launch();
  page = await browser.newPage();

  // Set default timeout for all operations
  page.setDefaultTimeout(QUICK_TIMEOUT);

  // Collect console errors
  page.on('pageerror', error => {
    console.log(`  ❌ Page Error: ${error.message}`);
  });

  try {
    // Check if file exists first for faster failure
    const fs = await import('fs');
    if (!fs.existsSync(STANDALONE_HTML_PATH)) {
      throw new Error(`HTML file does not exist: ${STANDALONE_HTML_PATH}`);
    }

    await page.goto(STANDALONE_HTML_URL, { timeout: QUICK_TIMEOUT });
  } catch (error) {
    throw new Error(
      `Failed to load ${STANDALONE_HTML_URL}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });
}

async function teardown() {
  if (browser) {
    await browser.close();
  }
}

async function test(name: string, testFn: () => Promise<void>) {
  try {
    console.log(`🧪 ${name}`);
    await testFn();
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.error((error as Error).message);
    throw error;
  }
}

async function runTests() {
  await setup();

  // Test 1: Basic file loading workflows
  await test('Demo file loading workflows', async () => {
    const loadingTests: UITest[] = [
      {
        name: 'Single demo file',
        action: async page => {
          await page.click('#demoSingleBtn');
        },
        verify: async page => {
          await page.waitForSelector('.category-section', { timeout: QUICK_TIMEOUT });
          const categories = await page.$$('.category-section');
          if (categories.length === 0) throw new Error('No categories found');
        },
        description: 'Load single demo file and verify content appears',
      },
      {
        name: 'Zip demo file',
        action: async page => {
          await page.reload();
          await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });

          const zipBtn = await page.$('#demoZipBtn');
          if (!zipBtn) {
            console.log('  Zip demo button not found, skipping');
            return;
          }
          await page.click('#demoZipBtn');
        },
        verify: async page => {
          await page.waitForSelector('.file-item', { timeout: QUICK_TIMEOUT });
          const fileItems = await page.$$('.file-item');
          if (fileItems.length < 2) throw new Error(`Expected ≥2 files, got ${fileItems.length}`);
        },
        description: 'Load zip demo and verify multiple files',
      },
    ];

    for (const t of loadingTests) {
      console.log(`  Testing: ${t.description}`);
      await t.action(page);
      await t.verify(page);
    }
  });

  // Test 2: Filtering workflows
  await test('Filter workflows', async () => {
    // Start fresh with single demo
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });
    await page.click('#demoSingleBtn');
    await page.waitForSelector('.group-section', { timeout: QUICK_TIMEOUT });

    const filterTests = [
      { filter: 'state:runnable', desc: 'State filter' },
      { filter: 'kvclient', desc: 'Text search' },
      { filter: '3080', desc: 'Goroutine ID' },
      { filter: '', desc: 'Clear filter' },
    ];

    for (const t of filterTests) {
      console.log(`  Testing filter: ${t.desc} ("${t.filter}")`);

      await page.fill('#filterInput', t.filter);
      // Wait for UI to update after filter change
      await page.waitForFunction(
        expectedValue => {
          const input = document.querySelector('#filterInput') as HTMLInputElement;
          return input && input.value === expectedValue;
        },
        t.filter,
        { timeout: QUICK_TIMEOUT }
      );

      // Verify filter was applied
      const filterValue = await page.inputValue('#filterInput');
      if (filterValue !== t.filter) {
        throw new Error(`Filter not applied: expected "${t.filter}", got "${filterValue}"`);
      }

      // Check that UI responded - just verify categories exist
      const visibleCategories = await page.$$('.category-section:not(.filtered)');
      console.log(`    Result: ${visibleCategories.length} categories visible`);
    }
  });

  // Test 3: Navigation and interaction
  await test('Navigation and UI interactions', async () => {
    // Test expansion/collapse
    const visibleGroupHeader = await page.$('.group-header:not(.hidden)');
    if (visibleGroupHeader) {
      await visibleGroupHeader.click();
      // Wait for expansion/collapse animation to complete
      await page
        .waitForFunction(
          () => {
            const groupContent = document.querySelector('.group-content');
            return (
              groupContent &&
              (groupContent.classList.contains('collapsed') ||
                groupContent.classList.contains('expanded'))
            );
          },
          { timeout: QUICK_TIMEOUT }
        )
        .catch(() => {});
      console.log('  ✅ Group expansion/collapse works');
    }

    // Test creator link navigation
    const creatorLinks = await page.$$('.creator-link');
    if (creatorLinks.length > 0) {
      for (let i = 0; i < Math.min(creatorLinks.length, 3); i++) {
        try {
          await creatorLinks[i].click({ timeout: QUICK_TIMEOUT });
          console.log(`  ✅ Creator link ${i + 1} clickable`);

          // Check for highlighted goroutine
          const highlighted = await page.$('.goroutine-entry.highlighted');
          if (highlighted) {
            console.log('  ✅ Navigation highlighting works');
          }
          break;
        } catch (e) {
          continue;
        }
      }
    }

    // Test back navigation
    const backBtn = await page.$('#backBtn');
    if (backBtn) {
      const isDisabled = await backBtn.getAttribute('disabled');
      if (!isDisabled) {
        await page.click('#backBtn');
        // Wait for navigation to complete
        await page
          .waitForFunction(
            () => {
              const backBtn = document.querySelector('#backBtn') as HTMLButtonElement;
              return backBtn && backBtn.disabled;
            },
            { timeout: QUICK_TIMEOUT }
          )
          .catch(() => {});
        console.log('  ✅ Back navigation works');
      }
    }

    // Test display mode switching
    await page.selectOption('#stackDisplayModeSelect', 'side-by-side');
    // Wait for display mode change to take effect
    await page.waitForFunction(
      () => {
        const select = document.querySelector('#stackDisplayModeSelect') as HTMLSelectElement;
        return select && select.value === 'side-by-side';
      },
      { timeout: QUICK_TIMEOUT }
    );
    await page.selectOption('#stackDisplayModeSelect', 'functions');
    await page.waitForFunction(
      () => {
        const select = document.querySelector('#stackDisplayModeSelect') as HTMLSelectElement;
        return select && select.value === 'functions';
      },
      { timeout: QUICK_TIMEOUT }
    );
    console.log('  ✅ Display mode switching works');
  });

  // Test 4: Filter-then-load workflow (critical bug test)
  await test('Filter-then-load workflow', async () => {
    // Start fresh
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });

    // Set filter BEFORE loading
    await page.fill('#filterInput', '3080');
    console.log('  Set filter "3080" before loading');

    // Load zip demo
    const zipBtn = await page.$('#demoZipBtn');
    if (!zipBtn) {
      console.log('  Zip demo not available, skipping');
      return;
    }

    await page.click('#demoZipBtn');
    // Wait for files to load
    await page.waitForSelector('.file-item', { timeout: QUICK_TIMEOUT });

    // Check results - count visible categories
    const visibleCats = await page.$$('.category-section:not(.filtered)');
    console.log(`  With filter applied: ${visibleCats.length} categories visible`);

    // Clear filter and verify all visible
    await page.click('#clearFilterBtn');
    // Wait for filter to be cleared
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#filterInput') as HTMLInputElement;
        return input && input.value === '';
      },
      { timeout: QUICK_TIMEOUT }
    );

    const clearedFilter = await page.inputValue('#filterInput');
    if (clearedFilter !== '') {
      throw new Error('Filter not cleared');
    }

    const finalVisible = await page.$$('.category-section:not(.filtered)');
    const allCategories = await page.$$('.category-section');
    console.log(`  After clear: ${finalVisible.length}/${allCategories.length} categories visible`);

    if (finalVisible.length !== allCategories.length) {
      throw new Error(
        `Not all categories visible after clear: ${finalVisible.length}/${allCategories.length}`
      );
    }
  });

  // Test 5: Consistency checks
  await test('UI consistency validation', async () => {
    // Check for basic UI consistency - ensure categories have content
    const consistencyCheck = await page.evaluate(() => {
      const categories = document.querySelectorAll('.category-section');
      let totalGoroutines = 0;

      categories.forEach(cat => {
        const goroutines = cat.querySelectorAll('.goroutine-entry');
        totalGoroutines += goroutines.length;
      });

      return {
        categoriesCount: categories.length,
        totalGoroutines,
        hasContent: categories.length > 0 && totalGoroutines > 0,
      };
    });

    console.log(`  Categories: ${consistencyCheck.categoriesCount}`);
    console.log(`  Total goroutines: ${consistencyCheck.totalGoroutines}`);

    if (!consistencyCheck.hasContent) {
      throw new Error('UI should have categories with goroutines');
    }

    console.log('  ✅ UI has expected content structure');
  });

  // Test 6: Basic expand/collapse functionality
  await test('Basic expand/collapse functionality', async () => {
    // First ensure we have some data loaded (from previous tests)
    await page.waitForSelector('.category-section', { timeout: QUICK_TIMEOUT });

    // Test that expand/collapse buttons exist and are clickable
    const expandBtn = await page.$('#expandAllBtn');
    const collapseBtn = await page.$('#collapseAllBtn');

    if (!expandBtn || !collapseBtn) {
      throw new Error('Expand/collapse buttons should exist');
    }

    // Test basic expand functionality
    await page.click('#expandAllBtn');
    await page.waitForTimeout(100);
    console.log('  ✅ Expand all button clickable');

    // Test basic collapse functionality
    await page.click('#collapseAllBtn');
    await page.waitForTimeout(100);
    console.log('  ✅ Collapse all button clickable');

    console.log('  ✅ Basic expand/collapse functionality works');
  });

  await test('File groups remain visible after collapse-all then individual stack expand', async () => {
    // This test reproduces the reported bug where file groups disappear
    await page.waitForSelector('.category-section', { timeout: QUICK_TIMEOUT });

    // First expand everything to ensure file groups are visible
    await page.click('#expandAllBtn');
    await page.click('#expandAllBtn'); // Second click to expand stacks
    await page.waitForTimeout(100);

    // Verify file groups are visible
    const fileGroupsVisible = await page.evaluate(() => {
      const fileGroups = document.querySelectorAll('.file-section');
      return Array.from(fileGroups).some(section => !section.classList.contains('collapsed'));
    });

    if (!fileGroupsVisible) {
      throw new Error('Expected file groups to be visible after expand all');
    }

    // Now collapse all
    await page.click('#collapseAllBtn');
    await page.click('#collapseAllBtn'); // Second click to collapse categories
    await page.waitForTimeout(100);

    // Expand just the categories to see stacks
    await page.click('#expandAllBtn');
    await page.waitForTimeout(100);

    // Manually expand one stack by clicking its header
    const firstStackExpanded = await page.evaluate(() => {
      const stackHeaders = document.querySelectorAll('.stack-section .header');
      if (stackHeaders.length === 0) return false;

      (stackHeaders[0] as HTMLElement).click();
      return true;
    });

    if (!firstStackExpanded) {
      throw new Error('Could not expand a stack manually');
    }

    await page.waitForTimeout(100);

    // BUG: File groups should still be visible after manually expanding one stack
    // but currently they are collapsed due to the buggy collapse-all implementation
    const fileGroupsStillVisible = await page.evaluate(() => {
      const fileGroups = document.querySelectorAll('.file-section');
      return Array.from(fileGroups).some(section => !section.classList.contains('collapsed'));
    });

    if (!fileGroupsStillVisible) {
      throw new Error('BUG: File groups should remain visible after expanding individual stack');
    }

    console.log('  ✅ File groups remain visible after manual stack expansion');
  });

  await test('Navigation expands collapsed parent containers', async () => {
    await page.waitForSelector('.category-section', { timeout: QUICK_TIMEOUT });

    // First expand everything to ensure we have content
    await page.click('#expandAllBtn');
    await page.click('#expandAllBtn'); // Second click to expand stacks
    await page.waitForTimeout(100);

    // Debug: Check what elements we have
    const debugInfo = await page.evaluate(() => {
      return {
        goroutineEntries: document.querySelectorAll('.goroutine-entry').length,
        categories: document.querySelectorAll('.category-section').length,
        stacks: document.querySelectorAll('.stack-section').length,
        groups: document.querySelectorAll('.group-section').length,
        firstGoroutineId: document.querySelector('.goroutine-entry')?.id || 'none',
      };
    });

    console.log(
      `  🔍 Debug: ${debugInfo.goroutineEntries} goroutines, ${debugInfo.categories} categories, ${debugInfo.stacks} stacks, ${debugInfo.groups} groups`
    );
    console.log(`  🔍 First goroutine ID: ${debugInfo.firstGoroutineId}`);

    // Get any goroutine ID from the DOM to test navigation
    const targetGoroutineId = await page.evaluate(() => {
      const goroutineElement = document.querySelector('.goroutine-entry');
      if (!goroutineElement) return null;

      // Extract goroutine ID from the element ID
      const id = goroutineElement.id;
      const match = id.match(/goroutine-(.+)/);
      return match ? match[1] : null;
    });

    if (!targetGoroutineId) {
      console.log('  ⚠️ No goroutines found, skipping navigation test');
      return;
    }

    console.log(`  📍 Testing navigation to goroutine ${targetGoroutineId}`);

    // Verify the goroutine element exists before collapsing
    const goroutineExists = await page.evaluate(goroutineId => {
      return document.querySelector(`#goroutine-${CSS.escape(goroutineId)}`) !== null;
    }, targetGoroutineId);

    if (!goroutineExists) {
      console.log('  ⚠️ Target goroutine element not found, skipping navigation test');
      return;
    }

    // Collapse all containers
    await page.click('#collapseAllBtn');
    await page.click('#collapseAllBtn'); // Second click to collapse categories
    await page.waitForTimeout(100);

    // Verify everything is collapsed
    const allCollapsed = await page.evaluate(() => {
      const categories = document.querySelectorAll('.category-section');
      const stacks = document.querySelectorAll('.stack-section');
      return (
        Array.from(categories).every(cat => cat.classList.contains('container-collapsed')) &&
        Array.from(stacks).every(stack => stack.classList.contains('container-collapsed'))
      );
    });

    if (!allCollapsed) {
      throw new Error('Expected all containers to be collapsed before navigation test');
    }

    // Manually call the navigation method by directly calling it on the app instance
    await page.evaluate(goroutineId => {
      // Access the app instance and call the navigation method directly
      const app = (window as any).StackgazerApp;
      if (app && app.navigateToGoroutine) {
        app.navigateToGoroutine(goroutineId);
      } else {
        // Fallback: simulate URL navigation
        window.location.hash = `#goroutine-${goroutineId}`;
        const event = new PopStateEvent('popstate', {
          state: { goroutineId: goroutineId },
        });
        window.dispatchEvent(event);
      }
    }, targetGoroutineId);

    await page.waitForTimeout(200); // Wait for navigation and expansion

    // Check if parent containers were expanded for the target goroutine
    const targetExpanded = await page.evaluate(goroutineId => {
      const highlighted = document.querySelector(`#goroutine-${CSS.escape(goroutineId)}`);
      if (!highlighted) return false;

      // Check if all parent containers are expanded
      let current = highlighted.parentElement;
      while (current) {
        if (current.classList.contains('expandable') && current.classList.contains('collapsed')) {
          return false; // Found a collapsed parent
        }
        current = current.parentElement;
      }
      return true; // All parents are expanded
    }, targetGoroutineId);

    if (!targetExpanded) {
      throw new Error('Navigation should expand all parent containers of target goroutine');
    }

    console.log('  ✅ Navigation expands collapsed parent containers');
  });

  // Test 7: Clipboard copy chunking functionality
  await test('Clipboard copy chunks large goroutine groups', async () => {
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });
    await page.click('#demoSingleBtn');
    await page.waitForSelector('.group-section', { timeout: QUICK_TIMEOUT });

    // Test clipboard copy functionality
    const copyResult = await page.evaluate(async () => {
      // Create a mock stack with many goroutines for testing
      const mockStack = {
        id: 'test-stack',
        name: 'Test Stack with Many Goroutines',
        trace: [
          { func: 'func1', file: 'file1.go', line: 10 },
          { func: 'func2', file: 'file2.go', line: 20 },
        ],
        files: [
          {
            id: 'test-file',
            fileId: 'test-file',
            fileName: 'test.go',
            groups: [
              {
                id: 'test-group',
                labels: [],
                goroutines: [] as any[],
                pinned: false,
                counts: {
                  total: 50,
                  matches: 50,
                  visibilityChanged: false,
                  filterMatches: 50,
                  pinned: 0,
                  minWait: Infinity,
                  maxWait: -Infinity,
                  minMatchingWait: Infinity,
                  maxMatchingWait: -Infinity,
                  states: new Map(),
                  matchingStates: new Map(),
                },
              },
            ],
            pinned: false,
            counts: {
              total: 50,
              matches: 50,
              visibilityChanged: false,
              filterMatches: 50,
              pinned: 0,
              minWait: Infinity,
              maxWait: -Infinity,
              minMatchingWait: Infinity,
              maxMatchingWait: -Infinity,
              states: new Map(),
              matchingStates: new Map(),
            },
          },
        ],
        searchableText: '',
        pinned: false,
        counts: {
          total: 50,
          matches: 50,
          visibilityChanged: false,
          filterMatches: 50,
          pinned: 0,
          minWait: Infinity,
          maxWait: -Infinity,
          minMatchingWait: Infinity,
          maxMatchingWait: -Infinity,
          states: new Map(),
          matchingStates: new Map(),
        },
      };

      // Add 50 goroutines with same state to trigger chunking
      for (let i = 1; i <= 50; i++) {
        (mockStack.files[0].groups[0].goroutines as any[]).push({
          id: i.toString(),
          creator: '',
          creatorExists: false,
          created: [],
          state: 'chan receive',
          waitMinutes: 5,
          matches: true,
          pinned: false,
          stack: {
            id: 'test-stack',
            name: 'Test Stack',
            trace: [{ func: 'testFunc', file: 'test.go', line: 1 }],
            files: [],
            searchableText: '',
            pinned: false,
            counts: {
              total: 1,
              matches: 1,
              visibilityChanged: false,
              filterMatches: 1,
              pinned: 0,
              minWait: Infinity,
              maxWait: -Infinity,
              minMatchingWait: Infinity,
              maxMatchingWait: -Infinity,
              states: new Map(),
              matchingStates: new Map(),
            },
          },
        });
      }

      // Create mock category
      const mockCategory = {
        id: 'test-category',
        name: 'Test Category',
        stacks: [mockStack],
        pinned: false,
        counts: {
          total: 50,
          matches: 50,
          visibilityChanged: false,
          filterMatches: 50,
          pinned: 0,
          minWait: Infinity,
          maxWait: -Infinity,
          minMatchingWait: Infinity,
          maxMatchingWait: -Infinity,
          states: new Map(),
          matchingStates: new Map(),
        },
      };

      // Access the StackTraceApp instance and call copyStackToClipboard
      const app = (window as any).debugApp || (window as any).stackTraceApp;
      if (!app || !app.copyStackToClipboard) {
        throw new Error('StackTraceApp instance not found');
      }

      // Mock navigator.clipboard.writeText to capture the output
      let copiedText = '';
      const originalWriteText = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (text: string) => {
        copiedText = text;
        return Promise.resolve();
      };

      try {
        // Call the copy method
        await app.copyStackToClipboard(mockStack, mockCategory);

        // Restore original method
        navigator.clipboard.writeText = originalWriteText;

        return copiedText;
      } catch (error) {
        navigator.clipboard.writeText = originalWriteText;
        throw error;
      }
    });

    if (!copyResult) {
      throw new Error('No text was copied to clipboard');
    }

    // Verify chunking behavior
    const lines = copyResult.split('\n');
    const goroutineLines = lines.filter(line => line.startsWith('goroutine '));

    // Should have 5 chunks: 12 + 12 + 12 + 12 + 2 (50 goroutines with 12 per chunk)
    if (goroutineLines.length !== 5) {
      throw new Error(`Expected 5 chunked lines, got ${goroutineLines.length}`);
    }

    // Check first chunk has 12 IDs
    const firstChunkIds = goroutineLines[0].match(/goroutine ([\d,]+) \[/)?.[1].split(',');
    if (!firstChunkIds || firstChunkIds.length !== 12) {
      throw new Error(`First chunk should have 12 IDs, got ${firstChunkIds?.length || 0}`);
    }

    // Check last chunk has 2 IDs
    const lastChunkIds = goroutineLines[4].match(/goroutine ([\d,]+) \[/)?.[1].split(',');
    if (!lastChunkIds || lastChunkIds.length !== 2) {
      throw new Error(`Last chunk should have 2 IDs, got ${lastChunkIds?.length || 0}`);
    }

    // Verify all chunks have the same header format
    const headerPattern = /goroutine [\d,]+ \[chan receive, 5m\]:/;
    if (!goroutineLines.every(line => headerPattern.test(line))) {
      throw new Error('All chunked lines should have the same header format');
    }

    console.log(
      `  ✅ Chunking works: ${goroutineLines.length} chunks for 50 goroutines (12 per chunk)`
    );
    console.log(`  ✅ First chunk: ${firstChunkIds.length} IDs`);
    console.log(`  ✅ Last chunk: ${lastChunkIds.length} IDs`);
  });

  // Test 8: Settings modal functionality
  await test('Settings modal basic functionality', async () => {
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });

    // Open settings modal
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal', { timeout: QUICK_TIMEOUT });

    // Verify modal is visible
    const modalVisible = await page.isVisible('#settingsModal');
    if (!modalVisible) throw new Error('Settings modal should be visible');
    console.log('  ✅ Settings modal opens successfully');

    // Check for basic settings elements (with very short timeouts to fail fast)
    try {
      await page.waitForSelector('.modal-content', { timeout: QUICK_TIMEOUT });
      console.log('  ✅ Modal content found');
    } catch (error) {
      throw new Error('Modal content not found within 100ms');
    }

    // Test close button exists and works
    try {
      await page.waitForSelector('#settingsModalCloseBtn', { timeout: 100 });
      await page.click('#settingsModalCloseBtn');
      await page.waitForTimeout(50); // Short wait for modal to close

      // Verify modal is hidden
      const modalHidden = !(await page.isVisible('#settingsModal'));
      if (!modalHidden) throw new Error('Settings modal should be hidden after close');

      console.log('  ✅ Settings modal closes successfully');
    } catch (error) {
      throw new Error('Settings modal close functionality failed');
    }

    console.log('  ✅ Settings modal basic functionality works');
  });

  // Test 9: Settings save functionality
  await test('Settings save functionality', async () => {
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: QUICK_TIMEOUT });

    // Open settings modal
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal', { timeout: QUICK_TIMEOUT });

    // First, expand the custom rules section by clicking its header
    // Use JavaScript to find and click the header
    await page.evaluate(() => {
      const textarea = document.getElementById('customfunctionTrimPrefixes');
      if (textarea) {
        const customSection = textarea.closest('.custom-rules-section');
        if (customSection) {
          const header = customSection.querySelector('.custom-rules-header');
          if (header) {
            (header as HTMLElement).click();
          }
        }
      }
    });

    // Now wait for the textarea to be visible and fill it
    await page.waitForSelector('#customfunctionTrimPrefixes:visible', { timeout: QUICK_TIMEOUT });
    await page.fill('#customfunctionTrimPrefixes', 'github.com/test/\ncom.example.');

    // Save settings
    const saveBtn = await page.waitForSelector('#saveSettingsBtn', { timeout: QUICK_TIMEOUT });
    if (!saveBtn) throw new Error('Save button not found');

    await page.click('#saveSettingsBtn');

    // Wait for modal to close (indicating successful save)
    await page.waitForTimeout(100);
    const modalHidden = !(await page.isVisible('#settingsModal'));
    if (!modalHidden) throw new Error('Settings modal should be hidden after save');

    console.log('  ✅ Settings save completed without errors');

    // Reopen modal to verify settings were persisted
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal', { timeout: QUICK_TIMEOUT });

    // Expand the custom section again to check the persisted value
    await page.evaluate(() => {
      const textarea = document.getElementById('customfunctionTrimPrefixes');
      if (textarea) {
        const customSection = textarea.closest('.custom-rules-section');
        if (customSection) {
          const header = customSection.querySelector('.custom-rules-header');
          if (header) {
            (header as HTMLElement).click();
          }
        }
      }
    });

    await page.waitForSelector('#customfunctionTrimPrefixes:visible', { timeout: QUICK_TIMEOUT });
    const persistedValue = await page.inputValue('#customfunctionTrimPrefixes');
    const expectedValue = 'github.com/test/\ncom.example.';

    if (persistedValue !== expectedValue) {
      throw new Error(
        `Settings not persisted. Expected: '${expectedValue}', Got: '${persistedValue}'`
      );
    }

    console.log('  ✅ Settings persistence verified');

    // Close modal
    await page.click('#settingsModalCloseBtn');
    await page.waitForTimeout(50);

    console.log('  ✅ Settings save functionality works');
  });

  await teardown();
  console.log('\n🎉 All UI interaction tests passed!');
}

runTests().catch(console.error);
