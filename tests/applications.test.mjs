import test from "node:test";
import assert from "node:assert/strict";
import { applicationName, createApplications } from "../web/applications.js";

test("launcher names preserve internal dots", () => {
  assert.equal(applicationName("C:\\Apps\\Blender 5.2.lnk"), "Blender 5.2");
  assert.equal(applicationName("C:\\Apps\\EDITOR.EXE"), "EDITOR");
});

test("cancelled selection does not save settings", async () => {
  const calls = [];
  const apps = createApplications(async (method) => {
    calls.push(method);
    return [];
  });
  assert.equal(await apps.add(), null);
  assert.deepEqual(calls, ["pick_applications"]);
});

test("concurrent activation launches only once", async () => {
  let count = 0;
  let resolve;
  const apps = createApplications(() => {
    count++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const launch = apps.launch("C:\\App.exe");
  await apps.launch("c:\\app.EXE");
  assert.equal(count, 1);
  resolve();
  await launch;
});
