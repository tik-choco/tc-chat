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
import { useHistorySync } from "./hooks/useHistorySync";
import { useMessageAlerts } from "./hooks/useMessageAlerts";
import { useProfile } from "./hooks/useProfile";
import { useProfileDirectory } from "./hooks/useProfileDirectory";
import { useRoomDisplayName } from "./hooks/useRoomDisplayName";
import { useTheme } from "./hooks/useTheme";
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
  type ChatDisplay,
} from "./lib/chatStore";
import { getNode, createMistStorageBackend } from "./lib/mistClient";
import { identityFor } from "./lib/profileDirectory";
import { ensureDidIdentity, ensureSharedDidIdentity } from "./crypto/didIdentity";
import { GLOBAL_ROOM_ID, hashForLocation, locationFromHash, type AppLocation } from "./lib/util";
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

  const t = useT();
  const theme = useTheme();
  const { profile, saveProfile } = useProfile(nodeId);
  const displayName = profile?.displayName || username;
  const { override: roomNameOverride, setOverride: setRoomNameOverride } =
    useRoomDisplayName(activeRoomId);
  const roomDisplayName = roomNameOverride || displayName;

  const { rooms, joinRoom, leaveRoom } = useRooms();
  const {
    friends,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useFriends(activeRoomId, nodeId, roomDisplayName);
  const personalEvents = usePersonalEvents();
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
  } = useChatRoom(username ? activeRoomId : null, roomDisplayName);
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

  // A "?name=<label>" query param — used by cross-app hand-off links (e.g. a
  // sibling app's "open our party's chat room" button) — seeds this room's
  // sidebar name on first visit instead of leaving it as a raw id. Consumed
  // once and stripped from the URL; an already-known room (one the user has
  // named themselves, or visited before) is left untouched, and the global
  // room can never be renamed this way.
  useEffect(() => {
    if (!username) return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name");
    if (!name) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (activeRoomId !== GLOBAL_ROOM_ID && !rooms.some((r) => r.id === activeRoomId)) {
      joinRoom(activeRoomId, name.trim().slice(0, 60));
    }
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
  const roomName =
    activeRoom?.name ??
    (activeFriend ? identityFor(directory, activeFriend.did, activeFriend.name).name : undefined) ??
    activeRoomId;
  const isDm = activeFriend !== undefined;

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
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={handleSelectRoom}
        onJoinRoom={(id, name) => joinRoom(id, name)}
        onLeaveRoom={handleLeaveRoom}
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
      <RoomContent
        tab={roomTab}
        onChangeTab={setRoomTab}
        onOpenSidebar={() => setSidebarOpen(true)}
        chatWindowProps={{
          roomId: activeRoomId,
          roomName,
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
          onClose={() => setPeerProfile(null)}
        />
      )}
    </div>
  );
}
