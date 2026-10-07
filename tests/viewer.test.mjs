import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

let browser;
const url = "http://127.0.0.1:55000/viewer.html";
before(async () => {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    ...(existsSync("/usr/bin/google-chrome") || existsSync("/Applications/Google Chrome.app") ? { channel: "chrome" } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
});
after(async () => browser?.close());

async function headsetPage() {
  const bytes = await readFile("node_modules/iwer/build/iwer.min.js");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "23d8640949f19db4b1e70398b30e084e4aa555f3a81e4329da3fac1a70b39542");
  const page = await browser.newPage();
  await page.addInitScript({
    content:
      bytes.toString("utf8") +
      `
    window.xrTestDevice = new IWER.XRDevice(IWER.metaQuest2);
    window.xrTestDevice.installRuntime({ forceInstall: true });
    const originalRequest = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = async (...args) => {
      window.xrTestSession = await originalRequest(...args);
      return window.xrTestSession;
    };
  `,
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector("#vr").disabled);
  return page;
}

async function trigger(page, side) {
  await page.evaluate(async (side) => {
    const nextFrame = () => new Promise((resolve) => window.xrTestSession.requestAnimationFrame(resolve));
    window.xrTestDevice.controllers[side].updateButtonValue("trigger", 1);
    await nextFrame();
    await nextFrame();
    window.xrTestDevice.controllers[side].updateButtonValue("trigger", 0);
    await nextFrame();
    await nextFrame();
  }, side);
}

// Exercises the real viewer through the same pinned XR emulator as repo replays.
test("a headset session enters, controller triggers toggle playback, and exit permits reentry", async () => {
  const page = await headsetPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.getByRole("button", { name: "Enter VR", exact: true }).click();
    await page.getByRole("button", { name: "Exit VR", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
    await trigger(page, "left");
    await page.waitForFunction(() => document.querySelector("video").paused);
    await trigger(page, "right");
    await page.waitForFunction(() => !document.querySelector("video").paused);
    // The immersive compositor covers page controls, as it does in a headset.
    // Ending the emulator session exercises the headset-menu exit path.
    await page.evaluate(() => window.xrTestSession.end());
    await page.getByRole("button", { name: "Enter VR", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator("video").evaluate((video) => video.paused), true);
    await page.getByRole("button", { name: "Enter VR", exact: true }).click();
    await page.getByRole("button", { name: "Exit VR", exact: true }).waitFor({ state: "visible" });
    await page.evaluate(() => window.xrTestSession.end());
    await page.getByRole("button", { name: "Enter VR", exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

// Catches coupling the exit action to video readiness, stranding a session.
test("a video failure during VR still allows exiting the headset session", async () => {
  const page = await headsetPage();
  try {
    await page.getByRole("button", { name: "Enter VR", exact: true }).click();
    await page.getByRole("button", { name: "Exit VR", exact: true }).waitFor({ state: "visible" });
    await page.locator("video").evaluate((video) => {
      video.src = "./missing-video.mp4";
      video.load();
    });
    await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes("could not be loaded"));
    assert.equal(await page.getByRole("button", { name: "Exit VR", exact: true }).isEnabled(), true, "Exit VR must remain available even if the video fails");
    await page.locator("#vr").evaluate((button) => button.click());
    await page.getByRole("button", { name: "Enter VR", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "Enter VR", exact: true }).isDisabled(), true);
  } finally {
    await page.close();
  }
});

// Catches serving entire files to byte requests, which prevents Chrome seeking.
test("video requests support byte ranges for seeking and resuming", async () => {
  const bytes = await readFile("public/Bob_DA3_stereo.mp4");
  const prefix = await fetch("http://127.0.0.1:55000/Bob_DA3_stereo.mp4", {
    headers: { Range: "bytes=0-15" },
  });
  assert.equal(prefix.status, 206, "A byte range must receive a partial response");
  assert.equal(prefix.headers.get("content-range"), `bytes 0-15/${bytes.length}`);
  assert.deepEqual(Buffer.from(await prefix.arrayBuffer()), bytes.subarray(0, 16));
  const suffix = await fetch("http://127.0.0.1:55000/Bob_DA3_stereo.mp4", {
    headers: { Range: "bytes=-32" },
  });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(bytes.length - 32));
  const invalid = await fetch("http://127.0.0.1:55000/Bob_DA3_stereo.mp4", {
    headers: { Range: `bytes=${bytes.length}-` },
  });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${bytes.length}`);
});

// Catches controls that look present but fail to operate the actual media.
test("play, pause, and restart control the converted video", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url);
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).count(), 1, "The viewer needs a Play button");
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0.5);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    assert.equal(await page.locator("video").evaluate((video) => video.paused), true);
    assert.equal(await page.locator("video").evaluate((video) => video.muted), false);
    await page.locator("video").evaluate((video) => {
      video.currentTime = 8;
    });
    await page.waitForFunction(() => document.querySelector("video").currentTime >= 7.9);
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video").currentTime < 1 && !document.querySelector("video").paused);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Play", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator("video").evaluate((video) => video.paused), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "test-results/viewer.png", fullPage: true });
  } finally {
    await page.close();
  }
});

// A swapped crop or shared eye layer must fail against real rendered pixels.
test("each eye sees its own half of an SBS texture and desktop sees the left half", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    assert.equal(await page.locator("canvas").count(), 1, "The viewer needs a rendered canvas");
    const pixels = await page.evaluate(async () => {
      const THREE = await import("./lib/three.module.js");
      const { createStereoScreen } = await import("./stereo-screen.js");
      const fixture = document.createElement("canvas");
      fixture.width = 64;
      fixture.height = 32;
      const ctx = fixture.getContext("2d");
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(32, 0, 32, 32);
      const texture = new THREE.CanvasTexture(fixture);
      texture.colorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const screen = createStereoScreen(texture);
      screen.position.z = -3;
      scene.add(screen);
      const renderer = new THREE.WebGLRenderer();
      const target = new THREE.WebGLRenderTarget(64, 64);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      const samples = [];
      try {
        // WebXR's actual eye-camera masks are 0+1 for left and 0+2 for right.
        for (const mask of [0b011, 0b101, 0b010]) {
          camera.layers.mask = mask;
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          const pixel = new Uint8Array(4);
          renderer.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
          samples.push(Array.from(pixel));
        }
      } finally {
        screen.children.forEach((mesh) => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        });
        texture.dispose();
        target.dispose();
        renderer.dispose();
      }
      return samples;
    });
    assert.ok(pixels[0][0] > 240 && pixels[0][1] < 10 && pixels[0][2] < 10, `Left eye must see red: ${pixels[0]}`);
    assert.ok(pixels[1][2] > 240 && pixels[1][0] < 10 && pixels[1][1] < 10, `Right eye must see blue: ${pixels[1]}`);
    assert.ok(pixels[2][0] > 240 && pixels[2][2] < 10, `Desktop must see the left half: ${pixels[2]}`);
  } finally {
    await page.close();
  }
});

// Catches a broken media URL leaving enabled controls and no explanation.
test("a missing video is explained and transport controls are disabled", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/Bob_DA3_stereo.mp4", (route) => route.fulfill({ status: 404 }));
    await page.goto(url);
    assert.equal(await page.locator('[role="status"]').count(), 1, "The viewer needs a status message");
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("could not be loaded"));
    assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Restart", exact: true }).isDisabled(), true);
  } finally {
    await page.close();
  }
});
