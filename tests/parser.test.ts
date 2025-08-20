/**
 * Concise table-driven parser tests
 */

import { FileParser, ZipHandler } from '../src/parser/index.js';
import JSZip from 'jszip';
import { TEST_DATA, parser, test } from './shared-test-data.js';

// Test table
const parseTests = [
  { name: 'Format1', content: TEST_DATA.format1, expect: { groups: 3, total: 4 } },
  { name: 'Format2', content: TEST_DATA.format2, expect: { groups: 3, total: 4 } },
  { name: 'stacks.txt', content: TEST_DATA.exampleStacks2, expect: { groups: 254, total: 1404 } },
  { name: 'stacks_with_labels.txt', content: TEST_DATA.exampleWithLabels, expect: { groups: 545, total: 1402 } },
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
}

await runParseTests();

await test('Zip extraction', async () => {
  const zip = new JSZip();
  zip.file('stacks.txt', TEST_DATA.exampleStacks2);
  zip.file('subdir/stacks.txt', TEST_DATA.exampleStacks2);
  zip.file('other.txt', 'not a stack file');

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const mockFile = new File([zipBuffer], 'test.zip', { type: 'application/zip' });

  const result = await ZipHandler.extractFiles(mockFile);
  if (result.files.length !== 2) {
    throw new Error(`Expected 2 stacks.txt files, got ${result.files.length}`);
  }
});


console.log('🎉 All parser tests completed!');