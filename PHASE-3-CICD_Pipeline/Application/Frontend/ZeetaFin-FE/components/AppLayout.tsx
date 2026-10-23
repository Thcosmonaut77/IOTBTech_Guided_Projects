'use client';

import { ReactNode } from 'react';
import Sidebar from './Sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="lg:ml-64 p-6 pt-16 lg:pt-6">
        {children}
      </main>
    </div>
  );
}
