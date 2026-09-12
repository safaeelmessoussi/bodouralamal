import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_POLICY, matchesPublicPolicy } from './policy.mjs';

test('public read policy accepts scalar serialization, not additional authority', () => {
  assert.equal(matchesPublicPolicy(JSON.stringify(PUBLIC_POLICY)), true);
  const returned = { Statement: [{ Resource: 'arn:aws:s3:::public/*', Action: 's3:GetObject', Principal: '*', Effect: 'Allow' }], Version: '2012-10-17' };
  assert.equal(matchesPublicPolicy(JSON.stringify(returned)), true);
  for (const change of [
    { Action: ['s3:GetObject', 's3:PutObject'] }, { Resource: 'arn:aws:s3:::*/*' },
    { Effect: 'Deny' }, { Condition: {} }, { NotAction: 's3:DeleteObject' },
  ]) {
    assert.equal(matchesPublicPolicy(JSON.stringify({ ...returned, Statement: [{ ...returned.Statement[0], ...change }] })), false);
  }
});
