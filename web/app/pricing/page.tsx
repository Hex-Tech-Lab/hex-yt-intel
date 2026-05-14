import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { PricingTableClient } from '@/components/billing/pricing-table-client';

async function getUserTier() {
  const session = await getServerSession(authConfig);
  if (!session?.user) return null;

  const userId = (session.user as any).id;
  return { userId, userEmail: session.user.email };
}

export default async function PricingPage() {
  const userInfo = await getUserTier();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="pt-12 pb-8 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-white mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-slate-300">
            Choose the perfect plan for your YouTube content intelligence needs
          </p>
        </div>
      </div>

      {/* Pricing Table */}
      <div className="max-w-6xl mx-auto px-4 py-12">
        <PricingTableClient
          userInfo={userInfo}
        />
      </div>

      {/* FAQ Section */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-3xl font-bold text-white mb-8 text-center">
          Frequently Asked Questions
        </h2>

        <div className="space-y-6">
          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Can I change my plan anytime?
            </h3>
            <p className="text-slate-300">
              Yes! You can upgrade to Pro or downgrade to Free anytime. Changes take effect immediately.
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Do you offer refunds?
            </h3>
            <p className="text-slate-300">
              We offer a 7-day money-back guarantee on all Pro subscriptions. If you&apos;re not satisfied, we&apos;ll refund your first month.
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              What payment methods do you accept?
            </h3>
            <p className="text-slate-300">
              We accept all major credit cards (Visa, Mastercard, American Express) via Stripe.
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              How often will I be charged?
            </h3>
            <p className="text-slate-300">
              Pro subscriptions renew monthly. You&apos;ll receive an invoice 3 days before the renewal date.
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Is there a discount for annual billing?
            </h3>
            <p className="text-slate-300">
              Currently we offer monthly billing. Annual plans coming soon with 20% discount.
            </p>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Do you offer team or enterprise plans?
            </h3>
            <p className="text-slate-300">
              Yes! Contact us at team@hex-tech-lab.com for custom team and enterprise pricing.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 py-12 px-4 mt-12">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to get started?
          </h2>
          <p className="text-blue-100 mb-6">
            Join thousands of content creators and analysts using Hex YouTube Intelligence.
          </p>
          {userInfo ? (
            <a
              href="/app"
              className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition"
            >
              Go to Dashboard
            </a>
          ) : (
            <a
              href="/auth/signin"
              className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition"
            >
              Sign Up Now
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
