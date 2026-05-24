import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Atlas Junior",
  description: "Privacy policy for the Atlas Junior geography word game app.",
};

const CONTACT_EMAIL = "develop.sumit@gmail.com";
const LAST_UPDATED = "24 May 2025";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 via-fuchsia-50 to-sky-100 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-500 transition"
          >
            ←
          </Link>
          <div>
            <h1 className="text-3xl font-black text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-500">Atlas Junior · Last updated {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="space-y-6 rounded-3xl bg-white/80 p-6 shadow-xl shadow-violet-100 backdrop-blur sm:p-8">

          <section>
            <p className="text-slate-700 leading-relaxed">
              Atlas Junior is a simple turn-based geography word game. We take your privacy
              seriously — especially because kids play this game. This policy explains what little
              data we collect and why.
            </p>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">What we collect</h2>
            <ul className="space-y-3">
              <Item
                title="Leaderboard entries"
                detail="If you choose to submit your score at the end of a game, we store the team name you type, your score, and the date. This is the only personal data we store, and you choose what name to enter."
              />
              <Item
                title="Aggregate game statistics"
                detail="We count the total number of games played and total turns across all players globally. These are plain counters with no link to any individual player or device."
              />
              <Item
                title="IP address (support tickets only)"
                detail="If you submit a support ticket, your IP address is used temporarily to prevent spam. It is not stored in our database beyond a short rate-limit window (15 minutes) and is never linked to any other data."
              />
              <Item
                title="Support ticket content"
                detail="If you submit a support ticket, the subject and message you write are stored as a GitHub Issue visible to the developer. Do not include sensitive personal information in a support ticket."
              />
            </ul>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">What we do NOT collect</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                "No user accounts or sign-in",
                "No email addresses",
                "No phone numbers",
                "No device identifiers",
                "No location data",
                "No camera or microphone recordings stored",
                "No advertising identifiers",
                "No third-party analytics or tracking SDKs",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-0.5 font-bold text-emerald-500">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Microphone</h2>
            <p className="text-slate-700 leading-relaxed">
              The app uses your device microphone for the optional voice-input feature. Speech is
              processed on-device by Android&apos;s built-in speech recognition. We never receive,
              transmit, or store audio recordings or speech transcripts.
            </p>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Children&apos;s privacy</h2>
            <p className="text-slate-700 leading-relaxed">
              Atlas Junior is designed for family use including children. We do not knowingly
              collect personal information from children under 13. The only data voluntarily
              submitted is a leaderboard team name chosen by the player — we recommend using a
              fun nickname rather than a real name.
            </p>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Third-party services</h2>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">Vercel</span> — hosts the backend
                API. Subject to{" "}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer" className="text-violet-600 underline">
                  Vercel&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Upstash Redis</span> — stores
                leaderboard and stats data. Subject to{" "}
                <a href="https://upstash.com/trust/privacy.pdf" target="_blank" rel="noreferrer" className="text-violet-600 underline">
                  Upstash&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <span className="font-semibold text-slate-800">GitHub</span> — stores support
                tickets as Issues. Subject to{" "}
                <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noreferrer" className="text-violet-600 underline">
                  GitHub&apos;s Privacy Statement
                </a>.
              </li>
            </ul>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Data deletion</h2>
            <p className="text-slate-700 leading-relaxed">
              Leaderboard entries do not contain any contact information, so we cannot identify
              which entry belongs to you. If you submitted a score under a specific name and would
              like it removed, email us with the name and approximate date and we will delete it.
            </p>
          </section>

          <hr className="border-slate-100"/>

          <section>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Contact</h2>
            <p className="text-slate-700 leading-relaxed">
              Questions about this policy? Email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-violet-600 underline">
                {CONTACT_EMAIL}
              </a>{" "}
              or use the in-app support form.
            </p>
          </section>

        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Atlas Junior · Fibula Dreams · {LAST_UPDATED}
        </p>
      </div>
    </main>
  );
}

function Item({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-600 leading-relaxed">{detail}</p>
    </li>
  );
}
