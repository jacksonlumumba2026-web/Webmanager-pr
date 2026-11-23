import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';
import { apiRequest } from '../../services/api.ts';

export function ContactPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ id: string }>('/api/public/contact', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, company, subject, message }),
      });
      setSubmittedId(res.id);
      setFullName('');
      setEmail('');
      setCompany('');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit message.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <section className="py-16 lg:py-20 bg-white">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-sm font-medium text-blue-700">Contact Us</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Talk with our platform engineering team
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Send us your agency portfolio size, preferred hosting providers, or white-label domain requirements. Every inquiry is saved directly to our operations queue.
            </p>
            <div className="pt-4 border-t border-slate-200 space-y-2 text-sm text-slate-600">
              <p><strong className="text-slate-900">Support hours:</strong> Monday – Friday, 08:00 – 18:00 GMT</p>
              <p><strong className="text-slate-900">Response target:</strong> Within 1 business day</p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="p-8 rounded-xl border border-slate-200 bg-slate-50/50">
              {submittedId ? (
                <div className="py-8 space-y-4">
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Inquiry received</span>
                  </div>
                  <p className="text-sm text-slate-600">
                    Thank you for contacting WebManager Pro. Your inquiry reference ID is{' '}
                    <span className="font-mono text-slate-900">{submittedId.slice(0, 8)}</span>.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSubmittedId(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="contact-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Full Name
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                        placeholder="Alex Morgan"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Work Email
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                        placeholder="alex@studio.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="contact-company" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Agency or Company
                      </label>
                      <input
                        id="contact-company"
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                        placeholder="Northbridge Digital"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-subject" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Subject
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        required
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                        placeholder="Enterprise onboarding inquiry"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Message
                    </label>
                    <textarea
                      id="contact-message"
                      required
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                      placeholder="Tell us how many client sites you manage and what workflows you need..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors"
                  >
                    {submitting ? 'Sending...' : 'Send Message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
