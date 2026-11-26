import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_SECRET_LENGTH } from '../lib/config.js';
import { planProvision } from '../lib/provision-plan.js';

const VPS_URL = 'https://api.tele-lenta.example';
const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const MINIAPP_URL = 'https://app.tele-lenta.example';

const never = Object.freeze({ vpsUrl: false, sharedSecret: false });
const provisioned = Object.freeze({ vpsUrl: true, sharedSecret: true });
const partial = Object.freeze({ vpsUrl: true, sharedSecret: false });

describe('planProvision — the core pair', () => {
  it('writes both keys on a fresh database', () => {
    const plan = planProvision({
      present: never,
      input: { vpsUrl: VPS_URL, sharedSecret: SECRET },
    });

    assert.deepEqual(plan, {
      ok: true,
      write: ['vps_url', 'shared_secret'],
      values: { vpsUrl: VPS_URL, sharedSecret: SECRET },
    });
  });

  it('normalizes the URL by trimming and stripping trailing slashes', () => {
    const plan = planProvision({
      present: never,
      input: { vpsUrl: `  ${VPS_URL}//  `, sharedSecret: ` ${SECRET} ` },
    });

    assert.equal(plan.values.vpsUrl, VPS_URL);
    assert.equal(plan.values.sharedSecret, SECRET);
  });

  it('refuses when the pair already exists', () => {
    const plan = planProvision({
      present: provisioned,
      input: { vpsUrl: VPS_URL, sharedSecret: SECRET },
    });

    assert.deepEqual(plan, {
      ok: false,
      write: [],
      reason: 'already_provisioned',
    });
  });

  it('refuses a partially written database', () => {
    const plan = planProvision({
      present: partial,
      input: { vpsUrl: VPS_URL, sharedSecret: SECRET },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'partially_provisioned');
  });

  it('keeps the old validation reasons for the old call', () => {
    assert.equal(
      planProvision({ present: never, input: { vpsUrl: 'ftp://nope', sharedSecret: SECRET } }).reason,
      'vps_url_invalid',
    );
    assert.equal(
      planProvision({ present: never, input: { vpsUrl: VPS_URL, sharedSecret: 'short' } }).reason,
      'shared_secret_too_short',
    );
    assert.equal(planProvision({ present: never, input: {} }).reason, 'vps_url_invalid');
    assert.equal(planProvision({ present: never }).reason, 'vps_url_invalid');
  });
});

describe('planProvision — miniapp_url', () => {
  it('writes miniapp_url after the pair on a fresh database', () => {
    const plan = planProvision({
      present: never,
      input: { vpsUrl: VPS_URL, sharedSecret: SECRET, miniappUrl: MINIAPP_URL },
    });

    assert.deepEqual(plan.write, ['vps_url', 'shared_secret', 'miniapp_url']);
    assert.equal(plan.values.miniappUrl, MINIAPP_URL);
  });

  it('updates only miniapp_url when the pair already exists', () => {
    const plan = planProvision({
      present: provisioned,
      input: { miniappUrl: MINIAPP_URL },
    });

    assert.deepEqual(plan, {
      ok: true,
      write: ['miniapp_url'],
      values: { miniappUrl: MINIAPP_URL },
    });
  });

  it('overwrites an existing miniapp_url alone', () => {
    const plan = planProvision({
      present: { ...provisioned, miniappUrl: true },
      input: { miniappUrl: 'https://new.tele-lenta.example' },
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.write, ['miniapp_url']);
  });

  it('still refuses the pair when miniapp_url is supplied with it', () => {
    const plan = planProvision({
      present: provisioned,
      input: { vpsUrl: VPS_URL, sharedSecret: SECRET, miniappUrl: MINIAPP_URL },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'already_provisioned');
  });

  it('refuses miniapp_url before the pair exists', () => {
    const plan = planProvision({ present: never, input: { miniappUrl: MINIAPP_URL } });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'not_provisioned');
  });

  it('rejects a non-https miniapp_url', () => {
    assert.equal(
      planProvision({
        present: never,
        input: { vpsUrl: VPS_URL, sharedSecret: SECRET, miniappUrl: 'http://app.tele-lenta.example' },
      }).reason,
      'miniapp_url_invalid',
    );
    assert.equal(
      planProvision({ present: provisioned, input: { miniappUrl: 'http://app.tele-lenta.example' } })
        .reason,
      'miniapp_url_invalid',
    );
    assert.equal(
      planProvision({ present: provisioned, input: { miniappUrl: '   ' } }).reason,
      'miniapp_url_invalid',
    );
  });
});
