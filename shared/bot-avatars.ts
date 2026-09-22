/** Stable identifiers only; never accept arbitrary image URLs from a client. */
export const BOT_AVATAR_IDS = ['original', 'wing', 'operator', 'cat', 'cube', 'blue', 'yellow', 'pink', 'purple', 'orange'] as const;
export type BotAvatarId = typeof BOT_AVATAR_IDS[number];
export const isBotAvatar = (value: unknown): value is BotAvatarId =>
  typeof value === 'string' && (BOT_AVATAR_IDS as readonly string[]).includes(value);
