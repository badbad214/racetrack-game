export type AiLevel = "novice" | "pro" | "king";

export type AiTuning = {
  depth: number;
  budget: number;
  prune: number;
  beamWidth: number;
};

export const AI_TUNING: Record<AiLevel, AiTuning> = {
  novice: { depth: 4, budget: 2500, prune: 5, beamWidth: 14 },
  pro: { depth: 6, budget: 6000, prune: 6, beamWidth: 24 },
  king: { depth: 12, budget: 12000, prune: 8, beamWidth: 36 },
};

export type RestartDirection = { x: number; y: number } | null;

export type RestartMove = {
  x: number;
  y: number;
  dx: number;
  dy: number;
};

export type RestartPlayer = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  penalties?: number;
};

export type RestartScoringContext = {
  direction: RestartDirection;
  centerPenalty: (x: number, y: number) => number;
};

export function isPostCrashRestartState(player: Pick<RestartPlayer, "dx" | "dy" | "penalties">): boolean {
  return player.dx === 0 && player.dy === 0 && (player.penalties ?? 0) > 0;
}

export function scorePostCrashRestartMove(
  player: RestartPlayer,
  move: RestartMove,
  context: RestartScoringContext,
): number {
  const travelX = move.x - player.x;
  const travelY = move.y - player.y;
  const directionGain = context.direction ? travelX * context.direction.x + travelY * context.direction.y : 0;
  const centerGain = context.centerPenalty(player.x, player.y) - context.centerPenalty(move.x, move.y);
  return directionGain * 100 + centerGain;
}

export function filterPostCrashRestartMoves<T extends RestartMove>(
  player: RestartPlayer,
  moves: T[],
  context: RestartScoringContext,
): T[] {
  if (!isPostCrashRestartState(player) || moves.length <= 1) return moves;

  const scoredMoves = moves.map((move) => ({
    move,
    score: scorePostCrashRestartMove(player, move, context),
  }));

  const forwardMoves = scoredMoves.filter(({ score }) => score >= 0);
  const candidates = forwardMoves.length > 0 ? forwardMoves : scoredMoves;
  const centerImproving = candidates.filter(({ move }) =>
    context.centerPenalty(move.x, move.y) <= context.centerPenalty(player.x, player.y) + 2
  );

  return (centerImproving.length > 0 ? centerImproving : candidates).map(({ move }) => move);
}