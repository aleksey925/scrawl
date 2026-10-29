import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const [outDir] = process.argv.slice(2);
if (outDir === undefined) {
  throw new Error("usage: node library.mjs <output folder>");
}

const lock = JSON.parse(await readFile(new URL("library.json", import.meta.url), "utf8"));
const origin = `https://raw.githubusercontent.com/plantuml/plantuml/${lock.commit}/`;

async function fetchChecked(name, { path, sha256 }) {
  const response = await fetch(origin + path);
  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(body).digest("hex");
  if (got !== sha256) {
    throw new Error(`${name}: sha256 ${got}, the lock says ${sha256}`);
  }
  return body;
}

await mkdir(outDir, { recursive: true });
for (const stale of await readdir(outDir)) {
  await rm(join(outDir, stale));
}
const names = Object.keys(lock.files);
const bodies = await Promise.all(names.map((name) => fetchChecked(name, lock.files[name])));
for (const [index, name] of names.entries()) {
  await writeFile(join(outDir, `${name}.gz`), gzipSync(bodies[index], { level: 9 }));
}
console.log(`${names.length} files of plantuml ${lock.commit.slice(0, 7)} in ${outDir}`);
