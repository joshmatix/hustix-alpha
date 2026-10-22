-- Customer Agreement 2026-10-21.
-- During this phase Hustix is an analytics and stress-testing tool,
-- not a books-and-records system of record.

INSERT INTO public.agreement_versions (version, title, sections, published_at)
SELECT
  '2026-10-21',
  source.title,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          source.sections,
          '{0,paragraphs,0}',
          to_jsonb(replace(
            source.sections #>> '{0,paragraphs,0}',
            'October 20, 2026',
            'October 21, 2026'
          ))
        ),
        '{1,paragraphs}',
        (source.sections #> '{1,paragraphs}') || jsonb_build_array(
          'During this phase, Hustix is an analytics and stress-testing tool. It is not an official system of record for books and records.'
        )
      ),
      '{4,paragraphs}',
      ((source.sections #> '{4,paragraphs}') - (-1)) || jsonb_build_array(
        'The service is not an official system of record for books and records. Advisors must maintain their own primary compliance archives elsewhere. Hustix does not keep the official copy of a firm’s books, client files, or regulatory records.'
      )
    ),
    '{8,paragraphs}',
    jsonb_build_array(
      'Hustix is not liable for any loss, penalty, or claim that results from treating the service as a system of record, or from a failure to keep primary compliance archives outside Hustix.'
    ) || (source.sections #> '{8,paragraphs}')
  ),
  '2026-10-21T00:00:00Z'
FROM public.agreement_versions AS source
WHERE source.version = '2026-10-20'
ON CONFLICT (version) DO NOTHING;
