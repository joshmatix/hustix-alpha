'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null
  );

  useEffect(() => {
    async function getProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('full_name, firm_name')
          .eq('id', user.id)
          .single();

        if (data) {
          setFullName(data.full_name || '');
          setFirmName(data.firm_name || '');
        }
      }
      setLoading(false);
    }

    getProfile();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatusMessage({ text: 'Error: User not authenticated.', type: 'error' });
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      firm_name: firmName,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setStatusMessage({ text: `Update failed: ${error.message}`, type: 'error' });
    } else {
      setStatusMessage({ text: 'Profile updated successfully!', type: 'success' });
    }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Advisor Settings</h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your personal profile and wealth advisory firm configuration.
        </p>
      </div>

      <Card
        title="Advisor Profile Info"
        subtitle="This information is used across client reports and risk summaries."
      >
        {loading ? (
          <div className="py-8 text-center text-slate-400 text-sm">Loading profile data...</div>
        ) : (
          <form onSubmit={handleUpdateProfile} className="space-y-4 mt-2">
            <Input
              label="Full Name"
              placeholder="e.g. Sarah Jenkins"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <Input
              label="Firm / Advisory Name"
              placeholder="e.g. Apex Wealth Management"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
            />

            <div className="pt-2 flex items-center justify-between">
              <Button type="submit" isLoading={saving}>
                Save Settings
              </Button>

              {statusMessage && (
                <span
                  className={`text-xs font-semibold ${
                    statusMessage.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {statusMessage.text}
                </span>
              )}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
