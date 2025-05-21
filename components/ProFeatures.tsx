import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { 
  hasProPlan, 
  getUserSettings, 
  updateUserSettings,
  type UserSettings 
} from '@/lib/subscription';

export default function ProFeatures() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkProStatus = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const proStatus = await hasProPlan(user.uid);
      setIsPro(proStatus);

      if (proStatus) {
        const userSettings = await getUserSettings(user.uid);
        setSettings(userSettings);
      }

      setLoading(false);
    };

    checkProStatus();
  }, []);

  const handleSettingChange = async (key: keyof UserSettings, value: any) => {
    const user = auth.currentUser;
    if (!user || !settings) return;

    const newSettings = { ...settings, [key]: value };
    const success = await updateUserSettings(user.uid, { [key]: value });
    
    if (success) {
      setSettings(newSettings);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isPro) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Pro Features</h2>
        <p className="text-gray-600 mb-4">
          Upgrade to Pro to unlock these features:
        </p>
        <ul className="space-y-2">
          <li className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            Unlimited AI Conversations
          </li>
          <li className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            AI Memory
          </li>
          <li className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            File Upload & Analysis
          </li>
          <li className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            Real-Time Web Search
          </li>
          <li className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            Assistant Customization
          </li>
        </ul>
        <button
          onClick={() => window.location.href = '/pricing'}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Upgrade to Pro
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Pro Settings</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assistant Name
          </label>
          <input
            type="text"
            value={settings?.assistantName || ''}
            onChange={(e) => handleSettingChange('assistantName', e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assistant Tone
          </label>
          <select
            value={settings?.assistantTone || 'professional'}
            onChange={(e) => handleSettingChange('assistantTone', e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Features
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings?.memoryEnabled ?? true}
                onChange={(e) => handleSettingChange('memoryEnabled', e.target.checked)}
                className="mr-2"
              />
              AI Memory
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings?.webSearchEnabled ?? true}
                onChange={(e) => handleSettingChange('webSearchEnabled', e.target.checked)}
                className="mr-2"
              />
              Real-Time Web Search
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings?.fileUploadEnabled ?? true}
                onChange={(e) => handleSettingChange('fileUploadEnabled', e.target.checked)}
                className="mr-2"
              />
              File Upload & Analysis
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings?.exportEnabled ?? true}
                onChange={(e) => handleSettingChange('exportEnabled', e.target.checked)}
                className="mr-2"
              />
              Chat Export
            </label>
          </div>
        </div>
      </div>
    </div>
  );
} 