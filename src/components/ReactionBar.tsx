import { useState } from "preact/hooks";
import { SmilePlus } from "lucide-preact";
import type { Reaction } from "../lib/chatStore";
import { useT } from "../lib/i18n";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "🔥", "✅"];

interface Grouped {
  emoji: string;
  count: number;
  mine: boolean;
  who: string[];
}

function group(reactions: Reaction[], localId: string | null): Grouped[] {
  const byEmoji = new Map<string, Grouped>();
  for (const r of reactions) {
    const g = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, who: [] };
    g.count += 1;
    g.who.push(r.fromName);
    if (localId && r.fromId === localId) g.mine = true;
    byEmoji.set(r.emoji, g);
  }
  return [...byEmoji.values()];
}

export function ReactionBar(props: {
  reactions: Reaction[];
  localId: string | null;
  onToggle: (emoji: string) => void;
}) {
  const { reactions, localId, onToggle } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const groups = group(reactions, localId);

  return (
    <div class="reaction-bar">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          class={`reaction-chip ${g.mine ? "reaction-chip--mine" : ""}`}
          title={g.who.join(t("chat.nameSeparator"))}
          onClick={() => onToggle(g.emoji)}
        >
          <span class="reaction-chip-emoji">{g.emoji}</span>
          <span class="reaction-chip-count">{g.count}</span>
        </button>
      ))}

      <div class="reaction-add-wrap">
        <button
          type="button"
          class="reaction-add"
          aria-label={t("chat.addReaction")}
          title={t("chat.addReaction")}
          onClick={() => setOpen((v) => !v)}
        >
          <SmilePlus size={15} />
        </button>
        {open && (
          <div class="reaction-palette" role="menu">
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                class="reaction-palette-btn"
                onClick={() => {
                  onToggle(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
