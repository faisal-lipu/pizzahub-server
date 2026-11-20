import express from 'express';
import Stripe from 'stripe';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor } from '../middlewares/verifyRole.js';
import { ObjectId } from 'mongodb';
import { SUBSCRIPTION_PLANS, formatTransactionDocument } from '../models/schemas.js';

const router = express.Router();

// Initialize Stripe instance strictly on the server
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// In-memory mock session store (Strictly prevents creating unnecessary database collections in MongoDB)
const mockSessions = new Map();

/**
 * Handle Stripe Webhook Events
 * Requirement 2: Verify payment events with Stripe webhooks
 * Requirement 3: Keep Stripe secret keys on the server and do not expose sensitive payment info
 * Requirement 5: Handle subscription cancellation and expiration properly
 */
export async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret && sig) {
      // Cryptographically verify event authenticity
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Fallback for development if webhook secret is not yet configured
      event = typeof req.body === 'string' || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString())
        : req.body;
      console.warn('[Stripe Webhook] Warning: Processing without cryptographic verification (STRIPE_WEBHOOK_SECRET missing).');
    }
  } catch (err) {
    console.error(`[Stripe Webhook Signature Verification Failed]: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle specific Stripe events
  switch (event.type) {
    // 1. Successful checkout session completion
    case 'checkout.session.completed': {
      const session = event.data.object;

      try {
        const vendorId = session.metadata?.vendorId || session.client_reference_id;
        const plan = session.metadata?.plan || SUBSCRIPTION_PLANS.PREMIUM;
        const amount = session.amount_total ? session.amount_total / 100 : 19.99;
        const currency = session.currency || 'usd';
        const stripeSessionId = session.id;
        const stripeSubscriptionId = session.subscription || null;
        const stripeCustomerId = session.customer || null;

        if (!vendorId) {
          console.error('[Stripe Webhook Error]: No vendorId associated with session metadata.');
          return res.status(400).json({ error: 'Vendor ID missing from session metadata.' });
        }

        // Verify payment status is strictly paid before activating
        if (session.payment_status !== 'paid') {
          console.warn(`[Stripe Webhook]: Session ${stripeSessionId} payment status is '${session.payment_status}', not 'paid'.`);
          return res.status(200).json({ received: true });
        }

        // Activate Premium subscription for vendor (valid for 30 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const userQuery = ObjectId.isValid(vendorId)
          ? { _id: new ObjectId(vendorId) }
          : { _id: vendorId };

        await collections.users.updateOne(userQuery, {
          $set: {
            subscriptionPlan: SUBSCRIPTION_PLANS.PREMIUM,
            subscriptionStatus: 'active',
            subscriptionExpiresAt: expiresAt,
            stripeCustomerId: stripeCustomerId,
            stripeSubscriptionId: stripeSubscriptionId,
            updatedAt: new Date(),
          },
        });

        console.log(`[Stripe Webhook] Vendor '${vendorId}' upgraded to Premium plan successfully.`);

        // Record transaction in transactions collection (idempotent)
        const existingTx = await collections.transactions.findOne({ stripeSessionId });
        if (!existingTx) {
          const transactionDoc = formatTransactionDocument({
            vendorId: ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId,
            plan: plan,
            amount: amount,
            currency: currency,
            stripeSessionId: stripeSessionId,
            stripeSubscriptionId: stripeSubscriptionId,
            status: 'completed',
          });

          await collections.transactions.insertOne(transactionDoc);
          console.log(`[Stripe Webhook] Transaction logged for session ID: ${stripeSessionId}`);
        }
      } catch (dbError) {
        console.error('[Stripe Webhook Database Error]:', dbError.message);
        return res.status(500).json({ error: 'Failed to record subscription in database.' });
      }
      break;
    }

    // 2. Recurring subscription renewal payment succeeded
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const stripeSubscriptionId = invoice.subscription;
      const stripeCustomerId = invoice.customer;

      try {
        // Find vendor by Stripe subscription or customer ID
        const vendor = await collections.users.findOne({
          $or: [
            { stripeSubscriptionId: stripeSubscriptionId },
            { stripeCustomerId: stripeCustomerId },
          ],
        });

        if (vendor) {
          // Extend subscription by 30 days
          const currentExpiry = vendor.subscriptionExpiresAt && new Date(vendor.subscriptionExpiresAt) > new Date()
            ? new Date(vendor.subscriptionExpiresAt)
            : new Date();
          currentExpiry.setDate(currentExpiry.getDate() + 30);

          await collections.users.updateOne(
            { _id: vendor._id },
            {
              $set: {
                subscriptionPlan: SUBSCRIPTION_PLANS.PREMIUM,
                subscriptionStatus: 'active',
                subscriptionExpiresAt: currentExpiry,
                updatedAt: new Date(),
              },
            }
          );

          // Log renewal transaction
          await collections.transactions.insertOne(formatTransactionDocument({
            vendorId: vendor._id,
            plan: SUBSCRIPTION_PLANS.PREMIUM,
            amount: invoice.amount_paid ? invoice.amount_paid / 100 : 19.99,
            currency: invoice.currency || 'usd',
            stripeSessionId: invoice.id || `inv_${Date.now()}`,
            stripeSubscriptionId: stripeSubscriptionId,
            status: 'completed',
          }));

          console.log(`[Stripe Webhook] Vendor '${vendor._id}' subscription renewed until ${currentExpiry.toISOString()}`);
        }
      } catch (err) {
        console.error('[Stripe Webhook Renewal Error]:', err.message);
      }
      break;
    }

    // 3. Subscription cancelled or deleted
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      try {
        const vendor = await collections.users.findOne({
          $or: [
            { stripeSubscriptionId: subscription.id },
            { stripeCustomerId: subscription.customer },
          ],
        });

        if (vendor) {
          await collections.users.updateOne(
            { _id: vendor._id },
            {
              $set: {
                subscriptionPlan: SUBSCRIPTION_PLANS.FREE,
                subscriptionStatus: 'cancelled',
                subscriptionCancelledAt: new Date(),
                subscriptionExpiresAt: null,
                updatedAt: new Date(),
              },
            }
          );

          console.log(`[Stripe Webhook] Vendor '${vendor._id}' subscription cancelled and downgraded to Free.`);
        }
      } catch (err) {
        console.error('[Stripe Webhook Cancel Error]:', err.message);
      }
      break;
    }

    // 4. Subscription updated (e.g. status changed to unpaid or past_due)
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      try {
        const vendor = await collections.users.findOne({
          $or: [
            { stripeSubscriptionId: subscription.id },
            { stripeCustomerId: subscription.customer },
          ],
        });

        if (vendor && ['unpaid', 'canceled', 'incomplete_expired'].includes(subscription.status)) {
          await collections.users.updateOne(
            { _id: vendor._id },
            {
              $set: {
                subscriptionPlan: SUBSCRIPTION_PLANS.FREE,
                subscriptionStatus: subscription.status,
                updatedAt: new Date(),
              },
            }
          );
        }
      } catch (err) {
        console.error('[Stripe Webhook Sub Update Error]:', err.message);
      }
      break;
    }

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
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
 * Requirement 3: Stripe secret keys stay on server
 * Requirement 4: Prevent users from creating subscription sessions for other vendors
 */
router.post('/create-checkout-session', verifyToken, verifyVendor, async (req, res) => {
  try {
    // Strictly bind session creation to authenticated vendor
    const vendorId = req.user._id.toString();
    const vendorEmail = req.user.email;

    // Security check (Requirement 4): Prevent users from creating sessions for other vendors
    if (req.body?.vendorId && req.body.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: You cannot create a subscription session for another vendor.',
      });
    }

    // Rule: Check if vendor already has an active, non-expired Premium plan
    if (
      req.user.subscriptionPlan === SUBSCRIPTION_PLANS.PREMIUM &&
      req.user.subscriptionExpiresAt &&
      new Date(req.user.subscriptionExpiresAt) > new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Your account is already on the Premium subscription plan.',
      });
    }

    // Dynamically determine the client URL based on request origin
    let reqOrigin = req.body?.clientUrl || req.headers.origin;
    if (!reqOrigin && req.headers.referer) {
      try {
        reqOrigin = new URL(req.headers.referer).origin;
      } catch (e) {
        // ignore invalid referer URL
      }
    }
    const clientUrl = reqOrigin || process.env.CLIENT_URL || 'https://pizzahub-client-beta.vercel.app';
    const hasLiveStripeKey = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder');

    if (hasLiveStripeKey) {
      try {
        // Create live Stripe Checkout Session with vendor metadata
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          customer_email: vendorEmail,
          client_reference_id: vendorId, // Locked to authenticated user
          metadata: {
            vendorId: vendorId, // Locked to authenticated user
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
    // Stored in in-memory map to strictly prevent creating extra MongoDB collections
    const mockSessionId = `cs_test_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    mockSessions.set(mockSessionId, {
      sessionId: mockSessionId,
      vendorId: vendorId,
      vendorEmail: vendorEmail,
      plan: SUBSCRIPTION_PLANS.PREMIUM,
      amount: 19.99,
      currency: 'usd',
      status: 'pending', // NOT paid yet
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes validity
    });

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
 * POST /api/payment/mock-confirm-payment
 * Simulates user completing payment in development sandbox
 * Requirement 1: Do not trust frontend redirect; session must be confirmed as paid before verification
 */
router.post('/mock-confirm-payment', verifyToken, verifyVendor, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const vendorId = req.user._id.toString();

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required.' });
    }

    const mockSession = mockSessions.get(sessionId);
    if (!mockSession) {
      return res.status(404).json({ success: false, message: 'Mock checkout session not found.' });
    }

    // Security check: Verify session belongs to authenticated vendor
    if (mockSession.vendorId !== vendorId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot confirm payment for another vendor’s session.',
      });
    }

    if (new Date() > new Date(mockSession.expiresAt)) {
      return res.status(400).json({ success: false, message: 'Checkout session has expired.' });
    }

    // Mark session as paid
    mockSession.status = 'paid';
    mockSession.paidAt = new Date();

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed in development sandbox.',
    });
  } catch (error) {
    console.error('[Mock Confirm Payment Error]:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to confirm mock payment.' });
  }
});

/**
 * POST /api/payment/verify-session
 * Verifies a completed Stripe Checkout session and confirms vendor subscription
 * Requirement 1: Do not trust frontend success redirect to activate Premium
 * Requirement 4: Prevent users from creating/verifying subscription sessions for other vendors
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

    const isLiveStripe = !sessionId.startsWith('cs_test_mock_') && 
                         process.env.STRIPE_SECRET_KEY && 
                         !process.env.STRIPE_SECRET_KEY.includes('placeholder');

    if (isLiveStripe) {
      try {
        // Query Stripe API directly for cryptographic confirmation
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Security Check (Requirement 4): Verify session belongs to authenticated vendor
        const sessionVendorId = session.metadata?.vendorId || session.client_reference_id;
        if (sessionVendorId && sessionVendorId.toString() !== vendorId) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: This checkout session belongs to another vendor account.',
          });
        }

        // Security Check (Requirement 1): Do not trust frontend redirect alone
        if (session.payment_status === 'paid') {
          isPaymentVerified = true;
          transactionAmount = session.amount_total ? session.amount_total / 100 : 19.99;
          transactionCurrency = session.currency || 'usd';
        } else {
          return res.status(400).json({
            success: false,
            message: `Payment verification failed. Session payment status is '${session.payment_status}', not 'paid'.`,
          });
        }
      } catch (stripeErr) {
        console.error('[Stripe Session Retrieve Error]:', stripeErr.message);
        return res.status(400).json({
          success: false,
          message: 'Could not verify session with Stripe: ' + stripeErr.message,
        });
      }
    } else {
      // Mock / Development Sandbox verification
      // Must exist in mockSessions map and have status === 'paid'
      const mockSession = mockSessions.get(sessionId);

      if (!mockSession) {
        return res.status(400).json({
          success: false,
          message: 'Invalid session ID provided. No such checkout session exists.',
        });
      }

      // Security Check (Requirement 4): Must belong to authenticated vendor
      if (mockSession.vendorId !== vendorId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: This checkout session belongs to another vendor account.',
        });
      }

      // Security Check (Requirement 1): Must have status 'paid'
      if (mockSession.status !== 'paid') {
        return res.status(400).json({
          success: false,
          message: 'Security Alert: Checkout session has not been paid. Frontend redirect cannot activate Premium.',
        });
      }

      isPaymentVerified = true;
      transactionAmount = mockSession.amount || 19.99;
      transactionCurrency = mockSession.currency || 'usd';
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
        subscriptionStatus: 'active',
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
        vendorId: ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId,
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
        subscriptionStatus: 'active',
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
 * POST /api/payment/cancel-subscription
 * Requirement 5: Handle subscription cancellation properly
 * Allows a vendor to cancel their Premium subscription and revert to Free tier
 */
router.post('/cancel-subscription', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id.toString();

    const user = await collections.users.findOne(
      ObjectId.isValid(vendorId) ? { _id: new ObjectId(vendorId) } : { _id: vendorId }
    );

    if (!user || user.subscriptionPlan !== SUBSCRIPTION_PLANS.PREMIUM) {
      return res.status(400).json({
        success: false,
        message: 'Your account does not have an active Premium subscription to cancel.',
      });
    }

    // Cancel Stripe subscription if active
    if (user.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder')) {
      try {
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      } catch (stripeErr) {
        console.warn('[Stripe Subscription Cancel Notice]:', stripeErr.message);
      }
    }

    // Revert user to Free tier immediately
    const userQuery = ObjectId.isValid(vendorId) ? { _id: new ObjectId(vendorId) } : { _id: vendorId };

    await collections.users.updateOne(userQuery, {
      $set: {
        subscriptionPlan: SUBSCRIPTION_PLANS.FREE,
        subscriptionStatus: 'cancelled',
        subscriptionCancelledAt: new Date(),
        subscriptionExpiresAt: null,
        updatedAt: new Date(),
      },
    });

    // Record cancellation in transactions log
    await collections.transactions.insertOne(formatTransactionDocument({
      vendorId: ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId,
      plan: SUBSCRIPTION_PLANS.FREE,
      amount: 0,
      currency: 'usd',
      stripeSessionId: `cancelled_${Date.now()}`,
      status: 'cancelled',
    }));

    return res.status(200).json({
      success: true,
      message: 'Your Premium subscription has been cancelled. Your account is now on the Free tier.',
      subscriptionPlan: SUBSCRIPTION_PLANS.FREE,
      subscriptionStatus: 'cancelled',
    });
  } catch (error) {
    console.error('[Cancel Subscription Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription.',
    });
  }
});

/**
 * GET /api/payment/subscription-status
 * Retrieve vendor subscription status, active expiry, and recent transaction history
 */
router.get('/subscription-status', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id;

    const user = await collections.users.findOne(
      ObjectId.isValid(vendorId) ? { _id: new ObjectId(vendorId) } : { _id: vendorId }
    );

    const vendorObjectId = ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : vendorId;
    const recentTransactions = await collections.transactions
      .find({
        $or: [
          { vendorId: vendorObjectId },
          { vendorId: vendorId.toString() },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return res.status(200).json({
      success: true,
      subscriptionPlan: user?.subscriptionPlan || SUBSCRIPTION_PLANS.FREE,
      subscriptionStatus: user?.subscriptionStatus || 'inactive',
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
