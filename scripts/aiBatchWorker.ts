import { parentPort, workerData } from "worker_threads";
import { AiBatchLevel, AiBatchRunResult, AiBatchTrack, simulateAiRun } from "../src/logic/aiBatchSimulator";

type WorkerPayload = {
  track: AiBatchTrack;
  level: AiBatchLevel;
  run: number;
  cpuLimitMs: number;
  aiCount: number;
};

const payload = workerData as WorkerPayload;

const started = new Date();
const result = simulateAiRun(payload.track, payload.level, payload.run, { cpuLimitMs: payload.cpuLimitMs, aiCount: payload.aiCount });
const finished = new Date();
const elapsedMs = finished.getTime() - started.getTime();

const timedResult: AiBatchRunResult = {
  ...result,
  startedAt: started.toISOString(),
  finishedAt: finished.toISOString(),
  elapsedMs,
  iterationsPerSecond: elapsedMs > 0 ? Math.round((result.iterations / elapsedMs) * 1000) : result.iterations,
};

parentPort?.postMessage(timedResult);
