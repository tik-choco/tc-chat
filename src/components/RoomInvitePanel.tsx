import { useState } from "preact/hooks";
import { X, Copy, Check, Share2, Send } from "lucide-preact";
import type { Friend } from "../lib/friendsStore";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { buildInviteUrl, sendInviteDm } from "../lib/roomInvite";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";
import { QrCode } from "./QrCode";

/** Per-friend send state for the "invite a friend" list. */
type SendState = "idle" | "sending" | "sent" | "error";

/**
 * The share sheet for a room: its invite link (copy / OS share / QR) plus a
 * one-tap send of that link into any accepted friend's DM. There is nothing
 * secret to protect here — the room id alone is the swarm topic — so this is
 * purely about handing the id over conveniently (see roomInvite.ts).
 */
export function RoomInvitePanel(props: {
  roomId: string;
  roomName: string;
  roomIconCid?: string;
  /** Name the invite DMs are sent under (the global profile display name). */
  selfName: string;
  /** All friends; only accepted ones have a live DM to send into. */
  friends: Friend[];
  directoryFor: (roomId: string) => ProfileDirectory;
  onClose: () => void;
}) {
  const { roomId, roomName, roomIconCid, selfName, friends, directoryFor, onClose } = props;
  const t = useT();
  const url = buildInviteUrl(roomId, roomName);
  const [copied, setCopied] = useState<"link" | "id" | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy(text: string, which: "link" | "id") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((cur) => (cur === which ? null : cur)), 1500);
    } catch {
      // Clipboard unavailable (insecure context / denied) — the value is
      // selectable in the field, so there's nothing to recover from.
    }
  }

  async function share() {
    try {
      await navigator.share({ title: roomName, text: t("invite.subtitle", { room: roomName }), url });
    } catch {
      // Includes the user simply dismissing the OS share sheet.
    }
  }

  async function invite(friend: Friend, name: string) {
    if (sendStates[friend.did] === "sending" || sendStates[friend.did] === "sent") return;
    setSendStates((s) => ({ ...s, [friend.did]: "sending" }));
    try {
      await sendInviteDm(friend.roomId, selfName, t("invite.dmBody", { room: roomName, url }));
      setSendStates((s) => ({ ...s, [friend.did]: "sent" }));
    } catch (error) {
      console.warn("tc-chat: failed to send room invite", name, error);
      setSendStates((s) => ({ ...s, [friend.did]: "error" }));
    }
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal invite-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("invite.title")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div class="invite-room">
          <Avatar id={roomId} name={roomName} avatarCid={roomIconCid} size={40} />
          <span class="invite-room-name">{roomName}</span>
        </div>

        {/* A <div>, not a <label>: these rows hold buttons, which must not sit
            inside a label's activation area. */}
        <div class="field">
          <span class="field-label">{t("invite.linkLabel")}</span>
          <div class="invite-link-row">
            <input readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button
              type="button"
              class="pill-btn pill-btn--ghost"
              title={copied === "link" ? t("common.copied") : t("invite.copyLink")}
              onClick={() => copy(url, "link")}
            >
              {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
              <span class="btn-label">
                {copied === "link" ? t("common.copied") : t("invite.copyLink")}
              </span>
            </button>
            {canShare && (
              <button
                type="button"
                class="pill-btn pill-btn--ghost"
                title={t("invite.share")}
                aria-label={t("invite.share")}
                onClick={share}
              >
                <Share2 size={14} />
              </button>
            )}
          </div>
        </div>

        <div class="field">
          <span class="field-label">{t("invite.roomIdLabel")}</span>
          <div class="invite-link-row">
            <input readOnly value={roomId} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button
              type="button"
              class="pill-btn pill-btn--ghost"
              title={copied === "id" ? t("common.copied") : t("account.copyRoomId")}
              aria-label={copied === "id" ? t("common.copied") : t("account.copyRoomId")}
              onClick={() => copy(roomId, "id")}
            >
              {copied === "id" ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        <div class="invite-qr">
          <QrCode text={url} size={168} label={t("invite.qrAlt", { room: roomName })} />
          <div class="invite-qr-meta">
            <strong>{t("invite.qrLabel")}</strong>
            <p>{t("invite.qrHint")}</p>
          </div>
        </div>

        <div class="invite-friends">
          <h3>{t("invite.friendsTitle")}</h3>
          {acceptedFriends.length === 0 ? (
            <p class="invite-empty">{t("invite.friendsEmpty")}</p>
          ) : (
            <ul class="invite-friend-list">
              {acceptedFriends.map((friend) => {
                const { name, avatarCid } = identityFor(
                  directoryFor(friend.roomId),
                  friend.did,
                  friend.name,
                );
                const state = sendStates[friend.did] ?? "idle";
                return (
                  <li key={friend.did}>
                    <Avatar id={friend.did} name={name} avatarCid={avatarCid} size={28} />
                    <span class="invite-friend-name">{name}</span>
                    {state === "error" && (
                      <span class="invite-send-error">{t("invite.sendFailed")}</span>
                    )}
                    <button
                      type="button"
                      class={`pill-btn ${state === "sent" ? "pill-btn--ghost" : ""}`}
                      disabled={state === "sending" || state === "sent"}
                      onClick={() => invite(friend, name)}
                    >
                      {state === "sent" ? <Check size={14} /> : <Send size={14} />}
                      <span class="btn-label">
                        {state === "sent"
                          ? t("invite.sent")
                          : state === "sending"
                            ? t("invite.sending")
                            : t("invite.send")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p class="profile-hint">{t("invite.hint")}</p>
      </div>
    </div>
  );
}
