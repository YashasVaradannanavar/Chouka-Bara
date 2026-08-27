# YATRA — Device Lock + AFK + Game Duration Setup

## What this version adds

1. One Google account can be active on only one browser/device session at a time.
2. When the browser is normally closed, the session is released immediately using `sendBeacon`.
3. If the browser crashes or loses power and cannot send the close request, the server treats the session as abandoned after about 90 seconds without a heartbeat.
4. If the player does not interact with the website for 5 minutes, the current browser is automatically kicked back to the Google login screen with:
   `AFK Kicked — you were inactive for 5 minutes. The device is now released.`
5. A second device can sign in as soon as the first session has been released.
6. Actual game duration is recorded in a `GameTimes` tab in the SAME Google Sheet that contains the `Codes` tab.
7. `Sessions` is also created automatically in that same activation spreadsheet.
8. No direct browser-to-Google-Sheets request is used for game data; the existing Apps Script proxy remains in place.

## Google Sheets

### Activation spreadsheet
Keep your existing activation spreadsheet exactly as it is, including:

`Codes`

The updated Apps Script automatically creates these two tabs the first time they are needed:

`Sessions`

`GameTimes`

### Game-data spreadsheet
Keep your separate game-data spreadsheet with:

`Characters`

`Riddles`

`Advantages`

The website continues using the game-data Spreadsheet ID already present in `script.js` and `Code.gs`.

## IMPORTANT — deploy the Apps Script update

The website cannot enforce the one-device rule by itself. The updated `Code.gs` must be deployed to the same Apps Script Web App used by the website.

1. Open the Apps Script project connected to your `Codes` spreadsheet.
2. Replace the entire existing `Code.gs` with the `Code.gs` supplied with this website.
3. Save the project.
4. Click **Deploy → Manage deployments**.
5. Open your existing Web App deployment.
6. Click the pencil/edit icon.
7. Select **New version**.
8. Execute as: **Me**.
9. Who has access: keep the same setting that already allows your website to call the Web App.
10. Click **Deploy**.
11. Authorize if Google asks.
12. Keep the same Web App URL. The URL in `script.js` must point to that deployment.

Do NOT create `Sessions` or `GameTimes` manually. The script creates them automatically.

## How game duration is measured

The timer starts when the player finishes entering all players/ages and characters are assigned and the dashboard opens.

The timer ends when:

- the player signs out;
- the player is AFK-kicked;
- the player closes the browser normally;
- the player starts a New Game;
- the session otherwise ends.

Every completed game is added to `GameTimes` with:

- Recorded At
- Email
- Google ID
- Session ID
- Name
- Game
- Theme
- Player Count
- Game Start
- Game End
- Duration Seconds
- Duration
- End Reason

## Testing the one-device rule

### Test A — normal second-device block
1. Open YATRA on Device A.
2. Sign in with the activated Google account.
3. Enter the game.
4. Open YATRA on Device B.
5. Sign in with the SAME Google account.
6. Device B should be refused with an active-session message.

### Test B — close Device A
1. Keep Device A in the game.
2. Close the browser/tab normally.
3. Open YATRA on Device B.
4. Sign in with the same Google account.
5. Device B should now be allowed.

### Test C — AFK
1. Enter the game on Device A.
2. Do not click, scroll, type, touch, or otherwise interact with the website.
3. After 5 minutes, Device A should return to the login screen.
4. The login screen should show the AFK-kicked message.
5. Device B can then sign in.

### Test D — game duration
1. Start a game.
2. Play for a few minutes.
3. Sign out or close the browser.
4. Open the activation spreadsheet.
5. Check the `GameTimes` tab.
6. A row should contain the game start/end timestamps and duration.

## Important limitation

A normal browser close can release the session immediately through `sendBeacon`. If the computer loses power, the browser crashes, or the operating system kills the browser before the release request can be sent, the server cannot know instantly that the device disappeared. In that case the stale-session safety window is about 90 seconds.
