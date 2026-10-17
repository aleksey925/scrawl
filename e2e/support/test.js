// the test every spec runs: it brings up the servers of its worker before the
// first test and points baseURL at the normal one among them

const base = require('@playwright/test');

const {instances} = require('./env');
const {start} = require('./serve');

const test = base.test.extend({
    servers: [async ({}, use) => {
        const stops = await Promise.all(Object.values(instances).map(start));
        await use();
        await Promise.all(stops.map((stop) => stop()));
    }, {scope: 'worker', auto: true, timeout: 180_000}],

    baseURL: async ({}, use) => {
        await use(instances.main.baseURL);
    },
});

module.exports = {expect: base.expect, test};
