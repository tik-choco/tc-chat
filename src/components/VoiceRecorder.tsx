import { useEffect, useRef, useState } from "preact/hooks";
import { Mic, Square, X, Send } from "lucide-preact";
import { useT } from "../lib/i18n";

// Auto-stop long recordings so a stuck/forgotten mic doesn't grow forever.
const MAX_RECORD_SECONDS = 5 * 60;

type RecorderState = "idle" | "requesting" | "recording" | "preview" | "error";

/** MediaRecorder mime negotiation: prefer opus-in-webm, fall back to plain
 * webm, then mp4 for Safari (which has no webm encoder at all). */
function pickMime(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  // Nothing matched (unlikely) — let the browser pick its own default.
  return candidates[candidates.length - 1];
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Records a voice clip via getUserMedia + MediaRecorder and hands the result
 * to `onSend` as a File, which rides the normal onSendFile media pipeline
 * (storage_add -> CID broadcast). MessageBubble already renders audio/* as
 * <audio controls>, so the receive side needs no changes.
 *
 * Renders just the mic button while idle; once recording starts it reports
 * `onActiveChange(true)` so MessageInput can swap out the rest of the input
 * row for this component's own (indicator/preview) row.
 */
export function VoiceRecorder(props: {
  disabled: boolean;
  onSend: (file: File) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const t = useT();
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<{ mime: string; ext: string } | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const supported = typeof MediaRecorder !== "undefined";

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Always release the physical mic the instant we're done with it, so no
  // lingering red "recording" indicator stays in the browser tab/OS chrome.
  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function revokePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }

  // Unmount safety net: a mid-recording navigation away must still stop the
  // mic and free the preview blob URL.
  useEffect(() => {
    return () => {
      stopTimer();
      stopStream();
      revokePreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only, refs are stable
  }, []);

  // Tell MessageInput whether it should hide the rest of the input row.
  useEffect(() => {
    props.onActiveChange(state !== "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onActiveChange is a stable setState
  }, [state]);

  useEffect(() => {
    if (state === "recording" && elapsed >= MAX_RECORD_SECONDS) {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, state]);

  async function startRecording() {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const picked = pickMime();
      mimeRef.current = picked;
      chunksRef.current = [];

      const recorder = MediaRecorder.isTypeSupported(picked.mime)
        ? new MediaRecorder(stream, { mimeType: picked.mime })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeRef.current?.mime ?? "audio/webm" });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setState("preview");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setElapsed(0);
      setState("recording");
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      stopStream();
      setState("error");
    }
  }

  function stopRecording() {
    stopTimer();
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    stopTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // Discard: don't let onstop build a preview we're about to throw away.
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    stopStream();
    setState("idle");
    setElapsed(0);
  }

  function cancelPreview() {
    revokePreview();
    blobRef.current = null;
    setPreviewUrl(null);
    setState("idle");
    setElapsed(0);
  }

  function sendRecording() {
    const blob = blobRef.current;
    const mime = mimeRef.current;
    if (!blob || !mime) return;
    const file = new File([blob], `voice-${Date.now()}.${mime.ext}`, { type: mime.mime });
    props.onSend(file);
    revokePreview();
    blobRef.current = null;
    setPreviewUrl(null);
    setState("idle");
    setElapsed(0);
  }

  if (!supported) return null;

  if (state === "error") {
    return (
      <div class="voice-recorder voice-recorder--error">
        <span class="voice-recorder-error-text">{t("chat.voiceMicDenied")}</span>
        <button type="button" class="voice-recorder-dismiss-btn" onClick={() => setState("idle")}>
          {t("common.close")}
        </button>
      </div>
    );
  }

  if (state === "recording") {
    return (
      <div class="voice-recorder voice-recorder--recording">
        <span class="voice-recorder-dot" aria-hidden="true" />
        <span class="voice-recorder-timer">{formatElapsed(elapsed)}</span>
        <span class="voice-recorder-label">{t("chat.voiceRecording")}</span>
        <button
          type="button"
          class="icon-btn"
          title={t("chat.voiceCancelRecording")}
          aria-label={t("chat.voiceCancelRecording")}
          onClick={cancelRecording}
        >
          <X size={18} />
        </button>
        <button
          type="button"
          class="voice-recorder-stop-btn"
          title={t("chat.voiceStopRecording")}
          aria-label={t("chat.voiceStopRecording")}
          onClick={stopRecording}
        >
          <Square size={16} />
        </button>
      </div>
    );
  }

  if (state === "preview" && previewUrl) {
    return (
      <div class="voice-recorder voice-recorder--preview">
        <audio class="voice-recorder-audio" controls src={previewUrl} />
        <button type="button" class="voice-recorder-cancel-btn" onClick={cancelPreview}>
          {t("common.cancel")}
        </button>
        <button type="button" class="send-btn" onClick={sendRecording}>
          <Send size={16} /> {t("common.send")}
        </button>
      </div>
    );
  }

  // idle / requesting: just the mic button, alongside the attach button.
  return (
    <button
      type="button"
      class="icon-btn"
      title={t("chat.recordVoice")}
      aria-label={t("chat.recordVoice")}
      disabled={props.disabled || state === "requesting"}
      onClick={startRecording}
    >
      <Mic size={20} />
    </button>
  );
}
