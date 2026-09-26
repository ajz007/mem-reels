import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FalAdapter } from "../server/fal-adapter";
import { LocalJobService } from "../server/jobs";
import {
  parseCapturedPaymentEvent,
  type PaymentGateway,
  verifyRazorpayWebhook,
  verifyRazorpayPaymentSignature,
  RazorpayGateway,
} from "../server/razorpay";
import type { AnalyticsPort } from "../src/domain/ports";

const directories: string[] = [];
const analytics: AnalyticsPort = { async record() {} };
const user = { id: "payment-user", displayName: "Payment Test" };

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

class FakeGateway implements PaymentGateway {
  readonly configured = true;
  readonly publicKeyId = "rzp_test_public";
  calls = 0;
  async createOrder(input: { amountPaise: number; currency: "INR"; receipt: string }) {
    this.calls += 1;
    return {
      id: `order_${this.calls}`,
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
    };
  }
}

async function service(gateway = new FakeGateway()) {
  const directory = await mkdtemp(join(tmpdir(), "memory-reels-payment-"));
  directories.push(directory);
  return new LocalJobService(
    new FalAdapter(),
    analytics,
    undefined,
    join(directory, "state.json"),
    null,
    undefined,
    undefined,
    gateway,
  );
}

describe("Razorpay credit entitlement", () => {
  it("verifies callback signatures against the owner server order without granting credits", async () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "fixture-secret");
    const jobs = await service();
    const checkout = await jobs.createCheckout(user, "starter-5");
    const signature = createHmac("sha256", "fixture-secret")
      .update("order_1|pay_callback")
      .digest("hex");
    expect(
      jobs.verifyCheckoutPayment(user, checkout.purchaseId, "pay_callback", "order_1", signature),
    ).toEqual({ verified: true, creditsAdded: false });
    expect(jobs.account(user).balance).toBe(0);
    expect(
      jobs.verifyCheckoutPayment(
        { id: "other", displayName: "Other" },
        checkout.purchaseId,
        "pay_callback",
        "order_1",
        signature,
      ).verified,
    ).toBe(false);
    expect(
      jobs.verifyCheckoutPayment(
        user,
        checkout.purchaseId,
        "pay_callback",
        "order_tampered",
        signature,
      ).verified,
    ).toBe(false);
    expect(verifyRazorpayPaymentSignature("order_1", "pay_callback", "bad", "fixture-secret")).toBe(
      false,
    );
    expect(
      verifyRazorpayPaymentSignature("order_1", "other_payment", signature, "fixture-secret"),
    ).toBe(false);
  });

  it("rejects production checkout even when the old bypass flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DURABLE_LEDGER_ENABLED", "true");
    const jobs = await service();
    await expect(jobs.createCheckout(user, "starter-5")).rejects.toThrow("durable transactional");
  });

  it("creates valid orders with mocked transport and rejects invalid amounts before transport", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "fixture-secret");
    const transport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "order_fixture", amount: 100, currency: "INR" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", transport);
    const gateway = new RazorpayGateway();
    await expect(
      gateway.createOrder({
        amountPaise: 99,
        currency: "INR",
        receipt: "fixture",
        purchaseId: "fixture",
      }),
    ).rejects.toThrow("100 paise");
    expect(transport).not.toHaveBeenCalled();
    await expect(
      gateway.createOrder({
        amountPaise: 100,
        currency: "INR",
        receipt: "fixture",
        purchaseId: "fixture",
      }),
    ).resolves.toMatchObject({ id: "order_fixture", amount: 100 });
  });
  it("creates checkout server-side and grants a captured purchase exactly once", async () => {
    const jobs = await service();
    const checkout = await jobs.createCheckout(user, "starter-5");
    expect(checkout).toMatchObject({
      providerOrderId: "order_1",
      publicKeyId: "rzp_test_public",
      amountPaise: 49900,
      credits: 5,
    });

    const event = {
      eventId: "event_1",
      providerOrderId: checkout.providerOrderId,
      providerPaymentId: "pay_1",
      amountPaise: 49900,
      currency: "INR" as const,
      status: "captured" as const,
    };
    expect(await jobs.applyCapturedPayment(event)).toBe(true);
    expect(await jobs.applyCapturedPayment(event)).toBe(false);
    expect(jobs.account(user).balance).toBe(5);
    expect(jobs.account(user).purchases[0]).toMatchObject({
      status: "paid",
      providerPaymentId: "pay_1",
    });
  });

  it("rejects a captured amount that differs from the server-created order", async () => {
    const jobs = await service();
    const checkout = await jobs.createCheckout(user, "starter-5");
    await expect(
      jobs.applyCapturedPayment({
        eventId: "event_wrong_amount",
        providerOrderId: checkout.providerOrderId,
        providerPaymentId: "pay_wrong",
        amountPaise: 1,
        currency: "INR",
        status: "captured",
      }),
    ).rejects.toThrow("does not match");
    expect(jobs.account(user).balance).toBe(0);
  });

  it("verifies signatures over the raw body and parses only captured payments", () => {
    const secret = "webhook-secret";
    const body = Buffer.from(
      JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_1",
              order_id: "order_1",
              amount: 49900,
              currency: "INR",
              status: "captured",
            },
          },
        },
      }),
    );
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyRazorpayWebhook(body, signature, secret)).toBe(true);
    expect(verifyRazorpayWebhook(Buffer.from("tampered"), signature, secret)).toBe(false);
    expect(parseCapturedPaymentEvent(body, "event_1")).toMatchObject({
      providerOrderId: "order_1",
      providerPaymentId: "pay_1",
    });
  });

  it("keeps deleted reels in the owner library with a deletion state", async () => {
    const jobs = await service();
    const draft = await jobs.createDraft(user, "wedding-portrait-comes-alive", 1, true);
    await jobs.delete(user, draft.id);
    expect(jobs.list(user)).toHaveLength(1);
    expect(jobs.list(user)[0].status).toBe("deleted");
  });
});
