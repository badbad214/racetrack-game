"use strict";
// === PlayerInitializer.ts ===
// Creates initial player list based on track layout
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializePlayers = void 0;
const PlayerPositionHelper_1 = require("./PlayerPositionHelper");
// Fixed color palette for up to 4 players
const PLAYER_COLORS = ["red", "blue", "green", "orange"];
// Initialize players at valid spawn positions on the start tile
function initializePlayers(sections, playerCount) {
    const players = [];
    // Safety check
    if (playerCount < 1 || playerCount > 4) {
        console.warn("[ASSERT] Invalid player count:", playerCount);
        return players;
    }
    // Find the start tile
    const startTile = sections.find(s => s.type === "start");
    if (!startTile) {
        console.warn("[ASSERT] No start tile found");
        return players;
    }
    // Get allowed player positions for the start tile
    const positions = (0, PlayerPositionHelper_1.getAllowedPlayerPositions)(startTile);
    // Use the first N valid positions for players
    for (let i = 0; i < playerCount; i++) {
        if (i >= positions.length) {
            console.warn(`[ASSERT] Not enough spawn positions for ${playerCount} players`);
            break;
        }
        const pos = positions[i];
        const player = {
            id: i + 1,
            x: pos.x,
            y: pos.y,
            dx: pos.dx,
            dy: pos.dy,
            color: PLAYER_COLORS[i],
            trail: [{ x: pos.x, y: pos.y }],
            penalties: 0,
        };
        players.push(player);
    }
    // Final runtime assertions
    if (players.length !== playerCount) {
        console.warn("[ASSERT] Failed to initialize correct number of players");
    }
    return players;
}
exports.initializePlayers = initializePlayers;
