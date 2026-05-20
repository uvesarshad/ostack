import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
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

// Production builds always emit to the repo root (so `git clone` users and
// the GitHub Release zipper see a current main.js), AND additionally sync to
// VAULT_PATH for local dev.
// Dev/watch builds only emit to the vault when VAULT_PATH is set — keeps the
// repo's main.js untouched until you cut a release.
const outfile = (prod || !vaultPluginDir) ? "main.js" : path.join(vaultPluginDir, "main.js");

// Copy manifest.json + styles.css alongside main.js. In prod we mirror to both
// repo root and the vault (if VAULT_PATH is set).
function syncStatics() {
  const destinations = prod
    ? [".", ...(vaultPluginDir ? [vaultPluginDir] : [])]
    : [vaultPluginDir ?? "."];

  for (const dest of destinations) {
    for (const file of ["manifest.json", "styles.css"]) {
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, file));
    }
    // Mirror main.js to the second destination in prod (esbuild only writes
    // outfile once, so the vault copy needs to happen here).
    if (prod && dest === vaultPluginDir && fs.existsSync("main.js")) {
      fs.copyFileSync("main.js", path.join(dest, "main.js"));
    }
    if (vaultPluginDir && dest === vaultPluginDir) {
      console.log(`  ✓ synced → ${vaultPluginDir}`);
    }
  }
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
    ...builtinModules,
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
