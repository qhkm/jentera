import type { AskMode } from '@/lib/repo';

/* The lightweight path is deliberately narrow: it answers from confirmed
   business knowledge and recent activity. Everything that may need live
   information, a file, a tool, or an external effect goes to the durable
   agent instead. The user never has to make this routing decision. */
const GREETING = /^(?:hi|hello|hey|thanks?|thank you|ok(?:ay)?|good (?:morning|afternoon|evening)|hai|helo|terima kasih|baik|assalamualaikum)[!.?\s]*$/i;
const CONTINUATION = /^(?:continue|resume|teruskan|sambung)\b/i;
const STATUS_QUESTION = /\b(?:what happened|what(?:'s| is) happening|give me an update|needs? my attention|pending approvals?|work status|task status|apa berlaku|apa yang berlaku|beri saya kemas kini|perlukan perhatian saya|kelulusan tertangguh|status kerja|status tugasan)\b/i;
const QUESTION = /\?$|^(?:what|when|where|who|why|how|is|are|was|were|do|does|did|can|could|which|apa|bila|di mana|siapa|kenapa|mengapa|bagaimana|adakah|berapa)\b/i;
const BUSINESS_CONTEXT = /\b(?:we|our|my|business|company|shop|store|cafe|restaurant|clinic|team|staff|customer|customers|opening|open|closed|hours|address|location|phone|email|website|approval|approvals|task|tasks|work|activity|handled|completed|pending|kami|kita|saya|bisnes|perniagaan|syarikat|kedai|kafe|restoran|klinik|pasukan|pekerja|pelanggan|waktu|alamat|lokasi|telefon|e-mel|laman web|kelulusan|tugasan|kerja|aktiviti|selesai|tertangguh)\b/i;
const NEEDS_AGENT = /(?:https?:\/\/|\b(?:send|sent|publish|deploy|install|delete|remove|transfer|purchase|buy|pay|book|schedule|remind|monitor|draft|write|create|prepare|make|update|cancel|research|compare|analyse|analyze|review|investigate|find|browse|search|look up|hantar|terbit|pasang|padam|buang|pindah|beli|bayar|tempah|jadual|ingatkan|pantau|draf|tulis|cipta|sediakan|buat|kemas kini|batal|selidik|banding|analisis|semak|siasat|cari|layari)\b)/i;
const LIVE_PUBLIC_INFO = /\b(?:latest|current|today|tonight|tomorrow|news|weather|forecast|haze|air quality|traffic|exchange rate|stock price|market price|law|regulation|terkini|semasa|hari ini|malam ini|esok|berita|cuaca|ramalan|jerebu|kualiti udara|trafik|kadar tukaran|harga saham|harga pasaran|undang-undang|peraturan)\b/i;

export function automaticAskMode(question: string, hasAttachment = false): AskMode {
  const text = question.trim();
  if (hasAttachment || CONTINUATION.test(text) || /^\/(?:deep|research|quick)(?:\s|$)/i.test(text)) return 'work';
  if (GREETING.test(text) || STATUS_QUESTION.test(text)) return 'ask';
  if (NEEDS_AGENT.test(text) || LIVE_PUBLIC_INFO.test(text)) return 'work';
  if (QUESTION.test(text) && BUSINESS_CONTEXT.test(text)) return 'ask';
  return 'work';
}

export function automaticResponseDepth(question: string): 'quick' | 'deep' {
  return /^\/(?:deep|research)(?:\s|$)/i.test(question.trim()) ? 'deep' : 'quick';
}
