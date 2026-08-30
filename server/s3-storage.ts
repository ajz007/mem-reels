import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Storage {
  private readonly bucket = requireEnv("MEMORY_REELS_S3_BUCKET");
  private readonly client = new S3Client({ region: requireEnv("AWS_REGION") });

  async verifyAccess(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async putNormalized(jobId: string, body: Buffer): Promise<string> {
    const key = `normalized/${jobId}/source.png`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "image/png",
        ServerSideEncryption: "AES256",
      }),
    );
    return key;
  }

  async createSourceUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 3600,
    });
  }

  async putReel(jobId: string, body: Buffer): Promise<string> {
    const key = `reels/${jobId}/output.mp4`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "video/mp4",
        ServerSideEncryption: "AES256",
      }),
    );
    return key;
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error("Stored media is unavailable.");
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_REGION && process.env.MEMORY_REELS_S3_BUCKET);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for S3 storage.`);
  return value;
}
