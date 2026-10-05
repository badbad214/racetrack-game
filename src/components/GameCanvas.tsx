// src/components/GameCanvas.tsx
// Concept 9 — Race Phase canvas with click-to-move using your helpers.
// Power of 10: no recursion, functions short, 2+ runtime assertions per function, fixed loop bounds in for-loops.

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Player, Section } from "../types/types";


// ⛳️ Adjust these imports if your folder names differ
import { getValidMovesForPlayer, Move } from "../logic/getValidMovesForPlayer";

interface GameCanvasProps {
  size: number;
  tileSize?: number;   // default 90
  spacing?: number;    // default 15
  sections: Section[]; // track tiles (core only is fine if your move-gen assumes that)
  players: Player[];   // current players with x,y,dx,dy,color
  currentPlayerIndex: number; // whose turn it is
  onCommitMove: (updated: Player) => void; // parent will replace player and advance turn
  showValidDots?: boolean;
  raceForward?: { x: number; y: number } | null;
  enableClicks?: boolean;
  normalizeMoves?: (moves: Move[], player: Player) => Move[];
}

/**
 * Draws the track grid, players, and clickable valid moves for the current RL player.
 * Keeps all drawing and hit-testing here so GamePlay stays the conductor.
 */
export const GameCanvas: React.FC<GameCanvasProps> = ({
  size,
  tileSize = 90,
  spacing = 15,
  sections,
  players,
  currentPlayerIndex,
  onCommitMove,
  showValidDots = true,
  raceForward = null,
  enableClicks = true,
  normalizeMoves,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const currentPlayer = useMemo(() => {
    const idxOk = currentPlayerIndex >= 0 && currentPlayerIndex < players.length;
    console.assert(Array.isArray(players), "players must be an array");
    console.assert(idxOk, "currentPlayerIndex must be in range");
    if (!idxOk) return null;
    return players[currentPlayerIndex];
  }, [players, currentPlayerIndex]);

  // ---- helpers (short, with assertions) ----

  function moveLandingKey(move: Move): string {
    const x = move.crash ? move.safeX : move.x;
    const y = move.crash ? move.safeY : move.y;
    return `${x},${y}`;
  }

  function computeValidMoves(): Move[] {
    const p = currentPlayer;
    console.assert(!!p, "current player must exist");
    if (!p) return [];

    const moves = getValidMovesForPlayer(p, sections) || []; // ← only 2 args
    const occupied = new Set(
      players
        .filter((player, index) => index !== currentPlayerIndex)
        .map((player) => `${player.x},${player.y}`)
    );
    const isFirstRaceMove = (p.trail?.length ?? 0) <= 1;
    const directionFilteredMoves = raceForward && p.dx === 0 && p.dy === 0 && isFirstRaceMove
      ? moves.filter((move) => ((move.x - p.x) * raceForward.x + (move.y - p.y) * raceForward.y) > 0)
      : moves;
    const normalizedMoves = normalizeMoves ? normalizeMoves(directionFilteredMoves, p) : directionFilteredMoves;
    const unoccupiedMoves = normalizedMoves.filter((move) => !occupied.has(moveLandingKey(move)));

    console.assert(Array.isArray(moves), "getValidMovesForPlayer must return an array");
    return unoccupiedMoves.map((move) => ({
      ...move,
      crash: move.crash,
    }));
  }

  const validMoves = useMemo(computeValidMoves, [currentPlayer, players, sections, currentPlayerIndex, raceForward, normalizeMoves]);

  function getMoveDisplayPoint(move: Move): { x: number; y: number } {
    if (move.crash && Number.isFinite(move.safeX) && Number.isFinite(move.safeY)) {
      return { x: move.safeX, y: move.safeY };
    }
    return { x: move.x, y: move.y };
  }

  // ---- events ----
  function pickMoveIndexAt(x: number, y: number): number {
    // Hit-test within 8px radius around dot centers
    for (let i = 0; i < validMoves.length; i++) {
      const display = getMoveDisplayPoint(validMoves[i]);
      const dx = display.x - x;
      const dy = display.y - y;
      if ((dx * dx + dy * dy) <= 64) return i; // 8px radius
    }
    return -1;
  }

  function handlePointerMove(evt: React.MouseEvent<HTMLCanvasElement>): void {
    if (!showValidDots) { setHoverIdx(null); return; }
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    const idx = pickMoveIndexAt(px, py);
    setHoverIdx(idx >= 0 ? idx : null);
  }

  function handlePointerClick(evt: React.MouseEvent<HTMLCanvasElement>): void {
    if (!enableClicks) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    const idx = pickMoveIndexAt(px, py);
    if (idx < 0) return;

    const p = currentPlayer;
    if (!p) return;

    const chosen = validMoves[idx];
    // Build next player state with updated velocity & position
    const next: Player = {
      ...p,
      x: chosen.crash ? chosen.safeX : chosen.x,
      y: chosen.crash ? chosen.safeY : chosen.y,
      dx: chosen.crash ? 0 : chosen.dx,
      dy: chosen.crash ? 0 : chosen.dy,
      penalties: (p.penalties ?? 0) + (chosen.crash ? 1 : 0),
    };

    onCommitMove(next);
  }

  // ---- lifecycle ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < players.length; i++) {
      const trail = players[i].trail ?? [];
      if (trail.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let j = 1; j < trail.length; j++) {
        ctx.lineTo(trail[j].x, trail[j].y);
      }
      ctx.strokeStyle = players[i].color || "#111";
      ctx.lineWidth = i === currentPlayerIndex ? 3 : 2;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const sx = p.x;
      const sy = p.y;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = i === currentPlayerIndex ? p.color || "red" : (p.color || "#666");
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    if (showValidDots) {
      for (let i = 0; i < validMoves.length; i++) {
        const m = validMoves[i];
        const display = getMoveDisplayPoint(m);
        const sx = display.x;
        const sy = display.y;
        ctx.beginPath();
        ctx.arc(sx, sy, i === hoverIdx ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = m.crash ? "#ff595e" : "yellow";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, [size, players, currentPlayerIndex, validMoves, hoverIdx, showValidDots]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      onMouseMove={handlePointerMove}
      onClick={handlePointerClick}
      style={{
        background: "transparent",
        border: "none",
        display: "block",
        inset: 0,
        position: "absolute",
        zIndex: 20,
      }}
    />
  );
};
