import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Section } from "../types/types";
import {
  AiBatchRunResult,
  AiBatchTrack,
  resultsToCsv,
  simulateAiRun,
  summarizeResults,
  AiBatchLevel,
} from "../logic/aiBatchSimulator";

const RUN_PLAN: Array<{ level: AiBatchLevel; count: number }> = [
  { level: "novice", count: 4 },
  { level: "pro", count: 6 },
  { level: "king", count: 10 },
];

const VALID_TYPES = new Set(["start", "straight", "curve90"]);
const AUTOSAVE_KEY = "pen-and-paper-racer:ai-lab-autosave";
const EXPORT_COUNTER_KEY = "pen-and-paper-racer:ai-lab-export-counter";
const AI_LAB_VERSION = "ai-lab-cpu-limit-debug-2026-05-17-05";

type AiLabAutosave = {
  version: string;
  savedAt: string;
  tracks?: AiBatchTrack[];
  results: AiBatchRunResult[];
  progress: string;
};

function sleep(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function exportTimestamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function nextExportCounter(): number {
  const current = Number(window.localStorage.getItem(EXPORT_COUNTER_KEY) ?? "0");
  const next = Number.isFinite(current) ? current + 1 : 1;
  window.localStorage.setItem(EXPORT_COUNTER_KEY, String(next));
  return next;
}

function parseTrack(name: string, text: string): AiBatchTrack | null {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return null;
  const sections = parsed
    .filter((section) =>
      VALID_TYPES.has(section?.type) &&
      Number.isFinite(section?.x) &&
      Number.isFinite(section?.y) &&
      Number.isFinite(section?.rotation)
    )
    .map((section, index) => ({
      id: String(section.id ?? `${name}-${index}`),
      type: section.type,
      x: section.x,
      y: section.y,
      rotation: section.rotation,
    })) as Section[];
  return sections.some((section) => section.type === "start") ? { name, sections } : null;
}

async function readFile(file: File): Promise<string> {
  return file.text();
}

export const AiBatchLab: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [tracks, setTracks] = useState<AiBatchTrack[]>([]);
  const [results, setResults] = useState<AiBatchRunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const summary = useMemo(() => summarizeResults(results), [results]);
  const totalRuns = tracks.length * RUN_PLAN.reduce((sum, item) => sum + item.count, 0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as AiLabAutosave;
      if (Array.isArray(saved.results)) setSavedAt(saved.savedAt);
    } catch {
      setSavedAt(null);
    }
  }, []);

  function saveProgress(nextResults: AiBatchRunResult[], nextProgress: string): void {
    const saved = {
      version: AI_LAB_VERSION,
      savedAt: new Date().toISOString(),
      tracks,
      results: nextResults,
      progress: nextProgress,
    };
    window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(saved));
    setSavedAt(saved.savedAt);
  }

  function restoreAutosave(): void {
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as AiLabAutosave;
      const restoredResults = Array.isArray(saved.results) ? saved.results : [];
      const restoredTracks = Array.isArray(saved.tracks) ? saved.tracks : [];
      cancelRef.current = true;
      setRunning(false);
      setResults(restoredResults);
      if (restoredTracks.length > 0) setTracks(restoredTracks);
      setProgress(
        restoredTracks.length > 0
          ? `${restoredResults.length} autosaved runs restored. Press Run AI Batch to continue.`
          : `${restoredResults.length} autosaved runs restored. Select the same track folder, then press Run AI Batch to continue.`
      );
      setSavedAt(saved.savedAt);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not restore autosave.");
    }
  }

  function clearAutosave(): void {
    window.localStorage.removeItem(AUTOSAVE_KEY);
    setSavedAt(null);
  }

  function plannedRunKey(trackName: string, level: AiBatchLevel, run: number): string {
    return `${trackName}::${level}::${run}`;
  }

  function resultRunKey(result: AiBatchRunResult): string {
    return plannedRunKey(result.track, result.level, result.run);
  }

  function getPlannedRunKeys(nextTracks: AiBatchTrack[]): Set<string> {
    const keys = new Set<string>();
    for (const track of nextTracks) {
      for (const item of RUN_PLAN) {
        for (let run = 1; run <= item.count; run++) {
          keys.add(plannedRunKey(track.name, item.level, run));
        }
      }
    }
    return keys;
  }

  async function handleFolder(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".json"));
    const loaded: AiBatchTrack[] = [];
    setError(null);

    for (const file of files) {
      try {
        const track = parseTrack(file.name, await readFile(file));
        if (track) loaded.push(track);
      } catch (err) {
        console.warn("[AI LAB] Ignored invalid track file", file.name, err);
      }
    }

    const plannedKeys = getPlannedRunKeys(loaded);
    const matchingResults = results.filter((result) => plannedKeys.has(resultRunKey(result)));
    setTracks(loaded);
    setResults(matchingResults);
    setProgress(
      loaded.length > 0
        ? `${loaded.length} tracks loaded. ${matchingResults.length} matching autosaved runs ready to continue. Batch size will be ${loaded.length} x 20 = ${loaded.length * 20} runs.`
        : "No valid tracks found."
    );
  }

  async function runBatch(): Promise<void> {
    if (tracks.length === 0 || running) return;
    cancelRef.current = false;
    setRunning(true);
    setError(null);

    const plannedKeys = getPlannedRunKeys(tracks);
    const nextResults = results.filter((result) => plannedKeys.has(resultRunKey(result)));
    const completedKeys = new Set(nextResults.map(resultRunKey));
    let completed = nextResults.length;
    setResults([...nextResults]);
    setProgress(completed > 0 ? `Launched. Continuing from ${completed}/${totalRuns} autosaved runs.` : "Launched.");

    try {
      for (const track of tracks) {
        for (const item of RUN_PLAN) {
          for (let run = 1; run <= item.count; run++) {
            const key = plannedRunKey(track.name, item.level, run);
            if (completedKeys.has(key)) continue;

            if (cancelRef.current) {
              const stoppedProgress = `${completed}/${totalRuns} runs complete. Simulation interrupted and autosaved.`;
              setProgress(stoppedProgress);
              saveProgress(nextResults, stoppedProgress);
              return;
            }

            const result = simulateAiRun(track, item.level, run);
            nextResults.push(result);
            completedKeys.add(key);
            completed += 1;
            const nextProgress = `${completed}/${totalRuns} runs complete: ${track.name} ${item.level} ${run}/${item.count}`;
            saveProgress(nextResults, nextProgress);
            setResults([...nextResults]);
            setProgress(nextProgress);
            await sleep();
          }
        }
      }
      setResults([...nextResults]);
      const doneProgress = `${completed}/${totalRuns} runs complete. Autosaved after every run.`;
      setProgress(doneProgress);
      saveProgress(nextResults, doneProgress);
    } catch (err: any) {
      setError(err?.message ?? "AI batch failed.");
    } finally {
      setRunning(false);
    }
  }

  function stopBatch(): void {
    cancelRef.current = true;
    setProgress("Stopping after the current run...");
  }

  function downloadCsv(): void {
    const blob = new Blob([resultsToCsv(results)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const counter = String(nextExportCounter()).padStart(3, "0");
    link.href = url;
    link.download = `ai-batch-results-${exportTimestamp(new Date())}-${counter}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const folderInputProps = { webkitdirectory: "true", directory: "true" } as any;

  return (
    <section className="ai-lab">
      <div className="panel ai-lab-panel">
        <h2>AI Batch Lab</h2>
        <div style={{ color: "#667", fontSize: 12, fontWeight: 700 }}>
          Version: {AI_LAB_VERSION}
        </div>
        <p>
          Temporary simulator for running 20 AI races on every track in the selected folder: 4 Novice, 6 Pro, 10 King.
        </p>

        <div className="ai-lab-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            multiple
            {...folderInputProps}
            onChange={handleFolder}
          />
          <button disabled={tracks.length === 0 || running} onClick={runBatch}>
            {running ? "Running..." : "Run AI Batch"}
          </button>
          <button disabled={!running} onClick={stopBatch}>
            Stop
          </button>
          <button disabled={results.length === 0 || running} onClick={downloadCsv}>
            Export CSV
          </button>
          <button disabled={!savedAt || running} onClick={restoreAutosave}>
            Restore Autosave
          </button>
          <button disabled={!savedAt || running} onClick={clearAutosave}>
            Clear Autosave
          </button>
        </div>

        <div className="readout">
          <strong>{progress || "Select the folder containing your track JSON files."}</strong>
          <span>Tracks loaded: {tracks.length}</span>
          <span>Planned runs: {tracks.length > 0 ? `${tracks.length} tracks x 20 = ${totalRuns}` : 0}</span>
          <span>Autosave: {savedAt ? new Date(savedAt).toLocaleString() : "none yet"}</span>
          <span>Autosave version: {AI_LAB_VERSION}</span>
          {error && <span style={{ color: "#b00020" }}>{error}</span>}
        </div>
      </div>

      {results.length > 0 && (
        <div className="panel ai-lab-panel">
          <h2>Summary</h2>
          <div className="ai-lab-table-wrap">
            <table className="ai-lab-table">
              <thead>
                <tr>
                  <th>Track / Level</th>
                  <th>Runs</th>
                  <th>Finished</th>
                  <th>Avg turns</th>
                  <th>Crashes</th>
                  <th>Timeouts</th>
                  <th>CPU limit</th>
                  <th>Max progress</th>
                  <th>Finish crosses</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary).map(([key, row]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{row.runs}</td>
                    <td>{row.finished}</td>
                    <td>{row.avgTurns.toFixed(1)}</td>
                    <td>{row.crashes}</td>
                    <td>{row.timeouts}</td>
                    <td>{row.cpuLimits}</td>
                    <td>{row.avgMaxProgress.toFixed(2)}</td>
                    <td>{row.finishCrossings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
