import { defineConfig } from 'vitest/config';

// Minimal Vitest config. Vite's native ESM support and its Rollup-based
// module graph mean we do NOT need any of the Jest-era workarounds:
//   * no `--experimental-vm-modules` / `ts-jest` + `useESM` dance
//   * no `.js` extension stripping in `moduleNameMapper`
//   * no hand-rolled mocks for `@semantic-release/*` — Vitest loads the
//     real ESM packages directly
//
// For the few `node_modules` ESM packages whose frozen namespace blocks
// `vi.spyOn(core, ...)`, individual test files use
// `vi.mock('@actions/core', async (importOriginal) => ...)` with a
// factory that returns a mutable plain object. See tests/action.test.ts
// and tests/utils.test.ts for the canonical pattern.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
