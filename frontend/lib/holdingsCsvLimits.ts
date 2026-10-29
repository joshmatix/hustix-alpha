/** Keep in sync with backend/engine/holdings_csv.py */
export const MAX_HOLDINGS_CSV_BYTES = 512_000;

export function holdingsCsvFileError(file: File | null | undefined): string | null {
  if (!file) return null;
  if (file.size > MAX_HOLDINGS_CSV_BYTES) {
    return 'CSV file is too large (max 500 KB, including any broker header and footer).';
  }
  return null;
}
