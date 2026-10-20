import { findMatches, type FindPattern } from './reader/findMatches';

interface FindRequest {
  texts: string[];
  pattern: FindPattern;
}

// the worker runs the find of a note off the page, so a pattern that takes
// minutes, (a+)+$ on a long line, can be stopped by ending the worker
self.addEventListener('message', (event: MessageEvent<FindRequest>) => {
  self.postMessage(findMatches(event.data.texts, event.data.pattern));
});
