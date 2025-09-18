import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface BaseQuery {
  file: string;
  project?: string;
}

export interface PositionQuery extends BaseQuery {
  line: number;
  column: number;
}

export interface RegexQuery extends BaseQuery {
  regex: string;
  regexFlags?: string;
  matchIndex?: number;
}

export type TypeQuery = PositionQuery | RegexQuery;

export interface DeclarationInfo {
  file: string;
  line: number;
  column: number;
  kind: string;
  snippet: string;
}

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface SignatureInfo {
  kind: "call" | "construct";
  signature: string;
}

export interface DiagnosticInfo {
  category: "error" | "warning" | "suggestion" | "message";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface TypeInfo {
  file: string;
  project?: string;
  position: {
    line: number;
    column: number;
    offset: number;
  };
  matchedText: string;
  nodeKind: string;
  typeString: string;
  typeFlags: {
    flags: number;
    names: string[];
  };
  symbol?: {
    name: string;
    flags: {
      flags: number;
      names: string[];
    };
  };
  signatures: SignatureInfo[];
  properties: PropertyInfo[];
  declarations: DeclarationInfo[];
  diagnostics: DiagnosticInfo[];
}

interface ProgramContext {
  program: ts.Program;
  host: ts.CompilerHost;
  configPath?: string;
}

type QueryResolution = {
  position: number;
  line: number;
  column: number;
  matchedText: string;
};

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  esModuleInterop: true,
  skipLibCheck: true,
  strict: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  allowSyntheticDefaultImports: true,
};

export function pickType(query: TypeQuery): TypeInfo {
  const resolvedFile = path.resolve(query.file);
  if (!fs.existsSync(resolvedFile)) {
    throw new Error(`File not found: ${resolvedFile}`);
  }

  const programContext = createProgramForFile(resolvedFile, query.project);
  const { program, host } = programContext;
  const checker = program.getTypeChecker();

  const canonical = host.getCanonicalFileName(resolvedFile);
  const sourceFile = program
    .getSourceFiles()
    .find((sf) => host.getCanonicalFileName(sf.fileName) === canonical);

  if (!sourceFile) {
    throw new Error(`Failed to load source file: ${resolvedFile}`);
  }

  const resolution = resolvePosition(sourceFile, query);
  const node = findClosestNode(sourceFile, resolution.position);

  const type = checker.getTypeAtLocation(node);
  const typeFlags = collectTypeFlagNames(type.getFlags());
  const symbol = checker.getSymbolAtLocation(node) ?? type.getSymbol();

  const signatures = collectSignatures(type, checker, node);
  const properties = collectProperties(type, checker, node);
  const declarations = symbol ? collectDeclarations(symbol, checker) : [];
  const diagnostics = collectDiagnostics(program, sourceFile);
  const matchedText = resolution.matchedText && resolution.matchedText.length > 0
    ? resolution.matchedText
    : node.getText();

  return {
    file: path.normalize(resolvedFile),
    project: programContext.configPath,
    position: {
      line: resolution.line,
      column: resolution.column,
      offset: resolution.position,
    },
    matchedText,
    nodeKind: ts.SyntaxKind[node.kind],
    typeString: checker.typeToString(
      type,
      node,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseFullyQualifiedType |
        ts.TypeFormatFlags.WriteArrowStyleSignature |
        ts.TypeFormatFlags.AddUndefined |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    ),
    typeFlags: {
      flags: type.getFlags(),
      names: typeFlags,
    },
    symbol: symbol
      ? {
          name: checker.symbolToString(
            symbol,
            node,
            undefined,
            ts.SymbolFlags.All | ts.SymbolFlags.Optional,
          ),
          flags: {
            flags: symbol.getFlags(),
            names: collectSymbolFlagNames(symbol.getFlags()),
          },
        }
      : undefined,
    signatures,
    properties,
    declarations,
    diagnostics,
  };
}

function createProgramForFile(filePath: string, project?: string): ProgramContext {
  const configPath = resolveProjectConfig(filePath, project);

  if (!configPath) {
    const compilerHost = ts.createCompilerHost(DEFAULT_COMPILER_OPTIONS, true);
    return {
      program: ts.createProgram([filePath], DEFAULT_COMPILER_OPTIONS, compilerHost),
      host: compilerHost,
    };
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n");
    throw new Error(`Failed to read tsconfig at ${configPath}: ${message}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsed.errors.length > 0) {
    const message = parsed.errors
      .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, "\n"))
      .join("\n");
    throw new Error(`Failed to parse tsconfig at ${configPath}: ${message}`);
  }

  if (!parsed.fileNames.includes(filePath)) {
    parsed.fileNames.push(filePath);
  }

  const compilerHost = ts.createCompilerHost(parsed.options, true);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host: compilerHost,
  });

  return {
    program,
    host: compilerHost,
    configPath,
  };
}

function resolveProjectConfig(filePath: string, project?: string): string | undefined {
  if (project) {
    const resolvedProject = path.resolve(project);
    if (!fs.existsSync(resolvedProject)) {
      throw new Error(`Project path does not exist: ${resolvedProject}`);
    }

    const stat = fs.statSync(resolvedProject);
    if (stat.isDirectory()) {
      const candidate = path.join(resolvedProject, "tsconfig.json");
      if (!fs.existsSync(candidate)) {
        throw new Error(`No tsconfig.json found in ${resolvedProject}`);
      }
      return candidate;
    }

    const ext = path.extname(resolvedProject);
    if (ext !== ".json") {
      throw new Error(`Project file must be a tsconfig.json, got: ${resolvedProject}`);
    }
    return resolvedProject;
  }

  const directory = path.dirname(filePath);
  return ts.findConfigFile(directory, ts.sys.fileExists, "tsconfig.json");
}

function resolvePosition(sourceFile: ts.SourceFile, query: TypeQuery): QueryResolution {
  if (isRegexQuery(query)) {
    const { regex, regexFlags, matchIndex = 0 } = query;
    const flags = includeGlobalFlag(regexFlags ?? "");
    const matcher = new RegExp(regex, flags);
    const text = sourceFile.getFullText();
    let match: RegExpExecArray | null = null;
    let index = 0;

    while ((match = matcher.exec(text)) !== null) {
      if (index === matchIndex) {
        const position = match.index;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
        return {
          position,
          line: line + 1,
          column: character + 1,
          matchedText: match[0],
        };
      }
      index += 1;
      if (!matcher.global) {
        break;
      }
    }

    throw new Error(
      `Regex "${regex}" did not match index ${matchIndex} in ${sourceFile.fileName}`,
    );
  }

  const { line, column } = query;
  if (line <= 0 || column <= 0) {
    throw new Error("Line and column must be 1-based and positive");
  }

  const position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);

  return {
    position,
    line,
    column,
    matchedText: "",
  };
}

function findClosestNode(sourceFile: ts.SourceFile, position: number): ts.Node {
  let bestNode: ts.Node = sourceFile;

  const visit = (node: ts.Node) => {
    if (position < node.getFullStart() || position > node.getEnd()) {
      return;
    }
    if (position >= node.getStart() && position <= node.getEnd()) {
      bestNode = node;
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return bestNode;
}

function collectTypeFlagNames(flags: ts.TypeFlags): string[] {
  return collectFlagNames(ts.TypeFlags, flags);
}

function collectSymbolFlagNames(flags: ts.SymbolFlags): string[] {
  return collectFlagNames(ts.SymbolFlags, flags);
}

function collectFlagNames(flagEnum: Record<string, unknown>, flags: number): string[] {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(flagEnum)) {
    if (typeof value !== "number") {
      continue;
    }
    if (!isSingleBit(value)) {
      continue;
    }
    if ((flags & value) === 0) {
      continue;
    }
    names.add(name);
  }
  return Array.from(names).sort();
}

function isSingleBit(value: number): boolean {
  return value !== 0 && (value & (value - 1)) === 0;
}

function collectSignatures(
  type: ts.Type,
  checker: ts.TypeChecker,
  node: ts.Node,
  limit = 5,
): SignatureInfo[] {
  const signatures: SignatureInfo[] = [];

  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call).slice(0, limit)) {
    signatures.push({
      kind: "call",
      signature: checker.signatureToString(signature, node),
    });
  }

  for (const signature of checker
    .getSignaturesOfType(type, ts.SignatureKind.Construct)
    .slice(0, limit)) {
    signatures.push({
      kind: "construct",
      signature: checker.signatureToString(signature, node),
    });
  }

  return signatures;
}

function collectProperties(
  type: ts.Type,
  checker: ts.TypeChecker,
  node: ts.Node,
  limit = 25,
): PropertyInfo[] {
  const nonNullable = checker.getNonNullableType(type);
  const memberTypes = (nonNullable.flags & ts.TypeFlags.Union) !== 0
    ? (nonNullable as ts.UnionType).types ?? []
    : [nonNullable];

  const symbolByName = new Map<string, ts.Symbol>();
  const presenceByName = new Map<string, number>();
  const optionalFlagByName = new Map<string, boolean>();

  for (const member of memberTypes) {
    const apparent = checker.getApparentType(member);
    const props = checker.getPropertiesOfType(apparent);
    const seen = new Set<string>();
    for (const prop of props) {
      const name = prop.getName();
      if (!symbolByName.has(name)) {
        symbolByName.set(name, prop);
      }
      if (!seen.has(name)) {
        presenceByName.set(name, (presenceByName.get(name) ?? 0) + 1);
        seen.add(name);
      }
      if ((prop.getFlags() & ts.SymbolFlags.Optional) !== 0) {
        optionalFlagByName.set(name, true);
      } else if (!optionalFlagByName.has(name)) {
        optionalFlagByName.set(name, false);
      }
    }
  }

  const names = Array.from(symbolByName.keys()).sort();
  const totalMembers = memberTypes.length > 0 ? memberTypes.length : 1;

  const properties: PropertyInfo[] = [];
  for (const name of names.slice(0, limit)) {
    const symbol = symbolByName.get(name)!;
    const declarations = symbol.getDeclarations();
    const declaration = declarations?.[0];
    const propertyType = checker.getTypeOfSymbolAtLocation(symbol, declaration ?? node);
    const optionalByUnion = (presenceByName.get(name) ?? 0) < totalMembers;
    const optionalByFlag = optionalFlagByName.get(name) ?? false;
    properties.push({
      name,
      type: checker.typeToString(propertyType, declaration ?? node),
      optional: optionalByFlag || optionalByUnion,
    });
  }

  return properties;
}

function collectDeclarations(symbol: ts.Symbol, checker: ts.TypeChecker, limit = 10): DeclarationInfo[] {
  const declarations = symbol.getDeclarations() ?? [];
  return declarations.slice(0, limit).map((declaration) => {
    const source = declaration.getSourceFile();
    const { line, character } = source.getLineAndCharacterOfPosition(
      declaration.getStart(source, false),
    );
    const rawSnippet = source.text.slice(declaration.getStart(), declaration.getEnd());
    const snippet = condenseSnippet(rawSnippet);

    return {
      file: path.normalize(source.fileName),
      line: line + 1,
      column: character + 1,
      kind: ts.SyntaxKind[declaration.kind],
      snippet,
    };
  });
}

function collectDiagnostics(program: ts.Program, sourceFile: ts.SourceFile): DiagnosticInfo[] {
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);

  return diagnostics.map((diagnostic) => {
    const category = ts.DiagnosticCategory[diagnostic.category].toLowerCase() as DiagnosticInfo["category"];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const diagFile = diagnostic.file;
    const info: DiagnosticInfo = {
      category,
      message,
    };

    if (diagFile && typeof diagnostic.start === "number") {
      const { line, character } = diagFile.getLineAndCharacterOfPosition(diagnostic.start);
      info.file = path.normalize(diagFile.fileName);
      info.line = line + 1;
      info.column = character + 1;
    }

    return info;
  });
}

function condenseSnippet(snippet: string, maxLength = 160): string {
  const singleLine = snippet.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength)}…`;
}

function isRegexQuery(query: TypeQuery): query is RegexQuery {
  return (query as RegexQuery).regex !== undefined;
}

function includeGlobalFlag(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}
