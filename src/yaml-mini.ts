// Minimal YAML frontmatter parser. ogstack only consumes a flat key/value map,
// but real SKILL.md files in the wild use a few extra YAML shapes — block
// scalars and block lists — so this parser supports them while staying small
// and auditable. Supported:
//   - plain scalars:           name: research
//   - single/double quoted:    description: "hello: world"
//   - escaped quotes:          title: "she said \"hi\""
//   - flow-list scalars:       allowed_tools: [a, b, c]  (returned as raw string)
//   - block scalars:           description: |
//                                line one
//                                line two
//   - folded block scalars:    description: >
//                                folded to a single space-joined line
//   - block sequences:         triggers:
//                                - one
//                                - two                   (returned as "[one, two]")
//   - leading/trailing space
//   - blank lines & # comments
//
// Anchors, nested maps, and tags are NOT supported. Malformed top-level lines
// (bad keys, unterminated quotes, duplicate keys) still cause a null return.
// Indented lines that don't belong to a known block are skipped rather than
// failing the whole parse — community SKILL.md files often have rich
// frontmatter with shapes we don't consume but shouldn't reject.

export function parseYamlFrontmatter(input: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = input.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];

    // Skip blank lines and pure-comment lines at the top level.
    const trimmedFull = stripTrailingComment(rawLine).trim();
    if (trimmedFull === "") { i++; continue; }

    // An indented line at the top level (outside a recognized block) is
    // skipped — it's almost certainly a continuation of a YAML shape we
    // don't model. Bailing here would refuse half the SKILL.md files in
    // the wild for no real benefit.
    if (/^\s/.test(rawLine)) { i++; continue; }

    const colonIdx = findKeyColon(trimmedFull);
    if (colonIdx <= 0) return null;

    const key = trimmedFull.slice(0, colonIdx).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) return null;
    if (Object.prototype.hasOwnProperty.call(out, key)) return null;

    const rawValue = trimmedFull.slice(colonIdx + 1).trim();

    // Block scalar: `key: |` (literal) or `key: >` (folded).
    if (rawValue === "|" || rawValue === ">") {
      const folded = rawValue === ">";
      i++;
      const collected: string[] = [];
      let baseIndent = -1;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") { collected.push(""); i++; continue; }
        const indent = ln.match(/^(\s*)/)?.[1].length ?? 0;
        if (indent === 0) break;
        if (baseIndent === -1) baseIndent = indent;
        if (indent < baseIndent) break;
        collected.push(ln.slice(baseIndent));
        i++;
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop();
      out[key] = folded
        ? collected.join(" ").replace(/\s+/g, " ").trim()
        : collected.join("\n");
      continue;
    }

    // Empty value: peek for a block sequence (`- item` lines indented under it).
    if (rawValue === "") {
      i++;
      const items: string[] = [];
      let consumed = false;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") { i++; continue; }
        if (!/^\s/.test(ln)) break;  // dedent — back to top level
        const m = ln.trim().match(/^-\s*(.*)$/);
        if (m) {
          // Strip surrounding quotes if present
          let v = m[1];
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          items.push(v);
          consumed = true;
          i++;
          continue;
        }
        // Indented non-list line under an empty key — skip (nested map we
        // don't model). Don't fail the parse.
        i++;
      }
      out[key] = consumed ? `[${items.join(", ")}]` : "";
      continue;
    }

    // Plain scalar (possibly quoted).
    const parsed = parseScalar(rawValue);
    if (parsed === null) return null;
    out[key] = parsed;
    i++;
  }

  return out;
}

// A `#` only starts a comment when it's preceded by whitespace AND we're not
// inside a quoted string. Cheap state machine — no full lexer needed.
function stripTrailingComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inDouble) { escape = true; continue; }
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      // require whitespace (or start) before # for it to be a comment
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

// Find the colon that separates key from value — but skip colons inside the
// value side. The trick: a YAML key colon is followed by space-or-EOL.
function findKeyColon(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ":") continue;
    if (i + 1 === line.length) return i;
    const next = line[i + 1];
    if (next === " " || next === "\t") return i;
  }
  return -1;
}

function parseScalar(s: string): string | null {
  if (s === "") return "";
  const c = s[0];
  if (c === '"' || c === "'") return parseQuoted(s, c);
  return s;
}

function parseQuoted(s: string, quote: string): string | null {
  // The string must start and end with the quote; everything between is content.
  if (s.length < 2 || s[s.length - 1] !== quote) return null;
  const body = s.slice(1, -1);
  if (quote === "'") {
    // single-quoted: no escape processing except for doubled '' → '
    return body.replace(/''/g, "'");
  }
  // double-quoted: process \", \\, \n, \t, \r — the common subset
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else out += next; // \" \\ \/ etc.
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
