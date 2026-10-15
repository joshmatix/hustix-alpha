UPDATE public.firms
SET report_header = $json$
{
  "branding": {
    "backgroundColor": "#1E293B",
    "textColor": "#FFFFFF",
    "accentColor": "#3B82F6",
    "fontFamily": "Inter, sans-serif",
    "fontSize": "14px",
    "logo": {
      "url": "https://assets.your-saas.com/logos/tenant-123.png",
      "position": "left",
      "height": "32px",
      "altText": "Acme Corp Logo"
    }
  },
  "metadata": {
    "reportTitle": "Quarterly Performance Report",
    "reportSubtitle": "Q3 Financial & Operations Summary",
    "tenantName": "Acme Corporation",
    "generatedAt": "2026-10-14T17:00:00Z",
    "reportId": "REP-88392"
  },
  "options": {
    "showDate": true,
    "showReportId": true,
    "borderBottom": "2px solid #334155"
  }
}
$json$::jsonb
WHERE name = 'Apex Wealth Management';