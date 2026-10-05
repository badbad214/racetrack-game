"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const worker_threads_1 = require("worker_threads");
const aiBatchSimulator_1 = require("../src/logic/aiBatchSimulator");
const RUN_PLAN = [
    { level: "novice", count: 4 },
    { level: "pro", count: 6 },
    { level: "king", count: 10 },
];
const VALID_TYPES = new Set(["start", "straight", "curve90"]);
const RUNNER_VERSION = "node-ai-batch-runner-2026-05-17-08";
const AI_COUNT = 3;
const NODE_CPU_LIMIT_MS = {
    novice: 15000,
    pro: 18000,
    king: 22000,
};
const DEFAULT_WORKERS = Math.max(1, Math.min(os.cpus().length - 2, 10));
function pad(value) {
    return String(value).padStart(2, "0");
}
function timestamp(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function clock(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0)
        return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
    if (minutes > 0)
        return `${minutes}m ${pad(seconds)}s`;
    return `${seconds}s`;
}
function walkJsonFiles(folder) {
    const files = [];
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const fullPath = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkJsonFiles(fullPath));
        }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
            files.push(fullPath);
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
}
function parseTrack(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed))
        return null;
    const name = path.basename(filePath);
    const sections = parsed
        .filter((section) => VALID_TYPES.has(section === null || section === void 0 ? void 0 : section.type) &&
        Number.isFinite(section === null || section === void 0 ? void 0 : section.x) &&
        Number.isFinite(section === null || section === void 0 ? void 0 : section.y) &&
        Number.isFinite(section === null || section === void 0 ? void 0 : section.rotation))
        .map((section, index) => {
        var _a;
        return ({
            id: String((_a = section.id) !== null && _a !== void 0 ? _a : `${name}-${index}`),
            type: section.type,
            x: section.x,
            y: section.y,
            rotation: section.rotation,
        });
    });
    return sections.some((section) => section.type === "start") ? { name, sections } : null;
}
function loadTracks(folder) {
    const tracks = [];
    for (const filePath of walkJsonFiles(folder)) {
        try {
            const track = parseTrack(filePath);
            if (track)
                tracks.push(track);
        }
        catch (error) {
            console.warn(`[WARN] Ignored invalid track file: ${filePath}`);
        }
    }
    return tracks;
}
function nextCounter(outputDir) {
    if (!fs.existsSync(outputDir))
        fs.mkdirSync(outputDir, { recursive: true });
    let max = 0;
    for (const entry of fs.readdirSync(outputDir)) {
        const match = entry.match(/^ai-batch-results-\d{8}_\d{6}-(\d{3})\.csv$/);
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return String(max + 1).padStart(3, "0");
}
function writeCheckpoint(filePath, results, progress) {
    fs.writeFileSync(filePath, JSON.stringify({
        version: RUNNER_VERSION,
        savedAt: new Date().toISOString(),
        progress,
        results,
    }, null, 2));
}
function printSummary(results) {
    const summary = (0, aiBatchSimulator_1.summarizeResults)(results);
    console.log("");
    console.log("Summary:");
    for (const [key, row] of Object.entries(summary)) {
        console.log(`  ${key}: runs=${row.runs}, finished=${row.finished}, cpu-limit=${row.cpuLimits}, timeout=${row.timeouts}, avgTurns=${row.avgTurns.toFixed(1)}, avgProgress=${row.avgMaxProgress.toFixed(2)}`);
    }
}
function buildJobs(tracks) {
    const jobs = [];
    for (const track of tracks) {
        for (const item of RUN_PLAN) {
            for (let run = 1; run <= item.count; run++) {
                jobs.push({ index: jobs.length + 1, track, level: item.level, run });
            }
        }
    }
    return jobs;
}
function runJob(job) {
    return new Promise((resolve, reject) => {
        const worker = new worker_threads_1.Worker(path.join(__dirname, "aiBatchWorker.js"), {
            workerData: {
                track: job.track,
                level: job.level,
                run: job.run,
                cpuLimitMs: NODE_CPU_LIMIT_MS[job.level] * AI_COUNT,
                aiCount: AI_COUNT,
            },
        });
        worker.once("message", (result) => resolve(result));
        worker.once("error", reject);
        worker.once("exit", (code) => {
            if (code !== 0)
                reject(new Error(`Worker stopped with exit code ${code}`));
        });
    });
}
function usage() {
    console.log("Usage:");
    console.log('  npm run batch:ai -- "C:\\path\\to\\track-folder"');
    console.log("");
    console.log("Optional:");
    console.log('  npm run batch:ai -- "C:\\path\\to\\track-folder" "C:\\path\\to\\output-folder"');
    console.log("");
    console.log("Optional worker count:");
    console.log("  $env:AI_BATCH_WORKERS=8");
}
async function main() {
    const folderArg = process.argv[2];
    const outputArg = process.argv[3];
    if (!folderArg) {
        usage();
        process.exitCode = 1;
        return;
    }
    const trackFolder = path.resolve(folderArg);
    if (!fs.existsSync(trackFolder) || !fs.statSync(trackFolder).isDirectory()) {
        console.error(`[ERROR] Track folder not found: ${trackFolder}`);
        process.exitCode = 1;
        return;
    }
    const outputDir = outputArg ? path.resolve(outputArg) : path.join(process.cwd(), "ai-batch-output");
    const stamp = timestamp(new Date());
    const counter = nextCounter(outputDir);
    const csvPath = path.join(outputDir, `ai-batch-results-${stamp}-${counter}.csv`);
    const checkpointPath = path.join(outputDir, `ai-batch-checkpoint-${stamp}-${counter}.json`);
    const tracks = loadTracks(trackFolder);
    const jobs = buildJobs(tracks);
    const totalRuns = jobs.length;
    const results = [];
    let completed = 0;
    let nextJobIndex = 0;
    const batchStarted = new Date();
    const configuredWorkers = Number(process.env.AI_BATCH_WORKERS);
    const workerCount = Math.max(1, Math.min(Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? Math.floor(configuredWorkers) : DEFAULT_WORKERS, totalRuns || 1));
    console.log(`Version: ${RUNNER_VERSION}`);
    console.log("AI strategy: cached progress + bounded beam search");
    console.log(`Started: ${batchStarted.toLocaleString()}`);
    console.log(`Track folder: ${trackFolder}`);
    console.log(`Output CSV: ${csvPath}`);
    console.log(`Checkpoint: ${checkpointPath}`);
    console.log(`Tracks loaded: ${tracks.length}`);
    console.log(`AI cars per race: ${AI_COUNT}`);
    console.log(`Planned runs: ${tracks.length} tracks x 20 = ${totalRuns}`);
    console.log(`Workers: ${workerCount} (${os.cpus().length} logical CPUs detected; set AI_BATCH_WORKERS to override)`);
    console.log(`Per-race CPU caps: novice=${(NODE_CPU_LIMIT_MS.novice * AI_COUNT) / 1000}s, pro=${(NODE_CPU_LIMIT_MS.pro * AI_COUNT) / 1000}s, king=${(NODE_CPU_LIMIT_MS.king * AI_COUNT) / 1000}s`);
    if (tracks.length === 0) {
        console.error("[ERROR] No valid track JSON files found.");
        process.exitCode = 1;
        return;
    }
    async function launchNext() {
        var _a, _b;
        const job = jobs[nextJobIndex];
        if (!job)
            return;
        nextJobIndex += 1;
        const result = await runJob(job);
        results.push(result);
        completed += 1;
        const now = new Date();
        const elapsed = now.getTime() - batchStarted.getTime();
        const averageMs = elapsed / completed;
        const eta = new Date(now.getTime() + averageMs * (totalRuns - completed));
        const progress = `${completed}/${totalRuns}: ${result.track} ${result.level} ${result.run} (${AI_COUNT} AI) -> ${result.status}, winner=${(_a = result.winnerId) !== null && _a !== void 0 ? _a : "-"}, turns=${result.turns}, calculations=${result.iterations}, calc/s=${result.iterationsPerSecond}, progress=${result.maxProgress.toFixed(2)}, run=${formatDuration((_b = result.elapsedMs) !== null && _b !== void 0 ? _b : 0)}, elapsed=${formatDuration(elapsed)}, ETA=${clock(eta)}`;
        fs.writeFileSync(csvPath, (0, aiBatchSimulator_1.resultsToCsv)(results));
        writeCheckpoint(checkpointPath, results, progress);
        console.log(progress);
        await launchNext();
    }
    await Promise.all(Array.from({ length: workerCount }, () => launchNext()));
    const batchFinished = new Date();
    printSummary(results);
    console.log("");
    console.log(`Started: ${batchStarted.toLocaleString()}`);
    console.log(`Finished: ${batchFinished.toLocaleString()}`);
    console.log(`Elapsed: ${formatDuration(batchFinished.getTime() - batchStarted.getTime())}`);
    console.log(`Done. CSV saved to: ${csvPath}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
