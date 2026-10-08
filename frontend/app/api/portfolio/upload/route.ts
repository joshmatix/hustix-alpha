// app/api/portfolio/upload/route.ts
import { NextResponse } from 'next/server';
import Papa from 'papaparse';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const csvText = await file.text();
  
  // Parse incoming CSV raw holdings
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  
  const rawHoldings = parsed.data.map((row: any) => ({
    symbol: row.Ticker || row.Symbol,
    shares: parseFloat(row.Shares || row.Quantity),
    marketValue: parseFloat(row.MarketValue || row.Value)
  }));

  // Send raw array to Box 2 (Data Ingestion & Normalization Engine)
  return NextResponse.json({ status: "success", holdings: rawHoldings });
}