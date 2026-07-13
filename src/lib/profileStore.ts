// Local + shared persistence for the user's profile. The shared record (in
// mistlib storage, pointed to by localStorage `tc-shared-profile-cid-v1`) is an
// INTEROPERABLE SUPERSET so tc-chat and same-origin sibling apps converge on one
// profile without tight coupling:
//   - tc-chat owns `display_name` / `bio` / `avatar` (a 2D image CID).
//   - It also writes `name` (= display_name), `did`, `updatedAt`, `version` so
//     ../tc-vrsns2 (which REQUIRES those) can read tc-chat's profile.
//   - It PRESERVES foreign fields it doesn't own — notably `vrm` (the VRM 3D
//     avatar CID that tc-vrsns2 sets) — via read-merge-write, so it never
//     clobbers another app's data.
// Reads are tolerant: `name` is accepted as a fallback for `display_name`.
// The base `{display_name, bio, avatar}` shape stays mistl-compatible
// (see mistl/src/identity/mod.rs Profile).
import type { SharedStorageBackend } from "../crypto/didIdentity";

/** The shared, interoperable profile record. Extra/foreign keys are preserved. */
export interface ProfileRecord {
  version?: number;
  display_name?: string;
  /** tc-vrsns2's field; kept in sync with display_name. */
  name?: string;
  bio?: string;
  /** 2D profile image, as a mistlib storage CID. */
  avatar?: string;
  /** VRM 3D avatar CID (owned by tc-vrsns2) — preserved, never overwritten here. */
  vrm?: string;
  did?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** The app-facing profile. */
export interface Profile {
  did: string;
  displayName: string;
  bio: string;
  /** mistlib storage CID of the 2D avatar image, or "" when none. */
  avatar: string;
  /** VRM 3D avatar CID from the shared record (set by tc-vrsns2), or "". */
  vrm: string;
}

const LOCAL_KEY = "tc-chat:profile:v1";
const SHARED_CID_KEY = "tc-shared-profile-cid-v1";
const LEGACY_USERNAME_KEY = "tc-chat:username";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function recordToProfile(did: string, record: ProfileRecord): Profile {
  return {
    did,
    // Tolerant read: prefer display_name, fall back to tc-vrsns2's `name`.
    displayName: (record.display_name ?? record.name ?? "").toString().trim(),
    bio: (record.bio ?? "").toString().trim(),
    avatar: (record.avatar ?? "").toString().trim(),
    vrm: (record.vrm ?? "").toString().trim(),
  };
}

/** Minimal record for the local mirror (the shared record is a superset). */
function profileToLocalRecord(profile: Profile): ProfileRecord {
  const record: ProfileRecord = {};
  if (profile.displayName.trim()) record.display_name = profile.displayName.trim();
  if (profile.bio.trim()) record.bio = profile.bio.trim();
  if (profile.avatar.trim()) record.avatar = profile.avatar.trim();
  if (profile.vrm.trim()) record.vrm = profile.vrm.trim();
  return record;
}

/**
 * Loads the locally mirrored profile, falling back to the legacy username-only
 * record so existing users keep their name. `did` is stamped in by the caller.
 */
export function loadLocalProfile(did: string): Profile {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return recordToProfile(did, JSON.parse(raw) as ProfileRecord);
  } catch {
    // fall through to legacy/default
  }
  const legacyName = localStorage.getItem(LEGACY_USERNAME_KEY) ?? "";
  return recordToProfile(did, { display_name: legacyName });
}

export function saveLocalProfile(profile: Profile) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(profileToLocalRecord(profile)));
    // Keep the legacy username key in sync so any code still reading it (and
    // other tc-* apps) sees the current display name.
    localStorage.setItem(LEGACY_USERNAME_KEY, profile.displayName);
  } catch (error) {
    console.warn("tc-chat: failed to persist local profile", error);
  }
}

async function readSharedRecord(backend: SharedStorageBackend): Promise<ProfileRecord | undefined> {
  const cid = localStorage.getItem(SHARED_CID_KEY)?.trim();
  if (!cid) return undefined;
  const bytes = await backend.retrieve(cid);
  if (!bytes) return undefined;
  try {
    return JSON.parse(decoder.decode(bytes)) as ProfileRecord;
  } catch {
    return undefined;
  }
}

/** Reads the shared profile record via its CID pointer, if one is published. */
export async function readSharedProfile(
  did: string,
  backend: SharedStorageBackend,
): Promise<Profile | undefined> {
  const record = await readSharedRecord(backend);
  return record ? recordToProfile(did, record) : undefined;
}

/**
 * Publishes the profile to shared mistlib storage as the interoperable superset,
 * merging over whatever is already there so foreign fields (e.g. tc-vrsns2's
 * `vrm`) survive. Records the resulting CID.
 */
export async function publishSharedProfile(
  profile: Profile,
  backend: SharedStorageBackend,
): Promise<void> {
  const existing = (await readSharedRecord(backend)) ?? {};
  const name = profile.displayName.trim() || undefined;
  const merged: ProfileRecord = {
    ...existing, // preserve foreign fields (vrm, avatarBase64, …)
    version: 1,
    display_name: name,
    name, // tc-vrsns2 reads `name`
    bio: profile.bio.trim() || undefined,
    avatar: profile.avatar.trim() || undefined,
    did: profile.did,
    updatedAt: new Date().toISOString(),
  };
  // tc-chat carries `vrm` read-only; keep it if present, otherwise leave the
  // existing (spread) value untouched.
  if (profile.vrm.trim()) merged.vrm = profile.vrm.trim();
  const cid = await backend.store(encoder.encode(JSON.stringify(merged)));
  try {
    localStorage.setItem(SHARED_CID_KEY, cid);
  } catch (error) {
    console.warn("tc-chat: failed to persist shared profile CID pointer", error);
  }
}
