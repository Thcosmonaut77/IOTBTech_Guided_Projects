'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import DataTable from '@/components/DataTable';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

export default function UsersPage() {
  const { token, isLoading, user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!isLoading && !token) router.push('/login');
  }, [token, isLoading, router]);

  const fetchUsers = async () => {
    if (!token) return;
    try {
      const u = await api.users.list();
      setUsers(u);
    } catch {}
  };

  useEffect(() => { fetchUsers(); }, [token]);

  const handleCreateUser = async () => {
    try {
      await api.users.create(formData);
      setShowForm(false);
      setFormData({});
      fetchUsers();
    } catch (err: any) { alert(err.message); }
  };

  if (isLoading) return null;

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
          <Plus size={16} /> New User
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold mb-4">New User</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input placeholder="First Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, firstName: e.target.value})} />
            <input placeholder="Last Name" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, lastName: e.target.value})} />
            <input placeholder="Email" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, email: e.target.value})} />
            <input type="password" placeholder="Password" className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, password: e.target.value})} />
            <select className="border rounded-lg px-3 py-2 text-sm" onChange={e => setFormData({...formData, role: e.target.value})}>
              <option value="">Select Role</option>
              <option value="finance_admin">Finance Admin</option>
              <option value="accountant">Accountant</option>
              <option value="ap_officer">AP Officer</option>
              <option value="ar_officer">AR Officer</option>
              <option value="treasury_officer">Treasury Officer</option>
              <option value="financial_controller">Financial Controller</option>
              <option value="auditor">Auditor</option>
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleCreateUser} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <DataTable columns={[
        { key: 'firstName', label: 'First Name' },
        { key: 'lastName', label: 'Last Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', render: (v: string) => <span className="capitalize">{v?.replace('_', ' ')}</span> },
        { key: 'isActive', label: 'Status', render: (v: boolean) => v ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-red-600 text-xs font-medium">Inactive</span> },
      ]} data={users} />
    </AppLayout>
  );
}
