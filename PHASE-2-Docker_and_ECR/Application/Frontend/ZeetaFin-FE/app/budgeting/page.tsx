'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

type Tab = 'budgets' | 'variance';

export default function BudgetingPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('budgets');
  const [budgets, setBudgets] = useState([]);
  const [variance, setVariance] = useState<any>(null);
  const [selectedBudget, setSelectedBudget] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const b = await api.budgeting.budgets.list();
      setBudgets(b);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [token]);

  const fetchVariance = async (id: string) => {
    try {
      const v = await api.budgeting.variance(id);
      setVariance(v);
    } catch {}
  };

  const handleCreateBudget = async () => {
    try {
      await api.budgeting.budgets.create(formData);
      setShowForm(false);
      setFormData({});
      fetchData();
    } catch (err: any) { alert(err.message); }
  };

  const tabs = [
    { key: 'budgets' as Tab, label: 'Budgets' },
    { key: 'variance' as Tab, label: 'Variance Analysis' },
  ];

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Budgeting & Forecasting</h1>
        {tab === 'budgets' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Budget
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

      {showForm && tab === 'budgets' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New Budget</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="Budget Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, name: e.target.value})} />
            <input type="number" placeholder="Fiscal Year" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, fiscalYear: parseInt(e.target.value)})} />
            <input placeholder="Department" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, department: e.target.value})} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateBudget} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'budgets' && (
        <DataTable columns={[
          { key: 'name', label: 'Name' },
          { key: 'fiscalYear', label: 'Fiscal Year' },
          { key: 'department', label: 'Department' },
          { key: 'totalAmount', label: 'Total Budget', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'status', label: 'Status', render: (v: string) => <span className={`capitalize text-xs px-2 py-1 rounded-full ${v === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{v}</span> },
        ]} data={budgets} onRowClick={(row) => { setSelectedBudget(row.id); setTab('variance'); fetchVariance(row.id); }} />
      )}

      {tab === 'variance' && variance && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard title="Total Planned" value={`$${Number(variance.summary.totalPlanned).toLocaleString()}`} />
            <StatCard title="Total Actual" value={`$${Number(variance.summary.totalActual).toLocaleString()}`} />
            <StatCard title="Variance" value={`$${Number(variance.summary.totalVariance).toLocaleString()}`} subtitle={`${Number(variance.summary.variancePercentage).toFixed(1)}%`} />
          </div>
          <h3 className="font-semibold mb-3">{variance.budget.name} - Line Items</h3>
          <DataTable columns={[
            { key: 'accountId', label: 'Account ID' },
            { key: 'plannedAmount', label: 'Planned', render: (v: number) => `$${Number(v).toLocaleString()}` },
            { key: 'actualAmount', label: 'Actual', render: (v: number) => `$${Number(v).toLocaleString()}` },
            { key: 'variance', label: 'Variance', render: (v: number) => `$${Number(v).toLocaleString()}` },
          ]} data={variance.lines} />
        </div>
      )}
    </AppLayout>
  );
}
