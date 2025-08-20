/**
 * Comprehensive data model and filtering tests
 * Tests ProfileCollection, FileParser, and filtering logic with 100% coverage
 */

import { ProfileCollection } from '../src/app/ProfileCollection.ts';
import { FileParser } from '../src/parser/parser.ts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, '../examples');

const parser = new FileParser();
const defaultSettings = {
  functionPrefixesToTrim: [] as RegExp[],
  filePrefixesToTrim: [] as RegExp[],
  titleManipulationRules: [],
  nameExtractionPatterns: [],
  zipFilePattern: '^(.*\/)?stacks\.txt$',
  categoryIgnoredPrefixes: [],
};

// Test data
const format1Content = `goroutine profile: total 4
2 @ 0x1000
#	0x1000	main.worker	/main.go:10

1 @ 0x1000
# labels {"state":"running"}
#	0x1000	main.worker	/main.go:10

1 @ 0x2000
#	0x2000	io.read	/io.go:5`;

const format2Content = `goroutine 1 [running]:
main.worker()
	/main.go:10 +0x10

goroutine 2 [select]:
io.read()
	/io.go:5 +0x05

goroutine 3 [select]:
main.worker()
	/main.go:10 +0x10
created by main.start() in goroutine 1

goroutine 4 [running]:
main.worker()
	/main.go:10 +0x10
created by main.start() in goroutine 1`;

const exampleStacks1Content = readFileSync(join(examplesDir, 'stacks_with_labels.txt'), 'utf8');

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`\n🧪 ${name}`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
    console.log(`✅ PASS`);
  } catch (error) {
    console.error(`❌ FAIL: ${(error as Error).message}`);
    throw error;
  }
}

// Shared test helpers
async function addFile(
  collection: ProfileCollection,
  content: string,
  name: string,
  customName?: string
) {
  const result = await parser.parseFile(content, name);
  if (!result.success) throw new Error('Parse failed');
  collection.addFile(result.data, customName);
  return collection;
}

function assertCounts(
  collection: ProfileCollection,
  expectedStacks: number,
  expectedFiles: number,
  testName: string
) {
  const stacks = collection.getCategories().reduce((acc, x) => acc + x.stacks.length, 0);
  if (stacks !== expectedStacks) {
    throw new Error(
      `${testName}: expected ${expectedStacks} stacks, got ${stacks}`
    );
  }
  if (collection.getFileNames().length !== expectedFiles) {
    throw new Error(
      `${testName}: expected ${expectedFiles} files, got ${collection.getFileNames().length}`
    );
  }
}

function assertFirstGoroutineIdPrefixed(
  collection: ProfileCollection,
  shouldBePrefixed: boolean,
  testName: string
) {
  
  if (collection.getCategories().length === 0) return;
  const firstId = collection.getCategories()[0].stacks[0].files[0].groups[0].goroutines[0].id;
  const isPrefixed = firstId.includes('.');
  if (isPrefixed !== shouldBePrefixed) {
    const expected = shouldBePrefixed ? 'prefixed' : 'unprefixed';
    throw new Error(`${testName}: expected ${expected} ID, got ${firstId}`);
  }
}

async function runTests() {
  console.log('🧪 Data Model and Filtering Tests');

  // Note: Parser tests are in parser.test.ts - this file focuses on app/filtering layer

  // PROFILE COLLECTION TESTS - Table-driven
  test('ProfileCollection: File operations', async () => {
    const fileTests = [
      {
        name: 'Empty collection',
        files: [],
        expectStacks: 0,
        expectFiles: 0,
      },
      {
        name: 'Single file',
        files: [{ content: format2Content, name: 'test.txt' }],
        expectStacks: 2,
        expectFiles: 1,
        expectUnprefixed: true,
      },
      {
        name: 'Custom file name',
        files: [{ content: format2Content, name: 'test.txt', customName: 'custom.txt' }],
        expectStacks: 2,
        expectFiles: 1,
        expectFileName: 'custom.txt',
      },
      {
        name: 'Multi-file prefixing',
        files: [
          { content: format2Content, name: 'file1.txt' },
          { content: format1Content, name: 'file2.txt' },
        ],
        expectStacks: 2,
        expectFiles: 2,
        expectPrefixed: true,
      },
    ];

    for (const t of fileTests) {
      const collection = new ProfileCollection(defaultSettings);
      for (const file of t.files) {
        await addFile(collection, file.content, file.name, file.customName);
      }

      assertCounts(collection, t.expectStacks, t.expectFiles, t.name);

      if (t.expectFileName && collection.getFileNames()[0] !== t.expectFileName) {
        throw new Error(
          `${t.name}: expected file name ${t.expectFileName}, got ${collection.getFileNames()[0]}`
        );
      }
      if (t.expectUnprefixed) assertFirstGoroutineIdPrefixed(collection, false, t.name);
      if (t.expectPrefixed) assertFirstGoroutineIdPrefixed(collection, true, t.name);
    }
  });

  test('ProfileCollection: File removal and renaming', async () => {
    const collection = new ProfileCollection(defaultSettings);
    await addFile(collection, format2Content, 'test.txt');

    // Test removal
    if (!collection.removeFile('test.txt')) throw new Error('Remove should succeed');
    assertCounts(collection, 0, 0, 'After removal');
    if (collection.removeFile('nonexistent.txt'))
      throw new Error('Remove non-existent should fail');

    // Test renaming
    await addFile(collection, format2Content, 'old.txt');
    collection.renameFile('old.txt', 'new.txt', false);
    if (collection.getFileNames()[0] !== 'new.txt') throw new Error('File not renamed');
    collection.renameFile('nonexistent.txt', 'other.txt', false);
    assertCounts(collection, 2, 1, 'After renaming nonexistent');

    // Test prefix removal after multi-file removal
    collection.clear();
    await addFile(collection, format2Content, 'file1.txt');
    await addFile(collection, format1Content, 'file2.txt');
    collection.removeFile('file2.txt');
    assertFirstGoroutineIdPrefixed(collection, false, 'After removing second file');
  });

  test('ProfileCollection: Settings and processing', async () => {
    const settingsTests = [
      {
        name: 'Settings update re-imports',
        content: `goroutine 1 [running]:
main.worker()
	/usr/local/go/src/main.go:10 +0x10`,
        newSettings: {
          functionPrefixesToTrim: [/^main\./],
          filePrefixesToTrim: [/^\/usr\/local\/go\/src\//],
          titleManipulationRules: [],
          nameExtractionPatterns: [],
          zipFilePattern: '^(.*\/)?stacks\.txt$',
          categoryIgnoredPrefixes: [],
        },
        expectFuncTrimmed: true,
        expectFileTrimmed: true,
      },
      {
        name: 'Title manipulation rules',
        content: `goroutine 1 [running]:
runtime.gopark()
	runtime/proc.go:123 +0x10
sync.(*WaitGroup).Wait()
	sync/waitgroup.go:45 +0x20
main.worker()
	main.go:10 +0x30`,
        initialSettings: {
          functionPrefixesToTrim: [] as RegExp[],
          filePrefixesToTrim: [] as RegExp[],
          titleManipulationRules: [
            'skip:runtime.',
            'fold:sync.(*WaitGroup).Wait->waitgroup',
            'trim:main.',
          ],
          nameExtractionPatterns: [],
          zipFilePattern: '^(.*\/)?stacks\.txt$',
          categoryIgnoredPrefixes: [],
        },
        expectStackName: 'waitgroup worker',
      },
    ];

    for (const t of settingsTests) {
      const collection = new ProfileCollection(t.initialSettings || defaultSettings);
      await addFile(collection, t.content, 'test.txt');

      if (t.newSettings) {
        const stack = collection.getCategories()[0].stacks[0];
        const originalFunc = stack.trace[0].func;
        const originalFile = stack.trace[0].file;

        collection.updateSettings(t.newSettings);
        const updatedStack = collection.getCategories()[0].stacks[0];

        if (t.expectFuncTrimmed && originalFunc.startsWith('main.')) {
          const expected = originalFunc.substring('main.'.length);
          if (updatedStack.trace[0].func !== expected) {
            throw new Error(`${t.name}: Function trimming failed`);
          }
        }
        if (t.expectFileTrimmed && originalFile.startsWith('/usr/local/go/src/')) {
          const expected = originalFile.substring('/usr/local/go/src/'.length);
          if (updatedStack.trace[0].file !== expected) {
            throw new Error(`${t.name}: File trimming failed`);
          }
        }
      }

      if (t.expectStackName) {
        const stack = collection.getCategories()[0].stacks[0];
        if (stack.name !== t.expectStackName) {
          throw new Error(`${t.name}: Expected '${t.expectStackName}', got '${stack.name}'`);
        }
      }
    }
  });

  test('ProfileCollection: Stack properties', async () => {
    const collection = new ProfileCollection(defaultSettings);
    await addFile(collection, format2Content, 'test.txt');
    const stack = collection.getCategories()[0].stacks[0];

    // Searchable text tests
    if (!stack.searchableText.includes('main.worker'))
      throw new Error('Should contain function name');
    if (!stack.searchableText.includes('/main.go')) throw new Error('Should contain file name');
    if (stack.searchableText !== stack.searchableText.toLowerCase())
      throw new Error('Should be lowercase');
    if (stack.searchableText.length === 0) throw new Error('Searchable text should not be empty');

    // Stack merging test
    collection.clear();
    const sameTrace = `goroutine 1 [running]:\nmain.worker()\n\t/main.go:10 +0x10`;
    await addFile(collection, sameTrace, 'file1.txt');
    await addFile(collection, sameTrace, 'file2.txt');
    if (collection.getCategories()[0].stacks.length !== 1) throw new Error('Expected 1 merged stack');
    const mergedStack = collection.getCategories()[0].stacks[0];
    if (mergedStack.files.length !== 2) throw new Error('Expected stack in 2 files');
    if (mergedStack.counts.total !== 2) throw new Error('Expected total count of 2');

    // Title rules update test
    const originalName = mergedStack.name;
    collection.updateTitleRules(['trim:main.']);
    const newName = collection.getCategories()[0].stacks[0].name;
    if (originalName === newName) throw new Error('Title should change after updating rules');
    if (!originalName.startsWith('main.') || newName.startsWith('main.'))
      throw new Error('Trim rule not applied correctly');
  });

  test('Filtering: Pattern matching and functionality', async () => {
    // Setup multi-file test data
    const file1Content = `goroutine 1001 [select]:\napple()\n\tapple.go:11 +0x10\n\ngoroutine 1002 [select]:\nbanana()\n\tbanana.go:22 +0x20`;
    const file2Content = `goroutine 2001 [runnable]:\ncherry()\n\tcherry.go:33 +0x30\n\ngoroutine 2002 [runnable]:\nbanana()\n\tbanana.go:22 +0x20`;

    const collection = new ProfileCollection(defaultSettings);
    await addFile(collection, file1Content, 'file1.txt');
    await addFile(collection, file2Content, 'file2.txt');

    const filterTests = [
      { filter: '', expectStacks: 3, expectGoroutines: 4, desc: 'No filter shows all' },
      { filter: 'select', expectStacks: 2, expectGoroutines: 2, desc: 'Text search for select' },
      {
        filter: 'runnable',
        expectStacks: 2,
        expectGoroutines: 2,
        desc: 'Text search for runnable',
      },
      {
        filter: 'banana',
        expectStacks: 1,
        expectGoroutines: 2,
        desc: 'Function name shows all in stack',
      },
      { filter: '1002', expectStacks: 1, expectGoroutines: 1, desc: 'Specific goroutine ID' },
      { filter: 'xyz123', expectStacks: 0, expectGoroutines: 0, desc: 'No matches' },
    ];

    for (const t of filterTests) {
      collection.setFilter({ filterString: t.filter });
      const stats = collection.getStackStatistics();
      console.log(
        `  ${t.desc} ("${t.filter}"): ${stats.visible}/${stats.total} stacks, ${stats.visibleGoroutines}/${stats.totalGoroutines} goroutines`
      );

      if (stats.visible !== t.expectStacks || stats.visibleGoroutines !== t.expectGoroutines) {
        throw new Error(
          `${t.desc}: expected ${t.expectStacks}/${t.expectGoroutines}, got ${stats.visible}/${stats.visibleGoroutines}`
        );
      }
    }

    // Test clear filter and forced goroutine
    collection.clearFilter();
    const clearStats = collection.getStackStatistics();
    if (clearStats.visibleGoroutines !== clearStats.totalGoroutines) {
      throw new Error(
        `Clear filter failed: ${clearStats.visibleGoroutines}/${clearStats.totalGoroutines} visible`
      );
    }

    // Test forcedGoroutine functionality
    collection.clear();
    await addFile(collection, format2Content, 'test.txt');

    collection.setFilter({ filterString: '4' });
    const normalResult = collection.getStackStatistics().visibleGoroutines;

    collection.setFilter({ filterString: 'DOESNOTMATCH', forcedGoroutine: '4' });
    const forcedResult = collection.getStackStatistics().visibleGoroutines;

    if (normalResult !== forcedResult || normalResult !== 1) {
      throw new Error(
        `ForcedGoroutine test failed: normal=${normalResult}, forced=${forcedResult}, expected=1`
      );
    }
  });

  test('Filtering: Label counting', async () => {
    const collection = new ProfileCollection(defaultSettings);
    await addFile(collection, exampleStacks1Content, 'stacks_with_labels.txt');

    // Count helper function
    function countGoroutinesWithLabel(labelPredicate: (label: string) => boolean): number {
      let count = 0;
      for (const category of collection.getCategories()) {
        for (const stack of category.stacks) {
          for (const fileSection of stack.files) {
            for (const group of fileSection.groups) {
              if (group.labels.some(labelPredicate)) {
                count += group.counts.total;
              }
            }
          }
        }
      }
      return count;
    }

    const importCount = countGoroutinesWithLabel(label =>
      label.includes('IMPORT id=1095239891346194433')
    );
    console.log(`Found ${importCount} goroutines with IMPORT id=1095239891346194433 label`);

    if (importCount < 20 || importCount > 40) {
      throw new Error(`Expected IMPORT goroutine count around 31, got ${importCount}`);
    }
  });

  test('ProfileCollection: Method coverage', async () => {
    const collection = new ProfileCollection(defaultSettings);
    await addFile(collection, format2Content, 'test.txt');

    // Test filter lifecycle
    collection.setFilter({ filterString: '4' });
    if (collection.getStackStatistics().visibleGoroutines !== 1)
      throw new Error('Should have 1 visible goroutine after filtering');
    if (collection.getCurrentFilter() !== '4')
      throw new Error('getCurrentFilter should return filter string');

    collection.clearFilter();
    const stats = collection.getStackStatistics();
    if (stats.visibleGoroutines !== stats.totalGoroutines)
      throw new Error('Should have all goroutines visible after clearing filter');
    if (collection.getCurrentFilter() !== '')
      throw new Error('Current filter should be empty after clearing');

    // Test goroutine lookup
    const goroutine = collection.lookupGoroutine('4');
    if (!goroutine || goroutine.id !== '4')
      throw new Error('Should find and return correct goroutine');
    if (collection.lookupGoroutine('999')) throw new Error('Should not find nonexistent goroutine');

    // Test clearFilterChanges
    collection.setFilter({ filterString: '4' });
    const stack = collection.getCategories()[0].stacks[0];
    if (stack.counts.matches === stack.counts.priorMatches)
      throw new Error('Expected matches to differ from priorMatches after filtering');

    collection.clearFilterChanges();
    for (const cat of collection.getCategories()) {
      for (const stack of cat.stacks) {
        if (stack.counts.priorMatches !== stack.counts.matches)
          throw new Error('Stack priorMatches should equal matches after clearFilterChanges');
        for (const file of stack.files) {
          if (file.counts.priorMatches !== file.counts.matches)
            throw new Error('File priorMatches should equal matches after clearFilterChanges');
          for (const group of file.groups) {
            if (group.counts.priorMatches !== group.counts.matches)
              throw new Error('Group priorMatches should equal matches after clearFilterChanges');
          }
        }
      }
    }

    // Test clear and file statistics
    await addFile(collection, format1Content, 'file2.txt');
    let fileStats = collection.getFileStatistics();
    if (fileStats.size !== 2) throw new Error('Should have statistics for 2 files');

    const file1Stats = fileStats.get('test.txt');
    if (!file1Stats || file1Stats.visible !== file1Stats.total)
      throw new Error('File stats should be valid before filtering');

    collection.setFilter({ filterString: '1' });
    fileStats = collection.getFileStatistics();
    const file1StatsFiltered = fileStats.get('test.txt');
    if (!file1StatsFiltered || file1StatsFiltered.total !== file1Stats.total)
      throw new Error('Total count should not change after filtering');
    if (file1StatsFiltered.visible > file1StatsFiltered.total)
      throw new Error('Visible should not exceed total');

    collection.clear();
    assertCounts(collection, 0, 0, 'After clear');
    if (collection.getCurrentFilter() !== '') throw new Error('Filter should be cleared');
    const clearStats = collection.getStackStatistics();
    if (clearStats.total !== 0 || clearStats.totalGoroutines !== 0)
      throw new Error('Statistics should be zero after clear');
  });

  // Test pinning behavior
  test('Pinning behavior', async () => {
    const collection = new ProfileCollection(defaultSettings);
    
    // Add test data with multiple groups
    const testData = `goroutine 1 [running]:
main.worker()
	/main.go:10 +0x10

goroutine 2 [select]:
io.read()
	/io.go:5 +0x05

goroutine 3 [running]:
main.worker()
	/main.go:10 +0x10`;
    
    await addFile(collection, testData, 'test.txt');
    
    // Get initial state
    const stacks = collection.getCategories()[0].stacks;
    if (stacks.length === 0) throw new Error('Should have stacks');
    
    const stack = stacks[0];
    const group = stack.files[0].groups[0];
    
    // Test initial pinned state
    if (stack.pinned) throw new Error('Stack should not be pinned initially');
    if (group.pinned) throw new Error('Group should not be pinned initially');
    
    // Test stack pinning
    const stackPinned = collection.toggleStackPin(stack.id);
    if (!stackPinned) throw new Error('Stack should be pinned after toggle');
    if (!stack.pinned) throw new Error('Stack pinned property should be true');
    
    // Test group pinning
    const groupPinned = collection.toggleGroupPin(group.id);
    if (!groupPinned) throw new Error('Group should be pinned after toggle');
    if (!group.pinned) throw new Error('Group pinned property should be true');
    
    // Test pinned items remain visible with filter
    collection.setFilter({ filterString: 'nonexistent' });
    
    // Stack should be visible because it's pinned
    if (stack.counts.matches === 0) throw new Error('Pinned stack should be visible even with filter');
    if (stack.counts.filterMatches > 0) throw new Error('Pinned stack should not count as filter match');
    
    // Group should be visible because it's pinned
    if (group.counts.matches === 0) throw new Error('Pinned group should be visible even with filter');
    if (group.counts.filterMatches > 0) throw new Error('Pinned group should not count as filter match');
    
    // Test unpinning
    const stackUnpinned = collection.toggleStackPin(stack.id);
    if (stackUnpinned) throw new Error('Stack should be unpinned after second toggle');
    if (stack.pinned) throw new Error('Stack pinned property should be false');
    
    const groupUnpinned = collection.toggleGroupPin(group.id);
    if (groupUnpinned) throw new Error('Group should be unpinned after second toggle');
    if (group.pinned) throw new Error('Group pinned property should be false');
    
    // After unpinning with filter, should not be visible
    collection.setFilter({ filterString: 'nonexistent' });
    if (stack.counts.matches > 0) throw new Error('Unpinned stack should not be visible with non-matching filter');
    if (group.counts.matches > 0) throw new Error('Unpinned group should not be visible with non-matching filter');
    
    // Test category functionality within pinning test
    console.log('\n🧪 Category functionality test');
    
    const categories = collection.getCategories();
    console.log(`✅ Found ${categories.length} categories`);
    if (categories.length === 0) throw new Error('Expected at least one category');
    
    // Verify each category has stacks
    let totalStacksInCategories = 0;
    for (const category of categories) {
      console.log(`  Category "${category.name}": ${category.stacks.length} stacks, ${category.counts.total} goroutines`);
      totalStacksInCategories += category.stacks.length;
      if (category.stacks.length === 0) throw new Error(`Category ${category.name} should have stacks`);
    }
    
    // Verify all stacks are in categories
    const totalStacks = collection.getCategories().reduce((acc, x) => acc + x.stacks.length, 0) ;
    if (totalStacksInCategories !== totalStacks) {
      throw new Error(`All stacks should be in categories: ${totalStacksInCategories} vs ${totalStacks}`);
    }
    
    console.log('✅ Category functionality verified');
  });

  test('Category pin with children behavior', async () => {
    const collection = new ProfileCollection(defaultSettings);
    
    // Add test data with multiple categories, stacks, groups, and goroutines
    const testData = `goroutine 1 [running]:
main.worker()
	/main.go:10 +0x10

goroutine 2 [select]:
main.worker()
	/main.go:10 +0x10

goroutine 3 [running]:
io.read()
	/io.go:5 +0x05`;
    
    await addFile(collection, testData, 'test.txt');
    
    const categories = collection.getCategories();
    if (categories.length < 2) throw new Error('Should have at least 2 categories');
    
    const mainCategory = categories.find(c => c.name === 'main');
    if (!mainCategory) throw new Error('Should have main category');
    
    // Verify initial state - nothing should be pinned
    if (mainCategory.pinned) throw new Error('Category should not be pinned initially');
    
    for (const stack of mainCategory.stacks) {
      if (stack.pinned) throw new Error('Stack should not be pinned initially');
      for (const fileSection of stack.files) {
        for (const group of fileSection.groups) {
          if (group.pinned) throw new Error('Group should not be pinned initially');
          for (const goroutine of group.goroutines) {
            if (goroutine.pinned) throw new Error('Goroutine should not be pinned initially');
          }
        }
      }
    }
    
    // Test toggleCategoryPinWithChildren - should pin category and all children
    const categoryPinned = collection.toggleCategoryPinWithChildren(mainCategory.id);
    if (!categoryPinned) throw new Error('Category should be pinned after toggle');
    if (!mainCategory.pinned) throw new Error('Category pinned property should be true');
    
    // Verify all children are pinned
    for (const stack of mainCategory.stacks) {
      if (!stack.pinned) throw new Error('Stack should be pinned after category pin with children');
      for (const fileSection of stack.files) {
        for (const group of fileSection.groups) {
          if (!group.pinned) throw new Error('Group should be pinned after category pin with children');
          for (const goroutine of group.goroutines) {
            if (!goroutine.pinned) throw new Error('Goroutine should be pinned after category pin with children');
          }
        }
      }
    }
    
    // Test second toggle - should unpin category and all children
    const categoryUnpinned = collection.toggleCategoryPinWithChildren(mainCategory.id);
    if (categoryUnpinned) throw new Error('Category should be unpinned after second toggle');
    if (mainCategory.pinned) throw new Error('Category pinned property should be false');
    
    // Verify all children are unpinned
    for (const stack of mainCategory.stacks) {
      if (stack.pinned) throw new Error('Stack should be unpinned after category unpin with children');
      for (const fileSection of stack.files) {
        for (const group of fileSection.groups) {
          if (group.pinned) throw new Error('Group should be unpinned after category unpin with children');
          for (const goroutine of group.goroutines) {
            if (goroutine.pinned) throw new Error('Goroutine should be unpinned after category unpin with children');
          }
        }
      }
    }
    
    console.log('✅ Category pin with children functionality verified');
  });

  test('Category ignored prefixes can be passed at init', async () => {
    // Test custom categoryIgnoredPrefixes passed during initialization
    const customSettings = {
      categoryIgnoredPrefixes: 'runtime.\nsync.\ntest.'
    };
    
    // Create ProfileCollection directly with custom settings
    const testSettings = {
      ...defaultSettings,
      categoryIgnoredPrefixes: ['runtime.', 'sync.', 'test.']
    };
    
    const collection = new ProfileCollection(testSettings);
    
    // Test data with frames that should be ignored
    const testData = `goroutine 1 [running]:
runtime.gopark()
\t/runtime/proc.go:123 +0x10
sync.(*WaitGroup).Wait()
\t/sync/waitgroup.go:130 +0x10
test.helper()
\t/test/helper.go:15 +0x10
main.worker()
\t/main.go:10 +0x10`;
    
    await addFile(collection, testData, 'test.txt');
    
    const categories = collection.getCategories();
    if (categories.length === 0) throw new Error('Should have categories');
    
    // Should categorize as "main" since runtime, sync, and test prefixes are ignored
    const mainCategory = categories.find(c => c.name === 'main');
    if (!mainCategory) {
      const categoryNames = categories.map(c => c.name);
      throw new Error(`Should have main category. Found: ${categoryNames.join(', ')}`);
    }
    
    console.log('✅ Category ignored prefixes properly passed at init and used for categorization');
  });

  test('Category extraction pattern: prefix up to second slash OR first dot', async () => {
    const categoryTests = [
      // Basic cases - no slash, stop at dot
      { func: 'main.worker', expected: 'main' },
      { func: 'fmt.Printf', expected: 'fmt' },
      
      // Single slash - no second slash, so use first dot rule (no dot = whole string)
      { func: 'package/function', expected: 'package/function' },
      { func: 'main/worker', expected: 'main/worker' },
      
      // Pattern matches: domain/path1/path2 up to dots
      { func: 'github.com/user/repo.Function', expected: 'github.com/user/repo' },
      { func: 'go.uber.org/zap/zapcore.NewCore', expected: 'go.uber.org/zap/zapcore' },
      { func: 'company.com/project/service.Start', expected: 'company.com/project/service' },
      { func: 'google.golang.org/grpc.(*Server).serveStreams.func1.1', expected: 'google.golang.org/grpc' },
      { func: 'a/b/c', expected: 'a/b' },
      { func: 'a/b.c', expected: 'a/b' },
      
      // Fallback to first dot rule (pattern doesn't match)
      { func: 'main.worker/helper', expected: 'main' },
      { func: 'fmt.Printf/internal', expected: 'fmt' },
      
      // No slash or dot - return whole function
      { func: 'main', expected: 'main' },
      { func: 'runtime', expected: 'runtime' },
      { func: 'worker', expected: 'worker' },
      
      // Edge cases
      { func: '', expected: '' },
      { func: '/', expected: '' },
      { func: '.', expected: '' },
      { func: 'a.', expected: 'a' },
      { func: 'a/', expected: 'a' },
      { func: '/a', expected: '' },
      { func: 'a//b', expected: 'a/' },
      { func: 'a..b', expected: 'a' },
    ];

    console.log('\n🧪 Testing category extraction patterns:');
    
    for (const test of categoryTests) {
      // Create a simple test collection with category ignored prefixes
      const testSettings = {
        ...defaultSettings,
        categoryIgnoredPrefixes: [],
      };
      
      const collection = new ProfileCollection(testSettings);
      
      // Create test content with the function we want to test
      const testContent = `goroutine 1 [running]:
${test.func}()
\t/test.go:10 +0x10`;
      
      try {
        await addFile(collection, testContent, 'test.txt');
        const categories = collection.getCategories();
        
        if (categories.length === 0) {
          throw new Error(`No categories found for function: ${test.func}`);
        }
        
        const actualCategory = categories[0].name;
        if (actualCategory !== test.expected) {
          throw new Error(
            `Function "${test.func}": expected category "${test.expected}", got "${actualCategory}"`
          );
        }
        
        console.log(`  ✅ "${test.func}" → "${actualCategory}"`);
      } catch (error) {
        console.error(`  ❌ "${test.func}" → error: ${(error as Error).message}`);
        throw error;
      }
    }
    
    console.log('✅ All category extraction tests passed');
  });

  console.log('\n✅ All data model and filtering tests passed');
}

runTests().catch(console.error);
