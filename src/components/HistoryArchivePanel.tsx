import { useEffect } from "preact/hooks";
import { Download, X } from "lucide-preact";
import { archiveFileName, archiveSize, buildRoomArchive, serializeArchive } from "../lib/historyArchive";
import { useT } from "../lib/i18n";

/**
 * "Download my history" — export-only, room-by-room backup of what this
 * browser has cached locally (see historyArchive.ts for what that includes,
 * what it deliberately leaves out, and why there is no matching import
 * feature). Every row is a pure read from localStorage via
 * buildRoomArchive/archiveSize: nothing here touches the network or mistlib.
 */
export function HistoryArchivePanel(props: {
  /** Rooms the user can export, already resolved to display names. */
  rooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { rooms, onClose } = props;
  const t = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rebuilt at click time (not from a render-time snapshot) so the file
  // reflects whatever just got appended to this room since the panel opened.
  function handleDownload(room: { id: string; name: string }) {
    try {
      const archive = buildRoomArchive(room.id, room.name, Date.now());
      const blob = new Blob([serializeArchive(archive)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = archiveFileName(archive);
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn(`tc-chat: failed to download history archive for room "${room.id}"`, error);
    }
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal archive-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("archive.title")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <p class="archive-desc">{t("archive.desc")}</p>
        <p class="archive-media-note">{t("archive.mediaNote")}</p>

        {rooms.length === 0 ? (
          <p class="archive-empty">{t("archive.noRooms")}</p>
        ) : (
          <ul class="archive-room-list">
            {rooms.map((room) => {
              // exportedAt is irrelevant to the count, only to the file that
              // handleDownload builds separately — 0 is just a placeholder here.
              const count = archiveSize(buildRoomArchive(room.id, room.name, 0));
              return (
                <li key={room.id} class="archive-room-row">
                  <span class="archive-room-meta">
                    <span class="archive-room-name">{room.name}</span>
                    <span class="archive-room-count">
                      {count === 0 ? t("archive.empty") : t("archive.postCount", { count })}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="btn-ghost archive-download-btn"
                    disabled={count === 0}
                    onClick={() => handleDownload(room)}
                  >
                    <Download size={14} /> {t("archive.download")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
