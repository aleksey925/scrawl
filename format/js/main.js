function readInput() {
  const chunks = [];
  let total = 0;
  for (;;) {
    const chunk = new Uint8Array(64 * 1024);
    const read = Javy.IO.readSync(0, chunk);
    if (read === 0) {
      break;
    }
    chunks.push(chunk.subarray(0, read));
    total += read;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function writeOutput(output) {
  Javy.IO.writeSync(1, new TextEncoder().encode(JSON.stringify(output)));
}

const noteLineWidth = 79;

const alertMarker = /^\[!(note|tip|important|warning|caution)\][ \t]*$/i;
const quotePrefix = /^[ \t>]*/;

function breakAfterAlertMarker(paragraph, text) {
  const markerStart = paragraph.position.start.offset;
  const lineEnd = text.indexOf("\n", markerStart);
  if (lineEnd < 0 || !alertMarker.test(text.slice(markerStart, lineEnd))) {
    return;
  }
  const at = paragraph.children.findIndex(
    (child) =>
      child.type === "text" &&
      child.position.start.offset <= lineEnd &&
      lineEnd < child.position.end.offset,
  );
  const joined = paragraph.children[at];
  if (joined === undefined) {
    return;
  }
  const cut = joined.value.indexOf("\n");
  if (cut < 0 || joined.value.slice(0, cut).trim() !== "") {
    return;
  }
  const { start, end } = joined.position;
  const rest = joined.value.slice(cut + 1);
  const restStart =
    lineEnd + 1 + quotePrefix.exec(text.slice(lineEnd + 1))[0].length;
  const parts = [
    {
      type: "break",
      alertMarker: true,
      position: {
        start: { ...start, offset: lineEnd },
        end: { ...start, offset: lineEnd + 1 },
      },
    },
  ];
  if (rest !== "") {
    parts.push({
      ...joined,
      value: rest,
      position: { start: { ...start, offset: restStart }, end },
    });
  }
  paragraph.children.splice(at, 1, ...parts);
}

function keepAlertMarkers(markdown, hardline) {
  const parser = markdown.parsers.markdown;
  const printer = markdown.printers.mdast;
  return {
    parsers: {
      markdown: {
        ...parser,
        parse: async (text, options) => {
          const ast = await parser.parse(text, options);
          for (const block of ast.children) {
            const first =
              block.type === "blockquote" ? block.children[0] : undefined;
            if (first !== undefined && first.type === "paragraph") {
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
          path.node.type === "break" && path.node.alertMarker
            ? hardline
            : printer.print(path, options, print),
      },
    },
  };
}

const input = JSON.parse(readInput());

prettier
  .format(input.text, {
    parser: "markdown",
    proseWrap: "always",
    printWidth: noteLineWidth,
    plugins: [
      ...Object.values(prettierPlugins),
      keepAlertMarkers(prettierPlugins.markdown, prettier.doc.builders.hardline),
    ],
  })
  .then(
    (text) => writeOutput({ text }),
    (err) => writeOutput({ error: String((err && err.message) || err) }),
  );
