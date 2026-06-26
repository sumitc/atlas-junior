import { TestHarness } from "@/components/TestHarness";

export default function TestHarnessPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-100 via-pink-50 to-cyan-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <TestHarness />
      </div>
    </main>
  );
}
