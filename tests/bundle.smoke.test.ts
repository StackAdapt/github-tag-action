import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This is an end-to-end smoke test for the shipping artefact that
// GitHub's Actions runner actually executes. It exists because the
// unit tests can import `src/**/*.ts` directly and would stay green
// even if:
//
//   * `scripts/bundle.mjs` was missing from the commit (CI would fail
//     at `npm run build` but AFTER the full test suite finished — a
//     regression that triggered this file's creation).
//   * esbuild was misconfigured and marked runtime deps as external
//     (so `lib/main.js` would still exist but import `@actions/core`
//     at runtime, which the Actions runner cannot resolve).
//   * The ESM `createRequire` banner collided with a nested dep and
//     produced a `SyntaxError: Identifier 'createRequire' has already
//     been declared` at startup.
//
// The test copies the bundled file into a sibling temporary directory
// that has NO `node_modules` and runs it with `node`. Any bare-specifier
// import inside the bundle that was not actually inlined will fail with
// `ERR_MODULE_NOT_FOUND` / `Cannot find package` here, because Node's
// ESM resolver only walks up from the file's own directory.
//
// A pass is: the process executes past module-graph linking and reaches
// the action's own code (observed via a GitHub / input-validation error
// line emitted by `@actions/core`). A fail is anything that looks like a
// module-resolution error.

const BUNDLE_PATH = join(process.cwd(), 'lib', 'main.js');
const SPAWN_TIMEOUT_MS = 20_000;

describe('bundled action artefact', () => {
  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      throw new Error(
        `lib/main.js is missing. Run \`npm run build\` before this suite (CI runs build before test).`
      );
    }
  });

  it('is a non-empty single file', () => {
    const stats = statSync(BUNDLE_PATH);
    expect(stats.isFile()).toBe(true);
    const { size } = stats;
    // The bundle inlines @actions/*, @octokit/*, @semantic-release/*,
    // conventional-changelog, semver, etc. A real bundle is ~1.5 MB+.
    // An un-bundled `tsc` emit of `src/main.ts` is well under 1 KB and
    // would break the Actions runner (the exact regression we guard
    // against here).
    expect(size).toBeGreaterThan(500_000);
  });

  it('loads in a directory without node_modules and reaches action code', () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'gh-tag-action-smoke-'));
    const copiedBundle = join(isolatedDir, 'main.js');
    copyFileSync(BUNDLE_PATH, copiedBundle);

    const result = spawnSync(process.execPath, [copiedBundle], {
      cwd: isolatedDir,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      // Deliberately minimal env — we don't want to leak the project's
      // `NODE_PATH` / developer-machine module resolution into the child.
      // The `GITHUB_*` and `INPUT_*` values are just enough to drive the
      // action past input validation and into the Octokit call site, so
      // we can observe a *runtime* failure (bad credentials) rather than
      // a module-resolution failure.
      env: {
        PATH: process.env['PATH'] ?? '',
        GITHUB_REPOSITORY: 'foo/bar',
        GITHUB_REF: 'refs/heads/master',
        GITHUB_SHA: '0000000000000000000000000000000000000000',
        INPUT_GITHUB_TOKEN: 'not-a-real-token',
      },
    });

    // Surface child stdio on failure so regressions are debuggable
    // straight from the CI log.
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');

    expect(
      combined,
      `Spawned bundle exited with status=${String(result.status)} signal=${String(
        result.signal
      )}. Combined stdio:\n${combined}`
    ).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(combined).not.toMatch(/Cannot find package/);
    expect(combined).not.toMatch(/Cannot find module/);
    expect(combined).not.toMatch(/SyntaxError/);

    // Positive signal that execution actually entered the action's own
    // code path. `@actions/core` formats errors as `::error::...` lines;
    // the action eventually throws an Octokit `HttpError` / `Bad
    // credentials` against the real api.github.com because the token is
    // fake. Matching any of these confirms the whole bundle linked and
    // executed successfully.
    expect(combined).toMatch(/::error::|HttpError|Bad credentials/);
  });
});
