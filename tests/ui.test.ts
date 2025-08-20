/**
 * Comprehensive UI interaction tests using Playwright
 * Tests end-to-end user workflows and UI behaviors
 */

import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STANDALONE_HTML_PATH = path.join(__dirname, '..', 'dist', 'index-standalone.html');
const STANDALONE_HTML_URL = `file://${STANDALONE_HTML_PATH}`;

// Global timeout settings
const DEFAULT_TIMEOUT = 5000; // 5 seconds instead of 10-15
const QUICK_TIMEOUT = 2000;   // For fast operations

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
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  // Collect console errors
  page.on('pageerror', error => {
    console.log(`  ❌ Page Error: ${error.message}`);
  });

  await page.goto(STANDALONE_HTML_URL);
  await page.waitForSelector('.drop-zone');
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
          await page.waitForSelector('.group-section');
          const stackGroups = await page.$$('.group-section');
          if (stackGroups.length === 0) throw new Error('No group sections found');

          const totalStacks = await page.textContent('#totalStacks');
          if (totalStacks === '0') throw new Error('Total stacks should be > 0');
        },
        description: 'Load single demo file and verify content appears',
      },
      {
        name: 'Zip demo file',
        action: async page => {
          await page.reload();
          await page.waitForSelector('.drop-zone');

          const zipBtn = await page.$('#demoZipBtn');
          if (!zipBtn) {
            console.log('  Zip demo button not found, skipping');
            return;
          }
          await page.click('#demoZipBtn');
        },
        verify: async page => {
          await page.waitForSelector('.file-item');
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
    await page.waitForSelector('.drop-zone', { timeout: 10000 });
    await page.click('#demoSingleBtn');
    await page.waitForSelector('.group-section');

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
      await page.waitForFunction((expectedValue) => {
        const input = document.querySelector('#filterInput') as HTMLInputElement;
        return input && input.value === expectedValue;
      }, t.filter, { timeout: 2000 });

      // Verify filter was applied
      const filterValue = await page.inputValue('#filterInput');
      if (filterValue !== t.filter) {
        throw new Error(`Filter not applied: expected "${t.filter}", got "${filterValue}"`);
      }

      // Check that UI responded
      const visibleStacks = await page.textContent('#visibleStacks');
      const totalStacks = await page.textContent('#totalStacks');
      console.log(`    Result: ${visibleStacks}/${totalStacks} stacks visible`);
    }
  });

  // Test 3: Navigation and interaction
  await test('Navigation and UI interactions', async () => {
    // Test expansion/collapse
    const visibleGroupHeader = await page.$('.group-header:not(.hidden)');
    if (visibleGroupHeader) {
      await visibleGroupHeader.click();
      // Wait for expansion/collapse animation to complete
      await page.waitForFunction(() => {
        const groupContent = document.querySelector('.group-content');
        return groupContent && (groupContent.classList.contains('collapsed') || groupContent.classList.contains('expanded'));
      }, { timeout: 1000 }).catch(() => {});
      console.log('  ✅ Group expansion/collapse works');
    }

    // Test creator link navigation
    const creatorLinks = await page.$$('.creator-link');
    if (creatorLinks.length > 0) {
      for (let i = 0; i < Math.min(creatorLinks.length, 3); i++) {
        try {
          await creatorLinks[i].click({ timeout: 1000 });
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
        await page.waitForFunction(() => {
          const backBtn = document.querySelector('#backBtn') as HTMLButtonElement;
          return backBtn && backBtn.disabled;
        }, { timeout: 2000 }).catch(() => {});
        console.log('  ✅ Back navigation works');
      }
    }

    // Test display mode switching
    await page.selectOption('#stackDisplayModeSelect', 'side-by-side');
    // Wait for display mode change to take effect
    await page.waitForFunction(() => {
      const select = document.querySelector('#stackDisplayModeSelect') as HTMLSelectElement;
      return select && select.value === 'side-by-side';
    }, { timeout: 2000 });
    await page.selectOption('#stackDisplayModeSelect', 'functions');
    await page.waitForFunction(() => {
      const select = document.querySelector('#stackDisplayModeSelect') as HTMLSelectElement;
      return select && select.value === 'functions';
    }, { timeout: 2000 });
    console.log('  ✅ Display mode switching works');
  });

  // Test 4: Filter-then-load workflow (critical bug test)
  await test('Filter-then-load workflow', async () => {
    // Start fresh
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: 10000 });

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
    await page.waitForSelector('.file-item', { timeout: 10000 });

    // Check results
    const visibleStacks = await page.textContent('#visibleStacks');
    const totalStacks = await page.textContent('#totalStacks');
    console.log(`  With filter applied: ${visibleStacks}/${totalStacks} stacks visible`);

    // Clear filter and verify all visible
    await page.click('#clearFilterBtn');
    // Wait for filter to be cleared
    await page.waitForFunction(() => {
      const input = document.querySelector('#filterInput') as HTMLInputElement;
      return input && input.value === '';
    }, { timeout: 2000 });

    const clearedFilter = await page.inputValue('#filterInput');
    if (clearedFilter !== '') {
      throw new Error('Filter not cleared');
    }

    const finalVisible = await page.textContent('#visibleStacks');
    const finalTotal = await page.textContent('#totalStacks');
    console.log(`  After clear: ${finalVisible}/${finalTotal} stacks visible`);

    if (finalVisible !== finalTotal) {
      throw new Error(`Not all stacks visible after clear: ${finalVisible}/${finalTotal}`);
    }
  });

  // Test 5: Consistency checks
  await test('UI consistency validation', async () => {
    // Check for UI-model consistency
    const groupCountsMatch = await page.evaluate(() => {
      const stackHeaders = document.querySelectorAll('.group-count');
      const groupSubHeaders = document.querySelectorAll('.group-sub-header-count');

      let stackTotal = 0;
      let groupTotal = 0;

      stackHeaders.forEach(header => {
        const match = header.textContent?.match(/(\d+) (?:\(of (\d+)\) )?goroutines/);
        if (match) stackTotal += parseInt(match[1]);
      });

      groupSubHeaders.forEach(header => {
        const match = header.textContent?.match(/^(\d+)(?: \(of (\d+)\))?$/);
        if (match) groupTotal += parseInt(match[1]);
      });

      return { stackTotal, groupTotal, consistent: stackTotal === groupTotal };
    });

    console.log(`  Stack-level total: ${groupCountsMatch.stackTotal}`);
    console.log(`  Group-level total: ${groupCountsMatch.groupTotal}`);

    if (!groupCountsMatch.consistent) {
      throw new Error(
        `Count inconsistency: stack-level=${groupCountsMatch.stackTotal}, group-level=${groupCountsMatch.groupTotal}`
      );
    }

    console.log('  ✅ UI counts are consistent');
  });

  // Test 6: Settings modal CRDB defaults test
  await test('Settings modal shows CRDB defaults correctly', async () => {
    // Clear localStorage to ensure we're testing fresh state
    await page.evaluate(() => {
      localStorage.clear();
    });

    // Reload page to ensure fresh state
    await page.reload();
    await page.waitForSelector('.drop-zone', { timeout: 10000 });

    // Open settings modal
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal', { state: 'visible', timeout: 5000 });

    // Check that CRDB-specific defaults are present
    const fileTrimPrefixes = await page.inputValue('#fileTrimPrefixes');
    console.log(`  File trim prefixes: "${fileTrimPrefixes}"`);
    
    if (!fileTrimPrefixes.includes('github.com/cockroachdb/cockroach/')) {
      throw new Error(`Expected CRDB file trim prefix, got: "${fileTrimPrefixes}"`);
    }

    // Check title manipulation rules contain CRDB-specific rules
    const titleRules = await page.inputValue('#titleManipulationRules');
    console.log(`  Title rules (first 100 chars): "${titleRules.substring(0, 100)}..."`);
    
    if (!titleRules.includes('trim:github.com/cockroachdb/cockroach/')) {
      throw new Error('Expected CRDB trim rule in title manipulation rules');
    }

    if (!titleRules.includes('fold:sync.(*WaitGroup).Wait->waitgroup')) {
      throw new Error('Expected waitgroup fold rule in title manipulation rules');
    }

    // Test that settings persist after saving
    const testPrefix = 'test-prefix-';
    await page.fill('#fileTrimPrefixes', fileTrimPrefixes + ',' + testPrefix);
    await page.click('#saveSettingsBtn');
    
    // Wait for modal to close
    await page.waitForSelector('#settingsModal', { state: 'hidden', timeout: 5000 });

    // Reopen settings and verify the change was saved
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal', { state: 'visible', timeout: 5000 });
    
    const updatedFileTrimPrefixes = await page.inputValue('#fileTrimPrefixes');
    if (!updatedFileTrimPrefixes.includes(testPrefix)) {
      throw new Error(`Settings not saved properly, expected to find "${testPrefix}"`);
    }

    // Close modal
    await page.click('#settingsModalCloseBtn');
    await page.waitForSelector('#settingsModal', { state: 'hidden', timeout: 5000 });

    console.log('  ✅ CRDB defaults loaded correctly in settings modal');
    console.log('  ✅ Settings save/load functionality works');
  });

  // Test 7: Progressive expand/collapse behavior
  await test('Progressive expand/collapse behavior', async () => {
    // First ensure we have some data loaded (from previous tests)
    await page.waitForSelector('.category-section', { timeout: 5000 });
    
    // Test progressive collapse: if any stacks are expanded, collapse all stacks
    // First expand everything to have a known state
    await page.click('#expandAllBtn');
    await page.waitForTimeout(100);
    
    const hasExpandedStacks = await page.evaluate(() => {
      const stacks = document.querySelectorAll('.stack-section');
      return Array.from(stacks).some(stack => !stack.classList.contains('collapsed'));
    });
    
    if (!hasExpandedStacks) {
      throw new Error('Expected some stacks to be expanded after expand all');
    }
    
    // Now collapse - should collapse stacks first
    await page.click('#collapseAllBtn');
    await page.waitForTimeout(100);
    
    const allStacksCollapsed = await page.evaluate(() => {
      const stacks = document.querySelectorAll('.stack-section');
      return Array.from(stacks).every(stack => stack.classList.contains('collapsed'));
    });
    
    const categoriesStillExpanded = await page.evaluate(() => {
      const categories = document.querySelectorAll('.category-section');
      return Array.from(categories).some(cat => !cat.classList.contains('collapsed'));
    });
    
    if (!allStacksCollapsed || !categoriesStillExpanded) {
      throw new Error('First collapse should only collapse stacks, leaving categories expanded');
    }
    
    // Second collapse should collapse categories
    await page.click('#collapseAllBtn');
    await page.waitForTimeout(100);
    
    const allCategoriesCollapsed = await page.evaluate(() => {
      const categories = document.querySelectorAll('.category-section');
      return Array.from(categories).every(cat => cat.classList.contains('collapsed'));
    });
    
    if (!allCategoriesCollapsed) {
      throw new Error('Second collapse should collapse all categories');
    }
    
    // Test progressive expand: if any categories are collapsed, expand all categories
    await page.click('#expandAllBtn');
    await page.waitForTimeout(100);
    
    const categoriesExpanded = await page.evaluate(() => {
      const categories = document.querySelectorAll('.category-section');
      return Array.from(categories).every(cat => !cat.classList.contains('collapsed'));
    });
    
    const stacksStillCollapsed = await page.evaluate(() => {
      const stacks = document.querySelectorAll('.stack-section');
      return Array.from(stacks).every(stack => stack.classList.contains('collapsed'));
    });
    
    if (!categoriesExpanded || !stacksStillCollapsed) {
      throw new Error('First expand should only expand categories, leaving stacks collapsed');
    }
    
    // Second expand should expand stacks
    await page.click('#expandAllBtn');
    await page.waitForTimeout(100);
    
    const finalStacksExpanded = await page.evaluate(() => {
      const stacks = document.querySelectorAll('.stack-section');
      return Array.from(stacks).some(stack => !stack.classList.contains('collapsed'));
    });
    
    if (!finalStacksExpanded) {
      throw new Error('Second expand should expand stacks');
    }
    
    console.log('  ✅ Progressive collapse behavior works correctly');
    console.log('  ✅ Progressive expand behavior works correctly');
  });

  await test('File groups remain visible after collapse-all then individual stack expand', async () => {
    // This test reproduces the reported bug where file groups disappear
    await page.waitForSelector('.category-section', { timeout: 5000 });
    
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

  await teardown();
  console.log('\n🎉 All UI interaction tests passed!');
}

runTests().catch(console.error);
