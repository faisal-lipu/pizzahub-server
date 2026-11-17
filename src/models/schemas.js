/**
 * PizzaHub Schema Definitions and Constants
 * strictly aligned with Assignment 9 requirements
 */

export const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  VENDOR: 'vendor',
  ADMIN: 'admin',
});

export const MENU_CATEGORIES = Object.freeze([
  'Classic Pizzas',
  'Vegetarian Pizzas',
  'Meat Lovers',
  'Specialty / Gourmet Pizzas',
  'Sides & Appetizers',
  'Beverages & Desserts',
]);

export const MENU_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  INACTIVE: 'inactive',
});

export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

export const SUBSCRIPTION_PLANS = Object.freeze({
  FREE: 'free',
  PREMIUM: 'premium',
});

/**
 * Validates and formats user document fields
 */
export function formatUserDocument(data) {
  const role = [ROLES.VENDOR, ROLES.CUSTOMER].includes(data.role)
    ? data.role
    : ROLES.CUSTOMER;

  return {
    name: data.name?.trim(),
    email: data.email?.toLowerCase().trim(),
    image: data.image || null,
    role: role,
    isBlocked: Boolean(data.isBlocked || false),
    businessName: role === ROLES.VENDOR ? (data.businessName?.trim() || '') : null,
    subscriptionPlan: SUBSCRIPTION_PLANS.FREE,
    subscriptionExpiresAt: null,
    createdAt: data.createdAt || new Date(),
  };
}

/**
 * Validates and formats menu item document fields
 */
export function formatMenuItemDocument(data, vendorId) {
  if (!data.itemName || !data.category || data.price === undefined || !data.location) {
    throw new Error('Missing required fields for menu item (itemName, category, price, location).');
  }

  const images = Array.isArray(data.images)
    ? data.images
    : data.image
    ? [data.image]
    : [];

  return {
    vendorId, // ObjectId or string ref to users collection
    itemName: data.itemName.trim(),
    category: data.category.trim(),
    description: data.description?.trim() || '',
    price: Number(data.price),
    location: data.location.trim(),
    images: images,
    status: MENU_STATUS.PENDING, // Default status pending until approved by admin
    createdAt: new Date(),
  };
}

/**
 * Validates and formats customer order document fields
 */
export function formatOrderDocument({ itemId, vendorId, customerId, deliveryDate, deliveryAddress, message }) {
  if (!itemId || !vendorId || !customerId || !deliveryDate || !deliveryAddress) {
    throw new Error('Missing required fields for order submission.');
  }

  return {
    itemId,
    vendorId,
    customerId,
    deliveryDate: new Date(deliveryDate).toISOString().split('T')[0], // normalize date
    deliveryAddress: deliveryAddress.trim(),
    message: message?.trim() || '',
    status: ORDER_STATUS.PENDING, // Default status pending
    createdAt: new Date(),
  };
}

/**
 * Validates and formats subscription transaction document fields
 */
export function formatTransactionDocument({ vendorId, plan, amount, currency, stripeSessionId, stripeSubscriptionId, status }) {
  return {
    vendorId,
    plan: plan || SUBSCRIPTION_PLANS.PREMIUM,
    amount: Number(amount),
    currency: (currency || 'usd').toLowerCase(),
    stripeSessionId,
    stripeSubscriptionId: stripeSubscriptionId || null,
    status: status || 'completed',
    createdAt: new Date(),
  };
}
