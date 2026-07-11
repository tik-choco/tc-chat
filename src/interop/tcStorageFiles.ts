// Read-only interop with tc-storage's local snapshot (localStorage key
// 'tc-storage-snapshot-v1', see tc-storage/src/storage/domain.ts and
// localSnapshot.ts). tc-chat never writes to this snapshot — it only lists
// files the user has already saved in tc-storage so they can be attached to
// a chat message by CID, without re-uploading (re-running storage_add())
// content that mistlib's content-addressed storage already has under that
// CID.

/** Subset of tc-storage's FolderRecord (domain.ts) that this module reads. */
export type TcStorageFolderRecord = {
  id: string;
  name: string;
};

/** Subset of tc-storage's FileRecord (domain.ts) that this module reads. */
export type TcStorageFileRecord = {
  id: string;
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  lastCid?: string;
  lastShareCid?: string;
  deletedAt?: string;
};

/** Subset of tc-storage's StorageSnapshot (domain.ts) that this module reads. */
export type TcStorageSnapshot = {
  folders: TcStorageFolderRecord[];
  files: TcStorageFileRecord[];
};

export interface TcStorageFileEntry {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  cid: string;
  folderName: string;
}

const SNAPSHOT_KEY = "tc-storage-snapshot-v1";

function isFolderRecord(value: unknown): value is TcStorageFolderRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TcStorageFolderRecord>;
  return typeof record.id === "string" && typeof record.name === "string";
}

function isFileRecord(value: unknown): value is TcStorageFileRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TcStorageFileRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.folderId === "string" &&
    typeof record.name === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number"
  );
}

/**
 * Lists tc-storage files available to attach by CID: excludes soft-deleted
 * files and files that were never uploaded to mistlib storage (no
 * lastCid/lastShareCid). Never throws — malformed or missing snapshots
 * resolve to an empty list.
 */
export function loadTcStorageFiles(
  storage: Pick<Storage, "getItem"> = localStorage,
): TcStorageFileEntry[] {
  try {
    const raw = storage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<TcStorageSnapshot>;
    if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.files)) return [];

    const folderNameById = new Map(
      parsed.folders.filter(isFolderRecord).map((folder) => [folder.id, folder.name]),
    );

    return parsed.files
      .filter(isFileRecord)
      .filter((file) => !file.deletedAt)
      .map((file) => {
        const cid = file.lastCid ?? file.lastShareCid;
        return cid
          ? {
              fileId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              cid,
              folderName: folderNameById.get(file.folderId) ?? "",
            }
          : undefined;
      })
      .filter((entry): entry is TcStorageFileEntry => entry !== undefined);
  } catch {
    return [];
  }
}
