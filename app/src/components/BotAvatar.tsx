import type { BotAvatarId } from '../../../shared/bot-avatars';

// Crops of the owner's supplied character sheet; no generated substitutions.
export const BOT_AVATARS: { id: BotAvatarId; name: string; crop: [number, number, number] }[] = [
  { id: 'original', name: 'Original', crop: [48, 181, 240] },
  { id: 'wing', name: 'Wing', crop: [326, 156, 288] },
  { id: 'operator', name: 'Operator', crop: [641, 168, 265] },
  { id: 'cat', name: 'Cat', crop: [963, 168, 254] },
  { id: 'cube', name: 'Cube', crop: [1270, 180, 240] },
  { id: 'blue', name: 'Ocean', crop: [326, 657, 178] },
  { id: 'yellow', name: 'Sunshine', crop: [566, 657, 178] },
  { id: 'pink', name: 'Rose', crop: [807, 657, 178] },
  { id: 'purple', name: 'Violet', crop: [1054, 657, 178] },
  { id: 'orange', name: 'Tangerine', crop: [1292, 657, 190] },
];

export function BotAvatar({ avatar = 'original', size = 64 }: { avatar?: BotAvatarId; size?: number }) {
  const [x, y, edge] = (BOT_AVATARS.find(item => item.id === avatar) ?? BOT_AVATARS[0]).crop;
  return <span aria-hidden="true" className="bot-avatar" style={{
    display: 'inline-block', flexShrink: 0, width: size, height: size, borderRadius: '24%',
    backgroundImage: 'url(/images/jentera-bot-avatar-sheet-v1.webp)',
    backgroundSize: `${1536 / edge * 100}% ${1024 / edge * 100}%`,
    backgroundPosition: `${x / (1536 - edge) * 100}% ${y / (1024 - edge) * 100}%`,
  }} />;
}
