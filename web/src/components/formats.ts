export function absoluteTime(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const sizeUnits = ['B', 'KB', 'MB', 'GB'];

// fileSize is a size the way a file manager writes it: "714 B", "7.8 KB"
export function fileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < sizeUnits.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${sizeUnits[unit]}`;
}

// shortDate is the day a file changed, the way a phone's file list writes it:
// "Oct 17"
export function shortDate(at: string): string {
  return new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// countOf writes a count with its word: "1 item", "3 items"
export function countOf(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// shortTime is when a file changed, the way a folder's list writes it:
// "Oct 17, 12:30"
export function shortTime(at: string): string {
  return new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

const dayMs = 86_400_000;

// versionTime is when a version was made, the way a list of them reads: the
// day in words while it is recent, the date after that
export function versionTime(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(when)) / dayMs);
  if (days === 0) {
    return `Today, ${time}`;
  }
  if (days === 1) {
    return `Yesterday, ${time}`;
  }
  return shortTime(at);
}
