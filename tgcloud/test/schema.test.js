import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SETTINGS_KEYS, SETTINGS_TABLE } from '../lib/settings-keys.js';

const source = readFileSync(new URL('../schema.js', import.meta.url), 'utf8');

describe('settings schema', () => {
  it('declares the settings table with the shared contract', () => {
    assert.equal(SETTINGS_TABLE, 'settings');
    assert.match(source, /table\(\s*SETTINGS_TABLE\s*,/);
    assert.match(source, /key:\s*text\('key'\)\.primaryKey\(\)/);
    assert.match(source, /value:\s*text\('value'\)\.notNull\(\)/);
    assert.match(source, /updatedAt:\s*integer\('updated_at',\s*\{\s*mode:\s*'timestamp'\s*\}\)/);
  });

  it('declares no foreign keys (the platform forbids them)', () => {
    assert.doesNotMatch(source, /\.references\(/);
    assert.doesNotMatch(source, /foreignKey\(/);
  });

  it('keeps the settings keys in one place', () => {
    assert.equal(SETTINGS_KEYS.VPS_URL, 'vps_url');
    assert.equal(SETTINGS_KEYS.SHARED_SECRET, 'shared_secret');
    assert.equal(SETTINGS_KEYS.MINIAPP_URL, 'miniapp_url');
  });

  it('imports only the platform SDK and relative modules', () => {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.ok(
        specifier === 'sdk' ||
          specifier.startsWith('sdk/') ||
          (specifier.startsWith('./') && specifier.endsWith('.js')),
        `unexpected import: ${specifier}`,
      );
    }
  });
});
