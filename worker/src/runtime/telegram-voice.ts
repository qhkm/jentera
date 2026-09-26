/**
 * A Telegram voice note, heard before admission. The audio is fetched with the
 * token the worker already holds, transcribed, and dropped; the transcript is
 * then admitted exactly like typed text. Spec:
 * docs/superpowers/specs/2026-09-24-telegram-media-design.md (piece 3, voice).
 */
import { withTenant } from '../db';
import type { Env } from '../env';
import { useTelegramCredential } from '../connections';
import {
  downloadTelegramFile,
  sendMessage,
  TelegramFileTooLarge,
  unreadableReply,
  VOICE_MAX_BYTES,
  VOICE_REPLIES,
  withTypingIndicator,
} from '../connectors/telegram';
import { claimTelegramVoiceReply } from '../request-guard';
import { isVaultTelegramCredential } from '../vault/telegram';
import { transcribeVoice } from '../voice/transcribe';
import type { TelegramIntakeQueueMessage } from './consumer';
import { runtimeTaskByDedupeKey } from './tasks';

export type VoiceIntake =
  | { kind: 'heard'; message: TelegramIntakeQueueMessage; transcript: string }
  | { kind: 'admitted' }
  | { kind: 'answered' };

/** How long a note may keep failing before the owner is told. The queue
    retries every 60 s; without this a note retried through the dead-letter
    queue for about 1 h 40 min and then vanished without a word. */
export const VOICE_GIVE_UP_MS = 5 * 60_000;

export async function hearTelegramVoice(
  env: Env,
  message: TelegramIntakeQueueMessage,
  dedupeKey: string,
): Promise<VoiceIntake> {
  const { businessId, connectionId, incoming } = message;
  const voice = incoming.voice!;
  /* A redelivery, or the safety net after the inline slice: admission will
     find the task. Hearing it again would only echo it again. */
  const existing = await withTenant(env, businessId, (tx) => runtimeTaskByDedupeKey(tx, businessId, dedupeKey));
  if (existing) return { kind: 'admitted' };

  const token = await withTenant(env, businessId, (tx) =>
    useTelegramCredential(env, tx, businessId, connectionId));
  const say = async (text: string) => {
    if (await claimTelegramVoiceReply(env, connectionId, incoming.chatId, incoming.messageId)) {
      await sendMessage(token, incoming.chatId, text).catch(() => {});
    }
  };
  /* The webhook refuses vault-held bots; this is for an intake queued before
     a bot moved into the vault. */
  if (isVaultTelegramCredential(token)) {
    await say(unreadableReply('voice'));
    return { kind: 'answered' };
  }

  let heard: Awaited<ReturnType<typeof transcribeVoice>>;
  try {
    /* A three-minute note takes about 30 s to hear; "typing…" says so. */
    heard = await withTypingIndicator(token, incoming.chatId, async () =>
      transcribeVoice(env.AI, await downloadTelegramFile(token, voice.fileId, VOICE_MAX_BYTES)),
    { maxMs: 120_000 });
  } catch (error) {
    if (error instanceof TelegramFileTooLarge) {
      await say(VOICE_REPLIES.tooLong);
      return { kind: 'answered' };
    }
    if (Date.now() - message.requestedAtMs >= VOICE_GIVE_UP_MS) {
      await say(VOICE_REPLIES.failed);
      return { kind: 'answered' };
    }
    throw error; // transient: the queue tries again
  }
  if ('unintelligible' in heard) {
    await say(VOICE_REPLIES.unintelligible);
    return { kind: 'answered' };
  }
  /* No echo here: admission sends it once it has created the run, so a retry
     or a second path cannot show it twice. */
  return {
    kind: 'heard',
    transcript: heard.text,
    message: { ...message, incoming: { ...incoming, text: voiceRequest(heard.text, incoming.text) } },
  };
}

/** The request a voice note makes: the transcript, then the caption. A mode
    command in the caption goes first, since that is the only place
    `responseModeFor` looks; `withoutModeCommand` takes it off for the agent. */
function voiceRequest(transcript: string, caption: string): string {
  const command = /^\s*(\/(?:quick|deep|research))(?=\s|$)\s*/i.exec(caption);
  const rest = (command ? caption.slice(command[0].length) : caption).trim();
  const request = rest ? `${transcript}\n\n${rest}` : transcript;
  return command ? `${command[1]} ${request}` : request;
}

/** What the agent is told about a transcript: the words may be misheard. */
export function withVoiceNote(text: string, voice?: unknown): string {
  if (!voice) return text;
  return `${text}\n\nThe owner sent this as a voice note; the text above is an automatic transcript. ` +
    'If a word or number looks misheard, ask rather than guess.';
}
