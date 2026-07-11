import type { ComponentProps } from "preact";
import { Menu, MessageCircle, LayoutList, CalendarDays } from "lucide-preact";
import { ChatWindow } from "./ChatWindow";
import { ProjectBoard } from "./ProjectBoard";
import { CalendarView } from "./CalendarView";
import { useT } from "../lib/i18n";

export type RoomTab = "chat" | "board" | "calendar";

export function RoomContent(props: {
  tab: RoomTab;
  onChangeTab: (tab: RoomTab) => void;
  /** Mobile only: opens the off-canvas sidebar drawer. */
  onOpenSidebar: () => void;
  chatWindowProps: ComponentProps<typeof ChatWindow>;
  boardProps: ComponentProps<typeof ProjectBoard>;
  calendarProps: ComponentProps<typeof CalendarView>;
}) {
  const { tab, onChangeTab, onOpenSidebar, chatWindowProps, boardProps, calendarProps } = props;
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
      </div>
      <div class="room-content-body">
        {tab === "chat" ? (
          <ChatWindow {...chatWindowProps} />
        ) : tab === "board" ? (
          <ProjectBoard {...boardProps} />
        ) : (
          <CalendarView {...calendarProps} />
        )}
      </div>
    </div>
  );
}
