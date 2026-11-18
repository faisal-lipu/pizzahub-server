import express from 'express';
import Stripe from 'stripe';
import { collections } from '../config/db.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import { verifyVendor } from '../middlewares/verifyRole.js';
import { SUBSCRIPTION_PLANS } from '../models/schemas.js';

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

/**
 * POST /api/payment/create-checkout-session
 * Create a Stripe Checkout Session for vendor Premium subscription upgrade
 * Rule: Only authenticated vendors can upgrade; customers and admins cannot access
 */
router.post('/create-checkout-session', verifyToken, verifyVendor, async (req, res) => {
  try {
    const vendorId = req.user._id;
    const vendorEmail = req.user.email;

    // Rule: Check if vendor is already on the Premium plan
    if (req.user.subscriptionPlan === SUBSCRIPTION_PLANS.PREMIUM) {
      return res.status(400).json({
        success: false,
        message: 'Your account is already on the Premium subscription plan.',
      });
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

    // Create Stripe Checkout Session
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
              description: 'Unlock unlimited menu items, premium vendor badge, and featured homepage placement.',
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
