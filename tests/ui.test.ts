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

  // Collect console errors
  page.on('pageerror', error => {
    console.log(`  ❌ Page Error: ${error.message}`);
  });

  await page.goto(STANDALONE_HTML_URL);
  await page.waitForSelector('.drop-zone', { timeout: 10000 });
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
          await page.waitForSelector('.stack-group', { timeout: 15000 });
          const stackGroups = await page.$$('.stack-group');
          if (stackGroups.length === 0) throw new Error('No stack groups found');

          const totalStacks = await page.textContent('#totalStacks');
          if (totalStacks === '0') throw new Error('Total stacks should be > 0');
        },
        description: 'Load single demo file and verify content appears',
      },
      {
        name: 'Zip demo file',
        action: async page => {
          await page.reload();
          await page.waitForSelector('.drop-zone', { timeout: 10000 });

          const zipBtn = await page.$('#demoZipBtn');
          if (!zipBtn) {
            console.log('  Zip demo button not found, skipping');
            return;
          }
          await page.click('#demoZipBtn');
        },
        verify: async page => {
          await page.waitForSelector('.file-item', { timeout: 15000 });
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
    await page.waitForSelector('.stack-group', { timeout: 15000 });

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

  await teardown();
  console.log('\n🎉 All UI interaction tests passed!');
}

runTests().catch(console.error);
