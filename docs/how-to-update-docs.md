# How to Update Documentation

> **Scope:** Rules and workflow for maintaining project documentation. **Rendering context:** N/A **Last updated:** 2026-05-14

## CORE PRINCIPLE

Documentation is code. Every meaningful change to the codebase that affects behavior, structure, interfaces, or flow MUST be reflected in /docs before the task is considered complete.

---

## WHEN TO UPDATE DOCS

Trigger a documentation update whenever any of the following occur:

### Always update
- A new skill is added or removed from built-in skills.
- A new UI component (Modal, View, Input) is created.
- A new LLM provider or provider feature (e.g., model support) is added.
- A new setting is added to the configuration.
- The vault traversal or scoring logic changes.
- A new dependency that affects architecture is introduced.

### Update if behavior changes
- A command's behavior or registration logic changes.
- The context assembly format (XML tags) is modified.
- Error handling or user feedback patterns change.
- The output routing logic (inline vs new-note) is restructured.

---

## HOW TO IDENTIFY WHICH FILES TO UPDATE

Follow this decision tree for every code change:

1. Does it affect the skill loading or runner logic?
   → Update docs/modules/skill-engine.md

2. Does it change how notes are found or scored?
   → Update docs/modules/context-engine.md

3. Does it add or change a UI element?
   → Update docs/modules/ui-system.md and docs/ui/component-library.md

4. Does it change how the plugin fits into Obsidian?
   → Update docs/ui/layout-system.md or docs/architecture/execution-model.md

5. Does it add or change an LLM provider?
   → Update docs/api/llm-providers.md

6. Does it change how data is persisted?
   → Update docs/api/storage.md

7. Does it add or change a setting?
   → Update docs/infra/environment.md

8. Does it change the build or test process?
   → Update docs/infra/deployment.md or docs/infra/testing.md

9. Does any of the above affect the project's top-level mental model?
   → Update docs/overview.md

---

## SPLITTING FILES THAT EXCEED 200 LINES

If an update causes a file to exceed 200 lines:
1. Identify a natural split point.
2. Create <original-name>-part2.md.
3. Cross-reference using AGENT SEE tags in both files.
4. Update docs/overview.md.

---

## UPDATE COMMIT CHECKLIST

- [ ] All affected doc files identified using the decision tree.
- [ ] No references to deleted files or old names remain.
- [ ] No file exceeds 200 lines.
- [ ] docs/overview.md reflects any structural changes.
- [ ] New AGENT NOTE:, AGENT SEE:, or AGENT AVOID: annotations added.
- [ ] No code blocks introduced (references only).
- [ ] All file paths and names match the codebase exactly.