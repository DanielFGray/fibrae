# AST-grep Guide for fibrae

## Overview

ast-grep is a fast and polyglot tool for code structural search, lint, and rewriting at large scale. This guide covers practical usage examples for the fibrae project.

## Basic Pattern Syntax

### Meta Variables

- `$VAR` - matches single AST node
- `$$$` or `$$$ARGS` - matches zero or more AST nodes
- `$$VAR` - captures unnamed nodes (rare, advanced usage)
- `$_VAR` - non-capturing match (optimization)

### Variable Naming Rules

- Must start with `$`
- Name composed of `A-Z`, `_`, `0-9` only
- Valid: `$META`, `$META_VAR`, `$META_VAR1`, `$_`
- Invalid: `$invalid`, `$Svalue`, `$kebab-case`

## Common Patterns for TypeScript/Effect

### 1. Variable Renaming

```bash
# Rename a specific variable
ast-grep run --pattern 'let oldName = $VALUE' --rewrite 'let newName = $VALUE' --lang typescript file.ts --update-all

# Rename any variable declaration
ast-grep run --pattern 'let $OLD_NAME = $VALUE' --rewrite 'const $NEW_NAME = $VALUE' --lang typescript file.ts
```

### 2. Function Transformations

```bash
# Find all functions with specific signature
ast-grep run --pattern 'function $NAME($$$): Effect.Effect<$RETURN> { $$$ }' --lang typescript

# Replace unsafe operations
ast-grep run --pattern 'Ref.unsafeMake($VALUE)' --rewrite 'yield* Ref.make($VALUE)' --lang typescript --update-all
```

### 3. Effect.gen Patterns

```bash
# Find all Effect.gen usage
ast-grep run --pattern 'Effect.gen($GENERATOR)' --lang typescript

# Transform generator patterns
ast-grep run --pattern '() => { $$$ }' --rewrite 'Effect.gen(function* () { $$$ })' --lang typescript
```

### 4. Import Statement Handling

```bash
# Find specific imports
ast-grep run --pattern 'import * as $ALIAS from "$MODULE"' --lang typescript

# Transform import statements
ast-grep run --pattern 'import { $IMPORTS } from "$MODULE"' --rewrite 'import { $NEW_IMPORTS } from "$MODULE"' --lang typescript
```

## Advanced Techniques

### 1. Using Selectors

Selectors let you match specific AST node types:

```bash
ast-grep run --pattern '$EXPR' --selector 'call_expression' --lang typescript
```

### 2. Multi-Match Variables

Use `$$$` for matching multiple elements:

```bash
# Match function with any number of parameters
ast-grep run --pattern 'function $NAME($$$PARAMS) { $$$ }' --lang typescript

# Match array with any elements
ast-grep run --pattern '[$$$ELEMENTS]' --lang typescript
```

### 3. Capture Groups

Reuse same meta variable name to match identical nodes:

```bash
# Find assignments where left and right are the same
ast-grep run --pattern '$VAR = $VAR' --lang typescript
```

## Command Line Usage

### Basic Commands

```bash
# Search with pattern
ast-grep run --pattern 'PATTERN' --lang typescript file.ts

# Search and replace
ast-grep run --pattern 'OLD' --rewrite 'NEW' --lang typescript file.ts --update-all

# Apply rules from config
ast-grep scan file.ts

# Interactive mode
ast-grep run --pattern 'PATTERN' --rewrite 'NEW' -i file.ts
```

### Useful Flags

- `--update-all` - Apply all changes without confirmation
- `--json` - Output in JSON format (for working with jq)
- `--debug-query` - Show parsed AST for debugging
- `--strictness` - Control matching precision (cst, smart, ast, relaxed)

## Tips and Best Practices

### 1. Pattern Development

1. Start simple and iterate
2. Use the [ast-grep playground](https://ast-grep.github.io/playground.html) for testing
3. Use `--debug-query` to understand how patterns are parsed
4. Test patterns with edge cases

### 2. Performance

- Use non-capturing variables (`$_VAR`) when you don't need the value
- Be as specific as possible in patterns
- Use file filters to limit scope

### 3. Safety

- Always test transformations on a small subset first
- Use version control before running bulk transformations
- Review changes with `--interactive` mode for important transformations

### 4. Common Pitfalls

- Remember that patterns must be valid, parseable code
- Meta variables match single AST nodes, use `$$$` for multiple
- Pattern matching is syntactic, not semantic
- Be careful with whitespace and formatting in patterns

## Example Rules for fibrae

See the `rules/` directory for practical examples:

- `no-console-log.yml` - Enforce Effect.log usage
- `no-as-any.yml` - Prevent any type usage
- `no-run-promise.yml` - Prevent direct Effect.runPromise usage

## Debugging

### Common Issues

1. **Pattern not matching**: Use `--debug-query` to see parsed AST
2. **Invalid pattern**: Ensure pattern is valid TypeScript syntax
3. **Overly broad matches**: Add more context to pattern
4. **Missing matches**: Check if pattern is too specific

### Debug Commands

```bash
# See how pattern is parsed
ast-grep run --pattern 'YOUR_PATTERN' --debug-query --lang typescript

# Test without files to validate pattern
ast-grep run --pattern 'YOUR_PATTERN' --lang typescript /dev/null
```

## Integration

### With Build Tools

Add to package.json scripts:

```json
{
  "scripts": {
    "lint:ast-grep": "ast-grep scan src/",
    "fix:ast-grep": "ast-grep scan src/ --update-all"
  }
}
```

### With CI/CD

```bash
# In CI, fail on any rule violations
ast-grep scan src/ || exit 1
```

## Resources

- [ast-grep Documentation](https://ast-grep.github.io/)
- [Online Playground](https://ast-grep.github.io/playground.html)
- [Rule Examples](https://ast-grep.github.io/catalog/)
- [Pattern Syntax Guide](https://ast-grep.github.io/guide/pattern-syntax.html)
