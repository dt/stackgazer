import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FileCollection } from '../dist/core/FileCollection.js';
import { StackCollection, isStdLib } from '../dist/core/StackCollection.js';
import { ViewState } from '../dist/core/ViewState.js';

// Sample stack trace data for testing
const sampleStackTrace = `
goroutine 1 [running]:
main.function1()
	/app/main.go:10 +0x123
runtime.goexit()
	/usr/local/go/src/runtime/asm_amd64.s:1594 +0x1

goroutine 2 [select, 5 minutes]:
main.function2()
	/app/helper.go:20 +0x456
created by main.function1 in goroutine 1

goroutine 3 [running]:
main.function1()
	/app/main.go:10 +0x123
runtime.goexit()
	/usr/local/go/src/runtime/asm_amd64.s:1594 +0x1

goroutine 4 [chan receive]:
main.function3()
	/app/worker.go:30 +0x789
created by main.function2 in goroutine 2
`.trim();

test('FileCollection parses stack traces correctly', () => {
  const fileCollection = new FileCollection();
  const parsedFile = fileCollection.addFileSync(sampleStackTrace, 'test.txt');
  
  assert.equal(parsedFile.goroutines.length, 4);
  assert.equal(parsedFile.name, 'test.txt');
  
  // Check first goroutine
  const goroutine1 = parsedFile.goroutines[0];
  assert.equal(goroutine1.goroutineId, '1');
  assert.equal(goroutine1.state, 'running');
  assert.equal(goroutine1.durationMinutes, 0);
  assert.ok(goroutine1.calls.length > 0);
  
  // Check structured call parsing
  const firstCall = goroutine1.calls[0];
  assert.equal(firstCall.function, 'main.function1');
  assert.equal(firstCall.args, '()');
  assert.equal(firstCall.file, '/app/main.go');
  assert.equal(firstCall.line, 10);
  
  // Check createdBy parsing for goroutine 2
  const goroutine2 = parsedFile.goroutines[1];
  assert.equal(goroutine2.goroutineId, '2');
  assert.equal(goroutine2.state, 'select');
  assert.equal(goroutine2.durationMinutes, 5);
  assert.ok(goroutine2.createdBy);
  assert.equal(goroutine2.createdBy.function, 'main.function1');
  assert.equal(goroutine2.createdBy.goroutineId, '1');
});

test('StackCollection filters at goroutine level (fixes main bug)', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Test: Filter for a specific function that only appears in some goroutines
  // Use "function1" which only appears in goroutines 1 and 3
  const filterQuery = stackCollection.setFilter('function1');
  assert.equal(filterQuery.valid, true);
  
  const visibleGoroutines = stackCollection.getVisibleGoroutines();
  
  // Should show goroutines 1, 2, and 3:
  // - 1 and 3: directly call function1
  // - 2: was created by function1 (so "function1" appears in its filterString)
  // Should NOT show goroutine 4 (calls function3, created by function2)
  assert.equal(visibleGoroutines.length, 3);
  const goroutineIds = visibleGoroutines.map(g => g.goroutineId).sort();
  assert.deepEqual(goroutineIds, ['1', '2', '3']);
});

test('StackCollection groups correctly after filtering', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Filter for "running" state - should match goroutines 1 and 3
  stackCollection.setFilter('state:running');
  
  const filteredStacks = stackCollection.getFilteredUniqueStacks();
  
  // Should have one unique stack (since goroutines 1 and 3 have identical stacks)
  assert.equal(filteredStacks.length, 1);
  
  // That unique stack should contain 2 goroutines (1 and 3)
  const uniqueStack = filteredStacks[0];
  assert.equal(uniqueStack.goroutines.length, 2);
  
  // Verify it contains the right goroutines
  const goroutineIds = uniqueStack.goroutines.map(g => g.goroutineId).sort();
  assert.deepEqual(goroutineIds, ['1', '3']);
});

test('Filter syntax parsing works correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Test various filter formats
  const simpleFilter = stackCollection.parseFilter('123');
  assert.equal(simpleFilter.valid, true);
  assert.equal(simpleFilter.terms.length, 1);
  assert.equal(simpleFilter.terms[0].field, undefined); // Text search
  assert.equal(simpleFilter.terms[0].value, '123');
  
  const stateFilter = stackCollection.parseFilter('state:running');
  assert.equal(stateFilter.valid, true);
  assert.equal(stateFilter.terms[0].field, 'state');
  assert.equal(stateFilter.terms[0].value, 'running');
  
  const durationFilter = stackCollection.parseFilter('dur:>5');
  assert.equal(durationFilter.valid, true);
  assert.equal(durationFilter.terms[0].field, 'dur');
  assert.equal(durationFilter.terms[0].operator, 'gt');
  assert.equal(durationFilter.terms[0].value, '5');
  
  const negatedFilter = stackCollection.parseFilter('-state:select');
  assert.equal(negatedFilter.valid, true);
  assert.equal(negatedFilter.terms[0].negated, true);
});

test('Pinned goroutines always visible regardless of filters', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Get a goroutine ID to pin
  const allGoroutines = stackCollection.getAllGoroutines();
  const goroutineToPin = allGoroutines[0];
  
  // Pin it
  stackCollection.toggleGoroutinePin(goroutineToPin.id);
  
  // Apply a filter that would normally hide this goroutine
  stackCollection.setFilter('state:nonexistent');
  
  const visibleGoroutines = stackCollection.getVisibleGoroutines();
  
  // The pinned goroutine should still be visible
  assert.equal(visibleGoroutines.length, 1);
  assert.equal(visibleGoroutines[0].id, goroutineToPin.id);
});

test('File visibility handled by StackCollection filtering', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Initially all goroutines should be visible
  const allGoroutines = stackCollection.getAllGoroutines();
  assert.equal(allGoroutines.length, 4);
  
  // Hide the file
  stackCollection.toggleFileVisibility('test.txt');
  
  // Now no goroutines should be visible
  const hiddenGoroutines = stackCollection.getAllGoroutines();
  assert.equal(hiddenGoroutines.length, 0);
  
  // Show the file again
  stackCollection.toggleFileVisibility('test.txt');
  
  // All goroutines should be visible again
  const visibleAgain = stackCollection.getAllGoroutines();
  assert.equal(visibleAgain.length, 4);
});

test('ViewState manages navigation and UI state', () => {
  const viewState = new ViewState();
  
  // Initially no navigation history
  assert.equal(viewState.canGoBack(), false);
  assert.equal(viewState.canGoForward(), false);
  assert.equal(viewState.getCurrentEntry(), null);
  
  // Navigate to goroutine
  viewState.navigateToGoroutine('1', 'test.txt');
  assert.equal(viewState.canGoBack(), false);
  assert.equal(viewState.getCurrentEntry().goroutineId, '1');
  
  // Navigate to another goroutine
  viewState.navigateToGoroutine('2', 'test.txt');
  assert.equal(viewState.canGoBack(), true);
  assert.equal(viewState.getCurrentEntry().goroutineId, '2');
  
  // Go back
  const didGoBack = viewState.goBack();
  assert.equal(didGoBack, true);
  assert.equal(viewState.getCurrentEntry().goroutineId, '1');
  assert.equal(viewState.canGoForward(), true);
  
  // Go forward
  const didGoForward = viewState.goForward();
  assert.equal(didGoForward, true);
  assert.equal(viewState.getCurrentEntry().goroutineId, '2');
  
  // Test highlighting
  viewState.highlightGoroutine('3');
  assert.equal(viewState.getHighlightedGoroutine(), '3');
  
  viewState.clearHighlight();
  assert.equal(viewState.getHighlightedGoroutine(), null);
  
  // Test group expansion
  assert.equal(viewState.isGroupExpanded('stack1'), false);
  viewState.expandGroup('stack1');
  assert.equal(viewState.isGroupExpanded('stack1'), true);
  
  viewState.toggleGroup('stack1');
  assert.equal(viewState.isGroupExpanded('stack1'), false);
  
  // Test arguments visibility
  assert.equal(viewState.areArgumentsHidden(), false);
  viewState.toggleArguments();
  assert.equal(viewState.areArgumentsHidden(), true);
});

test('ViewState serialization only saves UI preferences', () => {
  const viewState = new ViewState();
  
  // Set up some state (navigation, highlights, expanded groups, and preferences)
  viewState.navigateToGoroutine('1', 'test.txt');
  viewState.navigateToGoroutine('2', 'test.txt');
  viewState.highlightGoroutine('3');
  viewState.expandGroup('stack1');
  viewState.toggleArguments(); // This should be preserved
  
  // Serialize
  const serialized = viewState.serialize();
  
  // Create new instance and deserialize
  const newViewState = new ViewState();
  newViewState.deserialize(serialized);
  
  // Verify only UI preferences were restored (not session-specific data)
  assert.equal(newViewState.getCurrentEntry(), null); // Navigation not restored
  assert.equal(newViewState.canGoBack(), false); // Navigation not restored
  assert.equal(newViewState.getHighlightedGoroutine(), null); // Highlights not restored
  assert.equal(newViewState.isGroupExpanded('stack1'), false); // Expanded groups not restored
  assert.equal(newViewState.areArgumentsHidden(), true); // UI preferences ARE restored
});

test('isDuplicateFile correctly detects duplicate files', () => {
  const fileCollection = new FileCollection();
  
  // Add the first file
  const file1 = fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  // Verify the goroutine map was created
  assert.equal(file1.goroutineMap.size, 4);
  assert.ok(file1.goroutineMap.has('1'));
  assert.ok(file1.goroutineMap.has('2'));
  assert.ok(file1.goroutineMap.has('3'));
  assert.ok(file1.goroutineMap.has('4'));
  
  // Parse the same content again (should be detected as duplicate)
  const fileCollection2 = new FileCollection();
  const duplicateGoroutines = fileCollection2.addFileSync(sampleStackTrace, 'temp.txt').goroutines;
  
  // Check if it would be detected as duplicate against file1
  const isDuplicate = fileCollection.isDuplicateFile(duplicateGoroutines);
  assert.equal(isDuplicate, true);
  
  // Create a file with different content (missing one goroutine)
  const partialStackTrace = sampleStackTrace.split('\n\n').slice(0, 3).join('\n\n'); // Only first 3 goroutines
  const partialGoroutines = fileCollection2.addFileSync(partialStackTrace, 'temp2.txt').goroutines;
  
  const isNotDuplicate = fileCollection.isDuplicateFile(partialGoroutines);
  assert.equal(isNotDuplicate, false); // Different size, so not duplicate
  
  // Create a file with same number of goroutines but different content
  const modifiedStackTrace = sampleStackTrace.replace('goroutine 1 [running]:', 'goroutine 1 [waiting]:');
  const modifiedGoroutines = fileCollection2.addFileSync(modifiedStackTrace, 'temp3.txt').goroutines;
  
  const isNotDuplicate2 = fileCollection.isDuplicateFile(modifiedGoroutines);
  assert.equal(isNotDuplicate2, false); // Same size but different fingerprints
});

// Additional sample stack trace for filter testing
const secondStackTrace = `
goroutine 10 [running]:
main.function1()
	/app/main.go:10 +0x123
runtime.goexit()
	/usr/local/go/src/runtime/asm_amd64.s:1594 +0x1

goroutine 11 [select, 3 minutes]:
main.differentFunction()
	/app/other.go:15 +0x789
created by main.function1 in goroutine 10

goroutine 12 [chan send]:
main.yetAnotherFunction()
	/app/sender.go:25 +0xabc
created by main.differentFunction in goroutine 11
`.trim();

// Stack trace with newer format that includes file/line in creator info
const stackTraceWithCreatorLocation = `
goroutine 100 [running]:
main.worker()
	/app/worker.go:45 +0x234
created by main.startWorker
	/app/main.go:20 +0x100

goroutine 101 [chan receive]:
main.listener()
	/app/listener.go:30 +0x567
created by main.startListener
	/app/main.go:25 +0x200
`.trim();

test('Adding file with existing filter - matches some goroutines', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Set a filter that matches some goroutines in the first file
  stackCollection.setFilter('function1');
  
  // Verify initial state - should match goroutines 1, 2, 3 from first file
  let visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 3);
  
  // Add second file - goroutines 10, 11 should match (both call or created by function1)
  // goroutine 12 should not match (calls yetAnotherFunction, created by differentFunction)
  fileCollection.addFileSync(secondStackTrace, 'test2.txt');
  stackCollection.invalidateDataCaches();
  
  // Check that filter still works with new file
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 5); // 3 from first + 2 from second file
  
  const goroutineIds = visibleGoroutines.map(g => g.goroutineId).sort();
  assert.deepEqual(goroutineIds, ['test1#1', 'test1#2', 'test1#3', 'test2#10', 'test2#11']);
});

test('Adding file with existing filter - matches all goroutines', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Set a filter that matches all goroutines (text search for "main" which appears in all function names)
  stackCollection.setFilter('main');
  
  // Verify initial state - should match all goroutines
  let visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 4);
  
  // Add second file - all new goroutines should also match
  fileCollection.addFileSync(secondStackTrace, 'test2.txt');
  stackCollection.invalidateDataCaches();
  
  // Check that all goroutines are visible
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 7); // 4 from first + 3 from second file
  
  const goroutineIds = visibleGoroutines.map(g => g.goroutineId).sort();
  assert.deepEqual(goroutineIds, ['test1#1', 'test1#2', 'test1#3', 'test1#4', 'test2#10', 'test2#11', 'test2#12']);
});

test('Adding file with existing filter - matches none of new goroutines', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Set a filter that only matches goroutines in the first file
  stackCollection.setFilter('function3'); // Only matches goroutine 4 in first file
  
  // Verify initial state - should match only goroutine 4
  let visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 1);
  assert.equal(visibleGoroutines[0].goroutineId, '4');
  
  // Add second file - none of the new goroutines call function3
  fileCollection.addFileSync(secondStackTrace, 'test2.txt');
  stackCollection.invalidateDataCaches();
  
  // Check that only the original goroutine is still visible (now with prefix)
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 1);
  assert.equal(visibleGoroutines[0].goroutineId, 'test1#4');
});

test('Adding file with state filter - mixed matching', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Set a state filter
  stackCollection.setFilter('state:running');
  
  // Verify initial state - should match goroutines 1 and 3
  let visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 2);
  
  // Add second file - only goroutine 10 is running
  fileCollection.addFileSync(secondStackTrace, 'test2.txt');
  stackCollection.invalidateDataCaches();
  
  // Check that we now have 3 running goroutines
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 3);
  
  const goroutineIds = visibleGoroutines.map(g => g.goroutineId).sort();
  assert.deepEqual(goroutineIds, ['test1#1', 'test1#3', 'test2#10']);
});

test('Cache invalidation works correctly when adding files', () => {
  const fileCollection = new FileCollection();
  fileCollection.addFileSync(sampleStackTrace, 'test1.txt');
  
  const stackCollection = new StackCollection(fileCollection);
  
  // Set a filter and get initial results
  stackCollection.setFilter('state:running');
  let visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 2);
  
  // Add new file but forget to invalidate caches (simulating the bug)
  fileCollection.addFileSync(secondStackTrace, 'test2.txt');
  // Don't call stackCollection.invalidateDataCaches();
  
  // Without cache invalidation, should still show old results
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 2); // Still old cached results
  
  // Now invalidate caches - should pick up new data
  stackCollection.invalidateDataCaches();
  visibleGoroutines = stackCollection.getVisibleGoroutines();
  assert.equal(visibleGoroutines.length, 3); // Now includes new running goroutine
});

test('CreatedBy information includes location data', () => {
  const fileCollection = new FileCollection();
  
  // Test old format (inline goroutine ID)
  const oldFormatFile = fileCollection.addFileSync(sampleStackTrace, 'old-format.txt');
  const goroutine2 = oldFormatFile.goroutines.find(g => g.goroutineId === '2');
  assert.ok(goroutine2);
  assert.ok(goroutine2.createdBy);
  assert.equal(goroutine2.createdBy.function, 'main.function1');
  assert.equal(goroutine2.createdBy.goroutineId, '1');
  assert.equal(goroutine2.createdBy.file, 'unknown'); // Old format doesn't have location
  assert.equal(goroutine2.createdBy.line, 0);
  
  // Test new format (with location)
  const newFormatFile = fileCollection.addFileSync(stackTraceWithCreatorLocation, 'new-format.txt');
  const goroutine100 = newFormatFile.goroutines.find(g => g.goroutineId === 'new-format#100');
  assert.ok(goroutine100);
  assert.ok(goroutine100.createdBy);
  assert.equal(goroutine100.createdBy.function, 'main.startWorker');
  assert.equal(goroutine100.createdBy.file, '/app/main.go');
  assert.equal(goroutine100.createdBy.line, 20);
  
  const goroutine101 = newFormatFile.goroutines.find(g => g.goroutineId === 'new-format#101');
  assert.ok(goroutine101);
  assert.ok(goroutine101.createdBy);
  assert.equal(goroutine101.createdBy.function, 'main.startListener');
  assert.equal(goroutine101.createdBy.file, '/app/main.go');
  assert.equal(goroutine101.createdBy.line, 25);
});

// Test data for title manipulation rules
const titleManipulationStack = `
goroutine 1 [select]:
sync.runtime_Semacquire()
	GOROOT/src/runtime/sema.go:62 +0x30
sync.(*WaitGroup).Wait()
	GOROOT/src/sync/waitgroup.go:116 +0x64
golang.org/x/sync/errgroup.(*Group).Wait()
	golang.org/x/sync/errgroup/external/org_golang_x_sync/errgroup/errgroup.go:56 +0x25
github.com/cockroachdb/cockroach/pkg/util/ctxgroup.Group.Wait()
	pkg/util/ctxgroup/ctxgroup.go:139 +0x45
github.com/cockroachdb/cockroach/pkg/ccl/backupccl.distRestore()
	pkg/ccl/backupccl/restore_processor_planning.go:305 +0x123
github.com/cockroachdb/cockroach/pkg/ccl/backupccl.restore.func9()
	pkg/ccl/backupccl/restore_job.go:460 +0x456
`.trim();

test('TitleManipulator applies skip rules correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set skip rule
  stackCollection.setTitleRules(['skip:sync.runtime_Semacquire']);
  
  // Add the test stack
  fileCollection.addFileSync(titleManipulationStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should skip sync.runtime_Semacquire and use sync.(*WaitGroup).Wait
  const title = uniqueStacks[0].title;
  assert.equal(title, 'sync.(*WaitGroup).Wait');
});

test('TitleManipulator applies fold rules correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set fold rule
  stackCollection.setTitleRules(['fold:sync.(*WaitGroup).Wait->Group']);
  
  // Add the test stack
  fileCollection.addFileSync(titleManipulationStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should fold sync.(*WaitGroup).Wait and use next function with prefix
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group golang.org/x/sync/errgroup.(*Group).Wait');
});

test('TitleManipulator applies trim rules correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set trim rule
  stackCollection.setTitleRules(['trim:github.com/cockroachdb/cockroach/']);
  
  // Add the test stack
  fileCollection.addFileSync(titleManipulationStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should use first function and trim the prefix
  const title = uniqueStacks[0].title;
  assert.equal(title, 'sync.runtime_Semacquire');
});

test('TitleManipulator applies multiple rules in sequence', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set all the rules from the example
  const rules = [
    'skip:sync.runtime_Semacquire',
    'fold:sync.(*WaitGroup).Wait->Group', 
    'skip:golang.org/x/sync/errgroup.(*Group).Wait',
    'trim:github.com/cockroachdb/cockroach/'
  ];
  stackCollection.setTitleRules(rules);
  
  // Add the test stack
  fileCollection.addFileSync(titleManipulationStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Expected behavior:
  // 1. Skip sync.runtime_Semacquire
  // 2. Fold sync.(*WaitGroup).Wait (add Group prefix and skip)
  // 3. Skip golang.org/x/sync/errgroup.(*Group).Wait 
  // 4. Use github.com/cockroachdb/cockroach/pkg/util/ctxgroup.Group.Wait
  // 5. Trim prefix to get pkg/util/ctxgroup.Group.Wait
  // 6. Add prefix from fold rule to get Group pkg/util/ctxgroup.Group.Wait
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group pkg/util/ctxgroup.Group.Wait');
});

test('TitleManipulator handles edge cases', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Test with no rules
  stackCollection.setTitleRules([]);
  fileCollection.addFileSync(titleManipulationStack, 'test1.txt');
  
  let uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Without rules, should use first function
  let title = uniqueStacks[0].title;
  assert.equal(title, 'sync.runtime_Semacquire');
  
  // Test skipping all functions
  stackCollection.setTitleRules([
    'skip:sync.runtime_Semacquire',
    'skip:sync.(*WaitGroup).Wait',
    'skip:golang.org/x/sync/errgroup.(*Group).Wait',
    'skip:github.com/cockroachdb/cockroach/pkg/util/ctxgroup.Group.Wait',
    'skip:github.com/cockroachdb/cockroach/pkg/ccl/backupccl.distRestore',
    'skip:github.com/cockroachdb/cockroach/pkg/ccl/backupccl.restore.func9'
  ]);
  
  uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // When all functions are skipped, should use the last one
  title = uniqueStacks[0].title;
  assert.equal(title, 'github.com/cockroachdb/cockroach/pkg/ccl/backupccl.restore.func9');
});

test('TitleManipulator rule parsing handles invalid rules', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Test with invalid and valid rules mixed
  const rules = [
    'invalid:rule',
    'skip:valid_pattern',
    'fold:incomplete',
    'fold:valid_pattern->suffix',
    'trim:valid_prefix',
    '',
    'unknown_type:pattern'
  ];
  
  // Should not throw and should parse valid rules
  stackCollection.setTitleRules(rules);
  
  // Add test data and verify it works with valid rules
  fileCollection.addFileSync(titleManipulationStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should have processed valid rules and ignored invalid ones
  // This tests that invalid rules don't break the system
  assert.ok(uniqueStacks[0].title.length > 0);
});

test('isStdLib correctly identifies standard library functions', () => {
  // Standard library functions (should return true)
  assert.equal(isStdLib('runtime.goexit'), true);
  assert.equal(isStdLib('sync.runtime_Semacquire'), true);
  assert.equal(isStdLib('net/http.(*Server).Serve'), true);
  assert.equal(isStdLib('crypto/tls.(*Conn).Read'), true);
  assert.equal(isStdLib('encoding/json.Marshal'), true);
  assert.equal(isStdLib('reflect.ValueOf'), true);
  assert.equal(isStdLib('main.main'), false);
  assert.equal(isStdLib('fmt.Println'), true);
  assert.equal(isStdLib('context.WithCancel'), true);
  assert.equal(isStdLib('time/rate.(*Limiter).Wait'), true);
  
  // Third-party library functions (should return false)
  assert.equal(isStdLib('github.com/cockroachdb/cockroach/pkg/util.Function'), false);
  assert.equal(isStdLib('golang.org/x/sync/errgroup.(*Group).Wait'), false);
  assert.equal(isStdLib('google.golang.org/grpc.NewServer'), false);
  assert.equal(isStdLib('go.uber.org/zap.NewLogger'), false);
  assert.equal(isStdLib('example.com/mypackage.MyFunction'), false);
  assert.equal(isStdLib('internal.company.com/pkg.Function'), false);
  
  // Edge cases
  assert.equal(isStdLib(''), true); // Empty string - no dot or slash
  assert.equal(isStdLib('simple'), true); // Simple name with no dot
  assert.equal(isStdLib('main'), false); // Main package is not stdlib
  assert.equal(isStdLib('package.function'), false); // Has dot but no slash - likely third-party
  assert.equal(isStdLib('vendor/package.Function'), false); // Has dot before slash in vendor path
});

// Test data for foldstdlib rule testing
const foldstdlibTestStack = `
goroutine 1 [select]:
sync.runtime_Semacquire()
	GOROOT/src/runtime/sema.go:62 +0x30
sync.(*WaitGroup).Wait()
	GOROOT/src/sync/waitgroup.go:116 +0x64
runtime.gopark()
	GOROOT/src/runtime/proc.go:398 +0x123
time.Sleep()
	GOROOT/src/time/sleep.go:176 +0x45
github.com/cockroachdb/cockroach/pkg/util/worker.DoWork()
	pkg/util/worker/worker.go:139 +0x45
github.com/cockroachdb/cockroach/pkg/server.(*Server).Start()
	pkg/server/server.go:305 +0x123
`.trim();

test('TitleManipulator applies foldstdlib rules correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set foldstdlib rule
  stackCollection.setTitleRules(['foldstdlib:sync.(*WaitGroup).Wait->WorkerGroup']);
  
  // Add the test stack
  fileCollection.addFileSync(foldstdlibTestStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should fold sync.(*WaitGroup).Wait, skip subsequent stdlib functions (runtime.gopark, time.Sleep),
  // and use the first non-stdlib function with the replacement prefix
  const title = uniqueStacks[0].title;
  assert.equal(title, 'WorkerGroup github.com/cockroachdb/cockroach/pkg/util/worker.DoWork');
});

test('TitleManipulator foldstdlib skips only stdlib functions after fold', () => {
  // Test stack with mixed stdlib and non-stdlib functions after fold
  const mixedStack = `
goroutine 1 [select]:
sync.(*WaitGroup).Wait()
	GOROOT/src/sync/waitgroup.go:116 +0x64
runtime.gopark()
	GOROOT/src/runtime/proc.go:398 +0x123
github.com/some/package.Helper()
	github.com/some/package/helper.go:50 +0x789
time.Sleep()
	GOROOT/src/time/sleep.go:176 +0x45
main.worker()
	/app/main.go:100 +0x456
`.trim();
  
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set foldstdlib rule
  stackCollection.setTitleRules(['foldstdlib:sync.(*WaitGroup).Wait->Group']);
  
  // Add the test stack
  fileCollection.addFileSync(mixedStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should fold sync.(*WaitGroup).Wait, skip runtime.gopark (stdlib),
  // but stop at github.com/some/package.Helper (non-stdlib)
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group github.com/some/package.Helper');
});

test('TitleManipulator foldstdlib combined with other rules', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set combined rules: foldstdlib + trim
  const rules = [
    'foldstdlib:sync.(*WaitGroup).Wait->Group',
    'trim:github.com/cockroachdb/cockroach/'
  ];
  stackCollection.setTitleRules(rules);
  
  // Add the test stack
  fileCollection.addFileSync(foldstdlibTestStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should apply foldstdlib rule first, then trim rule to the resulting function
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group pkg/util/worker.DoWork');
});

test('TitleManipulator foldstdlib with no matching pattern', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set foldstdlib rule that doesn't match any function
  stackCollection.setTitleRules(['foldstdlib:nonexistent.Function->Group']);
  
  // Add the test stack
  fileCollection.addFileSync(foldstdlibTestStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should use first function since no foldstdlib rule matches
  const title = uniqueStacks[0].title;
  assert.equal(title, 'sync.runtime_Semacquire');
});

test('TitleManipulator foldstdlib rule parsing handles invalid syntax', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Test with invalid foldstdlib rules mixed with valid ones
  const rules = [
    'foldstdlib:incomplete',  // Invalid - missing replacement
    'skip:sync.runtime_Semacquire',  // Valid
    'foldstdlib:sync.(*WaitGroup).Wait->Group',  // Valid
    'foldstdlib:',  // Invalid - empty
  ];
  
  // Should not throw and should parse valid rules
  stackCollection.setTitleRules(rules);
  
  // Add test data and verify it works with valid rules
  fileCollection.addFileSync(foldstdlibTestStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should process valid rules and ignore invalid ones
  // skip:sync.runtime_Semacquire should skip first function
  // foldstdlib:sync.(*WaitGroup).Wait:Group should fold and skip stdlib
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group github.com/cockroachdb/cockroach/pkg/util/worker.DoWork');
});

// Complex stack trace for comprehensive rule testing
const complexNetworkStack = `
goroutine 1 [IO wait]:
internal/poll.runtime_pollWait()
	GOROOT/src/runtime/netpoll.go:343 +0x85
internal/poll.(*pollDesc).wait()
	GOROOT/src/internal/poll/fd_poll_runtime.go:84 +0x32
internal/poll.(*pollDesc).waitRead()
	GOROOT/src/internal/poll/fd_poll_runtime.go:89 +0x11
internal/poll.(*FD).Read()
	GOROOT/src/internal/poll/fd_unix.go:164 +0x27
net.(*netFD).Read()
	GOROOT/src/net/fd_posix.go:55 +0x29
net.(*conn).Read()
	GOROOT/src/net/net.go:185 +0x45
github.com/cockroachdb/cockroach/pkg/util/cidr.metricsConn.Read()
	pkg/util/cidr/cidr.go:519 +0x123
crypto/tls.(*atLeastReader).Read()
	GOROOT/src/crypto/tls/conn.go:805 +0x43
bytes.(*Buffer).ReadFrom()
	GOROOT/src/bytes/buffer.go:211 +0x31
crypto/tls.(*Conn).readFromUntil()
	GOROOT/src/crypto/tls/conn.go:827 +0x87
crypto/tls.(*Conn).readRecordOrCCS()
	GOROOT/src/crypto/tls/conn.go:676 +0x116
crypto/tls.(*Conn).readRecord()
	GOROOT/src/crypto/tls/conn.go:587 +0x30
crypto/tls.(*Conn).Read()
	GOROOT/src/crypto/tls/conn.go:1369 +0x39
net/http.(*persistConn).Read()
	GOROOT/src/net/http/transport.go:1954 +0x105
bufio.(*Reader).Read()
	GOROOT/src/bufio/bufio.go:230 +0x42
io.(*LimitedReader).Read()
	GOROOT/src/io/io.go:480 +0x3c
net/http.(*body).readLocked()
	GOROOT/src/net/http/transfer.go:839 +0x56
net/http.(*body).Read()
	GOROOT/src/net/http/transfer.go:831 +0x49
net/http.(*bodyEOFSignal).Read()
	GOROOT/src/net/http/transport.go:2824 +0x6f
github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob.(*RetryReader).Read()
	github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob/external/com_github_azure_azure_sdk_for_go_sdk_storage_azblob/blob/retry_reader.go:122 +0x234
github.com/cockroachdb/cockroach/pkg/util/ioctx.ioReadCloserAdapter.Read()
	pkg/util/ioctx/reader.go:93 +0x45
`.trim();

test('TitleManipulator applies complex rule combinations correctly', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set all the comprehensive rules
  const rules = [
    'skip:sync.runtime_Semacquire',
    'fold:sync.(*WaitGroup).Wait->Group',
    'skip:golang.org/x/sync/errgroup.(*Group).Wait',
    'foldstdlib:net/http->HTTP',
    'foldstdlib:internal/poll.runtime_pollWait->netpoll',
    'skip:github.com/cockroachdb/cockroach/pkg/util/cidr.metricsConn.Read',
    'trim:github.com/cockroachdb/cockroach/'
  ];
  stackCollection.setTitleRules(rules);
  
  // Add the complex network stack
  fileCollection.addFileSync(complexNetworkStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Expected behavior:
  // 1. First function is internal/poll.runtime_pollWait -> matches foldstdlib rule
  // 2. Add "netpoll" prefix and enable stdlib skipping
  // 3. Skip all subsequent stdlib functions (internal/poll, net, crypto/tls, net/http, bufio, io)
  // 4. Skip github.com/cockroachdb/cockroach/pkg/util/cidr.metricsConn.Read (skip rule)
  // 5. Continue skipping stdlib functions
  // 6. First non-stdlib function is github.com/Azure/azure-sdk-for-go/... (not skipped)
  // 7. Use that function as the title with netpoll prefix
  const title = uniqueStacks[0].title;
  assert.equal(title, 'netpoll github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob.(*RetryReader).Read');
});

test('TitleManipulator multiple foldstdlib rules - first match wins', () => {
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Test with multiple foldstdlib rules where the first should match
  const rules = `skip:sync.runtime_Semacquire
fold:sync.(*WaitGroup).Wait->Group
skip:golang.org/x/sync/errgroup.(*Group).Wait
foldstdlib:net/http->HTTP
foldstdlib:internal/poll.runtime_pollWait->netpoll
skip:github.com/cockroachdb/cockroach/pkg/util/cidr.metricsConn.Read
trim:github.com/cockroachdb/cockroach/`.split('\n');
  stackCollection.setTitleRules(rules);
  
  // Add the complex network stack
  fileCollection.addFileSync(complexNetworkStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should use the first matching foldstdlib rule (internal/poll->netpoll)
  // and skip stdlib until reaching Azure SDK function
  const title = uniqueStacks[0].title;
  assert.equal(title, 'netpoll github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob.(*RetryReader).Read');
});

test('TitleManipulator accumulates prefixes from multiple fold rules', () => {
  // Test stack with multiple functions that should each add a prefix
  const multiPrefixStack = `
goroutine 1 [select]:
sync.(*WaitGroup).Wait()
\tGOROOT/src/sync/waitgroup.go:116 +0x64
net/http.(*Server).Serve()
\tGOROOT/src/net/http/server.go:3071 +0x123
github.com/cockroachdb/cockroach/pkg/server.(*Server).Start()
\tpkg/server/server.go:305 +0x456
`.trim();
  
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set rules that should each add a prefix
  const rules = [
    'fold:sync.(*WaitGroup).Wait->Group',
    'fold:net/http.(*Server).Serve->HTTP',
    'trim:github.com/cockroachdb/cockroach/'
  ];
  stackCollection.setTitleRules(rules);
  
  // Add the test stack
  fileCollection.addFileSync(multiPrefixStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should accumulate both prefixes: "Group HTTP pkg/server.(*Server).Start"
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group HTTP pkg/server.(*Server).Start');
});

test('TitleManipulator accumulates prefixes from mixed fold and foldstdlib rules', () => {
  // Test stack with both fold and foldstdlib rules
  const mixedRulesStack = `
goroutine 1 [select]:
sync.(*WaitGroup).Wait()
\tGOROOT/src/sync/waitgroup.go:116 +0x64
net/http.(*Server).Serve()
\tGOROOT/src/net/http/server.go:3071 +0x123
bufio.(*Reader).Read()
\tGOROOT/src/bufio/bufio.go:230 +0x42
io.(*LimitedReader).Read()
\tGOROOT/src/io/io.go:480 +0x3c
github.com/cockroachdb/cockroach/pkg/server.(*Server).Start()
\tpkg/server/server.go:305 +0x456
`.trim();
  
  const fileCollection = new FileCollection();
  const stackCollection = new StackCollection(fileCollection);
  
  // Set mixed rules: fold + foldstdlib
  const rules = [
    'fold:sync.(*WaitGroup).Wait->Group',
    'foldstdlib:net/http->HTTP',
    'trim:github.com/cockroachdb/cockroach/'
  ];
  stackCollection.setTitleRules(rules);
  
  // Add the test stack
  fileCollection.addFileSync(mixedRulesStack, 'test.txt');
  
  const uniqueStacks = stackCollection.getUniqueStacks();
  assert.equal(uniqueStacks.length, 1);
  
  // Should accumulate: "Group" (from fold) + "HTTP" (from foldstdlib)
  // Then skip stdlib and find first non-stdlib function
  const title = uniqueStacks[0].title;
  assert.equal(title, 'Group HTTP pkg/server.(*Server).Start');
});

console.log('All tests passed! 🎉');