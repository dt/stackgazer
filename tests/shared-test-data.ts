/**
 * Shared test data and helpers to eliminate duplication across test files
 */

import { ProfileCollection } from '../src/app/ProfileCollection.js';
import { FileParser } from '../src/parser/parser.js';
import { SettingsManager } from '../src/app/SettingsManager.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, '../examples');

// Standard test data
export const TEST_DATA = {
  format1: `goroutine profile: total 4
2 @ 0x1000
#	0x1000	main.worker	/main.go:10

1 @ 0x1000
# labels {"state":"running"}
#	0x1000	main.worker	/main.go:10

1 @ 0x2000
#	0x2000	io.read	/io.go:5`,

  format2: `goroutine 1 [running]:
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
created by main.start() in goroutine 1`,

  multiCategory: `goroutine 1 [running]:
main.worker()
	/main.go:10 +0x10

goroutine 2 [select]:
main.worker()
	/main.go:10 +0x10

goroutine 3 [running]:
io.read()
	/io.go:5 +0x05`,

  withTrimming: `goroutine 1 [running]:
main.worker()
	/usr/local/go/src/main.go:10 +0x10`,

  withManipulation: `goroutine 1 [running]:
runtime.gopark()
	runtime/proc.go:123 +0x10
sync.(*WaitGroup).Wait()
	sync/waitgroup.go:45 +0x20
main.worker()
	main.go:10 +0x30`,

  withFoldPrefix: `goroutine 1 [running]:
google.golang.org/grpc/internal/transport.(*Stream).waitOnHeader()
	external/org_golang_google_grpc/internal/transport/transport.go:331 +0x10
google.golang.org/grpc/internal/transport.(*Stream).RecvCompress()
	external/org_golang_google_grpc/internal/transport/transport.go:346 +0x20
google.golang.org/grpc.(*csAttempt).recvMsg()
	external/org_golang_google_grpc/stream.go:1066 +0x30
google.golang.org/grpc.(*clientStream).RecvMsg.func1()
	external/org_golang_google_grpc/stream.go:917 +0x40
google.golang.org/grpc.(*clientStream).withRetry()
	external/org_golang_google_grpc/stream.go:768 +0x50
google.golang.org/grpc.(*clientStream).RecvMsg()
	external/org_golang_google_grpc/stream.go:916 +0x60
google.golang.org/grpc.invoke()
	external/org_golang_google_grpc/call.go:78 +0x70
rpc.NewContext.ClientInterceptor.func8()
	pkg/util/tracing/grpcinterceptor/grpc_interceptor.go:185 +0x80
google.golang.org/grpc.(*ClientConn).Invoke()
	external/org_golang_google_grpc/call.go:40 +0x90
server/serverpb.(*statusClient).Stacks()
	github.com/cockroachdb/cockroach/pkg/server/serverpb/status.pb.go:8603 +0xa0`,

  exampleStacks2: readFileSync(join(examplesDir, 'stacks.txt'), 'utf8'),
  exampleWithLabels: readFileSync(join(examplesDir, 'stacks_with_labels.txt'), 'utf8'),
};

// Parser instance
export const parser = new FileParser();

// Test helpers
export async function addFile(
  collection: ProfileCollection,
  content: string,
  name: string,
  customName?: string
) {
  const result = await parser.parseString(content, name);
  if (!result.success) throw new Error('Parse failed');
  collection.addFile(result.data, customName);
  return collection;
}

export function assertCounts(
  collection: ProfileCollection,
  expectedStacks: number,
  expectedFiles: number,
  testName: string
) {
  const stacks = collection.getCategories().reduce((acc, x) => acc + x.stacks.length, 0);
  if (stacks !== expectedStacks) {
    throw new Error(`${testName}: expected ${expectedStacks} stacks, got ${stacks}`);
  }
  if (collection.getFileNames().length !== expectedFiles) {
    throw new Error(
      `${testName}: expected ${expectedFiles} files, got ${collection.getFileNames().length}`
    );
  }
}

export function assertFirstGoroutineIdPrefixed(
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

export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

// Create test settings using the real SettingsManager conversion logic
function createTestSettings() {
  const settingsManager = new SettingsManager(undefined, true);
  const appSettings = settingsManager.getSettings();
  
  // Convert using the same logic as StackTraceApp
  return {
    functionPrefixesToTrim: settingsManager.getFunctionTrimPrefixes(),
    filePrefixesToTrim: settingsManager.getFileTrimPrefixes(),
    titleManipulationRules: settingsManager.getTitleManipulationRules(),
    nameExtractionPatterns: appSettings.nameExtractionPatterns || [],
    zipFilePattern: appSettings.zipFilePattern,
    categoryRules: settingsManager.getCategoryRules(),
  };
}

export const DEFAULT_SETTINGS = createTestSettings();