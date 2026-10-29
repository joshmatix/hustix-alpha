/** Keep in sync with backend/admin_firm_load.py */
export const MAX_LOAD_FIRM_JSON_BYTES = 3 * 1024 * 1024;

export function loadFirmJsonFileError(file: File | null | undefined): string | null {
  if (!file) return null;
  if (file.size > MAX_LOAD_FIRM_JSON_BYTES) {
    return 'Load-firm JSON is too large (max 3 MB).';
  }
  return null;
}
