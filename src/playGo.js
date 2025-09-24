/** @param {NS} ns */

/*******************************************************************************\
|* IPvGO Configuration                                                         *|
\*******************************************************************************/

const IPVGO_CONFIG = {
    // Strategy settings
    PASS_THRESHOLD: 0.15,          // Pass if win rate drops below 15%
    RESIGN_THRESHOLD: 0.05,        // Resign if win rate drops below 5%

    // Timing
    MOVE_DELAY: 1000,              // Wait 1 second between moves
    GAME_DELAY: 2000,              // Wait 2 seconds between games

    // Targeting
    PREFERRED_OPPONENTS: [         // Ordered by preference (easiest first)
        "Netburners",
        "Slum Snakes",
        "The Black Hand",
        "Tetrads",
        "Daedalus",
        "Illuminati"
    ],

    // Subnet preferences
    TARGET_SIZE: "medium",         // "small", "medium", "large", or "random"

    // Logging
    DETAILED_LOGGING: false,       // Show move-by-move analysis (default, can override with args)
    STATS_INTERVAL: 10,            // Show stats every N games
};

// ANSI Colors
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BLUE = "\u001b[34m";
const CYAN = "\u001b[36m";
const RESET = "\u001b[0m";

/*******************************************************************************\
|* IPvGO Game Logic                                                            *|
\*******************************************************************************/

class IPvGOPlayer {
    constructor(ns) {
        this.ns = ns;
        this.gamesPlayed = 0;
        this.wins = 0;
        this.losses = 0;
        this.stats = new Map(); // Track performance vs each opponent
    }

    getGameState() {
        try {
            return this.ns.go.getGameState();
        } catch (e) {
            return null;
        }
    }

    getBoardState() {
        try {
            return this.ns.go.getBoardState();
        } catch (e) {
            return null;
        }
    }

    getValidMoves() {
        try {
            return this.ns.go.getValidMoves();
        } catch (e) {
            return [];
        }
    }

    analyzePosition() {
        const gameState = this.getGameState();
        if (!gameState) return null;

        try {
            // Get current analysis from the game
            const analysis = this.ns.go.analysis.getLibertyCounts();
            const chains = this.ns.go.analysis.getChains();
            const controlledEmptyNodes = this.ns.go.analysis.getControlledEmptyNodes();

            return {
                gameState,
                analysis,
                chains,
                controlledEmptyNodes,
                validMoves: this.getValidMoves()
            };
        } catch (e) {
            // Fallback basic analysis
            return {
                gameState,
                validMoves: this.getValidMoves()
            };
        }
    }

    findBestMove() {
        const position = this.analyzePosition();
        if (!position || !position.validMoves || position.validMoves.length === 0) {
            return null;
        }

        const validMoves = position.validMoves;
        const gameState = position.gameState;

        if (IPVGO_CONFIG.DETAILED_LOGGING) {
            this.ns.print(`Analyzing ${validMoves.length} possible moves...`);
        }

        // Simple heuristic-based move selection
        let bestMove = null;
        let bestScore = -Infinity;

        for (const move of validMoves) {
            const score = this.evaluateMove(move, position);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        return bestMove;
    }

    evaluateMove(move, position) {
        // Basic move evaluation heuristics
        let score = 0;

        // Prefer moves that aren't on the edge (generally safer)
        const boardSize = position.gameState?.board?.length || 13;
        const [x, y] = move;

        // Distance from edges (center is better)
        const distFromEdge = Math.min(x, y, boardSize - 1 - x, boardSize - 1 - y);
        score += distFromEdge * 0.5;

        // Add some randomness to avoid predictable play
        score += Math.random() * 2;

        // Prefer moves that capture territory or defend
        if (position.analysis) {
            // More sophisticated analysis if available
            try {
                const chains = position.chains || [];
                const nearby = this.getNearbyPieces(move, position.gameState.board);

                // Bonus for connecting to our pieces
                if (nearby.ours > 0) score += nearby.ours * 3;

                // Penalty for dangerous moves near opponent
                if (nearby.theirs > nearby.ours) score -= nearby.theirs * 2;

            } catch (e) {
                // Ignore analysis errors
            }
        }

        return score;
    }

    getNearbyPieces(move, board) {
        const [x, y] = move;
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        let ours = 0, theirs = 0;

        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < board.length && ny >= 0 && ny < board[0].length) {
                if (board[nx][ny] === "X") ours++;
                else if (board[nx][ny] === "O") theirs++;
            }
        }

        return { ours, theirs };
    }

    shouldPass() {
        const gameState = this.getGameState();
        if (!gameState) return false;

        // Pass if we're winning by a lot or losing badly
        try {
            const score = this.ns.go.getScore();
            this.ns.print(`Score: ${JSON.stringify(score)}`);
            if (score && typeof score.territoryControl === 'number') {
                return score.territoryControl > 0.8 || score.territoryControl < IPVGO_CONFIG.PASS_THRESHOLD;
            }
        } catch (e) {
            // No score available, use move count heuristic
            const validMoves = this.getValidMoves();
            return validMoves.length < 3; // Pass if very few moves left
        }

        return false;
    }

    shouldResign() {
        try {
            const score = this.ns.go.getScore();
            if (score && typeof score.territoryControl === 'number') {
                return score.territoryControl < IPVGO_CONFIG.RESIGN_THRESHOLD;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    async makeMove() {
        if (this.shouldResign()) {
            this.ns.print(`${RED}Resigning - position too poor${RESET}`);
            return this.ns.go.resign();
        }

        if (this.shouldPass()) {
            this.ns.print(`${YELLOW}Passing - strategic decision${RESET}`);
            return this.ns.go.passTurn();
        }

        const move = this.findBestMove();
        if (!move) {
            this.ns.print(`${YELLOW}No valid moves - passing${RESET}`);
            return this.ns.go.passTurn();
        }

        const [x, y] = move;
        if (IPVGO_CONFIG.DETAILED_LOGGING) {
            this.ns.print(`Making move: (${x}, ${y})`);
        }

        return this.ns.go.makeMove(x, y);
    }

    async playGame() {
        this.ns.print(`${BLUE}=== playGame() starting ===${RESET}`);

        let moveCount = 0;
        const maxMoves = 200; // Safety limit

        while (moveCount < maxMoves) {
            this.ns.print(`${CYAN}--- Move ${moveCount + 1} ---${RESET}`);
            const gameState = this.ns.go.getGameState();
            if (!gameState) {
                this.ns.print(`${RED}Cannot get game state${RESET}`);
                break;
            }

            this.ns.print(`Current turn: ${gameState.currentPlayer}`);

            if (gameState.currentPlayer === "None") {
                this.ns.print(`${CYAN}Game over detected${RESET}`);
                this.handleGameEnd(gameState);
                break;
            }

            if (gameState.currentPlayer === "Black") {
                this.ns.print(`${CYAN}Our turn (Move ${moveCount + 1})${RESET}`);
                await this.makeMove();
                moveCount++;
            }

            await this.ns.sleep(IPVGO_CONFIG.MOVE_DELAY);
        }

        if (moveCount >= maxMoves) {
            this.ns.print(`${YELLOW}Game reached move limit - likely stuck${RESET}`);
        }

        this.ns.print(`${BLUE}=== playGame() ended ===${RESET}`);
    }

    handleGameEnd(gameState) {
        this.gamesPlayed++;

        try {
            const result = this.ns.go.getScore();
            const isWin = result && result.territoryControl > 0.5;

            if (isWin) {
                this.wins++;
                this.ns.print(`${GREEN}🎉 Victory! Territory control: ${(result.territoryControl * 100).toFixed(1)}%${RESET}`);
            } else {
                this.losses++;
                this.ns.print(`${RED}💀 Defeat. Territory control: ${(result.territoryControl * 100).toFixed(1)}%${RESET}`);
            }

            // Track opponent stats
            const opponent = gameState.opponent || "Unknown";
            if (!this.stats.has(opponent)) {
                this.stats.set(opponent, { wins: 0, losses: 0 });
            }
            const opponentStats = this.stats.get(opponent);
            if (isWin) opponentStats.wins++;
            else opponentStats.losses++;

        } catch (e) {
            this.ns.print(`${YELLOW}Game ended - result unclear${RESET}`);
        }

        this.showStats();
    }

    showStats() {
        if (this.gamesPlayed % IPVGO_CONFIG.STATS_INTERVAL === 0 || this.gamesPlayed <= 5) {
            const winRate = this.gamesPlayed > 0 ? (this.wins / this.gamesPlayed * 100).toFixed(1) : 0;
            this.ns.print(`${CYAN}--- Stats: ${this.wins}W-${this.losses}L (${winRate}% win rate) ---${RESET}`);

            // Show opponent breakdown
            for (const [opponent, stats] of this.stats) {
                const total = stats.wins + stats.losses;
                const rate = total > 0 ? (stats.wins / total * 100).toFixed(1) : 0;
                this.ns.print(`  ${opponent}: ${stats.wins}-${stats.losses} (${rate}%)`);
            }
        }
    }

    findBestOpponent() {
        // Try preferred opponents in order
        for (const opponent of IPVGO_CONFIG.PREFERRED_OPPONENTS) {
            try {
                if (this.ns.go.opponentStats(opponent)) {
                    return opponent;
                }
            } catch (e) {
                this.ns.print(`${RED}${e}${RESET}`);
                continue;
            }
        }
        return null;
    }

    startNewGame() {
        const opponent = this.findBestOpponent();
        if (!opponent) {
            this.ns.print(`${RED}No suitable opponents available${RESET}`);
            return false;
        }

        try {
            const boardSize = IPVGO_CONFIG.TARGET_SIZE === "random" ?
                ["small", "medium", "large"][Math.floor(Math.random() * 3)] :
                IPVGO_CONFIG.TARGET_SIZE;

            return this.ns.go.startGame(opponent, boardSize);
        } catch (e) {
            this.ns.print(`${RED}Failed to start game: ${e.message}${RESET}`);
            return false;
        }
    }
}

/*******************************************************************************\
|* Main Loop                                                                   *|
\*******************************************************************************/

export async function main(ns) {
    ns.disableLog("sleep");

    // Parse script arguments for logging
    const args = ns.args || [];
    if (args.includes("--log") || args.includes("--detailed-logging")) {
        IPVGO_CONFIG.DETAILED_LOGGING = true;
    }

    // Check if IPvGO is available
    if (!ns.go) {
        ns.tprint(`${RED}⚠️ IPvGO API not available! Make sure you have access to the minigame.${RESET}`);
        return;
    }

    const player = new IPvGOPlayer(ns);

    ns.tprint(`${GREEN}🔄 IPvGO automation started${RESET}`);
    ns.tprint(`Strategy: Target ${IPVGO_CONFIG.TARGET_SIZE} boards vs preferred opponents`);

    while (true) {
        try {
            // Check if we're already in a game
            const gameState = ns.go.getGameState();
            const opponent = ns.go.getOpponent();
            const currentPlayer = ns.go.getCurrentPlayer();

            if (gameState && currentPlayer !== "None") {
                // Continue existing game
                ns.print(`${YELLOW}Resuming existing game against ${opponent}${RESET}`);
                await player.playGame();
            } else {
                // Start new game
                if (player.startNewGame()) {
                    ns.print(`${GREEN}Started new game successfully${RESET}`);
                    await ns.sleep(1000); // Brief pause before starting
                    await player.playGame();
                } else {
                    ns.print(`${YELLOW}Could not start new game, retrying in 10 seconds...${RESET}`);
                    await ns.sleep(10000);
                }
            }

            // Pause between games
            await ns.sleep(IPVGO_CONFIG.GAME_DELAY);

        } catch (error) {
            ns.print(`${RED}Error: ${error.message}${RESET}`);
            await ns.sleep(5000);
        }
    }
}