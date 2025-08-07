/**
 * Concise table-driven parser tests
 */

import { FileParser, ZipHandler, AsyncFileParser } from '../src/parser/index.js';
import JSZip from 'jszip';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, '../examples');

const parser = new FileParser();

// Test data constants
const format1Content = `goroutine profile: total 3
2 @ 0x1000
#\t0x1000\tmain.worker\t/main.go:10

1 @ 0x2000
#\t0x2000\tio.read\t/io.go:5`;

const format2Content = `goroutine 1 [running]:
main.worker()
\t/main.go:10 +0x10

goroutine 2 [select]:
main.worker()
\t/main.go:10 +0x10
created by main.start in goroutine 1

goroutine 3 [syscall]:
io.read()
\t/io.go:5 +0x05
created by worker.init in goroutine 10`;

const exampleStacks2Content = readFileSync(join(examplesDir, 'stacks.txt'), 'utf8');
const exampleStacksWithLabelsContent = readFileSync(join(examplesDir, 'stacks_with_labels.txt'), 'utf8');

// Test table
const tests = [
  { name: 'Format1', content: format1Content, expect: { groups: 2, total: 3 } },
  { name: 'Format2', content: format2Content, expect: { groups: 3, total: 3 } },
  { name: 'stacks.txt', content: exampleStacks2Content, expect: { groups: 254, total: 1404 } },
  {
    name: 'stacks_with_labels.txt',
    content: exampleStacksWithLabelsContent,
    expect: { groups: 545, total: 1402 },
  },
  { name: 'Empty', content: '', expect: { groups: 0, total: 0 } },
  { name: 'Malformed', content: 'invalid', expect: { groups: 0, total: 0 } },
];

// Run tests
async function runTests() {
  console.log('🧪 Parser tests');
  for (const t of tests) {
    const r = await parser.parseFile(t.content, t.name);
    if (!r.success) throw new Error(`${t.name}: parse failed`);

    const total = r.data.groups.reduce((sum, g) => sum + g.count, 0);
    if (r.data.groups.length !== t.expect.groups || total !== t.expect.total) {
      throw new Error(
        `${t.name}: expected ${t.expect.groups} groups ${t.expect.total} total, got ${r.data.groups.length} groups ${total} total`
      );
    }
  }

  // CreatorExists check for Format2
  const r2 = await parser.parseFile(format2Content, 'f2.txt');
  if (!r2.success) throw new Error('Format2 parse failed');
  const goroutines = r2.data.groups.flatMap((g: any) => g.goroutines);
  const [g1, g2, g3] = [
    goroutines.find((g: any) => g.id === '1'),
    goroutines.find((g: any) => g.id === '2'),
    goroutines.find((g: any) => g.id === '3'),
  ];
  if (
    g1?.creator !== '' ||
    g1?.creatorExists ||
    g2?.creator !== '1' ||
    !g2?.creatorExists ||
    g3?.creator !== '10' ||
    g3?.creatorExists
  ) {
    throw new Error('CreatorExists logic failed');
  }

  console.log('✅ Parsing and creatorExists logic verified');
}

await runTests();

// Zip extraction test
console.log('🧪 Zip extraction test');
async function testZipExtraction() {
  // Create a zip containing examples directory files
  const zip = new JSZip();
  zip.file('stacks.txt', exampleStacks2Content);
  zip.file('subdir/stacks.txt', exampleStacks2Content);
  zip.file('other.txt', 'not a stack file');

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

  // Create a mock File object for testing
  const mockFile = new File([zipBuffer], 'test.zip', { type: 'application/zip' });

  // Test default pattern (**/stacks.txt)
  const result = await ZipHandler.extractFiles(mockFile);
  if (result.files.length !== 2) {
    throw new Error(`Expected 2 stacks.txt files, got ${result.files.length}`);
  }

  console.log(`✅ Zip extraction: ${result.files.length} files extracted`);
}

await testZipExtraction();

// Async test
const asyncParser = new AsyncFileParser();
asyncParser.parseFile(format2Content, 'async.txt').then(result => {
  if (!result.success) throw new Error('Async parse failed');
  const total = result.data.groups.reduce((sum: any, g: any) => sum + g.count, 0);
  if (total !== 3) throw new Error('Async failed');
  console.log('✅ Async works');
  asyncParser.destroy();
});

console.log('🎉 All tests completed!');
