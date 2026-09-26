const landingPage = document.querySelector("#landing-page");
const appShell = document.querySelector(".app-shell");

const APP_ROUTES = ["meetings", "analytics", "actions", "team", "calendar", "settings", "boss"];

function getAppRoute() {
  const path = window.location.pathname.toLowerCase().replace(/^\/+|\/+$/g, "");
  const hash = window.location.hash.toLowerCase().replace(/^#\/?|\/+$/g, "");

  if (APP_ROUTES.includes(path)) return path;
  if (APP_ROUTES.includes(hash)) return hash;
  if (hash === "app") return "meetings";
  return null;
}

function syncView() {
  const route = getAppRoute();
  const showApp = Boolean(route);
  landingPage.hidden = showApp;
  appShell.hidden = !showApp;
  document.body.classList.toggle("landing-mode", !showApp);

  if (route === "boss") {
    document.title = "Meetflow Boss Portal — Executive Meeting Broadcast";
  } else if (showApp) {
    const titles = {
      meetings: "Meetings & Transcripts",
      analytics: "Monthly Attendance Analytics",
      actions: "My Actions & Follow-ups",
      team: "Team Directory",
      calendar: "Meeting Schedule & Calendar",
      settings: "Settings & Supabase Database"
    };
    document.title = `Meetflow — ${titles[route] || "Workspace"}`;
  } else {
    document.title = "Meetflow — Meetings end. Momentum doesn't.";
  }

  if (showApp && typeof window.switchView === "function") {
    window.switchView(route, false);
  }
}

window.addEventListener("hashchange", syncView);
window.addEventListener("popstate", syncView);
syncView();

async function renderLiquidChrome() {
  const canvas = document.querySelector("#liquid-scene");
  if (!canvas) return;

  try {
    const THREE = await import("three");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 7.5);

    const chrome = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.32, 0.39, 160, 20, 2, 5),
      new THREE.MeshPhongMaterial({
        color: 0xb8c0bd,
        specular: 0xffffff,
        shininess: 115,
      }),
    );
    chrome.position.set(1.35, 0, 0);
    chrome.rotation.set(0.35, 0.15, -0.18);
    chrome.scale.setScalar(1.28);
    scene.add(chrome);

    const fill = new THREE.PointLight(0xb7d7a2, 13, 8);
    fill.position.set(-2.5, 2, 3);
    scene.add(fill);
    const rim = new THREE.PointLight(0xe8f0ef, 18, 10);
    rim.position.set(3, -1.5, 2.5);
    scene.add(rim);

    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    const motionAllowed = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.position.z = width < 700 ? 8.4 : 7.5;
      chrome.position.x = width < 700 ? 0.4 : 1.35;
      chrome.scale.setScalar(width < 700 ? 1.04 : 1.28);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      canvas.dataset.state = "ready";
    };
    const onPointerMove = (event) => {
      targetX = (event.clientX / window.innerWidth - 0.5) * 0.45;
      targetY = (event.clientY / window.innerHeight - 0.5) * 0.3;
    };
    const animate = (time) => {
      if (motionAllowed) {
        pointerX += (targetX - pointerX) * 0.025;
        pointerY += (targetY - pointerY) * 0.025;
        chrome.rotation.y = 0.15 + time * 0.00009 + pointerX;
        chrome.rotation.x = 0.35 + Math.sin(time * 0.00022) * 0.12 + pointerY;
      }
      renderer.render(scene, camera);
      if (canvas.dataset.state !== "ready") canvas.dataset.state = "ready";
      window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.requestAnimationFrame(animate);
  } catch (error) {
    canvas.dataset.state = "unavailable";
    console.warn("Liquid chrome scene unavailable.", error);
  }
}

renderLiquidChrome();

// Convert 'Get started' to 'Sign in with Google' on click
const heroCta = document.querySelector("#landing-hero-cta");
if (heroCta) {
  heroCta.addEventListener("click", (e) => {
    e.preventDefault();
    heroCta.outerHTML = `
      <button class="landing-cta landing-google-cta" id="landing-google-btn" type="button">
        <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Sign in with Google</span>
      </button>
    `;
    const note = document.querySelector("#landing-hero-microcopy");
    if (note) note.textContent = "Click to authenticate with Google & enter your workspace.";
    const googleBtn = document.querySelector("#landing-google-btn");
    if (googleBtn) {
      googleBtn.addEventListener("click", () => {
        if (typeof window.handleGoogleSignIn === "function") {
          window.handleGoogleSignIn();
        } else {
          window.location.href = "/meetings";
        }
      });
    }
  });
}

// Automatically request notification permissions on launch
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission().catch(() => {});
}
