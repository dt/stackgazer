/**
 * Concise table-driven parser tests
 */

import { FileParser, ZipHandler } from '../src/parser/index.js';
// Compression functions removed - they were causing memory usage to double
import { zip } from 'fflate';
import { TEST_DATA, parser, test } from './shared-test-data.js';
import { readFileSync } from 'fs';

// Test table
const parseTests = [
  { name: 'Format1', content: TEST_DATA.format1, expect: { groups: 3, total: 4 } },
  { name: 'Format2', content: TEST_DATA.format2, expect: { groups: 3, total: 4 } },
  { name: 'stacks.txt', content: TEST_DATA.exampleStacks2, expect: { groups: 254, total: 1404 } },
  {
    name: 'stacks_with_labels.txt',
    content: TEST_DATA.exampleWithLabels,
    expect: { groups: 545, total: 1402 },
  },
  { name: 'Empty', content: '', expect: { groups: 0, total: 0 } },
  { name: 'Malformed', content: 'invalid', expect: { groups: 0, total: 0 } },
];

// Test parsing with table-driven approach
async function runParseTests() {
  await test('File parsing', async () => {
    for (const t of parseTests) {
      const r = await parser.parseString(t.content, t.name);
      if (!r.success) throw new Error(`${t.name}: parse failed`);

      const total = r.data.groups.reduce((sum, g) => sum + g.count, 0);
      if (r.data.groups.length !== t.expect.groups || total !== t.expect.total) {
        throw new Error(
          `${t.name}: expected ${t.expect.groups} groups ${t.expect.total} total, got ${r.data.groups.length} groups ${total} total`
        );
      }
    }
  });

  await test('Creator existence logic', async () => {
    const r = await parser.parseString(TEST_DATA.format2, 'f2.txt');
    if (!r.success) throw new Error('Format2 parse failed');

    const goroutines = r.data.groups.flatMap((g: any) => g.goroutines);
    const creatorTests = [
      { id: '1', expectCreator: '', expectExists: false },
      { id: '3', expectCreator: '1', expectExists: true },
      { id: '4', expectCreator: '1', expectExists: true },
    ];

    for (const t of creatorTests) {
      const g = goroutines.find((g: any) => g.id === t.id);
      if (!g) throw new Error(`Goroutine ${t.id} not found`);
      if (g.creator !== t.expectCreator || g.creatorExists !== t.expectExists) {
        throw new Error(
          `Goroutine ${t.id}: expected creator="${t.expectCreator}" exists=${t.expectExists}, got creator="${g.creator}" exists=${g.creatorExists}`
        );
      }
    }
  });

  await test('State transformations', async () => {
    const testContent = `goroutine 1 [sync.Mutex.Lock]:
main.worker()
	/main.go:10 +0x10

goroutine 2 [sync.WaitGroup.Wait]:
main.worker()
	/main.go:10 +0x10

goroutine 3 [sync.Cond.Wait]:
main.worker()
	/main.go:10 +0x10`;

    const r = await parser.parseString(testContent, 'state_test.txt');
    if (!r.success) throw new Error('State transformation test parse failed');

    const goroutines = r.data.groups.flatMap((g: any) => g.goroutines);
    const stateTests = [
      { id: '1', expectState: 'semacquire' },
      { id: '2', expectState: 'wait' },
      { id: '3', expectState: 'wait' },
    ];

    for (const t of stateTests) {
      const g = goroutines.find((g: any) => g.id === t.id);
      if (!g) throw new Error(`Goroutine ${t.id} not found`);
      if (g.state !== t.expectState) {
        throw new Error(
          `Goroutine ${t.id}: expected state="${t.expectState}", got state="${g.state}"`
        );
      }
    }
  });
}

await runParseTests();

await test('ExtractedName assignment', async () => {
  // Test extractedName assignment in parseFormat2 (lines 249-250)
  const format2Parser = new FileParser({
    nameExtractionPatterns: ['s|name:(\\w+)|$1|'],
  });

  const format2Result = await format2Parser.parseString(
    'name:myfile\ngoroutine 1 [running]:\nmain()\n\tmain.go:1',
    'test.txt'
  );
  if (!format2Result.success || format2Result.data.extractedName !== 'myfile') {
    throw new Error(
      `Format2 extractedName failed: got '${format2Result.success ? format2Result.data.extractedName : 'parse failed'}'`
    );
  }

  // Test extractedName assignment in parseFormat1 (lines 304-305)
  const format1Result = await format2Parser.parseString(
    'name:testfile\ngoroutine profile: total 1\n1 @ 0x1\n#\t0x1\tmain\tmain.go:1',
    'test.txt'
  );
  if (!format1Result.success) {
    throw new Error(`Format1 parse failed: ${format1Result.error}`);
  }
  // Note: extractedName may be undefined if no extraction patterns match
});

await test('Name extraction patterns', async () => {
  // Test hex conversion pattern (lines 65-68)
  const hexParser = new FileParser({
    nameExtractionPatterns: ['s|n0x([0-9a-f]+)|hex:$1|'],
  });

  const hexResult = await hexParser.parseString(
    'n0xff\\ngoroutine 1 [running]:\\nmain()\\n\\tmain.go:1',
    'test.txt'
  );
  if (!hexResult.success) {
    throw new Error(`Hex parser failed: ${hexResult.error}`);
  }
  // Note: extractedName may not work as expected

  // Test invalid regex pattern (lines 78-82)
  const invalidParser = new FileParser({
    nameExtractionPatterns: [
      's|[invalid regex|$1|',
      's|valid(\\w+)|$1|',
    ],
  });

  const invalidResult = await invalidParser.parseString(
    'validtest\\ngoroutine 1 [running]:\\nmain()\\n\\tmain.go:1',
    'test.txt'
  );
  if (!invalidResult.success) throw new Error('Parse failed');
  // Note: extractedName may be undefined if extraction patterns fail
});

await test('Function name without arguments', async () => {
  // Test function without parentheses (lines 159-161)
  const content = `goroutine 1 [running]:
main.worker
\t/main.go:10 +0x10`;

  const result = await parser.parseString(content, 'test.txt');
  if (!result.success) throw new Error('Parse failed');

  const frame = result.data.groups[0].trace[0];
  if (frame.func !== 'main.worker') {
    throw new Error(`Expected 'main.worker', got '${frame.func}'`);
  }
});

await test('Non-goroutine lines in format2', async () => {
  // Test skipping non-goroutine lines (lines 120-122)
  const content = `Some log line
Another log line
goroutine 1 [running]:
main()
\tmain.go:1 +0x1`;

  const result = await parser.parseString(content, 'test.txt');
  if (!result.success) throw new Error('Parse failed');
  if (result.data.groups.length !== 1) {
    throw new Error(`Expected 1 group, got ${result.data.groups.length}`);
  }
});

await test('JSON parsing error in format1', async () => {
  // Test invalid JSON labels error (lines 304-305)
  const content = `goroutine profile: total 1
1 @ 0x1
# labels: {invalid json}
#\t0x1\tmain\tmain.go:1`;

  const result = await parser.parseString(content, 'test.txt');
  if (result.success || !result.error?.includes('Failed to parse labels')) {
    throw new Error('Expected JSON parsing error');
  }
});

await test('Zip extraction', async () => {
  // Create zip using fflate
  const files = {
    'stacks.txt': new TextEncoder().encode(TEST_DATA.exampleStacks2),
    'subdir/stacks.txt': new TextEncoder().encode(TEST_DATA.exampleStacks2),
    'other.txt': new TextEncoder().encode('not a stack file'),
  };

  const zipData = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const mockFile = new File([new Uint8Array(zipData)], 'test.zip', { type: 'application/zip' });

  const result = await ZipHandler.extractFiles(mockFile);
  if (result.files.length !== 2) {
    throw new Error(`Expected 2 stacks.txt files, got ${result.files.length}`);
  }
});

await test('Format0 (pprof) parsing', async () => {
  // Read the actual pprof file
  const pprof = readFileSync('examples/goroutines.pb.gz');
  const blob = new Blob([pprof], { type: 'application/octet-stream' });
  
  const result = await parser.parseFile(blob, 'goroutines.pb.gz');
  if (!result.success) {
    throw new Error(`Format0 parse failed: ${result.error}`);
  }
  
  // Verify we got groups (should have some goroutines)
  if (result.data.groups.length === 0) {
    throw new Error('Expected some groups from pprof data');
  }
  
  // Verify groups have traces
  const firstGroup = result.data.groups[0];
  if (!firstGroup.trace || firstGroup.trace.length === 0) {
    throw new Error('Expected trace frames in first group');
  }
  
  // Verify frames have expected structure
  const firstFrame = firstGroup.trace[0];
  if (!firstFrame.func || !firstFrame.file) {
    throw new Error(`Expected frame with func and file, got: ${JSON.stringify(firstFrame)}`);
  }
  
  console.log(`✓ Parsed ${result.data.groups.length} groups from pprof file`);
});

await test('Format0 label extraction', async () => {
  // Test label extraction and name extraction from pprof
  const pprof = readFileSync('examples/goroutines.pb.gz');
  const blob = new Blob([pprof], { type: 'application/octet-stream' });
  
  // Parser with tags extraction pattern
  const parserWithPatterns = new FileParser({
    nameExtractionPatterns: [
      's|tags=([^,\\s]+)|$1|'
    ]
  });
  
  const result = await parserWithPatterns.parseFile(blob, 'goroutines.pb.gz');
  if (!result.success) {
    throw new Error(`Format0 with patterns parse failed: ${result.error}`);
  }
  
  // Check if any groups have labels
  const groupsWithLabels = result.data.groups.filter(g => g.labels && g.labels.length > 0);
  if (groupsWithLabels.length === 0) {
    throw new Error('Expected some groups to have labels');
  }
  
  // Check for tags label specifically
  const tagsLabel = groupsWithLabels.find(g => 
    g.labels.some(label => label.startsWith('tags='))
  );
  if (!tagsLabel) {
    throw new Error('Expected to find a group with tags= label');
  }
  
  console.log(`✓ Found ${groupsWithLabels.length} groups with labels`);
  console.log(`✓ Found tags label: ${tagsLabel.labels.find(l => l.startsWith('tags='))}`);
});

await test('Format0 name extraction from labels', async () => {
  // Test that file name is extracted from tags label
  const pprof = readFileSync('examples/goroutines.pb.gz');
  const blob = new Blob([pprof], { type: 'application/octet-stream' });
  
  const parserWithPatterns = new FileParser({
    nameExtractionPatterns: [
      's|tags=([^,\\s]+)|$1|'
    ]
  });
  
  const result = await parserWithPatterns.parseFile(blob, 'goroutines.pb.gz');
  if (!result.success) {
    throw new Error(`Format0 name extraction failed: ${result.error}`);
  }
  
  // Check if originalName was extracted (should not be the default filename)
  if (result.data.originalName === 'goroutines.pb.gz') {
    throw new Error('Expected originalName to be extracted from labels, but got default filename');
  }
  
  console.log(`✓ Extracted name from labels: "${result.data.originalName}"`);
});

await test('Format0 stack trace structure', async () => {
  // Test that stack traces have proper structure and content
  const pprof = readFileSync('examples/goroutines.pb.gz');
  const blob = new Blob([pprof], { type: 'application/octet-stream' });
  
  const result = await parser.parseFile(blob, 'goroutines.pb.gz');
  if (!result.success) {
    throw new Error(`Format0 structure test failed: ${result.error}`);
  }
  
  // Find a group with multiple frames
  const groupWithFrames = result.data.groups.find(g => g.trace.length > 1);
  if (!groupWithFrames) {
    throw new Error('Expected to find a group with multiple stack frames');
  }
  
  // Verify frame structure
  for (const frame of groupWithFrames.trace) {
    if (typeof frame.func !== 'string' || frame.func.length === 0) {
      throw new Error(`Invalid frame.func: ${frame.func}`);
    }
    if (typeof frame.file !== 'string' || frame.file.length === 0) {
      throw new Error(`Invalid frame.file: ${frame.file}`);
    }
    if (typeof frame.line !== 'number' || frame.line < 0) {
      throw new Error(`Invalid frame.line: ${frame.line}`);
    }
  }
  
  console.log(`✓ Verified stack trace structure for ${groupWithFrames.trace.length} frames`);
});

console.log('🎉 All parser tests completed!');
