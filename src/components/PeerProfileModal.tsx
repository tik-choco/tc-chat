import { useState } from "preact/hooks";
import { X, BadgeCheck, UserPlus, Check } from "lucide-preact";
import type { ProfileDirectory } from "../lib/profileDirectory";
import type { FriendStatus } from "../lib/friendsStore";
import { shortDid } from "../lib/util";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";

/**
 * Read-only profile card for ANOTHER participant, opened by clicking their
 * avatar/name. Everything shown here is public, self-signed profile data learned
 * from the room's `tc-chat:profile` broadcasts (see useProfileDirectory), keyed
 * by the peer's DID — so it's available for anyone we've heard a post or
 * presence from. This never edits; editing your own profile is ProfilePanel.
 */
export function PeerProfileModal(props: {
  did: string;
  /** Name to show before/without a directory entry (a signed post/presence name). */
  fallbackName: string;
  directory: ProfileDirectory;
  /** The local user's DID, so we can label their own card. */
  selfDid?: string | null;
  /** null = no friend relationship exists yet. */
  friendStatus: FriendStatus | null;
  onSendRequest: (name: string) => void;
  onAcceptRequest: () => void;
  onDeclineRequest: () => void;
  onCancelRequest: () => void;
  onClose: () => void;
}) {
  const {
    did,
    fallbackName,
    directory,
    selfDid,
    friendStatus,
    onSendRequest,
    onAcceptRequest,
    onDeclineRequest,
    onCancelRequest,
    onClose,
  } = props;
  const t = useT();
  const [copied, setCopied] = useState(false);

  const entry = directory[did];
  const name = entry?.displayName?.trim() || fallbackName || t("account.participant");
  const bio = entry?.bio?.trim();
  const isSelf = !!selfDid && selfDid === did;

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(did);
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
          <h2>
            {t("account.profileTitle")}
            {isSelf && t("account.selfSuffix")}
          </h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div class="profile-preview">
          <div class="profile-avatar-slot">
            <Avatar id={did} name={name} avatarCid={entry?.avatarCid || undefined} size={72} />
          </div>
          <div class="profile-preview-meta">
            <strong>
              {name}{" "}
              <span class="bubble-verified" title={t("account.verifiedDidTitle")}>
                <BadgeCheck size={15} />
              </span>
            </strong>
            <span class="profile-did" title={did}>
              {shortDid(did)}
              <button type="button" class="profile-did-copy" onClick={copyDid}>
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </span>
          </div>
        </div>

        {bio ? (
          <p class="peer-bio">{bio}</p>
        ) : (
          <p class="peer-bio peer-bio--empty">{t("account.noBio")}</p>
        )}

        <div class="modal-actions">
          {!isSelf && friendStatus === null && (
            <button type="button" class="btn-ghost" onClick={() => onSendRequest(name)}>
              <UserPlus size={14} /> {t("friends.sendRequest")}
            </button>
          )}
          {!isSelf && friendStatus === "pending-out" && (
            <>
              <button type="button" class="btn-ghost" disabled>
                {t("friends.requestSent")}
              </button>
              <button type="button" class="btn-ghost" onClick={onCancelRequest}>
                <X size={14} /> {t("friends.cancelRequest")}
              </button>
            </>
          )}
          {!isSelf && friendStatus === "pending-in" && (
            <>
              <button type="button" class="btn-ghost" onClick={onAcceptRequest}>
                <Check size={14} /> {t("friends.accept")}
              </button>
              <button type="button" class="btn-ghost" onClick={onDeclineRequest}>
                <X size={14} /> {t("friends.decline")}
              </button>
            </>
          )}
          {!isSelf && friendStatus === "accepted" && (
            <button type="button" class="btn-ghost" disabled>
              <Check size={14} /> {t("friends.added")}
            </button>
          )}
          <button type="button" class="send-btn" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
