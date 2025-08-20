/**
 * Comprehensive data model and filtering tests
 * Tests ProfileCollection, FileParser, and filtering logic with 100% coverage
 */

import { ProfileCollection } from '../src/app/ProfileCollection.ts';
import { TEST_DATA, DEFAULT_SETTINGS, addFile, assertCounts, assertFirstGoroutineIdPrefixed, test } from './shared-test-data.js';

async function runTests() {
  console.log('🧪 Data Model and Filtering Tests');

  // PROFILE COLLECTION TESTS - Table-driven
  await test('ProfileCollection: File operations', async () => {
    const fileTests = [
      { name: 'Empty collection', files: [], expectStacks: 0, expectFiles: 0 },
      { name: 'Single file', files: [{ content: TEST_DATA.format2, name: 'test.txt' }], expectStacks: 2, expectFiles: 1, expectUnprefixed: true },
      { name: 'Custom file name', files: [{ content: TEST_DATA.format2, name: 'test.txt', customName: 'custom.txt' }], expectStacks: 2, expectFiles: 1, expectFileName: 'custom.txt' },
      { name: 'Multi-file prefixing', files: [{ content: TEST_DATA.format2, name: 'file1.txt' }, { content: TEST_DATA.format1, name: 'file2.txt' }], expectStacks: 2, expectFiles: 2, expectPrefixed: true },
    ];

    for (const t of fileTests) {
      const collection = new ProfileCollection(DEFAULT_SETTINGS);
      for (const file of t.files) {
        await addFile(collection, file.content, file.name, file.customName);
      }

      assertCounts(collection, t.expectStacks, t.expectFiles, t.name);

      if (t.expectFileName && collection.getFileNames()[0] !== t.expectFileName) {
        throw new Error(`${t.name}: expected file name ${t.expectFileName}, got ${collection.getFileNames()[0]}`);
      }
      if (t.expectUnprefixed) assertFirstGoroutineIdPrefixed(collection, false, t.name);
      if (t.expectPrefixed) assertFirstGoroutineIdPrefixed(collection, true, t.name);
    }
  });

  await test('ProfileCollection: File removal and renaming', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    if (!collection.removeFile('test.txt')) throw new Error('Remove should succeed');
    assertCounts(collection, 0, 0, 'After removal');
    if (collection.removeFile('nonexistent.txt')) throw new Error('Remove non-existent should fail');

    await addFile(collection, TEST_DATA.format2, 'old.txt');
    collection.renameFile('old.txt', 'new.txt', false);
    if (collection.getFileNames()[0] !== 'new.txt') throw new Error('File not renamed');
    collection.renameFile('nonexistent.txt', 'other.txt', false);
    assertCounts(collection, 2, 1, 'After renaming nonexistent');

    collection.clear();
    await addFile(collection, TEST_DATA.format2, 'file1.txt');
    await addFile(collection, TEST_DATA.format1, 'file2.txt');
    collection.removeFile('file2.txt');
    assertFirstGoroutineIdPrefixed(collection, false, 'After removing second file');
  });

  await test('ProfileCollection: Settings and processing', async () => {
    const settingsTests = [
      {
        name: 'Settings update re-imports',
        content: TEST_DATA.withTrimming,
        newSettings: {
          ...DEFAULT_SETTINGS,
          functionPrefixesToTrim: [/^main\./],
          filePrefixesToTrim: [/^\/usr\/local\/go\/src\//],
        },
        expectFuncTrimmed: true,
        expectFileTrimmed: true,
      },
      {
        name: 'Title manipulation rules',
        content: TEST_DATA.withManipulation,
        initialSettings: {
          ...DEFAULT_SETTINGS,
          titleManipulationRules: ['skip:runtime.', 'fold:sync.(*WaitGroup).Wait->waitgroup', 'trim:main.'],
        },
        expectStackName: 'waitgroup worker',
      },
    ];

    for (const t of settingsTests) {
      const collection = new ProfileCollection(t.initialSettings || DEFAULT_SETTINGS);
      await addFile(collection, t.content, 'test.txt');

      if (t.newSettings) {
        const stack = collection.getCategories()[0].stacks[0];
        const originalFunc = stack.trace[0].func;
        const originalFile = stack.trace[0].file;

        collection.updateSettings(t.newSettings);
        const updatedStack = collection.getCategories()[0].stacks[0];

        if (t.expectFuncTrimmed && originalFunc.startsWith('main.')) {
          const expected = originalFunc.substring('main.'.length);
          if (updatedStack.trace[0].func !== expected) throw new Error(`${t.name}: Function trimming failed`);
        }
        if (t.expectFileTrimmed && originalFile.startsWith('/usr/local/go/src/')) {
          const expected = originalFile.substring('/usr/local/go/src/'.length);
          if (updatedStack.trace[0].file !== expected) throw new Error(`${t.name}: File trimming failed`);
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

  await test('ProfileCollection: Stack properties', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');
    
    // Find the main.worker stack (in 'main' category)
    const mainCategory = collection.getCategories().find(c => c.name === 'main');
    if (!mainCategory) throw new Error('Should have main category');
    const stack = mainCategory.stacks[0];

    // Searchable text tests
    if (!stack.searchableText.includes('main.worker')) throw new Error('Should contain function name');
    if (!stack.searchableText.includes('/main.go')) throw new Error('Should contain file name');
    if (stack.searchableText !== stack.searchableText.toLowerCase()) throw new Error('Should be lowercase');
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
    if (!originalName.startsWith('main.') || newName.startsWith('main.')) throw new Error('Trim rule not applied correctly');
  });

  await test('Filtering: Pattern matching and functionality', async () => {
    const file1Content = `goroutine 1001 [select]:\napple()\n\tapple.go:11 +0x10\n\ngoroutine 1002 [select]:\nbanana()\n\tbanana.go:22 +0x20`;
    const file2Content = `goroutine 2001 [runnable]:\ncherry()\n\tcherry.go:33 +0x30\n\ngoroutine 2002 [runnable]:\nbanana()\n\tbanana.go:22 +0x20`;

    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, file1Content, 'file1.txt');
    await addFile(collection, file2Content, 'file2.txt');

    const filterTests = [
      { filter: '', expectStacks: 3, expectGoroutines: 4, desc: 'No filter shows all' },
      { filter: 'select', expectStacks: 2, expectGoroutines: 2, desc: 'Text search for select' },
      { filter: 'runnable', expectStacks: 2, expectGoroutines: 2, desc: 'Text search for runnable' },
      { filter: 'banana', expectStacks: 1, expectGoroutines: 2, desc: 'Function name shows all in stack' },
      { filter: '1002', expectStacks: 1, expectGoroutines: 1, desc: 'Specific goroutine ID' },
      { filter: 'xyz123', expectStacks: 0, expectGoroutines: 0, desc: 'No matches' },
    ];

    for (const t of filterTests) {
      collection.setFilter({ filterString: t.filter });
      const stats = collection.getStackStatistics();
      if (stats.visible !== t.expectStacks || stats.visibleGoroutines !== t.expectGoroutines) {
        throw new Error(`${t.desc}: expected ${t.expectStacks}/${t.expectGoroutines}, got ${stats.visible}/${stats.visibleGoroutines}`);
      }
    }

    // Test clear filter and forced goroutine
    collection.clearFilter();
    const clearStats = collection.getStackStatistics();
    if (clearStats.visibleGoroutines !== clearStats.totalGoroutines) {
      throw new Error(`Clear filter failed: ${clearStats.visibleGoroutines}/${clearStats.totalGoroutines} visible`);
    }

    // Test forcedGoroutine functionality
    collection.clear();
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    collection.setFilter({ filterString: '4' });
    const normalResult = collection.getStackStatistics().visibleGoroutines;

    collection.setFilter({ filterString: 'DOESNOTMATCH', forcedGoroutine: '4' });
    const forcedResult = collection.getStackStatistics().visibleGoroutines;

    if (normalResult !== forcedResult || normalResult !== 1) {
      throw new Error(`ForcedGoroutine test failed: normal=${normalResult}, forced=${forcedResult}, expected=1`);
    }
  });

  await test('Filtering: Label counting', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.exampleWithLabels, 'stacks_with_labels.txt');

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

    const importCount = countGoroutinesWithLabel(label => label.includes('IMPORT id=1095239891346194433'));
    if (importCount < 20 || importCount > 40) {
      throw new Error(`Expected IMPORT goroutine count around 31, got ${importCount}`);
    }
  });

  await test('ProfileCollection: Method coverage', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    // Test filter lifecycle
    collection.setFilter({ filterString: '4' });
    if (collection.getStackStatistics().visibleGoroutines !== 1) throw new Error('Should have 1 visible goroutine after filtering');
    if (collection.getCurrentFilter() !== '4') throw new Error('getCurrentFilter should return filter string');

    collection.clearFilter();
    const stats = collection.getStackStatistics();
    if (stats.visibleGoroutines !== stats.totalGoroutines) throw new Error('Should have all goroutines visible after clearing filter');
    if (collection.getCurrentFilter() !== '') throw new Error('Current filter should be empty after clearing');

    // Test goroutine lookup
    const goroutine = collection.lookupGoroutine('4');
    if (!goroutine || goroutine.id !== '4') throw new Error('Should find and return correct goroutine');
    if (collection.lookupGoroutine('999')) throw new Error('Should not find nonexistent goroutine');

    // Test clearFilterChanges
    collection.setFilter({ filterString: '4' });
    const stack = collection.getCategories()[0].stacks[0];
    if (stack.counts.matches === stack.counts.priorMatches) throw new Error('Expected matches to differ from priorMatches after filtering');

    collection.clearFilterChanges();
    for (const cat of collection.getCategories()) {
      for (const stack of cat.stacks) {
        if (stack.counts.priorMatches !== stack.counts.matches) throw new Error('Stack priorMatches should equal matches after clearFilterChanges');
        for (const file of stack.files) {
          if (file.counts.priorMatches !== file.counts.matches) throw new Error('File priorMatches should equal matches after clearFilterChanges');
          for (const group of file.groups) {
            if (group.counts.priorMatches !== group.counts.matches) throw new Error('Group priorMatches should equal matches after clearFilterChanges');
          }
        }
      }
    }

    await addFile(collection, TEST_DATA.format1, 'file2.txt');
    let fileStats = collection.getFileStatistics();
    if (fileStats.size !== 2) throw new Error('Should have statistics for 2 files');

    const file1Stats = fileStats.get('test.txt');
    if (!file1Stats || file1Stats.visible !== file1Stats.total) throw new Error('File stats should be valid before filtering');

    collection.setFilter({ filterString: '1' });
    fileStats = collection.getFileStatistics();
    const file1StatsFiltered = fileStats.get('test.txt');
    if (!file1StatsFiltered || file1StatsFiltered.total !== file1Stats.total) throw new Error('Total count should not change after filtering');
    if (file1StatsFiltered.visible > file1StatsFiltered.total) throw new Error('Visible should not exceed total');

    collection.clear();
    assertCounts(collection, 0, 0, 'After clear');
    if (collection.getCurrentFilter() !== '') throw new Error('Filter should be cleared');
    const clearStats = collection.getStackStatistics();
    if (clearStats.total !== 0 || clearStats.totalGoroutines !== 0) throw new Error('Statistics should be zero after clear');
  });

  // Test pinning behavior
  await test('Pinning behavior', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.multiCategory, 'test.txt');
    
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
  });

  await test('Category pin with children behavior', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.multiCategory, 'test.txt');
    
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
  });

  await test('Category ignored prefixes can be passed at init', async () => {
    const testSettings = {
      ...DEFAULT_SETTINGS,
      categoryIgnoredPrefixes: ['runtime.', 'sync.', 'test.']
    };
    
    const collection = new ProfileCollection(testSettings);
    
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
    
    const mainCategory = categories.find(c => c.name === 'main');
    if (!mainCategory) {
      const categoryNames = categories.map(c => c.name);
      throw new Error(`Should have main category. Found: ${categoryNames.join(', ')}`);
    }
  });

  await test('Category extraction pattern: prefix up to second slash OR first dot', async () => {
    const categoryTests = [
      { func: 'main.worker', expected: 'main' },
      { func: 'fmt.Printf', expected: 'fmt' },
      { func: 'package/function', expected: 'package/function' },
      { func: 'main/worker', expected: 'main/worker' },
      { func: 'github.com/user/repo.Function', expected: 'github.com/user/repo' },
      { func: 'go.uber.org/zap/zapcore.NewCore', expected: 'go.uber.org/zap/zapcore' },
      { func: 'company.com/project/service.Start', expected: 'company.com/project/service' },
      { func: 'google.golang.org/grpc.(*Server).serveStreams.func1.1', expected: 'google.golang.org/grpc' },
      { func: 'a/b/c', expected: 'a/b' },
      { func: 'a/b.c', expected: 'a/b' },
      { func: 'main.worker/helper', expected: 'main' },
      { func: 'fmt.Printf/internal', expected: 'fmt' },
      { func: 'main', expected: 'main' },
      { func: 'runtime', expected: 'runtime' },
      { func: 'worker', expected: 'worker' },
      { func: '', expected: '' },
      { func: '/', expected: '' },
      { func: '.', expected: '' },
      { func: 'a.', expected: 'a' },
      { func: 'a/', expected: 'a' },
      { func: '/a', expected: '' },
      { func: 'a//b', expected: 'a/' },
      { func: 'a..b', expected: 'a' },
    ];
    
    for (const t of categoryTests) {
      const testSettings = { ...DEFAULT_SETTINGS, categoryIgnoredPrefixes: [] };
      const collection = new ProfileCollection(testSettings);
      
      const testContent = `goroutine 1 [running]:
${t.func}()
\t/test.go:10 +0x10`;
      
      try {
        await addFile(collection, testContent, 'test.txt');
        const categories = collection.getCategories();
        
        if (categories.length === 0) {
          throw new Error(`No categories found for function: ${t.func}`);
        }
        
        const actualCategory = categories[0].name;
        if (actualCategory !== t.expected) {
          throw new Error(`Function "${t.func}": expected category "${t.expected}", got "${actualCategory}"`);
        }
      } catch (error) {
        throw error;
      }
    }
  });

  console.log('\n✅ All data model and filtering tests passed');
}

runTests().catch(console.error);