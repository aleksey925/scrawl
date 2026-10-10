const breakpoints = require('./src/breakpoints.json');

const variables = Object.fromEntries(
  Object.entries(breakpoints).map(([name, value]) => [`mantine-breakpoint-${name}`, value]),
);

module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': { variables },
  },
};
