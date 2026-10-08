// frontend/app/page.tsx
export default function SettingsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-950 text-white">
      <h1 className="text-4xl font-bold">Macro Risk Middleware</h1>
      <p className="mt-4 text-slate-400">Stress-test client portfolios against macro shocks.</p>
      <a 
        href="/dashboard" 
        className="mt-6 px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500"
      >
        Go to Dashboard
      </a>
    </main>
  );
}