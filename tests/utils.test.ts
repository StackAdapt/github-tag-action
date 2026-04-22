import { describe, expect, it, vi } from 'vitest';
import type * as CoreModule from '@actions/core';
import type * as GithubModule from '../src/github.js';
import * as utils from '../src/utils.js';
import { getValidTags } from '../src/utils.js';
import * as github from '../src/github.js';
import { defaultChangelogRules } from '../src/defaults.js';

// `@actions/core` is a real ESM package, so Node seals its namespace object
// and `vi.spyOn(core, ...)` cannot replace the exports in place. We therefore
// replace the whole module with a factory-produced plain object that keeps
// the original implementations but replaces the logging functions with
// silent `vi.fn()` stubs.
vi.mock('@actions/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    ...actual,
    debug: vi.fn(),
    warning: vi.fn(),
  };
});

// Same reasoning as in `action.test.ts`: ESM named imports are live
// bindings, so individual tests mutate `github.listTags` via
// `vi.mocked(...)` rather than `vi.spyOn(...)`.
vi.mock('../src/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GithubModule>();
  return {
    ...actual,
    listTags: vi.fn(actual.listTags),
  };
});

const regex = /^v/;

describe('utils', () => {
  it('extracts branch from ref', () => {
    /*
     * Given
     */
    const remoteRef = 'refs/heads/master';

    /*
     * When
     */
    const branch = utils.getBranchFromRef(remoteRef);

    /*
     * Then
     */
    expect(branch).toEqual('master');
  });

  it('test if ref is PR', () => {
    /*
     * Given
     */
    const remoteRef = 'refs/pull/123/merge';

    /*
     * When
     */
    const isPullRequest = utils.isPr(remoteRef);

    /*
     * Then
     */
    expect(isPullRequest).toEqual(true);
  });

  it('returns valid tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'release-1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];
    const mockListTags = vi
      .mocked(github.listTags)
      .mockImplementation(async () => testTags);

    /*
     * When
     */
    const validTags = await getValidTags(regex, false);

    /*
     * Then
     */
    expect(mockListTags).toHaveBeenCalled();
    expect(validTags).toHaveLength(1);
  });

  it('returns sorted tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'v1.2.4-prerelease.1',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.4-prerelease.2',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.4-prerelease.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'v1.2.3',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];
    const mockListTags = vi
      .mocked(github.listTags)
      .mockImplementation(async () => testTags);

    /*
     * When
     */
    const validTags = await getValidTags(regex, false);

    /*
     * Then
     */
    expect(mockListTags).toHaveBeenCalled();
    expect(validTags[0]).toEqual({
      name: 'v1.2.4-prerelease.2',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });

  it('returns only prefixed tags', async () => {
    /*
     * Given
     */
    const testTags = [
      {
        name: 'app2/5.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: '7.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
      {
        name: 'app1/3.0.0',
        commit: { sha: 'string', url: 'string' },
        zipball_url: 'string',
        tarball_url: 'string',
        node_id: 'string',
      },
    ];
    const mockListTags = vi
      .mocked(github.listTags)
      .mockImplementation(async () => testTags);
    /*
     * When
     */
    const validTags = await getValidTags(/^app1\//, false);
    /*
     * Then
     */
    expect(mockListTags).toHaveBeenCalled();
    expect(validTags).toHaveLength(1);
    expect(validTags[0]).toEqual({
      name: 'app1/3.0.0',
      commit: { sha: 'string', url: 'string' },
      zipball_url: 'string',
      tarball_url: 'string',
      node_id: 'string',
    });
  });

  describe('custom release types', () => {
    it('maps custom release types', () => {
      /*
       * Given
       */
      const customReleasesString =
        'james:preminor,bond:premajor,007:major:Breaking Changes,feat:minor';

      /*
       * When
       */
      const mappedReleases = utils.mapCustomReleaseRules(customReleasesString);

      /*
       * Then
       */
      expect(mappedReleases).toEqual([
        { type: 'james', release: 'preminor' },
        { type: 'bond', release: 'premajor' },
        { type: '007', release: 'major', section: 'Breaking Changes' },
        {
          type: 'feat',
          release: 'minor',
          section: defaultChangelogRules['feat'].section,
        },
      ]);
    });

    it('filters out invalid custom release types', () => {
      /*
       * Given
       */
      const customReleasesString = 'james:pre-release,bond:premajor';

      /*
       * When
       */
      const mappedReleases = utils.mapCustomReleaseRules(customReleasesString);

      /*
       * Then
       */
      expect(mappedReleases).toEqual([{ type: 'bond', release: 'premajor' }]);
    });
  });

  describe('method: mergeWithDefaultChangelogRules', () => {
    it('combines non-existing type rules with default rules', () => {
      /**
       * Given
       */
      const newRule = {
        type: 'james',
        release: 'major',
        section: '007 Changes',
      };

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules([newRule]);

      /**
       * Then
       */
      expect(result).toEqual([
        ...Object.values(defaultChangelogRules),
        newRule,
      ]);
    });

    it('overwrites existing default type rules with provided rules', () => {
      /**
       * Given
       */
      const newRule = {
        type: 'feat',
        release: 'minor',
        section: '007 Changes',
      };

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules([newRule]);
      const overWrittenRule = result.find((rule) => rule.type === 'feat');

      /**
       * Then
       */
      expect(overWrittenRule?.section).toBe(newRule.section);
    });

    it('returns only the rules having changelog section', () => {
      /**
       * Given
       */
      const mappedReleaseRules = [
        { type: 'james', release: 'major', section: '007 Changes' },
        { type: 'bond', release: 'minor', section: undefined },
      ];

      /**
       * When
       */
      const result = utils.mergeWithDefaultChangelogRules(mappedReleaseRules);

      /**
       * Then
       */
      expect(result).toContainEqual(mappedReleaseRules[0]);
      expect(result).not.toContainEqual(mappedReleaseRules[1]);
    });
  });
});
