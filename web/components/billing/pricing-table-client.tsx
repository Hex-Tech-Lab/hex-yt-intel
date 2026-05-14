'use client';

import { useState } from 'react';
import { CheckoutButton } from './checkout-button';

interface PricingTableClientProps {
  userInfo: {
    userId: string;
    userEmail: string;
  } | null;
}

export function PricingTableClient({ userInfo }: PricingTableClientProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Free Plan */}
      <div className="bg-slate-800 rounded-lg overflow-hidden hover:shadow-lg transition">
        <div className="p-8">
          <h3 className="text-2xl font-bold text-white mb-2">Free</h3>
          <p className="text-slate-400 mb-6">Perfect for getting started</p>

          <div className="mb-8">
            <span className="text-5xl font-bold text-white">$0</span>
            <span className="text-slate-400 ml-2">/month</span>
          </div>

          <button
            disabled
            className="w-full py-3 bg-slate-700 text-slate-300 rounded-lg font-semibold cursor-not-allowed mb-8"
          >
            Current Plan
          </button>

          <div className="space-y-4">
            <div className="flex items-start">
              <span className="text-green-400 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">3 Analyses/month</p>
                <p className="text-slate-400 text-sm">Analyze YouTube videos</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-gray-500 mr-3">✗</span>
              <div>
                <p className="text-slate-300 font-medium">Semantic Search</p>
                <p className="text-slate-400 text-sm">Coming with Pro</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-gray-500 mr-3">✗</span>
              <div>
                <p className="text-slate-300 font-medium">Export & Download</p>
                <p className="text-slate-400 text-sm">Pro feature</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-gray-500 mr-3">✗</span>
              <div>
                <p className="text-slate-300 font-medium">API Access</p>
                <p className="text-slate-400 text-sm">Pro feature</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-400 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">30-day History</p>
                <p className="text-slate-400 text-sm">Auto-cleanup after 30 days</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pro Plan */}
      <div className="bg-gradient-to-b from-blue-600 to-blue-700 rounded-lg overflow-hidden hover:shadow-xl transition border-2 border-blue-500">
        <div className="bg-blue-500 px-8 py-3">
          <p className="text-white font-semibold text-sm">MOST POPULAR</p>
        </div>

        <div className="p-8">
          <h3 className="text-2xl font-bold text-white mb-2">Pro</h3>
          <p className="text-blue-100 mb-6">For serious content analysts</p>

          <div className="mb-8">
            <span className="text-5xl font-bold text-white">$9</span>
            <span className="text-blue-100 ml-2">/month</span>
          </div>

          {userInfo ? (
            <CheckoutButton
              isLoading={isCheckoutLoading}
              setIsLoading={setIsCheckoutLoading}
            />
          ) : (
            <a
              href="/auth/signin"
              className="w-full inline-block text-center py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition"
            >
              Sign Up
            </a>
          )}

          <p className="text-center text-blue-100 text-sm mt-4">
            7-day free trial. Cancel anytime.
          </p>

          <div className="space-y-4 mt-8">
            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">Unlimited Analyses</p>
                <p className="text-blue-100 text-sm">Analyze as many videos as you want</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">Semantic Search</p>
                <p className="text-blue-100 text-sm">Find similar content with AI</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">Export & Download</p>
                <p className="text-blue-100 text-sm">Get reports in MD, JSON, CSV</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">API Access</p>
                <p className="text-blue-100 text-sm">100 requests/day for apps</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">1-year History</p>
                <p className="text-blue-100 text-sm">Keep your analyses forever</p>
              </div>
            </div>

            <div className="flex items-start">
              <span className="text-green-300 mr-3">✓</span>
              <div>
                <p className="text-white font-medium">Priority Support</p>
                <p className="text-blue-100 text-sm">Email support within 24 hours</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
