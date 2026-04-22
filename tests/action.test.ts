import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@actions/core';
import type * as UtilsModule from '../src/utils.js';
import type * as GithubModule from '../src/github.js';
import action from '../src/action.js';
import * as utils from '../src/utils.js';
import * as github from '../src/github.js';
import * as core from '@actions/core';
import {
  loadDefaultInputs,
  setBranch,
  setCommitSha,
  setInput,
  setRepository,
} from './helper.test.js';

// `@actions/core` is a real ESM package, so Node seals its namespace object
// and `vi.spyOn(core, ...)` cannot replace the exports in place. We therefore
// replace the whole module with a factory-produced plain object that keeps
// every original implementation (including `getInput`, which is env-var
// driven and exercised by the helper-test fixtures) and swaps the output /
// logging functions for `vi.fn()` stubs we can assert against.
vi.mock('@actions/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    ...actual,
    debug: vi.fn(),
    info: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
  };
});

// The src/utils and src/github modules expose functions that the suite
// swaps out on a per-test basis (e.g. `getCommits`, `getValidTags`,
// `createTag`). Under ESM a named import like
// `import { createTag } from './github.js'` produces a live binding that
// cannot be mutated via `vi.spyOn(namespace, 'name')`, so we replace the
// whole module with an auto-wired mock that preserves the original
// implementations for anything the individual tests don't override.
vi.mock('../src/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>();
  return {
    ...actual,
    getCommits: vi.fn(actual.getCommits),
    getValidTags: vi.fn(actual.getValidTags),
  };
});

vi.mock('../src/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GithubModule>();
  return {
    ...actual,
    createTag: vi.fn<typeof actual.createTag>().mockResolvedValue(undefined),
  };
});

beforeAll(() => {
  setRepository('https://github.com', 'org/repo');
});

const mockCreateTag = vi.mocked(github.createTag);
const mockSetOutput = vi.mocked(core.setOutput);
const mockSetFailed = vi.mocked(core.setFailed);

describe('github-tag-action', () => {
  beforeEach(() => {
    // Re-install the `console.info` suppression before every test because
    // `restoreMocks: true` in `vitest.config.ts` restores any spy set at
    // module load after the first test finishes; installing it here keeps
    // the behaviour consistent across the whole file.
    vi.spyOn(console, 'info').mockImplementation(() => {});
    setBranch('master');
    setCommitSha('79e0ea271c26aa152beef77c3275ff7b8f8d8274');
    loadDefaultInputs();
  });

  describe('special cases', () => {
    it('does create initial tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags: any[] = [];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create patch tag without commits', async () => {
      /*
       * Given
       */
      const commits: any[] = [];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags: any[] = [];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v0.0.1',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does not create tag without commits and default_bump set to false', async () => {
      /*
       * Given
       */
      setInput('default_bump', 'false');
      const commits: any[] = [];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag using custom release types', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:patch,bond:major');
      const commits = [
        { message: 'james: is the new cool guy', hash: null },
        { message: 'bond: is his last name', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag using custom release types but non-custom commit message', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:patch,bond:major');
      const commits = [
        { message: 'fix: is the new cool guy', hash: null },
        { message: 'feat: is his last name', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('release branches', () => {
    beforeEach(() => {
      setBranch('release');
      setInput('release_branches', 'release');
    });

    it('does create patch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create minor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create major tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag when pre-release tag is newer', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: some new feature on a release branch', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.3-prerelease.0',
          commit: { sha: '678901', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.3-prerelease.1',
          commit: { sha: '234567', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.2.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag with custom release rules', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:preminor');
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
        { message: 'james: this should make a preminor', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('pre-release branches', () => {
    beforeEach(() => {
      setBranch('prerelease');
      setInput('pre_release_branches', 'prerelease');
    });

    it('does not create tag without commits and default_bump set to false', async () => {
      /*
       * Given
       */
      setInput('default_prerelease_bump', 'false');
      const commits: any[] = [];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prerelease tag', async () => {
      /*
       * Given
       */
      setInput('default_prerelease_bump', 'prerelease');
      const commits = [{ message: 'this is my first fix', hash: null }];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create prepatch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.2.4-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create preminor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create premajor tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.0.0-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag when release tag is newer', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3-prerelease.0',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v3.1.2-feature.0',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
        {
          name: 'v2.1.4',
          commit: { sha: '234567', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v2.2.0-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does create tag with custom release rules', async () => {
      /*
       * Given
       */
      setInput('custom_release_rules', 'james:preminor');
      const commits = [
        {
          message: 'feat: some new feature on a pre-release branch',
          hash: null,
        },
        { message: 'james: this should make a preminor', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockCreateTag).toHaveBeenCalledWith(
        'v1.3.0-prerelease.0',
        expect.any(Boolean),
        expect.any(String)
      );
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('other branches', () => {
    beforeEach(() => {
      setBranch('development');
      setInput('pre_release_branches', 'prerelease');
      setInput('release_branches', 'release');
    });

    it('does output patch tag', async () => {
      /*
       * Given
       */
      const commits = [{ message: 'fix: this is my first fix', hash: null }];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.2.4');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does output minor tag', async () => {
      /*
       * Given
       */
      const commits = [
        { message: 'feat: this is my first feature', hash: null },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '1.3.0');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does output major tag', async () => {
      /*
       * Given
       */
      const commits = [
        {
          message:
            'my commit message\nBREAKING CHANGE:\nthis is a breaking change',
          hash: null,
        },
      ];
      vi.mocked(utils.getCommits).mockImplementation(async (_sha) => commits);

      const validTags = [
        {
          name: 'v1.2.3',
          commit: { sha: '012345', url: '' },
          zipball_url: '',
          tarball_url: 'string',
          node_id: 'string',
        },
      ];
      vi.mocked(utils.getValidTags).mockImplementation(async () => validTags);

      /*
       * When
       */
      await action();

      /*
       * Then
       */
      expect(mockSetOutput).toHaveBeenCalledWith('new_version', '2.0.0');
      expect(mockCreateTag).not.toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });
});
