import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENV_KEYS,
  MIN_SECRET_LENGTH,
  SETTINGS_KEYS,
  resolveConfig,
} from '../lib/config.js';

const SECRET = 'tele-lenta-test-shared-secret-0123456789';
const VPS_URL = 'https://api.tele-lenta.test';

describe('resolveConfig', () => {
  it('prefers environment variables over settings rows', () => {
    const config = resolveConfig({
      env: {
        [ENV_KEYS.VPS_URL]: 'https://env.tele-lenta.test',
        [ENV_KEYS.SHARED_SECRET]: SECRET,
      },
      settings: [
        { key: SETTINGS_KEYS.VPS_URL, value: 'https://settings.tele-lenta.test' },
        { key: SETTINGS_KEYS.SHARED_SECRET, value: 'a'.repeat(40) },
      ],
    });

    assert.deepEqual(config, {
      ok: true,
      vpsUrl: 'https://env.tele-lenta.test',
      sharedSecret: SECRET,
      sources: { vpsUrl: 'env', sharedSecret: 'env' },
    });
  });

  it('falls back to the settings table when the environment is absent', () => {
    const config = resolveConfig({
      env: {},
      settings: [
        { key: SETTINGS_KEYS.VPS_URL, value: VPS_URL },
        { key: SETTINGS_KEYS.SHARED_SECRET, value: SECRET },
      ],
    });

    assert.equal(config.ok, true);
    assert.equal(config.vpsUrl, VPS_URL);
    assert.equal(config.sharedSecret, SECRET);
    assert.deepEqual(config.sources, { vpsUrl: 'settings', sharedSecret: 'settings' });
  });

  it('mixes sources independently', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: VPS_URL },
      settings: { [SETTINGS_KEYS.SHARED_SECRET]: SECRET },
    });
    assert.deepEqual(config.sources, { vpsUrl: 'env', sharedSecret: 'settings' });
  });

  it('treats blank values as absent', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: '   ', [ENV_KEYS.SHARED_SECRET]: '' },
      settings: [
        { key: SETTINGS_KEYS.VPS_URL, value: VPS_URL },
        { key: SETTINGS_KEYS.SHARED_SECRET, value: SECRET },
      ],
    });
    assert.equal(config.ok, true);
    assert.equal(config.sources.vpsUrl, 'settings');
  });

  it('strips trailing slashes so the upstream join stays single', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: `${VPS_URL}///`, [ENV_KEYS.SHARED_SECRET]: SECRET },
    });
    assert.equal(config.vpsUrl, VPS_URL);
  });

  it('returns a typed configuration error when both values are missing', () => {
    const config = resolveConfig({ env: {}, settings: [] });
    assert.deepEqual(config, {
      ok: false,
      code: 'upstream_unavailable',
      reason: 'configuration_missing',
      missing: [ENV_KEYS.VPS_URL, ENV_KEYS.SHARED_SECRET],
    });
  });

  it('names only the missing key', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: VPS_URL },
      settings: [],
    });
    assert.equal(config.missing.length, 1);
    assert.equal(config.missing[0], ENV_KEYS.SHARED_SECRET);
  });

  it('rejects a malformed VPS URL', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: 'api.tele-lenta.test', [ENV_KEYS.SHARED_SECRET]: SECRET },
    });
    assert.deepEqual(config, {
      ok: false,
      code: 'upstream_unavailable',
      reason: 'vps_url_invalid',
      missing: [ENV_KEYS.VPS_URL],
    });
  });

  it('rejects a shared secret shorter than the VPS minimum', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: VPS_URL, [ENV_KEYS.SHARED_SECRET]: 'a'.repeat(MIN_SECRET_LENGTH - 1) },
    });
    assert.equal(config.ok, false);
    assert.equal(config.reason, 'shared_secret_too_short');
  });

  it('accepts a secret of exactly the minimum length', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: VPS_URL, [ENV_KEYS.SHARED_SECRET]: 'a'.repeat(MIN_SECRET_LENGTH) },
    });
    assert.equal(config.ok, true);
  });

  it('reads process.env when no env object is passed', () => {
    const previousUrl = process.env[ENV_KEYS.VPS_URL];
    const previousSecret = process.env[ENV_KEYS.SHARED_SECRET];
    try {
      process.env[ENV_KEYS.VPS_URL] = VPS_URL;
      process.env[ENV_KEYS.SHARED_SECRET] = SECRET;
      const config = resolveConfig();
      assert.equal(config.ok, true);
      assert.equal(config.sources.vpsUrl, 'env');
    } finally {
      if (previousUrl === undefined) delete process.env[ENV_KEYS.VPS_URL];
      else process.env[ENV_KEYS.VPS_URL] = previousUrl;
      if (previousSecret === undefined) delete process.env[ENV_KEYS.SHARED_SECRET];
      else process.env[ENV_KEYS.SHARED_SECRET] = previousSecret;
    }
  });

  it('never includes a value in a failure result', () => {
    const config = resolveConfig({
      env: { [ENV_KEYS.VPS_URL]: VPS_URL, [ENV_KEYS.SHARED_SECRET]: 'too-short-secret' },
    });
    const serialized = JSON.stringify(config);
    assert.equal(serialized.includes('too-short-secret'), false);
    assert.equal(serialized.includes(VPS_URL), false);
  });
});
