'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { BookOpen, CreditCard, Receipt, Wallet, TrendingUp, DollarSign } from 'lucide-react';

export default function DashboardPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api.gl.trialBalance().catch(() => null),
      api.cash.position().catch(() => null),
      api.ap.aging().catch(() => null),
      api.ar.aging().catch(() => null),
    ]).then(([tb, cash, apAging, arAging]) => {
      setStats({ tb, cash, apAging, arAging });
    });
  }, [token]);

  if (isLoading) return null;

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Cash Balance"
          value={stats.cash ? `$${Number(stats.cash.totalBalance).toLocaleString()}` : '-'}
          icon={<DollarSign size={24} />}
        />
        <StatCard
          title="AP Outstanding"
          value={stats.apAging ? `$${Number(stats.apAging.totalOutstanding).toLocaleString()}` : '-'}
          icon={<CreditCard size={24} />}
          subtitle="Accounts Payable"
        />
        <StatCard
          title="AR Outstanding"
          value={stats.arAging ? `$${Number(stats.arAging.totalOutstanding).toLocaleString()}` : '-'}
          icon={<Receipt size={24} />}
          subtitle="Accounts Receivable"
        />
        <StatCard
          title="Trial Balance"
          value={stats.tb ? `$${Number(stats.tb.totalDebit).toLocaleString()}` : '-'}
          icon={<BookOpen size={24} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => router.push('/gl')} className="p-4 bg-primary-50 rounded-lg text-primary-700 hover:bg-primary-100 text-sm font-medium text-left">
              <BookOpen size={20} className="mb-2" />
              New Journal Entry
            </button>
            <button onClick={() => router.push('/ap')} className="p-4 bg-blue-50 rounded-lg text-blue-700 hover:bg-blue-100 text-sm font-medium text-left">
              <CreditCard size={20} className="mb-2" />
              New AP Invoice
            </button>
            <button onClick={() => router.push('/ar')} className="p-4 bg-green-50 rounded-lg text-green-700 hover:bg-green-100 text-sm font-medium text-left">
              <Receipt size={20} className="mb-2" />
              New AR Invoice
            </button>
            <button onClick={() => router.push('/cash')} className="p-4 bg-amber-50 rounded-lg text-amber-700 hover:bg-amber-100 text-sm font-medium text-left">
              <Wallet size={20} className="mb-2" />
              Cash Position
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">AP Aging Summary</h2>
          {stats.apAging?.buckets ? (
            <div className="space-y-3">
              {Object.entries(stats.apAging.buckets).map(([bucket, amount]) => (
                <div key={bucket}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{bucket} days</span>
                    <span className="font-medium">${Number(amount).toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-primary-500 rounded-full h-2"
                      style={{ width: `${stats.apAging.totalOutstanding > 0 ? (Number(amount) / stats.apAging.totalOutstanding) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Loading...</p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
