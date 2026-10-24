export function absoluteTime(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const sizeUnits = ['B', 'KB', 'MB', 'GB'];

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

export function shortDate(at: string): string {
  return new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export function countOf(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function shortTime(at: string): string {
  return new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

const dayMs = 86_400_000;

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
