export const TAX_STATUSES = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'tax_deferred', label: 'Tax-deferred' },
  { value: 'tax_exempt', label: 'Tax-exempt' },
] as const;

export type TaxStatus = (typeof TAX_STATUSES)[number]['value'];

export function taxStatusLabel(value?: string | null) {
  return TAX_STATUSES.find((status) => status.value === value)?.label || '';
}
