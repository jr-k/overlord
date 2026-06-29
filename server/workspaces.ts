import { join } from "path";
import { readFileSync, existsSync, readdirSync, statSync, type Dirent } from "fs";
import { parse as parseYaml } from "yaml";

export interface WorkspaceInfo {
  type: "pnpm" | "yarn" | "npm" | "nx" | "lerna" | "subfolders" | null;
  packages: WorkspacePackage[];
}

const SUBFOLDER_IGNORE = new Set([
  "node_modules", "dist", "build", "out", "target", "coverage",
  ".next", ".nuxt", ".turbo", ".cache", ".vercel", ".netlify",
  ".git", ".idea", ".vscode", ".expo", ".yarn", ".pnpm-store",
  "vendor", "venv", ".venv", "__pycache__", ".DS_Store",
]);

export interface WorkspacePackage {
  name: string;
  path: string;       // relative path from monorepo root
  fullPath: string;    // absolute path
  category: "app" | "package" | "other";
  packageJson?: { name?: string; version?: string; description?: string };
}

/**
 * Detect if a project is a monorepo and list its workspaces
 */
export function detectWorkspaces(projectPath: string): WorkspaceInfo {
  // Try pnpm-workspace.yaml
  const pnpmPath = join(projectPath, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    try {
      const content = readFileSync(pnpmPath, "utf-8");
      const config = parseYaml(content);
      const patterns: string[] = config?.packages ?? [];
      return {
        type: "pnpm",
        packages: resolveGlobs(projectPath, patterns),
      };
    } catch {}
  }

  // Try package.json workspaces (yarn / npm)
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const workspaces = pkg.workspaces;
      if (workspaces) {
        const patterns: string[] = Array.isArray(workspaces)
          ? workspaces
          : workspaces.packages ?? [];
        return {
          type: pkg.packageManager?.startsWith("yarn") ? "yarn" : "npm",
          packages: resolveGlobs(projectPath, patterns),
        };
      }
    } catch {}
  }

  // Try nx.json
  if (existsSync(join(projectPath, "nx.json"))) {
    // Nx typically uses apps/ and libs/ or packages/
    const patterns = ["apps/*", "libs/*", "packages/*"];
    return {
      type: "nx",
      packages: resolveGlobs(projectPath, patterns),
    };
  }

  // Try lerna.json
  const lernaPath = join(projectPath, "lerna.json");
  if (existsSync(lernaPath)) {
    try {
      const lerna = JSON.parse(readFileSync(lernaPath, "utf-8"));
      const patterns: string[] = lerna.packages ?? ["packages/*"];
      return {
        type: "lerna",
        packages: resolveGlobs(projectPath, patterns),
      };
    } catch {}
  }

  // Fallback: not a monorepo. List immediate subfolders as scope candidates.
  // Useful for "container" project dirs that hold loose subprojects.
  return {
    type: "subfolders",
    packages: listSubfolders(projectPath),
  };
}

function listSubfolders(root: string): WorkspacePackage[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const results: WorkspacePackage[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (SUBFOLDER_IGNORE.has(entry.name)) continue;

    const fullPath = join(root, entry.name);
    let packageJson: WorkspacePackage["packageJson"];
    const pkgJsonPath = join(fullPath, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        packageJson = { name: raw.name, version: raw.version, description: raw.description };
      } catch {}
    }

    results.push({
      name: packageJson?.name ?? entry.name,
      path: entry.name,
      fullPath,
      category: "other",
      packageJson,
    });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Resolve workspace glob patterns (e.g., "apps/*", "packages/*") into actual directories
 */
function resolveGlobs(root: string, patterns: string[]): WorkspacePackage[] {
  const results: WorkspacePackage[] = [];

  for (const pattern of patterns) {
    // Simple glob: "apps/*" or "packages/**"
    const clean = pattern.replace(/\/?\*\*?$/, "");
    const dir = join(root, clean);

    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const fullPath = join(dir, entry.name);
      const relativePath = `${clean}/${entry.name}`;

      // Read package.json if exists
      let packageJson: WorkspacePackage["packageJson"];
      const pkgJsonPath = join(fullPath, "package.json");
      if (existsSync(pkgJsonPath)) {
        try {
          const raw = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          packageJson = {
            name: raw.name,
            version: raw.version,
            description: raw.description,
          };
        } catch {}
      }

      // Categorize based on parent directory name
      const category = guessCategory(clean, entry.name);

      results.push({
        name: packageJson?.name ?? entry.name,
        path: relativePath,
        fullPath,
        category,
        packageJson,
      });
    }
  }

  return results;
}

function guessCategory(parentDir: string, _name: string): "app" | "package" | "other" {
  const lower = parentDir.toLowerCase();
  if (lower.includes("app")) return "app";
  if (lower.includes("package") || lower.includes("lib") || lower.includes("module")) return "package";
  return "other";
}
