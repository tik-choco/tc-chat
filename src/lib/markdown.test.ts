import { describe, it, expect } from "vitest";
import { parseMarkdown, type MdBlock } from "./markdown";

// Convenience: most tests only care about a single paragraph's inline
// children, so unwrap that instead of repeating the block wrapper.
function inline(text: string) {
  const blocks = parseMarkdown(text);
  expect(blocks).toHaveLength(1);
  const block = blocks[0] as Extract<MdBlock, { type: "paragraph" }>;
  expect(block.type).toBe("paragraph");
  return block.children;
}

describe("parseMarkdown", () => {
  it("returns [] for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  it("parses a plain paragraph with no markup", () => {
    expect(inline("hello world")).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("parses bold with **", () => {
    expect(inline("**bold**")).toEqual([{ type: "strong", children: [{ type: "text", value: "bold" }] }]);
  });

  it("parses italic with * and _", () => {
    expect(inline("*em*")).toEqual([{ type: "em", children: [{ type: "text", value: "em" }] }]);
    expect(inline("_em_")).toEqual([{ type: "em", children: [{ type: "text", value: "em" }] }]);
  });

  it("parses strikethrough with ~~", () => {
    expect(inline("~~gone~~")).toEqual([{ type: "strike", children: [{ type: "text", value: "gone" }] }]);
  });

  it("parses inline code verbatim", () => {
    expect(inline("`code`")).toEqual([{ type: "code", value: "code" }]);
  });

  it("nests bold and italic: **bold *italic***", () => {
    expect(inline("**bold *italic***")).toEqual([
      {
        type: "strong",
        children: [
          { type: "text", value: "bold " },
          { type: "em", children: [{ type: "text", value: "italic" }] },
        ],
      },
    ]);
  });

  it("treats unmatched ** as literal text", () => {
    expect(inline("**bold")).toEqual([{ type: "text", value: "**bold" }]);
  });

  it("treats unmatched * as literal text", () => {
    expect(inline("*oops")).toEqual([{ type: "text", value: "*oops" }]);
  });

  it("code spans suppress formatting and autolinks inside them", () => {
    expect(inline("`*not bold* http://example.com`")).toEqual([
      { type: "code", value: "*not bold* http://example.com" },
    ]);
  });

  it("parses a valid http(s) link", () => {
    expect(inline("[site](https://example.com/page)")).toEqual([
      { type: "link", href: "https://example.com/page", children: [{ type: "text", value: "site" }] },
    ]);
  });

  it("rejects javascript: links to plain text", () => {
    const src = "[click me](javascript:alert(1))";
    expect(inline(src)).toEqual([{ type: "text", value: src }]);
  });

  it("rejects links with an unparsable/relative url to plain text", () => {
    const src = "[home](/relative/path)";
    expect(inline(src)).toEqual([{ type: "text", value: src }]);
  });

  it("autolinks a bare URL and trims trailing sentence punctuation", () => {
    expect(inline("Check https://example.com/page. Thanks")).toEqual([
      { type: "text", value: "Check " },
      { type: "autolink", href: "https://example.com/page" },
      { type: "text", value: ". Thanks" },
    ]);
  });

  it("does not autolink non-http schemes", () => {
    expect(inline("see javascript:alert(1) now")).toEqual([
      { type: "text", value: "see javascript:alert(1) now" },
    ]);
  });

  it("joins multi-line paragraphs with hard breaks", () => {
    expect(inline("line one\nline two")).toEqual([
      { type: "text", value: "line one" },
      { type: "br" },
      { type: "text", value: "line two" },
    ]);
  });

  it("separates blocks on a blank line", () => {
    const blocks = parseMarkdown("first\n\nsecond");
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "first" }] },
      { type: "paragraph", children: [{ type: "text", value: "second" }] },
    ]);
  });

  it("parses headings level 1-3, requiring the space", () => {
    expect(parseMarkdown("# H1")).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", value: "H1" }] },
    ]);
    expect(parseMarkdown("## H2")).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", value: "H2" }] },
    ]);
    expect(parseMarkdown("### H3")).toEqual([
      { type: "heading", level: 3, children: [{ type: "text", value: "H3" }] },
    ]);
  });

  it("treats #### and #NoSpace as paragraph text, not a heading", () => {
    expect(parseMarkdown("#### not a heading")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "#### not a heading" }] },
    ]);
    expect(parseMarkdown("#NoSpace")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "#NoSpace" }] },
    ]);
  });

  it("parses a blockquote, recursively parsing its content as blocks", () => {
    expect(parseMarkdown("> # quoted heading\n> and text")).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "heading", level: 1, children: [{ type: "text", value: "quoted heading" }] },
          { type: "paragraph", children: [{ type: "text", value: "and text" }] },
        ],
      },
    ]);
  });

  it("parses unordered lists with - and *", () => {
    expect(parseMarkdown("- one\n* two")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { children: [{ type: "text", value: "one" }] },
          { children: [{ type: "text", value: "two" }] },
        ],
      },
    ]);
  });

  it("parses ordered lists and only sets start when the first number isn't 1", () => {
    expect(parseMarkdown("1. one\n2. two")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          { children: [{ type: "text", value: "one" }] },
          { children: [{ type: "text", value: "two" }] },
        ],
      },
    ]);
    expect(parseMarkdown("5. five\n6. six")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 5,
        items: [
          { children: [{ type: "text", value: "five" }] },
          { children: [{ type: "text", value: "six" }] },
        ],
      },
    ]);
  });

  it("does not support nested lists — a nested marker is literal text in the item", () => {
    // "- - inner" is just another top-level list item whose own content
    // happens to start with "- " — that inner marker is never re-parsed as
    // a nested list, it's plain literal text within the item.
    expect(parseMarkdown("- outer\n- - inner")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { children: [{ type: "text", value: "outer" }] },
          { children: [{ type: "text", value: "- inner" }] },
        ],
      },
    ]);
  });

  it("parses fenced code blocks verbatim, with an optional language tag", () => {
    expect(parseMarkdown("```ts\nconst x = 1;\n**not bold**\n```")).toEqual([
      { type: "codeBlock", lang: "ts", value: "const x = 1;\n**not bold**" },
    ]);
  });

  it("runs an unclosed fence to end of input", () => {
    expect(parseMarkdown("```js\nconst x = 1;")).toEqual([
      { type: "codeBlock", lang: "js", value: "const x = 1;" },
    ]);
  });

  it("parses a fence with no language tag", () => {
    expect(parseMarkdown("```\nplain\n```")).toEqual([{ type: "codeBlock", lang: undefined, value: "plain" }]);
  });

  it("never throws on pathological input", () => {
    const inputs = [
      "*".repeat(50),
      "`".repeat(20),
      "[[[[]]]](((((",
      "~*_`~*_`~*_`",
      "```\n".repeat(5),
    ];
    for (const input of inputs) {
      expect(() => parseMarkdown(input)).not.toThrow();
    }
  });
});
