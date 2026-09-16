import type Stripe from 'stripe';
import type { Env } from '../env';
import { stripeIsLive } from '../stripe';

/** One launch plan, never a customer-supplied amount, Price or discount. */
export const LAUNCH_TERMS = {
  currency: 'myr', monthlyAmount: 19900, discountAmount: 10000, discountMonths: 3,
} as const;

export async function verifiedLaunchCatalog(env: Env, stripe: Stripe, eligible: boolean) {
  const priceId = env.STRIPE_LAUNCH_MONTHLY_PRICE;
  const productId = env.STRIPE_LAUNCH_PRODUCT;
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId) || !productId || !/^prod_[A-Za-z0-9]+$/.test(productId)) {
    throw new Error('launch catalog is not configured');
  }
  const price = await stripe.prices.retrieve(priceId, { expand: ['product', 'currency_options'] });
  const product = price.product;
  if (price.id !== priceId || price.livemode !== stripeIsLive(env) || !price.active
    || !product || typeof product === 'string' || product.deleted || !product.active
    || product.id !== productId || product.livemode !== stripeIsLive(env)
    || price.currency !== LAUNCH_TERMS.currency || price.unit_amount !== LAUNCH_TERMS.monthlyAmount
    || price.type !== 'recurring' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1
    || price.recurring.usage_type !== 'licensed' || price.recurring.trial_period_days || price.billing_scheme !== 'per_unit'
    || price.transform_quantity || price.custom_unit_amount
    || (price.currency_options && (Object.keys(price.currency_options).some(currency => currency !== 'myr')
      || (price.currency_options.myr && price.currency_options.myr.unit_amount !== LAUNCH_TERMS.monthlyAmount)))) {
    throw new Error('launch monthly price does not match the advertised offer');
  }
  if (!eligible) return { priceId, discounts: [] as Stripe.Checkout.SessionCreateParams.Discount[],
    disclosure: 'RM199/month. The introductory offer is for first purchases only.' };
  const couponId = env.STRIPE_LAUNCH_COUPON;
  if (!couponId) throw new Error('launch discount is not configured');
  const coupon = await stripe.coupons.retrieve(couponId, { expand: ['applies_to', 'currency_options'] });
  if (coupon.id !== couponId || coupon.livemode !== stripeIsLive(env) || !coupon.valid
    || coupon.currency !== 'myr' || coupon.amount_off !== LAUNCH_TERMS.discountAmount || coupon.percent_off !== null
    || coupon.duration !== 'repeating' || coupon.duration_in_months !== LAUNCH_TERMS.discountMonths
    || coupon.applies_to?.products.length !== 1 || coupon.applies_to.products[0] !== productId
    || (coupon.currency_options && (Object.keys(coupon.currency_options).some(currency => currency !== 'myr')
      || (coupon.currency_options.myr && coupon.currency_options.myr.amount_off !== LAUNCH_TERMS.discountAmount)))) {
    throw new Error('launch discount does not match the advertised offer');
  }
  return { priceId, discounts: [{ coupon: couponId }],
    disclosure: 'RM99/month for your first 3 monthly billing periods, then RM199/month from month 4. Cancel future renewals in your billing portal.' };
}
