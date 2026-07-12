import type { VNode } from "preact";
import type { MdBlock, MdInline, MdListItem } from "../lib/markdown";
import { parseMarkdown } from "../lib/markdown";

// Renders the chat markdown AST straight to Preact VNodes — no
// dangerouslySetInnerHTML anywhere. This is a P2P app: message text comes
// from untrusted remote peers, so the only way any of it can become markup
// is through JSX element construction here, never through raw HTML strings.

function renderInline(nodes: MdInline[], keyPrefix: string): (VNode | string)[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "strike":
        return <s key={key}>{renderInline(node.children, key)}</s>;
      case "code":
        return (
          <code key={key} class="md-code">
            {node.value}
          </code>
        );
      case "link":
        return (
          <a key={key} class="msg-link" href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children, key)}
          </a>
        );
      case "autolink":
        return (
          <a key={key} class="msg-link" href={node.href} target="_blank" rel="noopener noreferrer">
            {node.href}
          </a>
        );
      default:
        return null as unknown as VNode;
    }
  });
}

function renderListItem(item: MdListItem, key: string): VNode {
  return <li key={key}>{renderInline(item.children, key)}</li>;
}

function renderBlock(block: MdBlock, key: string): VNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} class="md-p">
          {renderInline(block.children, key)}
        </p>
      );
    case "heading": {
      const cls = `md-h md-h${block.level}`;
      const children = renderInline(block.children, key);
      if (block.level === 1) return <h1 key={key} class={cls}>{children}</h1>;
      if (block.level === 2) return <h2 key={key} class={cls}>{children}</h2>;
      return <h3 key={key} class={cls}>{children}</h3>;
    }
    case "codeBlock":
      return (
        <pre key={key} class="md-pre">
          <code class={block.lang ? `lang-${block.lang}` : undefined}>{block.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote key={key} class="md-quote">
          {renderBlocks(block.children, key)}
        </blockquote>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} class="md-list md-list--ordered" start={block.start}>
          {block.items.map((item, i) => renderListItem(item, `${key}-${i}`))}
        </ol>
      ) : (
        <ul key={key} class="md-list">
          {block.items.map((item, i) => renderListItem(item, `${key}-${i}`))}
        </ul>
      );
    default:
      return null as unknown as VNode;
  }
}

/** Exported so tests can render a hand-built AST directly, without depending
 * on parseMarkdown's (separately-owned, in-progress) parsing behavior. */
export function renderBlocks(blocks: MdBlock[], keyPrefix = "b"): VNode[] {
  return blocks.map((block, i) => renderBlock(block, `${keyPrefix}-${i}`));
}

export function MarkdownView(props: { text: string }) {
  const blocks = parseMarkdown(props.text);
  return <>{renderBlocks(blocks)}</>;
}
