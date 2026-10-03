import { builtinModules } from "node:module";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";
import { nowIso, stableId, writeJson, type GraphEdge, type GraphNode, type MindGraph, type ProjectConfig, type UnresolvedImport } from "../../core/src/index.ts";
import { parseProject } from "../../parser/src/index.ts";

function normalizeRel(path: string): string {
  return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

function resolveCandidates(base: string, files: Map<string, GraphNode>): string | undefined {
  const candidates = [
    base,
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => base.replace(/\.(?:js|jsx|mjs|cjs)$/, extension)),
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}${extension}`),
    ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((index) => `${base}/${index}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

function resolvePythonImport(sourcePath: string, specifier: string, files: Map<string, GraphNode>): string | undefined {
  const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
  const module = specifier.slice(dots).replaceAll(".", "/");
  let base = dots ? dirname(sourcePath) : "";
  for (let level = 1; level < dots; level += 1) base = dirname(base);
  const path = normalizeRel(join(base, module));
  const candidates = [`${path}.py`, `${path}/__init__.py`];
  const direct = candidates.find((item) => files.has(item));
  if (direct) return direct;
  if (!dots) {
    const suffixes = candidates.map((item) => `/${item}`);
    const matches = [...files.keys()].filter((item) => candidates.includes(item) || suffixes.some((suffix) => item.endsWith(suffix)));
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function pythonModuleExists(specifier: string): boolean {
  const top = specifier.replace(/^\.+/, "").split(".")[0];
  if (!top) return false;
  const script = "import importlib.util,sys;raise SystemExit(0 if importlib.util.find_spec(sys.argv[1]) else 1)";
  const attempts = process.platform === "win32" ? [["py", "-3"], ["python"]] : [["python3"], ["python"]];
  return attempts.some((attempt) => {
    const command = attempt[0];
    if (!command) return false;
    const args = attempt.slice(1);
    const result = spawnSync(command, [...args, "-c", script, top], { stdio: "ignore" });
    return !result.error && result.status === 0;
  });
}

interface PackageManifest {
  dir: string;
  name?: string;
  dependencies: string[];
  entry?: string;
}

const ignoredDirectories = new Set([".git", ".projectmind", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv", "__pycache__", ".pytest_cache"]);

async function findPackageManifests(root: string, dir = root): Promise<PackageManifest[]> {
  const manifests: PackageManifest[] = [];
  const packagePath = join(dir, "package.json");
  if (existsSync(packagePath)) {
    const pkg = JSON.parse(await readFile(packagePath, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      exports?: string | Record<string, unknown>;
      types?: string;
      module?: string;
      main?: string;
    };
    const rootExport = typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."];
    const entry = typeof rootExport === "string" ? rootExport : pkg.types ?? pkg.module ?? pkg.main;
    manifests.push({
      dir,
      ...(pkg.name ? { name: pkg.name } : {}),
      dependencies: [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])],
      ...(entry ? { entry } : {}),
    });
  }
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.isDirectory() && !ignoredDirectories.has(item.name)) manifests.push(...await findPackageManifests(root, join(dir, item.name)));
  }
  return manifests;
}

function packageSpecifier(specifier: string): string {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? "";
}

function insideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

interface TypeScriptProject {
  configPath: string;
  options: ts.CompilerOptions;
  files: Set<string>;
  outputs: Map<string, string>;
}

async function compilerProjects(root: string): Promise<TypeScriptProject[]> {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  if (!configPath) return [];
  const projects: TypeScriptProject[] = [];
  const visited = new Set<string>();
  const resolvedRoot = await realpath(root);
  const visit = async (input: string): Promise<void> => {
    const candidate = extname(input) ? input : join(input, "tsconfig.json");
    if (!existsSync(candidate)) return;
    const canonical = await realpath(candidate);
    if (!insideRoot(resolvedRoot, canonical) || visited.has(canonical)) return;
    visited.add(canonical);
    const loaded = ts.readConfigFile(canonical, ts.sys.readFile);
    if (loaded.error) throw new Error(`Cannot read TypeScript config: ${ts.flattenDiagnosticMessageText(loaded.error.messageText, " ")}`);
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(canonical), undefined, canonical);
    const error = parsed.errors.find((item) => item.category === ts.DiagnosticCategory.Error);
    if (error) throw new Error(`Cannot parse TypeScript config: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
    const outputs = new Map<string, string>();
    for (const file of parsed.fileNames) {
      try {
        for (const output of ts.getOutputFileNames(parsed, file, false)) outputs.set(normalize(output), normalize(file));
      } catch { /* Files outside a project's emit set have no output mapping. */ }
    }
    projects.push({ configPath: canonical, options: parsed.options, files: new Set(parsed.fileNames.map(normalize)), outputs });
    for (const reference of parsed.projectReferences ?? []) await visit(reference.path);
  };
  await visit(configPath);
  return projects;
}

function resolveImport(root: string, sourcePath: string, specifier: string, language: "javascript" | "python", files: Map<string, GraphNode>, projects: TypeScriptProject[], workspaces: Map<string, PackageManifest>): { path?: string; external?: boolean; reason?: UnresolvedImport["reason"] } {
  if (language === "python") {
    const path = resolvePythonImport(sourcePath, specifier, files);
    if (path) return { path };
    return pythonModuleExists(specifier) ? { external: true } : { reason: "not-found" };
  }
  if (specifier.startsWith(".")) {
    const direct = resolveCandidates(normalizeRel(join(dirname(sourcePath), specifier)), files);
    if (direct) return { path: direct };
  }
  const absoluteSource = normalize(join(root, sourcePath));
  const project = projects.find((item) => item.files.has(absoluteSource));
  const options = project?.options ?? projects[0]?.options ?? { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext };
  const outputSources = new Map(projects.flatMap((item) => [...item.outputs.entries()]));
  const result = ts.resolveModuleName(specifier, absoluteSource, options, ts.sys).resolvedModule;
  if (result && !result.isExternalLibraryImport) {
    if (!insideRoot(root, result.resolvedFileName)) return { reason: "outside-scan" };
    const source = outputSources.get(normalize(result.resolvedFileName)) ?? result.resolvedFileName;
    const rel = normalizeRel(relative(root, source));
    const matched = resolveCandidates(rel, files);
    return matched ? { path: matched } : { reason: "outside-scan" };
  }
  const packageName = packageSpecifier(specifier);
  const workspace = workspaces.get(packageName);
  if (workspace) {
    const subpath = specifier.slice(packageName.length).replace(/^\//, "");
    const base = subpath ? join(workspace.dir, subpath) : join(workspace.dir, workspace.entry ?? "src/index.ts");
    const source = outputSources.get(normalize(base)) ?? base;
    const matched = resolveCandidates(normalizeRel(relative(root, source)), files);
    return matched ? { path: matched } : { reason: "outside-scan" };
  }
  return { reason: "not-found" };
}

export async function buildMindGraph(root: string, config: ProjectConfig): Promise<MindGraph> {
  const graphRoot = await realpath(resolve(root));
  const parsed = await parseProject(graphRoot, config.scanner.extensions, config.scanner.exclude, config.scanner.include);
  const manifests = await findPackageManifests(graphRoot);
  const workspaceByName = new Map(manifests.filter((item): item is PackageManifest & { name: string } => Boolean(item.name)).map((item) => [item.name, item]));
  const dependencyNames = [...new Set(manifests.flatMap((item) => item.dependencies))].filter((name) => !workspaceByName.has(name)).sort();
  const packages = dependencyNames.map((name) => ({ id: stableId("pkg", name), type: "PACKAGE" as const, name }));
  const projects = await compilerProjects(graphRoot);
  const nodes = [...parsed.files, ...parsed.symbols, ...packages];
  const edges: GraphEdge[] = [];
  const unresolvedImports: UnresolvedImport[] = [];
  const fileByPath = new Map(parsed.files.filter((node) => node.path).map((node) => [node.path as string, node]));
  const packageByName = new Map(packages.map((node) => [node.name, node]));

  for (const symbol of parsed.symbols) {
    if (!symbol.path) continue;
    const file = fileByPath.get(symbol.path);
    if (!file) continue;
    edges.push({
      id: stableId("edge", `CONTAINS:${file.id}:${symbol.id}`),
      type: "CONTAINS",
      from: file.id,
      to: symbol.id,
    });
  }

  for (const item of parsed.imports) {
    const from = fileByPath.get(item.sourcePath);
    if (!from) continue;
    const target = resolveImport(graphRoot, item.sourcePath, item.specifier, item.language, fileByPath, projects, workspaceByName);
    if (target.path) {
      const to = fileByPath.get(target.path);
      if (!to) continue;
      edges.push({
        id: stableId("edge", `IMPORTS:${from.id}:${to.id}`),
        type: "IMPORTS",
        from: from.id,
        to: to.id,
        metadata: { specifier: item.specifier },
      });
      continue;
    }
    const packageName = item.language === "python" ? item.specifier.replace(/^\.+/, "").split(".")[0] ?? "" : packageSpecifier(item.specifier);
    if (!packageName) continue;
    const pkg = packageByName.get(packageName);
    if (pkg) {
      edges.push({
        id: stableId("edge", `DEPENDS_ON:${from.id}:${pkg.id}`),
        type: "DEPENDS_ON",
        from: from.id,
        to: pkg.id,
        metadata: { specifier: item.specifier },
      });
      continue;
    }
    if (target.external) continue;
    if (!item.specifier.startsWith("node:") && !builtinModules.includes(item.specifier)) unresolvedImports.push({ sourcePath: item.sourcePath, specifier: item.specifier, reason: target.reason ?? "not-found" });
  }

  const tests = parsed.files.filter((node) => node.type === "TEST" && node.path);
  for (const test of tests) {
    const stem = (test.path as string)
      .replace(/(?:^|\/)(?:test|tests|__tests__)\//g, "")
      .replace(/\.(?:test|spec)(?=\.)/, "")
      .replace(extname(test.path as string), "");
    const target = parsed.files.find((node) => node.type === "FILE" && node.path && normalizeRel(node.path).replace(extname(node.path), "").endsWith(stem));
    if (target) {
      edges.push({
        id: stableId("edge", `TESTED_BY:${target.id}:${test.id}`),
        type: "TESTED_BY",
        from: target.id,
        to: test.id,
        metadata: { confidence: "heuristic", source: "filename" },
      });
    }
  }

  return {
    version: 1,
    generatedAt: nowIso(),
    parser: parsed.files.some((item) => item.path?.endsWith(".py")) ? "typescript-ast-5.9+python-ast-3" : "typescript-ast-5.9",
    nodes,
    edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
    unresolvedImports: [...new Map(unresolvedImports.map((item) => [`${item.sourcePath}\0${item.specifier}`, item])).values()]
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.specifier.localeCompare(b.specifier)),
  };
}

export async function persistMindGraph(root: string, graph: MindGraph): Promise<void> {
  await writeJson(join(root, ".projectmind", "graph.json"), graph);
}

export function graphStats(graph: MindGraph): Record<string, number> {
  const stats: Record<string, number> = { nodes: graph.nodes.length, edges: graph.edges.length };
  stats.unresolvedImports = graph.unresolvedImports.length;
  for (const node of graph.nodes) stats[node.type.toLowerCase()] = (stats[node.type.toLowerCase()] ?? 0) + 1;
  return stats;
}
