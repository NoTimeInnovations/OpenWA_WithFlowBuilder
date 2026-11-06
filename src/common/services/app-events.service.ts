import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { GroupEvent, IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';

/**
 * In-process bus that lets our own feature modules (Messaging Flows, Group Join/Leave rules,
 * Campaigns) react to engine events without the session core importing them. The core emits at
 * the same points it dispatches the matching webhook; listeners run fire-and-forget and a
 * throwing listener never reaches the receive path.
 *
 * Acks are NOT on this bus: they arrive through the `message:ack` hook (see CampaignService).
 */
@Injectable()
export class AppEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  /** An inbound message, after it was stored and dispatched to webhooks. */
  emitInbound(sessionId: string, message: IncomingMessage): void {
    this.safeEmit('inbound', sessionId, message);
  }

  onInbound(handler: (sessionId: string, message: IncomingMessage) => void): () => void {
    this.emitter.on('inbound', handler);
    return () => this.emitter.off('inbound', handler);
  }

  /** A group membership / metadata change (join, leave, update, join_request). */
  emitGroupEvent(sessionId: string, event: GroupEvent): void {
    this.safeEmit('group', sessionId, event);
  }

  onGroupEvent(handler: (sessionId: string, event: GroupEvent) => void): () => void {
    this.emitter.on('group', handler);
    return () => this.emitter.off('group', handler);
  }

  private safeEmit(name: string, ...args: unknown[]): void {
    for (const listener of this.emitter.listeners(name)) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch {
        // A listener must never break the engine's receive path.
      }
    }
  }
}
