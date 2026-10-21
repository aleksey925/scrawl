// icons writes the favicon and the PNG icons out of server/assets/logo.svg, in
// the text and ground colors of the light and the dark theme. Run by
// `make icons`; what it writes is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'server', 'assets');

interface Colors {
  text: string;
  bg: string;
}

function colorsOf(theme: string): Colors {
  const file = JSON.parse(readFileSync(join(root, 'theme', 'themes', `${theme}.json`), 'utf8')) as {
    palette: Colors;
  };
  return { text: file.palette.text, bg: file.palette.bg };
}

// the logo's own markup without its svg element, drawn in currentColor
const logo = readFileSync(join(assets, 'logo.svg'), 'utf8');
const viewBox = /viewBox="([^"]+)"/.exec(logo)?.[1];
if (viewBox === undefined) {
  throw new Error('server/assets/logo.svg has no viewBox');
}
const inner = logo.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const width = Number(viewBox.split(/\s+/)[2]);
if (!Number.isFinite(width)) {
  throw new Error(`server/assets/logo.svg has a viewBox with no width: ${viewBox}`);
}
const middle = width / 2;

// a favicon inherits no currentColor, so it names both colors and switches on
// the system scheme, the only thing a tab icon can follow
function favicon(light: Colors, dark: Colors): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `<style>svg{color:${light.text}}@media (prefers-color-scheme:dark){svg{color:${dark.text}}}</style>`,
    inner,
    '</svg>',
    '',
  ].join('\n');
}

// iOS draws a transparent icon on black, so a PNG is the mark on a filled
// square, which the system rounds itself
function filled(colors: Colors, size: number): Buffer {
  const scale = 0.62;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">`,
    `<rect width="${width}" height="${width}" fill="${colors.bg}"/>`,
    `<g color="${colors.text}" transform="translate(${middle} ${middle}) scale(${scale}) translate(${-middle} ${-middle})">`,
    inner,
    '</g></svg>',
  ].join('');
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

const light = colorsOf('light');
const dark = colorsOf('dark');

writeFileSync(join(assets, 'favicon.svg'), favicon(light, dark));
const icons: ReadonlyArray<[string, Colors, number]> = [
  ['apple-touch-icon.png', light, 180],
  ['apple-touch-icon-dark.png', dark, 180],
  ['icon-192.png', light, 192],
  ['icon-512.png', light, 512],
];
for (const [name, colors, size] of icons) {
  writeFileSync(join(assets, 'icons', name), filled(colors, size));
}
