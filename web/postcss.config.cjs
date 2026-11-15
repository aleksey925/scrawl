const autoRem = require('postcss-preset-mantine/dist/auto-rem');
const presetMantine = require('postcss-preset-mantine');
const simpleVars = require('postcss-simple-vars');
const breakpoints = require('./src/breakpoints.json');

const variables = Object.fromEntries(
  Object.entries(breakpoints).map(([name, value]) => [`mantine-breakpoint-${name}`, value]),
);

const mantineRem = () => {
  const { Declaration } = autoRem();
  return {
    postcssPlugin: 'mantine-rem',
    Declaration: (decl) => {
      if (decl.source?.input.file?.includes('/node_modules/@mantine/')) {
        Declaration(decl);
      }
    },
  };
};
mantineRem.postcss = true;

module.exports = {
  plugins: [mantineRem(), presetMantine(), simpleVars({ variables })],
};
