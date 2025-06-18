// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static("public"));

// Game state
let players = {};
let playerOrder = [];
let currentQuestionIndex = 0;
let gameStarted = false;

// Sample decimal math questions and comparisons
const questions = [
  {
    question: "What is 0.6 × 0.2?",
    choices: ["0.12", "0.08", "0.18", "1.2"],
    answer: "0.12",
  },
  {
    question: "What is 3.6 ÷ 0.6?",
    choices: ["6", "0.6", "0.12", "2"],
    answer: "6",
  },
  {
    question: "Which is greater: 0.75 or 0.705?",
    choices: ["0.75", "0.705", "They're equal", "Cannot compare"],
    answer: "0.75",
  },
  {
    question: "What is 1.2 × 0.5?",
    choices: ["0.6", "0.24", "1.7", "0.7"],
    answer: "0.6",
  },
  {
    question: "What is 2.4 ÷ 0.8?",
    choices: ["3", "1.2", "2", "0.3"],
    answer: "3",
  },
  {
    question: "Is 0.9 less than, greater than, or equal to 0.99?",
    choices: ["Less than", "Greater than", "Equal to"],
    answer: "Less than",
  },
  {
    question: "What is 0.15 × 0.4?",
    choices: ["0.06", "0.6", "0.015", "0.004"],
    answer: "0.06",
  },
  {
    question: "Which is equal: 0.7 or 0.70?",
    choices: ["0.7", "0.70", "They're equal", "Cannot compare"],
    answer: "They're equal",
  },
  {
    question: "What is 4.2 ÷ 0.7?",
    choices: ["6", "0.6", "0.42", "7"],
    answer: "6",
  },
  {
    question: "Is 0.33 greater than, less than, or equal to 1/3?",
    choices: ["Greater than", "Less than", "Equal to"],
    answer: "Less than",
  },
];

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Player joins with name
  socket.on("joinGame", (name) => {
    if (gameStarted) {
      socket.emit("gameAlreadyStarted");
      return;
    }
    players[socket.id] = {
      id: socket.id,
      name,
      crypto: 0,
      hacked: false,
    };
    playerOrder.push(socket.id);

    // Update lobby
    io.emit("lobbyUpdate", Object.values(players));
  });

  // Host starts the game
  socket.on("startGame", () => {
    if (gameStarted) return;
    if (playerOrder.length < 2) {
      socket.emit("errorMsg", "Need at least 2 players to start.");
      return;
    }
    gameStarted = true;
    currentQuestionIndex = 0;

    io.emit("gameStarted");
    sendQuestionToAll();
  });

  // Receive answer
  socket.on("submitAnswer", (choice) => {
    if (!gameStarted) return;

    const player = players[socket.id];
    if (!player) return;

    if (player.answeredThisRound) return; // prevent multiple answers

    player.answeredThisRound = true;
    const question = questions[currentQuestionIndex];
    if (choice === question.answer) {
      player.crypto += 10; // +10 crypto for correct
      socket.emit("answerResult", true);
    } else {
      socket.emit("answerResult", false);
    }

    checkRoundCompletion();
  });

  // Player requests to hack another player
  socket.on("hackPlayer", (targetId) => {
    if (!gameStarted) return;

    const player = players[socket.id];
    const target = players[targetId];
    if (!player || !target) return;

    if (player.crypto < 20) {
      socket.emit("errorMsg", "You need at least 20 crypto to hack.");
      return;
    }

    if (player.hackedThisRound) {
      socket.emit("errorMsg", "You already hacked this round.");
      return;
    }

    player.crypto -= 20; // cost to hack
    player.hackedThisRound = true;

    // Steal random 5-15 crypto from target (if available)
    const stolen = Math.min(target.crypto, Math.floor(Math.random() * 11) + 5);
    target.crypto -= stolen;
    player.crypto += stolen;

    io.to(targetId).emit("hackedBy", player.name, stolen);
    socket.emit("hackResult", stolen, target.name);

    // Update leaderboard after hack
    io.emit("leaderboardUpdate", getLeaderboard());
  });

  // Player disconnects
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    playerOrder = playerOrder.filter((id) => id !== socket.id);
    io.emit("lobbyUpdate", Object.values(players));

    // If no players left, reset game
    if (playerOrder.length === 0) {
      resetGame();
    }
  });

  // Player ready for next question
  socket.on("nextQuestionReady", () => {
    const player = players[socket.id];
    if (!player) return;
    player.readyNext = true;

    // Check if all ready
    if (playerOrder.every((id) => players[id]?.readyNext)) {
      currentQuestionIndex++;
      if (currentQuestionIndex >= questions.length) {
        endGame();
      } else {
        resetRoundFlags();
        sendQuestionToAll();
      }
    }
  });

  // Helper functions
  function sendQuestionToAll() {
    const q = questions[currentQuestionIndex];
    io.emit("newQuestion", {
      index: currentQuestionIndex + 1,
      total: questions.length,
      question: q.question,
      choices: q.choices,
      leaderboard: getLeaderboard(),
    });
  }

  function checkRoundCompletion() {
    // If all players answered
    if (
      playerOrder.every(
        (id) => players[id]?.answeredThisRound || players[id]?.hackedThisRound
      )
    ) {
      // Send leaderboard update
      io.emit("leaderboardUpdate", getLeaderboard());
    }
  }

  function getLeaderboard() {
    // Sort players by crypto desc
    return Object.values(players)
      .map(({ name, crypto }) => ({ name, crypto }))
      .sort((a, b) => b.crypto - a.crypto);
  }

  function resetRoundFlags() {
    playerOrder.forEach((id) => {
      if (players[id]) {
        players[id].answeredThisRound = false;
        players[id].hackedThisRound = false;
        players[id].readyNext = false;
      }
    });
  }

  function endGame() {
    gameStarted = false;
    io.emit("gameEnded", getLeaderboard());
    resetGame();
  }

  function resetGame() {
    players = {};
    playerOrder = [];
    currentQuestionIndex = 0;
    gameStarted = false;
  }
});

app.get("/test", (req, res) => {
  res.send("Running SoloOS | Version 9.3.2");
});


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
