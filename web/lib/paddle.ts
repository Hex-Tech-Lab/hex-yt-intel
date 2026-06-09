import { Environment, Paddle, LogLevel } from '@paddle/paddle-node-sdk';

/**
 * PADDLE INTEGRATION LAW (2026-06-08)
 * -----------------------------------
 * Primary Merchant of Record for Hex-YT Intel.
 * Supports Egypt and provides global compliance.
 */

const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_ENVIRONMENT = (process.env.PADDLE_ENVIRONMENT as Environment) || Environment.sandbox;

export const paddle = new Paddle(PADDLE_API_KEY, {
  environment: PADDLE_ENVIRONMENT,
  logLevel: LogLevel.error,
});

/**
 * Creates a Paddle Checkout transaction
 */
export async function createPaddleCheckout(userId: string) {
  try {
    const transaction = await paddle.transactions.create({
      items: [
        {
          priceId: process.env.PADDLE_PRO_PRICE_ID || '', // Monthly Pro
          quantity: 1,
        },
      ],
      customData: {
        userId: userId,
      },
    });

    return transaction.id;
  } catch (error) {
    console.error('[Paddle] Checkout creation failed:', error);
    return null;
  }
}
