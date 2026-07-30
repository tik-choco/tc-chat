import { common } from "./catalog/common";
import { settings } from "./catalog/settings";
import { chat } from "./catalog/chat";
import { board } from "./catalog/board";
import { media } from "./catalog/media";
import { account } from "./catalog/account";
import { devConsole } from "./catalog/devConsole";
import { onboarding } from "./catalog/onboarding";
import { friends } from "./catalog/friends";
import { calendar } from "./catalog/calendar";
import { invite } from "./catalog/invite";
import { moderation } from "./catalog/moderation";
import { search } from "./catalog/search";
import { notifications } from "./catalog/notifications";
import { archive } from "./catalog/archive";
import { personal } from "./catalog/personal";

/**
 * The full message tree, assembled from the per-domain catalogs. `ja` is the
 * source of truth; its shape defines {@link Messages}, and every other locale
 * (en here, plus the standalone files in ./locales) is type-checked against it,
 * so a forgotten key is a compile error rather than a silent blank.
 */
export const ja = {
  common: common.ja,
  settings: settings.ja,
  chat: chat.ja,
  board: board.ja,
  media: media.ja,
  account: account.ja,
  devConsole: devConsole.ja,
  onboarding: onboarding.ja,
  friends: friends.ja,
  calendar: calendar.ja,
  invite: invite.ja,
  moderation: moderation.ja,
  search: search.ja,
  notifications: notifications.ja,
  archive: archive.ja,
  personal: personal.ja,
};

export const en: Messages = {
  common: common.en,
  settings: settings.en,
  chat: chat.en,
  board: board.en,
  media: media.en,
  account: account.en,
  devConsole: devConsole.en,
  onboarding: onboarding.en,
  friends: friends.en,
  calendar: calendar.en,
  invite: invite.en,
  moderation: moderation.en,
  search: search.en,
  notifications: notifications.en,
  archive: archive.en,
  personal: personal.en,
};

export type Messages = typeof ja;
