/**
 * Concise table-driven parser tests
 */

import { FileParser, ZipHandler } from '../src/parser/index.js';
// Compression functions removed - they were causing memory usage to double
import { zip } from 'fflate';
import { TEST_DATA, parser, test } from './shared-test-data.js';

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
      const r = await parser.parseFile(t.content, t.name);
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
    const r = await parser.parseFile(TEST_DATA.format2, 'f2.txt');
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

    const r = await parser.parseFile(testContent, 'state_test.txt');
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
    nameExtractionPatterns: [{ regex: 'name:(\\w+)', replacement: '$1' }],
  });

  const format2Result = await format2Parser.parseFile(
    'name:myfile\ngoroutine 1 [running]:\nmain()\n\tmain.go:1',
    'test.txt'
  );
  if (!format2Result.success || format2Result.data.extractedName !== 'myfile') {
    throw new Error(`Format2 extractedName failed: got '${format2Result.success ? format2Result.data.extractedName : 'parse failed'}'`);
  }

  // Test extractedName assignment in parseFormat1 (lines 304-305)
  const format1Result = await format2Parser.parseFile(
    'name:testfile\ngoroutine profile: total 1\n1 @ 0x1\n#\t0x1\tmain\tmain.go:1',
    'test.txt'
  );
  if (!format1Result.success || format1Result.data.extractedName !== 'testfile') {
    throw new Error(`Format1 extractedName failed: got '${format1Result.success ? format1Result.data.extractedName : 'parse failed'}'`);
  }
});

await test('Name extraction patterns', async () => {
  // Test hex conversion pattern (lines 65-68)
  const hexParser = new FileParser({
    nameExtractionPatterns: [{ regex: 'n0x([0-9a-f]+)', replacement: 'hex:$1' }],
  });

  const hexResult = await hexParser.parseFile(
    'n0xff\\ngoroutine 1 [running]:\\nmain()\\n\\tmain.go:1',
    'test.txt'
  );
  if (!hexResult.success || hexResult.data.extractedName !== '255') {
    throw new Error('Hex conversion failed');
  }

  // Test invalid regex pattern (lines 78-82)
  const invalidParser = new FileParser({
    nameExtractionPatterns: [
      { regex: '[invalid regex', replacement: '$1' },
      { regex: 'valid(\\w+)', replacement: '$1' },
    ],
  });

  const invalidResult = await invalidParser.parseFile(
    'validtest\\ngoroutine 1 [running]:\\nmain()\\n\\tmain.go:1',
    'test.txt'
  );
  if (!invalidResult.success) throw new Error('Parse failed');
  if (invalidResult.data.extractedName !== 'test') {
    throw new Error(`Expected 'test', got '${invalidResult.data.extractedName}'`);
  }
});

await test('Function name without arguments', async () => {
  // Test function without parentheses (lines 159-161)
  const content = `goroutine 1 [running]:
main.worker
\t/main.go:10 +0x10`;

  const result = await parser.parseFile(content, 'test.txt');
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

  const result = await parser.parseFile(content, 'test.txt');
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

  const result = await parser.parseFile(content, 'test.txt');
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

console.log('🎉 All parser tests completed!');
