export interface FindOptions {
  matchCase: boolean;
  word: boolean;
  regex: boolean;
  fuzzy: boolean;
}

export type FindOption = keyof FindOptions;

export const optionKeys: Partial<Record<string, FindOption>> = {
  KeyC: 'matchCase',
  KeyW: 'word',
  KeyR: 'regex',
  KeyF: 'fuzzy',
};

export function optionDisabled(options: FindOptions, name: FindOption): boolean {
  return options.fuzzy && (name === 'matchCase' || name === 'word');
}

export function withOption<T extends FindOptions>(options: T, name: FindOption): T {
  if (optionDisabled(options, name)) {
    return options;
  }
  const next = { ...options, [name]: !options[name] };
  if (next.fuzzy && next.regex) {
    return name === 'fuzzy' ? { ...next, regex: false } : { ...next, fuzzy: false };
  }
  return next;
}

export function togglesOf(params: URLSearchParams): Omit<FindOptions, 'fuzzy'> {
  return { matchCase: params.get('case') === '1', word: params.get('word') === '1', regex: params.get('regex') === '1' };
}
