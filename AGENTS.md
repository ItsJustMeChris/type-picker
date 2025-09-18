# Using `tsp` in Agent Workflows

## Why `tsp` exists
Language models see tokens, not compiler graphs. When an agent needs to reason about TypeScript code, it often fabricates:
- nonexistent imports or module members,
- incorrect function signatures or generics,
- stale types after refactors.

`tsserver` already solves this for editors by exposing the real types, but agents rarely have an easy on-demand bridge. The `tsp` CLI fills that gap—use it to **ground completions in verified compiler data** before an agent writes code or explanations.

## Core loop for agents
1. **Identify the symbol** the agent wants to manipulate (e.g. a variable, function call, property access).
2. **Query `tsp`** for the authoritative type at that location:
   ```bash
   tsp src/user-service.ts --line 42 --column 15 --omit-properties
   ```
3. **Read the JSON** response:
   - `typeString` is the precise TypeScript type.
   - `symbol` shows how the compiler resolves the identifier.
   - `diagnostics` warns if the code currently fails to type-check (short-circuit fixes first!).
4. **Feed the findings back into the agent prompt** so completions cite the real type information.

## Pattern: Regex targeting
When line/column data isn’t handy, match the source instead:
```bash
tsp src/http.ts --regex "createServer" --index 0 --compact
```
`--index` chooses the Nth match. Combine with `--omit-*` flags to trim JSON for prompt budgets.

## Integration ideas
- **Pre-flight checks:** before generating a function body, call `tsp` on referenced symbols and inject the JSON into the reasoning chain.
- **Guardrails:** if `diagnostics` is non-empty, pivot the agent to fixing compilation errors instead of extending broken code.
- **Context packs:** store relevant `tsp` responses alongside retrieved source snippets so the agent has both syntax and semantic facts.

## Tips
- Run `./scripts/tsp-manage.sh install` and ensure the destination directory is on `PATH` so agents can invoke `tsp` without absolute paths.
- Use `--compact` for minimal JSON when tokens are tight; use `--omit-properties` if you only need the headline `typeString`.
- Cache results when looping—the compiler call is deterministic for unchanged files.

Grounding in compiler truth keeps agents from guessing. Make `tsp` your first hop before trusting a model’s TypeScript intuition.
