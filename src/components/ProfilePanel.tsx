import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { X } from "lucide-preact";
import type { Profile } from "../lib/profileStore";
import { getNode, storage_add } from "../lib/mistClient";
import { resolveStorageUrl } from "../lib/mediaUrl";
import { shortDid } from "../lib/util";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";

export function ProfilePanel(props: {
  profile: Profile;
  onSave: (profile: Profile) => void;
  onClose: () => void;
}) {
  const { profile, onSave, onClose } = props;
  const t = useT();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar); // mistlib storage CID
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve the existing avatar CID to an image for the preview.
  useEffect(() => {
    if (!profile.avatar) return;
    let cancelled = false;
    resolveStorageUrl(profile.avatar)
      .then((u) => !cancelled && setPreviewUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile.avatar]);

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
    // Instant local preview while the upload runs.
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      await getNode();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await storage_add(file.name, bytes);
      setAvatar(cid);
    } catch {
      setError(t("account.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  function removeAvatar() {
    setAvatar("");
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError(t("account.displayNameRequired"));
      return;
    }
    if (uploading) {
      setError(t("account.uploadingImage"));
      return;
    }
    onSave({ ...profile, displayName: displayName.trim(), bio: bio.trim(), avatar });
    onClose();
  }

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(profile.did);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; ignore.
    }
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal profile-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("account.profileTitle")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div class="profile-preview">
            <div class="profile-avatar-slot">
              {previewUrl ? (
                <img class="profile-avatar-img" src={previewUrl} alt={displayName} />
              ) : (
                <Avatar id={profile.did} name={displayName || "?"} size={72} />
              )}
              {uploading && <span class="profile-avatar-uploading">…</span>}
            </div>
            <div class="profile-preview-meta">
              <strong>{displayName || t("account.unnamed")}</strong>
              <span class="profile-did" title={profile.did}>
                {shortDid(profile.did)}
                <button type="button" class="profile-did-copy" onClick={copyDid}>
                  {copied ? t("common.copied") : t("common.copy")}
                </button>
              </span>
              <div class="profile-avatar-actions">
                <button
                  type="button"
                  class="pill-btn pill-btn--ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {avatar || previewUrl ? t("account.changeImage") : t("account.chooseImage")}
                </button>
                {(avatar || previewUrl) && (
                  <button type="button" class="profile-avatar-remove" onClick={removeAvatar}>
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
            <span class="field-label">{t("account.displayName")}</span>
            <input
              value={displayName}
              maxLength={40}
              placeholder={t("account.namePlaceholder")}
              onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field">
            <span class="field-label">{t("account.bio")}</span>
            <textarea
              value={bio}
              rows={3}
              maxLength={280}
              placeholder={t("account.bioPlaceholder")}
              onInput={(e) => setBio((e.target as HTMLTextAreaElement).value)}
            />
          </label>

          {error && <p class="form-error">{error}</p>}

          {profile.vrm && <p class="profile-vrm-note">{t("account.vrmNote")}</p>}

          <p class="profile-hint">{t("account.profileHint")}</p>

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
