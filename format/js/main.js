// The entry of format/prettier.wasm: one note in on stdin, the formatted note
// out on stdout, both as JSON. `make formatter` puts prettier's standalone
// build and its plugins in front of this file, which is where the two globals
// come from.

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

const input = JSON.parse(readInput());
const options = { parser: "markdown", plugins: Object.values(prettierPlugins) };

// tracking a cursor makes a run about a third longer, so a caller with no
// cursor to keep does not pay for one
const formatted =
  input.cursor === undefined
    ? prettier.format(input.text, options).then((text) => ({ text }))
    : prettier
        .formatWithCursor(input.text, { ...options, cursorOffset: input.cursor })
        .then((res) => ({ text: res.formatted, cursor: res.cursorOffset }));

formatted.then(writeOutput, (err) =>
  writeOutput({ error: String((err && err.message) || err) }),
);
