export class BoundedMap<K, V> {
  private readonly entries = new Map<K, V>();

  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}
