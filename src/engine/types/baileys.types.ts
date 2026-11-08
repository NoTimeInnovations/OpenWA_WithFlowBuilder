import type { WAMessage } from '@whiskeysockets/baileys';
import type { LidMappingStore } from '../identity/lid-mapping-store.service';
import type { EngineEventCallbacks, IncomingMessage } from '../interfaces/whatsapp-engine.interface';

/**
 * Persistence boundary for the Baileys engine's message store. The adapter depends on this narrow
 * interface (not the concrete Nest service) so it stays unit-testable with a fake.
 */
export interface BaileysMessageStore {
  /** Persist a message (idempotent on the same id) so it can be referenced by reply/forward/react/delete. */
  put(sessionId: string, msg: WAMessage): Promise<void>;
  /** Look up a previously-seen message by its id, or null. */
  getMessage(sessionId: string, messageId: string): Promise<WAMessage | null>;
  /** Remove all stored messages for a session (called on logout). */
  clearSession(sessionId: string): Promise<void>;
  /**
   * Newest-first stored messages of one chat (engine-dialect JIDs, any of which may match). Optional so
   * fakes in tests can omit it; backs the fork's live chat-history endpoint on this engine.
   */
  listByChat?(sessionId: string, remoteJids: string[], limit: number): Promise<WAMessage[]>;
}

/**
 * Per-call construction config for {@link BaileysAdapter}. Engine-neutral fields come from the
 * factory; `authDir` is the base multi-file auth directory from the opaque `engine.baileys.*` blob
 * (the adapter appends the session id to isolate each session).
 */
export interface BaileysAdapterConfig {
  sessionId: string;
  authDir: string;
  proxyUrl?: string;
  proxyType?: 'http' | 'https' | 'socks4' | 'socks5';
  /** Persisted store for reply/forward/react/delete. Provided by the plugin; the four ops require it. */
  messageStore?: BaileysMessageStore;
  /** Persisted, cross-session lid->phone resolution table. Backs lid resolution beyond the in-memory map. */
  lidMappingStore?: LidMappingStore;
}

/**
 * The minimal pino-compatible logger Baileys' `makeWASocket` expects. Declared locally so we can
 * pass a fully silent logger without taking a direct `pino` dependency.
 *
 * Matches the Baileys `ILogger` contract: each log method receives `(obj: unknown, msg?: string)`.
 */
export interface BaileysLogger {
  level: string;
  child: (bindings: Record<string, unknown>) => BaileysLogger;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

// ---------------------------------------------------------------------------------------------------
// Types ported from upstream OpenWA's engine interface (35ca31fb) that the fork's shared
// IWhatsAppEngine interface does not (yet) carry. Kept engine-local so the shared interface and the
// whatsapp-web.js adapter stay untouched; everything here is a structural SUPERSET of the fork's
// shared types, so values flow into the shared callbacks/return types unchanged.
// ---------------------------------------------------------------------------------------------------

/** Engine-neutral message type vocabulary used by the upstream Baileys mapper. */
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'call'
  | 'revoked'
  | 'masked'
  | 'unknown';

/** Engine-neutral delivery status (upstream). The adapter converts it to the fork's numeric wwebjs ack. */
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Inbound media envelope, extended with the size-cap marker fields. */
export type NeutralMedia = NonNullable<IncomingMessage['media']> & {
  /** True when the media exceeded the inbound size cap and the blob was dropped (envelope kept). */
  omitted?: boolean;
  /** Decoded byte size of the media; always set when `omitted` is true. */
  sizeBytes?: number;
};

/** Superset of the fork's IncomingMessage carrying the extra fields the Baileys mapper fills. */
export interface BaileysIncomingMessage extends Omit<IncomingMessage, 'media'> {
  media?: NeutralMedia;
  isStatusBroadcast?: boolean;
  ephemeralDuration?: number;
  /** For group messages, the WID of the participant who actually sent it (`from` is the group JID there). */
  author?: string;
  mentionedIds?: string[];
  isLidSender?: boolean;
  senderPhone?: string | null;
  contact?: { pushName?: string };
  location?: {
    latitude: number;
    longitude: number;
    description?: string;
    address?: string;
    url?: string;
  };
}

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  lastMessage?: string;
}

export type ChatState = 'typing' | 'recording' | 'paused';

export interface PollInput {
  name: string;
  options: string[];
  allowMultipleAnswers?: boolean;
}

export interface StatusPostOptions {
  /** Neutral JIDs (@c.us / @lid) permitted to see the status. Maps to Baileys statusJidList. */
  recipients: string[];
  backgroundColor?: string;
  font?: number;
  caption?: string;
}

export interface RevokedMessage {
  id: string;
  revokedId?: string;
  chatId: string;
  from: string;
  to: string;
  type: 'revoked';
  body: '';
  timestamp: number;
}

export interface ReactionEvent {
  messageId: string;
  chatId: string;
  reaction: string;
  senderId: string;
}

/**
 * The fork's EngineEventCallbacks plus the extra upstream callbacks the Baileys adapter can fire.
 * The fork's SessionService only wires the shared ones; the extras are optional and simply unused
 * there (kept so the ported upstream adapter + spec stay intact).
 */
export interface BaileysEventCallbacks extends EngineEventCallbacks {
  onMessageCreate?: (message: IncomingMessage) => void;
  onMessageRevoked?: (message: RevokedMessage) => void;
  onMessageReaction?: (event: ReactionEvent) => void;
  onHistoryMessages?: (messages: IncomingMessage[]) => void;
  onError?: (reason: string) => void;
}
