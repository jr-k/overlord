import { execFileSync } from "child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDir = join(rootDir, ".electron-package");
const rootPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

rmSync(packageDir, { recursive: true, force: true });
mkdirSync(packageDir, { recursive: true });

cpSync(join(rootDir, "dist"), join(packageDir, "dist"), { recursive: true });
cpSync(join(rootDir, "public"), join(packageDir, "public"), { recursive: true });
cpSync(join(rootDir, "electron", "assets"), join(packageDir, "electron", "assets"), { recursive: true });
cpSync(join(rootDir, "scripts"), join(packageDir, "scripts"), { recursive: true });

const build = structuredClone(rootPackage.build);
build.electronVersion = rootPackage.devDependencies.electron.replace(/^[^\d]*/, "");
build.directories = {
  ...build.directories,
  buildResources: "electron/assets",
  output: "../release",
};
build.files = [
  "dist/**/*",
  "electron/assets/**/*",
  "public/**/*",
  "scripts/**/*",
  "node_modules/**/*",
  "package.json",
];
build.mac.icon = "electron/assets/icon.icns";
build.win.icon = "electron/assets/icon.ico";
build.linux.icon = "electron/assets";

const packageJson = {
  name: rootPackage.name,
  version: rootPackage.version,
  description: rootPackage.description,
  author: rootPackage.author || "Overlord",
  type: rootPackage.type,
  main: rootPackage.main,
  private: true,
  dependencies: rootPackage.dependencies,
  build,
};

writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npmCommand, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: packageDir,
  stdio: "inherit",
});

execFileSync(
  npmCommand,
  ["rebuild", "better-sqlite3", `--runtime=electron`, `--target=${build.electronVersion}`, "--disturl=https://electronjs.org/headers"],
  {
    cwd: packageDir,
    stdio: "inherit",
  }
);

packageJson.dependencies = {};
writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
rmSync(join(packageDir, "package-lock.json"), { force: true });
