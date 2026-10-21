import { supabase } from '@/lib/supabaseClient';

export type AgreementSection = {
  heading: string;
  paragraphs: string[];
};

export type AgreementDocument = {
  id: string;
  version: string;
  title: string;
  sections: AgreementSection[];
};

function parseAgreement(row: {
  id?: unknown;
  version?: unknown;
  title?: unknown;
  sections?: unknown;
}): AgreementDocument | null {
  if (typeof row.id !== 'string' || row.id.trim() === '') return null;
  if (typeof row.version !== 'string' || row.version.trim() === '') return null;
  if (typeof row.title !== 'string' || row.title.trim() === '') return null;
  if (!Array.isArray(row.sections) || row.sections.length === 0) return null;

  const sections: AgreementSection[] = [];
  for (const item of row.sections) {
    if (!item || typeof item !== 'object') return null;
    const heading = (item as { heading?: unknown }).heading;
    const paragraphs = (item as { paragraphs?: unknown }).paragraphs;
    if (typeof heading !== 'string' || heading.trim() === '') return null;
    if (
      !Array.isArray(paragraphs) ||
      paragraphs.length === 0 ||
      paragraphs.some((paragraph) => typeof paragraph !== 'string' || paragraph.trim() === '')
    ) {
      return null;
    }
    sections.push({ heading, paragraphs });
  }

  return { id: row.id, version: row.version, title: row.title, sections };
}

/** The current published agreement, or one version when `version` is set. */
export async function fetchAgreement(version?: string): Promise<AgreementDocument | null> {
  const requested = version?.trim();
  const query = supabase.from('agreement_versions').select('id, version, title, sections');
  const { data, error } = requested
    ? await query.eq('version', requested).maybeSingle()
    : await query.order('published_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return parseAgreement(data);
}

export async function hasAcceptedCurrentAgreement(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_accepted_current_agreement');
  return !error && data === true;
}

/** Records acceptance of a published version. The server stores the time and client address. */
export async function acceptAgreement(version: string): Promise<string | null> {
  const { error } = await supabase.rpc('accept_agreement', { target_version: version });
  return error ? error.message : null;
}
