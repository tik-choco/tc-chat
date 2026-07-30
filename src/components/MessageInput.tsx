import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Paperclip, Archive, Send, ImagePlay } from "lucide-preact";
import { loadTcStorageFiles, type TcStorageFileEntry } from "../interop/tcStorageFiles";
import { StoragePicker } from "./StoragePicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { GifPicker } from "./GifPicker";
import { useT } from "../lib/i18n";
import { clearDraft, loadDraft, saveDraft } from "../lib/draftStore";

// Auto-grow cap: roughly 6 lines of text at the input's font/line-height,
// plus its vertical padding. Kept in sync with the max-height set on
// .text-input in chat.css — that CSS cap is the real backstop if this drifts.
const MAX_TEXTAREA_HEIGHT = 140;

// Draft writes land on localStorage (synchronous, on the typing path), so
// they're throttled rather than fired on every keystroke — same tradeoff as
// the rest of this app's best-effort persistence.
const DRAFT_SAVE_DEBOUNCE_MS = 400;

export function MessageInput(props: {
  roomId: string;
  disabled: boolean;
  onTyping?: () => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendStoredFile: (entry: TcStorageFileEntry) => void;
}) {
  const t = useT();
  const [text, setText] = useState(() => loadDraft(props.roomId));
  const [showStoragePicker, setShowStoragePicker] = useState(false);
  // While the voice recorder is recording/previewing/erroring, it replaces
  // the rest of the input row (attach/text/send) instead of sitting beside it.
  const [voiceActive, setVoiceActive] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Mutable so the debounce callback and the unmount/room-switch flush always
  // see the latest pending value without re-subscribing on every keystroke.
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<{ roomId: string; text: string } | null>(null);

  function flushPendingDraft() {
    if (draftSaveTimer.current !== null) {
      clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    if (pendingDraftRef.current) {
      saveDraft(pendingDraftRef.current.roomId, pendingDraftRef.current.text);
      pendingDraftRef.current = null;
    }
  }

  // Re-seed the composer whenever the room changes: load the incoming room's
  // saved draft, and — via the cleanup, which fires for the OLD roomId before
  // the new one is applied — flush (don't drop) whatever was still pending
  // for the room being left. The same cleanup covers the final unmount (e.g.
  // the whole chat window closing), so the last debounced-but-unsaved
  // characters aren't lost there either.
  useEffect(() => {
    setText(loadDraft(props.roomId));
    return () => {
      flushPendingDraft();
    };
  }, [props.roomId]);

  function scheduleDraftSave(roomId: string, value: string) {
    pendingDraftRef.current = { roomId, text: value };
    if (draftSaveTimer.current !== null) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      draftSaveTimer.current = null;
      if (pendingDraftRef.current) {
        saveDraft(pendingDraftRef.current.roomId, pendingDraftRef.current.text);
        pendingDraftRef.current = null;
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
  }

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
  }

  function sendText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    props.onSendText(trimmed);
    setText("");
    // A pending debounced save for this room would otherwise fire after send
    // and resurrect the just-sent text as a "draft".
    if (draftSaveTimer.current !== null) {
      clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    pendingDraftRef.current = null;
    clearDraft(props.roomId);
    // Collapse back to a single line; scrollHeight reflects the now-empty
    // value once the browser has applied the "auto" reset.
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }

  function submit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    sendText();
  }

  function handleFilePick(e: JSX.TargetedEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) props.onSendFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleStoredFileSelect(entry: TcStorageFileEntry) {
    props.onSendStoredFile(entry);
    setShowStoragePicker(false);
  }

  function handleGifSelect(file: File) {
    props.onSendFile(file);
    setShowGifPicker(false);
  }

  // Read fresh each render so a file saved in tc-storage in another tab
  // shows up next time the picker is opened, without a background poll.
  const storageEntries = loadTcStorageFiles();

  return (
    <div class="message-input-container">
      {showStoragePicker && (
        <StoragePicker
          entries={storageEntries}
          onSelect={handleStoredFileSelect}
          onCancel={() => setShowStoragePicker(false)}
        />
      )}
      {showGifPicker && (
        <GifPicker onSelect={handleGifSelect} onCancel={() => setShowGifPicker(false)} />
      )}
      <form class="message-input" onSubmit={submit}>
        {!voiceActive && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              class="file-input"
              onChange={handleFilePick}
              disabled={props.disabled}
            />
            <button
              type="button"
              class="icon-btn"
              title={t("chat.attachFile")}
              aria-label={t("chat.attachFile")}
              disabled={props.disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={20} />
            </button>
            {storageEntries.length > 0 && (
              <button
                type="button"
                class="icon-btn"
                title={t("chat.pickFromStorage")}
                aria-label={t("chat.pickFromStorage")}
                disabled={props.disabled}
                onClick={() => setShowStoragePicker((v) => !v)}
              >
                <Archive size={20} />
              </button>
            )}
          </>
        )}
        <VoiceRecorder disabled={props.disabled} onSend={props.onSendFile} onActiveChange={setVoiceActive} />
        {!voiceActive && (
          <>
            <button
              type="button"
              class="icon-btn"
              title={t("chat.pickGif")}
              aria-label={t("chat.pickGif")}
              disabled={props.disabled}
              onClick={() => setShowGifPicker((v) => !v)}
            >
              <ImagePlay size={20} />
            </button>
            <textarea
              ref={textareaRef}
              class="text-input"
              rows={1}
              placeholder={props.disabled ? t("chat.joinRoomPlaceholder") : t("chat.messagePlaceholder")}
              value={text}
              disabled={props.disabled}
              onInput={(e) => {
                const value = (e.target as HTMLTextAreaElement).value;
                setText(value);
                scheduleDraftSave(props.roomId, value);
                if (value.trim()) props.onTyping?.();
                resizeTextarea();
              }}
              onKeyDown={(e) => {
                // IME composition (e.g. Japanese kana→kanji) commits via
                // Enter — that keystroke must not also send the message.
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText();
                }
              }}
            />
            <button type="submit" class="send-btn" disabled={props.disabled || !text.trim()}>
              <Send size={16} /> {t("common.send")}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
