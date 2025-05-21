'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useRouter } from 'next/navigation';
import { sendRedeemCodesEmail } from '../../actions/email';

export default function RedeemCodesAdmin() {
  const [count, setCount] = useState(2); // Set default to 2
  const [plan, setPlan] = useState<'pro' | 'pro_plus'>('pro');
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const checkAdmin = async () => {
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().isAdmin) {
          setIsAdmin(true);
        } else {
          router.push('/dashboard');
        }
      }
    };
    checkAdmin();
  }, [user, router]);

  const handleGenerateCodes = async () => {
    if (!user || !isAdmin) return;
    setIsLoading(true);
    try {
      if (email) {
        await sendRedeemCodesEmail(email, [], plan);
        setEmailSent(true);
      }
    } catch (error) {
      console.error('Error generating codes:', error);
    }
    setIsLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

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

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address (Optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email to receive codes"
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

            {emailSent && (
              <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg">
                Codes have been sent to {email}
              </div>
            )}

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