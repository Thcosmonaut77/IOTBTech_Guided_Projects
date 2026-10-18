'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { BookOpen, Plus, FileText, Scale, BarChart3 } from 'lucide-react';

type Tab = 'accounts' | 'journals' | 'trial' | 'pnl';

export default function GLPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('accounts');
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [accs, jns, tb, pl] = await Promise.all([
        api.gl.accounts.list(),
        api.gl.journalEntries.list(),
        api.gl.trialBalance(),
        api.gl.profitAndLoss(),
      ]);
      setAccounts(accs);
      setJournals(jns);
      setTrialBalance(tb);
      setPnl(pl);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleCreateAccount = async () => {
    try {
      await api.gl.accounts.create(formData);
      setShowForm(false);
      setFormData({});
      fetchData();
    } catch (err: any) { alert(err.message); }
  };

  const tabs = [
    { key: 'accounts' as Tab, label: 'Chart of Accounts', icon: BookOpen },
    { key: 'journals' as Tab, label: 'Journal Entries', icon: FileText },
    { key: 'trial' as Tab, label: 'Trial Balance', icon: Scale },
    { key: 'pnl' as Tab, label: 'P&L Statement', icon: BarChart3 },
  ];

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">General Ledger</h1>
        {tab === 'accounts' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Account
          </button>
        )}
        {tab === 'journals' && (
          <button onClick={() => router.push('/gl/journal/new')} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Journal Entry
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-6 bg-white rounded-lg border border-gray-200 p-1">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {showForm && tab === 'accounts' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="Account Code" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, code: e.target.value})} />
            <input placeholder="Account Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, name: e.target.value})} />
            <select className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, type: e.target.value})}>
              <option value="">Select Type</option>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateAccount} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <DataTable columns={[
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type', render: (v: string) => <span className="capitalize">{v}</span> },
          { key: 'balance', label: 'Balance', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'isActive', label: 'Status', render: (v: boolean) => v ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-red-600 text-xs font-medium">Inactive</span> },
        ]} data={accounts} />
      )}

      {tab === 'journals' && (
        <DataTable columns={[
          { key: 'entryNumber', label: 'Entry #' },
          { key: 'entryDate', label: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
          { key: 'description', label: 'Description' },
          { key: 'totalDebit', label: 'Total Debit', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'totalCredit', label: 'Total Credit', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'status', label: 'Status', render: (v: string) => <span className={`capitalize text-xs font-medium px-2 py-1 rounded-full ${v === 'posted' ? 'bg-green-100 text-green-700' : v === 'approved' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{v}</span> },
        ]} data={journals} />
      )}

      {tab === 'trial' && trialBalance && (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard title="Total Debits" value={`$${Number(trialBalance.totalDebit).toLocaleString()}`} />
            <StatCard title="Total Credits" value={`$${Number(trialBalance.totalCredit).toLocaleString()}`} />
          </div>
          <DataTable columns={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Account' },
            { key: 'type', label: 'Type', render: (v: string) => <span className="capitalize">{v}</span> },
            { key: 'balance', label: 'Balance', render: (v: number) => `$${Number(v).toLocaleString()}` },
          ]} data={trialBalance.accounts} />
        </div>
      )}

      {tab === 'pnl' && pnl && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard title="Total Revenue" value={`$${Number(pnl.revenue.total).toLocaleString()}`} icon={<BarChart3 />} />
            <StatCard title="Total Expenses" value={`$${Number(pnl.expenses.total).toLocaleString()}`} />
            <StatCard title="Net Income" value={`$${Number(pnl.netIncome).toLocaleString()}`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3 text-gray-700">Revenue</h3>
              <DataTable columns={[
                { key: 'name', label: 'Account' },
                { key: 'balance', label: 'Amount', render: (v: number) => `$${Number(v).toLocaleString()}` },
              ]} data={pnl.revenue.accounts} />
            </div>
            <div>
              <h3 className="font-semibold mb-3 text-gray-700">Expenses</h3>
              <DataTable columns={[
                { key: 'name', label: 'Account' },
                { key: 'balance', label: 'Amount', render: (v: number) => `$${Number(v).toLocaleString()}` },
              ]} data={pnl.expenses.accounts} />
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
