import './globals.css';

export const metadata = {
  title: 'MacroRisk Studio',
  description: 'Stress-test client portfolios against macroeconomic shocks.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
