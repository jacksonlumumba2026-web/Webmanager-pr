import { Link } from 'react-router-dom';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';

export function AboutPage() {
  return (
    <PublicLayout>
      <section className="py-16 lg:py-24 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-sm font-medium text-blue-700">About WebManager Pro</p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 text-balance">
              Infrastructure built for agencies that treat client websites as long-term assets.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed">
              Most agencies juggle client logins in shared spreadsheets, repository links in chat threads, and manual deployments across disconnected dashboards. WebManager Pro consolidates client onboarding, source editing, GitHub synchronization, and deployment auditing into one white-label platform.
            </p>
            <p className="text-base text-slate-600 leading-relaxed">
              Every action is backed by relational PostgreSQL records, strict server-side role verification, and immutable audit trails so your engineering team and your clients always know what changed and when.
            </p>
          </div>
          <div className="lg:col-span-6">
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[16/9]">
              <img
                src="/src/assets/images/about_studio_team_1795276091388.jpg"
                alt="WebManager Pro engineering and design studio"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-slate-50/70">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">01. Multi-Tenant by Design</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Organizations, staff permissions, and client assignments are enforced at the API and database layer, keeping every client portal strictly isolated.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">02. White-Label Ready</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Customize your organization name, brand logo, accent color, and support contact so clients experience your agency identity on every visit.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">03. Transparent Deployments</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Saved source drafts remain distinct from live deployments. Publishing only reports success when verified provider commits and Pages checks complete.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-12 flex items-center justify-between flex-wrap gap-4 pt-8 border-t border-slate-200">
          <p className="text-sm text-slate-600">
            Questions about enterprise onboarding or custom hosting integrations?
          </p>
          <Link
            to="/contact"
            className="px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            Contact Us
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
