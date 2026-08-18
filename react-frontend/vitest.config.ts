import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    env: {
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    },
  },
});
