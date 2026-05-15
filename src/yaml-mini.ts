// Minimal YAML frontmatter parser. ogstack only uses flat `key: value` pairs
// with optional quotes — we deliberately don't pull in js-yaml to keep the
// bundle small and the behavior auditable. This handles:
//   - plain scalars:           name: research
//   - single/double quoted:    description: "hello: world"
//   - escaped quotes:          title: "she said \"hi\""
//   - list-style scalars:      allowed_tools: [a, b, c]   (returned as raw string,
//                                                          caller parses items)
//   - leading/trailing space
//   - blank lines & # comments
//
// It returns null if the frontmatter is malformed or contains a duplicate key.
// Multi-line strings, block scalars, anchors, and nested maps are NOT supported —
// callers should fall back to defaults for those.

export function parseYamlFrontmatter(input: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = input.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripTrailingComment(rawLine).trim();
    if (line === "") continue;

    const colonIdx = findKeyColon(line);
    if (colonIdx <= 0) {
      // Indented continuation / unparseable line — bail rather than guess.
      return null;
    }

    const key = line.slice(0, colonIdx).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) return null;
    if (Object.prototype.hasOwnProperty.call(out, key)) return null; // duplicate key — ambiguous

    const rawValue = line.slice(colonIdx + 1).trim();
    const parsed = parseScalar(rawValue);
    if (parsed === null) return null;
    out[key] = parsed;
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
