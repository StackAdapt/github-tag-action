// Bundle the action into a single self-contained ESM file so the
// GitHub Actions runtime (which executes `lib/main.js` directly and
// does NOT run `npm install` on consumers' machines) can resolve
// every dependency from a single artefact.
//
// Output:  lib/main.js   (native ESM, targets node24)
// Inputs:  src/main.ts   (+ everything it imports, transitively)
//
// The `createRequire` banner is a safety belt for any nested CJS
// dependency that still calls `require('...')` internally after
// esbuild's ESM emit — without it, such calls would throw at runtime
// because `require` is not defined in ES modules by default.

import { build } from 'esbuild';

// Safety belt for nested CJS dependencies that still call `require(...)`
// internally — `require` is not defined in ES modules by default. We
// alias the `createRequire` import so the bundled output can't collide
// with a sibling dep that also imports it.
const banner = [
  "import { createRequire as __ghTagActionCreateRequire } from 'node:module';",
  'const require = __ghTagActionCreateRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'lib/main.js',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: banner },
  logLevel: 'info',
});
