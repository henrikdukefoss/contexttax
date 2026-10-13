// Small parsers for the config formats agents use. No dependencies.

/** JSON with comments and trailing commas (opencode.jsonc, VS Code-style settings). null on failure. */
export function parseJsonc(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // fall through to the comment-stripping parse
  }
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

const unquote = (s) => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(t[0] === '"' ? /\\(["\\n])/g : /''/g, (m, ch) => (t[0] === '"' ? (ch === 'n' ? '\n' : ch) : "'"));
  }
  return t;
};

function scalar(raw) {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === '' || t === '~' || t === 'null') return null;
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((x) => unquote(x))
      .filter((x) => x !== '');
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return unquote(t.replace(/\s+#.*$/, (m) => (/^["']/.test(t) ? m : '')));
}

/**
 * YAML frontmatter at the top of a markdown file: flat keys, quoted or plain scalars,
 * folded/literal blocks (> and |), inline [lists] and "- item" lists.
 * Returns { data, body }. Files without frontmatter return { data: {}, body: text }.
 */
export function frontmatter(text) {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || '');
  if (!m) return { data: {}, body: text || '' };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1];
    const rest = kv[2].trim();
    if (/^[>|][+-]?$/.test(rest)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      data[key] = rest.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (rest === '') {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
      const cont = [];
      while (!list.length && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) cont.push(lines[++i].trim());
      data[key] = list.length ? list : cont.length ? cont.join(' ') : null;
    } else {
      let v = rest;
      // plain multi-line scalar continued on indented lines
      while (!/^["'[]/.test(v) && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*-\s/.test(lines[i + 1])) v += ' ' + lines[++i].trim();
      data[key] = scalar(v);
    }
  }
  return { data, body: text.slice(m[0].length) };
}

/**
 * Enough TOML for Codex's config.toml: [tables] with dotted/quoted names, strings,
 * numbers, booleans, (multi-line) arrays and single-line inline tables.
 */
export function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = String(text || '').split(/\r?\n/);
  const splitKey = (k) => (k.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.\s]+/g) || []).map(unquote);
  const table = (path) => path.reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), root);
  const value = (raw) => {
    const t = raw.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      const o = {};
      for (const part of splitTop(t.slice(1, -1))) {
        const eq = part.indexOf('=');
        if (eq > 0) o[unquote(part.slice(0, eq))] = value(part.slice(eq + 1));
      }
      return o;
    }
    if (t.startsWith('[') && t.endsWith(']')) return splitTop(t.slice(1, -1)).map(value);
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(t)) return Number(t.replace(/_/g, ''));
    return unquote(t);
  };
  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i]).trim();
    if (!line) continue;
    const th = /^\[([^[\]]+)\]$/.exec(line);
    if (th) {
      cur = table(splitKey(th[1]));
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let raw = line.slice(eq + 1).trim();
    // multi-line array
    while (raw.startsWith('[') && depthOf(raw) > 0 && i + 1 < lines.length) raw += ' ' + stripComment(lines[++i]).trim();
    const keys = splitKey(line.slice(0, eq));
    const target = keys.length > 1 ? keys.slice(0, -1).reduce((o, k) => (o[k] = o[k] || {}), cur) : cur;
    target[keys[keys.length - 1]] = value(raw.replace(/,\s*]$/, ']'));
  }
  return root;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function depthOf(s) {
  let d = 0;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

function splitTop(s) {
  const parts = [];
  let d = 0;
  let q = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
