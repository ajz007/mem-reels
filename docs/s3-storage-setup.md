# Private S3 storage contract

Memory Reels will use one private S3 bucket with the prefixes `originals/`, `normalized/`, and `reels/`. The browser receives only short-lived presigned upload/download URLs; it never receives AWS credentials. The fal worker receives only a short-lived HTTPS source URL.

Required runtime settings (server secret manager only):

- `AWS_REGION`
- `MEMORY_REELS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or a workload IAM role

Required bucket rules: block all public access, encrypt at rest, restrict IAM to the three prefixes, expire originals and reels according to the disclosed retention policy, and log access. Do not add these values to `VITE_*`, browser code, Git, or logs.

Until this bucket exists, the local adapter remains the only active storage implementation and fal submission stays locked.
