// Token counts are estimates. No tokenizer is bundled: the vendors' current tokenizers are
// either unpublished (Anthropic) or several megabytes of vocabulary (OpenAI), and this tool
// has no dependencies. The ratios below are typical for English prose and for JSON schemas.
// Real counts vary by model family, often by 10 to 30 percent.

export const TEXT_CHARS_PER_TOKEN = 3.7;
export const JSON_CHARS_PER_TOKEN = 3.0;

// CJK, kana and hangul run close to one token per character.
const WIDE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;

/** Estimated tokens for prose or markdown. */
export function estimateText(s) {
  if (!s) return 0;
  const str = String(s);
  const wide = (str.match(WIDE) || []).length;
  const rest = [...str].length - wide;
  return Math.ceil(rest / TEXT_CHARS_PER_TOKEN + wide);
}

/** Estimated tokens for a JSON value: description strings count as prose, the structure as JSON. */
export function estimateJson(value) {
  const prose = [];
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'description' || k === 'title') && typeof x === 'string') prose.push(x);
        else o[k] = strip(x);
      }
      return o;
    }
    return v;
  };
  const structure = JSON.stringify(strip(value)) || '';
  return Math.ceil(structure.length / JSON_CHARS_PER_TOKEN) + prose.reduce((n, p) => n + estimateText(p), 0);
}

/** 12400 -> "12.4K", 860 -> "860", 1250000 -> "1.3M" */
export function fmtK(n) {
  if (n == null) return '?';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 9950 ? 1 : n < 99500 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

export const fmtInt = (n) => (n == null ? '?' : Math.round(n).toLocaleString('en-US'));
