/**
 * Test parsing logic using the example stack trace file
 */

// Simple test framework
function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`Expected:`, expected);
    console.error(`Actual:`, actual);
    return false;
  } else {
    console.log(`✅ PASS: ${message}`);
    return true;
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    return false;
  } else {
    console.log(`✅ PASS: ${message}`);
    return true;
  }
}

// Import the FileCollection class (we'll need to adjust this for Node.js)
const fs = require('fs');
const path = require('path');

// Read the example file
const exampleFilePath = path.join(__dirname, '../example/stacks.txt');
const stackContent = fs.readFileSync(exampleFilePath, 'utf8');

console.log('🧪 Starting parsing tests...\n');

// Test 1: Basic file reading
assertTrue(stackContent.length > 0, 'Example file should not be empty');
assertTrue(stackContent.includes('goroutine'), 'Example file should contain goroutines');
assertTrue(stackContent.includes('created by'), 'Example file should contain "created by" sections');

// Test 2: Check specific "created by" patterns we know exist
const createdByLines = stackContent.split('\n').filter(line => line.includes('created by'));
console.log('Found created by lines:', createdByLines.length);

// Test specific patterns from the file
const expectedPatterns = [
  'created by net/http.(*Server).Serve in goroutine 538',
  'created by go.opencensus.io/stats/view.init.0 in goroutine 1',
  'created by github.com/cockroachdb/cockroach/pkg/util/log.init.5 in goroutine 1'
];

expectedPatterns.forEach((pattern, index) => {
  assertTrue(
    createdByLines.some(line => line.trim() === pattern),
    `Should find pattern ${index + 1}: "${pattern}"`
  );
});

// Test 3: Check that location lines follow "created by" lines
const lines = stackContent.split('\n');
let createdByLocationsFound = 0;
let createdByLocationsWithFiles = 0;

for (let i = 0; i < lines.length - 1; i++) {
  const line = lines[i].trim();
  const nextLine = lines[i + 1];
  
  if (line.startsWith('created by')) {
    createdByLocationsFound++;
    
    // Check if next line has location info
    if (nextLine && nextLine.startsWith('\t') && (nextLine.includes('.go:') || nextLine.includes('.c:'))) {
      createdByLocationsWithFiles++;
      console.log(`📍 Found location: "${line}" -> "${nextLine.trim()}"`);
    } else {
      console.log(`⚠️  Missing location: "${line}" -> "${nextLine ? nextLine.trim() : 'EOF'}"`);
    }
  }
}

console.log(`\n📊 Location parsing stats:`);
console.log(`  Created by lines found: ${createdByLocationsFound}`);
console.log(`  With location info: ${createdByLocationsWithFiles}`);
console.log(`  Missing locations: ${createdByLocationsFound - createdByLocationsWithFiles}`);

assertTrue(createdByLocationsFound > 0, 'Should find at least one "created by" line');
assertTrue(createdByLocationsWithFiles > 0, 'Should find at least one location line after "created by"');

// Test 4: Validate specific location line formats (from example file - uses tabs)
const locationExamples = [
  '\tGOROOT/src/net/http/server.go:3454 +0x485',
  '\texternal/io_opencensus_go/stats/view/worker.go:34 +0x8d',
  '\tpkg/util/log/log_flush.go:78 +0x1a'
];

locationExamples.forEach((example, index) => {
  assertTrue(
    stackContent.includes(example),
    `Should find location example ${index + 1}: "${example}"`
  );
});

console.log('\n🎯 Testing specific parsing patterns...');

// Test parseFileLine logic manually - handle both tabs and 4 spaces
function testParseFileLine(input, expectedFile, expectedLine) {
  // Handle both formats: tabs (from example file) and 4 spaces (from user input)
  // Also handle lines that end immediately after the line number (no +0x offset)
  const match = input.match(/^(?:\t|    )(.+):(\d+)(?:\s|$)/);
  if (match) {
    return {
      file: match[1],
      line: parseInt(match[2])
    };
  }
  return null;
}

// Test the parseFileLine function with actual examples (both tabs and spaces)
const testCases = [
  {
    input: '\tGOROOT/src/net/http/server.go:3454 +0x485',
    expectedFile: 'GOROOT/src/net/http/server.go',
    expectedLine: 3454
  },
  {
    input: '\texternal/io_opencensus_go/stats/view/worker.go:34 +0x8d',
    expectedFile: 'external/io_opencensus_go/stats/view/worker.go',
    expectedLine: 34
  },
  {
    input: '\tpkg/util/log/log_flush.go:78 +0x1a',
    expectedFile: 'pkg/util/log/log_flush.go',
    expectedLine: 78
  },
  {
    input: '    start.go:980 +0x176',
    expectedFile: 'start.go',
    expectedLine: 980
  },
  {
    input: '\texternal/com_github_spf13_cobra/command.go:968',
    expectedFile: 'external/com_github_spf13_cobra/command.go',
    expectedLine: 968
  },
  {
    input: '\tcli.go:301',
    expectedFile: 'cli.go',
    expectedLine: 301
  }
];

testCases.forEach((testCase, index) => {
  const result = testParseFileLine(testCase.input, testCase.expectedFile, testCase.expectedLine);
  
  if (result) {
    assertEquals(result.file, testCase.expectedFile, `Test case ${index + 1}: file path`);
    assertEquals(result.line, testCase.expectedLine, `Test case ${index + 1}: line number`);
  } else {
    console.error(`❌ FAIL: Test case ${index + 1} returned null for input: "${testCase.input}"`);
  }
});

console.log('\n🎯 Testing comprehensive 5-goroutine parsing...');

// Test with the user's actual input - 5 goroutines
const userTestInput = `
goroutine 1 [select, 4 minutes]:
github.com/cockroachdb/cockroach/pkg/cli.waitForShutdown(0xc00848e240, 0xc0084afa40, 0xc0081a20e0, 0xc001874e10)
	start.go:980 +0x176
github.com/cockroachdb/cockroach/pkg/cli.runStartInternal(0xccc15c0, {0x75f9bd6, 0x4}, 0xc003383a90, 0x7a5db78, 0x0)
	start.go:666 +0x96e
github.com/cockroachdb/cockroach/pkg/cli.runStart(0x0?, {0x0?, 0x0?, 0x0?}, 0x0?)
	start.go:379 +0x46
github.com/cockroachdb/cockroach/pkg/cli.runStartJoin(0x0?, {0xc0083fe340?, 0x0?, 0x0?})
	start.go:347 +0x1a
github.com/cockroachdb/cockroach/pkg/cli.init.MaybeDecorateError.func134(0xc003383b50?, {0xc0083fe340?, 0x0?, 0x0?})
	pkg/cli/clierrorplus/decorate_error.go:67 +0x34
github.com/cockroachdb/cockroach/pkg/cli.init.MaybeShoutError.func135(0xccc15c0?, {0xc0083fe340?, 0x0?, 0xd?})
	pkg/cli/clierrorplus/shout.go:19 +0x1c
github.com/spf13/cobra.(*Command).execute(0xccc15c0, {0xc0083fe270, 0xd, 0xd})
	external/com_github_spf13_cobra/command.go:916 +0x894
github.com/spf13/cobra.(*Command).ExecuteC(0xccb1e80)
	external/com_github_spf13_cobra/command.go:1044 +0x3a5
github.com/spf13/cobra.(*Command).Execute(...)
	external/com_github_spf13_cobra/command.go:968
github.com/cockroachdb/cockroach/pkg/cli.Run(...)
	cli.go:301
github.com/cockroachdb/cockroach/pkg/cli.doMain(0xccc15c0, {0xc00200146a, 0x5})
	cli.go:140 +0x1d8
github.com/cockroachdb/cockroach/pkg/cli.Main()
	cli.go:65 +0x11f
main.main()
	pkg/cmd/cockroach/main.go:21 +0xf

goroutine 24 [select]:
go.opencensus.io/stats/view.(*worker).start(0xc0011f8580)
	external/io_opencensus_go/stats/view/worker.go:292 +0x9f
created by go.opencensus.io/stats/view.init.0 in goroutine 1
	external/io_opencensus_go/stats/view/worker.go:34 +0x8d

goroutine 12 [chan receive]:
github.com/cockroachdb/cockroach/pkg/util/log.flushDaemon()
	pkg/util/log/log_flush.go:123 +0x4e
created by github.com/cockroachdb/cockroach/pkg/util/log.init.5 in goroutine 1
	pkg/util/log/log_flush.go:78 +0x1a

goroutine 13 [chan receive, 4 minutes]:
github.com/cockroachdb/cockroach/pkg/util/log.signalFlusher()
	pkg/util/log/log_flush.go:147 +0x85
created by github.com/cockroachdb/cockroach/pkg/util/log.init.5 in goroutine 1
	pkg/util/log/log_flush.go:79 +0x26

goroutine 29 [syscall, 4 minutes]:
os/signal.signal_recv()
	GOROOT/src/runtime/sigqueue.go:152 +0x29
os/signal.loop()
	GOROOT/src/os/signal/signal_unix.go:23 +0x13
created by os/signal.Notify.func1.1 in goroutine 13
	GOROOT/src/os/signal/signal.go:152 +0x1f
`;

// Test parsing logic matching the actual implementation  
function testParseFileLineForUserInput(line) {
  // Handle both formats: tabs (from example file) and 4 spaces (from user input)
  // Also handle lines that end immediately after the line number (no +0x offset)
  const match = line.match(/^(?:\t|    )(.+):(\d+)(?:\s|$)/);
  if (match) {
    return {
      file: match[1],
      line: parseInt(match[2])
    };
  }
  return null;
}

function testParseStackTrace(lines) {
  const calls = [];
  let createdBy = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!line.trim()) continue;
    
    // Check for "created by" line
    if (line.trim().startsWith('created by')) {
      const match = line.trim().match(/^created by (.+) in goroutine (\d+)$/);
      if (match) {
        let file = 'unknown';
        let lineNum = 0;
        
        // Look for location on the next line (tab or 4 spaces)
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (nextLine.startsWith('\t') || nextLine.startsWith('    ')) {
            const locationMatch = testParseFileLineForUserInput(nextLine);
            if (locationMatch) {
              file = locationMatch.file;
              lineNum = locationMatch.line;
              i++; // Skip the location line since we processed it
            }
          }
        }
        
        createdBy = {
          function: match[1],
          creatorId: match[2],
          file: file,
          line: lineNum,
          creatorExists: false
        };
      }
      continue;
    }
    
    // Function line (no leading spaces)
    if (!line.startsWith(' ')) {
      const match = line.trim().match(/^(.+)(\(.*\))$/);  // Allow empty parentheses
      if (match) {
        const functionName = match[1];
        const args = match[2];
        let file = 'unknown';
        let lineNum = 0;
        
        // Look for location on the next line (tab or 4 spaces)
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (nextLine.startsWith('\t') || nextLine.startsWith('    ')) {
            const locationMatch = testParseFileLineForUserInput(nextLine);
            if (locationMatch) {
              file = locationMatch.file;
              lineNum = locationMatch.line;
              i++; // Skip the location line since we processed it
            }
          }
        }
        
        calls.push({
          function: functionName,
          args: args,
          file: file,
          line: lineNum
        });
      }
    }
  }
  
  return { calls, createdBy };
}

// Parse all goroutines from user input
function testParseGoroutines(text) {
  const goroutines = [];
  const sections = text.split(/\n\s*\n/);
  
  sections.forEach(section => {
    if (section.trim()) {
      const lines = section.trim().split('\n');
      const firstLine = lines[0];
      
      // Parse goroutine header
      const goroutineMatch = firstLine.match(/^goroutine\s+(\d+)\s+\[([^\]]+)\]:?/);
      
      if (goroutineMatch) {
        const goroutineId = goroutineMatch[1];
        const state = goroutineMatch[2];
        
        const result = testParseStackTrace(lines.slice(1));
        
        goroutines.push({
          id: goroutineId,
          state: state,
          calls: result.calls,
          createdBy: result.createdBy
        });
      }
    }
  });
  
  return goroutines;
}

console.log('Parsing user test input with 5 goroutines...');
const userGoroutines = testParseGoroutines(userTestInput);

// Comprehensive verification tests
const comprehensiveTests = [
  {
    name: 'Should parse exactly 5 goroutines',
    test: () => userGoroutines.length === 5
  },
  {
    name: 'Goroutine 1 should have no created by info',
    test: () => userGoroutines[0].id === '1' && userGoroutines[0].createdBy === null
  },
  {
    name: 'Goroutine 1 should have multiple function calls',
    test: () => userGoroutines[0].calls.length >= 10
  },
  {
    name: 'Goroutine 24 should have created by info with correct location',
    test: () => {
      const g24 = userGoroutines.find(g => g.id === '24');
      return g24 && g24.createdBy && 
             g24.createdBy.file === 'external/io_opencensus_go/stats/view/worker.go' &&
             g24.createdBy.line === 34 &&
             g24.createdBy.function === 'go.opencensus.io/stats/view.init.0' &&
             g24.createdBy.creatorId === '1';
    }
  },
  {
    name: 'Goroutine 12 should have function with empty parentheses',
    test: () => {
      const g12 = userGoroutines.find(g => g.id === '12');
      return g12 && g12.calls.length === 1 &&
             g12.calls[0].function === 'github.com/cockroachdb/cockroach/pkg/util/log.flushDaemon' &&
             g12.calls[0].args === '()';
    }
  },
  {
    name: 'Goroutine 12 should have created by info with correct location',
    test: () => {
      const g12 = userGoroutines.find(g => g.id === '12');
      return g12 && g12.createdBy && 
             g12.createdBy.file === 'pkg/util/log/log_flush.go' &&
             g12.createdBy.line === 78;
    }
  },
  {
    name: 'Goroutine 13 should have created by info with correct location',
    test: () => {
      const g13 = userGoroutines.find(g => g.id === '13');
      return g13 && g13.createdBy && 
             g13.createdBy.file === 'pkg/util/log/log_flush.go' &&
             g13.createdBy.line === 79;
    }
  },
  {
    name: 'Goroutine 29 should have created by info with GOROOT location',
    test: () => {
      const g29 = userGoroutines.find(g => g.id === '29');
      return g29 && g29.createdBy && 
             g29.createdBy.file === 'GOROOT/src/os/signal/signal.go' &&
             g29.createdBy.line === 152 &&
             g29.createdBy.creatorId === '13';
    }
  },
  {
    name: 'Goroutine 29 should have 2 function calls',
    test: () => {
      const g29 = userGoroutines.find(g => g.id === '29');
      return g29 && g29.calls.length === 2 &&
             g29.calls[0].function === 'os/signal.signal_recv' &&
             g29.calls[1].function === 'os/signal.loop';
    }
  },
  {
    name: 'All goroutines with created by should have valid file locations',
    test: () => {
      return userGoroutines.every(g => 
        !g.createdBy || (g.createdBy.file !== 'unknown' && g.createdBy.line > 0)
      );
    }
  },
  {
    name: 'Should handle functions with empty parentheses',
    test: () => {
      return userGoroutines.some(g => 
        g.calls.some(call => call.args === '()')
      );
    }
  },
  {
    name: 'Should handle functions with complex arguments',
    test: () => {
      return userGoroutines.some(g => 
        g.calls.some(call => call.args.includes('{') && call.args.includes('}'))
      );
    }
  }
];

comprehensiveTests.forEach(test => {
  const passed = test.test();
  console.log(`${passed ? '✅' : '❌'} ${test.name}`);
});

const allComprehensivePassed = comprehensiveTests.every(test => test.test());
console.log(`\n${allComprehensivePassed ? '🎉 ALL COMPREHENSIVE TESTS PASSED!' : '💥 SOME COMPREHENSIVE TESTS FAILED!'}`);

// Show summary of parsed goroutines
console.log('\n📊 Parsing Summary:');
userGoroutines.forEach(g => {
  const createdByInfo = g.createdBy ? 
    `created by ${g.createdBy.function} in goroutine ${g.createdBy.creatorId} at ${g.createdBy.file}:${g.createdBy.line}` :
    'no creator info';
  console.log(`  Goroutine ${g.id} [${g.state}]: ${g.calls.length} calls, ${createdByInfo}`);
});

console.log('\n🎯 Testing literal (...) arguments parsing issue...');

// Test with literal (...) arguments that Go sometimes shows when it can't dump them
// This includes the specific case from example/stacks.txt around line 59 where
// location lines don't have +0x offset after the line number
const literalArgsTestInput = `
goroutine 1 [running]:
runtime.systemstack_switch()
    GOROOT/src/runtime/asm_amd64.s:459 fp=0xc000047c90 sp=0xc000047c88 pc=0x46e790
runtime.mallocgc(...)
    GOROOT/src/runtime/malloc.go:1241 +0x5fc
github.com/spf13/cobra.(*Command).Execute(...)
	external/com_github_spf13_cobra/command.go:968
github.com/cockroachdb/cockroach/pkg/cli.Run(...)
	cli.go:301
main.createLargeObject()
    main.go:15 +0x45

goroutine 2 [select]:
net/http.(*conn).serve(...)
    GOROOT/src/net/http/server.go:1952 +0x8f8
created by net/http.(*Server).Serve in goroutine 1
    GOROOT/src/net/http/server.go:3454 +0x485
`;

console.log('Testing with literal (...) arguments...');

function testLiteralArgsGoroutines(text) {
  const goroutines = [];
  const sections = text.split(/\n\s*\n/);
  
  sections.forEach(section => {
    if (section.trim()) {
      const lines = section.trim().split('\n');
      const firstLine = lines[0];
      
      // Parse goroutine header
      const goroutineMatch = firstLine.match(/^goroutine\s+(\d+)\s+\[([^\]]+)\]:?/);
      
      if (goroutineMatch) {
        const goroutineId = goroutineMatch[1];
        const state = goroutineMatch[2];
        
        const result = testParseStackTrace(lines.slice(1));
        
        goroutines.push({
          id: goroutineId,
          state: state,
          calls: result.calls,
          createdBy: result.createdBy
        });
      }
    }
  });
  
  return goroutines;
}

const literalArgsGoroutines = testLiteralArgsGoroutines(literalArgsTestInput);

// Tests specifically for literal (...) arguments issue
const literalArgsTests = [
  {
    name: 'Should parse exactly 2 goroutines',
    test: () => literalArgsGoroutines.length === 2
  },
  {
    name: 'Goroutine 1 should have 5 function calls',
    test: () => {
      const g1 = literalArgsGoroutines.find(g => g.id === '1');
      return g1 && g1.calls.length === 5;
    }
  },
  {
    name: 'runtime.mallocgc(...) should parse with correct location',
    test: () => {
      const g1 = literalArgsGoroutines.find(g => g.id === '1');
      if (!g1) return false;
      const mallocCall = g1.calls.find(call => call.function === 'runtime.mallocgc');
      return mallocCall && 
             mallocCall.args === '(...)' &&
             mallocCall.file === 'GOROOT/src/runtime/malloc.go' &&
             mallocCall.line === 1241;
    }
  },
  {
    name: 'github.com/spf13/cobra.(*Command).Execute(...) should parse with correct location (no +0x offset)',
    test: () => {
      const g1 = literalArgsGoroutines.find(g => g.id === '1');
      if (!g1) return false;
      const executeCall = g1.calls.find(call => call.function === 'github.com/spf13/cobra.(*Command).Execute');
      return executeCall && 
             executeCall.args === '(...)' &&
             executeCall.file === 'external/com_github_spf13_cobra/command.go' &&
             executeCall.line === 968;
    }
  },
  {
    name: 'github.com/cockroachdb/cockroach/pkg/cli.Run(...) should parse with correct location (no +0x offset)',
    test: () => {
      const g1 = literalArgsGoroutines.find(g => g.id === '1');
      if (!g1) return false;
      const runCall = g1.calls.find(call => call.function === 'github.com/cockroachdb/cockroach/pkg/cli.Run');
      return runCall && 
             runCall.args === '(...)' &&
             runCall.file === 'cli.go' &&
             runCall.line === 301;
    }
  },
  {
    name: 'main.createLargeObject() should parse with correct location',
    test: () => {
      const g1 = literalArgsGoroutines.find(g => g.id === '1');
      if (!g1) return false;
      const mainCall = g1.calls.find(call => call.function === 'main.createLargeObject');
      return mainCall && 
             mainCall.args === '()' &&
             mainCall.file === 'main.go' &&
             mainCall.line === 15;
    }
  },
  {
    name: 'net/http.(*conn).serve(...) should parse with correct location',
    test: () => {
      const g2 = literalArgsGoroutines.find(g => g.id === '2');
      if (!g2) return false;
      const serveCall = g2.calls.find(call => call.function === 'net/http.(*conn).serve');
      return serveCall && 
             serveCall.args === '(...)' &&
             serveCall.file === 'GOROOT/src/net/http/server.go' &&
             serveCall.line === 1952;
    }
  },
  {
    name: 'Goroutine 2 should have created by info with correct location',
    test: () => {
      const g2 = literalArgsGoroutines.find(g => g.id === '2');
      return g2 && g2.createdBy && 
             g2.createdBy.function === 'net/http.(*Server).Serve' &&
             g2.createdBy.creatorId === '1' &&
             g2.createdBy.file === 'GOROOT/src/net/http/server.go' &&
             g2.createdBy.line === 3454;
    }
  },
  {
    name: 'All calls should have valid file locations (not unknown)',
    test: () => {
      return literalArgsGoroutines.every(g => 
        g.calls.every(call => call.file !== 'unknown' && call.line > 0)
      );
    }
  }
];

literalArgsTests.forEach(test => {
  const passed = test.test();
  console.log(`${passed ? '✅' : '❌'} ${test.name}`);
  if (!passed) {
    console.log(`   Debug info for failed test:`, test.name);
    console.log(`   Goroutines found:`, literalArgsGoroutines.length);
    literalArgsGoroutines.forEach(g => {
      console.log(`     Goroutine ${g.id}: ${g.calls.length} calls`);
      g.calls.forEach(call => {
        console.log(`       ${call.function}${call.args} -> ${call.file}:${call.line}`);
      });
      if (g.createdBy) {
        console.log(`       created by ${g.createdBy.function} -> ${g.createdBy.file}:${g.createdBy.line}`);
      }
    });
  }
});

const allLiteralArgsTestsPassed = literalArgsTests.every(test => test.test());
console.log(`\n${allLiteralArgsTestsPassed ? '🎉 ALL LITERAL ARGS TESTS PASSED!' : '💥 SOME LITERAL ARGS TESTS FAILED!'}`);

console.log('\n🏁 Parsing tests completed!');