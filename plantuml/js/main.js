import { renderSvg } from "@plantuml/mcp-js/engine.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const newline = 10;
const chunkSize = 1 << 20;

let rest = new Uint8Array(0);

function readMessage() {
  const chunks = [rest];
  let size = rest.length;
  let at = rest.indexOf(newline);
  while (at < 0) {
    const chunk = new Uint8Array(chunkSize);
    const read = Javy.IO.readSync(0, chunk);
    if (read === 0) {
      return null;
    }
    const found = chunk.subarray(0, read).indexOf(newline);
    if (found >= 0) {
      at = size + found;
    }
    chunks.push(chunk.subarray(0, read));
    size += read;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  rest = bytes.slice(at + 1);
  return JSON.parse(decoder.decode(bytes.subarray(0, at)));
}

function writeMessage(message) {
  Javy.IO.writeSync(1, encoder.encode(JSON.stringify(message) + "\n"));
}

function quiet() {}

for (const level of ["log", "info", "warn", "debug", "error"]) {
  console[level] = quiet;
}

globalThis.setTimeout = (callback, delay) => {
  if (!(delay > 0)) {
    Promise.resolve().then(callback);
  }
  return 0;
};
globalThis.clearTimeout = quiet;

globalThis.PLANTUML_VIZ = {};

globalThis.PLANTUML_STDLIB_LOADER = (file, ok, fail) => {
  writeMessage({ need: file });
  const reply = readMessage();
  if (reply === null || reply.error) {
    fail(reply === null ? "the host is gone" : reply.error);
    return;
  }
  try {
    (0, eval)(`(function (window) {\n${reply.code}\n})(globalThis);`);
  } catch (err) {
    fail(`${file}: ${err}`);
    return;
  }
  ok();
};

function render(source) {
  return new Promise((resolve) => renderSvg(source, resolve));
}

function answerOf(json) {
  const result = JSON.parse(json);
  if (result.valid) {
    return { svg: result.svg };
  }
  return { error: result.errorMessage || "the diagram could not be rendered", line: result.errorLineNumber || 0 };
}

async function serve() {
  for (let request = readMessage(); request !== null; request = readMessage()) {
    let answer;
    try {
      answer = answerOf(await render(request.source));
    } catch (err) {
      answer = { error: String((err && err.message) || err) };
    }
    writeMessage(answer);
  }
}

serve();
