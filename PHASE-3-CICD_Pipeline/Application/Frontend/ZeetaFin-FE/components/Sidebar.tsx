'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  LayoutDashboard, BookOpen, CreditCard, Receipt, Wallet, 
  PieChart, Building2, Users, LogOut, Menu, X
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/gl', label: 'General Ledger', icon: BookOpen },
  { href: '/ap', label: 'Accounts Payable', icon: CreditCard },
  { href: '/ar', label: 'Accounts Receivable', icon: Receipt },
  { href: '/cash', label: 'Cash Management', icon: Wallet },
  { href: '/budgeting', label: 'Budgeting', icon: PieChart },
  { href: '/fixed-assets', label: 'Fixed Assets', icon: Building2 },
  { href: '/users', label: 'Users', icon: Users },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-primary-700 text-white rounded-lg"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-primary-800 text-white z-40 transform transition-transform
        ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        <div className="p-6 border-b border-white/10">
          <Link href="/dashboard" className="text-xl font-bold tracking-tight">
            ZeetaFin
          </Link>
          <p className="text-xs text-white/60 mt-1">Zeeta PLC ERP</p>
        </div>

        <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-sm font-medium">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-white/60 truncate capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="sidebar-link w-full text-white/70 hover:text-white"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
