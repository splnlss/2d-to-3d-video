import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = "http://127.0.0.1:55000";
let browser;
before(async () => {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    ...(existsSync("/usr/bin/google-chrome") || existsSync("/Applications/Google Chrome.app") ? { channel: "chrome" } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
});
after(async () => browser?.close());

async function openDepthPage(xr = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (xr) {
    const bytes = await readFile("node_modules/iwer/build/iwer.min.js");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), "23d8640949f19db4b1e70398b30e084e4aa555f3a81e4329da3fac1a70b39542");
    await page.addInitScript({
      content:
        bytes.toString() +
        `
      window.xrTestDevice = new IWER.XRDevice(IWER.metaQuest2);
      window.xrTestDevice.installRuntime({ forceInstall: true });
      const request = navigator.xr.requestSession.bind(navigator.xr);
      navigator.xr.requestSession = async (...args) => (window.xrTestSession = await request(...args));
    `,
    });
  }
  await page.goto(`${base}/live-depth.html`);
  assert.match(await page.title(), /live depth/i, "A separate live-depth viewer must be available");
  return page;
}

// Catches stale depth after a seek and drifting independent RGB/depth clocks.
test("depth follows the color video across talking shots, cutaways, and restart", async () => {
  const page = await openDepthPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForFunction(() => !document.querySelector("#play").disabled);
    assert.match(await page.locator("#depth-status").innerText(), /person depth/i);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.locator("video").evaluate((video) => {
      video.currentTime = 6;
    });
    await page.waitForFunction(() => document.querySelector("#depth-status").textContent.includes("Cutaway"));
    await page.locator("video").evaluate((video) => {
      video.currentTime = 13;
    });
    await page.waitForFunction(() => document.querySelector("#depth-status").textContent.includes("Person depth"));
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video").currentTime < 1 && !document.querySelector("video").paused);
    assert.match(await page.locator("#depth-status").innerText(), /person depth/i);
    assert.equal(await page.locator("video").evaluate((video) => video.muted), false);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    assert.deepEqual(errors, []);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const beforeOrbit = await page.locator("#stage").screenshot();
    await page.screenshot({ path: "test-results/live-depth-front.png", fullPage: true });
    await page.locator("#orbit").fill("25");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterOrbit = await page.locator("#stage").screenshot();
    assert.notEqual(createHash("sha256").update(beforeOrbit).digest("hex"), createHash("sha256").update(afterOrbit).digest("hex"), "Orbit must change the rendered person, not only the angle readout");
    await page.screenshot({ path: "test-results/live-depth-side.png", fullPage: true });
  } finally {
    await page.close();
  }
});

// A flat texture produces equal red/blue shifts; actual near/far geometry does not.
test("rendered near pixels have greater head-position parallax than far pixels", async () => {
  const response = await fetch(`${base}/depth-subject.js`);
  assert.equal(response.status, 200, "Depth geometry must be implemented");
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/viewer.html`);
    const results = await page.evaluate(async () => {
      const THREE = await import("./lib/three.module.js");
      const { createDepthSubject } = await import("./depth-subject.js");
      const color = document.createElement("canvas");
      color.width = 64;
      color.height = 32;
      const ctx = color.getContext("2d");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = "blue";
      ctx.fillRect(32, 0, 32, 32);
      const atlas = document.createElement("canvas");
      atlas.width = 64;
      atlas.height = 32;
      const ac = atlas.getContext("2d");
      ac.fillStyle = "rgb(0,0,255)";
      ac.fillRect(0, 0, 32, 32);
      ac.fillStyle = "rgb(255,255,255)";
      ac.fillRect(32, 0, 32, 32);
      const colorTexture = new THREE.CanvasTexture(color);
      colorTexture.colorSpace = THREE.SRGBColorSpace;
      const depthTexture = new THREE.CanvasTexture(atlas);
      const spec = { frames: 1, fps: 12, tileWidth: 64, tileHeight: 32, columns: 1, rows: 1, near: 0.8, far: 2.6, anchorDepth: 1.8, shots: [{ start: 0, end: 1, talking: true, center: [0.5, 0.5], intrinsics: [1.2, 2, 0.5, 0.5] }] };
      const subject = createDepthSubject(colorTexture, depthTexture, spec);
      subject.setFrame(0);
      const scene = new THREE.Scene();
      scene.add(subject);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
      camera.position.z = 1.8;
      const renderer = new THREE.WebGLRenderer();
      const target = new THREE.WebGLRenderTarget(256, 256);
      const centers = [];
      for (const x of [-0.06, 0.06]) {
        camera.position.x = x;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(256 * 256 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
        let redX = 0,
          redCount = 0,
          blueX = 0,
          blueCount = 0;
        for (let y = 60; y < 196; y++)
          for (let x = 0; x < 256; x++) {
            const p = (y * 256 + x) * 4;
            if (pixels[p] > 200 && pixels[p + 2] < 30) {
              redX += x;
              redCount++;
            }
            if (pixels[p + 2] > 200 && pixels[p] < 30) {
              blueX += x;
              blueCount++;
            }
          }
        centers.push({ red: redX / redCount, blue: blueX / blueCount, redCount, blueCount });
      }
      subject.geometry.dispose();
      subject.material.dispose();
      colorTexture.dispose();
      depthTexture.dispose();
      target.dispose();
      renderer.dispose();
      return centers;
    });
    for (const result of results) assert.ok(result.redCount > 100 && result.blueCount > 100, JSON.stringify(result));
    const nearShift = Math.abs(results[1].red - results[0].red);
    const farShift = Math.abs(results[1].blue - results[0].blue);
    assert.ok(nearShift > farShift * 1.5, `Expected real depth parallax, got near ${nearShift}, far ${farShift}`);
    assert.ok(farShift > 2, "Camera translation must affect the far surface too");
  } finally {
    await page.close();
  }
});

// Catches unrestricted orbit, ignored XR gamepads, and reset that strands the angle.
test("Quest thumbstick orbit clamps at both 25-degree limits and resets", async () => {
  const page = await openDepthPage(true);
  try {
    await page.waitForFunction(() => !document.querySelector("#vr").disabled);
    await page.getByRole("button", { name: "Enter VR", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#vr").textContent === "Exit VR");
    await page.evaluate(() => window.xrTestDevice.controllers.right.updateAxis("thumbstick", "x-axis", 1));
    await page.waitForFunction(() => Number(document.querySelector("#orbit").value) >= 24.9);
    await page.waitForTimeout(250);
    assert.equal(Number(await page.locator("#orbit").inputValue()), 25);
    await page.evaluate(() => window.xrTestDevice.controllers.right.updateAxis("thumbstick", "x-axis", -1));
    await page.waitForFunction(() => Number(document.querySelector("#orbit").value) <= -24.9);
    await page.waitForTimeout(250);
    assert.equal(Number(await page.locator("#orbit").inputValue()), -25);
    await page.evaluate(() => window.xrTestDevice.controllers.right.updateAxis("thumbstick", "x-axis", 0));
    await page.evaluate(() => window.xrTestSession.end());
    await page.getByRole("button", { name: "Recenter", exact: true }).click();
    assert.equal(Number(await page.locator("#orbit").inputValue()), 0);
  } finally {
    await page.close();
  }
});

// Missing depth must be explicit; entering a blank immersive session is a bug.
test("missing depth prevents VR entry and explains the failure", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/Bob_live_depth.png", (route) => route.fulfill({ status: 404 }));
    await page.goto(`${base}/live-depth.html`);
    assert.match(await page.title(), /live depth/i);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("Depth could not be loaded"));
    assert.equal(await page.locator("#vr").isDisabled(), true);
  } finally {
    await page.close();
  }
});
