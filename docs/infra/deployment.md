# Deployment and Build Process

> **Scope:** Describes the build pipeline and plugin distribution. **Rendering context:** N/A **Last updated:** 2026-05-14

## Overview

ogstack is built using esbuild to bundle all TypeScript source files and dependencies into a single JavaScript file (main.js) that Obsidian can load.

## Build Pipeline

### Scripts (package.json)
- npm run dev: Starts esbuild in watch mode for local development.
- npm run build: Performs a production build with minification and source maps.

### Configuration (esbuild.config.mjs)
- External Modules: Marks builtin-modules and obsidian as external to prevent them from being bundled.
- Output: Generates main.js and ensures styles.css is copied to the root.

## Distribution Format

An Obsidian plugin consists of three mandatory files in its folder:
1. main.js: The bundled code.
2. manifest.json: Metadata and permissions.
3. styles.css: Global styling.

## Release Workflow

1. Update the version number in manifest.json and package.json.
2. Run npm run build.
3. Create a GitHub release with the main.js, manifest.json, and styles.css as assets.

## Related Docs

- docs/architecture/folder-structure.md — For the purpose of the root files.
- docs/infra/testing.md — For the pre-deployment verification steps.
