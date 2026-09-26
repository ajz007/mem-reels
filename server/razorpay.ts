import { createHmac, timingSafeEqual } from "node:crypto";

import type { CreditPack } from "../src/domain/types";

export const creditPacks: readonly CreditPack[] = [
  {
    id: "starter-5",
    name: "Starter pack",
    credits: 5,
    amountPaise: 49900,
    currency: "INR",
    description: "Five reel credits for trying several memories.",
  },
  {
    id: "creator-12",
    name: "Creator pack",
    credits: 12,
    amountPaise: 99900,
    currency: "INR",
    description: "Twelve reel credits at a lower cost per reel.",
  },
] as const;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
}

export interface PaymentGateway {
  readonly configured: boolean;
  readonly publicKeyId: string;
  createOrder(input: {
    amountPaise: number;
    currency: "INR";
    receipt: string;
    purchaseId: string;
  }): Promise<RazorpayOrder>;
}

export class RazorpayGateway implements PaymentGateway {
  readonly publicKeyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  private readonly secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  readonly configured = Boolean(this.publicKeyId && this.secret);

  async createOrder(input: {
    amountPaise: number;
    currency: "INR";
    receipt: string;
    purchaseId: string;
  }): Promise<RazorpayOrder> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100)
      throw new Error("Order amount must be an integer of at least 100 paise.");
    if (!this.configured) throw new Error("Razorpay checkout is not configured.");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.publicKeyId}:${this.secret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
        notes: { purchase_id: input.purchaseId },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Razorpay could not create the checkout order.");
    const order = (await response.json()) as Partial<RazorpayOrder>;
    if (
      typeof order.id !== "string" ||
      order.amount !== input.amountPaise ||
      order.currency !== input.currency
    )
      throw new Error("Razorpay returned an invalid order.");
    return { id: order.id, amount: order.amount, currency: order.currency, receipt: input.receipt };
  }
}

export function verifyRazorpayPaymentSignature(
  serverOrderId: string,
  paymentId: string,
  signature: string,
  secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "",
): boolean {
  if (!secret || !serverOrderId || !paymentId || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${serverOrderId}|${paymentId}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifyRazorpayWebhook(
  rawBody: Buffer,
  signature: string,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
): boolean {
  if (!secret || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface CapturedPaymentEvent {
  eventId: string;
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: "INR";
  status: "captured";
}

export function parseCapturedPaymentEvent(
  rawBody: Buffer,
  eventId: string,
): CapturedPaymentEvent | null {
  try {
    const body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    if (body.event !== "payment.captured" && body.event !== "order.paid") return null;
    const payload = body.payload as { payment?: { entity?: Record<string, unknown> } } | undefined;
    const payment = payload?.payment?.entity;
    if (
      !eventId ||
      typeof payment?.id !== "string" ||
      typeof payment.order_id !== "string" ||
      typeof payment.amount !== "number" ||
      payment.currency !== "INR" ||
      payment.status !== "captured"
    )
      return null;
    return {
      eventId,
      providerOrderId: payment.order_id,
      providerPaymentId: payment.id,
      amountPaise: payment.amount,
      currency: "INR",
      status: "captured",
    };
  } catch {
    return null;
  }
}
