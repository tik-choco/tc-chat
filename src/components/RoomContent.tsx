import type { ComponentProps } from "preact";
import { Menu, MessageCircle, LayoutList, CalendarDays, Images } from "lucide-preact";
import { ChatWindow } from "./ChatWindow";
import { ProjectBoard } from "./ProjectBoard";
import { CalendarView } from "./CalendarView";
import { MediaGalleryView } from "./MediaGalleryView";
import { useT } from "../lib/i18n";
import type { RoomTab } from "../lib/util";

// Re-exported so tab consumers don't need to know the type lives in util
// (where the hash codec needs it) rather than here (where the tab bar is).
export type { RoomTab };

export function RoomContent(props: {
  tab: RoomTab;
  onChangeTab: (tab: RoomTab) => void;
  /** Mobile only: opens the off-canvas sidebar drawer. */
  onOpenSidebar: () => void;
  chatWindowProps: ComponentProps<typeof ChatWindow>;
  boardProps: ComponentProps<typeof ProjectBoard>;
  calendarProps: ComponentProps<typeof CalendarView>;
  galleryProps: ComponentProps<typeof MediaGalleryView>;
}) {
  const {
    tab,
    onChangeTab,
    onOpenSidebar,
    chatWindowProps,
    boardProps,
    calendarProps,
    galleryProps,
  } = props;
  const t = useT();
  return (
    <div class="room-content">
      <div class="room-tabs">
        <button
          type="button"
          class="room-tabs-menu"
          aria-label={t("chat.openMenu")}
          onClick={onOpenSidebar}
        >
          <Menu size={22} />
        </button>
        <button
          type="button"
          class={`room-tab ${tab === "chat" ? "room-tab--active" : ""}`}
          onClick={() => onChangeTab("chat")}
        >
          <MessageCircle size={16} />
          {t("chat.chatTab")}
        </button>
        <button
          type="button"
          class={`room-tab ${tab === "board" ? "room-tab--active" : ""}`}
          onClick={() => onChangeTab("board")}
        >
          <LayoutList size={16} />
          {t("chat.boardTab")}
        </button>
        <button
          type="button"
          class={`room-tab ${tab === "calendar" ? "room-tab--active" : ""}`}
          onClick={() => onChangeTab("calendar")}
        >
          <CalendarDays size={16} />
          {t("chat.calendarTab")}
        </button>
        <button
          type="button"
          class={`room-tab ${tab === "gallery" ? "room-tab--active" : ""}`}
          onClick={() => onChangeTab("gallery")}
        >
          <Images size={16} />
          {t("chat.galleryTab")}
        </button>
      </div>
      <div class="room-content-body">
        {tab === "chat" ? (
          <ChatWindow {...chatWindowProps} />
        ) : tab === "board" ? (
          <ProjectBoard {...boardProps} />
        ) : tab === "calendar" ? (
          <CalendarView {...calendarProps} />
        ) : (
          <MediaGalleryView {...galleryProps} />
        )}
      </div>
    </div>
  );
}
