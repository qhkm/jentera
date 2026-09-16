// Marketing terms only. This does not create a subscription or grant access.
export const launchOffer = {
  monthlyPrice: 99,
  introductoryMonths: 3,
  renewalPrice: 199,
  cta: 'Get My AI Staff — RM99',
  // Establish identity before showing an account-bound plan or checkout.
  href: '/signin',
  availability: 'Joining the waitlist is free and does not start a subscription.',
  terms: 'RM99/month for your first 3 monthly billing periods, then RM199/month from month 4. Standard AI usage included; fair-use limits apply. Review usage limits and cancellation terms before subscribing.',
} as const;

// Shared public benefits; usage restrictions belong in terms/FAQs, not this list.
export const launchPlanBenefits = [
  'Your own AI staff, available 24/7',
  'Its own dedicated computer',
  'AI usage included for day-to-day work',
  'Private WhatsApp support group',
  'Direct access to the founder',
  'Early access to new features',
] as const;
