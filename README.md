# StackGazer

An interactive tool for analyzing Go stack trace dumps (goroutine profiles).

It is designed to make browsing profiles containing larger numbers of goroutines easier, in particular when analyzing a collection of many profiles captured from separate but related processes in a distributed system or service like CockroachDB.

[**Live Demo**](https://davidt.io/stackgazer)

## Features

- **Responsive, Quick Filtering**: Rapidly filter stacks by keywords or attributes.
- **Customizable Categorization**: Hierarchical organization of related and identical stacks for faster browsing, using configurable rules to determine groups and useful, informative names.
- **Interactive Navigation**: Navigate between creator/created goroutines with clickable links and with previews.
- **Multi-process/multi-file Analysis**: Combines and groups stack traces captured from multiple processes/nodes in a distributed system. Files can be added individually or en-masse via zip file.
- **Multiple Display Modes**: Different viewing options for stack traces and goroutines.
- **Local analysis**: Everything is processed locally in the browser; nothing is uploaded.
- **Customizable Settings**: Behavior can be customized through locally-stored settings with configurable defaults

### Categorization and Naming

Goroutines with the same stack are grouped together, and stacks are grouped into categories. How categories are chosen and how the stacks within them are named can be controlled by rules.

#### Stack Categorization

Stacks are grouped into categories based on where they started, or originated, using configured categorization rules:

* Skip patterns can skip over utility / library frames for categorization purposes
  * e.g. skip `sync.WaitGroup`'s `go()`, so `kv/kvserver/raft/raftserver.func1` is used instead.
* Extraction regex runs on origin frame
  * e.g. use prefix up to /, categorizing that as `kv/kvserver`

#### Stack Naming

Stack names describe a specific stack, nominally aiming to communicate where it is now, i.e. waiting on network, sorting ids, etc.

This is more or less the function in top frame of the stack, but sometimes that function isn't particularly meaningful on its own, i.e. there are many things a stack could have been doing to end up in "syscall", but so a title including the next frame as well could be more helpful `syscall myfile.Write` vs `syscall os/signal.signal_recv`. This can be configured via naming rules:

* **Skip rules** (`skip:function`) - Skip uninformative frames when generating titles
  * e.g. `skip:sync.runtime_Semacquire` skips runtime semaphore frames
* **Fold rules** (`fold:pattern->replacement`) - Replace verbose patterns with concise names  
  * e.g. `fold:sync.(*WaitGroup).Wait->waitgroup` shows "waitgroup" instead of the full method name
* **Stdlib folding** (`foldstdlib:package->name`) - Collapse standard library calls
  * e.g. `foldstdlib:net/http->net/http` and `foldstdlib:syscall.Syscall->syscall`
* **Complex folding** (`foldstdlib:pattern->name`) - Handle complex stdlib patterns
  * e.g. `foldstdlib:internal/poll.runtime_pollWait->netpoll` for network polling

### Other Configuration Options

- **Function/File Trimming**: Remove common prefixes from function names and file paths during parsing, affecting naming, categorization, and displayed stack traces.
- **ZIP File Patterns**: Custom regex patterns for extracting files from ZIP archives.

Default settings can be customized when the application is initialized by providing custom defaults to the SettingsManager constructor.

## Contributing

### Prerequisites

- Node.js (version 18 or higher)
- npm

### Building

```bash
# Install dependencies
npm install

# Build the standalone application
npm run build:bundle

# Development build with file watching
npm run watch

# Serve locally for development
npm run serve
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run UI tests specifically
npm run test:ui

# Run all test suites
npm run test:all
```

### Development Workflow

1. Make changes to TypeScript source files in `src/`
2. Run `npm run build:bundle` to create the standalone HTML bundle
3. Test your changes with `npm test`
4. Format code with `npm run format`

The build process creates a single standalone HTML file in `dist/index-standalone.html` that contains all CSS, JavaScript, and dependencies bundled together.

### Architecture

StackGazer uses a three-layer architecture:

- **Parser Layer** (`src/parser/`): Handles parsing stack traces and ZIP files
- **App Layer** (`src/app/`): Core data management, filtering, and business logic
- **UI Layer** (`src/ui/`): DOM manipulation and user interactions

Key components:
- `ProfileCollection.ts`: Core data management and filtering
- `StackTraceApp.ts`: Main application UI controller
- `SettingsManager.ts`: Configuration and settings persistence
- `AppState.ts`: Navigation history and state management