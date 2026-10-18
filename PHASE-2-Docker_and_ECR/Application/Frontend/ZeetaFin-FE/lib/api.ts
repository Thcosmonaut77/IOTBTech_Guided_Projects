const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function request(endpoint: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  auth: {
    login: (data: { email: string; password: string }) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    register: (data: { email: string; password: string; firstName: string; lastName: string }) =>
      request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  },
  users: {
    list: () => request('/users'),
    get: (id: string) => request(`/users/${id}`),
    create: (data: any) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  },
  gl: {
    accounts: {
      list: () => request('/gl/chart-of-accounts'),
      get: (id: string) => request(`/gl/chart-of-accounts/${id}`),
      create: (data: any) => request('/gl/chart-of-accounts', { method: 'POST', body: JSON.stringify(data) }),
    },
    journalEntries: {
      list: (status?: string) => request(`/gl/journal-entries${status ? `?status=${status}` : ''}`),
      get: (id: string) => request(`/gl/journal-entries/${id}`),
      create: (data: any) => request('/gl/journal-entries', { method: 'POST', body: JSON.stringify(data) }),
      approve: (id: string) => request(`/gl/journal-entries/${id}/approve`, { method: 'POST' }),
      post: (id: string) => request(`/gl/journal-entries/${id}/post`, { method: 'POST' }),
    },
    trialBalance: () => request('/gl/trial-balance'),
    balanceSheet: () => request('/gl/balance-sheet'),
    profitAndLoss: (from?: string, to?: string) => {
      let q = '';
      if (from || to) q = `?${from ? `from=${from}` : ''}${from && to ? '&' : ''}${to ? `to=${to}` : ''}`;
      return request(`/gl/profit-and-loss${q}`);
    },
  },
  ap: {
    vendors: {
      list: () => request('/ap/vendors'),
      get: (id: string) => request(`/ap/vendors/${id}`),
      create: (data: any) => request('/ap/vendors', { method: 'POST', body: JSON.stringify(data) }),
    },
    invoices: {
      list: (status?: string) => request(`/ap/invoices${status ? `?status=${status}` : ''}`),
      get: (id: string) => request(`/ap/invoices/${id}`),
      create: (data: any) => request('/ap/invoices', { method: 'POST', body: JSON.stringify(data) }),
      approve: (id: string) => request(`/ap/invoices/${id}/approve`, { method: 'POST' }),
    },
    payments: {
      create: (data: any) => request('/ap/payments', { method: 'POST', body: JSON.stringify(data) }),
    },
    aging: () => request('/ap/aging'),
  },
  ar: {
    customers: {
      list: () => request('/ar/customers'),
      get: (id: string) => request(`/ar/customers/${id}`),
      create: (data: any) => request('/ar/customers', { method: 'POST', body: JSON.stringify(data) }),
    },
    invoices: {
      list: (status?: string) => request(`/ar/invoices${status ? `?status=${status}` : ''}`),
      get: (id: string) => request(`/ar/invoices/${id}`),
      create: (data: any) => request('/ar/invoices', { method: 'POST', body: JSON.stringify(data) }),
    },
    receipts: {
      create: (data: any) => request('/ar/receipts', { method: 'POST', body: JSON.stringify(data) }),
    },
    creditNotes: {
      create: (data: any) => request('/ar/credit-notes', { method: 'POST', body: JSON.stringify(data) }),
    },
    aging: () => request('/ar/aging'),
  },
  cash: {
    accounts: {
      list: () => request('/cash/accounts'),
      get: (id: string) => request(`/cash/accounts/${id}`),
      create: (data: any) => request('/cash/accounts', { method: 'POST', body: JSON.stringify(data) }),
    },
    position: () => request('/cash/position'),
    transactions: {
      list: (accountId?: string) => request(`/cash/transactions${accountId ? `?accountId=${accountId}` : ''}`),
      create: (data: any) => request('/cash/transactions', { method: 'POST', body: JSON.stringify(data) }),
    },
    reconciliation: {
      create: (data: any) => request('/cash/reconciliation', { method: 'POST', body: JSON.stringify(data) }),
    },
  },
  budgeting: {
    budgets: {
      list: () => request('/budgeting/budgets'),
      get: (id: string) => request(`/budgeting/budgets/${id}`),
      create: (data: any) => request('/budgeting/budgets', { method: 'POST', body: JSON.stringify(data) }),
      approve: (id: string) => request(`/budgeting/budgets/${id}/approve`, { method: 'POST' }),
    },
    variance: (budgetId: string) => request(`/budgeting/variance/${budgetId}`),
  },
  fixedAssets: {
    list: () => request('/fixed-assets'),
    get: (id: string) => request(`/fixed-assets/${id}`),
    create: (data: any) => request('/fixed-assets', { method: 'POST', body: JSON.stringify(data) }),
    transfer: (id: string, data: any) => request(`/fixed-assets/${id}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
    dispose: (id: string, data: any) => request(`/fixed-assets/${id}/dispose`, { method: 'POST', body: JSON.stringify(data) }),
    depreciate: (id: string) => request(`/fixed-assets/${id}/depreciate`, { method: 'POST' }),
    register: () => request('/fixed-assets/reports/register'),
    depreciationSchedule: () => request('/fixed-assets/reports/depreciation-schedule'),
  },
};
