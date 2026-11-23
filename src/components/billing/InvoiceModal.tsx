import { Download, Printer, X } from 'lucide-react';
import { StatusText } from '../common/StatusText.tsx';
import type { InvoiceRecord } from '../../types/index.ts';

interface InvoiceModalProps {
  invoice: InvoiceRecord;
  agencyName: string;
  agencyEmail?: string | null;
  onClose: () => void;
}

export function formatInvoiceMoney(amountCents: number, currency: string): string {
  const amount = amountCents / 100;
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function InvoiceModal({
  invoice,
  agencyName,
  agencyEmail,
  onClose,
}: InvoiceModalProps) {
  const isPaid = invoice.status === 'paid';

  const handleDownloadSummary = () => {
    const lines = [
      `# ${agencyName} — ${isPaid ? 'Payment Receipt' : 'Retainer Invoice'} ${invoice.invoiceNumber}`,
      '',
      `**Status:** ${invoice.status.toUpperCase()}`,
      `**Client:** ${invoice.clientBusinessName || 'Client'}${invoice.clientFullName ? ` (${invoice.clientFullName})` : ''}`,
      `**Billing Period:** ${invoice.billingPeriod}`,
      `**Amount:** ${formatInvoiceMoney(invoice.amountCents, invoice.currency)}`,
      `**Issued:** ${new Date(invoice.createdAt).toLocaleDateString()}`,
      invoice.dueDate ? `**Due Date:** ${new Date(invoice.dueDate).toLocaleDateString()}` : '',
      invoice.paidAt ? `**Paid On:** ${new Date(invoice.paidAt).toLocaleDateString()}` : '',
      invoice.paymentMethod ? `**Payment Method:** ${invoice.paymentMethod}` : '',
      '',
      '## Line Item',
      `- ${invoice.description}: ${formatInvoiceMoney(invoice.amountCents, invoice.currency)}`,
      invoice.notes ? `\n## Notes\n${invoice.notes}` : '',
    ].filter(Boolean);

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoice.invoiceNumber.toLowerCase()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 print:hidden">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isPaid ? 'Payment Receipt' : 'Invoice'} · {invoice.invoiceNumber}
            </h2>
            <p className="text-xs text-slate-500">{invoice.clientBusinessName || agencyName}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              aria-label="Close invoice"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 text-sm text-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {agencyName}
              </p>
              {agencyEmail && <p className="text-xs text-slate-500 mt-0.5">{agencyEmail}</p>}
              <h3 className="text-2xl font-bold text-slate-900 mt-3">
                {isPaid ? 'PAYMENT RECEIPT' : 'INVOICE'}
              </h3>
              <p className="text-xs font-mono text-slate-600 mt-0.5">{invoice.invoiceNumber}</p>
            </div>
            <div className="sm:text-right space-y-1.5">
              <StatusText status={invoice.status} />
              <p className="text-xs text-slate-500">
                Issued:{' '}
                <span className="font-mono tabular-nums text-slate-800">
                  {new Date(invoice.createdAt).toLocaleDateString()}
                </span>
              </p>
              {invoice.dueDate && (
                <p className="text-xs text-slate-500">
                  Due:{' '}
                  <span className="font-mono tabular-nums text-slate-800">
                    {new Date(invoice.dueDate).toLocaleDateString()}
                  </span>
                </p>
              )}
              {invoice.paidAt && (
                <p className="text-xs text-emerald-700">
                  Paid:{' '}
                  <span className="font-mono tabular-nums">
                    {new Date(invoice.paidAt).toLocaleDateString()}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wider text-slate-500 mb-1">Billed To</p>
              <p className="text-sm font-bold text-slate-900">
                {invoice.clientBusinessName || 'Client Account'}
              </p>
              {invoice.clientFullName && <p className="text-slate-600">{invoice.clientFullName}</p>}
              {invoice.clientEmail && <p className="text-slate-500">{invoice.clientEmail}</p>}
            </div>
            <div className="sm:text-right">
              <p className="font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Billing Period
              </p>
              <p className="text-sm font-semibold text-slate-900">{invoice.billingPeriod}</p>
              {invoice.paymentMethod && (
                <p className="text-slate-600 mt-0.5">Method: {invoice.paymentMethod}</p>
              )}
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-3.5 px-4 text-sm text-slate-800">{invoice.description}</td>
                  <td className="py-3.5 px-4 text-sm font-mono tabular-nums font-semibold text-slate-900 text-right whitespace-nowrap">
                    {formatInvoiceMoney(invoice.amountCents, invoice.currency)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200">
                  <td className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-slate-600">
                    Total {isPaid ? 'Paid' : 'Due'}
                  </td>
                  <td className="py-3 px-4 text-base font-bold font-mono tabular-nums text-slate-900 text-right whitespace-nowrap">
                    {formatInvoiceMoney(invoice.amountCents, invoice.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {invoice.notes && (
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
              <p className="font-semibold text-slate-900 mb-1">Notes</p>
              <p className="whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
