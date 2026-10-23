'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

type Tab = 'customers' | 'invoices' | 'aging';

export default function ARPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [aging, setAging] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [c, i, a] = await Promise.all([
        api.ar.customers.list(),
        api.ar.invoices.list(),
        api.ar.aging(),
      ]);
      setCustomers(c);
      setInvoices(i);
      setAging(a);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleCreateCustomer = async () => {
    try {
      await api.ar.customers.create(formData);
      setShowForm(false);
      setFormData({});
      fetchData();
    } catch (err: any) { alert(err.message); }
  };

  const tabs = [
    { key: 'customers' as Tab, label: 'Customers' },
    { key: 'invoices' as Tab, label: 'Invoices' },
    { key: 'aging' as Tab, label: 'Aging Report' },
  ];

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Accounts Receivable</h1>
        {tab === 'customers' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Customer
          </button>
        )}
        {tab === 'invoices' && (
          <button onClick={() => router.push('/ar/invoices/new')} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Invoice
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

      {showForm && tab === 'customers' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New Customer</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="Customer Code" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, customerCode: e.target.value})} />
            <input placeholder="Customer Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, name: e.target.value})} />
            <input placeholder="Email" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, email: e.target.value})} />
            <input placeholder="Phone" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, phone: e.target.value})} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateCustomer} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <DataTable columns={[
          { key: 'customerCode', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'outstandingBalance', label: 'Balance', render: (v: number) => `$${Number(v).toLocaleString()}` },
        ]} data={customers} />
      )}

      {tab === 'invoices' && (
        <DataTable columns={[
          { key: 'invoiceNumber', label: 'Invoice #' },
          { key: 'customer', label: 'Customer', render: (_: any, row: any) => row.customer?.name },
          { key: 'invoiceDate', label: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
          { key: 'dueDate', label: 'Due', render: (v: string) => new Date(v).toLocaleDateString() },
          { key: 'amount', label: 'Amount', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'outstandingAmount', label: 'Outstanding', render: (v: number) => `$${Number(v).toLocaleString()}` },
          { key: 'status', label: 'Status', render: (v: string) => <span className={`capitalize text-xs px-2 py-1 rounded-full ${v === 'paid' ? 'bg-green-100 text-green-700' : v === 'sent' ? 'bg-blue-100 text-blue-700' : v === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{v}</span> },
        ]} data={invoices} />
      )}

      {tab === 'aging' && aging && (
        <div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {Object.entries(aging.buckets).map(([bucket, amount]) => (
              <StatCard key={bucket} title={`${bucket} days`} value={`$${Number(amount).toLocaleString()}`} />
            ))}
          </div>
          <StatCard title="Total AR Outstanding" value={`$${Number(aging.totalOutstanding).toLocaleString()}`} />
        </div>
      )}
    </AppLayout>
  );
}
