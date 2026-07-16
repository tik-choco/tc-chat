import { useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  MessagesSquare,
  Settings,
  Moon,
  Sun,
  Globe,
  Hash,
  X,
  Copy,
  Check,
  Plus,
  Users,
  User,
  CalendarPlus,
  RefreshCw,
} from "lucide-preact";
import type { RoomMeta } from "../lib/chatStore";
import { isValidRoomId } from "../lib/chatStore";
import type { Peer } from "../hooks/usePresence";
import type { Profile } from "../lib/profileStore";
import type { Friend } from "../lib/friendsStore";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import type { Theme } from "../hooks/useTheme";
import { GLOBAL_ROOM_ID, newId } from "../lib/util";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";

export function Sidebar(props: {
  /** Mobile only: whether the off-canvas drawer is slid in. Ignored on desktop. */
  open: boolean;
  profile: Profile | null;
  displayName: string;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenPersonalCalendar: () => void;
  rooms: RoomMeta[];
  activeRoomId: string;
  onSelectRoom: (id: string) => void;
  onJoinRoom: (id: string, name: string) => void;
  onLeaveRoom: (id: string) => void;
  peers: Peer[];
  /** Open a peer's read-only profile card (needs their DID, from presence). */
  onOpenPeerProfile: (did: string, fallbackName: string) => void;
  /** All statuses — filter by status in the sections below. */
  friends: Friend[];
  directoryFor: (roomId: string) => ProfileDirectory;
  onRemoveFriend: (did: string) => void;
  onAcceptRequest: (did: string) => void;
  onDeclineRequest: (did: string) => void;
  onCancelRequest: (did: string) => void;
  /** roomId -> count of messages received while the room wasn't on screen. */
  unread: Record<string, number>;
}) {
  const {
    open,
    profile,
    displayName,
    theme,
    onToggleTheme,
    onOpenProfile,
    onOpenSettings,
    onOpenPersonalCalendar,
    rooms,
    activeRoomId,
    onSelectRoom,
    onJoinRoom,
    onLeaveRoom,
    peers,
    onOpenPeerProfile,
    friends,
    directoryFor,
    onRemoveFriend,
    onAcceptRequest,
    onDeclineRequest,
    onCancelRequest,
    unread,
  } = props;
  const t = useT();
  // The friends list carries every relationship status; each section below
  // only cares about a slice of it.
  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const incomingRequests = friends.filter((f) => f.status === "pending-in");
  const outgoingRequests = friends.filter((f) => f.status === "pending-out");
  const hasPendingRequests = incomingRequests.length > 0 || outgoingRequests.length > 0;
  // Presence only tells us a peer is online once we know their DID; used to
  // show an online dot on the merged friends/DM row below.
  const onlineDids = new Set(peers.filter((p) => p.did).map((p) => p.did));
  const [newRoomId, setNewRoomId] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [error, setError] = useState("");
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);
  // Collapsed by default — the join-a-room form only needs to appear when
  // someone actually wants it, not permanently under every room list.
  const [joinOpen, setJoinOpen] = useState(false);

  async function copyRoomId(id: string, e: MouseEvent) {
    // The id is shown inside the room-select button's own row; stop the click
    // from also switching rooms.
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopiedRoomId(id);
      setTimeout(() => setCopiedRoomId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard unavailable; ignore.
    }
  }

  function handleJoin(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = newRoomId.trim();
    if (!isValidRoomId(id)) {
      setError(t("account.roomIdInvalid"));
      return;
    }
    // The display name is a local, free-form label; roomId is the shared join
    // key (it's used verbatim as the swarm topic). Fall back to the id when no
    // name is given.
    const name = newRoomName.trim() || id;
    onJoinRoom(id, name);
    onSelectRoom(id);
    setNewRoomId("");
    setNewRoomName("");
    setError("");
    setJoinOpen(false);
  }

  function toggleJoinOpen() {
    setJoinOpen((v) => {
      const next = !v;
      // Prefill a fresh GUID on open so creating a new room needs zero typing;
      // someone joining an existing room can still select-all and paste over it.
      if (next) setNewRoomId((cur) => cur || newId());
      return next;
    });
  }

  function regenerateRoomId() {
    setNewRoomId(newId());
    setError("");
  }

  return (
    <aside class={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div class="sidebar-brand">
        <span class="sidebar-brand-mark">
          <MessagesSquare size={18} />
        </span>
        <span class="sidebar-brand-name">TC Chat</span>
        <div class="sidebar-brand-actions">
          <button
            type="button"
            class="theme-toggle"
            title={t("account.settings")}
            aria-label={t("account.openSettings")}
            onClick={onOpenSettings}
          >
            <Settings size={18} />
          </button>
          <button
            type="button"
            class="theme-toggle"
            title={t("calendar.personalCalendarTitle")}
            aria-label={t("calendar.personalCalendarTitle")}
            onClick={onOpenPersonalCalendar}
          >
            <CalendarPlus size={18} />
          </button>
          <button
            type="button"
            class="theme-toggle"
            title={theme === "light" ? t("account.switchToDark") : t("account.switchToLight")}
            aria-label={t("account.toggleTheme")}
            onClick={onToggleTheme}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="sidebar-user"
        onClick={onOpenProfile}
        title={t("account.editProfile")}
      >
        <Avatar
          id={profile?.did ?? displayName}
          name={displayName}
          avatarCid={profile?.avatar || undefined}
          size={40}
        />
        <span class="sidebar-user-meta">
          <span class="sidebar-user-name">{displayName || t("account.guest")}</span>
          <span class="sidebar-user-sub">{t("account.editProfile")}</span>
        </span>
      </button>

      <div class="sidebar-section">
        <div class="sidebar-section-head">
          <h3>{t("account.rooms")}</h3>
          <button
            type="button"
            class={`sidebar-add-btn ${joinOpen ? "sidebar-add-btn--active" : ""}`}
            title={t("account.joinRoom")}
            aria-label={t("account.joinRoom")}
            aria-expanded={joinOpen}
            onClick={toggleJoinOpen}
          >
            {joinOpen ? <X size={14} /> : <Plus size={14} />}
          </button>
        </div>
        <ul class="room-list">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                class={`room-item ${room.id === activeRoomId ? "room-item--active" : ""}`}
                onClick={() => onSelectRoom(room.id)}
              >
                {room.id === GLOBAL_ROOM_ID ? (
                  <Globe size={16} class="room-icon" />
                ) : (
                  <Hash size={16} class="room-icon" />
                )}
                <span class="room-item-text">
                  <span class="room-name">{room.name}</span>
                  {room.id !== GLOBAL_ROOM_ID && room.id !== room.name && (
                    <span class="room-id" title={t("account.roomIdTooltip", { id: room.id })}>
                      {room.id}
                    </span>
                  )}
                </span>
                {(unread[room.id] ?? 0) > 0 && (
                  <span class="unread-badge">{unread[room.id]}</span>
                )}
              </button>
              {room.id !== GLOBAL_ROOM_ID && (
                <button
                  type="button"
                  class={`room-copy ${copiedRoomId === room.id ? "room-copy--copied" : ""}`}
                  title={copiedRoomId === room.id ? t("common.copied") : t("account.copyRoomId")}
                  aria-label={copiedRoomId === room.id ? t("common.copied") : t("account.copyRoomId")}
                  onClick={(e) => copyRoomId(room.id, e)}
                >
                  {copiedRoomId === room.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
              {room.id !== GLOBAL_ROOM_ID && (
                <button
                  type="button"
                  class="room-leave"
                  title={t("account.leaveRoom")}
                  aria-label={t("account.leaveRoom")}
                  onClick={() => onLeaveRoom(room.id)}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {joinOpen && (
          <form class="room-join-form" onSubmit={handleJoin}>
            <input
              autoFocus
              placeholder={t("account.roomNamePlaceholder")}
              value={newRoomName}
              maxLength={40}
              onInput={(e) => setNewRoomName((e.target as HTMLInputElement).value)}
            />
            <div class="room-id-row">
              <input
                placeholder={t("account.roomIdPlaceholder")}
                value={newRoomId}
                onInput={(e) => setNewRoomId((e.target as HTMLInputElement).value)}
              />
              <button
                type="button"
                class="room-id-regenerate"
                title={t("account.generateRoomId")}
                aria-label={t("account.generateRoomId")}
                onClick={regenerateRoomId}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <button type="submit">{t("account.join")}</button>
          </form>
        )}
        {error && <p class="form-error">{error}</p>}
      </div>

      {hasPendingRequests && (
        <div class="sidebar-section">
          <div class="sidebar-section-head">
            <h3>{t("friends.requestsTitle")}</h3>
            {incomingRequests.length > 0 && (
              <span class="request-badge">{incomingRequests.length}</span>
            )}
          </div>
          <ul class="friend-list">
            {incomingRequests.map((friend) => {
              const { name } = identityFor(directoryFor(friend.roomId), friend.did, friend.name);
              return (
                <li key={friend.did}>
                  <button
                    type="button"
                    class="room-item"
                    onClick={() => onOpenPeerProfile(friend.did, name)}
                  >
                    <Users size={16} class="room-icon" />
                    <span class="room-item-text">
                      <span class="room-name">{name}</span>
                      <span class="request-tag">{t("friends.incomingLabel")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="room-leave"
                    title={t("friends.accept")}
                    aria-label={t("friends.accept")}
                    onClick={() => onAcceptRequest(friend.did)}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    class="room-leave"
                    title={t("friends.decline")}
                    aria-label={t("friends.decline")}
                    onClick={() => onDeclineRequest(friend.did)}
                  >
                    <X size={16} />
                  </button>
                </li>
              );
            })}
            {outgoingRequests.map((friend) => {
              const { name } = identityFor(directoryFor(friend.roomId), friend.did, friend.name);
              return (
                <li key={friend.did}>
                  <button
                    type="button"
                    class="room-item"
                    onClick={() => onOpenPeerProfile(friend.did, name)}
                  >
                    <Users size={16} class="room-icon" />
                    <span class="room-item-text">
                      <span class="room-name">{name}</span>
                      <span class="request-tag">{t("friends.outgoingLabel")}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="room-leave"
                    title={t("friends.cancelRequest")}
                    aria-label={t("friends.cancelRequest")}
                    onClick={() => onCancelRequest(friend.did)}
                  >
                    <X size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div class="sidebar-section">
        <h3>{t("friends.title")}</h3>
        <ul class="friend-list">
          {acceptedFriends.length === 0 && <li class="friend-empty">{t("friends.empty")}</li>}
          {acceptedFriends.map((friend) => {
            const { name } = identityFor(directoryFor(friend.roomId), friend.did, friend.name);
            const online = onlineDids.has(friend.did);
            return (
              <li key={friend.did}>
                <button
                  type="button"
                  class={`room-item ${friend.roomId === activeRoomId ? "room-item--active" : ""}`}
                  onClick={() => onSelectRoom(friend.roomId)}
                >
                  <span class="friend-avatar-wrap">
                    <Users size={16} class="room-icon" />
                    {online && <span class="online-dot" title={t("friends.online")} />}
                  </span>
                  <span class="room-item-text">
                    <span class="room-name">{name}</span>
                  </span>
                  {(unread[friend.roomId] ?? 0) > 0 && (
                    <span class="unread-badge">{unread[friend.roomId]}</span>
                  )}
                </button>
                <button
                  type="button"
                  class="room-copy"
                  title={t("account.viewPeerProfile", { name })}
                  aria-label={t("account.viewPeerProfile", { name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPeerProfile(friend.did, name);
                  }}
                >
                  <User size={14} />
                </button>
                <button
                  type="button"
                  class="room-leave"
                  title={t("friends.remove")}
                  aria-label={t("friends.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFriend(friend.did);
                  }}
                >
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div class="sidebar-section sidebar-section--grow">
        <h3>{t("account.online", { count: peers.length })}</h3>
        <ul class="member-list">
          {peers.length === 0 && <li class="member-empty">{t("account.noOtherPeers")}</li>}
          {peers.map((peer) => (
            <li key={peer.id}>
              {peer.did ? (
                // Clickable only once we know the peer's DID (from presence) —
                // that's the key into the profile directory.
                <button
                  type="button"
                  class="member-item member-item--btn"
                  title={t("account.viewPeerProfile", { name: peer.name })}
                  onClick={() => onOpenPeerProfile(peer.did!, peer.name)}
                >
                  <Avatar id={peer.id} name={peer.name} size={22} />
                  {peer.name}
                </button>
              ) : (
                <div class="member-item">
                  <Avatar id={peer.id} name={peer.name} size={22} />
                  {peer.name}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
