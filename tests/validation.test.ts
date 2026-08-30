import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateImage } from "../server/validation";

const source = (name: string): string =>
  resolve(process.cwd(), "..", "..", "..", "phase0", "source-images", name);

describe("image preflight validation", () => {
  it("fully decodes a valid benchmark source", async () => {
    const result = await validateImage(await readFile(source("01-controlled-full-body.png")));
    expect(result.width).toBeGreaterThanOrEqual(320);
    expect(result.height).toBeGreaterThanOrEqual(320);
  });

  it("rejects the known truncated aged scan before a provider attempt", async () => {
    await expect(
      validateImage(await readFile(source("04-aged-1980s-scan.png"))),
    ).rejects.toMatchObject({ code: "invalid_image_source" });
  });
});
