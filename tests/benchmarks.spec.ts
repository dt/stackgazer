/**
 * UI Performance Benchmarks using Playwright
 * Tests actual DOM manipulation and style recalculation performance
 */

import { test, Page } from '@playwright/test';

interface BenchmarkResult {
  operation: string;
  duration: number;
  timestamp: number;
  metrics?: {
    styleRecalculations?: number;
    layoutThrashing?: number;
    paintTime?: number;
  };
}

class UIBenchmark {
  private results: BenchmarkResult[] = [];
  
  async measureOperation(
    page: Page, 
    name: string, 
    operation: () => Promise<void>
  ): Promise<BenchmarkResult> {
    // Start performance monitoring
    await page.evaluate(() => {
      performance.clearMeasures();
      performance.clearMarks();
      // Create a performance observer for paint and layout metrics
      (window as any).performanceMetrics = {
        styleRecalculations: 0,
        layouts: 0,
        paints: 0
      };
    });

    // Enable tracing for Chrome DevTools events
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    
    // Mark start time
    await page.evaluate(() => performance.mark('operation-start'));
    
    const startTime = performance.now();
    await operation();
    const endTime = performance.now();
    
    // Mark end time and measure
    await page.evaluate(() => {
      performance.mark('operation-end');
      performance.measure('operation-duration', 'operation-start', 'operation-end');
    });

    // Get performance metrics
    const performanceData = await page.evaluate(() => {
      const measure = performance.getEntriesByName('operation-duration')[0];
      const paintEntries = performance.getEntriesByType('paint');
      const layoutEntries = performance.getEntriesByType('layout-shift');
      
      return {
        duration: measure?.duration || 0,
        paintCount: paintEntries.length,
        layoutShifts: layoutEntries.length,
        metrics: (window as any).performanceMetrics
      };
    });

    // Get additional metrics from CDP
    const metrics = await client.send('Performance.getMetrics');
    await client.detach();
    
    // Find relevant metrics
    const layoutCount = metrics.metrics.find(m => m.name === 'LayoutCount')?.value || 0;
    const styleRecalcCount = metrics.metrics.find(m => m.name === 'RecalcStyleCount')?.value || 0;

    const result: BenchmarkResult = {
      operation: name,
      duration: endTime - startTime,
      timestamp: startTime,
      metrics: {
        styleRecalculations: styleRecalcCount,
        layoutThrashing: layoutCount,
        paintTime: performanceData.paintCount,
      }
    };

    this.results.push(result);
    console.log(`✅ ${name}: ${result.duration}ms (${styleRecalcCount} style recalcs, ${layoutCount} layouts)`);
    
    return result;
  }

  async printResults() {
    console.log('\n📈 UI Benchmark Results:');
    console.log('='.repeat(90));
    console.log('Operation                          | Duration  | Style Recalcs | Layouts');
    console.log('-'.repeat(90));

    for (const result of this.results) {
      const operation = result.operation.padEnd(34, ' ');
      const duration = `${result.duration}ms`.padStart(9, ' ');
      const styleRecalcs = `${result.metrics?.styleRecalculations || 0}`.padStart(13, ' ');
      const layouts = `${result.metrics?.layoutThrashing || 0}`.padStart(7, ' ');
      console.log(`${operation}| ${duration} | ${styleRecalcs} | ${layouts}`);
    }

    console.log('='.repeat(90));

    // Flag slow operations
    const slowOperations = this.results.filter(r => r.duration > 100);
    const highStyleRecalcs = this.results.filter(r => (r.metrics?.styleRecalculations || 0) > 50);
    const highLayouts = this.results.filter(r => (r.metrics?.layoutThrashing || 0) > 10);
    
    if (slowOperations.length > 0) {
      console.log('\n⚠️  Performance concerns (>100ms):');
      for (const op of slowOperations) {
        console.log(`   ${op.operation}: ${op.duration}ms`);
      }
    }
    
    if (highStyleRecalcs.length > 0) {
      console.log('\n⚠️  High style recalculations (>50):');
      for (const op of highStyleRecalcs) {
        console.log(`   ${op.operation}: ${op.metrics?.styleRecalculations} recalculations`);
      }
    }
    
    if (highLayouts.length > 0) {
      console.log('\n⚠️  High layout thrashing (>10):');
      for (const op of highLayouts) {
        console.log(`   ${op.operation}: ${op.metrics?.layoutThrashing} layouts`);
      }
    }
    
    if (slowOperations.length === 0 && highStyleRecalcs.length === 0 && highLayouts.length === 0) {
      console.log('\n✅ All operations performing well - UI performance looks good!');
    }
  }
}

test.describe('UI Performance Benchmarks', () => {
  let benchmark: UIBenchmark;

  test.beforeEach(async ({ page }) => {
    benchmark = new UIBenchmark();
    
    // Navigate to the standalone app
    await page.goto(`file://${process.cwd()}/dist/index.html`);
    
    // Click the demo zip button to load test data
    await page.click('#demoZipBtn');
    
    // Wait for categories to appear
    await page.waitForSelector('.category-section', { timeout: 10000 });
    
    // Wait a bit more for everything to settle
    await page.waitForTimeout(1000);
  });

  test.afterEach(async () => {
    await benchmark.printResults();
  });

  test('Filter benchmarks', async ({ page }) => {
    const filterInput = page.locator('#filterInput');
    
    // Benchmark: Filter by 'runnable'
    await benchmark.measureOperation(page, 'Filter: runnable', async () => {
      await filterInput.fill('runnable');
      await page.waitForTimeout(100); // Allow debouncing
    });

    await benchmark.measureOperation(page, 'Clear filter', async () => {
      await filterInput.fill('');
      await page.waitForTimeout(100);
    });

    // Benchmark: Filter by 'func1'
    await benchmark.measureOperation(page, 'Filter: func1', async () => {
      await filterInput.fill('func1');
      await page.waitForTimeout(100);
    });

    await benchmark.measureOperation(page, 'Clear filter', async () => {
      await filterInput.fill('');
      await page.waitForTimeout(100);
    });

    // Benchmark: Filter by non-matching term
    await benchmark.measureOperation(page, 'Filter: doesnotmatchanything', async () => {
      await filterInput.fill('doesnotmatchanything');
      await page.waitForTimeout(100);
    });

    await benchmark.measureOperation(page, 'Clear filter', async () => {
      await filterInput.fill('');
      await page.waitForTimeout(100);
    });
  });

  test('Pinning benchmarks', async ({ page }) => {
    // Find first goroutine, stack, and category pin buttons
    const firstGoroutinePinBtn = page.locator('.goroutine .pin-btn').first();
    const firstStackPinBtn = page.locator('.stack .pin-btn').first(); 
    const firstCategoryPinBtn = page.locator('.category-section .pin-btn').first();

    // Benchmark: Pin/unpin goroutine
    await benchmark.measureOperation(page, 'Pin goroutine', async () => {
      await firstGoroutinePinBtn.click();
    });

    await benchmark.measureOperation(page, 'Unpin goroutine', async () => {
      await firstGoroutinePinBtn.click();
    });

    // Benchmark: Pin/unpin stack
    await benchmark.measureOperation(page, 'Pin stack', async () => {
      await firstStackPinBtn.click();
    });

    await benchmark.measureOperation(page, 'Unpin stack', async () => {
      await firstStackPinBtn.click();
    });

    // Benchmark: Pin/unpin category
    await benchmark.measureOperation(page, 'Pin category', async () => {
      await firstCategoryPinBtn.click();
    });

    await benchmark.measureOperation(page, 'Unpin category', async () => {
      await firstCategoryPinBtn.click();
    });
  });

  test('Category collapse/expand benchmarks', async ({ page }) => {
    // Find kv/kvserver category (or similar large category)
    const kvCategory = page.locator('.category-section').filter({ hasText: 'kv' }).first();
    const kvCollapseBtn = kvCategory.locator('.collapse-btn');

    // Ensure it's expanded first
    const isCollapsed = await kvCategory.locator('.category-content').isVisible();
    if (!isCollapsed) {
      await kvCollapseBtn.click();
      await page.waitForTimeout(100);
    }

    // Benchmark: Expand large category
    await benchmark.measureOperation(page, 'Expand kv/kvserver category', async () => {
      await kvCollapseBtn.click();
      await page.waitForTimeout(50); // Allow animation to start
    });

    // Benchmark: Collapse large category  
    await benchmark.measureOperation(page, 'Collapse kv/kvserver category', async () => {
      await kvCollapseBtn.click();
      await page.waitForTimeout(50);
    });
  });

  test('Expand/Collapse All benchmarks', async ({ page }) => {
    const expandAllBtn = page.locator('#expandAllBtn');
    const collapseAllBtn = page.locator('#collapseAllBtn');

    // Benchmark: Expand All (first time)
    await benchmark.measureOperation(page, 'Expand All (first)', async () => {
      await expandAllBtn.click();
      await page.waitForTimeout(200); // Allow all animations to settle
    });

    // Benchmark: Collapse All (first time)
    await benchmark.measureOperation(page, 'Collapse All (first)', async () => {
      await collapseAllBtn.click();
      await page.waitForTimeout(200);
    });

    // Benchmark: Expand All (second time)
    await benchmark.measureOperation(page, 'Expand All (second)', async () => {
      await expandAllBtn.click();
      await page.waitForTimeout(200);
    });

    // Benchmark: Collapse All (second time)
    await benchmark.measureOperation(page, 'Collapse All (second)', async () => {
      await collapseAllBtn.click();
      await page.waitForTimeout(200);
    });
  });

  test('File section collapse benchmark', async ({ page }) => {
    // Look for pebble releaseLoop or other large file section
    // First expand all to make sure we can find file sections
    await page.locator('#expandAllBtn').click();
    await page.waitForTimeout(500);

    // Find a file section with many goroutines (48 as mentioned)
    const fileSections = page.locator('.file-section');
    const count = await fileSections.count();
    
    let targetFileSection = null;
    for (let i = 0; i < count; i++) {
      const section = fileSections.nth(i);
      const text = await section.textContent();
      if (text && (text.includes('releaseLoop') || text.includes('pebble'))) {
        targetFileSection = section;
        break;
      }
    }

    // If we didn't find pebble, just use the first large file section
    if (!targetFileSection) {
      targetFileSection = fileSections.first();
    }

    const collapseBtn = targetFileSection.locator('.collapse-btn').first();

    // Ensure it's expanded
    const isExpanded = await targetFileSection.locator('.file-section-content').isVisible();
    if (!isExpanded) {
      await collapseBtn.click();
      await page.waitForTimeout(100);
    }

    // Benchmark: Collapse large file section
    await benchmark.measureOperation(page, 'Collapse large file section (48 goroutines)', async () => {
      await collapseBtn.click();
      await page.waitForTimeout(100);
    });

    // Benchmark: Expand large file section
    await benchmark.measureOperation(page, 'Expand large file section (48 goroutines)', async () => {
      await collapseBtn.click();
      await page.waitForTimeout(100);
    });
  });
});