#!/usr/bin/env node

import { execSync, fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = process.cwd();
const port = process.env.PORT || 4747;

console.log(`\x1b[35m🏰 Overlord\x1b[0m`);
console.log(`   Root: ${rootDir}`);
console.log(`   Port: ${port}`);
console.log();

// Start the server
const serverPath = join(__dirname, "..", "server", "index.ts");

process.env.OVERLORD_ROOT = rootDir;
process.env.PORT = String(port);

const child = fork(serverPath, {
  execArgv: ["--import", "tsx"],
  env: process.env,
  stdio: "inherit",
});

// Open browser after a short delay
setTimeout(async () => {
  const open = (await import("open")).default;
  await open(`http://localhost:${port}`);
}, 1500);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
  process.exit(0);
});
