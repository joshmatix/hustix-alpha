import Link from 'next/link';

export const metadata = {
  title: 'Hustix Macro Privacy Policy',
  description: 'How Hustix collects, uses, and shares information for Hustix Macro.',
};

const sections = [
  {
    heading: '1. Who we are',
    paragraphs: [
      'This policy describes how Hustix handles information when you use the Hustix Macro website and service at hustix.com. Hustix Macro is a portfolio stress-test tool for wealth advisors.',
      'If you use the service for a firm or RIA, this policy applies to the account and to the information that account submits.',
    ],
  },
  {
    heading: '2. Information we collect',
    paragraphs: [
      'Account information. When you register, we collect your email address, a password, and your firm name. Passwords are stored by our authentication provider in a form that we cannot read. We also store the date you accept the Customer Agreement and the agreement version you accepted.',
      'Security information. The service requires an authenticator app. We store the enrollment needed to verify sign-in codes. We do not receive the secret stored in your authenticator app.',
      'Portfolio information. You may enter client names, portfolio labels, tickers, and allocations so the service can run stress tests and build reports. You decide what to upload.',
      'Questions. The public contact form collects the name, email address, and message you submit.',
      'Billing. If you choose a paid plan, payment is processed by Stripe. Stripe collects the payment details. We receive the plan, billing status, and related identifiers, not your full card number.',
      'Sign-in state. We use browser storage and cookies to keep you signed in, to protect the service, and to operate the admin console. We do not use them for advertising.',
    ],
  },
  {
    heading: '3. How we use information',
    paragraphs: [
      'We use information to create and secure your account, run the stress tests and reports you request, bill for a paid plan, reply to questions, and keep the service operating.',
      'We also use it to investigate misuse, enforce our terms, and comply with law. We do not sell your information.',
    ],
  },
  {
    heading: '4. Who we share information with',
    paragraphs: [
      'Service providers process information for us. That includes our authentication and database host, Stripe when you pay, and email delivery used for account messages. They may use the information only to perform those services.',
      'Market-data providers. To price a portfolio, we send tickers and related request details to providers such as Yahoo Finance. Those providers handle the request under their own terms.',
      'Legal and safety. We may disclose information if the law requires it, or if we believe disclosure is needed to protect Hustix, our users, or others.',
      'A firm account. People you authorize on a firm account can see the portfolios and reports stored in that account.',
    ],
  },
  {
    heading: '5. How long we keep information',
    paragraphs: [
      'We keep account and portfolio information while the account is open, and afterward for as long as we need it for security, billing, disputes, or legal duties.',
      'You may ask us to close an account through the support contact shown after you sign in. Hustix Macro is not an official books-and-records system. You are responsible for your firm’s own compliance archives.',
    ],
  },
  {
    heading: '6. Security',
    paragraphs: [
      'We protect information in transit with TLS and encrypt stored data. Access to production data is limited to what the service needs. No method of storage or transmission is perfectly secure.',
    ],
  },
  {
    heading: '7. Your choices',
    paragraphs: [
      'You can update firm and account details in the product, close the account through support, and choose what client information to upload. You can also withhold optional information, though the service may not work without an account.',
      'Advisors must have the rights and client consents required to upload client information and to let Hustix store and process it.',
    ],
  },
  {
    heading: '8. Children',
    paragraphs: [
      'Hustix Macro is a business service for wealth advisors. It is not directed at children, and we do not knowingly collect information from children.',
    ],
  },
  {
    heading: '9. Changes',
    paragraphs: [
      'We may update this policy. The date at the top of this page will change when we do. If a change is material, we may also send a notice to the email on the account.',
    ],
  },
  {
    heading: '10. Contact',
    paragraphs: [
      'Questions about this policy can be sent through the contact form at hustix.com/contact. Signed-in users can also use the support contact shown in the account.',
    ],
  },
];

export default function PrivacyPage() {
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
            <h1 className="text-lg font-semibold text-white">Privacy Policy</h1>
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
