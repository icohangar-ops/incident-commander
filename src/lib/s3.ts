import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.S3_BUCKET || 'incident-commander-artifacts';

export async function ensureBucket() {
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (e: unknown) {
    const err = e as { name?: string };
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
      console.error('S3 bucket creation warning:', e);
    }
  }
}

export async function uploadArtifact(key: string, content: string, contentType: string = 'application/json') {
  await ensureBucket();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    ContentType: contentType,
  }));
  return `s3://${BUCKET}/${key}`;
}

export async function getArtifact(key: string): Promise<string | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return (await result.Body?.transformToString()) || null;
  } catch {
    return null;
  }
}

export async function listArtifacts(prefix: string) {
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    return (result.Contents || []).map(obj => ({
      key: obj.Key!,
      size: obj.Size!,
      lastModified: obj.LastModified!.toISOString(),
    }));
  } catch {
    return [];
  }
}