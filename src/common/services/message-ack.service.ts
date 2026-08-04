import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Lightweight in-process bus for WhatsApp message acknowledgements.
 *
 * whatsapp-web.js emits a `message_ack` event as an outbound message moves
 * from sent -> delivered -> read. The engine adapter forwards these through the
 * SessionService callbacks, which push them here. Any interested service (e.g.
 * the campaign runner) subscribes with {@link onAck} to update per-recipient
 * delivery status. Kept separate from feature modules so there is no dependency
 * cycle between SessionModule and CampaignModule.
 */
@Injectable()
export class MessageAckService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Multiple concurrent campaigns may subscribe; avoid the default 10-listener warning.
    this.emitter.setMaxListeners(100);
  }

  /** Forward an ack (whatsapp-web.js ack levels: 1=server/sent, 2=device/delivered, 3=read, 4=played). */
  emitAck(messageId: string, ack: number): void {
    if (!messageId) return;
    this.emitter.emit('ack', messageId, ack);
  }

  /** Subscribe to acks. Returns an unsubscribe function. */
  onAck(handler: (messageId: string, ack: number) => void): () => void {
    this.emitter.on('ack', handler);
    return () => this.emitter.off('ack', handler);
  }
}
