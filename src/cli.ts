#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { pickType, PositionQuery, RegexQuery, TypeInfo, TypeQuery } from "./picker.js";

type CliOptionKeys =
  | "line"
  | "column"
  | "regex"
  | "regex-flags"
  | "index"
  | "project"
  | "pretty"
  | "compact"
  | "help"
  | "version"
  | "omit-diagnostics"
  | "omit-properties"
  | "omit-signatures";

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      line: { type: "string" },
      column: { type: "string" },
      regex: { type: "string" },
      "regex-flags": { type: "string" },
      index: { type: "string" },
      project: { type: "string" },
      pretty: { type: "boolean" },
      compact: { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "omit-diagnostics": { type: "boolean" },
      "omit-properties": { type: "boolean" },
      "omit-signatures": { type: "boolean" },
    } satisfies Record<CliOptionKeys, { type: "string" | "boolean" }>,
  });

  if (values.version) {
    printVersion();
    process.exit(0);
  }

  if (values.help || positionals.length === 0) {
    printHelp(process.argv[1] ?? "tsp");
    process.exit(values.help ? 0 : 1);
  }

  const file = positionals[0];
  try {
    const query = buildQuery(file, values as Partial<Record<CliOptionKeys, string | boolean>>);
    const result = pickType(query);
    const transformed = applyOutputFilters(result, values);
    const pretty = resolvePretty(values);
    const json = JSON.stringify(transformed, null, pretty ? 2 : 0);
    process.stdout.write(`${json}\n`);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Error: ${error.message}\n`);
    } else {
      process.stderr.write(`Unexpected error: ${String(error)}\n`);
    }
    process.exit(1);
  }
}

function resolvePretty(values: Record<string, unknown>): boolean {
  if (typeof values.compact === "boolean") {
    return !values.compact;
  }
  if (typeof values.pretty === "boolean") {
    return values.pretty;
  }
  return true;
}

function buildQuery(
  file: string,
  values: Partial<Record<CliOptionKeys, string | boolean>>,
): TypeQuery {
  const project = typeof values.project === "string" ? values.project : undefined;
  const hasRegex = typeof values.regex === "string" && values.regex.length > 0;
  const hasLine = typeof values.line === "string";
  const hasColumn = typeof values.column === "string";

  if (hasRegex) {
    const regexQuery: RegexQuery = {
      file,
      project,
      regex: values.regex as string,
      regexFlags: typeof values["regex-flags"] === "string" ? (values["regex-flags"] as string) : undefined,
      matchIndex: typeof values.index === "string" ? Number(values.index) : undefined,
    };

    if (regexQuery.matchIndex !== undefined && Number.isNaN(regexQuery.matchIndex)) {
      throw new Error(`Invalid regex match index: ${values.index}`);
    }

    return regexQuery;
  }

  if (hasLine !== hasColumn) {
    throw new Error("Line and column must be provided together");
  }

  if (!hasLine || !hasColumn) {
    throw new Error("Provide either --regex or both --line and --column");
  }

  const line = Number(values.line);
  const column = Number(values.column);

  if (Number.isNaN(line) || Number.isNaN(column)) {
    throw new Error(`Invalid line or column: line=${values.line}, column=${values.column}`);
  }

  const positionQuery: PositionQuery = {
    file,
    project,
    line,
    column,
  };

  return positionQuery;
}

function applyOutputFilters(result: TypeInfo, values: Record<string, unknown>): TypeInfo {
  const clone: TypeInfo = {
    ...result,
    diagnostics: [...result.diagnostics],
    properties: [...result.properties],
    signatures: [...result.signatures],
  };

  if (values["omit-diagnostics"]) {
    clone.diagnostics = [];
  }

  if (values["omit-properties"]) {
    clone.properties = [];
  }

  if (values["omit-signatures"]) {
    clone.signatures = [];
  }

  return clone;
}

function printHelp(invokedAs: string): void {
  const bin = path.basename(invokedAs);
  const lines = [
    `${bin} <file> (--line <n> --column <n> | --regex <pattern>) [options]`,
    "",
    "Options:",
    "  --line <n>             1-based line number of the target token",
    "  --column <n>           1-based column number of the target token",
    "  --regex <pattern>      Regex pattern to match in the file",
    "  --regex-flags <flags>  Regex flags (defaults to global match)",
    "  --index <n>            Zero-based index for regex matches (default 0)",
    "  --project <path>       Path to tsconfig.json or project directory",
    "  --pretty               Pretty-print JSON output (default)",
    "  --compact              Emit compact JSON output",
    "  --omit-diagnostics     Exclude TypeScript diagnostics from the result",
    "  --omit-properties      Exclude property summaries from the result",
    "  --omit-signatures      Exclude signatures from the result",
    "  --version              Print the CLI version",
    "  --help                 Show this message",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function printVersion(): void {
  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  process.stdout.write(`${pkg.version ?? "0.0.0"}\n`);
}

main();
