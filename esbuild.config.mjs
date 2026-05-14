import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// ── Read optional VAULT_PATH from .env ────────────────────────────────────────
let vaultPluginDir = null;
try {
  const env = fs.readFileSync(".env", "utf8");
  const match = env.match(/^VAULT_PATH=(.+)$/m);
  if (match) {
    const raw = match[1].trim().replace(/^["']|["']$/g, "");
    vaultPluginDir = path.join(raw, ".obsidian", "plugins", "ogstack");
    if (!fs.existsSync(vaultPluginDir)) {
      fs.mkdirSync(vaultPluginDir, { recursive: true });
      console.log(`Created plugin folder: ${vaultPluginDir}`);
    }
  }
} catch {
  // No .env — outputs only to repo root
}

// Build outputs directly to vault when VAULT_PATH is set, otherwise repo root
const outfile = vaultPluginDir ? path.join(vaultPluginDir, "main.js") : "main.js";

// Copy manifest.json + styles.css alongside main.js
function syncStatics() {
  const dest = vaultPluginDir ?? ".";
  for (const file of ["manifest.json", "styles.css"]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, file));
  }
  if (vaultPluginDir) console.log(`  ✓ synced → ${vaultPluginDir}`);
}

// ── esbuild context ────────────────────────────────────────────────────────────
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile,
  plugins: [
    {
      name: "sync-statics",
      setup(build) {
        build.onEnd(() => syncStatics());
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
