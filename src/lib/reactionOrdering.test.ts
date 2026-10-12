import { beforeEach, expect, it, vi } from 'vitest';
import { appendPost, applyReaction, loadPosts, __clearEphemeralRoomStoreForTests, type ReactionOp } from './chatStore';
import { GLOBAL_ROOM_ID } from './util';

const reaction = { emoji: '👍', fromId: 'a', fromName: 'A' };
function post(id = 'p', roomId = 'r') {
  appendPost({ id, roomId, surface: 'chat', parentId: null, fromId: 'author', fromName: 'Author',
    timestamp: 1, kind: 'text', cid: 'body', text: 'post', reactions: [] });
}
beforeEach(() => { localStorage.clear(); __clearEphemeralRoomStoreForTests(); });

it.each([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])(
  'converges across add/remove/re-add delivery order %j', (...order) => {
    post();
    const ops: ReactionOp[] = ['add', 'remove', 'add'];
    for (const i of order) applyReaction('r', 'p', reaction, ops[i], { timestamp: i + 1, id: String(i) });
    expect(loadPosts('chat', 'r')[0].reactions).toEqual([reaction]);
  },
);

it.each([false, true])('uses the signed ID to break equal timestamps (reverse=%s)', reverse => {
  post();
  const ops: [string, ReactionOp][] = [['a', 'add'], ['z', 'remove']];
  for (const [id, op] of reverse ? ops.reverse() : ops)
    applyReaction('r', 'p', reaction, op, { timestamp: 10, id });
  applyReaction('r', 'p', reaction, 'add', { timestamp: 9, id: 'zz' });
  expect(loadPosts('chat', 'r')[0].reactions).toEqual([]);
});

it('retains removal ordering after module reload, even before the target post arrives', async () => {
  applyReaction('r', 'p', reaction, 'remove', { timestamp: 3, id: 'remove' });
  vi.resetModules();
  const reloaded = await import('./chatStore');
  reloaded.applyReaction('r', 'p', reaction, 'add', { timestamp: 2, id: 'add' });
  post();
  expect(reloaded.loadPosts('chat', 'r')[0].reactions).toEqual([]);
  reloaded.applyReaction('r', 'p', reaction, 'add', { timestamp: 4, id: 're-add' });
  expect(reloaded.loadPosts('chat', 'r')[0].reactions).toEqual([reaction]);
});

it('keeps existing stored reactions visible and upgrades them on a signed toggle', () => {
  localStorage.setItem('tc-chat:reactions:r', JSON.stringify({ p: [reaction], other: [reaction] }));
  post(); post('other');
  expect(loadPosts('chat', 'r')[0].reactions).toEqual([reaction]);
  applyReaction('r', 'p', reaction, 'remove', { timestamp: 3, id: 'remove' });
  applyReaction('r', 'p', reaction, 'add', { timestamp: 2, id: 'old' });
  expect(loadPosts('chat', 'r').map(p => p.reactions)).toEqual([[], [reaction]]);
  // An old unstamped caller also cannot overwrite signed ordering metadata.
  applyReaction('r', 'p', reaction, 'add');
  expect(loadPosts('chat', 'r')[0].reactions).toEqual([]);
});

it('orders each target, reactor, emoji and room independently', () => {
  post(); post('other'); post('p', 'other-room');
  applyReaction('r', 'p', reaction, 'remove', { timestamp: 100, id: 'remove' });
  const otherPerson = { ...reaction, fromId: 'b' }, otherEmoji = { ...reaction, emoji: '🎉' };
  for (const [roomId, targetId, value] of [
    ['r', 'p', otherPerson], ['r', 'p', otherEmoji], ['r', 'other', reaction], ['other-room', 'p', reaction],
  ] as const) applyReaction(roomId, targetId, value, 'add', { timestamp: 1, id: 'add' });
  expect(loadPosts('chat', 'r').map(p => p.reactions)).toEqual([[otherPerson, otherEmoji], [reaction]]);
  expect(loadPosts('chat', 'other-room')[0].reactions).toEqual([reaction]);
});

it('retains a removal stamp when old post history is trimmed and later restored', () => {
  post();
  applyReaction('r', 'p', reaction, 'remove', { timestamp: 3, id: 'remove' });
  for (let i = 0; i < 500; i++) post('new-' + i);
  expect(loadPosts('chat', 'r').some(p => p.id === 'p')).toBe(false);
  applyReaction('r', 'p', reaction, 'add', { timestamp: 2, id: 'old' });
  post();
  expect(loadPosts('chat', 'r').find(p => p.id === 'p')!.reactions).toEqual([]);
});

it('keeps global room reaction stamps ephemeral', () => {
  post('p', GLOBAL_ROOM_ID);
  applyReaction(GLOBAL_ROOM_ID, 'p', reaction, 'remove', { timestamp: 3, id: 'remove' });
  applyReaction(GLOBAL_ROOM_ID, 'p', reaction, 'add', { timestamp: 2, id: 'old' });
  expect(loadPosts('chat', GLOBAL_ROOM_ID)[0].reactions).toEqual([]);
  expect(localStorage.getItem('tc-chat:reactions:' + GLOBAL_ROOM_ID)).toBeNull();
});
