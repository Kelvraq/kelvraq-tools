import {
  APPLICATIONS_PATH,
  applicationName,
  createApplications,
} from "./applications.js";
import { icon } from "./icons.js";
import { layout } from "./layout.js";
import { cardKind, cardFormat } from "./cards.js";

const api = window.desktop;
const applications = createApplications(call);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const $ = (s) => document.querySelector(s);
let settings,
  locations = [],
  current = "@home",
  parent = "",
  entries = [],
  selected = null,
  history = ["@home"],
  historyAt = 0,
  query = "",
  reverse = false,
  request = 0,
  dialogAction,
  iconGeneration = 0,
  loading = false;
let searchEverywhere = false,
  searchVersion = 0,
  searchTimer;
document.body.innerHTML = layout;

function notice(text) {
  $("#notification").textContent = text;
  $("#notification").hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => ($("#notification").hidden = true), 4500);
}
async function call(method, ...args) {
  const result = await api[method](...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
async function safely(fn) {
  try {
    return await fn();
  } catch (e) {
    notice(e.message);
  }
}
function base(p) {
  return (
    p
      .replace(/[\\/]$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}
function virtual() {
  return current.startsWith("@");
}
function section() {
  return settings.sections.find((s) => "@section:" + s.id === current);
}
function title() {
  return current === "@home"
    ? "Главная"
    : current === APPLICATIONS_PATH
      ? "Приложения"
      : current === "@recent"
        ? "Недавние"
        : current === "@computer"
          ? "Этот компьютер"
          : section()?.name || base(current);
}
function displayIcon(e) {
  return (
    settings.icons[e.path] ||
    (e.drive
      ? "drive"
      : e.directory
        ? "folder"
        : [".blend", ".fbx", ".obj", ".glb", ".gltf", ".stl"].includes(e.ext)
          ? "box"
          : [".png", ".jpg", ".jpeg", ".webp"].includes(e.ext)
            ? "image"
            : [".exe", ".lnk"].includes(e.ext)
              ? "game"
              : "file")
  );
}
function sideButton(p, label, i) {
  return `<button class="side-item ${current === p ? "active" : ""}" data-nav="${esc(p)}">${icon(settings.icons[p] || i)}<span>${esc(label)}</span></button>`;
}
function sidebar() {
  $("#sidebar").innerHTML =
    `<div class="side-group">${sideButton("@home", "Главная", "home")}${sideButton("@recent", "Недавние", "clock")}${sideButton(APPLICATIONS_PATH, "Приложения", "grid")}</div><div class="side-group"><div class="group-label">Закреплено<button id="add-pin" title="Добавить папку или файл" aria-label="Добавить папку или файл">${icon("plus")}</button></div>${settings.pins.map((p) => sideButton(p, base(p), "pin")).join("")}</div><div class="side-group"><div class="group-label">Разделы<button id="add-section" title="Создать раздел" aria-label="Создать раздел">${icon("plus")}</button></div>${settings.sections.map((s) => sideButton("@section:" + s.id, s.name, "folder")).join("")}</div><div class="side-group"><div class="group-label">Расположения</div>${sideButton("@computer", "Этот компьютер", "drive")}${locations
      .filter((l) => !l.drive)
      .map((l) => sideButton(l.path, l.name, l.icon))
      .join("")}</div><div class="side-bottom">${locations
      .filter((l) => l.drive)
      .map((l) => sideButton(l.path, l.name, "drive"))
      .join("")}</div>`;
  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.onclick = () =>
      safely(async () => {
        const p = b.dataset.nav;
        if (p.startsWith("@")) return navigate(p);
        const [e] = await call("entries", [p]);
        if (e.missing) throw new Error("Файл или папка не найдены");
        if (e.directory) await navigate(p);
        else await call("open", p);
      });
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const p = b.dataset.nav;
      const sec = settings.sections.find((s) => "@section:" + s.id === p);
      const actions = [];
      if (settings.pins.includes(p))
        actions.push(["pin", "Открепить", () => togglePin(p)]);
      if (!p.startsWith("@"))
        actions.push([
          "folder",
          "Показать в Проводнике",
          () => call("reveal", p),
        ]);
      actions.push(["grid", "Сменить иконку", () => iconDialog(p)]);
      if (sec) {
        actions.push([
          "edit",
          "Переименовать раздел",
          () =>
            textDialog("Название раздела", sec.name, async (value) => {
              sec.name = value;
              await saveSettings();
              sidebar();
              updateHeader();
            }),
        ]);
        actions.push([
          "close",
          "Убрать раздел",
          async () => {
            settings.sections = settings.sections.filter((s) => s !== sec);
            await saveSettings();
            if (current === p) await navigate("@home");
            else sidebar();
          },
        ]);
      }
      menu(e.clientX, e.clientY, actions);
    };
  });
  $("#add-pin").onclick = (e) =>
    menu(e.clientX, e.clientY, [
      ["folder", "Добавить папку", () => pickPins("folder")],
      ["file", "Добавить файл", () => pickPins("file")],
    ]);
  $("#add-section").onclick = () =>
    textDialog("Новый раздел", "", async (name) => {
      const s = { id: crypto.randomUUID(), name, paths: [] };
      settings.sections.push(s);
      await saveSettings();
      await navigate("@section:" + s.id);
    });
}
async function saveSettings() {
  settings = await call("settings", settings);
}
async function pickPins(mode) {
  const paths = await call("pick", mode);
  settings.pins = [...new Set([...settings.pins, ...paths])];
  await saveSettings();
  sidebar();
  if (current === "@home") await refresh();
  else updateHeader();
}
async function togglePin(p) {
  settings.pins = settings.pins.includes(p)
    ? settings.pins.filter((x) => x !== p)
    : [...settings.pins, p];
  await saveSettings();
  sidebar();
  if (current === "@home") await refresh();
  else updateHeader();
}
function updateHeader() {
  $("#heading").textContent =
    searchEverywhere && query ? "Поиск по компьютеру" : title();
  $("#path").textContent = virtual() ? "" : current;
  const target = entries.find((e) => e.path === selected),
    pinTarget = target?.path || (!virtual() ? current : null);
  $("#pin").hidden = !pinTarget || target?.application;
  $("#pin span").textContent = settings.pins.includes(pinTarget)
    ? "Открепить"
    : "Закрепить";
  $("#pin").classList.toggle("primary", settings.pins.includes(pinTarget));
  $("#new span").textContent =
    current === APPLICATIONS_PATH
      ? "Добавить приложение"
      : virtual()
        ? "Добавить"
        : "Новая папка";
  $("#rename").disabled = !target || target.missing || target.application;
  $("#new").disabled = searchEverywhere && !!query;
  $("#back").disabled = historyAt === 0;
  $("#forward").disabled = historyAt >= history.length - 1;
  $("#up").disabled = virtual() || parent === current;
  if (virtual())
    $("#breadcrumbs").innerHTML =
      `<button data-breadcrumb="${esc(current)}">${esc(title())}</button>`;
  else {
    const bits = current.split("\\").filter(Boolean);
    let acc = current.startsWith("\\\\") ? "\\\\" : "";
    $("#breadcrumbs").innerHTML = bits
      .map((bit, i) => {
        acc += bit + "\\";
        return `${i ? icon("chevron") : ""}<button data-breadcrumb="${esc(acc)}">${esc(bit)}</button>`;
      })
      .join("");
  }
  document
    .querySelectorAll("[data-breadcrumb]")
    .forEach(
      (b) => (b.onclick = () => safely(() => navigate(b.dataset.breadcrumb))),
    );
}
async function navigate(p, record = true) {
  stopGlobalSearch();
  const old = current;
  current = p;
  query = "";
  $("#search").value = "";
  selected = null;
  const ok = await refresh(true);
  if (!ok) {
    current = old;
    updateHeader();
    return;
  }
  if (record) {
    history = history.slice(0, historyAt + 1);
    history.push(current);
    historyAt = history.length - 1;
  }
  sidebar();
  updateHeader();
  $("#files").scrollTop = 0;
}
async function refresh(animate = false) {
  if (searchEverywhere && query.trim().length >= 2) {
    scheduleGlobalSearch();
    return true;
  }
  const token = ++request;
  loading = true;
  $("#status").textContent = "Загрузка…";
  try {
    let list;
    if (current === "@computer")
      list = await call(
        "entries",
        locations.filter((x) => x.drive).map((x) => x.path),
      );
    else if (current === "@home") list = await call("entries", settings.pins);
    else if (current === APPLICATIONS_PATH)
      list = (await call("entries", settings.applications || [])).map((e) => ({
        ...e,
        application: true,
        name: applicationName(e.path),
      }));
    else if (current === "@recent")
      list = await call("entries", settings.recent);
    else if (section()) list = await call("entries", section().paths);
    else {
      const result = await call("list", current);
      if (token !== request) return false;
      current = result.path;
      parent = result.parent;
      list = result.entries;
      await call("watch", current);
    }
    if (token !== request) return false;
    entries = list;
    loading = false;
    if (!entries.some((e) => e.path === selected)) selected = null;
    renderFiles();
    updateHeader();
    if (animate) {
      $("#files").classList.remove("content-enter");
      void $("#files").offsetWidth;
      $("#files").classList.add("content-enter");
    }
    return true;
  } catch (e) {
    if (token === request) {
      loading = false;
      notice(e.message);
      $("#status").textContent = "Не удалось открыть папку";
    }
    return false;
  }
}
function formatSize(n) {
  if (!n) return "0 Б";
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return (
    new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(
      n / 1024 ** i,
    ) +
    " " +
    ["Б", "КБ", "МБ", "ГБ"][i]
  );
}
function type(e) {
  return e.application
    ? "Приложение"
    : e.missing
      ? "Недоступно"
      : e.directory
        ? "Папка"
        : e.ext
          ? e.ext.slice(1).toUpperCase()
          : "Файл";
}
function renderCard(e, index) {
  const kind = cardKind(e);
  const tag = kind === "video" ? "div" : "button";
  const preview =
    kind === "video" && !e.missing
      ? `<button class="video-start" data-video="${index}" aria-label="Воспроизвести видео">▶</button>`
      : icon(displayIcon(e), e.directory ? "folder-icon" : "file-icon");
  const badge = ["model", "document"].includes(kind)
    ? `<span class="format-badge">${esc(cardFormat(e))}</span>`
    : "";
  const metadata = e.missing
    ? "Недоступно"
    : kind === "application"
      ? ""
      : type(e) + (!e.directory ? " · " + formatSize(e.size) : "");
  return `<${tag} ${kind === "video" ? 'tabindex="0" role="group"' : ""} class="tile card-${kind} ${selected === e.path ? "selected" : ""} ${e.missing ? "missing" : ""}" data-entry="${index}" title="${esc(e.path)}">
    <div class="tile-preview" ${kind !== "video" ? `data-preview="${index}"` : ""}>${preview}${settings.pins.includes(e.path) ? `<span class="pin-badge">${icon("pin")}</span>` : ""}</div>
    <span class="card-details"><span class="tile-name">${esc(e.name)}</span><span class="tile-meta">${esc(searchEverywhere && query ? e.path : metadata)}</span></span>${badge}
  </${tag}>`;
}
function renderFiles() {
  document.querySelectorAll("video").forEach(releaseVideo);
  const generation = ++iconGeneration;
  let list = entries
    .filter((e) => e.name.toLocaleLowerCase("ru").includes(query))
    .sort(
      (a, b) =>
        Number(b.directory) -
        Number(a.directory) +
        (Number(a.directory) === Number(b.directory)
          ? (reverse ? -1 : 1) *
            a.name.localeCompare(b.name, "ru", { numeric: true })
          : 0),
    );
  const grid = settings.view !== "list";
  $("#files").classList.toggle(
    "application-catalog",
    current === APPLICATIONS_PATH,
  );
  $("#files").innerHTML = list.length
    ? (!grid
        ? '<div class="list-head"><span>Имя</span><span class="date">Дата изменения</span><span class="type">Тип</span><span style="text-align:right">Размер</span></div>'
        : "") +
      `<div class="${grid ? "tiles" : "rows"}">${list.map((e, i) => (grid ? renderCard(e, i) : `<button class="file-row ${selected === e.path ? "selected" : ""} ${e.missing ? "missing" : ""}" data-entry="${i}" title="${esc(e.path)}"><span class="file-name"><span class="row-icon" data-preview="${i}">${icon(displayIcon(e), e.directory ? "folder-icon" : "file-icon")}</span><span>${esc(e.name)}</span>${settings.pins.includes(e.path) ? icon("pin", "row-pin") : ""}</span><span class="meta date">${e.modified ? new Date(e.modified).toLocaleDateString("ru") : ""}</span><span class="meta type">${type(e)}</span><span class="meta size">${e.directory ? "—" : e.missing ? "" : formatSize(e.size)}</span></button>`)).join("")}</div>`
    : `<div class="empty">${query ? "Ничего не найдено" : current === APPLICATIONS_PATH ? "Нет закреплённых приложений" : current === "@home" ? "Нет закреплённых файлов и папок" : current === "@recent" ? "Нет недавних файлов" : "Папка пуста"}</div>`;
  $("#status").textContent = `Объектов: ${list.length}`;
  $("#selection").textContent = selected ? base(selected) : "";
  $("#grid").classList.toggle("active", grid);
  $("#list").classList.toggle("active", !grid);
  document.querySelectorAll("[data-entry]").forEach((b) => {
    const e = list[Number(b.dataset.entry)];
    b.onclick = () => selectEntry(e.path);
    b.ondblclick = (event) => {
      if (!event.target.closest("video, [data-video]"))
        safely(() => openEntry(e));
    };
    b.oncontextmenu = (ev) => {
      ev.preventDefault();
      selectEntry(e.path);
      entryMenu(ev.clientX, ev.clientY, e);
    };
    b.onkeydown = (ev) => {
      if (ev.target.closest("video, [data-video]")) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        safely(() => openEntry(e));
      }
    };
  });
  document.querySelectorAll("[data-video]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      safely(async () => {
        button.disabled = true;
        try {
          const path = await call(
            "video_source",
            list[Number(button.dataset.video)].path,
          );
          if (!button.isConnected) return;
          document.querySelectorAll("video").forEach(releaseVideo);
          const video = document.createElement("video");
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.src = window.__TAURI__.core.convertFileSrc(path);
          video.onclick = (event) => event.stopPropagation();
          video.ondblclick = (event) => event.stopPropagation();
          video.onerror = () =>
            notice(
              "Этот формат или кодек не поддерживается. Откройте видео во внешнем проигрывателе двойным щелчком по названию.",
            );
          button.parentElement.querySelector("video")?.remove();
          button.parentElement.append(video);
          button.hidden = true;
          video.addEventListener(
            "emptied",
            () => {
              button.hidden = false;
            },
            { once: true },
          );
          await video.play();
        } finally {
          button.disabled = false;
        }
      });
    };
  });
  if (rendererObserver) rendererObserver.disconnect();
  rendererObserver = new IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        if (!change.isIntersecting) continue;
        rendererObserver.unobserve(change.target);
        const e = list[Number(change.target.dataset.preview)];
        if (e && !e.directory && !e.missing && !settings.icons[e.path])
          loadIcon(change.target, e, generation, grid);
      }
    },
    { root: $("#files"), rootMargin: "120px" },
  );
  document
    .querySelectorAll("[data-preview]")
    .forEach((el) => rendererObserver.observe(el));
}
let rendererObserver,
  iconQueue = [],
  activeIcons = 0;
function releaseVideo(video) {
  video.pause();
  const start = video.parentElement?.querySelector("[data-video]");
  if (start) start.hidden = false;
  video.removeAttribute("src");
  video.load();
  video.remove();
}
function loadIcon(el, e, generation, grid) {
  iconQueue.push({ el, e, generation, grid });
  pumpIcons();
}
const previewCache = new Map();
async function cachedPreview(e) {
  const key = JSON.stringify([e.path, e.modified, e.size]);
  if (previewCache.has(key)) return previewCache.get(key);
  const result = await call("icon", e.path);
  if (result?.thumbnail) {
    const source = new Image();
    source.src = result.image;
    await source.decode();
    result.width = source.naturalWidth;
    result.height = source.naturalHeight;
    // A tiny, pre-blurred bitmap: no live CSS blur or animation on every card.
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const scale =
        Math.max(96 / source.naturalWidth, 80 / source.naturalHeight) * 1.4;
      const w = source.naturalWidth * scale,
        h = source.naturalHeight * scale;
      ctx.filter = "blur(8px)";
      ctx.drawImage(source, (96 - w) / 2, (80 - h) / 2, w, h);
      ctx.filter = "none";
      ctx.fillStyle = "rgba(35,37,40,.15)";
      ctx.fillRect(0, 0, 96, 80);
      result.backdrop = canvas.toDataURL("image/png");
    }
  }
  if (previewCache.size >= 160)
    previewCache.delete(previewCache.keys().next().value);
  previewCache.set(key, result);
  return result;
}
function pumpIcons() {
  while (activeIcons < 4 && iconQueue.length) {
    const task = iconQueue.shift();
    if (task.generation !== iconGeneration) continue;
    activeIcons++;
    cachedPreview(task.e)
      .then((result) => {
        if (
          !result ||
          task.generation !== iconGeneration ||
          !task.el.isConnected
        )
          return;
        const img = document.createElement("img");
        img.src = result.image;
        img.alt = "";
        img.draggable = false;
        img.className =
          result.thumbnail && task.grid ? "thumbnail" : "system-icon";
        if (result.thumbnail && task.grid && result.width && result.height) {
          const metadata = task.el
            .closest(".tile")
            ?.querySelector(".tile-meta");
          if (metadata && !(searchEverywhere && query))
            metadata.textContent = `${result.width} × ${result.height} · ${cardFormat(task.e)}`;
        }
        task.el.querySelector("svg")?.remove();
        if (result.thumbnail && task.grid && result.backdrop) {
          const background = document.createElement("img");
          background.src = result.backdrop;
          background.alt = "";
          background.draggable = false;
          background.className = "thumbnail-backdrop";
          task.el.prepend(background);
          task.el.classList.add("has-thumbnail");
        }
        task.el.prepend(img);
      })
      .catch(() => {})
      .finally(() => {
        activeIcons--;
        pumpIcons();
      });
  }
}
function selectEntry(p) {
  selected = p;
  document
    .querySelectorAll("[data-entry]")
    .forEach((b) => b.classList.toggle("selected", b.title === p));
  $("#selection").textContent = base(p);
  updateHeader();
}
async function openEntry(e) {
  if (e.application) return applications.launch(e.path);
  if (e.missing) throw new Error("Файл или папка не найдены");
  if (e.directory) return navigate(e.path);
  await call("open", e.path);
  settings.recent = [
    e.path,
    ...settings.recent.filter((p) => p !== e.path),
  ].slice(0, 100);
}
function menu(x, y, actions) {
  $(".context")?.remove();
  const el = document.createElement("div");
  el.className = "context";
  for (const [i, label, fn] of actions) {
    const b = document.createElement("button");
    b.innerHTML = icon(i) + esc(label);
    b.onclick = () => {
      el.remove();
      safely(fn);
    };
    el.append(b);
  }
  document.body.append(el);
  el.style.left =
    Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)) + "px";
  el.style.top =
    Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) + "px";
  el.querySelector("button")?.focus();
}
function entryMenu(x, y, e) {
  if (e.application)
    return menu(x, y, [
      ["game", "Запустить", () => applications.launch(e.path)],
      ["folder", "Показать в Проводнике", () => call("reveal", e.path)],
      ["grid", "Сменить иконку", () => iconDialog(e.path)],
      [
        "pin",
        "Открепить приложение",
        async () => {
          settings = await applications.remove(e.path);
          await refresh();
        },
      ],
    ]);
  const actions = [
    ["folder", "Открыть", () => openEntry(e)],
    [
      "pin",
      settings.pins.includes(e.path) ? "Открепить" : "Закрепить",
      () => togglePin(e.path),
    ],
    ["folder", "Показать в Проводнике", () => call("reveal", e.path)],
    ["edit", "Переименовать", () => renameDialog(e)],
    ["grid", "Сменить иконку", () => iconDialog(e.path)],
  ];
  if (settings.sections.length)
    actions.push(["plus", "Добавить в раздел", () => sectionDialog(e.path)]);
  const sec = section();
  if (sec)
    actions.push([
      "close",
      "Убрать из раздела",
      async () => {
        sec.paths = sec.paths.filter((p) => p !== e.path);
        await saveSettings();
        await refresh();
      },
    ]);
  if (!e.missing)
    actions.push([
      "trash",
      "В корзину",
      async () => {
        if (await call("trash", e.path)) await refresh();
      },
    ]);
  menu(x, y, actions);
}
function showDialog(title, field, action) {
  dialogAction = action;
  $("#dialog-title").textContent = title;
  $("#dialog-field").innerHTML = field;
  $("#dialog-error").textContent = "";
  $("#dialog").showModal();
  $("#dialog-field input")?.select();
}
function textDialog(title, value, action) {
  showDialog(
    title,
    `<input id="value" aria-label="Название" value="${esc(value)}" required maxlength="120">`,
    action,
  );
}
function renameDialog(e) {
  textDialog("Переименовать", e.name, async (value) => {
    const result = await call("rename", e.path, value);
    selected = result.path;
    settings = result.settings;
    sidebar();
    await refresh();
  });
}
function iconDialog(p) {
  showDialog(
    "Иконка",
    `<select id="value" aria-label="Иконка"><option value="">Системная</option>${[
      ["folder", "Папка"],
      ["box", "3D-модели"],
      ["game", "Игры"],
      ["image", "Изображения"],
      ["file", "Файл"],
      ["pin", "Закрепление"],
      ["home", "Дом"],
      ["drive", "Диск"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${settings.icons[p] === v ? "selected" : ""}>${n}</option>`,
      )
      .join("")}</select>`,
    async (value) => {
      if (value) settings.icons[p] = value;
      else delete settings.icons[p];
      await saveSettings();
      sidebar();
      renderFiles();
    },
  );
}
function sectionDialog(p) {
  showDialog(
    "Добавить в раздел",
    `<select id="value" aria-label="Раздел">${settings.sections.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>`,
    async (value) => {
      const s = settings.sections.find((s) => s.id === value);
      s.paths = [...new Set([...s.paths, p])];
      await saveSettings();
      if (section()) await refresh();
    },
  );
}
async function addToCurrent(mode) {
  const paths = await call("pick", mode);
  const s = section();
  if (s) s.paths = [...new Set([...s.paths, ...paths])];
  else settings.pins = [...new Set([...settings.pins, ...paths])];
  await saveSettings();
  sidebar();
  await refresh();
}
$("#new").onclick = (e) => {
  if (current === APPLICATIONS_PATH)
    return safely(async () => {
      const next = await applications.add();
      if (next) {
        settings = next;
        await refresh();
      }
    });
  if (virtual())
    menu(e.clientX, e.clientY, [
      ["folder", "Добавить папку", () => addToCurrent("folder")],
      ["file", "Добавить файл", () => addToCurrent("file")],
    ]);
  else
    textDialog("Новая папка", "Новая папка", async (name) => {
      selected = await call("mkdir", current, name);
      await refresh();
    });
};
$("#pin").onclick = () => safely(() => togglePin(selected || current));
$("#rename").onclick = () => {
  const e = entries.find((e) => e.path === selected);
  if (e && !e.application) renameDialog(e);
};
$("#options").onclick = (e) => {
  const file = entries.find((x) => x.path === selected);
  if (file) return entryMenu(e.clientX, e.clientY, file);
  if (current === APPLICATIONS_PATH)
    return menu(e.clientX, e.clientY, [
      ["plus", "Добавить приложение", () => $("#new").click()],
    ]);
  const actions = [
    ["folder", "Добавить папку", () => pickPins("folder")],
    ["file", "Добавить файл", () => pickPins("file")],
  ];
  if (!virtual())
    actions.push(
      ["folder", "Открыть в Проводнике", () => call("open", current)],
      ["grid", "Иконка папки", () => iconDialog(current)],
    );
  menu(e.clientX, e.clientY, actions);
};
$("#dialog-form").onsubmit = async (e) => {
  e.preventDefault();
  const value = $("#value").value.trim();
  if (!value && $("#value").tagName === "INPUT") return;
  const b = $("#dialog-form button[type=submit]");
  b.disabled = true;
  try {
    await dialogAction(value);
    $("#dialog").close();
  } catch (err) {
    $("#dialog-error").textContent = err.message;
  } finally {
    b.disabled = false;
  }
};
$("#cancel").onclick = () => $("#dialog").close();
function stopGlobalSearch() {
  searchVersion++;
  clearTimeout(searchTimer);
  call("search_cancel").catch(() => {});
}
function scheduleGlobalSearch() {
  stopGlobalSearch();
  const version = searchVersion;
  entries = [];
  selected = null;
  renderFiles();
  updateHeader();
  if (query.trim().length < 2) {
    $("#status").textContent = "Введите хотя бы 2 символа";
    return;
  }
  $("#status").textContent = "Поиск по локальным дискам…";
  searchTimer = setTimeout(
    () =>
      safely(async () => {
        const id = await call("search_start", query);
        if (version !== searchVersion) return;
        let count = -1;
        const poll = async () => {
          if (version !== searchVersion) return;
          const result = await call("search_status", id);
          if (version !== searchVersion) return;
          if (count !== result.entries.length) {
            entries = result.entries;
            count = entries.length;
            renderFiles();
            updateHeader();
          }
          $("#status").textContent =
            `${result.done ? "Найдено" : "Поиск… найдено"}: ${count} · Проверено: ${result.scanned.toLocaleString("ru")}${result.skipped ? ` · Пропущено каталогов: ${result.skipped}` : ""}${result.limited ? " · Показаны первые 2000 результатов, уточните запрос" : ""}`;
          if (!result.done) searchTimer = setTimeout(() => safely(poll), 500);
        };
        await poll();
      }),
    350,
  );
}
$("#search-scope").onclick = () => {
  searchEverywhere = !searchEverywhere;
  stopGlobalSearch();
  $("#search-scope").textContent = searchEverywhere ? "Везде" : "В папке";
  $("#search-scope").setAttribute("aria-pressed", String(searchEverywhere));
  $("#search").placeholder = searchEverywhere
    ? "Поиск по компьютеру"
    : "Поиск в папке";
  $("#search").setAttribute("aria-label", $("#search").placeholder);
  if (searchEverywhere && query) scheduleGlobalSearch();
  else safely(() => refresh());
  $("#search").focus();
};
$("#search").oninput = () => {
  query = $("#search").value.toLocaleLowerCase("ru");
  selected = null;
  if (searchEverywhere && query) return scheduleGlobalSearch();
  if (searchEverywhere) {
    stopGlobalSearch();
    safely(() => refresh());
    return;
  }
  renderFiles();
  updateHeader();
};
for (const v of ["list", "grid"])
  $("#" + v).onclick = () =>
    safely(async () => {
      settings.view = v;
      await saveSettings();
      renderFiles();
    });
$("#sort").onclick = () => {
  reverse = !reverse;
  renderFiles();
};
$("#refresh").onclick = () => refresh();
async function goHistory(delta) {
  const next = historyAt + delta;
  if (next < 0 || next >= history.length) return;
  const old = historyAt;
  historyAt = next;
  await navigate(history[next], false);
  if (current !== history[next]) historyAt = old;
  updateHeader();
}
$("#back").onclick = () => goHistory(-1);
$("#forward").onclick = () => goHistory(1);
$("#up").onclick = () => safely(() => navigate(parent));
for (const [id, action] of [
  ["window-min", "minimize"],
  ["window-max", "maximize"],
  ["window-close", "close"],
])
  $("#" + id).onclick = () => call("window", action);
$(".titlebar").ondblclick = (e) => {
  if (!e.target.closest("button")) call("window", "maximize");
};
api.onMaximized((max) => {
  $("#window-max").title = max ? "Восстановить" : "Развернуть";
  $("#window-max").setAttribute("aria-label", $("#window-max").title);
  $("#window-max").innerHTML = max
    ? '<svg viewBox="0 0 12 12"><path d="M4 4V1h7v7H8"/><rect x="1" y="4" width="7" height="7"/></svg>'
    : '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8"/></svg>';
});
api.onFilesChanged((p) => {
  if (p === current && !loading) refresh();
});
api.onHistory((d) => goHistory(d));
for (const ev of ["mousedown", "mouseup", "auxclick"])
  window.addEventListener(
    ev,
    (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (ev === "mouseup") goHistory(e.button === 3 ? -1 : 1);
    },
    { capture: true, passive: false },
  );
document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".context") &&
    !e.target.closest("#options") &&
    !e.target.closest("#add-pin") &&
    !e.target.closest("#new")
  )
    $(".context")?.remove();
});
$("#files").addEventListener("click", (e) => {
  if (e.target.closest("[data-entry]")) return;
  selected = null;
  document
    .querySelectorAll(".selected")
    .forEach((b) => b.classList.remove("selected"));
  $("#selection").textContent = "";
  updateHeader();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $(".context")?.remove();
  if (e.target.matches("input,select") || $("#dialog").open) return;
  const target = entries.find((x) => x.path === selected);
  if (e.key === "F2" && target && !target.application) {
    e.preventDefault();
    renameDialog(target);
  }
  if (e.key === "F5") {
    e.preventDefault();
    refresh();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.altKey && e.key === "ArrowUp") {
    e.preventDefault();
    if (!virtual()) navigate(parent);
  }
  if (e.key === "Enter" && target) {
    e.preventDefault();
    safely(() => openEntry(target));
  }
});
safely(async () => {
  const init = await call("bootstrap");
  settings = init.settings;
  locations = init.locations;
  sidebar();
  await refresh(true);
});
