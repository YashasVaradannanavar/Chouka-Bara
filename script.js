/*
YATRA GOOGLE LOGIN + ACTIVATION

SETUP:
1. Create a Google Cloud OAuth Web Client ID.
2. Replace GOOGLE_CLIENT_ID below.
3. Deploy Code.gs as a Google Apps Script Web App.
4. Replace APPS_SCRIPT_URL below.
5. Set up the Codes sheet as described in README.txt.

IMPORTANT:
This site NEVER asks for the user's Gmail password.
Google handles authentication.
*/

const GOOGLE_CLIENT_ID = "PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE";
const APPS_SCRIPT_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

let currentUser = null;

const loginCard = document.getElementById("loginCard");
const activationCard = document.getElementById("activationCard");
const gameCard = document.getElementById("gameCard");
const loginMessage = document.getElementById("loginMessage");
const activationMessage = document.getElementById("activationMessage");

window.onload = () => {
  if (GOOGLE_CLIENT_ID.includes("PASTE_")) {
    loginMessage.innerHTML = '<span class="error">Google login is not configured yet. Follow README.txt.</span>';
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin,
    auto_select: false
  });

  google.accounts.id.renderButton(
    document.getElementById("googleBtn"),
    { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 280 }
  );

  restoreSession();
};

function handleGoogleLogin(response) {
  try {
    const payload = parseJwt(response.credential);

    currentUser = {
      sub: payload.sub,
      name: payload.name || "Yatra Player",
      email: payload.email,
      picture: payload.picture || ""
    };

    sessionStorage.setItem("yatraGoogleUser", JSON.stringify(currentUser));
    showActivation();
  } catch (e) {
    loginMessage.innerHTML = '<span class="error">Google sign-in could not be completed.</span>';
  }
}

function parseJwt(token) {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(atob(base64).split("").map(c =>
    "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
  ).join(""));
  return JSON.parse(json);
}

async function showActivation() {
  loginCard.classList.add("hidden");
  activationCard.classList.remove("hidden");

  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userEmail").textContent = currentUser.email;
  document.getElementById("avatar").src = currentUser.picture || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

  const savedCode = sessionStorage.getItem("yatraActivationCode");
  const savedEmail = sessionStorage.getItem("yatraActivationEmail");

  if (savedCode && savedEmail === currentUser.email) {
    showGame();
  }
}

document.getElementById("activate").onclick = async () => {
  const code = document.getElementById("code").value.trim().toUpperCase();

  if (!code) {
    setMessage(activationMessage, "Enter your activation code.", "error");
    return;
  }

  if (APPS_SCRIPT_URL.includes("PASTE_")) {
    setMessage(activationMessage, "Google Apps Script is not configured yet. Follow README.txt.", "error");
    return;
  }

  setMessage(activationMessage, "Verifying activation code…");

  try {
    const url = APPS_SCRIPT_URL +
      "?action=activate" +
      "&email=" + encodeURIComponent(currentUser.email) +
      "&googleId=" + encodeURIComponent(currentUser.sub) +
      "&name=" + encodeURIComponent(currentUser.name) +
      "&code=" + encodeURIComponent(code);

    const response = await fetch(url);
    const result = await response.json();

    if (!result.valid) {
      setMessage(activationMessage, result.message || "Activation failed.", "error");
      return;
    }

    sessionStorage.setItem("yatraActivationCode", code);
    sessionStorage.setItem("yatraActivationEmail", currentUser.email);
    showGame();
  } catch (e) {
    setMessage(activationMessage, "Could not contact the activation service.", "error");
  }
};

function showGame() {
  activationCard.classList.add("hidden");
  gameCard.classList.remove("hidden");
  document.getElementById("welcomeName").textContent = currentUser.name.split(" ")[0];
  document.getElementById("verifiedEmail").textContent = "Verified: " + currentUser.email;
}

function restoreSession() {
  try {
    const saved = sessionStorage.getItem("yatraGoogleUser");
    if (!saved) return;

    currentUser = JSON.parse(saved);
    showActivation();
  } catch {
    sessionStorage.clear();
  }
}

function logout() {
  sessionStorage.clear();
  currentUser = null;
  gameCard.classList.add("hidden");
  activationCard.classList.add("hidden");
  loginCard.classList.remove("hidden");
  document.getElementById("code").value = "";
  loginMessage.textContent = "";
  activationMessage.textContent = "";
  google.accounts.id.disableAutoSelect();
}

document.getElementById("logout").onclick = logout;
document.getElementById("logout2").onclick = logout;

function setMessage(element, text, type="") {
  element.className = "message " + type;
  element.textContent = text;
}

function launchGame(url) {
  window.location.href = url;
}

function comingSoon() {
  alert("This Yatra game is coming soon.");
}
