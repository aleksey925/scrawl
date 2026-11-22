import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'internal', 'server', 'assets');

interface Colors {
  text: string;
  bg: string;
}

function colorsOf(theme: string): Colors {
  const file = JSON.parse(readFileSync(join(root, 'internal', 'theme', 'themes', `${theme}.json`), 'utf8')) as {
    palette: Colors;
  };
  return { text: file.palette.text, bg: file.palette.bg };
}

const logo = readFileSync(join(assets, 'logo.svg'), 'utf8');
const viewBox = /viewBox="([^"]+)"/.exec(logo)?.[1];
if (viewBox === undefined) {
  throw new Error('internal/server/assets/logo.svg has no viewBox');
}
const inner = logo.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const width = Number(viewBox.split(/\s+/)[2]);
if (!Number.isFinite(width)) {
  throw new Error(`internal/server/assets/logo.svg has a viewBox with no width: ${viewBox}`);
}
const middle = width / 2;

function favicon(light: Colors, dark: Colors): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `<style>svg{color:${light.text}}@media (prefers-color-scheme:dark){svg{color:${dark.text}}}</style>`,
    inner,
    '</svg>',
    '',
  ].join('\n');
}

function filled(colors: Colors, size: number, scale: number): Buffer {
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
const iconScale = 0.62;
const maskableScale = 0.5;
const icons: ReadonlyArray<[string, Colors, number, number]> = [
  ['apple-touch-icon.png', light, 180, iconScale],
  ['apple-touch-icon-dark.png', dark, 180, iconScale],
  ['icon-192.png', light, 192, iconScale],
  ['icon-512.png', light, 512, iconScale],
  ['icon-maskable-512.png', light, 512, maskableScale],
];
for (const [name, colors, size, scale] of icons) {
  writeFileSync(join(assets, 'icons', name), filled(colors, size, scale));
}
