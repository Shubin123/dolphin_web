import { cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] || "../dolphin_web/web");
if (target === root) throw new Error("Export target must differ from source");
mkdirSync(target, { recursive: true });
for (const name of ["src", "cores", "core", "patches", "provenance", "tools", "tests", "docs", "LICENSE", "README.upstream.md", "CONTRIBUTING.md", "icon.png", "index.html", "package.json", ".gitignore", "coi-serviceworker.js"]) cpSync(resolve(root, name), resolve(target, name), { recursive: true });
console.log(`Exported runtime and corresponding source inputs to ${target}`);
