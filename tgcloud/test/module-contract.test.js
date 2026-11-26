import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Static platform contract for the deployed entry points.
 *
 * The Serverless runtime resolves exactly two things: the `sdk` module (and its
 * `sdk/*` submodules) and relative modules inside `tgcloud/` ending in `.js`.
 * Every file in `endpoints/` and `handlers/` must be a default-export function.
 * These are facts about the platform, so a violation is a test failure rather
 * than something discovered at deploy time.
 */

const TGCLOUD_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRECTORIES = ['endpoints', 'handlers'];

function sourceFiles(directory) {
  const absolute = join(TGCLOUD_ROOT, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => ({ name: `${directory}/${entry.name}`, path: join(absolute, entry.name) }));
}

function importSpecifiers(source) {
  const specifiers = [];

  const fromPattern = /\bfrom\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(fromPattern)) specifiers.push(match[1]);

  const sideEffectPattern = /^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(sideEffectPattern)) specifiers.push(match[1]);

  return specifiers;
}

function isAllowedSpecifier(specifier) {
  if (specifier === 'sdk' || specifier.startsWith('sdk/')) return true;
  return (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js');
}

describe('deployed entry-point modules', () => {
  for (const directory of DIRECTORIES) {
    const files = sourceFiles(directory);

    it(`${directory}/ contains only default-export modules with resolvable imports`, () => {
      // `handlers/` arrives with the bot ticket; the rule still runs then.
      for (const file of files) {
        const source = readFileSync(file.path, 'utf8');

        assert.match(
          source,
          /export\s+default\s+/,
          `${file.name} must have a default export`,
        );
        assert.doesNotMatch(source, /\brequire\s*\(/, `${file.name} must not use require()`);
        assert.doesNotMatch(source, /\bimport\s*\(/, `${file.name} must not use dynamic import()`);

        for (const specifier of importSpecifiers(source)) {
          assert.equal(
            isAllowedSpecifier(specifier),
            true,
            `${file.name} imports "${specifier}"; only sdk, sdk/*, and relative .js modules are allowed`,
          );
        }
      }
    });
  }

  it('finds the flat BFF endpoints', () => {
    const names = sourceFiles('endpoints').map((file) => file.name.replace('endpoints/', ''));
    for (const expected of [
      'session.js',
      'feed.js',
      'card.js',
      'sources.js',
      'saved-searches.js',
      'me.js',
      'provision.js',
      'diagnose.js',
    ]) {
      assert.equal(names.includes(expected), true, `endpoints/${expected} is missing`);
    }
  });

  it('finds the message handler', () => {
    const names = sourceFiles('handlers').map((file) => file.name.replace('handlers/', ''));
    assert.equal(names.includes('message.js'), true, 'handlers/message.js is missing');
  });

  it('keeps the message handler free of product state', () => {
    const path = join(TGCLOUD_ROOT, 'handlers', 'message.js');
    const source = readFileSync(path, 'utf8');

    assert.doesNotMatch(source, /schema\.js/, 'handlers/message.js must not import the schema');
    assert.doesNotMatch(source, /\bdb\./, 'handlers/message.js must not query the database');
    assert.doesNotMatch(source, /\bfetch\s*\(/, 'handlers/message.js must not call fetch');
    assert.match(source, /export\s+default\s+/, 'handlers/message.js must have a default export');
  });
});
