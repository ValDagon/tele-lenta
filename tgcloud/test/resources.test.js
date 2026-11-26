import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cardTarget,
  feedTarget,
  meMethod,
  meTarget,
  savedSearchesMethod,
  savedSearchesTarget,
  sessionBody,
  sessionTarget,
  sourcesTarget,
} from '../lib/resources.js';

function thrownCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
}

describe('feedTarget', () => {
  it('encodes every filter in the fixed order with repeated sources', () => {
    const target = feedTarget({
      section: 'classifieds',
      category: 'transport',
      demand: 'wanted',
      sources: [1, '4'],
      q: 'Подгорица и',
      cursor: 'abc+def==',
      limit: 20,
    });

    assert.equal(
      target,
      '/v1/feed?section=classifieds&category=transport&demand=wanted' +
        '&sources=1&sources=4' +
        '&q=%D0%9F%D0%BE%D0%B4%D0%B3%D0%BE%D1%80%D0%B8%D1%86%D0%B0%20%D0%B8' +
        '&cursor=abc%2Bdef%3D%3D' +
        '&limit=20',
    );
  });

  it('does not depend on the order keys appear in the input object', () => {
    const left = feedTarget({ limit: 5, q: 'flat', section: 'jobs', demand: 'offer' });
    const right = feedTarget({ demand: 'offer', section: 'jobs', q: 'flat', limit: 5 });
    assert.equal(left, right);
    assert.equal(left, '/v1/feed?section=jobs&demand=offer&q=flat&limit=5');
  });

  it('omits null, undefined, and empty values but keeps zero', () => {
    assert.equal(
      feedTarget({
        section: null,
        category: '',
        demand: undefined,
        sources: [],
        q: '',
        cursor: null,
        limit: null,
      }),
      '/v1/feed',
    );
    assert.equal(feedTarget({ limit: 0 }), '/v1/feed?limit=0');
    assert.equal(feedTarget({ q: 'a b&c=d' }), '/v1/feed?q=a%20b%26c%3Dd');
  });

  it('accepts one source as a scalar and skips empty source entries', () => {
    assert.equal(feedTarget({ sources: 3 }), '/v1/feed?sources=3');
    assert.equal(
      feedTarget({ sources: [null, undefined, '', 2, 'two words'] }),
      '/v1/feed?sources=2&sources=two%20words',
    );
  });

  it('handles a missing or non-object input', () => {
    assert.equal(feedTarget(), '/v1/feed');
    assert.equal(feedTarget(null), '/v1/feed');
    assert.equal(feedTarget('nope'), '/v1/feed');
  });
});

describe('cardTarget', () => {
  it('builds one encoded path segment', () => {
    assert.equal(cardTarget(42), '/v1/cards/42');
    assert.equal(cardTarget('42'), '/v1/cards/42');
    assert.equal(cardTarget('a/b'), '/v1/cards/a%2Fb');
    assert.equal(cardTarget('a b?c'), '/v1/cards/a%20b%3Fc');
  });

  it('rejects a missing id as invalid_request', () => {
    for (const value of [undefined, null, '']) {
      assert.equal(thrownCode(() => cardTarget(value)), 'invalid_request');
    }
  });
});

describe('saved-searches mapping', () => {
  it('maps each action to its target and method', () => {
    assert.deepEqual(
      ['list', 'create'].map((action) => [
        savedSearchesTarget({ action }),
        savedSearchesMethod({ action }),
      ]),
      [
        ['/v1/saved-searches', 'GET'],
        ['/v1/saved-searches', 'POST'],
      ],
    );

    assert.equal(savedSearchesTarget({ action: 'update', id: 7 }), '/v1/saved-searches/7');
    assert.equal(savedSearchesMethod({ action: 'update', id: 7 }), 'PATCH');
    assert.equal(savedSearchesTarget({ action: 'delete', id: 'a/b' }), '/v1/saved-searches/a%2Fb');
    assert.equal(savedSearchesMethod({ action: 'delete', id: 7 }), 'DELETE');
  });

  it('rejects an unknown action and a missing id as invalid_request', () => {
    assert.equal(thrownCode(() => savedSearchesMethod({ action: 'purge' })), 'invalid_request');
    assert.equal(thrownCode(() => savedSearchesTarget({ action: 'purge' })), 'invalid_request');
    assert.equal(thrownCode(() => savedSearchesTarget({ action: 'list' })), null);
    assert.equal(thrownCode(() => savedSearchesTarget({ action: 'update' })), 'invalid_request');
    assert.equal(thrownCode(() => savedSearchesTarget({ action: 'delete', id: '' })), 'invalid_request');
    assert.equal(thrownCode(() => savedSearchesMethod()), 'invalid_request');
  });
});

describe('me mapping', () => {
  it('maps get and update', () => {
    assert.equal(meTarget({ action: 'get' }), '/v1/me');
    assert.equal(meMethod({ action: 'get' }), 'GET');
    assert.equal(meTarget({ action: 'update' }), '/v1/me');
    assert.equal(meMethod({ action: 'update' }), 'PATCH');
  });

  it('rejects an unknown action as invalid_request', () => {
    assert.equal(thrownCode(() => meTarget({ action: 'delete' })), 'invalid_request');
    assert.equal(thrownCode(() => meMethod({ action: 'delete' })), 'invalid_request');
    assert.equal(thrownCode(() => meMethod({})), 'invalid_request');
  });
});

describe('constant targets and session body', () => {
  it('exposes the sources and session paths', () => {
    assert.equal(sourcesTarget(), '/v1/sources');
    assert.equal(sessionTarget(), '/v1/session');
  });

  it('sends the verified profile and drops blank optional fields', () => {
    assert.deepEqual(sessionBody({ id: 1002003004, username: 'beta_tester', first_name: 'Тест' }), {
      id: 1002003004,
      username: 'beta_tester',
      first_name: 'Тест',
    });
    assert.deepEqual(sessionBody({ id: 7, username: '', first_name: undefined }), { id: 7 });
  });

  it('rejects a missing user as init_data_invalid', () => {
    assert.equal(thrownCode(() => sessionBody(null)), 'init_data_invalid');
    assert.equal(thrownCode(() => sessionBody({})), 'init_data_invalid');
  });
});
