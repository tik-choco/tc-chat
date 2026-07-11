import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Paperclip, Archive, Send, ImagePlay } from "lucide-preact";
import { loadTcStorageFiles, type TcStorageFileEntry } from "../interop/tcStorageFiles";
import { StoragePicker } from "./StoragePicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { GifPicker } from "./GifPicker";
import { useT } from "../lib/i18n";

export function MessageInput(props: {
  disabled: boolean;
  onTyping?: () => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendStoredFile: (entry: TcStorageFileEntry) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [showStoragePicker, setShowStoragePicker] = useState(false);
  // While the voice recorder is recording/previewing/erroring, it replaces
  // the rest of the input row (attach/text/send) instead of sitting beside it.
  const [voiceActive, setVoiceActive] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function submit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    props.onSendText(trimmed);
    setText("");
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
            <input
              class="text-input"
              placeholder={props.disabled ? t("chat.joinRoomPlaceholder") : t("chat.messagePlaceholder")}
              value={text}
              disabled={props.disabled}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setText(value);
                if (value.trim()) props.onTyping?.();
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
