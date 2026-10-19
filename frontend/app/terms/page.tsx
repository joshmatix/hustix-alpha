import Link from 'next/link';

export const metadata = {
  title: 'Hustix Macro Terms of Service',
  description: 'The terms for using the Hustix Macro website and service.',
};

const sections = [
  {
    heading: '1. These terms',
    paragraphs: [
      'These terms govern your use of the Hustix Macro website and service at hustix.com. They are between you and Hustix. The version date is October 19, 2026.',
      'By using the site, you agree to these terms. If you do not agree, do not use the site. If you create an account, you also agree to the Customer Agreement. For the subscribed service, the Customer Agreement controls if it conflicts with these terms.',
    ],
  },
  {
    heading: '2. The service',
    paragraphs: [
      'Hustix Macro lets a wealth advisor build ticker-based portfolios and run scenario stress tests. Results are calculations from information you enter and from third-party market data.',
      'Outputs, projections, and reports are illustrations and simulations. They are not predictions, guarantees, or a promise of how any portfolio or asset will perform.',
    ],
  },
  {
    heading: '3. Not investment advice',
    paragraphs: [
      'Hustix is a technology provider. Hustix is not a registered investment advisor, broker-dealer, or fiduciary, and Hustix does not provide investment, tax, or legal advice. Hustix is not an advisor to your clients.',
      'You decide what to show clients, which strategies to use, and whether a calculation or report is fit for your professional use.',
    ],
  },
  {
    heading: '4. Accounts',
    paragraphs: [
      'An account is required to use the product. You must provide accurate registration information, keep your credentials confidential, and use an authenticator app. You are responsible for activity under your account.',
      'If you accept for a firm or RIA, you confirm that you have authority to bind that entity.',
    ],
  },
  {
    heading: '5. Your content',
    paragraphs: [
      'You keep the rights to the client and portfolio information you submit. You grant Hustix permission to host and process that information only to provide, secure, and support the service and to comply with law.',
      'You represent that you have the rights and client consents needed to submit that information. The service is not an official books-and-records system. You remain responsible for your firm’s compliance records.',
    ],
  },
  {
    heading: '6. Acceptable use',
    paragraphs: [
      'Do not misuse the service, attempt to access another account, probe or disrupt the systems, scrape the service, or use it to break the law. We may suspend or close an account that breaks these terms or creates a security risk.',
    ],
  },
  {
    heading: '7. Plans and fees',
    paragraphs: [
      'The plan you select, including any portfolio or feature limits, is the plan shown when you sign up. A free plan has no charge. A paid plan is billed monthly in advance at the price shown at signup.',
      'Fees already paid are not refundable, except where the law requires a refund. Stripe processes paid-plan charges.',
    ],
  },
  {
    heading: '8. Third-party market data',
    paragraphs: [
      'The service uses market data, historical prices, and economic indicators from outside providers, including Yahoo Finance. Hustix does not guarantee that this data is accurate, complete, or current. Gaps, delays, and fallback calculations can change a result.',
    ],
  },
  {
    heading: '9. Disclaimers and liability',
    paragraphs: [
      'The site and service are provided “as is” and “as available,” without warranties of any kind. Hustix disclaims implied warranties of merchantability and fitness for a particular purpose, to the extent the law allows.',
      'To the maximum extent the law allows, Hustix is not liable for indirect, incidental, special, consequential, or punitive damages, including lost profits, lost assets under management, or harm to a client relationship.',
      'Hustix’s total liability for claims related to the service is limited to the fees you paid Hustix for the service during the twelve months before the claim.',
      'You will defend and indemnify Hustix and its suppliers against third-party claims that arise from your breach of these terms, your negligence, or advice or reports you give your clients.',
    ],
  },
  {
    heading: '10. Ending use',
    paragraphs: [
      'You may stop using the service at any time. You may ask us to close an account through the support contact shown after you sign in. Sections on disclaimers, liability, and indemnification still apply after the account ends.',
    ],
  },
  {
    heading: '11. Changes',
    paragraphs: [
      'We may update these terms. The date at the top of this page will change when we do. For account holders, we may also email the address on the account. Continuing to use the service after the update means you accept the updated terms.',
    ],
  },
  {
    heading: '12. Law and contact',
    paragraphs: [
      'These terms are governed by the laws of the State of New Jersey, without regard to conflict-of-law rules.',
      'Questions can be sent through the contact form at hustix.com/contact. Signed-in users can also use the support contact shown in the account.',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mb-6 w-full max-w-3xl">
        <Link href="/" className="text-xs font-medium text-slate-400 hover:text-slate-200">
          &larr; Back to Home
        </Link>
      </div>
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8">
        <article className="space-y-4 text-sm leading-relaxed text-slate-300">
          <header className="space-y-1">
            <h1 className="text-lg font-semibold text-white">Terms of Service</h1>
            <p className="text-xs text-slate-500">Last updated October 19, 2026</p>
          </header>
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-100">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
