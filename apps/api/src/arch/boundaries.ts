import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A source file with the relative import specifiers it references. */
export interface SourceFile {
  /** Path relative to the src root, posix-style (e.g. "modules/content/content.service.ts"). */
  path: string;
  imports: string[];
}

export interface Violation {
  file: string;
  specifier: string;
  resolved: string;
  reason: string;
}

const AREAS = ["modules", "verticals"] as const;
type Area = (typeof AREAS)[number];

interface Owner {
  area: Area;
  name: string;
}

function ownerOf(posixPath: string): Owner | null {
  const segs = posixPath.split("/");
  const area = segs[0];
  const name = segs[1];
  if (segs.length >= 2 && area !== undefined && name !== undefined && (AREAS as readonly string[]).includes(area)) {
    return { area: area as Area, name };
  }
  return null;
}

/** Resolve a relative import specifier against the file's dir (all posix, relative to src root). */
function resolveSpecifier(fileDir: string, specifier: string): string {
  const parts = (fileDir === "" ? [] : fileDir.split("/")).concat(specifier.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * A module/vertical may import another module/vertical ONLY through its public
 * barrel (its directory or `<area>/<name>/index`), never a deeper internal path.
 * The shared kernel (`platform/`) and external packages are always allowed.
 */
export function findBoundaryViolations(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const owner = ownerOf(file.path);
    if (!owner) continue;
    const fileDir = file.path.split("/").slice(0, -1).join("/");
    for (const specifier of file.imports) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveSpecifier(fileDir, specifier);
      const target = ownerOf(resolved);
      if (!target) continue;
      if (target.area === owner.area && target.name === owner.name) continue;
      const barrelDir = `${target.area}/${target.name}`;
      const isBarrel = resolved === barrelDir || resolved === `${barrelDir}/index`;
      if (!isBarrel) {
        violations.push({
          file: file.path,
          specifier,
          resolved,
          reason: `cross-module import must use the public barrel '${barrelDir}', not its internals`,
        });
      }
    }
  }
  return violations;
}

function extractImports(content: string): string[] {
  const specs: string[] = [];
  const fromRe = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  const sideRe = /\bimport\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(content)) !== null) specs.push(m[1]!);
  while ((m = sideRe.exec(content)) !== null) specs.push(m[1]!);
  return specs;
}

/** Walk the src tree and collect non-test, non-declaration TypeScript files. */
export function scanSourceFiles(srcRoot: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".d.ts") || entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      const rel = relative(srcRoot, full).split(sep).join("/");
      files.push({ path: rel, imports: extractImports(readFileSync(full, "utf8")) });
    }
  };
  walk(srcRoot);
  return files;
}
