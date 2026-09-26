const landingPage = document.querySelector("#landing-page");
const appShell = document.querySelector(".app-shell");

function isBossRoute() {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return path === "/boss" || path.startsWith("/boss/") || hash === "#boss";
}

function syncView() {
  const isBoss = isBossRoute();
  const showApp = window.location.hash === "#app" || isBoss;
  landingPage.hidden = showApp;
  appShell.hidden = !showApp;
  document.body.classList.toggle("landing-mode", !showApp);
  document.title = isBoss
    ? "Meetflow Boss Portal — Executive Meeting Broadcast"
    : showApp
    ? "Meetflow — Meeting intelligence, in motion"
    : "Meetflow — Meetings end. Momentum doesn't.";

  if (isBoss && typeof window.switchView === "function") {
    window.switchView("boss");
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
