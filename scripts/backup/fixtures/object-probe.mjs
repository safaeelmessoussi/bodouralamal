// Seeds and reads back the backup drill's one canary object over S3.
// Usage: node object-probe.mjs put|get <bucket> <key> [value]
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const { MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY } = process.env;
const [operation, Bucket, Key, value] = process.argv.slice(2);
if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !Bucket || !Key ||
    !['put', 'get'].includes(operation) || (operation === 'put' && value === undefined)) {
  throw new Error('usage: MINIO_* set; object-probe.mjs put|get <bucket> <key> [value]');
}

const client = new S3Client({ endpoint: MINIO_ENDPOINT, region: 'us-east-1',
  forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY } });
const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(10_000) });

try {
  if (operation === 'put') {
    await send(new PutObjectCommand({ Bucket, Key, Body: Buffer.from(value), ContentType: 'text/plain' }));
  } else {
    const object = await send(new GetObjectCommand({ Bucket, Key }));
    process.stdout.write(await object.Body.transformToString());
  }
} finally {
  client.destroy();
}
