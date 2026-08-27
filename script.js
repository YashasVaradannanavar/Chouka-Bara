// ============================================================
// YATRA KINGDOMS — FINAL
// ============================================================

// Existing authentication system
const GOOGLE_CLIENT_ID =
  "33548652224-ieojbv1tn67t8a3n457r6c42hol5vt3n.apps.googleusercontent.com";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwY-XeVrowYic6_GCWtmxtPp-QvpKP7U1MvovUAIzp3LAvyADyNF8dxjv9ku2A6sbYo/exec";

// Separate GAME DATA Google Sheet
const GAME_SHEET_ID =
  "1p9gQpD_aKGBZtbqHqu2haaK1F1EP3bpDcTW8x-lsiCw";

const STARTING_POINTS = 3000;
const RIDDLE_COST = 500;
const CORRECT_REWARD = 1000;
const RIDDLE_SECONDS = 90;

const SHEETS = {
  characters: "Characters",
  riddles: "Riddles",
  advantages: "Advantages"
};

let currentUser = null;
let gameData = { characters: [], riddles: [], advantages: [] };
let players = [];
let selectedPlayer = 0;
let selectedDifficulty = null;
let currentRiddle = null;
let timerId = null;
let timerValue = RIDDLE_SECONDS;
let audioContext = null;
let pendingCharacterPlayer = null;
let pendingAdvantageIndex = null;
let selectedGame = null;
let selectedTheme = 'rajya';
let currentGameSlide = 0;
let gameDataLoaded = false;

// One Google account can have only one active browser session.
let deviceSessionId = null;
let sessionHeartbeatId = null;
let activityCheckId = null;
let lastUserActivity = Date.now();
let sessionReleased = false;
let gameSessionStarted = false;
const AFK_LIMIT_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const screenIds = [
  "gameSelectionScreen",
  "themeSelectionScreen",
  "setupScreen",
  "dashboardScreen",
  "profileScreen",
  "difficultyScreen",
  "riddleScreen",
  "characterActionScreen",
  "advantageScreen"
];

document.addEventListener("DOMContentLoaded", () => {
  bindTapSounds();
  bindUI();
  bindActivityTracking();
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("beforeunload", handleBeforeUnload);
  initGoogleWhenReady();
});

// ============================================================
// DEVICE SESSION / AFK CONTROL
// ============================================================

function createSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function bindActivityTracking() {
  const events = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"];
  events.forEach(type => {
    window.addEventListener(type, () => {
      lastUserActivity = Date.now();
    }, { passive: true });
  });
}

function startSessionWatch() {
  stopSessionWatch();
  lastUserActivity = Date.now();
  sessionReleased = false;

  sessionHeartbeatId = setInterval(async () => {
    if (!currentUser || !deviceSessionId || sessionReleased) return;

    if (Date.now() - lastUserActivity >= AFK_LIMIT_MS) {
      await kickForAfk();
      return;
    }

    try {
      const result = await callAppsScript("heartbeat", {
        email: currentUser.email,
        googleId: currentUser.sub,
        sessionId: deviceSessionId
      });

      if (!result.valid) {
        await handleSessionLost(result.message || "This device session is no longer active.");
      }
    } catch (error) {
      console.warn("Session heartbeat failed:", error);
    }
  }, HEARTBEAT_MS);

  activityCheckId = setInterval(async () => {
    if (!currentUser || !deviceSessionId || sessionReleased) return;
    if (Date.now() - lastUserActivity >= AFK_LIMIT_MS) {
      await kickForAfk();
    }
  }, 10000);
}

function stopSessionWatch() {
  if (sessionHeartbeatId) clearInterval(sessionHeartbeatId);
  if (activityCheckId) clearInterval(activityCheckId);
  sessionHeartbeatId = null;
  activityCheckId = null;
}

async function claimDeviceSession() {
  deviceSessionId = sessionStorage.getItem("yatraDeviceSessionId") || createSessionId();
  sessionStorage.setItem("yatraDeviceSessionId", deviceSessionId);
  sessionReleased = false;

  const result = await callAppsScript("claimSession", {
    email: currentUser.email,
    googleId: currentUser.sub,
    sessionId: deviceSessionId,
    name: currentUser.name
  });

  if (!result.valid) {
    deviceSessionId = null;
    return result;
  }

  startSessionWatch();
  return result;
}

async function releaseDeviceSession(reason = "Signed out") {
  if (!currentUser || !deviceSessionId || sessionReleased) return;

  sessionReleased = true;
  stopSessionWatch();

  try {
    await callAppsScript("endSession", {
      email: currentUser.email,
      googleId: currentUser.sub,
      sessionId: deviceSessionId,
      reason
    });
  } catch (error) {
    console.warn("Could not release device session:", error);
  }

  deviceSessionId = null;
  sessionStorage.removeItem("yatraDeviceSessionId");
}

function releaseDeviceSessionBeacon(reason = "Browser closed") {
  if (!currentUser || !deviceSessionId || sessionReleased) return;

  sessionReleased = true;
  stopSessionWatch();
  sessionStorage.removeItem("yatraDeviceSessionId");

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "endSession");
  url.searchParams.set("email", currentUser.email || "");
  url.searchParams.set("googleId", currentUser.sub || "");
  url.searchParams.set("sessionId", deviceSessionId || "");
  url.searchParams.set("reason", reason);

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url.toString(), "");
    } else {
      fetch(url.toString(), { method: "GET", keepalive: true }).catch(() => {});
    }
  } catch (error) {
    try {
      fetch(url.toString(), { method: "GET", keepalive: true }).catch(() => {});
    } catch (_) {}
  }
}

async function kickForAfk() {
  if (!currentUser || !deviceSessionId || sessionReleased) return;

  await releaseDeviceSession("AFK Kicked");
  stopTimer();
  players = [];
  currentRiddle = null;
  gameDataLoaded = false;
  gameSessionStarted = false;

  localStorage.removeItem("yatraGoogleUser");
  localStorage.removeItem("yatraActivated");
  localStorage.removeItem("yatraActivationCode");
  localStorage.removeItem("yatraActivationEmail");

  currentUser = null;
  showAuthCard("login");

  setMessage(
    document.getElementById("loginMessage"),
    "AFK Kicked — you were inactive for 5 minutes. The device is now released.",
    "error"
  );

  if (window.google?.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
}

async function handleSessionLost(message) {
  await releaseDeviceSession("Session lost");
  stopTimer();
  stopSessionWatch();
  deviceSessionId = null;
  sessionStorage.removeItem("yatraDeviceSessionId");
  sessionReleased = false;
  gameSessionStarted = false;
  currentUser = null;
  players = [];
  currentRiddle = null;
  gameDataLoaded = false;
  gameSessionStarted = false;

  localStorage.removeItem("yatraGoogleUser");
  localStorage.removeItem("yatraActivated");
  localStorage.removeItem("yatraActivationCode");
  localStorage.removeItem("yatraActivationEmail");

  showAuthCard("login");
  setMessage(
    document.getElementById("loginMessage"),
    message || "This session is no longer active. Please sign in again.",
    "error"
  );
}

function handlePageHide() {
  if (currentUser && deviceSessionId && !sessionReleased) {
    releaseDeviceSessionBeacon("Browser closed");
  }
}

function handleBeforeUnload() {
  if (currentUser && deviceSessionId && !sessionReleased) {
    releaseDeviceSessionBeacon("Browser closed");
  }
}

async function startServerGameTimer() {
  if (!currentUser || !deviceSessionId || gameSessionStarted) return;

  try {
    const result = await callAppsScript("startGameSession", {
      email: currentUser.email,
      googleId: currentUser.sub,
      sessionId: deviceSessionId,
      game: selectedGame || "chouka-bara",
      theme: selectedTheme || "rajya",
      playerCount: players.length
    });

    if (result.valid) {
      gameSessionStarted = true;
    } else if (result.sessionLost) {
      await handleSessionLost(result.message);
    }
  } catch (error) {
    console.warn("Could not start server game timer:", error);
  }
}

// ============================================================
// GLOBAL TAP SOUNDS
// ============================================================

function bindTapSounds() {
  // Use pointerdown so the sound starts immediately on mouse/touch.
  // Event delegation also covers buttons/cards created dynamically later.
  document.addEventListener("pointerdown", event => {
    const target = event.target.closest(
      "button, a, input, select, textarea, summary, [role=\"button\"], [tabindex]:not([tabindex=\"-1\"]), .player-card, .theme-card, .difficulty, .game-slide"
    );

    if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") {
      return;
    }

    // Tiny, soft UI click — intentionally much quieter than the timer beep.
    playTapSound();
  }, { passive: true });
}


function bindUI() {
  document.querySelectorAll("#playerCountButtons button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#playerCountButtons button")
        .forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderPlayerInputs(Number(btn.dataset.count));
    });
  });

  document.getElementById("beginGame").addEventListener("click", startGame);
  document.getElementById("solveRiddleBtn").addEventListener("click", openDifficulty);
  document.getElementById("useCharacterBtn").addEventListener("click", useCharacterAbility);
  const gameCarousel = document.getElementById("gameCarousel");
  if (gameCarousel) {
    gameCarousel.addEventListener("click", e => {
      const btn = e.target.closest(".select-game-btn");
      if (!btn || btn.disabled) return;
      selectGame(btn.dataset.game);
    });
  }

  document.getElementById("backToGames").addEventListener("click", () => {
    showScreen("gameSelectionScreen");
    updateGameCarousel();
  });

  document.querySelectorAll(".theme-card").forEach(card => {
    card.addEventListener("click", () => selectTheme(card.dataset.theme));
  });

  document.getElementById("gamePrev").addEventListener("click", () => moveGameSlide(-1));
  document.getElementById("gameNext").addEventListener("click", () => moveGameSlide(1));
  document.querySelectorAll("#gameDots button").forEach(dot => {
    dot.addEventListener("click", () => {
      currentGameSlide = Number(dot.dataset.slide);
      updateGameCarousel();
    });
  });

  initGameSwipe();

  document.getElementById("nextTurnBtn").addEventListener("click", nextTurn);
  document.getElementById("backDashboard").addEventListener("click", () => showScreen("dashboardScreen"));
  document.getElementById("closeAdvantages").addEventListener("click", () => showScreen("profileScreen"));
  document.getElementById("characterDoneBtn").addEventListener("click", confirmCharacterUse);
  document.getElementById("cancelCharacterBtn").addEventListener("click", () => showScreen("profileScreen"));
  document.getElementById("modalUseAdvantage").addEventListener("click", useEarnedAdvantage);
  document.getElementById("modalDiscardAdvantage").addEventListener("click", discardEarnedAdvantage);
  document.getElementById("doneAdvantage").addEventListener("click", confirmAdvantageUse);
  document.getElementById("backFromRiddle").addEventListener("click", () => showScreen("dashboardScreen"));
  document.getElementById("logout").addEventListener("click", logout);
  document.getElementById("logout2").addEventListener("click", logout);

  document.getElementById("newGameBtn").addEventListener("click", newGame);

  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });

  // Difficulty buttons use event delegation so they always work,
  // even if the screen was rendered again later.
  document.addEventListener("click", event => {
    const btn = event.target.closest(".difficulty");
    if (!btn || btn.disabled) return;
    startRiddle(btn.dataset.difficulty);
  });
}

function initGoogleWhenReady() {
  if (window.google?.accounts?.id) {
    initGoogle();
  } else {
    setTimeout(initGoogleWhenReady, 250);
  }
}

function initGoogle() {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin,
    auto_select: false
  });

  google.accounts.id.renderButton(
    document.getElementById("googleBtn"),
    {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: 280
    }
  );

  restoreLocalSession();
}

async function handleGoogleLogin(response) {
  try {
    const payload = parseJwt(response.credential);

    currentUser = {
      sub: payload.sub,
      name: payload.name || "Yatra Player",
      email: payload.email || "",
      picture: payload.picture || ""
    };

    localStorage.setItem("yatraGoogleUser", JSON.stringify(currentUser));
    setUserCard();
    await checkExistingActivation();
  } catch (error) {
    console.error("Google login error:", error);
    setMessage(
      document.getElementById("loginMessage"),
      "Google login failed. Please try again.",
      "error"
    );
  }
}

function setUserCard() {
  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userEmail").textContent = currentUser.email;
  const avatar = document.getElementById("avatar");
  avatar.src = currentUser.picture || "";
  avatar.style.display = currentUser.picture ? "block" : "none";
}

async function checkExistingActivation() {
  showAuthCard("activation");

  setMessage(
    document.getElementById("activationMessage"),
    "Checking your Yatra activation..."
  );

  try {
    const result = await callAppsScript("checkUser", {
      email: currentUser.email,
      googleId: currentUser.sub
    });

    if (result.valid === true) {
      const session = await claimDeviceSession();

      if (!session.valid) {
        showAuthCard("login");
        setMessage(
          document.getElementById("loginMessage"),
          session.message || "This Google account is already active on another device.",
          "error"
        );
        return;
      }

      localStorage.setItem("yatraActivated", "true");
      localStorage.setItem("yatraActivationCode", result.code || "");
      localStorage.setItem("yatraActivationEmail", currentUser.email);
      await enterGame();
    } else {
      setMessage(
        document.getElementById("activationMessage"),
        "Your Google account is not activated yet. Enter your activation code."
      );
    }
  } catch (error) {
    console.error("Activation check:", error);
    setMessage(
      document.getElementById("activationMessage"),
      error.message || "Could not check your activation status.",
      "error"
    );
  }
}

document.getElementById("activate").addEventListener("click", async () => {
  const code = document.getElementById("code").value.trim().toUpperCase();

  if (!code) {
    setMessage(
      document.getElementById("activationMessage"),
      "Please enter your activation code.",
      "error"
    );
    return;
  }

  setMessage(
    document.getElementById("activationMessage"),
    "Verifying activation code..."
  );

  try {
    const result = await callAppsScript("activate", {
      email: currentUser.email,
      googleId: currentUser.sub,
      name: currentUser.name,
      code
    });

    if (!result.valid) {
      setMessage(
        document.getElementById("activationMessage"),
        result.message || "Activation failed.",
        "error"
      );
      return;
    }

    const session = await claimDeviceSession();

    if (!session.valid) {
      showAuthCard("login");
      setMessage(
        document.getElementById("loginMessage"),
        session.message || "This Google account is already active on another device.",
        "error"
      );
      return;
    }

    localStorage.setItem("yatraActivated", "true");
    localStorage.setItem("yatraActivationCode", result.code || code);
    localStorage.setItem("yatraActivationEmail", currentUser.email);
    await enterGame();
  } catch (error) {
    console.error("Activation:", error);
    setMessage(
      document.getElementById("activationMessage"),
      error.message || "Could not contact the activation server.",
      "error"
    );
  }
});

async function callAppsScript(action, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value == null ? "" : String(value));
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Apps Script returned HTTP ${response.status}.`);
  }

  const text = await response.text();

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Apps Script returned an invalid response.");
  }

  if (result && result.valid === false && action !== "checkUser" && action !== "activate") {
    throw new Error(result.message || "Apps Script rejected the request.");
  }

  return result;
}

async function restoreLocalSession() {
  // Do NOT use localStorage as proof of Google authentication.
  // A previous browser session must never bypass the Google Sign-In screen.
  currentUser = null;
  players = [];
  currentRiddle = null;
  gameDataLoaded = false;

  localStorage.removeItem("yatraGoogleUser");
  localStorage.removeItem("yatraActivated");
  localStorage.removeItem("yatraActivationCode");
  localStorage.removeItem("yatraActivationEmail");

  showAuthCard("login");
}

async function enterGame() {
  // Every successful Google authentication starts a NEW game setup.
  // Never restore the previous local game automatically.
  stopTimer();

  if (currentUser) {
    localStorage.removeItem(gameStorageKey());
  }

  players = [];
  selectedPlayer = 0;
  currentRiddle = null;
  pendingCharacterPlayer = null;
  gameSessionStarted = false;

  showAuthCard("game");

  document.getElementById("welcomeName").textContent =
    (currentUser?.name || "Player").split(" ")[0];

  document.getElementById("playerInputs").innerHTML = "";
  document.querySelectorAll("#playerCountButtons button")
    .forEach(b => b.classList.remove("selected"));

  document.getElementById("beginGame").disabled = true;

  selectedGame = null;
  selectedTheme = "rajya";
  currentGameSlide = 0;
  applyTheme("rajya");
  updateGameCarousel();

  showScreen("gameSelectionScreen");

  // Load game data in the background while the player chooses.
  loadGameData();
}


function selectGame(game) {
  if (game !== "chouka-bara") return;

  selectedGame = game;
  selectedTheme = "rajya";
  document.getElementById("brandGameLabel").innerHTML = "CHOUKA<br><b>BARA</b>";
  document.getElementById("chapterLabel").innerHTML = "CHOOSE YOUR THEME <span>🎨</span>";
  showScreen("themeSelectionScreen");
}

function selectTheme(theme) {
  const allowed = ["rajya", "navarasa", "panchabootha", "kala", "kshetra"];
  if (!allowed.includes(theme)) return;

  selectedTheme = theme;
  localStorage.setItem("selectedTheme", theme);
  applyTheme(theme);

  document.getElementById("brandGameLabel").innerHTML = "CHOUKA<br><b>BARA</b>";
  document.getElementById("chapterLabel").innerHTML =
    `${themeLabel(theme)} <span>📜</span>`;

  showScreen("setupScreen");
  showDataMessage(
    gameDataLoaded
      ? `${gameData.characters.length} characters • ${gameData.riddles.length} riddles • ${gameData.advantages.length} advantages loaded.`
      : "Loading game data...",
    gameDataLoaded ? "ok" : ""
  );
}

function themeLabel(theme) {
  return {
    rajya: "WORLD • RAJYA",
    navarasa: "WORLD • NAVARASA",
    panchabootha: "WORLD • PANCHABOOTHA",
    kala: "WORLD • KALA AND YUGA",
    kshetra: "WORLD • KSHETRA AND DEVALAYA"
  }[theme] || "WORLD • KINGDOMS";
}

function applyTheme(theme) {
  document.body.classList.remove(
    "theme-rajya",
    "theme-navarasa",
    "theme-panchabootha",
    "theme-kala",
    "theme-kshetra"
  );
  document.body.classList.add(`theme-${theme}`);
}

function updateGameCarousel() {
  const carousel = document.getElementById("gameCarousel");
  const slides = [...document.querySelectorAll(".game-slide")];
  if (!carousel || !slides.length) return;

  slides.forEach((slide, index) => {
    slide.classList.toggle("active", index === currentGameSlide);
  });

  const active = slides[currentGameSlide];
  const targetLeft =
    active.offsetLeft -
    (carousel.clientWidth - active.offsetWidth) / 2;

  carousel.scrollTo({
    left: Math.max(0, targetLeft),
    behavior: "smooth"
  });

  document.querySelectorAll("#gameDots button").forEach((dot, index) => {
    dot.classList.toggle("active", index === currentGameSlide);
  });
}

function moveGameSlide(direction) {
  // Circular button-only navigation:
  // Chouka -> Alaguli -> Pachisi -> Chouka
  // and the same in reverse.
  const total = 3;
  currentGameSlide =
    (currentGameSlide + direction + total) % total;

  updateGameCarousel();
}

function initGameSwipe() {
  // Intentionally disabled: game selection is controlled only by
  // the Previous/Next buttons and the dots.
}

function valueOf(row, names, fallback = "") {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null) {
      const value = String(row[name]).trim();
      if (value) return value;
    }
  }
  return fallback;
}

function normalizeAgeGroup(value) {
  const v = String(value || "").trim().replace(/\s+/g, "");
  if (/^8-12$/.test(v)) return "8-12";
  if (/^13-16$/.test(v)) return "13-16";
  if (/^17\+$/.test(v)) return "17+";
  return "";
}

function normalizeDifficulty(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "easy") return "Easy";
  if (v === "medium" || v === "med") return "Medium";
  if (v === "hard") return "Hard";
  return "";
}

function normalizeAnswer(value) {
  const v = String(value || "").trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(v)) return v;
  if (["1", "2", "3", "4"].includes(v)) return ["A", "B", "C", "D"][Number(v) - 1];
  return "";
}


async function loadGameData() {
  gameDataLoaded = false;

  try {
    // Read game data through the SAME Apps Script web app used by
    // authentication. This avoids browser CORS problems with Google Sheets.
    const result = await callAppsScript("gameData", {
      sheetId: GAME_SHEET_ID
    });

    if (!result || result.valid === false) {
      throw new Error(result?.message || "The game-data sheet could not be read.");
    }

    gameData.characters = (result.characters || [])
      .map((row, index) => ({
        id: valueOf(row, ["ID", "Id", "id"], `CHAR${index + 1}`),
        name: valueOf(row, ["Character", "Name", "character", "name"]),
        ability: valueOf(row, [
          "Special Ability", "Ability", "Perk", "SpecialAbility",
          "special ability", "ability"
        ]),
        description: valueOf(row, [
          "Description", "Effect", "Special Ability Description",
          "description", "effect"
        ])
      }))
      .filter(r => r.name && r.ability);

    gameData.riddles = (result.riddles || [])
      .map((row, index) => ({
        id: valueOf(row, ["ID", "Id", "id"], `RIDDLE${index + 1}`),
        ageGroup: normalizeAgeGroup(valueOf(row, [
          "Age Group", "AgeGroup", "age group", "ageGroup"
        ])),
        difficulty: normalizeDifficulty(valueOf(row, ["Difficulty", "difficulty"])),
        question: valueOf(row, ["Riddle", "Question", "riddle", "question"]),
        a: valueOf(row, ["Option A", "A", "option A"]),
        b: valueOf(row, ["Option B", "B", "option B"]),
        c: valueOf(row, ["Option C", "C", "option C"]),
        d: valueOf(row, ["Option D", "D", "option D"]),
        answer: normalizeAnswer(valueOf(row, ["Answer", "Correct Answer", "answer"]))
      }))
      .filter(r =>
        r.ageGroup && r.difficulty && r.question &&
        r.a && r.b && r.c && r.d && r.answer
      );

    gameData.advantages = (result.advantages || [])
      .map((row, index) => ({
        id: valueOf(row, ["ID", "Id", "id"], `ADV${index + 1}`),
        difficulty: normalizeDifficulty(valueOf(row, ["Difficulty", "difficulty"])),
        name: valueOf(row, ["Advantage", "Name", "advantage", "name"]),
        description: valueOf(row, ["Description", "Effect", "description", "effect"])
      }))
      .filter(a => a.difficulty && a.name);

    if (!gameData.characters.length) {
      throw new Error("No characters were found in the Characters tab.");
    }
    if (!gameData.riddles.length) {
      throw new Error("No valid riddles were found in the Riddles tab.");
    }

    gameDataLoaded = true;

    const setup = document.getElementById("setupScreen");
    if (setup && !setup.classList.contains("hidden")) {
      showDataMessage(
        `${gameData.characters.length} characters • ${gameData.riddles.length} riddles • ${gameData.advantages.length} advantages loaded.`,
        "ok"
      );
    }

    return true;
  } catch (error) {
    console.error("Game data:", error);
    gameDataLoaded = false;

    const text = `Game data could not be loaded: ${error.message}`;

    const setupMessage = document.getElementById("dataMessage");
    if (setupMessage) setMessage(setupMessage, text, "error");

    const difficultyMessage = document.getElementById("difficultyMessage");
    if (difficultyMessage) setMessage(difficultyMessage, text, "error");

    return false;
  }
}


// ============================================================
// SETUP + CHARACTER ASSIGNMENT
// ============================================================

function renderPlayerInputs(count) {
  const container = document.getElementById("playerInputs");
  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <label>PLAYER ${i + 1}</label>
      <input id="playerName${i}" type="text" maxlength="30" placeholder="Player ${i + 1} name">
      <input id="playerAge${i}" class="age-input" type="number" min="8" max="120" placeholder="Age">
    `;
    container.appendChild(row);
  }

  document.getElementById("beginGame").disabled = false;
}

function startGame() {
  if (!gameDataLoaded) {
    showDataMessage("Game data is still loading. Please wait.", "error");
    return;
  }

  const count = document.querySelectorAll("#playerInputs .player-row").length;

  if (count < 2) {
    showDataMessage("Choose the number of players first.", "error");
    return;
  }

  if (gameData.characters.length < count) {
    showDataMessage(
      `You selected ${count} players, but only ${gameData.characters.length} characters are in the Characters tab. Add more characters or choose fewer players.`,
      "error"
    );
    return;
  }

  const rawPlayers = [];

  for (let i = 0; i < count; i++) {
    const name =
      document.getElementById(`playerName${i}`).value.trim() ||
      `Player ${i + 1}`;

    const age = Number(
      document.getElementById(`playerAge${i}`).value
    );

    if (!Number.isFinite(age) || age < 8) {
      showDataMessage(`Enter a valid age (8+) for Player ${i + 1}.`, "error");
      return;
    }

    if (!ageGroupFor(age)) {
      showDataMessage(
        `Player ${i + 1}'s age must fit one of the available age groups: 8–12, 13–16, or 17+.`,
        "error"
      );
      return;
    }

    rawPlayers.push({
      name,
      age,
      points: STARTING_POINTS,
      character: null,
      characterUsed: false,
      advantages: [],
      usedRiddleIds: [],
      log: []
    });
  }

  const shuffledCharacters = shuffle([...gameData.characters]);

  rawPlayers.forEach((player, index) => {
    const character = shuffledCharacters[index];
    player.character = {
      id: character.id,
      name: character.name,
      ability: character.ability,
      description: character.description
    };
    player.log.push(
      `${player.name} was randomly assigned ${character.name} and received ${character.ability}.`
    );
  });

  players = rawPlayers;
  selectedPlayer = 0;
  currentRiddle = null;

  saveGame();
  renderDashboard();
  showScreen("dashboardScreen");
  startServerGameTimer();

  toast(
    "Characters assigned",
    "Every player received one random character and a one-time ability.",
    "♕"
  );
}

async function newGame() {
  stopTimer();
  if (gameSessionStarted) {
    try {
      await callAppsScript("endGame", {
        email: currentUser?.email || "",
        googleId: currentUser?.sub || "",
        sessionId: deviceSessionId || "",
        reason: "New game"
      });
    } catch (error) {
      console.warn("Could not record previous game duration:", error);
    }
    gameSessionStarted = false;
  }
  localStorage.removeItem(gameStorageKey());
  players = [];
  selectedPlayer = 0;
  currentRiddle = null;

  document.querySelectorAll("#playerCountButtons button")
    .forEach(b => b.classList.remove("selected"));

  document.getElementById("playerInputs").innerHTML = "";
  document.getElementById("beginGame").disabled = true;

  showScreen("setupScreen");
  applyTheme(selectedTheme || "rajya");
}

// ============================================================
// DASHBOARD / PROFILE
// ============================================================

function renderDashboard() {
  if (!players.length) return;

  const worldThemeLabel = document.getElementById("worldThemeLabel");
  if (worldThemeLabel) {
    worldThemeLabel.textContent = themeLabel(selectedTheme);
  }

  document.getElementById("playerStrip").innerHTML =
    players.map((p, index) => `
      <div class="player-card ${index === selectedPlayer ? "active" : ""}" data-player="${index}">
        <div class="top">
          <span class="avatar-icon">${characterIcon(p.character?.name)}</span>
          <span class="mini">P${index + 1}</span>
        </div>
        <h3>${escapeHtml(p.name)}</h3>
        <div class="points">🪙 ${Number(p.points || 0).toLocaleString()}</div>
        <div class="character-name">${escapeHtml(p.character?.name || "Character pending")}</div>
      </div>
    `).join("");

  document.querySelectorAll(".player-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedPlayer = Number(card.dataset.player);
      renderDashboard();
      saveGame();
    });
  });

  const p = players[selectedPlayer];

  document.getElementById("turnTitle").textContent =
    `${p.name.toUpperCase()}'S TURN`;

  document.getElementById("eventDescription").innerHTML = `
    <div class="dashboard-character-info">
      <div class="character-detail-row">
        <span class="character-detail-label">YOUR CHARACTER:</span>
        <strong class="dashboard-character-name">
          ${escapeHtml(p.character?.name || "Character")}
        </strong>
      </div>
      <div class="character-detail-row">
        <span class="character-detail-label">SPECIAL ABILITY:</span>
        <strong class="dashboard-ability-name">
          ${escapeHtml(p.character?.ability || "No ability assigned")}
        </strong>
      </div>
      <div class="dashboard-ability-description">
        ${escapeHtml(p.character?.description || "No ability description available.")}
      </div>
    </div>
  `;

  const abilityBtn = document.getElementById("useCharacterBtn");
  abilityBtn.textContent =
    p.characterUsed
      ? `${p.character?.ability || "ABILITY"} — USED`
      : `USE ${p.character?.ability || "CHARACTER ABILITY"}`;
  abilityBtn.disabled = !!p.characterUsed;

  renderEventLog();
}

function renderProfile() {
  if (!players.length) return;

  const p = players[selectedPlayer];
  const character = p.character;

  document.getElementById("profileContent").innerHTML = `
    <div class="profile-wrap">
      <div class="card profile-card">
        <div class="profile-header">
          <div class="profile-avatar">${characterIcon(character?.name)}</div>
          <div>
            <div class="eyebrow">PLAYER ${selectedPlayer + 1}</div>
            <h2>${escapeHtml(p.name)}</h2>
            <div class="profile-points">🪙 ${Number(p.points || 0).toLocaleString()} POINTS</div>
          </div>
        </div>

        <div class="ability-box">
          <div class="eyebrow">CHARACTER</div>
          <h3>${escapeHtml(character?.name || "Unknown")}</h3>
          <p><b>${escapeHtml(character?.ability || "")}</b></p>
          <p>${escapeHtml(character?.description || "")}</p>
          <span class="status-badge ${p.characterUsed ? "used" : "available"}">
            ${p.characterUsed ? "USED — ONE TIME ONLY" : "AVAILABLE — ONE TIME ONLY"}
          </span>
        </div>

        <div class="profile-actions">
          <button class="primary-btn gold-btn" id="profileUseCharacter" ${p.characterUsed ? "disabled" : ""}>
            ${p.characterUsed ? "CHARACTER ABILITY USED" : "USE CHARACTER ABILITY"}
          </button>
          <button class="secondary-btn" id="profileAdvantages">
            VIEW ADVANTAGES (${p.advantages.length})
          </button>
          <button class="secondary-btn" id="profileRiddle">
            SOLVE PRAHELIKA — 500 PTS
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("profileUseCharacter")
    .addEventListener("click", useCharacterAbility);

  document.getElementById("profileAdvantages")
    .addEventListener("click", openAdvantages);

  document.getElementById("profileRiddle")
    .addEventListener("click", openDifficulty);
}

function renderEventLog() {
  const logs = players[selectedPlayer]?.log || [];
  const el = document.getElementById("eventLog");

  if (!logs.length) {
    el.innerHTML = `<div class="log-item">No events yet.</div>`;
    return;
  }

  el.innerHTML = logs.slice(0, 12).map(log =>
    `<div class="log-item">${escapeHtml(log)}</div>`
  ).join("");
}

// ============================================================
// RIDDLES
// ============================================================

function openDifficulty() {
  if (!players.length) {
    toast("No players", "Set up the players first.", "⚠");
    return;
  }

  const p = players[selectedPlayer];

  if (p.points < RIDDLE_COST) {
    toast("Not enough points", `You need ${RIDDLE_COST} points.`, "⚠");
    return;
  }

  document.getElementById("difficultyMessage").textContent = "";
  showScreen("difficultyScreen");

  // If the sheet has not finished loading, show a clear status here.
  if (!gameDataLoaded) {
    setMessage(
      document.getElementById("difficultyMessage"),
      "Game data is loading. You can choose a difficulty as soon as it finishes.",
      ""
    );
  }
}

async function startRiddle(difficulty) {
  if (!players.length) return;

  const message = document.getElementById("difficultyMessage");

  // Never silently ignore a click just because the sheet is still loading.
  if (!gameDataLoaded) {
    setMessage(message, "Loading game data…", "");

    const loaded = await loadGameData();

    if (!loaded) {
      setMessage(
        message,
        "Game data could not be loaded. Make sure the Apps Script was redeployed after adding the gameData code.",
        "error"
      );
      return;
    }
  }

  const p = players[selectedPlayer];

  if (p.points < RIDDLE_COST) {
    toast("Not enough points", `You need ${RIDDLE_COST} points.`, "⚠");
    return;
  }

  const ageGroup = ageGroupFor(p.age);

  let pool = gameData.riddles.filter(
    r =>
      r.ageGroup === ageGroup &&
      r.difficulty === difficulty
  );

  if (!pool.length) {
    setMessage(
      message,
      `No ${difficulty} riddles are available for age group ${ageGroup}. Check the Riddles tab.`,
      "error"
    );
    return;
  }

  const unused = pool.filter(r => {
    const key = r.id || r.question;
    return !p.usedRiddleIds.includes(key);
  });

  if (unused.length) pool = unused;

  const picked = randomItem(pool);

  currentRiddle = {
    ...picked,
    difficulty,
    ageGroup,
    options: [picked.a, picked.b, picked.c, picked.d]
  };

  p.points -= RIDDLE_COST;

  const riddleKey = currentRiddle.id || currentRiddle.question;
  if (!p.usedRiddleIds.includes(riddleKey)) {
    p.usedRiddleIds.push(riddleKey);
  }

  p.log.unshift(
    `${p.name} spent ${RIDDLE_COST} points on a ${difficulty} riddle.`
  );

  saveGame();
  renderDashboard();
  renderRiddleScreen();
  showScreen("riddleScreen");
  startTimer();
}


function renderRiddleScreen() {
  const p = players[selectedPlayer];

  document.getElementById("riddleDifficulty").textContent =
    `${currentRiddle.difficulty.toUpperCase()} • ${currentRiddle.ageGroup}`;

  document.getElementById("riddleQuestion").textContent =
    currentRiddle.question;

  document.getElementById("riddlePlayerCard").innerHTML = `
    <div class="avatar-icon">${characterIcon(p.character?.name)}</div>
    <div class="eyebrow">PLAYER ${selectedPlayer + 1}</div>
    <strong>${escapeHtml(p.name)}</strong>
    <p>🪙 ${Number(p.points || 0).toLocaleString()}</p>
    <small>${escapeHtml(currentRiddle.difficulty)}</small>
  `;

  const labels = ["A", "B", "C", "D"];

  document.getElementById("riddleOptions").innerHTML =
    currentRiddle.options.map((option, index) => `
      <button data-answer="${labels[index]}">
        <b>${labels[index]}</b> ${escapeHtml(option)}
      </button>
    `).join("");

  document.querySelectorAll("#riddleOptions button").forEach(btn => {
    btn.addEventListener("click", () =>
      submitRiddle(btn.dataset.answer)
    );
  });

  const result = document.getElementById("riddleResult");
  result.className = "result-box hidden";
  result.innerHTML = "";

  document.getElementById("backFromRiddle").classList.add("hidden");
}

function submitRiddle(answer) {
  if (!currentRiddle) return;

  stopTimer();

  const buttons = [...document.querySelectorAll("#riddleOptions button")];
  buttons.forEach(b => b.disabled = true);

  const p = players[selectedPlayer];
  const correct = answer === currentRiddle.answer;
  playAnswerResultSound(correct);

  buttons.forEach(b => {
    if (b.dataset.answer === currentRiddle.answer) b.classList.add("correct");
    if (b.dataset.answer === answer && !correct) b.classList.add("wrong");
  });

  const result = document.getElementById("riddleResult");
  result.classList.remove("hidden");

  if (correct) {
    p.points += CORRECT_REWARD;

    const advantagePool = gameData.advantages.filter(
      a => a.difficulty === currentRiddle.difficulty
    );

    if (advantagePool.length) {
      const earned = randomItem(advantagePool);

      p.advantages.push({
        instanceId: `${earned.id || "ADV"}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        id: earned.id,
        name: earned.name,
        description: earned.description,
        difficulty: earned.difficulty,
        used: false,
        discarded: false
      });

      pendingAdvantageIndex = p.advantages.length - 1;

      p.log.unshift(
        `${p.name} answered correctly: +${CORRECT_REWARD} points and earned ${earned.name}.`
      );

      result.className = "result-box correct";
      result.innerHTML = `
        <b>✓ Correct! +${CORRECT_REWARD} PTS</b>
        <div>Choose whether to <strong>use</strong> or <strong>discard</strong> your earned advantage.</div>
      `;

      saveGame();
      renderDashboard();
      updateRiddlePlayerCard();
      openAdvantageEarnedModal(earned);
      return;
    }

    p.log.unshift(
      `${p.name} answered correctly: +${CORRECT_REWARD} points. No ${currentRiddle.difficulty} advantages are configured yet.`
    );

    result.className = "result-box correct";
    result.innerHTML = `
      <b>✓ Correct! +${CORRECT_REWARD} PTS</b>
      <div>No ${escapeHtml(currentRiddle.difficulty)} advantages are configured yet.</div>
    `;
  } else {
    p.log.unshift(`${p.name}'s answer was incorrect. No advantage earned.`);

    const correctText = currentRiddle.options[letterIndex(currentRiddle.answer)];

    result.className = "result-box wrong";
    result.innerHTML = `
      <b>✕ Incorrect Answer</b>
      <div>Correct answer: <strong>${escapeHtml(correctText)}</strong></div>
      <div>No advantage gained.</div>
    `;
  }

  saveGame();
  renderDashboard();
  updateRiddlePlayerCard();
  document.getElementById("backFromRiddle").classList.remove("hidden");
}

function updateRiddlePlayerCard() {
  const p = players[selectedPlayer];

  document.getElementById("riddlePlayerCard").innerHTML = `
    <div class="avatar-icon">${characterIcon(p.character?.name)}</div>
    <div class="eyebrow">PLAYER ${selectedPlayer + 1}</div>
    <strong>${escapeHtml(p.name)}</strong>
    <p>🪙 ${Number(p.points || 0).toLocaleString()}</p>
    <small>${escapeHtml(currentRiddle?.difficulty || "")}</small>
  `;
}

function startTimer() {
  stopTimer();

  timerValue = RIDDLE_SECONDS;
  updateTimer();
  prepareAudio();

  timerId = setInterval(() => {
    timerValue -= 1;
    updateTimer();

    // Warning countdown:
    // 15 seconds remaining -> warning begins.
    // 10 seconds remaining -> stronger/faster warning.
    // Final 5 seconds -> urgent beep every second.
    if (timerValue <= 15 && timerValue > 0) {
      if (timerValue <= 5) {
        beep(1050, 180);
      } else if (timerValue <= 10) {
        beep(800, 120);
      } else {
        beep(620, 85);
      }
    }

    if (timerValue <= 0) {
      stopTimer();
      beep(1200, 450);
      timeoutRiddle();
    }
  }, 1000);
}

function updateTimer() {
  const el = document.getElementById("timer");
  el.textContent = timerValue;
  el.classList.toggle("warning", timerValue <= 10);
}

function timeoutRiddle() {
  if (!currentRiddle) return;

  const p = players[selectedPlayer];
  const buttons = [...document.querySelectorAll("#riddleOptions button")];

  buttons.forEach(b => {
    b.disabled = true;
    if (b.dataset.answer === currentRiddle.answer) {
      b.classList.add("correct");
    }
  });

  p.log.unshift(`${p.name}'s riddle timed out. No advantage earned.`);

  const result = document.getElementById("riddleResult");
  result.className = "result-box wrong";
  result.classList.remove("hidden");

  result.innerHTML = `
    <b>⌛ Time's up!</b>
    <div>Correct answer: <strong>${escapeHtml(currentRiddle.options[letterIndex(currentRiddle.answer)])}</strong></div>
    <div>No advantage gained.</div>
  `;

  saveGame();
  renderDashboard();
  updateRiddlePlayerCard();
  document.getElementById("backFromRiddle").classList.remove("hidden");

  beep(1100, 260);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function prepareAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
  } catch (e) {
    console.warn("Audio unavailable:", e);
  }
}

function beep(frequency, duration, volume = 0.075) {
  try {
    prepareAudio();
    if (!audioContext) return;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    osc.type = "sine";
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + duration / 1000
    );

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(now);
    osc.stop(now + duration / 1000);
  } catch (e) {}
}

function playTapSound() {
  beep(720, 55, 0.095);
  try {
    if (navigator.vibrate) navigator.vibrate(10);
  } catch (e) {}
}

function playAnswerResultSound(correct) {
  try {
    prepareAudio();
    if (!audioContext) return;
    if (navigator.vibrate) navigator.vibrate(correct ? [35, 25, 55] : [70, 30, 70]);
  } catch (e) {}

  if (correct) {
    // Bright ascending confirmation sound.
    beep(660, 110, 0.11);
    setTimeout(() => beep(880, 130, 0.11), 90);
    setTimeout(() => beep(1100, 180, 0.12), 200);
  } else {
    // Low descending negative sound.
    beep(430, 150, 0.12);
    setTimeout(() => beep(260, 220, 0.12), 130);
  }
}

// ============================================================
// CHARACTER ABILITY
// ============================================================

function useCharacterAbility() {
  if (!players.length) return;

  const p = players[selectedPlayer];

  if (p.characterUsed) {
    toast("Already used", "This character ability can only be used once.", "✓");
    return;
  }

  if (!p.character) {
    toast("No character", "This player has not been assigned a character.", "⚠");
    return;
  }

  pendingCharacterPlayer = selectedPlayer;

  document.getElementById("characterActionTitle").textContent =
    p.character.name.toUpperCase();

  document.getElementById("characterActionAbility").textContent =
    p.character.ability;

  document.getElementById("characterActionDescription").textContent =
    p.character.description;

  document.getElementById("characterActionIcon").textContent =
    characterIcon(p.character.name);

  showScreen("characterActionScreen");
}

function confirmCharacterUse() {
  if (pendingCharacterPlayer === null) return;

  const p = players[pendingCharacterPlayer];

  if (p.characterUsed) {
    pendingCharacterPlayer = null;
    showScreen("profileScreen");
    return;
  }

  p.characterUsed = true;
  p.log.unshift(
    `${p.name} used ${p.character.ability}. The physical-board action was confirmed.`
  );

  selectedPlayer = pendingCharacterPlayer;
  pendingCharacterPlayer = null;

  saveGame();
  renderDashboard();
  showScreen("dashboardScreen");

  toast(
    `${p.character.ability} used`,
    "The character ability is now permanently marked as used for this game.",
    "✓"
  );
}

// ============================================================
// EARNED ADVANTAGE POPUP
// ============================================================

function openAdvantageEarnedModal(advantage) {
  document.getElementById("modalAdvantageName").textContent = advantage.name;
  document.getElementById("modalAdvantageDescription").textContent =
    advantage.description || "Perform the advantage according to the game rules.";
  document.getElementById("modalAdvantageDifficulty").textContent =
    `${advantage.difficulty.toUpperCase()} ADVANTAGE`;
  document.getElementById("advantageModal").classList.remove("hidden");
}

function closeAdvantageEarnedModal() {
  document.getElementById("advantageModal").classList.add("hidden");
}

function useEarnedAdvantage() {
  if (pendingAdvantageIndex === null) return;

  const p = players[selectedPlayer];
  const adv = p.advantages[pendingAdvantageIndex];

  if (!adv || adv.used || adv.discarded) {
    closeAdvantageEarnedModal();
    pendingAdvantageIndex = null;
    return;
  }

  closeAdvantageEarnedModal();

  document.getElementById("actionAdvantageName").textContent = adv.name;
  document.getElementById("actionAdvantageDescription").textContent =
    adv.description || "Perform the advantage according to the game rules.";

  document.getElementById("advantageActionModal").classList.remove("hidden");
}

function confirmAdvantageUse() {
  if (pendingAdvantageIndex === null) return;

  const p = players[selectedPlayer];
  const adv = p.advantages[pendingAdvantageIndex];

  if (!adv) return;

  adv.used = true;
  adv.discarded = false;
  p.log.unshift(`${p.name} used advantage: ${adv.name}.`);

  document.getElementById("advantageActionModal").classList.add("hidden");
  pendingAdvantageIndex = null;

  saveGame();
  renderDashboard();
  document.getElementById("backFromRiddle").classList.remove("hidden");

  toast(`${adv.name} used`, "The advantage is now marked as used.", "✓");
}

function cancelAdvantageUse() {
  document.getElementById("advantageActionModal").classList.add("hidden");
}

function discardEarnedAdvantage() {
  if (pendingAdvantageIndex === null) return;

  const p = players[selectedPlayer];
  const adv = p.advantages[pendingAdvantageIndex];

  if (adv) {
    adv.discarded = true;
    adv.used = false;
    p.log.unshift(`${p.name} discarded advantage: ${adv.name}.`);
  }

  closeAdvantageEarnedModal();
  pendingAdvantageIndex = null;

  saveGame();
  renderDashboard();
  document.getElementById("backFromRiddle").classList.remove("hidden");

  toast("Advantage discarded", "The earned advantage is no longer available.", "×");
}

// ============================================================
// ADVANTAGES
// ============================================================

function openAdvantages() {
  if (!players.length) return;

  const p = players[selectedPlayer];

  document.getElementById("advantageTitle").textContent =
    `${p.name}'S ADVANTAGES`;

  renderAdvantages();
  showScreen("advantageScreen");
}

function renderAdvantages() {
  const p = players[selectedPlayer];
  const list = document.getElementById("advantageList");

  if (!p.advantages.length) {
    list.innerHTML = `
      <div class="card advantage-item">
        <h3>No advantages yet</h3>
        <p>Answer a riddle correctly to receive one random advantage from the same difficulty pool.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = p.advantages.map((adv, index) => `
    <div class="advantage-item ${adv.used ? "used" : ""}">
      <div class="advantage-meta">${escapeHtml(adv.difficulty)} • ${adv.used ? "USED" : "AVAILABLE"}</div>
      <h3>${escapeHtml(adv.name)}</h3>
      <p>${escapeHtml(adv.description || "")}</p>
      ${
        adv.used
          ? `<span class="status-badge used">USED — ONE TIME</span>`
          : `<button class="use-advantage" data-index="${index}">USE ADVANTAGE</button>`
      }
    </div>
  `).join("");

  document.querySelectorAll(".use-advantage").forEach(btn => {
    btn.addEventListener("click", () =>
      useAdvantage(Number(btn.dataset.index))
    );
  });
}

function useAdvantage(index) {
  const p = players[selectedPlayer];
  const adv = p.advantages[index];

  if (!adv || adv.used) {
    toast("Already used", "This advantage is no longer available.", "✓");
    return;
  }

  const confirmed = window.confirm(
    `${adv.name}\n\n${adv.description}\n\nPerform this advantage according to the game rules on the physical board, then confirm OK to mark it as USED.`
  );

  if (!confirmed) return;

  adv.used = true;
  p.log.unshift(
    `${p.name} used advantage: ${adv.name}.`
  );

  saveGame();
  renderDashboard();
  renderAdvantages();

  toast(
    `${adv.name} used`,
    "This advantage is now marked as used.",
    "✓"
  );
}

// ============================================================
// TURN / NAVIGATION
// ============================================================

function nextTurn() {
  if (!players.length) return;

  selectedPlayer =
    (selectedPlayer + 1) % players.length;

  renderDashboard();
  saveGame();

  toast(
    "Turn passed",
    `${players[selectedPlayer].name}'s turn.`,
    "→"
  );
}

function showScreen(id) {
  stopTimer();

  screenIds.forEach(screenId => {
    const el = document.getElementById(screenId);
    if (!el) return;

    el.classList.toggle("hidden", screenId !== id);
  });

  if (id === "dashboardScreen") renderDashboard();
  if (id === "profileScreen") renderProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// AUTH / STORAGE
// ============================================================

function showAuthCard(which) {
  document.getElementById("loginCard").classList.toggle("hidden", which !== "login");
  document.getElementById("activationCard").classList.toggle("hidden", which !== "activation");
  document.getElementById("gameCard").classList.toggle("hidden", which !== "game");
}

async function logout() {
  stopTimer();
  await releaseDeviceSession("Signed out");
  gameSessionStarted = false;

  if (currentUser) {
    localStorage.removeItem(gameStorageKey());
  }

  localStorage.removeItem("yatraGoogleUser");
  localStorage.removeItem("yatraActivated");
  localStorage.removeItem("yatraActivationCode");
  localStorage.removeItem("yatraActivationEmail");

  currentUser = null;
  players = [];
  currentRiddle = null;
  gameDataLoaded = false;

  showAuthCard("login");

  document.getElementById("code").value = "";
  document.getElementById("loginMessage").textContent = "";
  document.getElementById("activationMessage").textContent = "";

  if (window.google?.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
}

function gameStorageKey() {
  return "yatraKingdomsGame_" +
    (currentUser?.email || "local").toLowerCase();
}

function saveGame() {
  if (!currentUser || !players.length) return;

  localStorage.setItem(
    gameStorageKey(),
    JSON.stringify({
      players,
      selectedPlayer
    })
  );
}

// ============================================================
// HELPERS
// ============================================================

function ageGroupFor(age) {
  if (age >= 8 && age <= 12) return "8-12";
  if (age >= 13 && age <= 16) return "13-16";
  if (age >= 17) return "17+";
  return null;
}

function letterIndex(letter) {
  return ["A", "B", "C", "D"].indexOf(letter);
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function characterIcon(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("arjuna")) return "🏹";
  if (n.includes("karna")) return "🛡️";
  if (n.includes("shakuni")) return "🎲";
  if (n.includes("ghatotkacha")) return "👹";
  return "♕";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function setMessage(element, text, type = "") {
  if (!element) return;
  element.className = "message " + type;
  element.textContent = text;
}

function showDataMessage(text, type = "") {
  setMessage(document.getElementById("dataMessage"), text, type);
}

function toast(title, desc, icon = "✦") {
  const el = document.getElementById("toast");
  el.innerHTML =
    `<b>${escapeHtml(icon)} ${escapeHtml(title)}</b>` +
    `<span>${escapeHtml(desc)}</span>`;

  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");

  clearTimeout(window.__yatraToastTimer);
  window.__yatraToastTimer = setTimeout(
    () => el.classList.remove("show"),
    3300
  );
}

function parseJwt(token) {
  const base64 = token
    .split(".")[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map(c =>
        "%" +
        ("00" + c.charCodeAt(0).toString(16)).slice(-2)
      )
      .join("")
  );

  return JSON.parse(json);
}
