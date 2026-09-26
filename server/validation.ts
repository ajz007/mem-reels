import sharp from "sharp";

import type { ValidationReasonCode } from "../src/domain/validation";
import type { ValidationPolicy } from "./validation-policy";

export interface ValidatedImage {
  format: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  normalized: Buffer;
}

export class InputValidationError extends Error {
  constructor(
    readonly code: "invalid_image_source" | "unsupported_file" | "unsupported_photo",
    message: string,
    readonly reasonCode?: ValidationReasonCode,
  ) {
    super(message);
  }
}

const maxBytes = 20 * 1024 * 1024;
const maxPixels = 40_000_000;
const minDimension = 320;

const defaultPolicy: ValidationPolicy["deterministic"] = {
  maximumBytes: maxBytes,
  maximumPixels: maxPixels,
  minimumWidth: minDimension,
  minimumHeight: minDimension,
  acceptedFormats: ["jpeg", "png", "webp"],
};

export async function validateImage(
  bytes: Buffer,
  policy: ValidationPolicy["deterministic"] = defaultPolicy,
): Promise<ValidatedImage> {
  if (bytes.length === 0 || bytes.length > policy.maximumBytes) {
    throw new InputValidationError(
      "unsupported_file",
      "Choose an image smaller than 20 MB.",
      "file_too_large",
    );
  }
  const expectedFormat = signatureFormat(bytes);
  if (!expectedFormat || !policy.acceptedFormats.includes(expectedFormat)) {
    throw new InputValidationError(
      "unsupported_file",
      "Use a JPEG, PNG, or WebP image file.",
      "file_signature_invalid",
    );
  }

  try {
    const rendered = await sharp(bytes, { failOn: "error" })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    const format = rendered.info.format;
    if (format !== expectedFormat || !rendered.info.width || !rendered.info.height) {
      throw new InputValidationError(
        "invalid_image_source",
        "This image file could not be read completely.",
        "full_decode_failed",
      );
    }
    if (rendered.info.width < policy.minimumWidth || rendered.info.height < policy.minimumHeight) {
      throw new InputValidationError(
        "unsupported_file",
        "Choose an image at least 320 pixels on each side.",
        "dimensions_too_small",
      );
    }
    if (rendered.info.width * rendered.info.height > policy.maximumPixels) {
      throw new InputValidationError(
        "unsupported_file",
        "Choose an image with fewer than 40 megapixels.",
        "pixel_count_too_large",
      );
    }
    return {
      format,
      width: rendered.info.width,
      height: rendered.info.height,
      normalized: rendered.data,
    };
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw new InputValidationError(
      "invalid_image_source",
      "This image is corrupt or incomplete. Please choose a fresh JPEG, PNG, or WebP file.",
      "full_decode_failed",
    );
  }
}

function signatureFormat(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  return null;
}
