import { useEffect, useMemo, useState } from "preact/hooks";
import {
  loadMutes,
  subscribeMutes,
  mutePeer,
  unmutePeer,
  isMuted as isMutedPeer,
  type MutedPeer,
} from "../lib/muteStore";

/**
 * Reactive view over muteStore's global mute list, for the peer-profile mute
 * button and the settings panel's muted-people section. `mutedDids` is a
 * Set for O(1) render-path filtering (e.g. hiding a muted peer's
 * already-stored posts in usePostStream) and stays the same reference across
 * renders where `mutes` itself hasn't changed, so it's safe to depend on
 * from useMemo/useCallback without causing needless re-filters.
 */
export function useMutes(): {
  mutes: MutedPeer[];
  mutedDids: Set<string>;
  isMuted: (did: string) => boolean;
  mute: (did: string, name: string) => void;
  unmute: (did: string) => void;
} {
  const [mutes, setMutes] = useState<MutedPeer[]>(() => loadMutes());

  useEffect(() => {
    // Re-seed on mount: another tab (or another mounted instance of this
    // hook) may have changed the list between the initial render above and
    // this effect running, so don't rely solely on subscribeMutes' next fire.
    setMutes(loadMutes());
    return subscribeMutes(setMutes);
  }, []);

  const mutedDids = useMemo(() => new Set(mutes.map((m) => m.did)), [mutes]);

  return {
    mutes,
    mutedDids,
    isMuted: isMutedPeer,
    mute: (did: string, name: string) => {
      mutePeer(did, name);
    },
    unmute: (did: string) => {
      unmutePeer(did);
    },
  };
}
