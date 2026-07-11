import { X } from "lucide-preact";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";
import { formatBytes } from "../lib/util";
import { useT } from "../lib/i18n";

export function StoragePicker(props: {
  entries: TcStorageFileEntry[];
  onSelect: (entry: TcStorageFileEntry) => void;
  onCancel: () => void;
}) {
  const { entries, onSelect, onCancel } = props;
  const t = useT();
  return (
    <div class="storage-picker">
      <div class="storage-picker-header">
        <span>{t("media.storagePickerTitle")}</span>
        <button
          type="button"
          class="storage-picker-cancel"
          onClick={onCancel}
          aria-label={t("common.close")}
        >
          <X size={16} />
        </button>
      </div>
      {entries.length === 0 ? (
        <p class="storage-picker-empty">{t("media.storagePickerEmpty")}</p>
      ) : (
        <ul class="storage-picker-list">
          {entries.map((entry) => (
            <li key={entry.fileId}>
              <button
                type="button"
                class="storage-picker-item"
                onClick={() => onSelect(entry)}
              >
                <span class="storage-picker-item-name">{entry.name}</span>
                <span class="storage-picker-item-meta">
                  {entry.folderName && `${entry.folderName} · `}
                  {formatBytes(entry.size)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
