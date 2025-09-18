# Proposal: CLI Type Picker for Ground-Truth TypeScript Insight in AI Workflows

## Summary
Large language models (LLMs) confidently fabricate TypeScript types when they cannot see the compiler’s understanding of a project. Editors such as VS Code dodge this problem by leaning on the TypeScript language server (`tsserver`), but there is no lightweight CLI surface that an AI agent can query during code generation. We propose a small, scriptable TypeScript CLI—`tsp`—that exposes real compiler metadata (types, symbols, declarations, diagnostics) at any location in a project so LLMs can ground their completions in fact rather than guesswork.

## Background & Problem Statement
- **Hallucinated types break trust.** Codex- and GPT-style agents invent imports, return types, and module shapes because they operate on stale context.
- **Existing solutions are editor-bound.** IDEs talk to `tsserver`, but headless workflows lack an equivalent bridge.
- **LSP data is the missing ingredient.** Giving agents the same type graph that editors use would close the loop between generated code and real project state.

## Proposed Solution
Deliver a CLI wrapper around the TypeScript compiler API that:
1. Accepts a file location (`--line/--column`) or regex (`--regex`, `--index`) to target a symbol.
2. Loads compiler options from `tsconfig.json` (auto-discovered or supplied via `--project`).
3. Returns structured JSON containing:
   - `typeString`: human-readable type name.
   - `symbol`: resolved symbol name plus flag metadata.
   - `signatures`: call/construct signatures for callable types.
   - `properties`: summarized property list (optional to omit for smaller payloads).
   - `declarations`: file/line/kind/snippet for definitions.
   - `diagnostics`: TypeScript errors and warnings affecting the file.
4. Works well in pipelines (fast startup, JSON output by default, zero editor dependencies).

### Prototype Snapshot
The accompanying repository includes a Bun + TypeScript implementation of `tsp`:
```bash
# Type at line 15, column 9
node dist/cli.js path/to/file.ts --line 15 --column 9 --omit-properties

# Type extracted by regex match
node dist/cli.js path/to/file.ts --regex "createServer" --index 1 --compact
```

Sample JSON payload (trimmed):
```json
{
  "file": "/workspace/src/http.ts",
  "position": { "line": 42, "column": 13, "offset": 951 },
  "matchedText": "createServer",
  "typeString": "(config: ServerConfig) => Promise<HttpServer>",
  "symbol": { "name": "createServer", "flags": { "names": ["Function"] } },
  "diagnostics": []
}
```

## Impact
- **Reduces hallucinations.** Agents can ask the compiler for truth before suggesting code.
- **Improves autonomy.** CLI-first workflows (e.g., terminal copilots, CI bots) gain the same signal IDEs have enjoyed for years.
- **Paves the way for multi-language support.** The same pattern can wrap other LSP servers, positioning `tsp` as an extensible bridge between compilers and AI tooling.

## Next Steps
1. Harden the current prototype:
   - Keep a persistent `tsserver` process alive to eliminate repeated startup cost.
   - Cache project graphs per `tsconfig` for hot reloads.
2. Publish the CLI (npm + Homebrew) and define a versioned JSON schema.
3. Explore adapters for other ecosystems (Python, Rust, Go) via LSP over stdio.
4. Document integration patterns for prompt engineers and agent frameworks.

## Call for Feedback
- Which JSON fields matter most for your tooling? What can we omit to keep prompts small?
- Would a daemonized mode or HTTP bridge help integrate with your stack?
- Should language-agnostic abstractions land now, or after the TypeScript path stabilizes?

Please share use-cases, blockers, and desired extensions so we can evolve `tsp` into a reliable foundation for compiler-aware AI tooling.
