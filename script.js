const GOOGLE_CLIENT_ID =
  "33548652224-ieojbv1tn67t8a3n457r6c42hol5vt3n.apps.googleusercontent.com";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwS1ExDFa_5h1HvMtPWyVA-BeOjfLJNly3rH-Dpnr91eLOKRVBixl2vWkdsegr3Nc2N/exec";

let currentUser = null;

const loginCard = document.getElementById("loginCard");
const activationCard = document.getElementById("activationCard");
const gameCard = document.getElementById("gameCard");

const loginMessage = document.getElementById("loginMessage");
const activationMessage = document.getElementById("activationMessage");


// --------------------------------------------------
// GOOGLE LOGIN
// --------------------------------------------------

window.onload = function () {

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
};


// --------------------------------------------------
// WHEN GOOGLE LOGIN SUCCEEDS
// --------------------------------------------------

async function handleGoogleLogin(response) {

  try {

    const payload = parseJwt(response.credential);

    currentUser = {
      sub: payload.sub,
      name: payload.name || "Yatra Player",
      email: payload.email,
      picture: payload.picture || ""
    };

    // Save Google account locally
    localStorage.setItem(
      "yatraGoogleUser",
      JSON.stringify(currentUser)
    );

    // Show account
    document.getElementById("userName").textContent =
      currentUser.name;

    document.getElementById("userEmail").textContent =
      currentUser.email;

    document.getElementById("avatar").src =
      currentUser.picture;

    /*
      IMPORTANT:
      Before asking for an activation code,
      check whether this Google account is
      already registered in Google Sheets.
    */

    await checkExistingActivation();

  } catch (error) {

    console.error(error);

    loginMessage.innerHTML =
      '<span class="error">Google login failed.</span>';
  }
}


// --------------------------------------------------
// CHECK GOOGLE SHEET
// --------------------------------------------------

async function checkExistingActivation() {

  loginCard.classList.add("hidden");

  setMessage(
    activationMessage,
    "Checking your Yatra activation..."
  );

  activationCard.classList.remove("hidden");

  try {

    const url =
      APPS_SCRIPT_URL +
      "?action=checkUser" +
      "&email=" +
      encodeURIComponent(currentUser.email) +
      "&googleId=" +
      encodeURIComponent(currentUser.sub);

    const response = await fetch(url);

    const result = await response.json();

    console.log("Activation check:", result);

    if (result.valid === true) {

      // Already activated!
      localStorage.setItem(
        "yatraActivated",
        "true"
      );

      localStorage.setItem(
        "yatraActivationCode",
        result.code
      );

      localStorage.setItem(
        "yatraActivationEmail",
        currentUser.email
      );

      showGame();

    } else {

      // New user → ask for activation code
      setMessage(
        activationMessage,
        "Your Google account is not activated yet. Enter your activation code."
      );
    }

  } catch (error) {

    console.error(error);

    setMessage(
      activationMessage,
      "Could not check your activation status.",
      "error"
    );
  }
}


// --------------------------------------------------
// ACTIVATE CODE
// --------------------------------------------------

document.getElementById("activate").onclick =
  async function () {

    const code =
      document
        .getElementById("code")
        .value
        .trim()
        .toUpperCase();

    if (!code) {

      setMessage(
        activationMessage,
        "Please enter your activation code.",
        "error"
      );

      return;
    }

    setMessage(
      activationMessage,
      "Verifying activation code..."
    );

    try {

      const url =
        APPS_SCRIPT_URL +
        "?action=activate" +
        "&email=" +
        encodeURIComponent(currentUser.email) +
        "&googleId=" +
        encodeURIComponent(currentUser.sub) +
        "&name=" +
        encodeURIComponent(currentUser.name) +
        "&code=" +
        encodeURIComponent(code);

      const response =
        await fetch(url);

      const result =
        await response.json();

      console.log("Activation:", result);

      if (!result.valid) {

        setMessage(
          activationMessage,
          result.message ||
          "Activation failed.",
          "error"
        );

        return;
      }

      // Save activation locally
      localStorage.setItem(
        "yatraActivated",
        "true"
      );

      localStorage.setItem(
        "yatraActivationCode",
        code
      );

      localStorage.setItem(
        "yatraActivationEmail",
        currentUser.email
      );

      showGame();

    } catch (error) {

      console.error(error);

      setMessage(
        activationMessage,
        "Could not contact the activation server.",
        "error"
      );
    }
  };


// --------------------------------------------------
// SHOW GAME
// --------------------------------------------------

function showGame() {

  activationCard.classList.add("hidden");

  gameCard.classList.remove("hidden");

  document.getElementById("welcomeName").textContent =
    currentUser.name.split(" ")[0];

  document.getElementById("verifiedEmail").textContent =
    "Verified: " + currentUser.email;
}


// --------------------------------------------------
// RESTORE LOGIN
// --------------------------------------------------

async function restoreLocalSession() {

  const savedUser =
    localStorage.getItem("yatraGoogleUser");

  if (!savedUser)
    return;

  try {

    currentUser =
      JSON.parse(savedUser);

    /*
      Do NOT blindly trust localStorage.

      Ask Google Apps Script whether this
      account is still registered.
    */

    await checkExistingActivation();

  } catch (error) {

    console.error(error);

    localStorage.clear();
  }
}


// --------------------------------------------------
// LOGOUT
// --------------------------------------------------

function logout() {

  localStorage.removeItem("yatraGoogleUser");
  localStorage.removeItem("yatraActivated");
  localStorage.removeItem("yatraActivationCode");
  localStorage.removeItem("yatraActivationEmail");

  currentUser = null;

  gameCard.classList.add("hidden");
  activationCard.classList.add("hidden");

  loginCard.classList.remove("hidden");

  document.getElementById("code").value = "";

  loginMessage.textContent = "";
  activationMessage.textContent = "";

  google.accounts.id.disableAutoSelect();
}


document.getElementById("logout").onclick =
  logout;

document.getElementById("logout2").onclick =
  logout;


// --------------------------------------------------
// JWT DECODER
// --------------------------------------------------

function parseJwt(token) {

  const base64 =
    token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const json =
    decodeURIComponent(
      atob(base64)
        .split("")
        .map(function (c) {

          return "%" +
            ("00" +
              c.charCodeAt(0)
                .toString(16))
            .slice(-2);

        })
        .join("")
    );

  return JSON.parse(json);
}


// --------------------------------------------------
// MESSAGE
// --------------------------------------------------

function setMessage(
  element,
  text,
  type = ""
) {

  element.className =
    "message " + type;

  element.textContent =
    text;
}


// --------------------------------------------------
// GAME BUTTON
// --------------------------------------------------

function launchGame(url) {

  window.location.href =
    url;
}


function comingSoon() {

  alert(
    "This Yatra game is coming soon."
  );
}
