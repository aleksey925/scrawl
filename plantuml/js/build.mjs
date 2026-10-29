import { readFile } from "node:fs/promises";

import { build } from "esbuild";

const [outFile] = process.argv.slice(2);
if (outFile === undefined) {
  throw new Error("usage: node build.mjs <output file>");
}

const anchor = "nspkd_AbstractUGraphic_registerDriver($ug, $rt_cls(nspks_UImageSvg), new nspkds_DriverImageSvgSvg);";

const imageDriver = await readFile(new URL("image-driver.js", import.meta.url), "utf8");

const patchEngine = {
  name: "scrawl-plantuml-image-driver",
  setup(bundle) {
    bundle.onLoad({ filter: /@plantuml[\\/]mcp-js[\\/]engine\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      if (source.split(anchor).length !== 2) {
        throw new Error(`the engine no longer registers its svg image driver as "${anchor}"`);
      }
      const registration = "nspkd_AbstractUGraphic_registerDriver($ug, $rt_cls(nspks_UImage), scrawlImageDriver);";
      return { contents: `${source.replace(anchor, `${anchor}\n${registration}`)}\n${imageDriver}`, loader: "js" };
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
