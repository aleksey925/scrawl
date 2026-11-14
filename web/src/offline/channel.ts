import { channelName, type ChannelMessage } from './keys';
import { offlineSupported } from './preference';

type Handler = (message: ChannelMessage) => void;

const handlers = new Set<Handler>();

let channel: BroadcastChannel | undefined;

function open(): BroadcastChannel | undefined {
  if (channel === undefined && offlineSupported() && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(channelName);
    channel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      for (const handle of handlers) {
        handle(event.data);
      }
    });
  }
  return channel;
}

export function post(message: ChannelMessage): void {
  open()?.postMessage(message);
}

export function onMessage(handler: Handler): () => void {
  open();
  handlers.add(handler);
  return () => handlers.delete(handler);
}
