import { beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
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

interface ChildResult {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Drain stdout/stderr asynchronously while the child runs so large
 * bursts of startup output can't deadlock the parent. Always resolves
 * (never rejects) so the caller can assert on the captured streams even
 * if the child crashed, exited non-zero, or had to be SIGKILLed.
 */
function runChildAndCapture(
  child: ChildProcess,
  timeoutMs: number
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        status,
        signal,
      });
    });
  });
}

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
    writeFileSync(join(isolatedDir, 'package.json'), '{"type":"module"}');

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

  // This second smoke test exists to catch a different class of bug that
  // only manifests *after* the bundle has linked — namely, runtime paths
  // inside bundled dependencies that try to resolve packages from the
  // filesystem (e.g. via `import-from-esm`) and blow up because the
  // Actions runtime has no `node_modules`. The canonical regression is
  // `@semantic-release/release-notes-generator/lib/load-changelog-config.js`
  // calling `importFrom(cwd, 'conventional-changelog-<preset>')` when the
  // preset is bundled but not installed as a sibling package — which
  // previously surfaced as:
  //
  //   TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be
  //   of type string. Received undefined
  //       at resolve (node:path:...)
  //       at resolveToFileURL (lib/main.js:...)
  //       at importFrom (lib/main.js:...)
  //
  // To reach that code path we need the action to survive its GitHub
  // API calls and proceed to `generateNotes`. We stand up a tiny local
  // HTTP server that returns just enough JSON to satisfy `listTags` and
  // `compareCommits`, point the spawned child at it via `GITHUB_API_URL`,
  // and set `dry_run=true` so the run exits cleanly after changelog
  // generation without actually trying to create a tag.
  it('runs the bundle end-to-end through generateNotes against a mocked GitHub API', async () => {
    const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');

      if (url.startsWith('/repos/foo/bar/tags')) {
        // Empty tag list → action falls back to the synthetic `v0.0.0`
        // baseline and walks the full release-notes path we want to
        // exercise.
        res.end('[]');
        return;
      }

      if (url.startsWith('/repos/foo/bar/compare/')) {
        res.end(
          JSON.stringify({
            commits: [
              {
                sha: '1111111111111111111111111111111111111111',
                commit: {
                  message: 'feat: bundle smoke happy path',
                },
              },
            ],
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(
        JSON.stringify({ message: `not mocked: ${req.method ?? 'GET'} ${url}` })
      );
    };

    const server = createServer(handleRequest);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const { port } = server.address() as AddressInfo;
      const apiUrl = `http://127.0.0.1:${port}`;

      const isolatedDir = mkdtempSync(join(tmpdir(), 'gh-tag-action-e2e-'));
      const copiedBundle = join(isolatedDir, 'main.js');
      copyFileSync(BUNDLE_PATH, copiedBundle);
      writeFileSync(join(isolatedDir, 'package.json'), '{"type":"module"}');

      // We use async `spawn` (not `spawnSync`) here because the bundle
      // emits enough stdio during startup to deadlock `spawnSync` on
      // macOS when combined with captured pipes — the parent can't drain
      // the child's pipes while it is blocked in the sync call, so the
      // child eventually wedges and the timeout kills it with empty
      // stdio. `spawn` drains both streams on the event loop as bytes
      // arrive, which matches real Actions-runner behaviour.
      const result = await runChildAndCapture(
        spawn(process.execPath, [copiedBundle], {
          cwd: isolatedDir,
          env: {
            PATH: process.env['PATH'] ?? '',
            GITHUB_REPOSITORY: 'foo/bar',
            GITHUB_REF: 'refs/heads/master',
            GITHUB_SHA: '1111111111111111111111111111111111111111',
            GITHUB_API_URL: apiUrl,
            // `@actions/github` reads this for `repositoryUrl`, which
            // the release-notes generator templates into the changelog.
            // Pin it to the mock URL so we never accidentally hit a
            // real host.
            GITHUB_SERVER_URL: apiUrl,
            INPUT_GITHUB_TOKEN: 'fake-token-ok',
            INPUT_RELEASE_BRANCHES: 'master',
            INPUT_DRY_RUN: 'true',
          },
        }),
        SPAWN_TIMEOUT_MS
      );

      const combined = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n');

      // Guard against the exact regression that prompted this test.
      expect(
        combined,
        `Spawned bundle exited with status=${String(result.status)} signal=${String(
          result.signal
        )}. Combined stdio:\n${combined}`
      ).not.toMatch(/ERR_INVALID_ARG_TYPE/);
      expect(combined).not.toMatch(/paths\[0\]/);

      // Also re-assert no module-resolution errors (defence in depth:
      // the first test in this file checks this at startup; this one
      // checks it along the release-notes code path).
      expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
      expect(combined).not.toMatch(/Cannot find (?:module|package)/);

      // Positive signal: the action walked all the way to the dry-run
      // exit gate, which is downstream of `generateNotes`.
      expect(combined).toMatch(/Dry run: not performing tag action\./);
      expect(result.status).toBe(0);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
