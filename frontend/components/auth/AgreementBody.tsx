import type { AgreementDocument } from '@/lib/agreement';

export default function AgreementBody({ agreement }: { agreement: AgreementDocument }) {
  return (
    <article className="space-y-4 text-sm leading-relaxed text-slate-300">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-white">{agreement.title}</h1>
        <p className="text-xs text-slate-500">Version {agreement.version}</p>
      </header>
      {agreement.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-100">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
