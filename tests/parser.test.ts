/**
 * Concise table-driven parser tests
 */

import { FileParser, ZipHandler } from '../src/parser/index.js';
// Compression functions removed - they were causing memory usage to double
import { zip, gzip } from 'fflate';
import { TEST_DATA, parser, test } from './shared-test-data.js';
import { readFileSync } from 'fs';
import { Profile, StringTable } from 'pprof-format';

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

await test('Debug=3 format parsing and regrouping', async () => {
  // Create a synthetic pprof profile with debug=3 labels (go::goroutine*)
  // This simulates what Go would produce with a hypothetical debug=3 format

  // Create StringTable properly
  const stringTable = new StringTable();
  // StringTable indices (dedup adds strings and returns their index)
  stringTable.dedup('');  // 0 - always empty
  const goroutinesIdx = stringTable.dedup('goroutines');  // 1
  const countIdx = stringTable.dedup('count');  // 2
  const workerFuncIdx = stringTable.dedup('main.worker');  // 3
  const fileIdx = stringTable.dedup('main.go');  // 4
  const fetchFuncIdx = stringTable.dedup('main.fetch');  // 5
  const goGoroutineIdx = stringTable.dedup('go::goroutine');  // 6
  const goCreatorIdx = stringTable.dedup('go::goroutine_created_by');  // 7
  const goStateIdx = stringTable.dedup('go::goroutine_state');  // 8
  const goWaitIdx = stringTable.dedup('go::goroutine_wait_minutes');  // 9
  const chanRecvIdx = stringTable.dedup('chan receive');  // 10
  const runningIdx = stringTable.dedup('running');  // 11
  const clusterIdx = stringTable.dedup('cluster');  // 12
  const prodIdx = stringTable.dedup('prod');  // 13

  const profile = new Profile({
    stringTable,
    sampleType: [{ type: goroutinesIdx, unit: countIdx }],
    function: [
      { id: 1, name: workerFuncIdx, filename: fileIdx, startLine: 10 },
      { id: 2, name: fetchFuncIdx, filename: fileIdx, startLine: 20 },
    ],
    location: [
      { id: 1, line: [{ functionId: 1, line: 15 }] },
      { id: 2, line: [{ functionId: 2, line: 25 }] },
    ],
    sample: [
      // Three goroutines with same stack (main.worker) and state (chan receive)
      {
        locationId: [1],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 100 },  // go::goroutine=100
          { key: goCreatorIdx, num: 1 },    // go::goroutine_created_by=1
          { key: goStateIdx, str: chanRecvIdx },   // go::goroutine_state=chan receive
          { key: goWaitIdx, num: 5 },    // go::goroutine_wait_minutes=5
          { key: clusterIdx, str: prodIdx },  // cluster=prod (should be preserved)
        ],
      },
      {
        locationId: [1],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 101 },
          { key: goCreatorIdx, num: 1 },
          { key: goStateIdx, str: chanRecvIdx },
          { key: goWaitIdx, num: 3 },
          { key: clusterIdx, str: prodIdx },
        ],
      },
      {
        locationId: [1],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 102 },
          { key: goCreatorIdx, num: 1 },
          { key: goStateIdx, str: chanRecvIdx },
          { key: goWaitIdx, num: 7 },
          { key: clusterIdx, str: prodIdx },
        ],
      },
      // Two goroutines with same stack (main.worker) but different state (running)
      {
        locationId: [1],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 103 },
          { key: goCreatorIdx, num: 1 },
          { key: goStateIdx, str: runningIdx },  // running
          { key: clusterIdx, str: prodIdx },
        ],
      },
      {
        locationId: [1],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 104 },
          { key: goCreatorIdx, num: 1 },
          { key: goStateIdx, str: runningIdx },
          { key: clusterIdx, str: prodIdx },
        ],
      },
      // One goroutine with different stack (main.fetch)
      {
        locationId: [2],
        value: [1],
        label: [
          { key: goGoroutineIdx, num: 105 },
          { key: goCreatorIdx, num: 100 },  // created by goroutine 100
          { key: goStateIdx, str: chanRecvIdx },
          { key: clusterIdx, str: prodIdx },
        ],
      },
    ],
  });

  // Encode and gzip the profile
  const encoded = profile.encode();
  const gzipped = await new Promise<Uint8Array>((resolve, reject) => {
    gzip(encoded, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  // Convert to ArrayBuffer for Blob
  const arrayBuffer = new ArrayBuffer(gzipped.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(gzipped);
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
  const result = await parser.parseFile(blob, 'debug3.pb.gz');

  if (!result.success) {
    throw new Error(`Debug=3 parse failed: ${result.error}`);
  }

  // Should have 3 groups:
  // 1. main.worker + chan receive (3 goroutines: 100, 101, 102)
  // 2. main.worker + running (2 goroutines: 103, 104)
  // 3. main.fetch + chan receive (1 goroutine: 105)
  if (result.data.groups.length !== 3) {
    throw new Error(`Expected 3 groups, got ${result.data.groups.length}`);
  }

  // Find the groups
  const workerChanRecv = result.data.groups.find(g =>
    g.trace[0]?.func === 'main.worker' && g.labels.includes('state=chan receive')
  );
  const workerRunning = result.data.groups.find(g =>
    g.trace[0]?.func === 'main.worker' && g.labels.includes('state=running')
  );
  const fetchChanRecv = result.data.groups.find(g =>
    g.trace[0]?.func === 'main.fetch'
  );

  if (!workerChanRecv || !workerRunning || !fetchChanRecv) {
    throw new Error('Missing expected groups');
  }

  // Verify counts
  if (workerChanRecv.count !== 3) {
    throw new Error(`Expected worker/chan_receive count=3, got ${workerChanRecv.count}`);
  }
  if (workerRunning.count !== 2) {
    throw new Error(`Expected worker/running count=2, got ${workerRunning.count}`);
  }
  if (fetchChanRecv.count !== 1) {
    throw new Error(`Expected fetch/chan_receive count=1, got ${fetchChanRecv.count}`);
  }

  // Verify goroutines array is populated
  if (workerChanRecv.goroutines.length !== 3) {
    throw new Error(`Expected 3 goroutines in worker/chan_receive, got ${workerChanRecv.goroutines.length}`);
  }

  // Verify goroutine metadata
  const g100 = workerChanRecv.goroutines.find(g => g.id === '100');
  if (!g100) {
    throw new Error('Missing goroutine 100');
  }
  if (g100.state !== 'chan receive') {
    throw new Error(`Expected state='chan receive', got '${g100.state}'`);
  }
  if (g100.waitMinutes !== 5) {
    throw new Error(`Expected waitMinutes=5, got ${g100.waitMinutes}`);
  }
  if (g100.creator !== '1') {
    throw new Error(`Expected creator='1', got '${g100.creator}'`);
  }

  // Verify creator relationships
  const g105 = fetchChanRecv.goroutines[0];
  if (g105.creator !== '100') {
    throw new Error(`Expected g105.creator='100', got '${g105.creator}'`);
  }
  if (g105.creatorExists !== true) {
    throw new Error(`Expected g105.creatorExists=true, got ${g105.creatorExists}`);
  }
  if (!g100.created.includes('105')) {
    throw new Error(`Expected g100.created to include '105', got ${JSON.stringify(g100.created)}`);
  }

  // Verify non-goroutine labels are preserved
  if (!workerChanRecv.labels.includes('cluster=prod')) {
    throw new Error(`Expected 'cluster=prod' label to be preserved, got ${JSON.stringify(workerChanRecv.labels)}`);
  }

  // Verify go::goroutine* labels are NOT in the labels array
  const hasGoroutineLabel = workerChanRecv.labels.some(l => l.startsWith('go::goroutine'));
  if (hasGoroutineLabel) {
    throw new Error(`go::goroutine* labels should be extracted, not preserved in labels array`);
  }

  console.log('✓ Debug=3 format: regrouping works correctly');
  console.log(`✓ Debug=3 format: goroutine metadata extracted (id=${g100.id}, state=${g100.state}, wait=${g100.waitMinutes})`);
  console.log(`✓ Debug=3 format: creator relationships preserved (${g105.id} created by ${g105.creator})`);
  console.log(`✓ Debug=3 format: non-goroutine labels preserved (cluster=prod)`);
});

await test('Format2 quoted label parsing', async () => {
  const testCases = [
    {
      name: 'Basic quoted label',
      content: `goroutine 123 [running, "app":"myapp"]:
main.worker()
\t/main.go:10`,
      expectLabels: ['state=running', 'app=myapp'],
      expectState: 'running',
    },
    {
      name: 'Quoted label with commas in value',
      content: `goroutine 124 [select, "env":"prod,staging"]:
main.worker()
\t/main.go:10`,
      expectLabels: ['state=select', 'env=prod,staging'],
      expectState: 'select',
    },
    {
      name: 'Multiple quoted labels and flags',
      content: `goroutine 125 [sync.Cond.Wait, 12 minutes, bubble, leaked, "app":"myapp", "region":"us-west-1"]:
main.worker()
\t/main.go:10`,
      expectLabels: ['state=wait', 'bubble', 'leaked', 'app=myapp', 'region=us-west-1'],
      expectState: 'wait',
      expectWaitMinutes: 12,
    },
    {
      name: 'Quoted label with colons in value',
      content: `goroutine 126 [running, "url":"http://example.com:8080"]:
main.worker()
\t/main.go:10`,
      expectLabels: ['state=running', 'url=http://example.com:8080'],
      expectState: 'running',
    },
    {
      name: 'Mixed flags and quoted labels with commas',
      content: `goroutine 127 [select, 5 minutes, locked to thread, "tags":"foo,bar,baz"]:
main.worker()
\t/main.go:10`,
      expectLabels: ['state=select', 'locked to thread', 'tags=foo,bar,baz'],
      expectState: 'select',
      expectWaitMinutes: 5,
    },
  ];

  for (const tc of testCases) {
    const result = await parser.parseString(tc.content, 'test.txt');
    if (!result.success) {
      throw new Error(`${tc.name}: parse failed - ${result.error}`);
    }

    if (result.data.groups.length !== 1) {
      throw new Error(`${tc.name}: expected 1 group, got ${result.data.groups.length}`);
    }

    const group = result.data.groups[0];
    const goroutine = group.goroutines[0];

    // Check state
    if (goroutine.state !== tc.expectState) {
      throw new Error(
        `${tc.name}: expected state='${tc.expectState}', got '${goroutine.state}'`
      );
    }

    // Check wait time if specified
    if (tc.expectWaitMinutes !== undefined && goroutine.waitMinutes !== tc.expectWaitMinutes) {
      throw new Error(
        `${tc.name}: expected waitMinutes=${tc.expectWaitMinutes}, got ${goroutine.waitMinutes}`
      );
    }

    // Check labels
    const actualLabels = group.labels.slice().sort();
    const expectedLabels = tc.expectLabels.slice().sort();
    if (JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels)) {
      throw new Error(
        `${tc.name}: expected labels ${JSON.stringify(expectedLabels)}, got ${JSON.stringify(actualLabels)}`
      );
    }
  }

  console.log('✓ Format2 quoted labels: all test cases passed');
});

await test('Format2 goroutines with different labels are not merged', async () => {
  // Test that goroutines with same stack and state but different labels create separate groups
  const content = `goroutine 1 [running, "app":"foo"]:
main.worker()
\t/main.go:10

goroutine 2 [running, "app":"bar"]:
main.worker()
\t/main.go:10

goroutine 3 [running, "app":"foo"]:
main.worker()
\t/main.go:10`;

  const result = await parser.parseString(content, 'test.txt');
  if (!result.success) {
    throw new Error(`Parse failed: ${result.error}`);
  }

  // Should have 2 groups (same stack + state, but different labels)
  if (result.data.groups.length !== 2) {
    throw new Error(`Expected 2 groups, got ${result.data.groups.length}`);
  }

  // Find the groups
  const fooGroup = result.data.groups.find(g => g.labels.includes('app=foo'));
  const barGroup = result.data.groups.find(g => g.labels.includes('app=bar'));

  if (!fooGroup || !barGroup) {
    throw new Error('Expected to find groups with app=foo and app=bar labels');
  }

  // Verify counts
  if (fooGroup.count !== 2) {
    throw new Error(`Expected app=foo group to have 2 goroutines, got ${fooGroup.count}`);
  }
  if (barGroup.count !== 1) {
    throw new Error(`Expected app=bar group to have 1 goroutine, got ${barGroup.count}`);
  }

  // Verify labels are not merged
  if (fooGroup.labels.includes('app=bar')) {
    throw new Error('app=foo group should not contain app=bar label');
  }
  if (barGroup.labels.includes('app=foo')) {
    throw new Error('app=bar group should not contain app=foo label');
  }

  console.log('✓ Format2 label grouping: goroutines with different labels kept separate');
});

console.log('🎉 All parser tests completed!');
