import AgreementGate from '@/components/auth/AgreementGate';
import AuthGuard from '@/components/auth/AuthGuard';
import LocalBypassSession from '@/components/auth/LocalBypassSession';
import AppLayout from '@/components/layout/AppLayout';
import { localLoginBypassEnabled } from '@/lib/localBypassFlag';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (localLoginBypassEnabled()) {
    return (
      <div data-hustix-dashboard="open">
        <LocalBypassSession />
        <AgreementGate>
          <AppLayout>{children}</AppLayout>
        </AgreementGate>
      </div>
    );
  }

  return (
      <AuthGuard>
        <AgreementGate>
          <AppLayout>{children}</AppLayout>
        </AgreementGate>
      </AuthGuard>
  );
}
