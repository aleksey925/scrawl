import { findMatches, type FindPattern } from './reader/findMatches';

interface FindRequest {
  texts: string[];
  pattern: FindPattern;
}

self.addEventListener('message', (event: MessageEvent<FindRequest>) => {
  self.postMessage(findMatches(event.data.texts, event.data.pattern));
});
