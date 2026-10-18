'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { Plus, Wallet } from 'lucide-react';

type Tab = 'accounts' | 'transactions' | 'position';

export default function CashPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('accounts');
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [position, setPosition] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [a, t, p] = await Promise.all([
        api.cash.accounts.list(),
        api.cash.transactions.list(),
        api.cash.position(),
      ]);
      setAccounts(a);
      setTransactions(t);
      setPosition(p);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleCreateAccount = async () => {
    try {
      await api.cash.accounts.create(formData);
      setShowForm(false);
      setFormData({});
      fetchData();
    } catch (err: any) { alert(err.message); }
  };

  const tabs = [
    { key: 'position' as Tab, label: 'Cash Position' },
    { key: 'accounts' as Tab, label: 'Bank Accounts' },
    { key: 'transactions' as Tab, label: 'Transactions' },
  ];

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Cash Management</h1>
        {tab === 'accounts' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Account
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-6 bg-white rounded-lg border border-gray-200 p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {showForm && tab === 'accounts' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New Bank Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="Account Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, accountName: e.target.value})} />
            <input placeholder="Account Number" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, accountNumber: e.target.value})} />
            <input placeholder="Bank Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, bankName: e.target.value})} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateAccount} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'position' && position && (
        <div>
          <StatCard
            title="Total Cash Position"
            value={`$${Number(position.totalBalance).toLocaleString()}`}
            icon={<Wallet size={24} />}
            subtitle={`As of ${new Date(position.reportDate).toLocaleDateString()}`}
          />
          <div className="mt-6">
            <h3 className="font-semibold mb-3">Account Breakdown</h3>
            <DataTable columns={[
              { key: 'accountName', label: 'Account' },
              { key: 'accountNumber', label: 'Number' },
              { key: 'bankName', label: 'Bank' },
              { key: 'currentBalance', label: 'Balance', render: (v: number) => `$${Number(v).toLocaleString()}` },
            ]} data={position.accounts} />
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <DataTable columns={[
          { key: 'accountName', label: 'Account Name' },
          { key: 'accountNumber', label: 'Account #' },
          { key: 'bankName', label: 'Bank' },
          { key: 'currency', label: 'Currency' },
          { key: 'currentBalance', label: 'Balance', render: (v: number) => `$${Number(v).toLocaleString()}` },
        ]} data={accounts} />
      )}

      {tab === 'transactions' && (
        <DataTable columns={[
          { key: 'transactionDate', label: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
          { key: 'type', label: 'Type', render: (v: string) => <span className={`capitalize text-xs px-2 py-1 rounded-full ${v === 'inflow' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{v}</span> },
          { key: 'amount', label: 'Amount', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' },
        ]} data={transactions} />
      )}
    </AppLayout>
  );
}
