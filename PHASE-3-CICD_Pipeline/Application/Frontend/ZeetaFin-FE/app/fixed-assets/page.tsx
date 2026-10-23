'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

type Tab = 'register' | 'schedule';

export default function FixedAssetsPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('register');
  const [register, setRegister] = useState<any>(null);
  const [schedule, setSchedule] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [r, s] = await Promise.all([
        api.fixedAssets.register(),
        api.fixedAssets.depreciationSchedule(),
      ]);
      setRegister(r);
      setSchedule(s);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleCreateAsset = async () => {
    try {
      await api.fixedAssets.create(formData);
      setShowForm(false);
      setFormData({});
      fetchData();
    } catch (err: any) { alert(err.message); }
  };

  const tabs = [
    { key: 'register' as Tab, label: 'Asset Register' },
    { key: 'schedule' as Tab, label: 'Depreciation Schedule' },
  ];

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Fixed Asset Management</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          <Plus size={16} /> New Asset
        </button>
      </div>

      <div className="flex gap-1 mb-6 bg-white rounded-lg border border-gray-200 p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New Fixed Asset</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="Asset Code" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, assetCode: e.target.value})} />
            <input placeholder="Asset Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, name: e.target.value})} />
            <input placeholder="Category" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, category: e.target.value})} />
            <input placeholder="Purchase Cost" type="number" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, purchaseCost: parseFloat(e.target.value)})} />
            <input placeholder="Useful Life (Years)" type="number" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, usefulLifeYears: parseInt(e.target.value)})} />
            <input placeholder="Location" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, location: e.target.value})} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateAsset} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'register' && register && (
        <div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <StatCard title="Total Assets" value={register.summary.assetCount} />
            <StatCard title="Total Cost" value={`$${Number(register.summary.totalCost).toLocaleString()}`} />
            <StatCard title="Total Depreciation" value={`$${Number(register.summary.totalDepreciation).toLocaleString()}`} />
            <StatCard title="Net Book Value" value={`$${Number(register.summary.totalNetBookValue).toLocaleString()}`} />
          </div>
          <DataTable columns={[
            { key: 'assetCode', label: 'Code' },
            { key: 'name', label: 'Name' },
            { key: 'category', label: 'Category' },
            { key: 'location', label: 'Location' },
            { key: 'purchaseCost', label: 'Cost', render: (v: number) => `$${Number(v).toLocaleString()}` },
            { key: 'accumulatedDepreciation', label: 'Depreciation', render: (v: number) => `$${Number(v).toLocaleString()}` },
            { key: 'netBookValue', label: 'NBV', render: (v: number) => `$${Number(v).toLocaleString()}` },
            { key: 'status', label: 'Status', render: (v: string) => <span className="capitalize text-xs">{v}</span> },
          ]} data={register.assets} />
        </div>
      )}

      {tab === 'schedule' && (
        <DataTable columns={[
          { key: 'asset', label: 'Asset', render: (_: any, row: any) => `${row.asset?.code} - ${row.asset?.name}` },
          { key: 'purchaseCost', label: 'Cost', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'usefulLife', label: 'Life (yrs)' },
          { key: 'method', label: 'Method', render: (v: string) => <span className="capitalize">{v?.replace('_', ' ')}</span> },
          { key: 'accumulatedDepreciation', label: 'Accum. Depr.', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'netBookValue', label: 'NBV', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'annualDepreciation', label: 'Annual Depr.', render: (v: number) => `$${Number(v).toLocaleString()}` },
        ]} data={schedule} />
      )}
    </AppLayout>
  );
}
