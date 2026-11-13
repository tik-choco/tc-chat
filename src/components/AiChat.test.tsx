import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/preact";
import type { UseAiChat } from "../hooks/useAiChat";
import type { AiConversation, AiConversationSummary, AiMessage } from "../lib/aiChatTypes";
import { AiChat } from "./AiChat";

// The hook is the unit under test elsewhere; the view only needs the shape.
const state = vi.hoisted(() => ({ chat: null as unknown as UseAiChat, providers: [] as unknown[] }));

vi.mock("../hooks/useAiChat", () => ({ useAiChat: () => state.chat }));

vi.mock("../lib/aiLocalSettings", () => ({
  AI_CHAT_TASK_ID: "chat",
  aiLocalSettingsAdapter: {
    get: () => ({ tasks: {}, roomProvide: {}, recentModels: [] }),
    set: () => {},
    subscribe: () => () => {},
  },
}));

// mistai's pickers/modal are third-party UI with their own tests; stand-ins keep
// this suite about tc-chat's wiring (props passed, callbacks fired).
vi.mock("@tik-choco/mistai/preact", () => ({
  ModelPicker: (props: { label: string }) => <div data-testid="model-picker">{props.label}</div>,
  LlmSettings: (props: { onClose?: () => void }) => (
    <div data-testid="llm-settings">
      <button type="button" onClick={props.onClose}>
        close-settings
      </button>
    </div>
  ),
  useLlmConfig: () => ({
    config: { providers: state.providers, defaultModel: undefined },
    save: () => {},
  }),
}));

const T0 = new Date("2026-07-30T10:00:00").getTime();

function message(over: Partial<AiMessage> & Pick<AiMessage, "id" | "role">): AiMessage {
  return { content: "", createdAt: T0, ...over };
}

function conversation(over: Partial<AiConversation> = {}): AiConversation {
  return {
    id: "c1",
    title: "",
    createdAt: T0,
    updatedAt: T0,
    effort: "medium",
    messages: [],
    ...over,
  };
}

function summary(over: Partial<AiConversationSummary> & Pick<AiConversationSummary, "id">): AiConversationSummary {
  return { title: "A chat", createdAt: T0, updatedAt: T0, messageCount: 2, ...over };
}

/** Typed (not loose stubs) so any drift in UseAiChat fails `tsc -b`. */
function makeChat(over: Partial<UseAiChat> = {}): UseAiChat {
  return {
    ready: true,
    error: null,
    errorDetail: null,
    dismissError: vi.fn(),
    conversations: [],
    active: conversation(),
    streamingMessageId: null,
    model: undefined,
    effort: "medium",
    recentModels: [],
    selectConversation: vi.fn(async () => {}),
    newConversation: vi.fn(),
    setTemporary: vi.fn(),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    setModel: vi.fn(),
    setEffort: vi.fn(),
    send: vi.fn(async () => {}),
    stop: vi.fn(),
    regenerate: vi.fn(async () => {}),
    editMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    ...over,
  };
}

const PROVIDER = { id: "p1", label: "P", baseUrl: "https://x/v1", apiKey: "k", enabled: true };

const MESSAGES: AiMessage[] = [
  message({ id: "u1", role: "user", content: "hello there" }),
  message({
    id: "a1",
    role: "assistant",
    content: "hi **friend**",
    model: { providerId: "p1", model: "gpt-test" },
    effort: "high",
  }),
];

function renderChat(chat: UseAiChat, onOpenSidebar = () => {}) {
  state.chat = chat;
  const utils = render(<AiChat onOpenSidebar={onOpenSidebar} />);
  const input = utils.container.querySelector<HTMLTextAreaElement>(".ai-input")!;
  return { ...utils, input };
}

function msgEl(container: Element, id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
}

beforeEach(() => {
  state.providers = [PROVIDER];
  // Wide viewport: the history pane starts open (the drawer behaviour is CSS).
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("AiChat messages", () => {
  it("renders user text, assistant markdown and the model + effort label", () => {
    const { container } = renderChat(makeChat({ active: conversation({ messages: MESSAGES }) }));
    expect(msgEl(container, "u1").textContent).toContain("hello there");
    const a = msgEl(container, "a1");
    expect(a.querySelector("strong")?.textContent).toBe("friend");
    expect(a.querySelector(".ai-msg-model")?.textContent).toBe("gpt-test");
    expect(a.querySelector(".ai-msg-effort")?.textContent).toBe("高");
  });

  it("shows a caret and no action row on the streaming message", () => {
    const streamingMsg = message({ id: "a2", role: "assistant", content: "par" });
    const { container } = renderChat(
      makeChat({
        active: conversation({ messages: [MESSAGES[0], streamingMsg] }),
        streamingMessageId: "a2",
      }),
    );
    const el = msgEl(container, "a2");
    expect(el.querySelector(".ai-caret")).not.toBeNull();
    expect(el.querySelector(".ai-msg-actions")).toBeNull();
    expect(msgEl(container, "u1").querySelector(".ai-msg-actions")).not.toBeNull();
  });

  it("marks stopped replies and offers retry on failed ones", () => {
    const regenerate = vi.fn(async () => {});
    const { container } = renderChat(
      makeChat({
        regenerate,
        active: conversation({
          messages: [
            MESSAGES[0],
            message({ id: "a1", role: "assistant", content: "part", stopped: true }),
            message({ id: "a2", role: "assistant", content: "", error: "boom" }),
          ],
        }),
      }),
    );
    expect(msgEl(container, "a1").textContent).toContain("停止しました");
    const failed = msgEl(container, "a2");
    expect(failed.textContent).toContain("boom");
    fireEvent.click(within(failed).getByRole("button", { name: "再試行" }));
    expect(regenerate).toHaveBeenCalledWith("a2");
  });

  it("regenerate on an assistant message calls regenerate(id)", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    fireEvent.click(within(msgEl(container, "a1")).getByRole("button", { name: "再生成" }));
    expect(chat.regenerate).toHaveBeenCalledWith("a1");
    // Users have no regenerate action.
    expect(within(msgEl(container, "u1")).queryByRole("button", { name: "再生成" })).toBeNull();
  });
});

describe("AiChat composer", () => {
  it("Ctrl+Enter sends the text and clears the field", () => {
    const chat = makeChat();
    const { input } = renderChat(chat);
    fireEvent.input(input, { target: { value: "hi ai" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(chat.send).toHaveBeenCalledWith("hi ai");
    expect(input.value).toBe("");
  });

  it("Cmd+Enter sends on macOS", () => {
    const chat = makeChat();
    const { input } = renderChat(chat);
    fireEvent.input(input, { target: { value: "hi mac" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(chat.send).toHaveBeenCalledWith("hi mac");
  });

  it("plain Enter and Shift+Enter do not send", () => {
    const chat = makeChat();
    const { input } = renderChat(chat);
    fireEvent.input(input, { target: { value: "line" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(chat.send).not.toHaveBeenCalled();
    expect(input.value).toBe("line");
  });

  it("does not send while an IME composition is committing with Enter", () => {
    const chat = makeChat();
    const { input } = renderChat(chat);
    fireEvent.input(input, { target: { value: "かな" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(chat.send).not.toHaveBeenCalled();
    expect(input.value).toBe("かな");
  });

  it("disables Send when the draft is empty", () => {
    renderChat(makeChat());
    expect(screen.getByRole("button", { name: /送信/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows Stop (not Send) while streaming, and Stop calls stop()", () => {
    const chat = makeChat({
      active: conversation({ messages: [MESSAGES[0], message({ id: "a2", role: "assistant" })] }),
      streamingMessageId: "a2",
    });
    renderChat(chat);
    expect(screen.queryByRole("button", { name: /送信/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    expect(chat.stop).toHaveBeenCalled();
  });

  it("keeps the draft when Ctrl+Enter is pressed during a stream", () => {
    const chat = makeChat({
      active: conversation({ messages: [MESSAGES[0], message({ id: "a2", role: "assistant" })] }),
      streamingMessageId: "a2",
    });
    const { input } = renderChat(chat);
    fireEvent.input(input, { target: { value: "queued" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(chat.send).not.toHaveBeenCalled();
    expect(input.value).toBe("queued");
  });

  it("effort picker calls setEffort with the chosen level", () => {
    const chat = makeChat();
    renderChat(chat);
    const select = screen.getByRole("combobox", { name: "推論の強さ" }) as HTMLSelectElement;
    expect(select.value).toBe("medium");
    expect(select.options.length).toBe(7);
    fireEvent.change(select, { target: { value: "xhigh" } });
    expect(chat.setEffort).toHaveBeenCalledWith("xhigh");
  });

  it("renders the model picker in the toolbar", () => {
    renderChat(makeChat());
    expect(screen.getByTestId("model-picker").textContent).toBe("モデル");
  });
});

describe("AiChat editing and deleting", () => {
  it("Save & resend on a user message calls editMessage(id, text, {resend:true})", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    const u = msgEl(container, "u1");
    fireEvent.click(within(u).getByRole("button", { name: "編集" }));
    const area = u.querySelector<HTMLTextAreaElement>(".ai-edit-input")!;
    expect(area.value).toBe("hello there");
    fireEvent.input(area, { target: { value: "hello again" } });
    fireEvent.click(within(u).getByRole("button", { name: "保存して再送信" }));
    expect(chat.editMessage).toHaveBeenCalledWith("u1", "hello again", { resend: true });
    expect(u.querySelector(".ai-edit-input")).toBeNull();
  });

  it("plain Save edits without resend, and assistant edits have no resend button", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    const a = msgEl(container, "a1");
    fireEvent.click(within(a).getByRole("button", { name: "編集" }));
    expect(within(a).queryByRole("button", { name: "保存して再送信" })).toBeNull();
    fireEvent.input(a.querySelector(".ai-edit-input")!, { target: { value: "fixed" } });
    fireEvent.click(within(a).getByRole("button", { name: "保存" }));
    expect(chat.editMessage).toHaveBeenCalledWith("a1", "fixed");
  });

  it("Cancel leaves the message untouched", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    const u = msgEl(container, "u1");
    fireEvent.click(within(u).getByRole("button", { name: "編集" }));
    fireEvent.click(within(u).getByRole("button", { name: "キャンセル" }));
    expect(chat.editMessage).not.toHaveBeenCalled();
    expect(u.textContent).toContain("hello there");
  });

  it("deleting a message asks first, then calls deleteMessage", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    fireEvent.click(within(msgEl(container, "u1")).getByRole("button", { name: "削除" }));
    expect(chat.deleteMessage).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    expect(chat.deleteMessage).toHaveBeenCalledWith("u1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancelling the delete dialog keeps the message", () => {
    const chat = makeChat({ active: conversation({ messages: MESSAGES }) });
    const { container } = renderChat(chat);
    fireEvent.click(within(msgEl(container, "u1")).getByRole("button", { name: "削除" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "キャンセル" }));
    expect(chat.deleteMessage).not.toHaveBeenCalled();
  });
});

describe("AiChat header", () => {
  it("temporary toggle calls setTemporary and reflects aria-pressed", () => {
    const chat = makeChat();
    renderChat(chat);
    const btn = screen.getByRole("button", { name: "一時チャットをオンにする（保存されません）" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(chat.setTemporary).toHaveBeenCalledWith(true);
  });

  it("shows the temporary badge and an off toggle for a temporary chat", () => {
    const chat = makeChat({ active: conversation({ temporary: true }) });
    const { container } = renderChat(chat);
    expect(container.querySelector(".ai-badge")?.textContent).toContain("一時");
    const btn = screen.getByRole("button", { name: "一時チャットをオフにする" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(chat.setTemporary).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain("保存されず");
  });

  it("new chat button starts a draft", () => {
    const chat = makeChat();
    renderChat(chat);
    fireEvent.click(screen.getByRole("button", { name: "新しいチャット" }));
    expect(chat.newConversation).toHaveBeenCalled();
  });

  it("the sidebar button opens the drawer", () => {
    const onOpenSidebar = vi.fn();
    renderChat(makeChat(), onOpenSidebar);
    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    expect(onOpenSidebar).toHaveBeenCalled();
  });

  it("shows the conversation title", () => {
    const { container } = renderChat(makeChat({ active: conversation({ title: "My topic" }) }));
    expect(container.querySelector(".ai-title")?.textContent).toBe("My topic");
  });
});

describe("AiChat history", () => {
  const convs = [
    summary({ id: "c1", title: "First" }),
    summary({ id: "c2", title: "Second" }),
  ];

  it("lists conversations in a nav > ul and highlights the active one", () => {
    const { container } = renderChat(makeChat({ conversations: convs, active: conversation({ id: "c2" }) }));
    expect(container.querySelector("nav.ai-history ul")).not.toBeNull();
    const rows = container.querySelectorAll(".ai-history-row");
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains("ai-history-row--active")).toBe(true);
    expect(rows[0].classList.contains("ai-history-row--active")).toBe(false);
  });

  it("clicking a row calls selectConversation(id)", () => {
    const chat = makeChat({ conversations: convs });
    renderChat(chat);
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(chat.selectConversation).toHaveBeenCalledWith("c2");
  });

  it("the history toggle hides and shows the pane", () => {
    const { container } = renderChat(makeChat({ conversations: convs }));
    expect(container.querySelector(".ai-history")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "履歴を閉じる" })[0]);
    expect(container.querySelector(".ai-history")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(container.querySelector(".ai-history")).not.toBeNull();
  });

  it("renames a conversation inline with Enter", () => {
    const chat = makeChat({ conversations: convs });
    const { container } = renderChat(chat);
    const row = container.querySelectorAll<HTMLElement>(".ai-history-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = row.querySelector<HTMLInputElement>(".ai-rename-input")!;
    fireEvent.input(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chat.renameConversation).toHaveBeenCalledWith("c1", "Renamed");
    expect(row.querySelector(".ai-rename-input")).toBeNull();
  });

  it("Escape cancels a rename without calling the hook", () => {
    const chat = makeChat({ conversations: convs });
    const { container } = renderChat(chat);
    const row = container.querySelectorAll<HTMLElement>(".ai-history-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = row.querySelector<HTMLInputElement>(".ai-rename-input")!;
    fireEvent.input(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(chat.renameConversation).not.toHaveBeenCalled();
  });

  it("deleting a conversation asks first, then calls deleteConversation", () => {
    const chat = makeChat({ conversations: convs });
    const { container } = renderChat(chat);
    const row = container.querySelectorAll<HTMLElement>(".ai-history-row")[1];
    fireEvent.click(within(row).getByRole("button", { name: "削除" }));
    expect(chat.deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "削除" }));
    expect(chat.deleteConversation).toHaveBeenCalledWith("c2");
  });
});

describe("AiChat settings and errors", () => {
  it("shows the friendly prompt when a provider exists", () => {
    const { container } = renderChat(makeChat());
    expect(container.textContent).toContain("何でも聞いてみましょう");
    expect(screen.queryByRole("button", { name: "AI設定を開く" })).toBeNull();
  });

  it("with no enabled provider, shows a CTA that opens the settings modal", () => {
    state.providers = [{ ...PROVIDER, enabled: false }];
    renderChat(makeChat());
    expect(screen.queryByTestId("llm-settings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AI設定を開く" }));
    expect(screen.getByTestId("llm-settings")).not.toBeNull();
    fireEvent.click(screen.getByText("close-settings"));
    expect(screen.queryByTestId("llm-settings")).toBeNull();
  });

  it("the gear button opens the settings modal", () => {
    renderChat(makeChat());
    fireEvent.click(screen.getByRole("button", { name: "AI設定" }));
    expect(screen.getByTestId("llm-settings")).not.toBeNull();
  });

  it("shows the error banner with detail and dismisses it", () => {
    const chat = makeChat({ error: "generate", errorDetail: "HTTP 500" });
    renderChat(chat);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("返信を生成できませんでした");
    expect(alert.textContent).toContain("HTTP 500");
    fireEvent.click(within(alert).getByRole("button", { name: "閉じる" }));
    expect(chat.dismissError).toHaveBeenCalled();
  });

  it("the config error offers to open AI settings", () => {
    renderChat(makeChat({ error: "config", errorDetail: "no model" }));
    const alert = screen.getByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "AI設定を開く" }));
    expect(screen.getByTestId("llm-settings")).not.toBeNull();
  });
});
