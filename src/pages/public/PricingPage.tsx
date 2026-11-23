import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';

const PLANS = [
  {
    audience: 'For boutique studios',
    name: 'Studio',
    price: '$49',
    cadence: 'per month',
    description: 'Core client portal, file editing, and GitHub publishing for small web teams.',
    limits: [
      'Up to 15 active client websites',
      '2 agency staff seats included',
      'Monaco source editor & file manager',
      'GitHub Pages deployment pipeline',
      'Client change request portal',
    ],
    cta: 'Start Studio Plan',
  },
  {
    audience: 'For scaling agencies',
    name: 'Agency Pro',
    price: '$149',
    cadence: 'per month',
    description: 'Full white-label branding, granular staff permissions, and automated CSV/JSON reporting.',
    limits: [
      'Up to 100 active client websites',
      '15 agency staff seats with role permissions',
      'White-label logo, colors & support domain',
      'Agency-managed & client-owned GitHub repos',
      'Automated portfolio exports & 1-year audit logs',
    ],
    highlighted: true,
    cta: 'Get Started with Agency Pro',
  },
  {
    audience: 'For multi-office networks',
    name: 'Enterprise',
    price: '$399',
    cadence: 'per month',
    description: 'Dedicated onboarding, custom hosting adapters, and unlimited client seats.',
    limits: [
      'Unlimited client websites & portals',
      'Unlimited staff & Super Admin controls',
      'Custom domain white-label portal',
      'Dedicated database isolation & SLA',
      'Priority engineering & migration support',
    ],
    cta: 'Contact Enterprise Sales',
    to: '/contact',
  },
];

export function PricingPage() {
  return (
    <PublicLayout>
      <section className="py-16 lg:py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 space-y-4">
          <p className="text-sm font-medium text-blue-700">Transparent Agency Pricing</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 max-w-2xl text-balance">
            Predictable pricing sized to your client portfolio
          </h1>
          <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
            Every tier includes isolated PostgreSQL client portals, encrypted GitHub credentials, and audit logging.
          </p>
        </div>
      </section>

      <section className="py-16 bg-slate-50/70">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl p-8 bg-white flex flex-col justify-between gap-8 ${
                plan.highlighted
                  ? 'border-2 border-slate-900'
                  : 'border border-slate-200'
              }`}
            >
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">{plan.audience}</p>
                  <h2 className="text-2xl font-bold text-slate-900">{plan.name}</h2>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-slate-900 font-mono tabular-nums">
                    {plan.price}
                  </span>
                  <span className="text-sm text-slate-500">{plan.cadence}</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{plan.description}</p>
                <ul className="space-y-3 pt-4 border-t border-slate-100">
                  {plan.limits.map((limit) => (
                    <li key={limit} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                      <span>{limit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                to={plan.to || '/register'}
                className={`w-full text-center px-4 py-3 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  plan.highlighted
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
