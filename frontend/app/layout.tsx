import './globals.css';
import SiteFooter from '@/components/layout/SiteFooter';

export const metadata = {
  title: 'Hustix Macro',
  description: 'Stress-test client portfolios against macroeconomic shocks.',
  icons: {
    icon: {
      url: '/favicon.png',
      type: 'image/png',
      sizes: '48x48',
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
