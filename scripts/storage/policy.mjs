import { isDeepStrictEqual } from 'node:util';

export const PUBLIC_POLICY = { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
  Principal: '*', Action: ['s3:GetObject'], Resource: ['arn:aws:s3:::public/*'] }] };

export function matchesPublicPolicy(json) {
  const policy = JSON.parse(json);
  if (!Array.isArray(policy.Statement)) return false;
  // S3 serializers may emit singleton Action/Resource as a string. Normalize
  // only that representational difference, never extra grants or conditions.
  return isDeepStrictEqual({ ...policy, Statement: policy.Statement.map((entry) => ({
    ...entry,
    Action: typeof entry.Action === 'string' ? [entry.Action] : entry.Action,
    Resource: typeof entry.Resource === 'string' ? [entry.Resource] : entry.Resource,
  })) }, PUBLIC_POLICY);
}
