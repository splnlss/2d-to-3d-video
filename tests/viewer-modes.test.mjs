import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = process.env.VIEWER_BASE_URL ?? "http://127.0.0.1:55000";
let browser;
before(async () => {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    ...(existsSync("/usr/bin/google-chrome") ? { channel: "chrome" } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
});
after(async () => browser?.close());

async function open(route = "live-depth.html", xr = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  if (xr) {
    const bytes = await readFile("node_modules/iwer/build/iwer.min.js");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), "23d8640949f19db4b1e70398b30e084e4aa555f3a81e4329da3fac1a70b39542");
    await page.addInitScript({
      content:
        bytes.toString() +
        `
      window.xrTestDevice = new IWER.XRDevice(IWER.metaQuest2);
      window.xrTestDevice.position.set(0, 0, 0);
      window.xrTestDevice.installRuntime({ forceInstall: true });
      window.xrSessionCount = 0;
      const original = navigator.xr.requestSession.bind(navigator.xr);
      navigator.xr.requestSession = async (...args) => {
        window.xrSessionCount++;
        return window.xrTestSession = await original(...args);
      };
    `,
    });
  }
  await page.goto(`${base}/${route}`);
  assert.equal(await page.locator("#switch-mode").count(), 1, "Every viewer entry needs a mode button");
  await page.waitForFunction(() => !document.querySelector("#switch-mode").disabled);
  return page;
}

// Catches page navigation masquerading as switching and a reset/loss of pause.
test("all viewer entry points can switch modes in place at the paused timestamp", async () => {
  for (const route of ["index.html", "viewer.html", "live-depth.html"]) {
    const page = await open(route);
    try {
      const originalURL = page.url();
      await page.waitForFunction(() => document.querySelector("video").readyState >= 2);
      await page.locator("video").evaluate(
        (video) =>
          new Promise((resolve) => {
            video.addEventListener("seeked", resolve, { once: true });
            video.currentTime = 13;
          }),
      );
      const initialMode = await page.locator("#mode-label").innerText();
      const before = await page.locator("#stage").screenshot();
      await page.locator("#switch-mode").click();
      await page.waitForFunction(() => !document.querySelector("#switch-mode").disabled);
      assert.notEqual(await page.locator("#mode-label").innerText(), initialMode);
      assert.equal(page.url(), originalURL);
      const state = await page.locator("video").evaluate((v) => ({ time: v.currentTime, paused: v.paused, muted: v.muted, src: v.currentSrc }));
      assert.equal(state.paused, true);
      assert.equal(state.muted, false);
      assert.ok(Math.abs(state.time - 13) < 0.15, JSON.stringify(state));
      const after = await page.locator("#stage").screenshot();
      assert.notEqual(createHash("sha256").update(before).digest("hex"), createHash("sha256").update(after).digest("hex"), "Switch must change the actual rendering");
      await page.locator("#switch-mode").click();
      await page.waitForFunction(() => !document.querySelector("#switch-mode").disabled);
      assert.equal(await page.locator("#mode-label").innerText(), initialMode);
      assert.equal(await page.locator("video").evaluate((v) => v.paused), true);
      assert.ok(Math.abs((await page.locator("video").evaluate((v) => v.currentTime)) - 13) < 0.15);
      if (route === "live-depth.html") await page.screenshot({ path: "test-results/viewer-mode-switch.png", fullPage: true });
    } finally {
      await page.close();
    }
  }
});

async function pointAndPress(page, side = "right") {
  await page.evaluate(async (side) => {
    const THREE = await import("./lib/three.module.js");
    const controller = window.xrTestDevice.controllers[side];
    // Hand-set fixture: head at origin, button below the subject, 1.5 m ahead.
    const origin = new THREE.Vector3(0.2, -0.15, -0.2);
    const target = new THREE.Vector3(0, -0.72, -1.5);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(origin, target, new THREE.Vector3(0, 1, 0)));
    controller.position.set(...origin.toArray());
    controller.quaternion.set(...orientation.toArray());
    const frame = () => new Promise((resolve) => window.xrTestSession.requestAnimationFrame(resolve));
    await frame();
    await frame();
    controller.updateButtonValue("trigger", 1);
    await frame();
    await frame();
    controller.updateButtonValue("trigger", 0);
    await frame();
    await frame();
  }, side);
}

// Catches recovery bookkeeping that saves time only during a mode transition.
test("an active media error recovers the current paused timeline in the other mode", async () => {
  const page = await open();
  try {
    await page.waitForFunction(() => document.querySelector("video").readyState >= 2);
    await page.locator("video").evaluate(
      (video) =>
        new Promise((resolve) => {
          video.addEventListener("seeked", resolve, { once: true });
          video.currentTime = 13;
        }),
    );
    // A decoder can emit error without changing its URL. Exercise the player's
    // event boundary while retaining a real decoded frame and media timestamp.
    await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("error")));
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("could not be loaded"));
    await page.locator("#switch-mode").click();
    await page.waitForFunction(() => !document.querySelector("#switch-mode").disabled);
    const state = await page.locator("video").evaluate((v) => ({ time: v.currentTime, paused: v.paused }));
    assert.equal(state.paused, true);
    assert.ok(Math.abs(state.time - 13) < 0.15, JSON.stringify(state));
  } finally {
    await page.close();
  }
});

// Catches priming play() restarting an ended destination and stranding a switch.
test("switching at the end preserves pause and permits restart", async () => {
  const page = await open();
  try {
    await page.waitForFunction(() => document.querySelector("video").readyState >= 2);
    await page.locator("video").evaluate(
      (video) =>
        new Promise((resolve) => {
          video.addEventListener("seeked", resolve, { once: true });
          video.currentTime = video.duration;
        }),
    );
    await page.locator("#switch-mode").click();
    await page.waitForFunction(() => !document.querySelector("#switch-mode").disabled, { timeout: 5000 });
    const state = await page.locator("video").evaluate((v) => ({ time: v.currentTime, duration: v.duration, paused: v.paused }));
    assert.equal(state.paused, true);
    assert.ok(Math.abs(state.time - state.duration) < 0.15, JSON.stringify(state));
    await page.locator("#restart").click();
    await page.waitForFunction(() => document.querySelector("video").currentTime < 1 && !document.querySelector("video").paused);
  } finally {
    await page.close();
  }
});

// Catches a decorative VR button, ended/replaced sessions, duplicate audio,
// and switching that silently pauses playback or resets the timeline.
test("controller rays switch both modes while the same immersive session keeps playing", async () => {
  const page = await open("live-depth.html", true);
  try {
    await page.waitForFunction(() => !document.querySelector("#vr").disabled);
    await page.locator("#vr").click();
    await page.waitForFunction(() => document.querySelector("#vr").textContent === "Exit VR" && document.querySelector("video").currentTime > 0.2);
    await page.screenshot({ path: "test-results/viewer-vr-mode-button.png" });
    await page.evaluate(() => {
      window.firstSession = window.xrTestSession;
      window.previousVideo = document.querySelector("video");
    });
    const before = await page.locator("video").evaluate((v) => v.currentTime);
    await pointAndPress(page);
    await page.waitForFunction(() => document.querySelector("#mode-label").textContent === "Video VR" && !document.querySelector("#switch-mode").disabled);
    assert.equal(await page.evaluate(() => window.xrTestSession === window.firstSession && window.xrSessionCount === 1), true);
    assert.equal(await page.locator("#vr").innerText(), "Exit VR");
    assert.equal(await page.evaluate(() => window.previousVideo.paused), true, "Inactive video must not keep playing audio");
    assert.equal(await page.locator("video").evaluate((v) => v.paused), false);
    assert.ok((await page.locator("video").evaluate((v) => v.currentTime)) >= before - 0.1);
    assert.match(await page.locator("video").evaluate((v) => v.currentSrc), /Bob_DA3_stereo\.mp4/);
    await pointAndPress(page, "left");
    await page.waitForFunction(() => document.querySelector("#mode-label").textContent === "Live depth" && !document.querySelector("#switch-mode").disabled);
    assert.equal(await page.evaluate(() => window.xrTestSession === window.firstSession && window.xrSessionCount === 1), true);
    assert.equal(await page.locator("video").evaluate((v) => v.paused), false);
    assert.match(await page.locator("video").evaluate((v) => v.currentSrc), /Bob_live_rgb\.mp4/);
    await page.evaluate(() => window.xrTestSession.end());
  } finally {
    await page.close();
  }
});

// Catches a failed destination that strands the user in VR without a way back.
test("a failed mode video leaves VR exit and switching back available", async () => {
  const page = await open("live-depth.html", true);
  try {
    await page.route("**/Bob_DA3_stereo.mp4", (route) => route.fulfill({ status: 404 }));
    await page.waitForFunction(() => !document.querySelector("#vr").disabled);
    await page.locator("#vr").click();
    await page.waitForFunction(() => document.querySelector("#vr").textContent === "Exit VR");
    await pointAndPress(page);
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("could not be loaded"));
    assert.equal(await page.locator("#vr").isEnabled(), true);
    assert.equal(await page.locator("#switch-mode").isEnabled(), true);
    await pointAndPress(page);
    await page.waitForFunction(() => document.querySelector("#mode-label").textContent === "Live depth" && !document.querySelector("#play").disabled);
    assert.equal(await page.locator("#vr").innerText(), "Exit VR");
    await page.evaluate(() => window.xrTestSession.end());
  } finally {
    await page.close();
  }
});
