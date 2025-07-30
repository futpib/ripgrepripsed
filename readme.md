# ripgrepripsed

A CLI tool that combines the power of `ripgrep` (rg) and `sed` into a single workflow for searching and replacing text across files.

## Installation

```bash
npm install -g ripgrepripsed
# or
yarn global add ripgrepripsed
```

## Usage

```bash
rgrs [scripts...]
```

## Script Types

### ripgrep Search
Search for patterns using ripgrep:
```bash
rgrs "rg/pattern/flags"
```

Example:
```bash
rgrs "rg/function/g"  # Search for "function" globally
```

### sed Replacement
Apply sed replacements to matching regions:
```bash
rgrs "rg/old_pattern/g" "sed/s/old/new/g"
```

Example:
```bash
rgrs "rg/var /g" "sed/s/var /let /g"  # Replace var with let
```

### Files from stdin
Read file list from stdin to initialize or filter the pipeline:
```bash
echo -e "file1.js\nfile2.js" | rgrs "files-from-stdin" "rg/pattern/g"
```

### Negated Search
Exclude regions that match a pattern:
```bash
rgrs "rg/function/g" "!rg/test/g"  # Find functions but exclude test functions
```

### Glob Filtering
Filter results by file path patterns:
```bash
rgrs "rg/pattern/g" "glob/*.js" "print-files"
```

### Print Commands
- `print-files` - Output unique file paths containing matches
- `print-regions` - Output matching lines with line numbers (default)

## Examples

### Search and replace
```bash
# Find all instances of "console.log" and replace with "logger.info"
rgrs "rg/console\.log/g" "sed/s/console\.log/logger.info/g"
```

### Find files containing pattern
```bash
# List all files containing "TODO"
rgrs "rg/TODO/g" "print-files"
```

### Multiline search and replace
```bash
# Search across multiple lines using 's' flag
rgrs "rg/function.*{/s" "sed/s/function/async function/g"
```

### Filter files with glob patterns
```bash
# Only process TypeScript files
rgrs "rg/import/g" "glob/*.ts" "print-files"

# Process files in src directory
rgrs "rg/TODO/g" "glob/src/**/*" "print-regions"
```

### Use files from stdin
```bash
# Process only specific files from stdin
find . -name "*.js" | rgrs "files-from-stdin" "rg/console\.log/g" "sed/s/console\.log/logger.info/g"

# Use git to get modified files and search them
git diff --name-only | rgrs "files-from-stdin" "rg/TODO/g" "print-regions"
```

## Features

- **Region-based processing**: Groups consecutive matching lines for efficient sed operations
- **Multiline support**: Use the 's' flag for patterns spanning multiple lines
- **In-place editing**: sed changes are applied directly to files
- **Real-time processing**: Uses line-buffered output for immediate results
- **Glob filtering**: Filter results by file path patterns using minimatch syntax

## Dependencies

- `ripgrep` (rg) - Must be installed on your system
- `sed` - Standard Unix tool for text processing

## License

GPL-3.0