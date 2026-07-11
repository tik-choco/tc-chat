import { useEffect, useRef, useState } from "preact/hooks";
import { Maximize2 } from "lucide-preact";
import type { RemoteScreenTrack } from "../hooks/useScreenShare";
import { shortDid } from "../lib/util";
import { Lightbox } from "./Lightbox";
import { useT } from "../lib/i18n";

function RemoteScreenVideo(props: { track: RemoteScreenTrack }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement | null>(null);
  // Blow the live share up into the shared Lightbox (which re-binds the same
  // MediaStream to its own <video> via a ref).
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = props.track.stream;
  }, [props.track.stream]);
  return (
    <figure class="screen-tile">
      <div class="screen-tile-frame">
        <video ref={ref} class="screen-share-video" autoPlay playsInline />
        <button
          type="button"
          class="media-maximize-btn"
          aria-label={t("media.maximizeShare")}
          title={t("media.fullscreen")}
          onClick={() => setMaximized(true)}
        >
          <Maximize2 size={15} />
        </button>
      </div>
      <figcaption class="screen-tile-cap">🖥️ {shortDid(props.track.fromId)}</figcaption>
      {maximized && (
        // A screen share is a lone live stream — one item, so no nav/flow shows.
        <Lightbox
          items={[
            {
              key: props.track.trackId,
              kind: "video",
              stream: props.track.stream,
              fileName: t("media.screenShareFile", { name: shortDid(props.track.fromId) }),
            },
          ]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setMaximized(false)}
        />
      )}
    </figure>
  );
}

/** The "stage": remote screen shares shown above the message stream. Renders
 * nothing when no one is sharing, so it never takes space unnecessarily. */
export function RemoteScreenStage(props: { tracks: RemoteScreenTrack[] }) {
  if (props.tracks.length === 0) return null;
  return (
    <div class="screen-stage">
      {props.tracks.map((t) => (
        <RemoteScreenVideo key={t.trackId} track={t} />
      ))}
    </div>
  );
}
