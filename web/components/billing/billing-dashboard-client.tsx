'use client';

import { useState } from 'react';
import { STRIPE_PRICING } from '@/lib/stripe';
import { CheckoutButton } from './checkout-button';

interface BillingDashboardProps {
  initialData: {
    user: any;
    tier: 'free' | 'pro' | 'enterprise';
    analysesUsed: number;
    analysesLimit: number | null;
    usageStats: Record<string, number>;
    invoices: any[];
  };
}

export function BillingDashboardClient({ initialData }: BillingDashboardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const tierConfig = STRIPE_PRICING[initialData.tier as keyof typeof STRIPE_PRICING] || STRIPE_PRICING.free;
  const usagePercent =
    initialData.analysesLimit && initialData.analysesLimit > 0
      ? (initialData.analysesUsed / initialData.analysesLimit) * 100
      : 0;

  const isNearLimit = usagePercent >= 80 && usagePercent < 100;
  const isAtLimit = usagePercent >= 100;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Billing & Account</h1>
        <p className="text-slate-600">Manage your subscription and usage</p>
      </div>

      {/* Current Plan Card */}
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Plan Info */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Current Plan
            </h2>
            <p className="text-4xl font-bold text-slate-900 mb-2">
              {initialData.tier === 'free' ? 'Free' : 'Pro'}
            </p>
            <p className="text-slate-600 mb-4">
              {tierConfig.price === 0 ? 'Always free' : `$${(tierConfig.price / 100).toFixed(2)}/month`}
            </p>
            {initialData.tier === 'free' && (
              <CheckoutButton
                email={initialData.user.email}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
              />
            )}
            {initialData.tier === 'pro' && (
              <button
                disabled
                className="px-4 py-2 bg-green-500 text-white rounded-lg font-semibold cursor-default"
              >
                ✓ Active
              </button>
            )}
          </div>

          {/* Analyses Usage */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Analyses This Month
            </h2>
            <p className="text-4xl font-bold text-slate-900 mb-2">
              {initialData.analysesUsed}
              {initialData.analysesLimit && ` / ${initialData.analysesLimit}`}
            </p>
            {initialData.analysesLimit && (
              <>
                <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      isAtLimit
                        ? 'bg-red-500'
                        : isNearLimit
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  />
                </div>
                <p className={`text-sm ${isAtLimit ? 'text-red-600' : isNearLimit ? 'text-yellow-600' : 'text-slate-600'}`}>
                  {isAtLimit && '⚠️ Quota exceeded'}
                  {isNearLimit && !isAtLimit && '⚠️ Nearing limit'}
                  {!isAtLimit && !isNearLimit && `${100 - Math.round(usagePercent)}% remaining`}
                </p>
              </>
            )}
            {!initialData.analysesLimit && (
              <p className="text-sm text-green-600">Unlimited analyses</p>
            )}
          </div>

          {/* Features */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Available Features
            </h2>
            <ul className="space-y-2">
              {tierConfig.features.analyses && (
                <li className="flex items-center text-slate-700">
                  <span className="mr-2 text-green-500">✓</span>
                  Content Analysis
                </li>
              )}
              {tierConfig.features.search && (
                <li className="flex items-center text-slate-700">
                  <span className="mr-2 text-green-500">✓</span>
                  Semantic Search
                </li>
              )}
              {tierConfig.features.export && (
                <li className="flex items-center text-slate-700">
                  <span className="mr-2 text-green-500">✓</span>
                  Export & Download
                </li>
              )}
              {tierConfig.features.apiAccess && (
                <li className="flex items-center text-slate-700">
                  <span className="mr-2 text-green-500">✓</span>
                  API Access
                </li>
              )}
              <li className="text-sm text-slate-500 mt-2 pt-2 border-t border-slate-200">
                {tierConfig.features.historyRetention}-day history
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Usage Statistics */}
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Usage Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-600 mb-1">Analyses Created</p>
            <p className="text-2xl font-bold text-slate-900">
              {initialData.usageStats['analysis_created'] || 0}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-600 mb-1">Searches Performed</p>
            <p className="text-2xl font-bold text-slate-900">
              {initialData.usageStats['search'] || 0}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-600 mb-1">Exports Downloaded</p>
            <p className="text-2xl font-bold text-slate-900">
              {initialData.usageStats['export'] || 0}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-600 mb-1">API Calls Made</p>
            <p className="text-2xl font-bold text-slate-900">
              {initialData.usageStats['api_call'] || 0}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice History */}
      {initialData.tier === 'pro' && initialData.invoices.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Invoice History</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Amount</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {initialData.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="py-3 px-4 text-slate-700">
                      {invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      ${(invoice.amount / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                          invoice.status === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : invoice.status === 'draft'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {invoice.status === 'paid' ? '✓ Paid' : invoice.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {invoice.invoiceUrl && (
                        <a
                          href={invoice.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account Info */}
      <div className="bg-white rounded-lg shadow-md p-8 mt-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Account Information</h2>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-600">Email Address</p>
            <p className="text-slate-900 font-medium">{initialData.user.email}</p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Name</p>
            <p className="text-slate-900 font-medium">{initialData.user.name || 'Not set'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Member Since</p>
            <p className="text-slate-900 font-medium">
              {new Date(initialData.user.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
