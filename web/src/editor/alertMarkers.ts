import type { Doc, Plugin } from 'prettier';

type MarkdownPlugin = typeof import('prettier/plugins/markdown');

interface Point {
  line: number;
  column: number;
  offset: number;
}

interface MdNode {
  type: string;
  value?: string;
  alertMarker?: boolean;
  children?: MdNode[];
  position: { start: Point; end: Point };
}

const alertMarker = /^\[!(note|tip|important|warning|caution)\][ \t]*$/i;
const quotePrefix = /^[ \t>]*/;

function breakAfterAlertMarker(paragraph: MdNode, text: string): void {
  const children = paragraph.children ?? [];
  const markerStart = paragraph.position.start.offset;
  const lineEnd = text.indexOf('\n', markerStart);
  if (lineEnd < 0 || !alertMarker.test(text.slice(markerStart, lineEnd))) {
    return;
  }
  const at = children.findIndex(
    (child) =>
      child.type === 'text' && child.position.start.offset <= lineEnd && lineEnd < child.position.end.offset,
  );
  const joined = children[at];
  if (joined?.value === undefined) {
    return;
  }
  const cut = joined.value.indexOf('\n');
  if (cut < 0 || joined.value.slice(0, cut).trim() !== '') {
    return;
  }
  const { start, end } = joined.position;
  const rest = joined.value.slice(cut + 1);
  const restStart = lineEnd + 1 + (quotePrefix.exec(text.slice(lineEnd + 1))?.[0].length ?? 0);
  const parts: MdNode[] = [
    {
      type: 'break',
      alertMarker: true,
      position: {
        start: { ...start, offset: lineEnd },
        end: { ...start, offset: lineEnd + 1 },
      },
    },
  ];
  if (rest !== '') {
    parts.push({
      ...joined,
      value: rest,
      position: { start: { ...start, offset: restStart }, end },
    });
  }
  children.splice(at, 1, ...parts);
}

export function keepAlertMarkers(markdown: MarkdownPlugin, hardline: Doc): Plugin<MdNode> {
  const parser = markdown.parsers.markdown;
  const printer = markdown.printers.mdast;
  return {
    parsers: {
      markdown: {
        ...parser,
        parse: async (text, options) => {
          const ast = (await parser.parse(text, options)) as MdNode;
          for (const block of ast.children ?? []) {
            const first = block.type === 'blockquote' ? block.children?.[0] : undefined;
            if (first?.type === 'paragraph') {
              breakAfterAlertMarker(first, text);
            }
          }
          return ast;
        },
      },
    },
    printers: {
      mdast: {
        ...printer,
        print: (path, options, print) =>
          path.node.type === 'break' && path.node.alertMarker === true
            ? hardline
            : printer.print(path, options, print),
      },
    },
  };
}
