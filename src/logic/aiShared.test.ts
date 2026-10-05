import { filterPostCrashRestartMoves, scorePostCrashRestartMove } from "./aiShared";

test("post-crash restart prefers forward moves over backward ones", () => {
  const player = { x: 100, y: 100, dx: 0, dy: 0, penalties: 1 };
  const context = {
    direction: { x: 1, y: 0 },
    centerPenalty: (x: number) => (x === 130 ? 0 : 10),
  };

  const backwardMove = { x: 70, y: 100, dx: -30, dy: 0 };
  const forwardMove = { x: 130, y: 100, dx: 30, dy: 0 };

  const forwardScore = scorePostCrashRestartMove(player, forwardMove, context);
  const backwardScore = scorePostCrashRestartMove(player, backwardMove, context);
  expect(forwardScore).toBeGreaterThan(backwardScore);

  const filtered = filterPostCrashRestartMoves(player, [backwardMove, forwardMove], context);
  expect(filtered[0]).toEqual(forwardMove);
});