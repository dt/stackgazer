# StackGazer - Go Stack Trace Analyzer

Interactive tool for analyzing Go collections of stack dumps with filtering, navigation, and visualization.

## Application Structure

Three-layer architecture: **Parser** (`/src/parser/`) → **App Layer** (`/src/app/`) → **UI Layer** (`/src/ui/`)

- **ProfileCollection.ts** - Core data management, filtering, grouping  
- **StackTraceApp.ts** - DOM manipulation and user interactions
- **AppState.ts** - Navigation history, **SettingsManager.ts** - Configuration

## Key Features

- Performance: Fast, responsive filtering even with large numbers of stacks
- Multi-file support with zip extraction
- Interactive navigation between creator/created goroutines
- Multiple display modes

## Filter Logic

Hierarchical visibility: **Stack** → **File** → **Group** → **Goroutine**
- Stack visible if ANY file section has visible goroutines
- Group visible if ANY goroutine matches filter
- Goroutine matches: `(stack_content OR group_labels OR goroutine_id)`

## Build Process
```bash
npm run build:bundle       # REQUIRED after changes - creates standalone HTML
npm test                   # Run unit tests  
```

## AI / Claude Development Guidelines

### File Management
- **NEVER create new files** unless explicitly told
- **ALWAYS extend existing test files**
- **Prefer editing** existing files over creating new ones

### Testing Approach  
- **Write concise, table-driven tests** with clear input→expectation tables
- **Eliminate duplicate setup** - use shared helpers and table-driven patterns
- **Minimize lines of test code** while maintaining full coverage

### Bug-Fixing Workflow
1. **Reproduce first**: Extend existing tests to reproduce the bug
2. **Fix core logic**: Make minimal changes to app layer business logic
3. **Verify**: New test passes, existing tests still pass
4. **Test before UI**: Fix ProfileCollection/AppState before StackTraceApp

### Interaction Style
- Be direct and honest - skip acknowledgments or pointless praise.
- Focus on accuracy and efficiency
- Suggest better alternatives when applicable