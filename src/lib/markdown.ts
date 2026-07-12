// Chat-flavored markdown: a small, safe subset parsed to a plain AST that
// MarkdownView renders directly to Preact VNodes. Raw HTML is NEVER parsed or
// emitted — remote peers send arbitrary text over P2P wires, so message bodies
// must only ever become DOM text nodes, not markup.
//
// Supported (Discord-like chat subset):
//   inline: **bold**, *italic* / _italic_, ~~strike~~, `code`,
//           [text](http(s)-url), bare http(s) URLs (autolink)
//   block:  ``` fenced code (optional language tag), > blockquote,
//           - / * unordered lists, 1. ordered lists, # / ## / ### headings,
//           paragraphs (single newline inside a paragraph = hard break)
// Not supported on purpose: images (media goes through the CID pipeline),
// tables, nested lists, raw HTML. Unknown syntax renders as literal text.
//
// Link safety: link/autolink hrefs are validated to http:/https: at parse
// time (reuse extractHttpUrls semantics) — javascript:, data:, etc. must
// come out as plain text, never as a link node.

import { splitByUrls } from "./linkPreview";

export type MdInline =
  | { type: "text"; value: string }
  | { type: "br" } // hard break inside a paragraph (single newline)
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "strike"; children: MdInline[] }
  | { type: "code"; value: string } // inline code: verbatim, no nested parsing
  | { type: "link"; href: string; children: MdInline[] } // href pre-validated http(s)
  | { type: "autolink"; href: string }; // bare URL; render href as its own label

export interface MdListItem {
  children: MdInline[];
}

export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | { type: "codeBlock"; lang?: string; value: string } // verbatim, no inline parsing
  | { type: "blockquote"; children: MdBlock[] }
  | { type: "list"; ordered: boolean; start?: number; items: MdListItem[] };

/** Parse message text into block-level AST. Never throws: any input that
 * doesn't match a construct falls back to literal text. */
export function parseMarkdown(text: string): MdBlock[] {
  if (!text) return [];
  try {
    return parseBlocks(text);
  } catch {
    // Should be unreachable (the parser is pure string scanning with no
    // recursion depth beyond one blockquote level), but per contract this
    // must never throw for remote, untrusted input.
    return [{ type: "paragraph", children: [{ type: "text", value: text }] }];
  }
}

// ---------------------------------------------------------------------------
// Block-level parsing (line-oriented)
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^```(\S*)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const BLOCKQUOTE_RE = /^>/;
const UL_RE = /^[-*] /;
const OL_RE = /^(\d+)\. /;
const HEADING_RE = /^(#{1,3}) (.*)$/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** True if `line` starts a block construct other than a paragraph — used to
 * decide when a paragraph's run of continuation lines must stop. */
function isBlockStart(line: string): boolean {
  return (
    FENCE_OPEN_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    HEADING_RE.test(line)
  );
}

function parseBlocks(text: string): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence; unclosed fences just hit EOF here
      blocks.push({ type: "codeBlock", lang, value: contentLines.join("\n") });
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(quoted.join("\n")) });
      continue;
    }

    if (UL_RE.test(line)) {
      const items: MdListItem[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push({ children: parseInline(lines[i].slice(2)) });
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    const olMatch = OL_RE.exec(line);
    if (olMatch) {
      const firstNum = parseInt(olMatch[1], 10);
      const items: MdListItem[] = [];
      while (i < lines.length) {
        const m = OL_RE.exec(lines[i]);
        if (!m) break;
        items.push({ children: parseInline(lines[i].slice(m[0].length)) });
        i++;
      }
      const block: MdBlock = { type: "list", ordered: true, items };
      if (firstNum !== 1) block.start = firstNum;
      blocks.push(block);
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    // Paragraph: this line plus every following non-blank line that doesn't
    // start a different block, joined with hard breaks.
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    const children: MdInline[] = [];
    paraLines.forEach((l, idx) => {
      if (idx > 0) children.push({ type: "br" });
      children.push(...parseInline(l));
    });
    blocks.push({ type: "paragraph", children });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline parsing (**bold**, *em*/_em_, ~~strike~~, `code`, [text](url), autolinks)
// ---------------------------------------------------------------------------

type EmphasisChar = "*" | "_" | "~";

interface EmphasisFrame {
  ch: EmphasisChar;
  size: 1 | 2;
  children: MdInline[];
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function wrapEmphasis(frame: EmphasisFrame): MdInline {
  if (frame.ch === "~") return { type: "strike", children: frame.children };
  if (frame.size === 2) return { type: "strong", children: frame.children };
  return { type: "em", children: frame.children };
}

/** How many delimiter chars a fresh open should consume from a run of
 * `remaining` chars. `~` only ever means strike (needs a pair); a lone `~`
 * can't open anything and falls back to literal text. `*` prefers bold (2)
 * when the run has enough left, otherwise em (1). `_` is always em. */
function openSize(ch: EmphasisChar, remaining: number): 0 | 1 | 2 {
  if (ch === "~") return remaining >= 2 ? 2 : 0;
  if (ch === "*") return (remaining >= 2 ? 2 : 1) as 1 | 2;
  return 1;
}

function mergeAdjacentText(nodes: MdInline[]): MdInline[] {
  const out: MdInline[] = [];
  for (const raw of nodes) {
    const node: MdInline = "children" in raw ? { ...raw, children: mergeAdjacentText(raw.children) } : raw;
    const prev = out[out.length - 1];
    if (node.type === "text" && prev && prev.type === "text") {
      prev.value += node.value;
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Core inline scanner. Single left-to-right pass; emphasis/strong/strike use
 * a small delimiter-run stack (à la CommonMark, simplified) so runs like the
 * trailing `***` in `**bold *italic***` correctly split into a 1-char close
 * (em) followed by a 2-char close (strong) instead of only ever matching the
 * first `**` it sees. Any delimiter left open at end-of-string is demoted
 * back to literal text (its raw marker + its already-parsed children spliced
 * into the parent) rather than dropped or left unbalanced. */
function scanInline(text: string, allowLinks: boolean): MdInline[] {
  const root: MdInline[] = [];
  const stack: EmphasisFrame[] = [];
  let buf = "";

  const currentArray = (): MdInline[] => (stack.length ? stack[stack.length - 1].children : root);

  const flush = () => {
    if (!buf) return;
    const arr = currentArray();
    for (const seg of splitByUrls(buf)) {
      if (seg.type === "url") {
        arr.push({ type: "autolink", href: seg.value });
      } else if (seg.value) {
        arr.push({ type: "text", value: seg.value });
      }
    }
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        currentArray().push({ type: "code", value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (allowLinks && ch === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      const parsedLink =
        closeBracket !== -1 && text[closeBracket + 1] === "("
          ? (() => {
              const closeParen = text.indexOf(")", closeBracket + 2);
              if (closeParen === -1) return null;
              const url = text.slice(closeBracket + 2, closeParen);
              if (!isHttpUrl(url)) return null;
              return { label: text.slice(i + 1, closeBracket), url, end: closeParen + 1 };
            })()
          : null;
      if (parsedLink) {
        flush();
        currentArray().push({
          type: "link",
          href: parsedLink.url,
          children: parseInline(parsedLink.label, false),
        });
        i = parsedLink.end;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      let j = i;
      while (j < text.length && text[j] === ch) j++;
      let remaining = j - i;
      flush();
      while (remaining > 0) {
        const top = stack[stack.length - 1];
        if (top && top.ch === ch && top.size <= remaining) {
          remaining -= top.size;
          stack.pop();
          currentArray().push(wrapEmphasis(top));
        } else {
          const size = openSize(ch, remaining);
          if (size === 0) {
            buf += ch.repeat(remaining);
            remaining = 0;
          } else {
            stack.push({ ch, size, children: [] });
            remaining -= size;
          }
        }
      }
      i = j;
      continue;
    }

    buf += ch;
    i++;
  }

  flush();
  // Anything still open never found its closer — demote to literal text,
  // innermost first, splicing accumulated children into the parent level.
  while (stack.length) {
    const frame = stack.pop()!;
    const parent = stack.length ? stack[stack.length - 1].children : root;
    parent.push({ type: "text", value: frame.ch.repeat(frame.size) });
    parent.push(...frame.children);
  }

  return root;
}

function parseInline(text: string, allowLinks = true): MdInline[] {
  return mergeAdjacentText(scanInline(text, allowLinks));
}
