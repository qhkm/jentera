/* ============================================================
   Icons.

   Two jobs:

   1. `Icon` — named icons for UI chrome, so components never hold
      an emoji literal.

   2. `DataIcon` — the playbook data carries an emoji per business,
      agent, connector and work item (`icon`, `e`). New playbooks are
      added via scripts/add-playbook.mjs with emoji intact, so rather
      than rewriting the data we map each emoji to a Phosphor glyph
      at render time. Unmapped values fall back to a neutral icon
      rather than leaking an emoji into the UI.

   Weight is "duotone" for identity marks and "regular" for chrome,
   matching the restrained, monoline feel of the rest of the system.
   ============================================================ */

import {
  ArrowsClockwise,
  Barbell,
  Basket,
  Books,
  Briefcase,
  Buildings,
  Cake,
  Calendar,
  CameraPlus,
  ChartBar,
  ChartLineUp,
  ChatCircle,
  CheckCircle,
  CreditCard,
  Diamond,
  Envelope,
  FileText,
  Files,
  FirstAid,
  Flower,
  FolderOpen,
  ForkKnife,
  Gift,
  House,
  Image as ImageIcon,
  Lightning,
  MagnifyingGlass,
  Package,
  PawPrint,
  Phone,
  Receipt,
  Robot,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkle,
  Stethoscope,
  Storefront,
  Tent,
  UserCircle,
  Warning,
  Wrench,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';

/* ---- UI chrome ---- */

const CHROME = {
  home: House,
  chat: ChatCircle,
  activity: Lightning,
  business: Buildings,
  search: MagnifyingGlass,
  sparkle: Sparkle,
  shield: ShieldCheck,
  robot: Robot,
  owner: UserCircle,
  check: CheckCircle,
  warning: Warning,
  hint: Sparkle,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof CHROME;

export function Icon({
  name,
  size = 18,
  weight = 'regular',
  className,
}: {
  name: IconName;
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  className?: string;
}) {
  const Glyph = CHROME[name];
  return <Glyph size={size} weight={weight} className={className} aria-hidden="true" />;
}

/* ---- Playbook data ----
   Keys are the emoji as they appear in the generated data. */

const BY_EMOJI: Record<string, PhosphorIcon> = {
  /* businesses */
  '🍜': ForkKnife,
  '🛍️': ShoppingBag,
  '🛒': ShoppingCart,
  '🎪': Tent,
  '📸': CameraPlus,
  '🍰': Cake,
  '🎂': Cake,
  '💍': Diamond,
  '💼': Briefcase,
  '🏥': FirstAid,
  '🩺': Stethoscope,
  '💇': Scissors,
  '🏋️': Barbell,
  '📚': Books,
  '🧺': Basket,
  '🔧': Wrench,
  '🐾': PawPrint,
  '💐': Flower,
  '🏠': House,
  '🧽': Sparkle,
  '🏪': Storefront,

  /* agents and work */
  '💬': ChatCircle,
  '📅': Calendar,
  '🔁': ArrowsClockwise,
  '📊': ChartBar,
  '📈': ChartLineUp,
  '⚠️': Warning,
  '📦': Package,
  '📝': FileText,
  '📑': Files,
  '🗂️': FolderOpen,
  '🖼️': ImageIcon,
  '🧲': Gift,
  '🎁': Gift,
  '🎟️': Gift,
  '📋': Files,
  '✅': CheckCircle,
  '🛡️': ShieldCheck,

  /* connectors */
  '🧾': Receipt,
  '💳': CreditCard,
  '✉️': Envelope,
  '📞': Phone,
};

/** Strip variation selectors so '⚠️' and '⚠' both resolve. */
function normalise(raw: string): string {
  return raw.replace(/️/g, '');
}

const NORMALISED: Record<string, PhosphorIcon> = Object.fromEntries(
  Object.entries(BY_EMOJI).map(([k, v]) => [normalise(k), v]),
);

export function DataIcon({
  emoji,
  size = 18,
  className,
}: {
  emoji: string;
  size?: number;
  className?: string;
}) {
  const Glyph = NORMALISED[normalise(emoji ?? '')] ?? Storefront;
  return <Glyph size={size} weight="duotone" className={className} aria-hidden="true" />;
}

/**
 * The i18n strings carry emoji inline ('⚠️ Need you'). Leave them in the
 * data — strip them at the point of render instead.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    // Dingbats (✓ ✗ ➜) are not Extended_Pictographic but read as decoration
    // in these labels, and leaving them made the tab row inconsistent.
    .replace(/[\u2190-\u21FF\u2700-\u27BF\u2713\u2714\u2716\u2718]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
