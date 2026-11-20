import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Node >= 25 ships its own (experimental) Web Storage globals. Without
    // --localstorage-file its `localStorage` is undefined and shadows jsdom's,
    // so tests see `localStorage === undefined`. Turn Node's off in the test
    // workers so jsdom's Storage is used, on every Node version CI runs.
    execArgv: ['--no-experimental-webstorage'],
    env: {
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    },
  },
});
