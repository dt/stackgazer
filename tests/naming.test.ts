/**
 * Tests for the naming module - pure functions for stack naming and categorization
 */

import { test } from './shared-test-data.js';
import {
  generateStackName,
  generateCategoryName,
  generateStackSearchableText,
  isStdLib,
  type TitleRule,
  type CategoryRule
} from '../src/app/naming.js';
import type { Frame } from '../src/app/types.js';

// Test data for frames
const makeFrame = (func: string, file = 'test.go', line = 1): Frame => ({
  func,
  file,
  line
});

// Table-driven tests for isStdLib
await test('isStdLib function', async () => {
  const cases: Array<[string, boolean]> = [
    // [functionName, expected]
    ['fmt.Println', true],
    ['runtime.Gosched', true],
    ['sync.Mutex.Lock', true],
    ['main.main', false],
    ['main.worker', false],
    ['github.com/user/repo.Function', false],
    ['gopkg.in/yaml.v2.Unmarshal', false],
    ['net/http.HandlerFunc.ServeHTTP', true],
    ['context.WithCancel', true],
  ];

  for (const [funcName, expected] of cases) {
    const result = isStdLib(funcName);
    if (result !== expected) {
      throw new Error(`isStdLib("${funcName}") = ${result}, expected ${expected}`);
    }
  }
});

// Table-driven tests for generateStackName
await test('generateStackName with skip rules', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: TitleRule[];
    expected: string;
  }> = [
    {
      name: 'Empty trace',
      frames: [],
      rules: [],
      expected: 'empty',
    },
    {
      name: 'No rules',
      frames: [makeFrame('main.worker'), makeFrame('main.process')],
      rules: [],
      expected: 'main.worker',
    },
    {
      name: 'Skip rule',
      frames: [makeFrame('runtime.goexit'), makeFrame('main.worker')],
      rules: [{ skip: 'runtime.' }],
      expected: 'main.worker',
    },
    {
      name: 'Multiple skip rules',
      frames: [
        makeFrame('runtime.goexit'),
        makeFrame('testing.tRunner'),
        makeFrame('main.actualWork'),
      ],
      rules: [{ skip: 'runtime.' }, { skip: 'testing.' }],
      expected: 'main.actualWork',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateStackName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateStackName() = "${result}", expected "${expected}"`);
    }
  }
});

await test('generateStackName with trim rules', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: TitleRule[];
    expected: string;
  }> = [
    {
      name: 'Simple prefix trim',
      frames: [makeFrame('github.com/user/repo.Function')],
      rules: [{ trim: 'github.com/user/' }],
      expected: 'repo.Function',
    },
    {
      name: 'Regex trim with s/ syntax',
      frames: [makeFrame('main.(*Worker).Process')],
      rules: [{ trim: 's/\\(\\*([^)]+)\\)/$1/' }],
      expected: 'main.Worker.Process',
    },
    {
      name: 'Regex trim with s| syntax',
      frames: [makeFrame('rpc.makeInternalClientAdapter.func1')],
      rules: [{ trim: 's|^rpc\\.makeInternalClientAdapter.*$|rpc|' }],
      expected: 'rpc',
    },
    {
      name: 'Multiple trim rules cumulative',
      frames: [makeFrame('github.com/user/repo.(*Type).Method')],
      rules: [{ trim: 'github.com/user/' }, { trim: 's/\\(\\*([^)]+)\\)/$1/' }],
      expected: 'repo.Type.Method',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateStackName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateStackName() = "${result}", expected "${expected}"`);
    }
  }
});

await test('generateStackName with fold rules', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: TitleRule[];
    expected: string;
  }> = [
    {
      name: 'Simple fold',
      frames: [makeFrame('util/admission.(*WorkQueue).Admit'), makeFrame('main.process')],
      rules: [{ fold: 'util/admission', to: 'AC' }],
      expected: 'main.process → AC',
    },
    {
      name: 'Fold with while stdlib',
      frames: [
        makeFrame('main.worker'),
        makeFrame('fmt.Println'),
        makeFrame('sync.Mutex.Lock'),
        makeFrame('github.com/user/repo.Query'),
      ],
      rules: [{ fold: 'main.worker', to: 'Worker', while: 'stdlib' }],
      expected: 'github.com/user/repo.Query → Worker',
    },
    {
      name: 'Fold with while pattern',
      frames: [
        makeFrame('http.HandlerFunc.ServeHTTP'),
        makeFrame('http.(*ServeMux).ServeHTTP'),
        makeFrame('myapp.Handler'),
      ],
      rules: [{ fold: 'http.HandlerFunc', to: 'HTTP', while: 'http\\.' }],
      expected: 'myapp.Handler → HTTP',
    },
    {
      name: 'Fold no duplicate prepend',
      frames: [makeFrame('worker.Run'), makeFrame('worker.Process')],
      rules: [{ fold: 'worker.Run', to: 'Worker' }, { fold: 'worker.Process', to: 'Worker' }],
      expected: 'Worker',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateStackName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateStackName() = "${result}", expected "${expected}"`);
    }
  }
});

await test('generateStackName with find rules', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: TitleRule[];
    expected: string;
  }> = [
    {
      name: 'Simple find',
      frames: [
        makeFrame('runtime.goexit'),
        makeFrame('sync.Mutex.Lock'),
        makeFrame('database.Query'),
      ],
      rules: [{ find: 'database\\.', to: 'DB' }],
      expected: 'DB → runtime.goexit',
    },
    {
      name: 'Find with while',
      frames: [
        makeFrame('main.Run'),
        makeFrame('controller.Handle'),
        makeFrame('controller.validate'),
        makeFrame('controller.process'),
        makeFrame('database.Execute'),
      ],
      rules: [{ find: 'controller\\.', to: 'Controller', while: 'controller\\.' }],
      expected: 'database.Execute → Controller → main.Run',
    },
    {
      name: 'Multiple finds - use deepest match',
      frames: [
        makeFrame('main.Run'),
        makeFrame('http.Handle'),
        makeFrame('database.Query'),
      ],
      rules: [{ find: 'http\\.', to: 'HTTP' }, { find: 'database\\.', to: 'DB' }],
      expected: 'DB → main.Run',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateStackName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateStackName() = "${result}", expected "${expected}"`);
    }
  }
});

await test('generateStackName complex combinations', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: TitleRule[];
    expected: string;
  }> = [
    {
      name: 'Skip then trim then fold',
      frames: [
        makeFrame('runtime.goexit'),
        makeFrame('github.com/user/repo.(*Worker).Process'),
        makeFrame('database.Query'),
      ],
      rules: [
        { skip: 'runtime.' },
        { trim: 'github.com/user/' },
        { trim: 's/\\(\\*([^)]+)\\)/$1/' },
        { fold: 'github\\.com/user/repo\\.\\(\\*Worker\\)', to: 'Worker' },
      ],
      expected: 'database.Query → Worker',
    },
    {
      name: 'Real world example',
      frames: [
        makeFrame('runtime.goexit'),
        makeFrame('testing.tRunner'),
        makeFrame('github.com/cockroachdb/cockroach/pkg/util/admission.(*WorkQueue).Admit'),
        makeFrame('github.com/cockroachdb/cockroach/pkg/sql.(*connExecutor).execStmt'),
      ],
      rules: [
        { skip: 'runtime.' },
        { skip: 'testing.' },
        { trim: 'github.com/cockroachdb/cockroach/pkg/' },
        { fold: 'github.com/cockroachdb/cockroach/pkg/util/admission', to: 'AC' },
      ],
      expected: 'sql.(*connExecutor).execStmt → AC',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateStackName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateStackName() = "${result}", expected "${expected}"`);
    }
  }
});

// Table-driven tests for generateCategoryName
await test('generateCategoryName', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    rules: CategoryRule[];
    expected: string;
  }> = [
    {
      name: 'Empty trace',
      frames: [],
      rules: [],
      expected: '<frameless stack>',
    },
    {
      name: 'No rules - extract from bottom frame',
      frames: [makeFrame('worker.Process'), makeFrame('db/database.Query')],
      rules: [],
      expected: 'db',
    },
    {
      name: 'Skip rule',
      frames: [makeFrame('worker/pool.Process'), makeFrame('runtime.goexit')],
      rules: [{ skip: 'runtime.' }],
      expected: 'worker',
    },
    {
      name: 'Match rule with capture group',
      frames: [makeFrame('main.worker'), makeFrame('github.com/user/repo.Function')],
      rules: [{ match: 'github\\.com/[^/]+/([^.]+)' }],
      expected: 'repo',
    },
    {
      name: 'Match rule with #num syntax',
      frames: [makeFrame('main.worker'), makeFrame('pkg/util/admission.(*WorkQueue).Admit')],
      rules: [{ match: 'pkg/([^/]+)/.*#1' }],
      expected: 'util',
    },
    {
      name: 'Match rule with comment',
      frames: [makeFrame('main.worker'), makeFrame('database/sql.Query')],
      rules: [{ match: 'database/([^.]+) -- extract database operations' }],
      expected: 'sql',
    },
    {
      name: 'All frames skipped - fallback to top',
      frames: [makeFrame('main.worker'), makeFrame('runtime.goexit')],
      rules: [{ skip: 'main.' }, { skip: 'runtime.' }],
      expected: 'main.worker',
    },
    {
      name: 'Multiple skip and match rules',
      frames: [
        makeFrame('controller.Handle'),
        makeFrame('runtime.goexit'),
        makeFrame('sync.Mutex.Lock'),
        makeFrame('database.Query'),
      ],
      rules: [
        { skip: 'runtime.' },
        { skip: 'sync.' },
        { match: '([^.]+)\\.' },
      ],
      expected: 'database',
    },
  ];

  for (const { name, frames, rules, expected } of cases) {
    const result = generateCategoryName(frames, rules);
    if (result !== expected) {
      throw new Error(`${name}: generateCategoryName() = "${result}", expected "${expected}"`);
    }
  }
});

// Test generateStackSearchableText
await test('generateStackSearchableText', async () => {
  const cases: Array<{
    name: string;
    frames: Frame[];
    expected: string;
  }> = [
    {
      name: 'Empty trace',
      frames: [],
      expected: '',
    },
    {
      name: 'Single frame',
      frames: [makeFrame('main.worker', 'main.go', 42)],
      expected: 'main.worker main.go:42',
    },
    {
      name: 'Multiple frames',
      frames: [
        makeFrame('main.worker', 'main.go', 42),
        makeFrame('database.Query', 'db/query.go', 100),
      ],
      expected: 'main.worker main.go:42 database.query db/query.go:100',
    },
    {
      name: 'Case insensitive search text',
      frames: [makeFrame('HTTP.Handler', 'Server.go', 200)],
      expected: 'http.handler server.go:200',
    },
  ];

  for (const { name, frames, expected } of cases) {
    const result = generateStackSearchableText(frames);
    if (result !== expected) {
      throw new Error(`${name}: generateStackSearchableText() = "${result}", expected "${expected}"`);
    }
  }
});

// Edge cases and error handling
await test('Edge cases and regex handling', async () => {
  // Invalid regex in trim rule - should be ignored
  const frames = [makeFrame('main.worker')];
  const invalidRegexRule: TitleRule = { trim: 's/[invalid/replacement/' };
  const result1 = generateStackName(frames, [invalidRegexRule]);
  if (result1 !== 'main.worker') {
    throw new Error(`Invalid regex should be ignored: got "${result1}"`);
  }

  // Pattern with regex special chars that should match literally
  const frames2 = [makeFrame('util/admission.(*WorkQueue).Admit')];
  const literalRule: TitleRule = { fold: 'util/admission.(*WorkQueue)', to: 'WQ' };
  const result2 = generateStackName(frames2, [literalRule]);
  if (result2 !== 'WQ') {
    throw new Error(`Literal pattern match failed: got "${result2}"`);
  }

  // Empty while pattern
  const frames3 = [makeFrame('main.worker'), makeFrame('helper.func')];
  const emptyWhileRule: TitleRule = { fold: 'main.worker', to: 'Worker', while: '' };
  const result3 = generateStackName(frames3, [emptyWhileRule]);
  if (result3 !== 'helper.func → Worker') {
    throw new Error(`Empty while pattern failed: got "${result3}"`);
  }
});

console.log('✓ All naming module tests passed');