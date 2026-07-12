import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import { MarkdownView, renderBlocks } from "./MarkdownView";
import type { MdBlock, MdInline } from "../lib/markdown";

afterEach(cleanup);

// These tests build the AST by hand rather than going through parseMarkdown,
// which is owned + implemented in parallel by another worker (currently a
// stub). We only want to verify the AST -> VNode mapping here.

describe("MarkdownView end-to-end (real parseMarkdown -> renderBlocks)", () => {
  it("renders plain text", () => {
    const { getByText } = render(<MarkdownView text="plain text" />);
    expect(getByText("plain text")).toBeTruthy();
  });

  it("parses and renders inline formatting and autolinks together", () => {
    const { container } = render(
      <MarkdownView text="**bold** and *em* — see https://example.com/docs" />,
    );
    expect(container.querySelector("strong")!.textContent).toBe("bold");
    expect(container.querySelector("em")!.textContent).toBe("em");
    const a = container.querySelector("a.msg-link")!;
    expect(a.getAttribute("href")).toBe("https://example.com/docs");
  });

  it("parses and renders a multi-block message", () => {
    const text = "## Title\n```js\nconst x = 1;\n```\n> quoted\n- item";
    const { container } = render(<MarkdownView text={text} />);
    expect(container.querySelector("h2.md-h2")!.textContent).toBe("Title");
    expect(container.querySelector("pre.md-pre code.lang-js")!.textContent).toBe("const x = 1;");
    expect(container.querySelector("blockquote.md-quote")!.textContent).toBe("quoted");
    expect(container.querySelector("ul.md-list li")!.textContent).toBe("item");
  });

  it("never turns hostile input into markup: javascript: links and raw HTML stay text", () => {
    const { container } = render(
      <MarkdownView text={'[evil](javascript:alert(1)) <img src=x onerror=alert(1)>'} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("renderBlocks: block-level mapping", () => {
  it("paragraph -> <p class='md-p'>", () => {
    const blocks: MdBlock[] = [{ type: "paragraph", children: [{ type: "text", value: "hello" }] }];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const p = container.querySelector("p.md-p");
    expect(p).toBeTruthy();
    expect(p!.textContent).toBe("hello");
  });

  it("heading level 1/2/3 -> <h1|h2|h3 class='md-h md-hN'>", () => {
    const blocks: MdBlock[] = [
      { type: "heading", level: 1, children: [{ type: "text", value: "H1" }] },
      { type: "heading", level: 2, children: [{ type: "text", value: "H2" }] },
      { type: "heading", level: 3, children: [{ type: "text", value: "H3" }] },
    ];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    expect(h1!.className).toBe("md-h md-h1");
    expect(h1!.textContent).toBe("H1");
    expect(h2!.className).toBe("md-h md-h2");
    expect(h2!.textContent).toBe("H2");
    expect(h3!.className).toBe("md-h md-h3");
    expect(h3!.textContent).toBe("H3");
  });

  it("codeBlock -> <pre class='md-pre'><code>{value}</code></pre>, with lang class when present", () => {
    const blocks: MdBlock[] = [
      { type: "codeBlock", value: "const x = 1;" },
      { type: "codeBlock", lang: "js", value: "const y = 2;" },
    ];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const pres = container.querySelectorAll("pre.md-pre");
    expect(pres.length).toBe(2);

    const plainCode = pres[0].querySelector("code")!;
    expect(plainCode.textContent).toBe("const x = 1;");
    expect(plainCode.className).toBe("");

    const langCode = pres[1].querySelector("code")!;
    expect(langCode.textContent).toBe("const y = 2;");
    expect(langCode.classList.contains("lang-js")).toBe(true);
  });

  it("blockquote -> <blockquote class='md-quote'> containing rendered child blocks", () => {
    const blocks: MdBlock[] = [
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "quoted" }] },
          { type: "heading", level: 2, children: [{ type: "text", value: "quoted heading" }] },
        ],
      },
    ];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const quote = container.querySelector("blockquote.md-quote")!;
    expect(quote).toBeTruthy();
    expect(quote.querySelector("p.md-p")!.textContent).toBe("quoted");
    expect(quote.querySelector("h2.md-h2")!.textContent).toBe("quoted heading");
  });

  it("unordered list -> <ul class='md-list'>, items as plain <li>", () => {
    const blocks: MdBlock[] = [
      {
        type: "list",
        ordered: false,
        items: [
          { children: [{ type: "text", value: "one" }] },
          { children: [{ type: "text", value: "two" }] },
        ],
      },
    ];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const ul = container.querySelector("ul.md-list")!;
    expect(ul).toBeTruthy();
    expect(ul.classList.contains("md-list--ordered")).toBe(false);
    const items = ul.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("one");
    expect(items[1].textContent).toBe("two");
  });

  it("ordered list -> <ol class='md-list md-list--ordered' start={start}>", () => {
    const blocks: MdBlock[] = [
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [{ children: [{ type: "text", value: "third" }] }],
      },
    ];
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const ol = container.querySelector("ol")!;
    expect(ol.classList.contains("md-list")).toBe(true);
    expect(ol.classList.contains("md-list--ordered")).toBe(true);
    expect(ol.getAttribute("start")).toBe("3");
    expect(ol.querySelector("li")!.textContent).toBe("third");
  });
});

describe("renderBlocks: inline-level mapping", () => {
  function paragraphWith(children: MdInline[]): MdBlock[] {
    return [{ type: "paragraph", children }];
  }

  it("strong/em/strike render as native <strong>/<em>/<s>", () => {
    const blocks = paragraphWith([
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "em", children: [{ type: "text", value: "italic" }] },
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    expect(container.querySelector("strong")!.textContent).toBe("bold");
    expect(container.querySelector("em")!.textContent).toBe("italic");
    expect(container.querySelector("s")!.textContent).toBe("gone");
  });

  it("inline code -> <code class='md-code'>", () => {
    const blocks = paragraphWith([{ type: "code", value: "x = 1" }]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const code = container.querySelector("code.md-code")!;
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("x = 1");
  });

  it("br renders a line break", () => {
    const blocks = paragraphWith([
      { type: "text", value: "line1" },
      { type: "br" },
      { type: "text", value: "line2" },
    ]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    expect(container.querySelector("br")).toBeTruthy();
    expect(container.querySelector("p")!.textContent).toBe("line1line2");
  });

  it("link renders href/target/rel and its children as label", () => {
    const blocks = paragraphWith([
      {
        type: "link",
        href: "https://example.com/page",
        children: [{ type: "text", value: "click here" }],
      },
    ]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const a = container.querySelector("a.msg-link")!;
    expect(a).toBeTruthy();
    expect(a.getAttribute("href")).toBe("https://example.com/page");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("click here");
  });

  it("autolink renders the href itself as the label", () => {
    const blocks = paragraphWith([{ type: "autolink", href: "https://example.com/bare" }]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const a = container.querySelector("a.msg-link")!;
    expect(a).toBeTruthy();
    expect(a.getAttribute("href")).toBe("https://example.com/bare");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("https://example.com/bare");
  });

  it("nested inline formatting composes (strong containing em)", () => {
    const blocks = paragraphWith([
      {
        type: "strong",
        children: [
          { type: "text", value: "bold " },
          { type: "em", children: [{ type: "text", value: "and italic" }] },
        ],
      },
    ]);
    const { container } = render(<>{renderBlocks(blocks)}</>);
    const strong = container.querySelector("strong")!;
    expect(strong.textContent).toBe("bold and italic");
    expect(strong.querySelector("em")!.textContent).toBe("and italic");
  });
});
