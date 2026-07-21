import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { X } from "lucide-preact";
import { getNode, storage_add } from "../lib/mistClient";
import { resolveStorageUrl } from "../lib/mediaUrl";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";

/** Edits a room's SHARED name/icon (broadcast to everyone in the room via
 * useRoomMeta) — distinct from RoomNamePanel, which only edits the local
 * user's own nickname *within* the room. Leaving the name blank clears the
 * shared override, falling back to each peer's own local room label. */
export function RoomIdentityPanel(props: {
  roomId: string;
  currentName: string;
  currentIconCid?: string;
  onSave: (fields: { name?: string; iconCid?: string }) => void;
  onClose: () => void;
}) {
  const { roomId, currentName, currentIconCid, onSave, onClose } = props;
  const t = useT();
  const [name, setName] = useState(currentName);
  const [iconCid, setIconCid] = useState(currentIconCid ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve the existing icon CID to an image for the preview.
  useEffect(() => {
    if (!currentIconCid) return;
    let cancelled = false;
    resolveStorageUrl(currentIconCid)
      .then((u) => !cancelled && setPreviewUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentIconCid]);

  async function handleFile(e: JSX.TargetedEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("account.selectImageFile"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t("account.imageTooLarge"));
      return;
    }
    setError("");
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      await getNode();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await storage_add(file.name, bytes);
      setIconCid(cid);
    } catch {
      setError(t("account.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  function removeIcon() {
    setIconCid("");
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploading) {
      setError(t("account.uploadingImage"));
      return;
    }
    onSave({ name: name.trim(), iconCid });
    onClose();
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal profile-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("account.roomIdentityTitle")}</h2>
          <button
            type="button"
            class="modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div class="profile-preview">
            <div class="profile-avatar-slot">
              {previewUrl ? (
                <img class="profile-avatar-img" src={previewUrl} alt={name} />
              ) : (
                <Avatar id={roomId} name={name || "?"} size={72} />
              )}
              {uploading && <span class="profile-avatar-uploading">…</span>}
            </div>
            <div class="profile-preview-meta">
              <div class="profile-avatar-actions">
                <button
                  type="button"
                  class="pill-btn pill-btn--ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {iconCid || previewUrl ? t("account.changeImage") : t("account.chooseImage")}
                </button>
                {(iconCid || previewUrl) && (
                  <button type="button" class="profile-avatar-remove" onClick={removeIcon}>
                    {t("common.delete")}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                class="file-input"
                onChange={handleFile}
              />
            </div>
          </div>

          <label class="field">
            <span class="field-label">{t("account.roomIdentityNameLabel")}</span>
            <input
              value={name}
              maxLength={60}
              placeholder={t("account.roomNamePlaceholder")}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>

          {error && <p class="form-error">{error}</p>}

          <p class="profile-hint">{t("account.roomIdentityHint")}</p>

          <div class="modal-actions">
            <button type="button" class="composer-cancel" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" class="send-btn" disabled={uploading}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
