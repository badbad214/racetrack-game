"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const aiBatchSimulator_1 = require("../src/logic/aiBatchSimulator");
const payload = worker_threads_1.workerData;
const started = new Date();
const result = (0, aiBatchSimulator_1.simulateAiRun)(payload.track, payload.level, payload.run, { cpuLimitMs: payload.cpuLimitMs, aiCount: payload.aiCount });
const finished = new Date();
const elapsedMs = finished.getTime() - started.getTime();
const timedResult = {
    ...result,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    elapsedMs,
    iterationsPerSecond: elapsedMs > 0 ? Math.round((result.iterations / elapsedMs) * 1000) : result.iterations,
};
worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage(timedResult);
