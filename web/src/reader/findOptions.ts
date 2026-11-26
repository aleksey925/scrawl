export interface FindOptions {
  matchCase: boolean;
  word: boolean;
  regex: boolean;
  fuzzy: boolean;
}

export type FindOption = keyof FindOptions;

export const noOptions: FindOptions = { matchCase: false, word: false, regex: false, fuzzy: false };

export const optionKeys: Partial<Record<string, FindOption>> = {
  KeyC: 'matchCase',
  KeyW: 'word',
  KeyR: 'regex',
  KeyF: 'fuzzy',
};

export function optionDisabled(options: FindOptions, name: FindOption): boolean {
  return options.fuzzy && name !== 'fuzzy';
}

export function withOption<T extends FindOptions>(options: T, name: FindOption): T {
  return { ...options, [name]: !options[name] };
}

export function togglesOf(params: URLSearchParams): Omit<FindOptions, 'fuzzy'> {
  return { matchCase: params.get('case') === '1', word: params.get('word') === '1', regex: params.get('regex') === '1' };
}
