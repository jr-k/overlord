import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const visualizerPath = resolve(
  process.cwd(),
  "node_modules",
  "@colbymchenry",
  "codegraph",
  "dist",
  "visualizer",
  "public",
  "index.html"
);

if (!existsSync(visualizerPath)) {
  console.log("[codegraph] visualizer not installed, skipping patch");
  process.exit(0);
}

const before = "              'curve-style': 'bezier',";
const after = [
  "              'curve-style': 'unbundled-bezier',",
  "              'control-point-weights': '0.24 0.76',",
  "              'control-point-distances': '-34 34',",
].join("\n");

const html = readFileSync(visualizerPath, "utf8");

if (html.includes(after)) {
  console.log("[codegraph] visualizer link rendering already patched");
  process.exit(0);
}

if (!html.includes(before)) {
  console.log("[codegraph] visualizer link rendering target not found, skipping patch");
  process.exit(0);
}

writeFileSync(visualizerPath, html.replace(before, after));
console.log(`[codegraph] patched visualizer link rendering at ${join("node_modules", "@colbymchenry", "codegraph")}`);
