// Owns the local user's profile: loads the local mirror immediately (so the UI
// never waits on the network for the owner's own name), then reconciles with
// the shared cross-app record once mistlib is ready. Saves write through to
// both the local mirror and shared mistlib storage. All shared-store work is
// best-effort — a failure never blocks editing your own profile.
import { useEffect, useState } from "preact/hooks";
import { getNode, createMistStorageBackend } from "../lib/mistClient";
import {
  loadLocalProfile,
  saveLocalProfile,
  readSharedProfile,
  publishSharedProfile,
  type Profile,
} from "../lib/profileStore";

export function useProfile(did: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!did) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const local = loadLocalProfile(did);
    setProfile(local);

    (async () => {
      try {
        await getNode();
        const shared = await readSharedProfile(did, createMistStorageBackend());
        if (cancelled || !shared) return;
        // Adopt the shared record only when we have nothing meaningful locally,
        // so the owner's own edits always win over a stale shared copy.
        if (!local.displayName && shared.displayName) {
          saveLocalProfile(shared);
          setProfile(shared);
        }
      } catch {
        // Shared store unreachable; keep the local profile.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did]);

  async function saveProfile(next: Profile) {
    setProfile(next);
    saveLocalProfile(next);
    try {
      await getNode();
      await publishSharedProfile(next, createMistStorageBackend());
    } catch {
      // Published opportunistically; the local mirror is the source of truth.
    }
  }

  return { profile, saveProfile };
}
