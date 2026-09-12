// Idempotent S3 bootstrap. Run only as an explicit operator/fixture operation.
// No live application's initialization path changes bucket policy or data.
import {
  S3Client, CreateBucketCommand, HeadBucketCommand, GetBucketPolicyCommand,
  PutBucketPolicyCommand, GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand, GetObjectLockConfigurationCommand,
} from '@aws-sdk/client-s3';
import { PUBLIC_POLICY, matchesPublicPolicy } from './policy.mjs';

const { MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
  RECORDING_STAGING_BUCKET = 'recordings-staging' } = process.env;
if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(RECORDING_STAGING_BUCKET) ||
    ['public', 'private'].includes(RECORDING_STAGING_BUCKET)) {
  throw new Error('Invalid explicit storage bootstrap configuration');
}
const client = new S3Client({ endpoint: MINIO_ENDPOINT, region: 'us-east-1',
  forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY } });
const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(10_000) });

try {
  for (const Bucket of ['public', 'private', RECORDING_STAGING_BUCKET]) {
    try { await send(new HeadBucketCommand({ Bucket })); }
    catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await send(new CreateBucketCommand({ Bucket }));
    }
    const versioning = await send(new GetBucketVersioningCommand({ Bucket }));
    if (versioning.Status) throw new Error('Bucket versioning must never have been enabled');
    for (const [Command, absent] of [
      [GetBucketLifecycleConfigurationCommand, 'NoSuchLifecycleConfiguration'],
      [GetObjectLockConfigurationCommand, 'ObjectLockConfigurationNotFoundError'],
    ]) {
      try { await send(new Command({ Bucket })); }
      catch (error) { if (error.name === absent) continue; throw error; }
      throw new Error('Unexpected bucket lifecycle or retention configuration');
    }
    let existing;
    try { existing = (await send(new GetBucketPolicyCommand({ Bucket }))).Policy; }
    catch (error) { if (error.name !== 'NoSuchBucketPolicy') throw error; }
    if (Bucket === 'public') {
      if (!existing) await send(new PutBucketPolicyCommand({ Bucket, Policy: JSON.stringify(PUBLIC_POLICY) }));
      else if (!matchesPublicPolicy(existing)) {
        throw new Error('Existing public policy differs; operator review required');
      }
    } else if (existing) throw new Error('Private/staging bucket must have no anonymous policy');
    await send(new HeadBucketCommand({ Bucket }));
  }
  console.log('S3 bootstrap: three authenticated buckets, fixed public-read policy, no versioning/lifecycle/retention');
} catch {
  // SDK exceptions may contain credentials, object paths or server response text.
  console.error('S3 bootstrap failed; inspect configuration privately before retrying');
  process.exitCode = 1;
} finally { client.destroy(); }
