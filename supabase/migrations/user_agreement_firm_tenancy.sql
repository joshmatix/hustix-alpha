-- Customer Agreement 2026-10-28.
-- Firm is the service customer; one sign-in email maps to one firm.

INSERT INTO public.agreement_versions (version, title, sections, published_at)
SELECT
  '2026-10-28',
  source.title,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        source.sections,
        '{0,paragraphs,0}',
        to_jsonb(replace(
          source.sections #>> '{0,paragraphs,0}',
          'October 21, 2026',
          'October 28, 2026'
        ))
      ),
      '{3,paragraphs}',
      (source.sections #> '{3,paragraphs}') || jsonb_build_array(
        'Hustix Macro’s subscribed service relationship is with your firm (or RIA), not with you personally as an individual advisor. Your login lets you access that firm’s workspace, portfolios, and settings.',
        'Each sign-in email address is tied to one firm on the service. If you work with more than one firm on Hustix Macro, you must register and sign in with a different email address for each firm. The service does not support switching firms under a single login.'
      )
    ),
    '{6,paragraphs}',
    (source.sections #> '{6,paragraphs}') || jsonb_build_array(
      'Plans, portfolio limits, and paid subscriptions apply to the firm. A firm owner (or another authorized representative) selects the plan and billing for that firm.'
    )
  ),
  '2026-10-28T00:00:00Z'
FROM public.agreement_versions AS source
WHERE source.version = '2026-10-21'
ON CONFLICT (version) DO NOTHING;
