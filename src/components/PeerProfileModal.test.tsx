import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { PeerProfileModal } from "./PeerProfileModal";

afterEach(cleanup);

const DID = "did:key:zpeer";

// Convenience wrapper: every case wires all four friend-request callbacks so
// individual tests only need to override/inspect the ones they care about.
function renderModal(overrides: Partial<Parameters<typeof PeerProfileModal>[0]> = {}) {
  const onSendRequest = vi.fn();
  const onAcceptRequest = vi.fn();
  const onDeclineRequest = vi.fn();
  const onCancelRequest = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <PeerProfileModal
      did={DID}
      fallbackName="Bob"
      directory={{}}
      friendStatus={null}
      onSendRequest={onSendRequest}
      onAcceptRequest={onAcceptRequest}
      onDeclineRequest={onDeclineRequest}
      onCancelRequest={onCancelRequest}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onSendRequest, onAcceptRequest, onDeclineRequest, onCancelRequest, onClose };
}

describe("PeerProfileModal", () => {
  it("shows the directory display name and bio for the peer", () => {
    const directory = { [DID]: { displayName: "Bobby", bio: "3D artist", updatedAt: 1 } };
    const { getByText } = renderModal({ directory });
    expect(getByText("Bobby")).toBeTruthy(); // directory name wins over fallback
    expect(getByText("3D artist")).toBeTruthy();
  });

  it("falls back to the signed name and shows an empty-bio hint", () => {
    const { getByText } = renderModal();
    expect(getByText("Bob")).toBeTruthy();
    expect(getByText("自己紹介はまだありません")).toBeTruthy();
  });

  it("labels the card when it's the local user's own DID", () => {
    const { getByText } = renderModal({ fallbackName: "Me", selfDid: DID });
    expect(getByText("プロフィール（あなた）")).toBeTruthy();
  });

  it("closes on the close button and on backdrop click", () => {
    const { getByText, getByLabelText, container, onClose } = renderModal();
    fireEvent.click(getByLabelText("閉じる"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Clicking inside the card must NOT close it.
    fireEvent.click(getByText("Bob"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("null status renders a send-request button that fires onSendRequest with the resolved name", () => {
    const { getByText, onSendRequest } = renderModal({ friendStatus: null });
    fireEvent.click(getByText("フレンドリクエストを送る"));
    expect(onSendRequest).toHaveBeenCalledWith("Bob");
  });

  it("pending-out status renders requestSent and a cancel button firing onCancelRequest", () => {
    const { getByText, onCancelRequest } = renderModal({ friendStatus: "pending-out" });
    expect(getByText("リクエスト送信済み")).toBeTruthy();
    fireEvent.click(getByText("リクエストを取り消す"));
    expect(onCancelRequest).toHaveBeenCalledTimes(1);
  });

  it("pending-in status renders accept/decline buttons firing their callbacks", () => {
    const { getByText, onAcceptRequest, onDeclineRequest } = renderModal({ friendStatus: "pending-in" });
    fireEvent.click(getByText("承認"));
    expect(onAcceptRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("拒否"));
    expect(onDeclineRequest).toHaveBeenCalledTimes(1);
  });

  it("accepted status renders the disabled added button", () => {
    const { getByText } = renderModal({ friendStatus: "accepted" });
    const btn = getByText("追加済み").closest("button");
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
