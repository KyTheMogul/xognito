'use client';

import { useState } from 'react';
import { generateRedeemCodes } from '../../lib/redeemCode';
import { useAuth } from '../../lib/auth';

export default function RedeemCodesAdmin() {
  const [count, setCount] = useState(1);
  const [plan, setPlan] = useState<'pro' | 'pro_plus'>('pro');
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();

  const handleGenerateCodes = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const codes = await generateRedeemCodes(count, plan, expiresInDays);
      setGeneratedCodes(codes);
    } catch (error) {
      console.error('Error generating codes:', error);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <h1 className="text-2xl font-bold mb-6">Generate Redeem Codes</h1>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Number of Codes
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Plan Type
              </label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as 'pro' | 'pro_plus')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="pro">Pro Plan</option>
                <option value="pro_plus">Pro Plus Plan</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Expires In (Days)
              </label>
              <input
                type="number"
                min="1"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>

            <button
              onClick={handleGenerateCodes}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? 'Generating...' : 'Generate Codes'}
            </button>

            {generatedCodes.length > 0 && (
              <div className="mt-6">
                <h2 className="text-lg font-semibold mb-4">Generated Codes</h2>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    {generatedCodes.map((code) => (
                      <div
                        key={code}
                        className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-lg"
                      >
                        <span className="font-mono">{code}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(code)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 