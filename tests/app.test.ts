/**
 * Comprehensive, table-driven test suite for ProfileCollection and Parser
 * Maximizes coverage with minimal, readable code
 */

import { ProfileCollection } from '../src/app/ProfileCollection.ts';
import { SettingsManager } from '../src/app/SettingsManager.ts';
import { FileParser, ZipHandler } from '../src/parser/index.js';
import JSZip from 'jszip';
import { TEST_DATA, DEFAULT_SETTINGS, test } from './shared-test-data.js';

// Mock localStorage for SettingsManager tests
(global as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const parser = new FileParser();

async function addFile(collection: ProfileCollection, content: string, name: string, customName?: string) {
  const result = await parser.parseFile(content, name);
  if (!result.success) throw new Error('Parse failed');
  collection.addFile(result.data, customName);
  return collection;
}

// Comprehensive table-driven tests
const testCases = {
  // Core functionality tests
  fileOperations: [
    { name: 'Empty collection', files: [], expectStacks: 0, expectFiles: 0 },
    { name: 'Single file', files: [{ content: TEST_DATA.format2, name: 'test.txt' }], expectStacks: 2, expectFiles: 1 },
    { name: 'Multi-file', files: [{ content: TEST_DATA.format2, name: 'f1.txt' }, { content: TEST_DATA.format1, name: 'f2.txt' }], expectStacks: 2, expectFiles: 2 },
    { name: 'Custom name', files: [{ content: TEST_DATA.format2, name: 'test.txt', customName: 'custom.txt' }], expectStacks: 2, expectFiles: 1, expectFileName: 'custom.txt' },
  ],

  // Parser tests
  parsing: [
    { name: 'Format1', content: TEST_DATA.format1, expect: { groups: 3, total: 4 } },
    { name: 'Format2', content: TEST_DATA.format2, expect: { groups: 3, total: 4 } },
    { name: 'Empty', content: '', expect: { groups: 0, total: 0 } },
    { name: 'Malformed', content: 'invalid', expect: { groups: 0, total: 0 } },
  ],

  // Filtering tests
  filtering: [
    { filter: '', expectStacks: 2, expectGoroutines: 3, desc: 'No filter shows all' },
    { filter: 'select', expectStacks: 1, expectGoroutines: 1, desc: 'State filter' },
    { filter: 'worker', expectStacks: 1, expectGoroutines: 2, desc: 'Function filter' },
    { filter: '2', expectStacks: 1, expectGoroutines: 1, desc: 'ID filter' },
    { filter: 'xyz123', expectStacks: 0, expectGoroutines: 0, desc: 'No matches' },
  ],

  // Settings integration tests
  settingsIntegration: [
    {
      name: 'Combined rules',
      settings: {
        useDefaultNameSkipRules: true,
        customNameSkipRules: 'custom.skip',
        useDefaultNameTrimRules: true,
        customNameTrimRules: 'custom/',
        useDefaultNameFoldRules: true,
        customNameFoldRules: 's|custom|CUSTOM|',
        useDefaultNameFindRules: true,
        customNameFindRules: 'f|findme|FOUND|while:find',
      },
      validateCombined: true,
    },
    {
      name: 'Text trim rules',
      settings: { customNameTrimRules: 'util/\ns|^rpc\\.makeInternalClientAdapter\\..*$|rpc|' },
      content: `goroutine 1 [running]:
util/admission.(*WorkQueue).Admit()
\tutil/admission/work_queue.go:100 +0x10
rpc.makeInternalClientAdapter.func1()
\trpc/internal_client.go:100 +0x20`,
      expectedName: 'rpc.makeInternalClientAdapter → AC',
    },
  ],

  // Creator existence tests
  creatorTests: [
    { id: '1', expectCreator: '', expectExists: false },
    { id: '3', expectCreator: '1', expectExists: true },
    { id: '4', expectCreator: '1', expectExists: true },
  ],

  // State transformation tests
  stateTransforms: [
    { state: 'sync.Mutex.Lock', expected: 'semacquire' },
    { state: 'sync.WaitGroup.Wait', expected: 'wait' },
    { state: 'sync.Cond.Wait', expected: 'wait' },
  ],

  // Category extraction tests
  categoryExtraction: [
    { func: 'main.worker', expected: 'main' },
    { func: 'fmt.Printf', expected: 'fmt' },
    { func: 'github.com/user/repo.Function', expected: 'github' },
    { func: 'a/b/c', expected: 'a/b' },
    { func: 'a/b.c', expected: 'a/b' },
    { func: 'main', expected: 'main' },
    { func: '', expected: '' },
  ],
};

async function runTests() {
  console.log('🧪 Comprehensive Test Suite');

  // File operations
  await test('File operations', async () => {
    for (const t of testCases.fileOperations) {
      const collection = new ProfileCollection(DEFAULT_SETTINGS);
      for (const file of t.files) {
        await addFile(collection, file.content, file.name, file.customName);
      }

      const stacks = collection.getCategories().reduce((acc, x) => acc + x.stacks.length, 0);
      if (stacks !== t.expectStacks || collection.getFileNames().length !== t.expectFiles) {
        throw new Error(`${t.name}: expected ${t.expectStacks}/${t.expectFiles}, got ${stacks}/${collection.getFileNames().length}`);
      }

      if (t.expectFileName && collection.getFileNames()[0] !== t.expectFileName) {
        throw new Error(`${t.name}: expected filename ${t.expectFileName}`);
      }
    }
  });

  // Parser functionality
  await test('Parser functionality', async () => {
    for (const t of testCases.parsing) {
      const r = await parser.parseFile(t.content, t.name);
      if (!r.success && t.expect.groups > 0) throw new Error(`${t.name}: parse failed`);

      if (r.success) {
        const total = r.data.groups.reduce((sum, g) => sum + g.count, 0);
        if (r.data.groups.length !== t.expect.groups || total !== t.expect.total) {
          throw new Error(`${t.name}: expected ${t.expect.groups}/${t.expect.total}, got ${r.data.groups.length}/${total}`);
        }
      }
    }
  });

  // Creator existence logic
  await test('Creator existence', async () => {
    const r = await parser.parseFile(TEST_DATA.format2, 'test.txt');
    if (!r.success) throw new Error('Parse failed');

    const goroutines = r.data.groups.flatMap((g: any) => g.goroutines);
    for (const t of testCases.creatorTests) {
      const g = goroutines.find((g: any) => g.id === t.id);
      if (!g || g.creator !== t.expectCreator || g.creatorExists !== t.expectExists) {
        throw new Error(`Goroutine ${t.id}: expected creator="${t.expectCreator}" exists=${t.expectExists}`);
      }
    }
  });

  // State transformations
  await test('State transformations', async () => {
    for (const t of testCases.stateTransforms) {
      const content = `goroutine 1 [${t.state}]:
main.worker()
\t/main.go:10 +0x10`;
      
      const r = await parser.parseFile(content, 'test.txt');
      if (!r.success) throw new Error('Parse failed');
      
      const goroutine = r.data.groups[0].goroutines[0];
      if (goroutine.state !== t.expected) {
        throw new Error(`State ${t.state}: expected ${t.expected}, got ${goroutine.state}`);
      }
    }
  });

  // Filtering functionality
  await test('Filtering', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.multiCategory, 'test.txt'); // Use multiCategory for proper test data

    for (const t of testCases.filtering) {
      collection.setFilter({ filterString: t.filter });
      const stats = collection.getStackStatistics();
      if (stats.visible !== t.expectStacks || stats.visibleGoroutines !== t.expectGoroutines) {
        throw new Error(`${t.desc}: expected ${t.expectStacks}/${t.expectGoroutines}, got ${stats.visible}/${stats.visibleGoroutines}`);
      }
    }
  });

  // Settings integration
  await test('Settings integration', async () => {
    for (const t of testCases.settingsIntegration) {
      const settingsManager = new SettingsManager(t.settings);
      
      if (t.validateCombined) {
        const skip = settingsManager.getCombinedNameSkipRules();
        const trim = settingsManager.getCombinedNameTrimRules();
        const fold = settingsManager.getCombinedNameFoldRules();
        const find = settingsManager.getCombinedNameFindRules();
        
        if (!skip.includes('custom.skip') || !fold.includes('CUSTOM') || !find.includes('FOUND')) {
          throw new Error(`${t.name}: Combined rules not working`);
        }
      }
      
      if (t.content && t.expectedName) {
        const collection = new ProfileCollection({
          ...DEFAULT_SETTINGS,
          titleManipulationRules: settingsManager.getTitleManipulationRules(),
        });
        
        await addFile(collection, t.content, 'test.txt');
        const stackName = collection.getCategories()[0].stacks[0].name;
        
        if (stackName !== t.expectedName) {
          throw new Error(`${t.name}: expected '${t.expectedName}', got '${stackName}'`);
        }
      }
    }
  });

  // Category extraction
  await test('Category extraction', async () => {
    for (const t of testCases.categoryExtraction) {
      const collection = new ProfileCollection({ ...DEFAULT_SETTINGS, categoryIgnoredPrefixes: [] });
      const content = `goroutine 1 [running]:
${t.func}()
\t/test.go:10 +0x10`;
      
      await addFile(collection, content, 'test.txt');
      const categories = collection.getCategories();
      
      if (categories.length === 0 && t.expected !== '') {
        throw new Error(`Function "${t.func}": no categories found`);
      }
      
      if (categories.length > 0) {
        const actualCategory = categories[0].name;
        if (actualCategory !== t.expected) {
          throw new Error(`Function "${t.func}": expected "${t.expected}", got "${actualCategory}"`);
        }
      }
    }
  });

  // Method coverage tests
  await test('Method coverage', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    // Filter lifecycle
    collection.setFilter({ filterString: '4' });
    if (collection.getCurrentFilter() !== '4') throw new Error('getCurrentFilter failed');
    
    collection.clearFilter();
    if (collection.getCurrentFilter() !== '') throw new Error('clearFilter failed');

    // Goroutine lookup
    const goroutine = collection.lookupGoroutine('4');
    if (!goroutine || goroutine.id !== '4') throw new Error('lookupGoroutine failed');
    if (collection.lookupGoroutine('999')) throw new Error('Should not find nonexistent goroutine');

    // File/state statistics with multi-file setup
    await addFile(collection, TEST_DATA.format1, 'file2.txt');
    const fileStats = collection.getFileStatistics();
    if (fileStats.size !== 2) throw new Error('getFileStatistics failed');
    
    const stateStats = collection.getStateStatistics();
    if (stateStats.size === 0) throw new Error('getStateStatistics failed');

    // Test state statistics with filter
    collection.setFilter({ filterString: 'select' });
    const filteredStats = collection.getStateStatistics();
    const selectStats = filteredStats.get('select');
    if (!selectStats || selectStats.visible === 0) throw new Error('Filtered state stats failed');

    // Pinning
    const stack = collection.getCategories()[0].stacks[0];
    const group = stack.files[0].groups[0];
    const category = collection.getCategories()[0];
    
    if (collection.toggleStackPin(stack.id) !== true) throw new Error('Stack pin failed');
    if (collection.toggleGroupPin(group.id) !== true) throw new Error('Group pin failed');
    if (collection.toggleCategoryPinWithChildren(category.id) !== true) throw new Error('Category pin failed');
    
    // Test pinned visibility with non-matching filter
    collection.setFilter({ filterString: 'nonexistent' });
    if (stack.counts.matches === 0) throw new Error('Pinned stack should be visible');
    if (group.counts.matches === 0) throw new Error('Pinned group should be visible');
    
    // Unpin (category unpin with children will unpin everything)
    if (collection.toggleCategoryPinWithChildren(category.id) !== false) throw new Error('Category unpin failed');

    // File operations
    if (!collection.removeFile('file2.txt')) throw new Error('Remove file failed');
    collection.renameFile('test.txt', 'renamed.txt', false);
    if (!collection.getFileNames().includes('renamed.txt')) throw new Error('Rename file failed');

    // Clear filter changes
    collection.setFilter({ filterString: 'test' });
    collection.clearFilterChanges();

    // Clear
    collection.clear();
    if (collection.getCategories().length !== 0) throw new Error('clear failed');
  });

  // Complete pinning methods for 100% coverage
  await test('Complete pinning methods', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    const stack = collection.getCategories()[0].stacks[0];
    const group = stack.files[0].groups[0];
    const goroutines = group.goroutines;
    const firstGoroutine = goroutines[0];
    
    // Test individual goroutine pinning
    if (collection.toggleGoroutinePin(firstGoroutine.id) !== true) throw new Error('Goroutine pin failed');
    if (collection.toggleGoroutinePin('nonexistent') !== false) throw new Error('Non-existent goroutine should return false');
    collection.toggleGoroutinePin(firstGoroutine.id); // unpin
    
    // Test toggleGroupPin with non-existent group (lines 1328-1329)
    if (collection.toggleGroupPin('nonexistent-group') !== false) throw new Error('Non-existent group should return false');
    
    // Test toggleStackPinWithChildren (lines 1356-1374)
    if (collection.toggleStackPinWithChildren(stack.id) !== false) throw new Error('toggleStackPinWithChildren should return false');
    if (!stack.pinned) throw new Error('Stack should be pinned');
    if (!group.pinned) throw new Error('Group should be pinned');
    if (!goroutines.every(g => g.pinned)) throw new Error('All goroutines should be pinned');
    
    // Unpin via toggleStackPinWithChildren
    if (collection.toggleStackPinWithChildren(stack.id) !== false) throw new Error('toggleStackPinWithChildren should return false');
    if (stack.pinned) throw new Error('Stack should be unpinned');
    if (group.pinned) throw new Error('Group should be unpinned');
    if (goroutines.some(g => g.pinned)) throw new Error('No goroutines should be pinned');
    
    // Test toggleGroupPinWithChildren with non-existent group (lines 1397-1398)
    if (collection.toggleGroupPinWithChildren('nonexistent-group') !== false) throw new Error('Non-existent group should return false');
    
    // Test standard group pin with children
    if (collection.toggleGroupPinWithChildren(group.id) !== true) throw new Error('Group pin with children failed');
    if (!goroutines.every(g => g.pinned)) throw new Error('All goroutines should be pinned');
    collection.toggleGroupPinWithChildren(group.id); // unpin
    
    // Test unpinAllItems method
    collection.toggleStackPin(stack.id);
    collection.toggleGroupPin(group.id);
    collection.unpinAllItems();
    if (collection.hasAnyPinnedItems()) throw new Error('Should have no pinned items after unpinAll');
    
    // Test updateSettings method (lines 1029-1051)
    const originalStackCount = collection.getCategories().reduce((acc, cat) => acc + cat.stacks.length, 0);
    collection.updateSettings({
      ...DEFAULT_SETTINGS,
      titleManipulationRules: [{ trim: 'main.' }]
    });
    const newStackCount = collection.getCategories().reduce((acc, cat) => acc + cat.stacks.length, 0);
    if (newStackCount !== originalStackCount) throw new Error('Stack count should remain same after updateSettings');
    
    // Test updateTitleRules method (lines 1018-1023)
    collection.updateTitleRules([{ fold: 'main.worker', to: 'worker' }]);
    
    // Test toggleCategoryPin method (lines 1292-1298)
    const category = collection.getCategories()[0];
    if (collection.toggleCategoryPin(category.id) !== true) throw new Error('Category pin should return true');
    if (!category.pinned) throw new Error('Category should be pinned');
    if (collection.toggleCategoryPin(category.id) !== false) throw new Error('Category unpin should return false');
    if (collection.toggleCategoryPin('nonexistent') !== false) throw new Error('Non-existent category should return false');
  });

  // Pinned stack visibility edge case (lines 1244-1249)
  await test('Pinned stack visibility edge case', async () => {
    const collection = new ProfileCollection(DEFAULT_SETTINGS);
    await addFile(collection, TEST_DATA.format2, 'test.txt');

    const stack = collection.getCategories()[0].stacks[0];
    
    // Pin the stack
    collection.toggleStackPin(stack.id);
    
    // Apply a filter that matches nothing, which should trigger the pinned stack visibility logic
    collection.setFilter({ filterString: 'nonexistenttextthatshouldmatchnothing' });
    
    // The pinned stack should be visible even though filter matches nothing
    if (stack.counts.matches === 0) throw new Error('Pinned stack should be visible with non-matching filter');
    if (stack.counts.minMatchingWait !== stack.counts.minWait) throw new Error('Matching wait bounds should be copied');
    if (stack.counts.maxMatchingWait !== stack.counts.maxWait) throw new Error('Matching wait bounds should be copied');
  });

  // Zip extraction
  await test('Zip extraction', async () => {
    const zip = new JSZip();
    zip.file('stacks.txt', TEST_DATA.format2);
    zip.file('subdir/stacks.txt', TEST_DATA.format2);
    zip.file('other.txt', 'not a stack file');

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const mockFile = new File([zipBuffer], 'test.zip', { type: 'application/zip' });

    const result = await ZipHandler.extractFiles(mockFile);
    if (result.files.length !== 2) {
      throw new Error(`Expected 2 stacks.txt files, got ${result.files.length}`);
    }
  });

  // Parser 100% coverage tests
  await test('Parser 100% coverage', async () => {
    // Test invalid JSON in labels (line 319-320)
    const invalidJson = await parser.parseFile('1 @ 0x1000\n# labels: {broken json}\n#\t0x1000\tmain\tmain.go:1', 'test');
    if (invalidJson.success || !invalidJson.error?.includes('Failed to parse labels')) {
      throw new Error('Should fail on invalid JSON');
    }
    
    // Test valid parsing to ensure coverage
    const validResult = await parser.parseFile('goroutine 1 [running]:\nmain()\n\tmain.go:1 +0x1', 'test.txt');
    if (!validResult.success) throw new Error('Valid parse should succeed');
  });

  // SettingsManager comprehensive coverage
  await test('SettingsManager comprehensive', async () => {
    const settings = new SettingsManager({
      useDefaultNameSkipRules: false,
      customNameSkipRules: '',
      useDefaultNameTrimRules: false, 
      customNameTrimRules: '',
      useDefaultNameFoldRules: false,
      customNameFoldRules: '',
      useDefaultNameFindRules: false,
      customNameFindRules: '',
    });
    
    // Test empty combined rules
    if (settings.getCombinedNameSkipRules() !== '') throw new Error('Empty skip rules failed');
    if (settings.getCombinedNameTrimRules() !== '') throw new Error('Empty trim rules failed');
    if (settings.getCombinedNameFoldRules() !== '') throw new Error('Empty fold rules failed');
    if (settings.getCombinedNameFindRules() !== '') throw new Error('Empty find rules failed');
    
    // Test defaults only
    settings.updateSettings({ useDefaultNameSkipRules: true });
    if (!settings.getCombinedNameSkipRules().includes('sync.runtime')) throw new Error('Default skip rules failed');
    
    // Test custom only
    settings.updateSettings({ 
      useDefaultNameSkipRules: false,
      customNameSkipRules: 'custom.skip'
    });
    if (settings.getCombinedNameSkipRules() !== 'custom.skip') throw new Error('Custom only skip rules failed');
  });

  console.log('\n✅ All comprehensive tests passed');
}

runTests().catch(console.error);