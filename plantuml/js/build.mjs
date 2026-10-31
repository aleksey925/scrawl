import { readFile } from "node:fs/promises";

import { build } from "esbuild";

const [outFile] = process.argv.slice(2);
if (outFile === undefined) {
  throw new Error("usage: node build.mjs <output file>");
}

const anchor = "nspkd_AbstractUGraphic_registerDriver($ug, $rt_cls(nspks_UImageSvg), new nspkds_DriverImageSvgSvg);";
const registration = "nspkd_AbstractUGraphic_registerDriver($ug, $rt_cls(nspks_UImage), scrawlImageDriver);";
const svgParserAnchors = [
  "nspsp_SvgNanoParser_getData = $this => {",
  "ju_AbstractCollection_isEmpty($this.$data24)",
  "jur_Pattern_matcher(nspsp_SvgNanoParser_P_TEXT_OR_DRAW, $this.$svg2)",
];

const patches = await Promise.all(
  ["image-driver.js", "svg-parser.js"].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
);

function requireOnce(source, text) {
  if (source.split(text).length !== 2) {
    throw new Error(`the engine no longer has "${text}" once`);
  }
}

const patchEngine = {
  name: "scrawl-plantuml-engine",
  setup(bundle) {
    bundle.onLoad({ filter: /@plantuml[\\/]mcp-js[\\/]engine\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      for (const text of [anchor, ...svgParserAnchors]) {
        requireOnce(source, text);
      }
      return { contents: [source.replace(anchor, `${anchor}\n${registration}`), ...patches].join("\n"), loader: "js" };
    });
  },
};

await build({
  entryPoints: [new URL("main.js", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  minifyIdentifiers: true,
  minifyWhitespace: true,
  logLevel: "error",
  outfile: outFile,
  plugins: [patchEngine],
});
