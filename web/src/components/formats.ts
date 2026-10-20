const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// relativeTime says how long ago a moment was, in the largest unit it fills:
// "3 days ago", "last week", "just now"
export function relativeTime(at: string, now: Date = new Date()): string {
  const seconds = (new Date(at).getTime() - now.getTime()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

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

export function itemCount(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}
