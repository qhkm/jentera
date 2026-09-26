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
  voiceEcho,
} from '../connectors/telegram';
import { claimTelegramVoiceReply } from '../request-guard';
import { isVaultTelegramCredential } from '../vault/telegram';
import { transcribeVoice } from '../voice/transcribe';
import type { TelegramIntakeQueueMessage } from './consumer';
import { runtimeTaskByDedupeKey } from './tasks';

export type VoiceIntake =
  | { kind: 'heard'; message: TelegramIntakeQueueMessage }
  | { kind: 'admitted' }
  | { kind: 'answered' };

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

  let audio: Uint8Array;
  try {
    audio = await downloadTelegramFile(token, voice.fileId, VOICE_MAX_BYTES);
  } catch (error) {
    if (error instanceof TelegramFileTooLarge) {
      await say(VOICE_REPLIES.tooLong);
      return { kind: 'answered' };
    }
    throw error; // transient: the queue tries again
  }
  const heard = await transcribeVoice(env.AI, audio);
  if ('unintelligible' in heard) {
    await say(VOICE_REPLIES.unintelligible);
    return { kind: 'answered' };
  }
  await say(voiceEcho(heard.text));
  const caption = incoming.text.trim();
  return {
    kind: 'heard',
    message: { ...message, incoming: { ...incoming, text: caption ? `${heard.text}\n\n${caption}` : heard.text } },
  };
}

/** What the agent is told about a transcript: the words may be misheard. */
export function withVoiceNote(text: string, voice?: unknown): string {
  if (!voice) return text;
  return `${text}\n\nThe owner sent this as a voice note; the text above is an automatic transcript. ` +
    'If a word or number looks misheard, ask rather than guess.';
}
