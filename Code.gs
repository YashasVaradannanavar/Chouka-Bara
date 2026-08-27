const SHEET_NAME = "Codes";

const GAME_SHEET_ID =
  "1p9gQpD_aKGBZtbqHqu2haaK1F1EP3bpDcTW8x-lsiCw";

const GAME_CHARACTERS_SHEET = "Characters";
const GAME_RIDDLES_SHEET = "Riddles";
const GAME_ADVANTAGES_SHEET = "Advantages";

// ============================================================
// DEVICE SESSION / GAME TIME SETTINGS
// ============================================================

const SESSION_SHEET_NAME = "Sessions";
const GAME_TIME_SHEET_NAME = "GameTimes";

// The browser sends a heartbeat every 30 seconds.
// If a browser disappears without sending a release request,
// another device can take over after this stale period.
const SESSION_STALE_MS = 90 * 1000;

function doGet(e) {
  const action = e.parameter.action || "";

  if (action === "checkUser") {
    return jsonOutput(checkUser(e.parameter.email, e.parameter.googleId));
  }

  if (action === "activate") {
    return jsonOutput(
      activate(
        e.parameter.code,
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.name
      )
    );
  }

  if (action === "gameData") {
    return jsonOutput(
      getGameData(e.parameter.sheetId || GAME_SHEET_ID)
    );
  }

  if (action === "claimSession") {
    return jsonOutput(
      claimSession(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId,
        e.parameter.name
      )
    );
  }

  if (action === "heartbeat") {
    return jsonOutput(
      heartbeat(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId
      )
    );
  }

  if (action === "startGameSession") {
    return jsonOutput(
      startGameSession(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId,
        e.parameter.game,
        e.parameter.theme,
        e.parameter.playerCount
      )
    );
  }

  if (action === "endGame") {
    return jsonOutput(
      endGameSession(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId,
        e.parameter.reason || "Game ended"
      )
    );
  }

  if (action === "endSession") {
    return jsonOutput(
      endSession(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId,
        e.parameter.reason || "Session ended"
      )
    );
  }

  return jsonOutput({
    valid: false,
    message: "Invalid request."
  });
}

// sendBeacon() uses POST. This lets the browser release the device
// session when the tab/window is closed.
function doPost(e) {
  const action = e.parameter.action || "";

  if (action === "endSession") {
    return jsonOutput(
      endSession(
        e.parameter.email,
        e.parameter.googleId,
        e.parameter.sessionId,
        e.parameter.reason || "Browser closed"
      )
    );
  }

  return jsonOutput({
    valid: false,
    message: "Invalid POST request."
  });
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// AUTHENTICATION / ACTIVATION
// ============================================================

function checkUser(email, googleId) {
  email = String(email || "").trim().toLowerCase();
  googleId = String(googleId || "").trim();

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(SHEET_NAME);

  if (!sheet) {
    return {
      valid: false,
      message: "Codes sheet not found."
    };
  }

  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const storedEmail = String(values[i][3] || "").trim().toLowerCase();
    const storedGoogleId = String(values[i][4] || "").trim();
    const storedCode = String(values[i][0] || "").trim().toUpperCase();
    const status = String(values[i][2] || "").trim().toUpperCase();

    if (
      storedEmail === email &&
      storedGoogleId === googleId &&
      status === "USED"
    ) {
      return {
        valid: true,
        code: storedCode,
        message: "This Google account is already activated."
      };
    }
  }

  return {
    valid: false,
    message: "Google account has not been activated yet."
  };
}

function activate(code, email, googleId, name) {
  code = String(code || "").trim().toUpperCase();
  email = String(email || "").trim().toLowerCase();
  googleId = String(googleId || "").trim();
  name = String(name || "").trim();

  if (!code || !email || !googleId) {
    return {
      valid: false,
      message: "Missing activation information."
    };
  }

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(SHEET_NAME);

  if (!sheet) {
    return {
      valid: false,
      message: "Codes sheet not found."
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {
      const storedEmail = String(values[i][3] || "").trim().toLowerCase();
      const storedGoogleId = String(values[i][4] || "").trim();
      const storedCode = String(values[i][0] || "").trim().toUpperCase();
      const status = String(values[i][2] || "").trim().toUpperCase();

      if (
        storedEmail === email &&
        storedGoogleId === googleId &&
        status === "USED"
      ) {
        return {
          valid: false,
          alreadyActivated: true,
          code: storedCode,
          message:
            "This Google account is already activated. One activation key is allowed per Google account."
        };
      }
    }

    for (let i = 1; i < values.length; i++) {
      const rowCode = String(values[i][0] || "").trim().toUpperCase();

      if (rowCode !== code) continue;

      const status = String(values[i][2] || "").trim().toUpperCase();
      const existingEmail = String(values[i][3] || "").trim().toLowerCase();
      const existingGoogleId = String(values[i][4] || "").trim();

      if (existingEmail === email && existingGoogleId === googleId) {
        return {
          valid: true,
          alreadyActivated: true,
          code: rowCode,
          message: "This account is already activated."
        };
      }

      if (existingEmail || existingGoogleId) {
        return {
          valid: false,
          message: "This activation code belongs to another Google account."
        };
      }

      if (status !== "UNUSED") {
        return {
          valid: false,
          message: "This activation code is unavailable."
        };
      }

      sheet.getRange(i + 1, 3).setValue("USED");
      sheet.getRange(i + 1, 4).setValue(email);
      sheet.getRange(i + 1, 5).setValue(googleId);
      sheet.getRange(i + 1, 6).setValue(name);
      sheet.getRange(i + 1, 7).setValue(new Date());

      return {
        valid: true,
        code: rowCode,
        message: "Yatra activated successfully."
      };
    }

    return {
      valid: false,
      message: "Invalid activation code."
    };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// DEVICE SESSION LOCK
// ============================================================

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getSessionSheet() {
  return getOrCreateSheet(SESSION_SHEET_NAME, [
    "Email",
    "Google ID",
    "Session ID",
    "Name",
    "Last Seen",
    "Session Started",
    "Game Started",
    "Game",
    "Theme",
    "Player Count"
  ]);
}

function getGameTimeSheet() {
  return getOrCreateSheet(GAME_TIME_SHEET_NAME, [
    "Recorded At",
    "Email",
    "Google ID",
    "Session ID",
    "Name",
    "Game",
    "Theme",
    "Player Count",
    "Game Start",
    "Game End",
    "Duration Seconds",
    "Duration",
    "End Reason"
  ]);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim();
}

function claimSession(email, googleId, sessionId, name) {
  email = normalizeEmail(email);
  googleId = normalizeId(googleId);
  sessionId = normalizeId(sessionId);
  name = String(name || "Yatra Player").trim();

  if (!email || !googleId || !sessionId) {
    return {
      valid: false,
      message: "Missing device session information."
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSessionSheet();
    const values = sheet.getDataRange().getValues();
    const now = new Date();

    // Only one live session is allowed for a Google account.
    for (let i = 1; i < values.length; i++) {
      const rowEmail = normalizeEmail(values[i][0]);
      const rowGoogleId = normalizeId(values[i][1]);
      const rowSessionId = normalizeId(values[i][2]);
      const lastSeen = values[i][4] instanceof Date
        ? values[i][4]
        : new Date(values[i][4]);

      if (rowEmail !== email || rowGoogleId !== googleId || !rowSessionId) {
        continue;
      }

      const age = now.getTime() - lastSeen.getTime();

      if (rowSessionId === sessionId || age > SESSION_STALE_MS) {
        // Same browser/session, or an abandoned browser session.
        sheet.getRange(i + 1, 3, 1, 8).setValues([[
          sessionId,
          name,
          now,
          now,
          values[i][6] || "",
          values[i][7] || "",
          values[i][8] || "",
          values[i][9] || ""
        ]]);

        return {
          valid: true,
          sessionId: sessionId,
          message: "Device session active."
        };
      }

      return {
        valid: false,
        activeElsewhere: true,
        message:
          "This Google account is already active on another device. Close that session first."
      };
    }

    sheet.appendRow([
      email,
      googleId,
      sessionId,
      name,
      now,
      now,
      "",
      "",
      "",
      ""
    ]);

    return {
      valid: true,
      sessionId: sessionId,
      message: "Device session active."
    };
  } finally {
    lock.releaseLock();
  }
}

function findSessionRow(sheet, email, googleId, sessionId) {
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (
      normalizeEmail(values[i][0]) === email &&
      normalizeId(values[i][1]) === googleId &&
      normalizeId(values[i][2]) === sessionId
    ) {
      return {
        row: i + 1,
        values: values[i]
      };
    }
  }

  return null;
}

function heartbeat(email, googleId, sessionId) {
  email = normalizeEmail(email);
  googleId = normalizeId(googleId);
  sessionId = normalizeId(sessionId);

  if (!email || !googleId || !sessionId) {
    return { valid: false, sessionLost: true, message: "Missing session information." };
  }

  const sheet = getSessionSheet();
  const found = findSessionRow(sheet, email, googleId, sessionId);

  if (!found) {
    return {
      valid: false,
      sessionLost: true,
      message: "This device session is no longer active."
    };
  }

  sheet.getRange(found.row, 5).setValue(new Date());

  return {
    valid: true,
    message: "Session active."
  };
}

function startGameSession(email, googleId, sessionId, game, theme, playerCount) {
  email = normalizeEmail(email);
  googleId = normalizeId(googleId);
  sessionId = normalizeId(sessionId);
  game = String(game || "Chouka Bara").trim();
  theme = String(theme || "Rajya").trim();
  playerCount = String(playerCount || "").trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSessionSheet();
    const found = findSessionRow(sheet, email, googleId, sessionId);

    if (!found) {
      return {
        valid: false,
        sessionLost: true,
        message: "Device session is no longer active."
      };
    }

    const now = new Date();
    sheet.getRange(found.row, 5).setValue(now);
    sheet.getRange(found.row, 6).setValue(found.values[5] || now);
    sheet.getRange(found.row, 7).setValue(now);
    sheet.getRange(found.row, 8, 1, 3).setValues([[
      game,
      theme,
      playerCount
    ]]);

    return {
      valid: true,
      gameStart: now.toISOString(),
      message: "Game timer started."
    };
  } finally {
    lock.releaseLock();
  }
}

function recordGameDuration(gameTimeSheet, found, endTime, reason) {
  const gameStart = found.values[6] instanceof Date
    ? found.values[6]
    : (found.values[6] ? new Date(found.values[6]) : null);

  if (!gameStart || isNaN(gameStart.getTime())) return false;

  const seconds = Math.max(
    0,
    Math.round((endTime.getTime() - gameStart.getTime()) / 1000)
  );

  gameTimeSheet.appendRow([
    endTime,
    found.values[0] || "",
    found.values[1] || "",
    found.values[2] || "",
    found.values[3] || "",
    found.values[7] || "Chouka Bara",
    found.values[8] || "",
    found.values[9] || "",
    gameStart,
    endTime,
    seconds,
    formatDuration(seconds),
    reason
  ]);

  return true;
}

function endGameSession(email, googleId, sessionId, reason) {
  email = normalizeEmail(email);
  googleId = normalizeId(googleId);
  sessionId = normalizeId(sessionId);
  reason = String(reason || "Game ended").trim();

  if (!email || !googleId || !sessionId) {
    return { valid: false, message: "Missing session information." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSessionSheet();
    const found = findSessionRow(sheet, email, googleId, sessionId);

    if (!found) {
      return {
        valid: false,
        sessionLost: true,
        message: "Device session is no longer active."
      };
    }

    const now = new Date();
    const logged = recordGameDuration(getGameTimeSheet(), found, now, reason);

    sheet.getRange(found.row, 5).setValue(now);
    sheet.getRange(found.row, 7).setValue("");
    sheet.getRange(found.row, 8, 1, 3).setValues([["", "", ""]]);

    return {
      valid: true,
      logged: logged,
      message: logged ? "Game duration recorded." : "Game session ended."
    };
  } finally {
    lock.releaseLock();
  }
}

function endSession(email, googleId, sessionId, reason) {
  email = normalizeEmail(email);
  googleId = normalizeId(googleId);
  sessionId = normalizeId(sessionId);
  reason = String(reason || "Session ended").trim();

  if (!email || !googleId || !sessionId) {
    return { valid: false, message: "Missing session information." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSessionSheet();
    const found = findSessionRow(sheet, email, googleId, sessionId);

    if (!found) {
      return {
        valid: true,
        alreadyReleased: true,
        message: "Session already released."
      };
    }

    const now = new Date();
    recordGameDuration(getGameTimeSheet(), found, now, reason);
    sheet.deleteRow(found.row);

    return {
      valid: true,
      released: true,
      message: "Device session released."
    };
  } finally {
    lock.releaseLock();
  }
}

function formatDuration(totalSeconds) {
  totalSeconds = Math.max(0, Number(totalSeconds) || 0);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

// ============================================================
// GAME DATA — READ-ONLY PROXY TO THE SEPARATE GAME SHEET
// ============================================================

function getGameData(sheetId) {
  try {
    sheetId = String(sheetId || GAME_SHEET_ID).trim();

    const ss = SpreadsheetApp.openById(sheetId);

    return {
      valid: true,
      characters: readSheetAsObjects(ss, GAME_CHARACTERS_SHEET),
      riddles: readSheetAsObjects(ss, GAME_RIDDLES_SHEET),
      advantages: readSheetAsObjects(ss, GAME_ADVANTAGES_SHEET)
    };
  } catch (error) {
    return {
      valid: false,
      message:
        "Could not read the game-data Google Sheet: " +
        error.message
    };
  }
}

function readSheetAsObjects(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Tab "${sheetName}" was not found.`);
  }

  const values = sheet.getDataRange().getValues();

  if (!values.length) return [];

  const headers = values[0].map(h => String(h || "").trim());

  return values
    .slice(1)
    .filter(row =>
      row.some(cell => String(cell ?? "").trim() !== "")
    )
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        if (header) {
          obj[header] = row[index] ?? "";
        }
      });

      return obj;
    });
}
