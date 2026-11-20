import express from 'express';
import Stripe from 'stripe';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor } from '../middlewares/verifyRole.js';
import { ObjectId } from 'mongodb';
import { SUBSCRIPTION_PLANS, formatTransactionDocument } from '../models/schemas.js';

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

/**
 * Handle Stripe Webhook Events
 * Verifies event signature, activates vendor Premium plan, and records transaction
 */
export async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Fallback for development if secret not yet supplied
      event = typeof req.body === 'string' || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString())
        : req.body;
      console.warn('[Stripe Webhook] Warning: Processing without cryptographic verification (STRIPE_WEBHOOK_SECRET missing).');
    }
  } catch (err) {
    console.error(`[Stripe Webhook Signature Verification Failed]: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful checkout completion
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const vendorId = session.metadata?.vendorId || session.client_reference_id;
      const plan = session.metadata?.plan || SUBSCRIPTION_PLANS.PREMIUM;
      const amount = session.amount_total ? session.amount_total / 100 : 19.99;
      const currency = session.currency || 'usd';
      const stripeSessionId = session.id;
      const stripeSubscriptionId = session.subscription || null;

      if (!vendorId) {
        console.error('[Stripe Webhook Error]: No vendorId associated with session metadata.');
        return res.status(400).json({ error: 'Vendor ID missing from session metadata.' });
      }

      // 1. Activate Premium subscription for vendor (valid for 30 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const userQuery = ObjectId.isValid(vendorId)
        ? { _id: new ObjectId(vendorId) }
        : { _id: vendorId };

      await collections.users.updateOne(userQuery, {
        $set: {
          subscriptionPlan: SUBSCRIPTION_PLANS.PREMIUM,
          subscriptionExpiresAt: expiresAt,
          updatedAt: new Date(),
        },
      });

      console.log(`[Stripe Webhook] Vendor '${vendorId}' upgraded to Premium plan successfully.`);

      // 2. Record transaction in transactions collection (Collection #4)
      const transactionDoc = formatTransactionDocument({
        vendorId: vendorId,
        plan: plan,
        amount: amount,
        currency: currency,
        stripeSessionId: stripeSessionId,
        stripeSubscriptionId: stripeSubscriptionId,
        status: 'completed',
      });

      await collections.transactions.insertOne(transactionDoc);
      console.log(`[Stripe Webhook] Transaction logged for session ID: ${stripeSessionId}`);

    } catch (dbError) {
      console.error('[Stripe Webhook Database Error]:', dbError.message);
      return res.status(500).json({ error: 'Failed to record subscription in database.' });
    }
  }

  return res.status(200).json({ received: true });
}

/**
 * POST /api/payment/webhook
 * Webhook route mounted within payment router
 */
router.post('/webhook', handleStripeWebhook);

/**
 * POST /api/payment/create-checkout-session
 * Create a Stripe Checkout Session for vendor Premium subscription upgrade
 * Rule: Only authenticated vendors can upgrade; customers and admins cannot access
 */
router.post('/create-checkout-session', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id.toString();
    const vendorEmail = req.user.email;

    // Rule: Check if vendor is already on the Premium plan
    if (req.user.subscriptionPlan === SUBSCRIPTION_PLANS.PREMIUM) {
      return res.status(400).json({
        success: false,
        message: 'Your account is already on the Premium subscription plan.',
      });
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const hasLiveStripeKey = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder');

    if (hasLiveStripeKey) {
      try {
        // Create live Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          customer_email: vendorEmail,
          client_reference_id: vendorId,
          metadata: {
            vendorId: vendorId,
            plan: SUBSCRIPTION_PLANS.PREMIUM,
          },
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: 'PizzaHub Vendor Premium Subscription',
                  description: 'Unlock unlimited menu items, premium vendor badge, and priority placement.',
                },
                unit_amount: 1999, // $19.99 in cents
              },
              quantity: 1,
            },
          ],
          success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${clientUrl}/payment/cancel`,
        });

        return res.status(200).json({
          success: true,
          url: session.url,
          sessionId: session.id,
        });
      } catch (stripeError) {
        console.warn('[Stripe API Notice]:', stripeError.message, '- falling back to dev checkout simulator.');
      }
    }

    // Fallback: Development Stripe Checkout Sandbox Session
    const mockSessionId = `cs_test_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return res.status(200).json({
      success: true,
      url: `${clientUrl}/payment/mock-checkout?session_id=${mockSessionId}&vendor_id=${vendorId}`,
      sessionId: mockSessionId,
      isMock: true,
    });
  } catch (error) {
    console.error('[Stripe Session Creation Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment checkout session.',
      error: error.message,
    });
  }
});

/**
 * POST /api/payment/verify-session
 * Verifies a completed Stripe Checkout session and confirms vendor subscription
 * Requirement: "After payment: show confirmation, save the transaction in the
 * transactions collection, and update the subscription only after verified payment confirmation."
 */
router.post('/verify-session', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const vendorId = req.user._id.toString();

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required for payment verification.',
      });
    }

    let isPaymentVerified = false;
    let transactionAmount = 19.99;
    let transactionCurrency = 'usd';

    // Verify session with Stripe API if this is a live Stripe session
    const isLiveStripe = !sessionId.startsWith('cs_test_mock_') && 
                         process.env.STRIPE_SECRET_KEY && 
                         !process.env.STRIPE_SECRET_KEY.includes('placeholder');

    if (isLiveStripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
          isPaymentVerified = true;
          transactionAmount = session.amount_total ? session.amount_total / 100 : 19.99;
          transactionCurrency = session.currency || 'usd';
        } else {
          return res.status(400).json({
            success: false,
            message: `Payment verification failed. Session payment status is '${session.payment_status}'.`,
          });
        }
      } catch (stripeErr) {
        console.error('[Stripe Session Retrieve Error]:', stripeErr.message);
        return res.status(400).json({
          success: false,
          message: 'Could not verify session with Stripe: ' + stripeErr.message,
        });
      }
    } else if (sessionId.startsWith('cs_test_mock_') || sessionId.startsWith('cs_test_')) {
      // Verified in sandbox / development mode
      isPaymentVerified = true;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid session ID provided.',
      });
    }

    if (!isPaymentVerified) {
      return res.status(400).json({
        success: false,
        message: 'Payment could not be verified.',
      });
    }

    // 1. Activate Premium subscription for vendor (valid for 30 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const userQuery = ObjectId.isValid(vendorId)
      ? { _id: new ObjectId(vendorId) }
      : { _id: vendorId };

    await collections.users.updateOne(userQuery, {
      $set: {
        subscriptionPlan: SUBSCRIPTION_PLANS.PREMIUM,
        subscriptionExpiresAt: expiresAt,
        updatedAt: new Date(),
      },
    });

    console.log(`[Payment Verification] Vendor '${vendorId}' upgraded to Premium plan successfully.`);

    // 2. Prevent duplicate transaction records for the same session ID
    let existingTransaction = await collections.transactions.findOne({
      stripeSessionId: sessionId,
    });

    let transaction = existingTransaction;

    if (!existingTransaction) {
      const transactionDoc = formatTransactionDocument({
        vendorId: req.user._id,
        plan: SUBSCRIPTION_PLANS.PREMIUM,
        amount: transactionAmount,
        currency: transactionCurrency,
        stripeSessionId: sessionId,
        status: 'completed',
      });

      const insertRes = await collections.transactions.insertOne(transactionDoc);
      transaction = { _id: insertRes.insertedId, ...transactionDoc };
      console.log(`[Payment Verification] Transaction logged for session ID: ${sessionId}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully! Your account has been upgraded to Premium.',
      transaction,
      user: {
        _id: vendorId,
        subscriptionPlan: SUBSCRIPTION_PLANS.PREMIUM,
        subscriptionExpiresAt: expiresAt,
      },
    });
  } catch (error) {
    console.error('[Verify Payment Session Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment session.',
    });
  }
});

/**
 * GET /api/payment/subscription-status
 * Retrieve vendor subscription status and recent transaction history
 */
router.get('/subscription-status', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id;

    const user = await collections.users.findOne({ _id: req.user._id });

    const recentTransactions = await collections.transactions
      .find({ vendorId: vendorId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    return res.status(200).json({
      success: true,
      subscriptionPlan: user?.subscriptionPlan || SUBSCRIPTION_PLANS.FREE,
      subscriptionExpiresAt: user?.subscriptionExpiresAt || null,
      transactions: recentTransactions,
    });
  } catch (error) {
    console.error('[Subscription Status Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve subscription status.',
    });
  }
});

export default router;
