import { useEffect, useState } from "preact/hooks";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/chat.css";
import "./styles/voice.css";
import "./styles/video.css";
import "./styles/username-gate.css";
import "./styles/board.css";
import "./styles/modal.css";
import "./styles/motion.css";
import "./styles/icons.css";
import "./styles/responsive.css";
import "./styles/devConsole.css";
import "./styles/onboarding.css";
import "./styles/calendar.css";
import "./styles/gif.css";
import "./styles/gallery.css";
import "./styles/markdown.css";
import "./styles/search.css";
import "./styles/archive.css";
import "./styles/personal.css";

import { UsernameGate } from "./components/UsernameGate";
import { Sidebar } from "./components/Sidebar";
import { RoomContent, type RoomTab } from "./components/RoomContent";
import { ProfilePanel } from "./components/ProfilePanel";
import { PeerProfileModal } from "./components/PeerProfileModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { DevConsole } from "./components/DevConsole";
import { Onboarding } from "./components/Onboarding";
import { PersonalCalendarPanel } from "./components/PersonalCalendarPanel";
import { RoomNamePanel } from "./components/RoomNamePanel";
import { RoomIdentityPanel } from "./components/RoomIdentityPanel";
import { RoomInvitePanel } from "./components/RoomInvitePanel";
import { JoinRoomBanner } from "./components/JoinRoomBanner";
import { SearchPanel } from "./components/SearchPanel";
import { HistoryArchivePanel } from "./components/HistoryArchivePanel";
import { PersonalChat } from "./components/PersonalChat";
import { useRooms } from "./hooks/useRooms";
import { useFriends } from "./hooks/useFriends";
import { useChatRoom } from "./hooks/useChatRoom";
import { useVoiceChat } from "./hooks/useVoiceChat";
import { useScreenShare } from "./hooks/useScreenShare";
import { useVideoCall } from "./hooks/useVideoCall";
import { usePostStream } from "./hooks/usePostStream";
import { useCalendarEvents } from "./hooks/useCalendarEvents";
import { useMediaGallery } from "./hooks/useMediaGallery";
import { usePersonalEvents } from "./hooks/usePersonalEvents";
import { usePersonalNotes } from "./hooks/usePersonalNotes";
import { useHistorySync } from "./hooks/useHistorySync";
import { useMessageAlerts } from "./hooks/useMessageAlerts";
import { useProfile } from "./hooks/useProfile";
import { useProfileDirectory } from "./hooks/useProfileDirectory";
import { useRoomDisplayName } from "./hooks/useRoomDisplayName";
import { useRoomMeta } from "./hooks/useRoomMeta";
import { useTheme } from "./hooks/useTheme";
import { useMutes } from "./hooks/useMutes";
import { useRoomNotify } from "./hooks/useRoomNotify";
import { DEFAULT_ROOM_ALERTS } from "./lib/roomNotifyStore";
import {
  loadUsername,
  saveUsername,
  loadChatDisplay,
  saveChatDisplay,
  loadDevMode,
  saveDevMode,
  loadMediaCaution,
  saveMediaCaution,
  loadLastView,
  saveLastView,
  loadPosts,
  purgeStaleGlobalRoomStorage,
  type ChatDisplay,
} from "./lib/chatStore";
import { getNode, createMistStorageBackend } from "./lib/mistClient";
import { identityFor } from "./lib/profileDirectory";
import { ensureDidIdentity, ensureSharedDidIdentity } from "./crypto/didIdentity";
import {
  GLOBAL_ROOM_ID,
  isPersonalRoom,
  hashForLocation,
  locationFromHash,
  type AppLocation,
} from "./lib/util";
import type { PostSurface } from "./lib/chatStore";
import type { SearchScopeRoom } from "./lib/postSearch";
import { MAX_INVITE_NAME } from "./lib/roomInvite";
import {
  shouldShowOnboarding,
  markOnboardingDone,
  subscribeOnboardingRequests,
  requestOnboarding,
} from "./lib/onboarding";
import { useT } from "./lib/i18n";

export function App() {
  const [username, setUsername] = useState(() => loadUsername());
  // Where to land: an explicit deep link in the hash wins; with no hash,
  // reopen whatever room/tab/thread was on screen last session (saved by the
  // hash-mirroring effect below); a first-ever visit gets the global chat.
  const [initialView] = useState<AppLocation>(
    () =>
      locationFromHash(window.location.hash) ??
      loadLastView() ?? { roomId: GLOBAL_ROOM_ID, tab: "chat", threadId: null },
  );
  const [activeRoomId, setActiveRoomId] = useState(initialView.roomId);
  const [roomTab, setRoomTab] = useState<RoomTab>(initialView.tab);
  // The board's open thread lives up here (not in ProjectBoard) so it can be
  // part of the URL — deep links straight into a thread — and of the
  // restored last view.
  const [boardThreadId, setBoardThreadId] = useState<string | null>(initialView.threadId);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Which peer's read-only profile card is open (their DID + a fallback name).
  const [peerProfile, setPeerProfile] = useState<{ did: string; name: string } | null>(null);
  // On phones the sidebar is an off-canvas drawer (see responsive.css); this
  // toggles it. On desktop the sidebar is always docked and the flag is inert.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatDisplay, setChatDisplay] = useState<ChatDisplay>(() => loadChatDisplay());
  const [devMode, setDevMode] = useState<boolean>(() => loadDevMode());
  const [mediaCaution, setMediaCaution] = useState<boolean>(() => loadMediaCaution());
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding());
  const [personalCalendarOpen, setPersonalCalendarOpen] = useState(false);
  const [roomNameOpen, setRoomNameOpen] = useState(false);
  const [roomIdentityOpen, setRoomIdentityOpen] = useState(false);
  // Which room's invite share sheet is open (any room in the list, not just the
  // active one — the sidebar can invite to a room without switching to it).
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(null);
  // The label an invite link carried for a room we haven't added yet (see the
  // "?name=" effect below) — used by the join banner and, until the room is
  // added, as its on-screen name.
  const [pendingInvite, setPendingInvite] = useState<{ roomId: string; name: string } | null>(null);
  // Rooms whose join banner was dismissed this session; deliberately not
  // persisted, so the offer comes back next time the room is opened.
  const [joinDismissed, setJoinDismissed] = useState<string[]>([]);

  // The global room became ephemeral (see chatStore's isEphemeralRoom) —
  // one-time sweep of whatever it persisted to this browser back when it
  // wasn't. No-ops once already clean.
  useEffect(() => {
    purgeStaleGlobalRoomStorage();
  }, []);

  const t = useT();
  const theme = useTheme();
  // Local mute list, shared by the peer profile card (mute/unmute) and the
  // settings panel (review/undo). The receive-side drop and the render-side
  // filter both live deeper, in usePostStream/useMessageAlerts.
  const { mutes, mutedDids, mute, unmute } = useMutes();
  // Per-room alerting prefs — orthogonal to muting a person: silencing a room
  // stops only the badge and the desktop notification, never delivery.
  const { alertsFor: roomAlertsFor, silencedRoomIds, setAlerts: setRoomAlerts } = useRoomNotify();
  const { profile, saveProfile } = useProfile(nodeId);
  const displayName = profile?.displayName || username;
  const { override: roomNameOverride, setOverride: setRoomNameOverride } =
    useRoomDisplayName(activeRoomId);
  const roomDisplayName = roomNameOverride || displayName;

  const { rooms, joinRoom, leaveRoom } = useRooms();
  // The personal notes space occupies a room slot but is NOT a swarm topic
  // (see PERSONAL_ROOM_ID). Every hook below that could reach the network is
  // handed `null` while it's on screen, so nothing is joined, sent or
  // received under this id. useChatRoom is the load-bearing one — it owns the
  // only joinRoomAsync call in the app, so cutting it here is what makes the
  // "never broadcast" promise structural rather than a matter of care.
  const isPersonal = isPersonalRoom(activeRoomId);
  const {
    friends,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useFriends(isPersonal ? null : activeRoomId, nodeId, roomDisplayName);
  const personalEvents = usePersonalEvents();
  const personalNotes = usePersonalNotes();
  const {
    status,
    peers,
    messages,
    sendText,
    sendFile,
    sendStoredFile,
    toggleReaction: toggleChatReaction,
    editMessage,
    deleteMessage,
    typingNames,
    notifyTyping,
  } = useChatRoom(username && !isPersonal ? activeRoomId : null, roomDisplayName);
  // The board is the "board" surface of the same post engine — recursive
  // (parentId), so a comment is just a post whose parentId points at another.
  const {
    nodes,
    createPost: createNode,
    toggleReaction: toggleBoardReaction,
    editPost: editNode,
    deletePost: deleteNode,
  } = usePostStream(status === "joined" ? activeRoomId : null, "board", roomDisplayName);
  // The room calendar is the "calendar" surface of the same post engine.
  const { events, createEvent, editEvent, deleteEvent } = useCalendarEvents(
    status === "joined" ? activeRoomId : null,
    roomDisplayName,
  );
  // The shared media gallery is the "gallery" surface of the same post engine.
  const gallery = useMediaGallery(status === "joined" ? activeRoomId : null, roomDisplayName);
  // The global room is joinable by anyone, so voice/screen share/video call
  // (which would otherwise broadcast to whoever happens to be present) are
  // disabled there.
  const inCallableRoom = status === "joined" && activeRoomId !== GLOBAL_ROOM_ID;
  const voice = useVoiceChat(inCallableRoom ? activeRoomId : null);
  const screenShare = useScreenShare(inCallableRoom ? activeRoomId : null);
  const videoCall = useVideoCall(inCallableRoom ? activeRoomId : null);
  // Late joiners request prior chat + board history once they're in the room.
  useHistorySync(status === "joined" ? activeRoomId : null);
  // Unread badges + desktop notifications for chat arriving in rooms we're
  // not looking at (incl. every accepted friend's DM, joined in background).
  const { unread, notifPermission, requestNotifications } = useMessageAlerts(
    activeRoomId,
    nodeId,
    friends,
  );
  // Share our profile with peers and collect theirs (names + avatars).
  const { directory, directoryFor } = useProfileDirectory(
    status === "joined" ? activeRoomId : null,
    profile,
    roomDisplayName,
  );
  // The room's SHARED name/icon (set by any peer, synced to everyone) —
  // distinct from `rooms`' per-peer local labels above.
  const {
    meta: sharedRoomMeta,
    metaFor: sharedRoomMetaFor,
    setRoomMeta,
  } = useRoomMeta(status === "joined" ? activeRoomId : null);

  useEffect(() => {
    if (!username) return;
    // posts identify their sender by DID (see PostWire in usePostStream), so
    // "is this mine" comparisons need the local DID, not mistlib's own
    // transport-level node id.
    //
    // The local mirror is resolved first so signing (ensureDidIdentity(),
    // used by wireSign/usePostStream) has an identity
    // available immediately. Once mistlib is initialized, reconcile against
    // the shared cross-app DID (see didIdentity.ts): this rewrites the local
    // mirror in place, so subsequent ensureDidIdentity() calls elsewhere
    // pick up the reconciled identity automatically. A failed reconciliation
    // must not block the app, so it never throws past this point.
    ensureDidIdentity().then((identity) => setNodeId(identity.did));
    getNode()
      .then(() => ensureSharedDidIdentity({ backend: createMistStorageBackend() }))
      .then((identity) => setNodeId(identity.did))
      .catch(() => {
        // Shared store reconciliation failed; keep using the local identity.
      });
  }, [username]);

  // Reflect the on-screen location into the URL hash (see hashForLocation)
  // and remember it as the view to restore next launch. replaceState (not
  // push) keeps channel-hopping out of the back stack, and — since it fires
  // no hashchange — won't loop with the listener below.
  useEffect(() => {
    const view: AppLocation = { roomId: activeRoomId, tab: roomTab, threadId: boardThreadId };
    const target = hashForLocation(view);
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
    saveLastView(view);
  }, [activeRoomId, roomTab, boardThreadId]);

  // The reverse direction: browser back/forward, a pasted deep link, or a hand
  // edit of the hash navigates. This only fires for real external navigation
  // (the mirroring effect above uses replaceState, which emits no hashchange),
  // so applying the URL verbatim — room, tab and thread — is correct. The
  // voice/screen-share hooks self-tear down when their roomId changes, so
  // plain setState calls are enough here.
  useEffect(() => {
    function onHashChange() {
      const loc = locationFromHash(window.location.hash);
      if (!loc) return;
      setActiveRoomId((cur) => (cur === loc.roomId ? cur : loc.roomId));
      setRoomTab(loc.tab);
      setBoardThreadId(loc.threadId);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // A "?name=<label>" query param — carried by invite links (see roomInvite.ts)
  // and by cross-app hand-off links (e.g. a sibling app's "open our party's chat
  // room" button) — is the inviter's label for the room in the hash. Consumed
  // once and stripped from the URL. It does NOT add the room to the room list
  // on its own: the JoinRoomBanner below asks first, so following a link never
  // silently grows someone's sidebar. An already-known room (named by the user,
  // or visited before) keeps its own label, and the global room is never
  // relabelled this way.
  useEffect(() => {
    if (!username) return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name");
    if (!name) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (activeRoomId !== GLOBAL_ROOM_ID && !rooms.some((r) => r.id === activeRoomId)) {
      setPendingInvite({ roomId: activeRoomId, name: name.trim().slice(0, MAX_INVITE_NAME) });
    }
    // Deliberately keyed on `username` alone, not on activeRoomId/rooms: the
    // "?name=" param is consumed exactly once, for the room the URL landed on,
    // and is stripped from the URL above. Re-running on a later room switch
    // would either find no param (harmless but pointless) or, if it somehow
    // did, relabel the wrong room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Escape closes the mobile drawer (a common, expected gesture).
  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  // Lets Settings ("View guide") re-open the onboarding guide on demand.
  useEffect(() => subscribeOnboardingRequests(() => setOnboardingOpen(true)), []);

  function closeOnboarding() {
    markOnboardingDone();
    setOnboardingOpen(false);
  }

  function handleUsernameSubmit(name: string) {
    saveUsername(name);
    setUsername(name);
  }

  function handleChangeChatDisplay(display: ChatDisplay) {
    setChatDisplay(display);
    saveChatDisplay(display);
  }

  function handleChangeDevMode(enabled: boolean) {
    setDevMode(enabled);
    saveDevMode(enabled);
  }

  function handleChangeMediaCaution(enabled: boolean) {
    setMediaCaution(enabled);
    saveMediaCaution(enabled);
  }

  function handleSelectRoom(id: string) {
    voice.leave();
    screenShare.stop();
    videoCall.stop();
    setActiveRoomId(id);
    setRoomTab("chat");
    setBoardThreadId(null);
    setSidebarOpen(false); // dismiss the drawer once a room is picked (mobile)
  }

  function handleLeaveRoom(id: string) {
    leaveRoom(id);
    if (activeRoomId === id) handleSelectRoom(GLOBAL_ROOM_ID);
  }

  function handleSendFriendRequest(name: string) {
    if (!peerProfile) return;
    sendFriendRequest(peerProfile.did, name);
  }

  /**
   * Walks a board post up its `parentId` chain to the root of its thread, since
   * ProjectBoard's `openThreadId` only ever matches a root (a nested reply id
   * would open nothing). Reads the target room's stored board stream directly:
   * a search hit is usually in a room we haven't switched to yet, so the
   * board's own live `nodes` don't cover it. The `seen` set guards against a
   * cycle in peer-supplied parent links.
   */
  function boardThreadRootFor(roomId: string, postId: string): string {
    const posts = loadPosts("board", roomId);
    const seen = new Set<string>();
    let current = posts.find((p) => p.id === postId);
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = posts.find((p) => p.id === current!.parentId);
      if (!parent) break;
      current = parent;
    }
    return current?.id ?? postId;
  }

  /**
   * Navigates to a search hit. The room + tab always land correctly; on the
   * board we additionally open the containing thread. There's no
   * scroll-to-post mechanism in any surface yet, so within a long stream the
   * user still has to spot the message themselves.
   */
  function handleSearchJump(roomId: string, surface: PostSurface, postId: string) {
    if (roomId !== activeRoomId) {
      voice.leave();
      screenShare.stop();
      videoCall.stop();
      setActiveRoomId(roomId);
    }
    setRoomTab(surface);
    setBoardThreadId(surface === "board" ? boardThreadRootFor(roomId, postId) : null);
    setSidebarOpen(false);
  }

  function handleRemoveFriend(did: string) {
    const friend = friends.find((f) => f.did === did && f.status === "accepted");
    removeFriend(did);
    if (friend && activeRoomId === friend.roomId) handleSelectRoom(GLOBAL_ROOM_ID);
  }

  if (!username) {
    return <UsernameGate onSubmit={handleUsernameSubmit} />;
  }

  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  // A DM's room id isn't in the persisted rooms list (see friendsStore.ts) — it's
  // computed on the fly from the friend's DID pair, so resolve its display name
  // (and "is this a DM" flag) from the friends list instead. Only accepted
  // friends have a live DM — pending requests don't get a channel yet.
  const activeFriend = friends.find((f) => f.roomId === activeRoomId && f.status === "accepted");
  const isDm = activeFriend !== undefined;
  // The label an invite link supplied for this room, until it's added to the
  // room list (at which point the list's own label takes over).
  const invitedName = pendingInvite?.roomId === activeRoomId ? pendingInvite.name : null;
  // The shared name (set by any peer, synced via useRoomMeta) wins over this
  // peer's own local room label; DMs and the global room never have one.
  const roomName = isPersonal
    ? t("personal.title")
    : (!isDm && sharedRoomMeta?.name) ||
      activeRoom?.name ||
      invitedName ||
      (activeFriend
        ? identityFor(directory, activeFriend.did, activeFriend.name).name
        : undefined) ||
      activeRoomId;
  // Everything worth searching: the room list, every accepted friend's DM (a
  // DM's id is derived, never in `rooms` — see friendsStore), and the room on
  // screen even when it's a link-only room that was never added to the list.
  const searchRooms: SearchScopeRoom[] = [
    ...rooms.map((r) => ({ id: r.id, name: sharedRoomMetaFor(r.id)?.name || r.name })),
    ...friends
      .filter((f) => f.status === "accepted")
      .map((f) => ({ id: f.roomId, name: identityFor(directoryFor(f.roomId), f.did, f.name).name })),
  ];
  // The personal space is deliberately out of scope: postSearch reads
  // chatStore's localStorage post lists, and notes live in the OPFS KV store
  // instead — including it would only ever add a room that never matches.
  if (!isPersonal && !searchRooms.some((r) => r.id === activeRoomId)) {
    searchRooms.push({ id: activeRoomId, name: roomName });
  }

  // Silenced rooms, resolved to display names so Settings can list them. A room
  // whose preference outlived the room itself (left, or a removed friend's DM)
  // still gets a row — under its raw id — so the setting is never unreachable.
  const silencedRooms = silencedRoomIds.map((id) => ({
    id,
    name: searchRooms.find((r) => r.id === id)?.name ?? id,
  }));

  const canEditRoomIdentity = status === "joined" && activeRoomId !== GLOBAL_ROOM_ID && !isDm;
  // There is nobody to invite to a space only this device can see.
  const canInvite = activeRoomId !== GLOBAL_ROOM_ID && !isDm && !isPersonal;
  // A room reached by link (invite or plain deep link) is fully usable without
  // being in the room list — the swarm join follows the URL — so the only thing
  // missing is a way back to it later. Offer to add it rather than doing it
  // silently; DMs and the global room are always reachable, so they never ask.
  // The personal space is never in `rooms` either, but it's built in rather
  // than link-reached — there is nothing to join.
  const showJoinBanner =
    activeRoomId !== GLOBAL_ROOM_ID &&
    !isDm &&
    !isPersonal &&
    !activeRoom &&
    !joinDismissed.includes(activeRoomId);

  function handleJoinActiveRoom() {
    joinRoom(activeRoomId, roomName);
    setPendingInvite((cur) => (cur?.roomId === activeRoomId ? null : cur));
  }

  const inviteRoomMeta = inviteRoomId ? sharedRoomMetaFor(inviteRoomId) : undefined;

  return (
    <div class="app-shell">
      <Sidebar
        open={sidebarOpen}
        profile={profile}
        displayName={displayName}
        theme={theme.theme}
        onToggleTheme={theme.toggle}
        onOpenProfile={() => {
          setProfileOpen(true);
          setSidebarOpen(false);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        onOpenPersonalCalendar={() => {
          setPersonalCalendarOpen(true);
          setSidebarOpen(false);
        }}
        onOpenSearch={() => {
          setSearchOpen(true);
          setSidebarOpen(false);
        }}
        rooms={rooms}
        roomMetaFor={sharedRoomMetaFor}
        activeRoomId={activeRoomId}
        onSelectRoom={handleSelectRoom}
        onJoinRoom={(id, name) => joinRoom(id, name)}
        onLeaveRoom={handleLeaveRoom}
        onInviteToRoom={(id) => {
          setInviteRoomId(id);
          setSidebarOpen(false);
        }}
        peers={peers}
        onOpenPeerProfile={(did, name) => setPeerProfile({ did, name })}
        friends={friends}
        directoryFor={directoryFor}
        onRemoveFriend={handleRemoveFriend}
        onAcceptRequest={acceptFriendRequest}
        onDeclineRequest={declineFriendRequest}
        onCancelRequest={cancelFriendRequest}
        unread={unread}
      />
      {sidebarOpen && (
        <button
          type="button"
          class="sidebar-backdrop"
          aria-label={t("common.closeMenu")}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {isPersonal ? (
        // A single surface, not the four-tab room shell: the board/calendar/
        // gallery tabs are all backed by the swarm-fed post engine, which this
        // space deliberately isn't wired to.
        <PersonalChat
          notes={personalNotes.notes}
          ready={personalNotes.ready}
          error={personalNotes.error}
          onDismissError={personalNotes.dismissError}
          onOpenSidebar={() => setSidebarOpen(true)}
          onAddText={personalNotes.addText}
          onAddAttachment={personalNotes.addAttachment}
          onEditNote={personalNotes.editNote}
          onRemoveNote={personalNotes.removeNote}
        />
      ) : (
        <RoomContent
          tab={roomTab}
          onChangeTab={setRoomTab}
          onOpenSidebar={() => setSidebarOpen(true)}
          banner={
            showJoinBanner ? (
              <JoinRoomBanner
                roomName={roomName}
                invited={invitedName !== null}
                onJoin={handleJoinActiveRoom}
                onDismiss={() => setJoinDismissed((ids) => [...ids, activeRoomId])}
              />
            ) : null
          }
          chatWindowProps={{
            roomId: activeRoomId,
            roomName,
            roomIconCid: isDm ? undefined : sharedRoomMeta?.iconCid,
            isDm,
            localNodeId: nodeId,
            messages,
            ready: status === "joined",
            chatDisplay,
            directory,
            peers,
            selfName: roomDisplayName,
            typingNames,
            onTyping: notifyTyping,
            onSendText: sendText,
            onSendFile: sendFile,
            onSendStoredFile: sendStoredFile,
            onToggleReaction: toggleChatReaction,
            onEditMessage: editMessage,
            onDeleteMessage: deleteMessage,
            onOpenProfile: (did, name) => setPeerProfile({ did, name }),
            onEditSelfRoomName: () => setRoomNameOpen(true),
            onEditRoomIdentity: canEditRoomIdentity ? () => setRoomIdentityOpen(true) : undefined,
            onInvite: canInvite ? () => setInviteRoomId(activeRoomId) : undefined,
            voice,
            screenShare,
            videoCall,
          }}
          boardProps={{
            roomName,
            localNodeId: nodeId,
            nodes,
            ready: status === "joined",
            directory,
            onCreate: createNode,
            onToggleReaction: toggleBoardReaction,
            onEdit: editNode,
            onDelete: deleteNode,
            openThreadId: boardThreadId,
            onOpenThread: setBoardThreadId,
          }}
          calendarProps={{
            roomName,
            localNodeId: nodeId,
            events,
            ready: status === "joined",
            directory,
            onCreate: createEvent,
            onEdit: editEvent,
            onDelete: deleteEvent,
          }}
          galleryProps={{
            roomName,
            localNodeId: nodeId,
            items: gallery.items,
            ready: status === "joined",
            directory,
            onAddFiles: gallery.addFiles,
            onAddStoredFile: gallery.addStoredFile,
            onToggleReaction: gallery.toggleReaction,
            onDelete: gallery.deleteItem,
          }}
        />
      )}

      {profileOpen && profile && (
        <ProfilePanel
          profile={profile}
          onSave={saveProfile}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          chatDisplay={chatDisplay}
          onChangeChatDisplay={handleChangeChatDisplay}
          devMode={devMode}
          onChangeDevMode={handleChangeDevMode}
          notifPermission={notifPermission}
          onRequestNotifications={requestNotifications}
          mediaCaution={mediaCaution}
          onChangeMediaCaution={handleChangeMediaCaution}
          mutes={mutes}
          onUnmute={unmute}
          activeRoomName={roomName}
          activeRoomAlerts={roomAlertsFor(activeRoomId)}
          onChangeActiveRoomAlerts={(prefs) => setRoomAlerts(activeRoomId, prefs)}
          silencedRooms={silencedRooms}
          onResetRoomAlerts={(id) => setRoomAlerts(id, DEFAULT_ROOM_ALERTS)}
          onOpenArchive={() => {
            setSettingsOpen(false);
            setArchiveOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
          onOpenGuide={() => {
            setSettingsOpen(false);
            requestOnboarding();
          }}
        />
      )}

      {devMode && <DevConsole onClose={() => handleChangeDevMode(false)} />}

      {onboardingOpen && <Onboarding onClose={closeOnboarding} />}

      {personalCalendarOpen && (
        <PersonalCalendarPanel
          events={personalEvents.events}
          onAdd={personalEvents.addEvent}
          onEdit={personalEvents.editEvent}
          onRemove={personalEvents.removeEvent}
          onClose={() => setPersonalCalendarOpen(false)}
        />
      )}

      {roomNameOpen && (
        <RoomNamePanel
          roomName={roomName}
          globalName={displayName}
          value={roomNameOverride}
          onSave={setRoomNameOverride}
          onClose={() => setRoomNameOpen(false)}
        />
      )}

      {roomIdentityOpen && canEditRoomIdentity && (
        <RoomIdentityPanel
          roomId={activeRoomId}
          currentName={roomName}
          currentIconCid={sharedRoomMeta?.iconCid}
          onSave={setRoomMeta}
          onClose={() => setRoomIdentityOpen(false)}
        />
      )}

      {inviteRoomId && (
        <RoomInvitePanel
          roomId={inviteRoomId}
          roomName={
            inviteRoomMeta?.name ||
            rooms.find((r) => r.id === inviteRoomId)?.name ||
            inviteRoomId
          }
          roomIconCid={inviteRoomMeta?.iconCid}
          selfName={displayName}
          friends={friends}
          directoryFor={directoryFor}
          onClose={() => setInviteRoomId(null)}
        />
      )}

      {peerProfile && (
        <PeerProfileModal
          did={peerProfile.did}
          fallbackName={peerProfile.name}
          directory={directory}
          selfDid={nodeId}
          friendStatus={friends.find((f) => f.did === peerProfile.did)?.status ?? null}
          onSendRequest={handleSendFriendRequest}
          onAcceptRequest={() => peerProfile && acceptFriendRequest(peerProfile.did)}
          onDeclineRequest={() => peerProfile && declineFriendRequest(peerProfile.did)}
          onCancelRequest={() => peerProfile && cancelFriendRequest(peerProfile.did)}
          muted={mutedDids.has(peerProfile.did)}
          onMute={(name) => mute(peerProfile.did, name)}
          onUnmute={() => unmute(peerProfile.did)}
          onClose={() => setPeerProfile(null)}
        />
      )}

      {searchOpen && (
        <SearchPanel
          rooms={searchRooms}
          onJump={handleSearchJump}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {archiveOpen && (
        <HistoryArchivePanel rooms={searchRooms} onClose={() => setArchiveOpen(false)} />
      )}
    </div>
  );
}
