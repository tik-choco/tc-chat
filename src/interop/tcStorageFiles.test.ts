import { describe, it, expect } from "vitest";
import { loadTcStorageFiles, type TcStorageSnapshot } from "./tcStorageFiles";

function fakeStorage(snapshot: unknown): Pick<Storage, "getItem"> {
  const raw = snapshot === undefined ? null : JSON.stringify(snapshot);
  return { getItem: () => raw };
}

describe("loadTcStorageFiles", () => {
  it("returns files that have a lastCid, with their folder name resolved", () => {
    const snapshot: TcStorageSnapshot = {
      folders: [{ id: "folder-1", name: "写真" }],
      files: [
        {
          id: "file-1",
          folderId: "folder-1",
          name: "cat.png",
          mimeType: "image/png",
          size: 1234,
          lastCid: "cid-1",
        },
      ],
    };

    expect(loadTcStorageFiles(fakeStorage(snapshot))).toEqual([
      {
        fileId: "file-1",
        name: "cat.png",
        mimeType: "image/png",
        size: 1234,
        cid: "cid-1",
        folderName: "写真",
      },
    ]);
  });

  it("falls back to lastShareCid when lastCid is absent", () => {
    const snapshot: TcStorageSnapshot = {
      folders: [{ id: "folder-1", name: "書類" }],
      files: [
        {
          id: "file-1",
          folderId: "folder-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          size: 5000,
          lastShareCid: "cid-shared",
        },
      ],
    };

    const entries = loadTcStorageFiles(fakeStorage(snapshot));
    expect(entries).toHaveLength(1);
    expect(entries[0].cid).toBe("cid-shared");
  });

  it("excludes files with neither lastCid nor lastShareCid", () => {
    const snapshot: TcStorageSnapshot = {
      folders: [{ id: "folder-1", name: "書類" }],
      files: [
        {
          id: "file-1",
          folderId: "folder-1",
          name: "draft.txt",
          mimeType: "text/plain",
          size: 10,
        },
      ],
    };

    expect(loadTcStorageFiles(fakeStorage(snapshot))).toEqual([]);
  });

  it("excludes soft-deleted files (deletedAt set)", () => {
    const snapshot: TcStorageSnapshot = {
      folders: [{ id: "folder-1", name: "書類" }],
      files: [
        {
          id: "file-1",
          folderId: "folder-1",
          name: "old.txt",
          mimeType: "text/plain",
          size: 10,
          lastCid: "cid-1",
          deletedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    expect(loadTcStorageFiles(fakeStorage(snapshot))).toEqual([]);
  });

  it("resolves an unknown folderId to an empty folder name instead of throwing", () => {
    const snapshot: TcStorageSnapshot = {
      folders: [],
      files: [
        {
          id: "file-1",
          folderId: "missing-folder",
          name: "orphan.txt",
          mimeType: "text/plain",
          size: 10,
          lastCid: "cid-1",
        },
      ],
    };

    const entries = loadTcStorageFiles(fakeStorage(snapshot));
    expect(entries).toHaveLength(1);
    expect(entries[0].folderName).toBe("");
  });

  it("returns an empty array when there is no stored snapshot", () => {
    expect(loadTcStorageFiles(fakeStorage(undefined))).toEqual([]);
  });

  it("returns an empty array for malformed JSON instead of throwing", () => {
    const storage: Pick<Storage, "getItem"> = { getItem: () => "{not-json" };
    expect(loadTcStorageFiles(storage)).toEqual([]);
  });

  it("returns an empty array when folders/files are missing or the wrong shape", () => {
    expect(loadTcStorageFiles(fakeStorage({}))).toEqual([]);
    expect(loadTcStorageFiles(fakeStorage({ folders: "nope", files: [] }))).toEqual([]);
  });
});
