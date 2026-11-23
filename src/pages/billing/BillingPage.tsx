import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, Plus, Receipt, Search, X } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { InvoiceModal, formatInvoiceMoney } from '../../components/billing/InvoiceModal.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type { ClientRecord, InvoiceRecord } from '../../types/index.ts';

export function BillingPage() {
  const { isAdminOrStaff, organization, clientRecord } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState<InvoiceRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');

  // Create invoice state
  const [clientId, setClientId] = useState('');
  const [billingPeriod, setBillingPeriod] = useState(
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );
  const [description, setDescription] = useState('');
  const [amountDollars, setAmountDollars] = useState('150.00');
  const [currency, setCurrency] = useState('USD');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const invoicePromise = apiRequest<InvoiceRecord[]>('/api/invoices');
      if (isAdminOrStaff) {
        const [invData, clientData] = await Promise.all([
          invoicePromise,
          apiRequest<ClientRecord[]>('/api/clients'),
        ]);
        setInvoices(invData);
        setClients(clientData);
        if (clientData.length > 0) {
          const first = clientData[0];
          setClientId((prev) => {
            if (prev) return prev;
            setDescription((d) =>
              d || `${first.retainerPlan || 'Monthly Website Retainer'} (${billingPeriod})`
            );
            if ((first.monthlyFeeCents ?? 0) > 0) {
              setAmountDollars(((first.monthlyFeeCents ?? 0) / 100).toFixed(2));
            }
            if (first.currency) setCurrency(first.currency);
            return first.id;
          });
        }
      } else {
        const invData = await invoicePromise;
        setInvoices(invData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing records.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrStaff]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectClientForCreate = (nextClientId: string) => {
    setClientId(nextClientId);
    const chosen = clients.find((c) => c.id === nextClientId);
    if (chosen) {
      setDescription(`${chosen.retainerPlan || 'Monthly Website Retainer'} (${billingPeriod})`);
      if ((chosen.monthlyFeeCents ?? 0) > 0) {
        setAmountDollars(((chosen.monthlyFeeCents ?? 0) / 100).toFixed(2));
      }
      if (chosen.currency) setCurrency(chosen.currency);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const amountCents = Math.round((Number.parseFloat(amountDollars) || 0) * 100);
      const created = await apiRequest<InvoiceRecord & { emailSent?: boolean }>(
        `/api/clients/${clientId}/invoices`,
        {
          method: 'POST',
          body: JSON.stringify({
            billingPeriod,
            description,
            amountCents,
            currency,
            dueDate: dueDate || null,
            notes,
            sendEmail,
          }),
        }
      );
      setShowCreate(false);
      setNotes('');
      setNotice(
        created.emailSent
          ? `Invoice ${created.invoiceNumber} created and emailed to ${created.clientEmail}.`
          : `Invoice ${created.invoiceNumber} created.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateInvoiceStatus = async (
    invoiceId: string,
    status: 'pending' | 'paid' | 'overdue' | 'void',
    method?: string
  ) => {
    setBusyInvoiceId(invoiceId);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(method ? { paymentMethod: method } : {}),
        }),
      });
      setMarkPaidTarget(null);
      setNotice(`Invoice updated to ${status}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update invoice.');
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const handleSendInvoiceEmail = async (invoiceId: string) => {
    setBusyInvoiceId(invoiceId);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ sent: boolean; recipient: string }>(
        `/api/invoices/${invoiceId}/send`,
        { method: 'POST' }
      );
      setNotice(`Invoice email sent to ${res.recipient}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invoice email.');
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
      const matchesQuery =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.billingPeriod.toLowerCase().includes(q) ||
        inv.description.toLowerCase().includes(q) ||
        (inv.clientBusinessName || '').toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [invoices, statusFilter, search]);

  const primaryCurrency = useMemo(() => {
    return invoices[0]?.currency || clientRecord?.currency || 'USD';
  }, [invoices, clientRecord]);

  const totals = useMemo(() => {
    const paid = invoices.filter((i) => i.status === 'paid');
    const outstanding = invoices.filter((i) => i.status === 'pending' || i.status === 'overdue');
    const overdue = invoices.filter((i) => i.status === 'overdue');
    return {
      paidCents: paid.reduce((acc, i) => acc + i.amountCents, 0),
      outstandingCents: outstanding.reduce((acc, i) => acc + i.amountCents, 0),
      outstandingCount: outstanding.length,
      overdueCount: overdue.length,
    };
  }, [invoices]);

  return (
    <DashboardLayout
      breadcrumbs={[
        {
          label: isAdminOrStaff ? 'Agency Console' : 'Client Portal',
          to: isAdminOrStaff ? '/dashboard' : '/portal',
        },
        { label: 'Billing & Invoices' },
      ]}
      action={
        isAdminOrStaff && clients.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Invoice</span>
          </button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isAdminOrStaff ? 'Billing & Retainer Invoices' : 'Invoices & Receipts'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {isAdminOrStaff
              ? 'Issue monthly retainer invoices, track client payments, and send formatted receipts.'
              : 'Review your maintenance retainer invoices and print official payment receipts.'}
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Total Invoices</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {invoices.length}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Outstanding Balance</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {formatInvoiceMoney(totals.outstandingCents, primaryCurrency)}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Total Paid</p>
            <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
              {formatInvoiceMoney(totals.paidCents, primaryCurrency)}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Overdue Invoices</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
                totals.overdueCount > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {totals.overdueCount}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice #, client, or period..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit overflow-x-auto">
            {['all', 'pending', 'paid', 'overdue', 'void'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading invoices...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-600">
                {invoices.length === 0
                  ? 'No invoices issued yet.'
                  : 'No invoices match your filter.'}
              </p>
              {isAdminOrStaff && clients.length > 0 && invoices.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                >
                  Issue First Invoice
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Invoice</th>
                  {isAdminOrStaff && <th className="py-3 px-4">Client</th>}
                  <th className="py-3 px-4">Period &amp; Description</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Due / Paid</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>
                    {isAdminOrStaff && (
                      <td className="py-3 px-4">
                        <Link
                          to={`/dashboard/clients/${inv.clientId}`}
                          className="font-semibold text-slate-900 hover:text-blue-700 text-xs block"
                        >
                          {inv.clientBusinessName || 'Client'}
                        </Link>
                        {inv.clientEmail && (
                          <span className="text-[11px] text-slate-500">{inv.clientEmail}</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <p className="text-xs font-semibold text-slate-900">{inv.billingPeriod}</p>
                      <p className="text-xs text-slate-500 truncate max-w-xs">{inv.description}</p>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatInvoiceMoney(inv.amountCents, inv.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={inv.status} />
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                      {inv.paidAt
                        ? `Paid ${new Date(inv.paidAt).toLocaleDateString()}`
                        : inv.dueDate
                          ? `Due ${new Date(inv.dueDate).toLocaleDateString()}`
                          : new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          {inv.status === 'paid' ? 'Receipt' : 'View / Print'}
                        </button>
                        {isAdminOrStaff && inv.status !== 'paid' && inv.status !== 'void' && (
                          <button
                            type="button"
                            disabled={busyInvoiceId === inv.id}
                            onClick={() => {
                              setPaymentMethod('Bank Transfer');
                              setMarkPaidTarget(inv);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Paid</span>
                          </button>
                        )}
                        {isAdminOrStaff && (
                          <button
                            type="button"
                            disabled={busyInvoiceId === inv.id}
                            onClick={() => handleSendInvoiceEmail(inv.id)}
                            title="Email invoice to client"
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>Email</span>
                          </button>
                        )}
                        {isAdminOrStaff && inv.status === 'pending' && (
                          <button
                            type="button"
                            disabled={busyInvoiceId === inv.id}
                            onClick={() => handleUpdateInvoiceStatus(inv.id, 'overdue')}
                            className="text-xs font-medium text-amber-700 hover:underline disabled:opacity-50"
                          >
                            Overdue
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Create Retainer Invoice</h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowCreate(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Client</label>
                  <select
                    required
                    value={clientId}
                    onChange={(e) => handleSelectClientForCreate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.businessName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Billing Period
                  </label>
                  <input
                    type="text"
                    required
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="November 2026"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Monthly Maintenance & Hosting Retainer"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={amountDollars}
                    onChange={(e) => setAmountDollars(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono"
                  >
                    {['USD', 'EUR', 'GBP', 'KES', 'CAD', 'AUD'].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Bank transfer or M-Pesa payment instructions..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Email invoice notice directly to client</span>
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {submitting ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {markPaidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                Record Payment · {markPaidTarget.invoiceNumber}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setMarkPaidTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Confirm payment of{' '}
              <span className="font-semibold text-slate-900 font-mono">
                {formatInvoiceMoney(markPaidTarget.amountCents, markPaidTarget.currency)}
              </span>{' '}
              for {markPaidTarget.clientBusinessName}.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="M-Pesa / Mobile Money">M-Pesa / Mobile Money</option>
                <option value="Card">Card</option>
                <option value="PayPal">PayPal</option>
                <option value="Cash">Cash</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMarkPaidTarget(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyInvoiceId === markPaidTarget.id}
                onClick={() =>
                  handleUpdateInvoiceStatus(markPaidTarget.id, 'paid', paymentMethod)
                }
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-60"
              >
                Confirm Paid
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          agencyName={organization?.name || 'WebManager Pro'}
          agencyEmail={organization?.supportEmail}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </DashboardLayout>
  );
}
