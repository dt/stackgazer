# StackGazer - Go Stack Trace Analyzer

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

## Files to Ignore
- **dist/** - Build artifacts
- **node_modules/** - Dependencies
- **examples/** - Example files