// Prints "<bytes>\t<key>" for every object in one Local-stack bucket.
// Any failure exits non-zero: an empty listing must mean an empty bucket.
// Usage: node list-bucket.mjs <bucket>   (MINIO_ACCESS_KEY/MINIO_SECRET_KEY from .env)
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const { MINIO_ACCESS_KEY, MINIO_SECRET_KEY } = process.env;
// docker-compose.dev.yml publishes the object store on this loopback port.
const endpoint = process.env.DEV_STORAGE_ENDPOINT ?? 'http://127.0.0.1:9001';
const Bucket = process.argv[2];
if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !Bucket) {
  throw new Error('usage: MINIO_ACCESS_KEY/MINIO_SECRET_KEY set; list-bucket.mjs <bucket>');
}

const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY } });

try {
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, ContinuationToken }),
      { abortSignal: AbortSignal.timeout(10_000) });
    for (const object of page.Contents ?? []) {
      process.stdout.write(`${object.Size}\t${object.Key}\n`);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
} finally {
  client.destroy();
}
