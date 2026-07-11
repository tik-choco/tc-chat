// Propagates the local user's public profile (display name + avatar CID) to
// peers, and collects theirs, so everyone sees each other's identity in
// realtime — not just their own. Profiles are self-signed `tc-chat:profile`
// broadcasts keyed by DID; a peer can't forge another's profile because the
// signature is verified against the claimed DID (see wireSign). Late joiners
// are handled by re-announcing to each peer as they connect.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  EVENT_PEER_CONNECTED,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import { signWireFields, verifyWire } from "../lib/wireSign";
import { loadDirectory, mergeProfile, type ProfileDirectory } from "../lib/profileDirectory";
import type { Profile } from "../lib/profileStore";

interface ProfileWire extends Record<string, unknown> {
  type: "tc-chat:profile";
  fromId: string;
  displayName: string;
  avatarCid: string;
  bio: string;
  updatedAt: number;
  signature: string;
}

async function broadcastProfile(
  profile: Profile,
  target: string | null,
  channelId: string,
): Promise<void> {
  const node = await getNode();
  const unsigned = {
    type: "tc-chat:profile" as const,
    fromId: profile.did,
    displayName: profile.displayName,
    avatarCid: profile.avatar || "",
    bio: profile.bio || "",
    updatedAt: Date.now(),
  };
  const wire: ProfileWire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(target, wire, DELIVERY_RELIABLE, channelId);
}

export function useProfileDirectory(roomId: string | null, localProfile: Profile | null) {
  const [directory, setDirectory] = useState<ProfileDirectory>(() => loadDirectory());
  const profileRef = useRef(localProfile);
  profileRef.current = localProfile;

  // Keep our own profile in the directory immediately so our own messages and
  // posts resolve to our name/avatar without waiting for a network round trip.
  useEffect(() => {
    if (!localProfile?.did) return;
    setDirectory((d) =>
      mergeProfile(d, localProfile.did, {
        displayName: localProfile.displayName,
        avatarCid: localProfile.avatar || undefined,
        updatedAt: Date.now(),
      }),
    );
  }, [localProfile?.did, localProfile?.displayName, localProfile?.avatar]);

  // Collect peers' profiles, and greet any peer that connects.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    // The swarm topic is the raw room id itself — no derived/obscured channel
    // id, so any peer joining the same room name lands in the same swarm.
    const channelId = roomId;

    async function handleProfile(wire: ProfileWire) {
      if (!(await verifyWire(wire))) return;
      if (cancelled) return;
      setDirectory((d) =>
        mergeProfile(d, wire.fromId, {
          displayName: wire.displayName,
          avatarCid: wire.avatarCid || undefined,
          bio: wire.bio || undefined,
          updatedAt: wire.updatedAt,
        }),
      );
    }

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (eventType === EVENT_PEER_CONNECTED) {
        const p = profileRef.current;
        if (p?.did) broadcastProfile(p, fromId, channelId).catch(() => {});
        return;
      }
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // another room's profile
      const decoded = decodeRawPayload(payload) as ProfileWire | null;
      if (decoded?.type === "tc-chat:profile") handleProfile(decoded);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId]);

  // Announce (and re-announce) our own profile to the room on join and whenever
  // it changes while we're in a room.
  useEffect(() => {
    if (!roomId || !localProfile?.did) return;
    const channelId = roomId;
    const timer = setTimeout(() => {
      const p = profileRef.current;
      if (p?.did) broadcastProfile(p, null, channelId).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [roomId, localProfile?.did, localProfile?.displayName, localProfile?.avatar]);

  return { directory };
}
