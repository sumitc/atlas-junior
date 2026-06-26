"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasGame } from "@/components/AtlasGame";
import {
  getHarnessResults,
  submitHarnessResults,
  type HarnessReport,
  type HarnessStep,
} from "@/lib/api";
import { APP_VERSION } from "@/lib/version";

type StepState = HarnessStep & { startedAt: string };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getText(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent?.trim() ?? "";
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  stepMs = 100,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(stepMs);
  }
  throw new Error("Timed out waiting for harness condition");
}

export function TestHarness() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [latestReport, setLatestReport] = useState<HarnessReport | null>(null);
  const [status, setStatus] = useState("Ready to run.");
  const [error, setError] = useState<string | null>(null);
  const collectedStepsRef = useRef<HarnessStep[]>([]);

  const summary = useMemo(() => {
    const passed = steps.filter((step) => step.status === "pass").length;
    const failed = steps.filter((step) => step.status === "fail").length;
    return { passed, failed };
  }, [steps]);

  useEffect(() => {
    void getHarnessResults()
      .then((result) => setLatestReport(result.latest))
      .catch(() => {});
  }, []);

  async function runStep(
    name: string,
    fn: () => Promise<void> | void,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await fn();
      const step: StepState = {
        name,
        status: "pass",
        durationMs: Date.now() - startedAt,
        startedAt: new Date(startedAt).toISOString(),
      };
      setSteps((current) => [...current, step]);
      collectedStepsRef.current.push(step);
    } catch (stepError) {
      const message = stepError instanceof Error ? stepError.message : String(stepError);
      const step: StepState = {
        name,
        status: "fail",
        message,
        durationMs: Date.now() - startedAt,
        startedAt: new Date(startedAt).toISOString(),
      };
      setSteps((current) => [...current, step]);
      collectedStepsRef.current.push(step);
      throw stepError;
    }
  }

  async function runHarness() {
    if (!rootRef.current || running) {
      return;
    }

    setRunning(true);
    setSteps([]);
    collectedStepsRef.current = [];
    setError(null);
    setStatus("Running harness...");

    const startedAt = new Date().toISOString();

    try {
      const gameRoot = rootRef.current.querySelector<HTMLElement>('[data-testid="atlas-game-root"]');
      if (!gameRoot) {
        throw new Error("Could not find the game root");
      }

      await runStep("Open screen", () => {
        if (!getText(gameRoot, '[data-testid="harness-ready-banner"]')) {
          throw new Error("Game did not render the ready banner");
        }
      });

      await runStep("Start game", async () => {
        const inputs = Array.from(gameRoot.querySelectorAll<HTMLInputElement>('[data-testid^="player-name-"]'));
        if (inputs.length < 2) {
          throw new Error("Missing player inputs");
        }

        setInputValue(inputs[0], "Test One");
        setInputValue(inputs[1], "Test Two");
        gameRoot.querySelector<HTMLButtonElement>('[data-testid="start-game-button"]')?.click();
        await waitFor(() => getText(gameRoot, '[data-testid="current-player-name"]') === "Test One");
      });

      await runStep("Timer ticks", async () => {
        const before = getText(gameRoot, '[data-testid="turn-timer"]');
        await sleep(1300);
        const after = getText(gameRoot, '[data-testid="turn-timer"]');
        if (!before || !after || before === after) {
          throw new Error(`Timer did not change (${before} -> ${after})`);
        }
      });

      await runStep("Save a place", async () => {
        const input = gameRoot.querySelector<HTMLInputElement>('[data-testid="place-input"]');
        if (!input) {
          throw new Error("Missing place input");
        }
        setInputValue(input, "Andorra");
        await waitFor(() => Boolean(gameRoot.querySelector('[data-testid="save-button"]')));
        gameRoot.querySelector<HTMLButtonElement>('[data-testid="save-button"]')?.click();
        await waitFor(() => getText(gameRoot, '[data-testid="current-player-name"]') === "Test Two");
      });

      await runStep("Request add flow", async () => {
        const input = gameRoot.querySelector<HTMLInputElement>('[data-testid="place-input"]');
        if (!input) {
          throw new Error("Missing place input");
        }
        const requiredLetter = getText(gameRoot, '[data-testid="required-letter"]').toLowerCase();
        setInputValue(input, `${requiredLetter}zzzzville`);
        await waitFor(() => Boolean(gameRoot.querySelector('[data-testid="request-add-button"]')));
        gameRoot.querySelector<HTMLButtonElement>('[data-testid="request-add-button"]')?.click();
        await sleep(500);
      });

      await runStep("Share button exists", () => {
        if (!gameRoot.querySelector('[data-testid="share-button"]')) {
          throw new Error("Missing share button");
        }
      });

      await runStep("Leaderboard link exists", () => {
        const leaderboard = gameRoot.querySelector<HTMLAnchorElement>('[data-testid="leaderboard-link"]');
        if (!leaderboard?.href) {
          throw new Error("Missing leaderboard link");
        }
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      setStatus("Harness failed.");
    } finally {
      const report: HarnessReport = {
        buildVersion: APP_VERSION,
        platform: "web",
        startedAt,
        finishedAt: new Date().toISOString(),
        passed: collectedStepsRef.current.filter((step) => step.status === "pass").length,
        failed: collectedStepsRef.current.filter((step) => step.status === "fail").length,
        steps: collectedStepsRef.current,
      };

      try {
        const result = await submitHarnessResults(report);
        setLatestReport(result.latest);
        setStatus((current) => (current === "Harness failed." ? current : "Harness complete."));
      } catch (submitError) {
        const message = submitError instanceof Error ? submitError.message : String(submitError);
        setError((current) => current ?? message);
      }
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[2rem] bg-white/85 p-5 shadow-lg shadow-violet-200/50 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Harness</p>
            <h1 className="text-2xl font-black text-slate-900">Atlas smoke tests</h1>
            <p className="mt-1 text-sm text-slate-600">{status}</p>
          </div>
          <button
            className="rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
            onClick={() => void runHarness()}
            disabled={running}
            type="button"
          >
            {running ? "Running…" : "Run harness"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>Version: v{APP_VERSION}</p>
          <p>
            Passed: {summary.passed} · Failed: {summary.failed}
          </p>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
      </section>

      <section ref={rootRef} className="rounded-[2rem] bg-white/60 p-2 shadow-xl shadow-cyan-200/40">
        <AtlasGame />
      </section>

      <section className="rounded-[2rem] bg-white/85 p-5 shadow-lg shadow-slate-200/50 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">Latest report</h2>
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">api/test-results</span>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(latestReport, null, 2)}
        </pre>
        {steps.length > 0 && (
          <div className="mt-4 space-y-2">
            {steps.map((step) => (
              <div
                className={`rounded-2xl px-4 py-3 text-sm ${
                  step.status === "pass" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                }`}
                key={`${step.name}-${step.startedAt}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{step.name}</span>
                  <span>{step.durationMs}ms</span>
                </div>
                {step.message && <p className="mt-1 text-xs">{step.message}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
