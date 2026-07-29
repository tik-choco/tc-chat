// Room invites. An invite is nothing more than a URL that deep-links into a
// room (`#/<roomId>`, the same hash the app already mirrors its location into)
// plus a `?name=` label so the receiving side can show/persist a readable room
// name instead of a raw id. There is no invite token, no expiry and no
// server-side state: the room id IS the swarm topic (see mistClient/useChatRoom),
// so "being invited" and "knowing the id" are the same thing — the link is
// simply the ergonomic way to hand that id over.
//
// The `?name=` query param predates this module (it was the cross-app hand-off
// link a sibling tik-choco app used to open "our party's room"); invites reuse
// it verbatim so existing links keep working.
import { getNode, storage_add, DELIVERY_RELIABLE } from "./mistClient";
import { ensureDidIdentity } from "../crypto/didIdentity";
import { signWireFields } from "./wireSign";
import { generatePostEnc, encryptPostBytes } from "../crypto/postCipher";
import { appendPost, appendWireLog } from "./chatStore";
import { hashForRoomId, newId } from "./util";

/** Cap on the label carried in `?name=`, matching App's consume-side slice. */
export const MAX_INVITE_NAME = 60;

/**
 * The shareable link for a room. `base` (origin + path, no query/hash) is
 * defaulted from the current page so a deployment under any path — GitHub
 * Pages' `/tc-chat/`, a local `vite --host` — produces a link back to itself;
 * it is a parameter purely so this stays testable without a DOM.
 */
export function buildInviteUrl(roomId: string, roomName?: string, base?: string): string {
  const origin =
    base ??
    (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");
  const name = roomName?.trim().slice(0, MAX_INVITE_NAME);
  // A name equal to the id adds nothing to the link — the receiver falls back
  // to the id anyway — so leave it off and keep the URL (and its QR) shorter.
  const query = name && name !== roomId ? `?name=${encodeURIComponent(name)}` : "";
  return `${origin}${query}${hashForRoomId(roomId)}`;
}

// Same generic blob name usePostStream uses, so nothing about the content
// leaks into mistlib's plaintext manifest.
const ENC_STORAGE_NAME = "enc.bin";

/**
 * Sends a plain chat message into a room the app isn't currently viewing —
 * used to drop an invite link into a friend's DM without switching to it.
 *
 * This deliberately mirrors usePostStream's `createPost` for the text kind
 * (encrypt body → storage_add → sign → room-scoped send → log + persist)
 * rather than importing it, because that one lives inside a hook bound to the
 * ACTIVE room. Keep the wire shape here in sync with PostWire in
 * usePostStream.ts; a divergence would make these messages undecodable to
 * every other peer.
 */
export async function sendInviteDm(roomId: string, fromName: string, text: string): Promise<void> {
  const node = await getNode();
  // The DM swarm is normally already joined in the background (useMessageAlerts
  // joins every accepted friend's DM up front), but an invite can be sent before
  // that lands — joining first means the room-scoped send below can't hit the
  // "room not joined" race.
  if (!node.isRoomJoined(roomId)) await node.joinRoomAsync(roomId);
  const identity = await ensureDidIdentity();
  const id = newId();
  const enc = generatePostEnc();
  const blob = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text })));
  const cid = await storage_add(ENC_STORAGE_NAME, blob);
  const timestamp = Date.now();
  const unsigned = {
    type: "tc-chat:post" as const,
    surface: "chat" as const,
    id,
    parentId: null,
    fromId: identity.did,
    fromName,
    timestamp,
    kind: "text" as const,
    cid,
    enc,
  };
  const wire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(null, wire, DELIVERY_RELIABLE, roomId);
  appendWireLog(roomId, wire);
  // Persist our own copy so the invite is already in the DM when it's opened
  // (nothing is mounted on that room to hydrate it from the wire).
  appendPost({
    id,
    roomId,
    surface: "chat",
    parentId: null,
    fromId: identity.did,
    fromName: "自分",
    timestamp,
    kind: "text",
    cid,
    enc,
    text,
    reactions: [],
  });
}
