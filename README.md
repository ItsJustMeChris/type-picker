# Type Picker CLI

A Bun-powered command line tool that asks the TypeScript compiler for ground-truth types. Designed to plug real compiler knowledge into LLM or automation workflows so they stop hallucinating imports, definitions, and module shapes.

## Features
- Query the type at any file location using line/column or a regex match.
- Outputs rich JSON including type strings, symbol metadata, signatures, property summaries, declaration snippets, and project-wide diagnostics.
- Points at diagnostics from the TypeScript compiler so AI agents can gracefully degrade when the program does not type-check.
- Fast to invoke from other tooling thanks to Bun + pure TypeScript implementation (no editor or IDE dependencies).

## Installation Script
Use the helper script to link `tsp` onto your PATH (defaults to `~/.local/bin`):

```bash
./scripts/tsp-manage.sh install
```

Update or remove the link later: as `./scripts/tsp-manage.sh update` or `./scripts/tsp-manage.sh uninstall`.

Set `TSP_INSTALL_PATH` to override the exact destination, or `TSP_INSTALL_DIR` to change just the parent directory.
`./scripts/tsp-manage.sh` will try to append the path export to your detected shell (zsh/bash) automatically; set `TSP_SKIP_PATH_UPDATE=1` to skip.

## Getting Started
Install dependencies (Bun will also generate the lockfile):

```bash
bun install
```

Build the distributable JavaScript and declaration files:

```bash
bun run build
```

You can run the compiled CLI directly with Node or Bun:

```bash
node dist/cli.js path/to/file.ts --line 10 --column 5
# or
bun run dist/cli.js -- path/to/file.ts --regex "loadUsers"
```

## CLI Usage
```
tsp <file> (--line <n> --column <n> | --regex <pattern>) [options]
```

| Option | Description |
| --- | --- |
| `--line <n>` / `--column <n>` | 1-based location of the node to inspect |
| `--regex <pattern>` | Regex used to locate the first match in the file (uses global matching by default) |
| `--regex-flags <flags>` | Custom flags for the regex search |
| `--index <n>` | Zero-based index of the regex match to inspect |
| `--project <path>` | Path to a `tsconfig.json` or a project directory to load compiler options |
| `--pretty` / `--compact` | Control JSON formatting (pretty is enabled by default) |
| `--omit-diagnostics` | Drop diagnostic messages from the output |
| `--omit-properties` | Drop the property summary table |
| `--omit-signatures` | Drop call / construct signature details |
| `--omit-project-diagnostics` | Drop project-wide diagnostics aggregated across the build graph |
| `--version` | Print the package version |
| `--help` | Display the usage summary |

### Example
```bash
node dist/cli.js examples/sample.ts --line 15 --column 9 --omit-properties --omit-diagnostics
```
Produces (truncated) JSON:

```json
{
  "file": "/path/to/examples/sample.ts",
  "position": { "line": 15, "column": 9, "offset": 288 },
  "matchedText": "users",
  "nodeKind": "Identifier",
  "typeString": "User[]",
  "symbol": {
    "name": "users",
    "flags": { "flags": 2, "names": ["BlockScopedVariable"] }
  }
  // …additional metadata omitted…
}
```

## Automating With LLMs
- Store the CLI on your `$PATH` (e.g. `npm install -g` in a future package, or symlink `dist/cli.js`).
- Have the agent call `tsp` before emitting completions that need accurate types.
- Inspect `diagnostics` to short-circuit when the program cannot be compiled yet.
- Trim the JSON payload or disable sections with `--omit-*` flags to keep prompts small.

## Development
- Run `bun run typecheck` while iterating to stay within TypeScript’s strict mode.
- Use `bun run dev -- <args>` to invoke the CLI directly from source with Bun’s transpiler.
- Rebuild with `bun run build` before packaging or committing compiled artifacts.

## Roadmap Ideas
- Keep a persistent `tsserver` process warm for faster repeated queries.
- Generalize the transport so non-TypeScript LSP servers can plug in.
- Add a streaming mode that yields minimal JSON for token-by-token prompting.

---
This project started as an experiment to make AI-assisted coding feel like using a real IDE—feedback and contributions welcome!
