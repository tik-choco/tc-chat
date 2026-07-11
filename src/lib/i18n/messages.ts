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
};

export type Messages = typeof ja;
