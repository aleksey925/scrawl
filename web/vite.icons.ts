import type { Plugin } from 'vite';

const iconWeights: readonly string[] = ['regular', 'bold', 'fill'];

const allWeights: readonly string[] = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin'];

const entryStart = /\n {2}\[\n {4}"(\w+)",\n/g;

function dropIconWeights(code: string, id: string): string {
  const starts = [...code.matchAll(entryStart)];
  const found = starts.map((match) => match[1] ?? '');
  if (found.join(' ') !== allWeights.join(' ')) {
    throw new Error(`${id}: the icon weights are ${found.join(', ')}, not ${allWeights.join(', ')}`);
  }
  const end = code.lastIndexOf('\n]);');
  const head = code.slice(0, starts[0]?.index);
  const blocks = starts.map((match, index) => {
    const next = starts[index + 1]?.index ?? end;
    return { weight: match[1] ?? '', text: code.slice(match.index, next).replace(/,$/, '') };
  });
  const kept = blocks.filter((entry) => iconWeights.includes(entry.weight));
  return `${head}${kept.map((entry) => entry.text).join(',')}${code.slice(end)}`;
}

export function phosphorWeights(): Plugin {
  return {
    name: 'scrawl-phosphor-weights',
    enforce: 'pre',
    transform(code, id) {
      if (!/@phosphor-icons\/react\/dist\/defs\/\w+\.es\.js$/.test(id)) {
        return undefined;
      }
      return dropIconWeights(code, id);
    },
  };
}
