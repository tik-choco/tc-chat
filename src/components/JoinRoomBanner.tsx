import { UserPlus, X } from "lucide-preact";
import { useT } from "../lib/i18n";

/**
 * Offered when the room on screen isn't in the sidebar's room list — either
 * because an invite link was opened (`invited`, so we have the inviter's label
 * for it) or because a bare deep link was followed. Landing in a room already
 * lets you read and post (the swarm join follows the URL, not the room list),
 * so this is purely about KEEPING the room: nothing is joined behind the
 * user's back, and dismissing just leaves the room off the list.
 */
export function JoinRoomBanner(props: {
  roomName: string;
  /** Arrived via an invite link (vs. a plain deep link) — changes the wording. */
  invited: boolean;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  const { roomName, invited, onJoin, onDismiss } = props;
  const t = useT();
  return (
    <div class="join-banner" role="status">
      <UserPlus size={16} class="join-banner-icon" />
      <span class="join-banner-text">
        {invited ? t("invite.bannerInvited", { room: roomName }) : t("invite.bannerUnjoined")}
      </span>
      <button type="button" class="pill-btn join-banner-join" onClick={onJoin}>
        {t("invite.bannerJoin")}
      </button>
      <button
        type="button"
        class="join-banner-dismiss"
        title={t("invite.bannerDismiss")}
        aria-label={t("invite.bannerDismiss")}
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
