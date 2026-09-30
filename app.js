const $ = (id) => document.getElementById(id);
const SHIFTS = {
  morning: { label: "กะเช้า", start: "06:00", end: "14:00" },
  evening: { label: "กะบ่าย", start: "14:00", end: "22:00" },
  both: { label: "ทั้งสองกะ", start: "06:00", end: "22:00" },
};
const state = {
  segments: [],
  results: [],
  byDay: new Map(),
  selected: null,
  marker: null,
  circle: null,
  month: new Date(),
};

const map = L.map("map").setView([13.7563, 100.5018], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const radiusValue = () => Math.min(80, Math.max(20, Number($("radius").value) || 45));
const currentShiftKey = () => document.querySelector("input[name=shift]:checked")?.value || "morning";

function setWork(lat, lng, pan = true) {
  $("lat").value = Number(lat).toFixed(6);
  $("lng").value = Number(lng).toFixed(6);
  const ll = [lat, lng];
  if (state.marker) state.marker.setLatLng(ll);
  else state.marker = L.marker(ll).addTo(map);
  if (state.circle) state.circle.setLatLng(ll).setRadius(radiusValue());
  else state.circle = L.circle(ll, { radius: radiusValue(), color: "#3d7eaf", fillOpacity: 0.18 }).addTo(map);
  if (pan) map.setView(ll, 18);
}

map.on("click", (e) => setWork(e.latlng.lat, e.latlng.lng, false));
$("radius").addEventListener("input", () => {
  $("radiusLabel").textContent = `${radiusValue()} ม.`;
  if (state.circle) state.circle.setRadius(radiusValue());
});
["lat", "lng"].forEach((id) => {
  $(id).addEventListener("change", () => {
    const lat = parseFloat($("lat").value);
    const lng = parseFloat($("lng").value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setWork(lat, lng);
  });
});

function parseLatLng(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    if (value.latLng) return parseLatLng(value.latLng);
    if (typeof value.latitudeE7 === "number" && typeof value.longitudeE7 === "number") {
      return { lat: value.latitudeE7 / 1e7, lng: value.longitudeE7 / 1e7 };
    }
    if (typeof value.latitude === "number" && typeof value.longitude === "number") {
      return { lat: value.latitude, lng: value.longitude };
    }
  }
  const text = String(value);
  const geo = text.match(/geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
  if (geo) return { lat: +geo[1], lng: +geo[2] };
  const deg = text.match(/(-?\d+\.?\d*)\s*°\s*,\s*(-?\d+\.?\d*)\s*°?/);
  if (deg) return { lat: +deg[1], lng: +deg[2] };
  const plain = text.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (plain) return { lat: +plain[1], lng: +plain[2] };
  return null;
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const n = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(n)));
}
const toDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function extractSegments(data) {
  const out = [];
  const add = (start, end, loc) => {
    const s = toDate(start);
    const e = toDate(end);
    const p = parseLatLng(loc);
    if (!s || !e || !p) return;
    out.push({ start: s, end: e, loc: p });
  };
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object") return;
    const visit = node.visit || node.placeVisit;
    if (visit) {
      const top = visit.topCandidate || visit.location || {};
      add(
        node.startTime || visit.startTimestamp || visit.duration?.startTimestamp,
        node.endTime || visit.endTimestamp || visit.duration?.endTimestamp,
        top.placeLocation || top.latLng || (visit.centerLatE7 && { latitudeE7: visit.centerLatE7, longitudeE7: visit.centerLngE7 })
      );
    }
    if (Array.isArray(node.timelinePath) && node.timelinePath.length) {
      const first = node.timelinePath[0];
      const last = node.timelinePath[node.timelinePath.length - 1];
      add(first.time || node.startTime, last.time || node.endTime, last.point || first.point);
    }
    const act = node.activitySegment;
    if (act) add(act.duration?.startTimestamp || node.startTime, act.duration?.endTimestamp || node.endTime, act.startLocation);
    Object.values(node).forEach((v) => typeof v === "object" && v && walk(v));
  };
  walk(data);
  return out;
}

function extractPlaces(data) {
  return (data?.userLocationProfile?.frequentPlaces || [])
    .map((p) => ({ label: p.label || "สถานที่ที่ไปบ่อย", loc: parseLatLng(p.placeLocation || p) }))
    .filter((p) => p.loc);
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (d) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
const thaiDate = (key) => new Date(`${key}T00:00:00`).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const parseTimeOnDay = (day, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${day}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
};
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2.getTime(), b2.getTime()) - Math.max(a1.getTime(), b1.getTime()));
const selectedDays = () => new Set([...document.querySelectorAll("#days input:checked")].map((el) => Number(el.value)));

async function readFile(file) {
  const data = JSON.parse(await file.text());
  state.segments = extractSegments(data);
  $("fileInfo").textContent = `${file.name} · ${state.segments.length.toLocaleString()} ช่วง`;
  $("detectedPlaces").innerHTML = "";
  for (const p of extractPlaces(data)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn";
    btn.textContent = p.label;
    btn.addEventListener("click", () => setWork(p.loc.lat, p.loc.lng));
    $("detectedPlaces").appendChild(btn);
  }
}

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f).catch(showError); });
$("file").addEventListener("change", (e) => { if (e.target.files[0]) readFile(e.target.files[0]).catch(showError); });
function showError(err) { $("error").hidden = false; $("error").textContent = err.message || "อ่านไฟล์ไม่สำเร็จ"; }

function analyze() {
  $("error").hidden = true;
  if (!state.segments.length) throw new Error("ยังไม่มีข้อมูล Timeline");
  const lat = parseFloat($("lat").value);
  const lng = parseFloat($("lng").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("กรุณาปักหมุดจุดปั๊ม");
  const radius = radiusValue();
  const minHours = Math.max(6, Number($("minHours").value) || 6);
  $("minHours").value = minHours;
  const shift = SHIFTS[currentShiftKey()];
  const days = selectedDays();
  const from = $("dateFrom").value;
  const to = $("dateTo").value;
  const work = { lat, lng };
  const byDay = new Map();

  for (const seg of state.segments) {
    if (haversine(work, seg.loc) > radius) continue;
    const key = ymd(seg.start);
    if (from && key < from) continue;
    if (to && key > to) continue;
    if (!days.has(seg.start.getDay())) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(seg);
  }
  if (from && to) {
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      const key = ymd(cursor);
      if (days.has(cursor.getDay()) && !byDay.has(key)) byDay.set(key, []);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  state.byDay = byDay;
  state.results = [...byDay.keys()].sort().map((day) => {
    let ms = 0, first = null, last = null;
    const visits = [];
    const winStart = parseTimeOnDay(day, shift.start);
    const winEnd = parseTimeOnDay(day, shift.end);
    for (const seg of byDay.get(day) || []) {
      const piece = overlap(seg.start, seg.end, winStart, winEnd);
      if (!piece) continue;
      ms += piece;
      const s = new Date(Math.max(seg.start, winStart));
      const e = new Date(Math.min(seg.end, winEnd));
      visits.push({ start: s, end: e, hours: piece / 3600000 });
      if (!first || s < first) first = s;
      if (!last || e > last) last = e;
    }
    const hours = ms / 3600000;
    let status = "ไม่พบที่ปั๊ม", cls = "bad";
    if (hours >= minHours) { status = "ไปทำงาน"; cls = "ok"; }
    else if (hours > 0) { status = "ไปไม่ครบ 6 ชม."; cls = "warn"; }
    return { day, shift: shift.label, status, cls, first, last, hours, visits, minHours };
  });

  if (state.results.length) {
    state.month = new Date(`${state.results[0].day}T00:00:00`);
    state.selected = state.results[0].day;
  }
  render();
  showPane("board");
}

function render() {
  const rows = state.results;
  const ok = rows.filter((r) => r.cls === "ok").length;
  const warn = rows.filter((r) => r.cls === "warn").length;
  const bad = rows.filter((r) => r.cls === "bad").length;
  $("statOk").textContent = ok;
  $("statWarn").textContent = warn;
  $("statBad").textContent = bad;
  $("statRate").textContent = rows.length ? `${Math.round((ok / rows.length) * 100)}%` : "—";
  $("resultHint").textContent = rows.length
    ? `${SHIFTS[currentShiftKey()].label} · รัศมี ${radiusValue()} ม. · เกณฑ์ ${$("minHours").value} ชม.`
    : "กดวันที่เพื่อดูรายละเอียด";
  $("csv").disabled = !rows.length;
  renderCalendar();
  renderDetail(state.selected);
}

function renderCalendar() {
  $("monthTitle").textContent = state.month.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  const y = state.month.getFullYear();
  const m = state.month.getMonth();
  const startPad = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const mapRows = Object.fromEntries(state.results.map((r) => [r.day, r]));
  let html = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < startPad; i++) html += `<div class="cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const row = mapRows[key];
    const sel = key === state.selected ? " selected" : "";
    html += `<button type="button" class="cell ${row ? row.cls : "empty"}${sel}" data-day="${key}">
      <span class="n">${d}</span>${row ? `<span class="h">${row.hours.toFixed(1)} ชม.</span>` : ""}
    </button>`;
  }
  $("calendar").innerHTML = html;
  $("calendar").querySelectorAll(".cell[data-day]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selected = el.dataset.day;
      renderCalendar();
      renderDetail(el.dataset.day);
    });
  });
}

function renderDetail(day) {
  const row = state.results.find((r) => r.day === day);
  if (!day) {
    $("detailTitle").textContent = "เลือกวันที่บนปฏิทิน";
    $("detailStatus").textContent = "ยังไม่มีข้อมูล";
    $("dShift").textContent = $("dIn").textContent = $("dOut").textContent = $("dHours").textContent = "—";
    $("detailTimeline").innerHTML = "";
    return;
  }
  $("detailTitle").textContent = thaiDate(day);
  if (!row) {
    $("detailStatus").textContent = "นอกเงื่อนไขที่ตั้งไว้";
    $("detailStatus").className = "detail-status";
    $("dShift").textContent = SHIFTS[currentShiftKey()].label;
    $("dIn").textContent = $("dOut").textContent = $("dHours").textContent = "—";
    $("detailTimeline").innerHTML = `<div class="tl"><span>ไม่มีช่วงเวลาในรัศมีปั๊ม</span></div>`;
    $("detailNote").textContent = "วันนี้ไม่อยู่ในผลลัพธ์ตามกะ รัศมี หรือวันทำงานที่เลือก";
    return;
  }
  $("detailStatus").textContent = row.status;
  $("detailStatus").className = `detail-status ${row.cls}`;
  $("dShift").textContent = row.shift;
  $("dIn").textContent = row.first ? hm(row.first) : "—";
  $("dOut").textContent = row.last ? hm(row.last) : "—";
  $("dHours").textContent = `${row.hours.toFixed(2)} ชม.`;
  $("detailTimeline").innerHTML = row.visits.length
    ? row.visits.map((v) => `<div class="tl"><span>${hm(v.start)} – ${hm(v.end)}</span><b>${v.hours.toFixed(2)} ชม.</b></div>`).join("")
    : `<div class="tl"><span>ไม่พบช่วงเวลาในรัศมี</span></div>`;
  $("detailNote").textContent = row.cls === "ok"
    ? `อยู่ในรัศมีจุดปั๊มครบเกณฑ์ ${row.minHours} ชั่วโมง จึงนับว่าไปทำงาน`
    : row.cls === "warn"
      ? `มีสัญญาณที่ปั๊ม แต่รวมแล้วไม่ถึง ${row.minHours} ชั่วโมง`
      : "ไม่พบพิกัดในรัศมีจุดปั๊มระหว่างช่วงกะนี้";
}

$("run").addEventListener("click", () => { try { analyze(); } catch (e) { showError(e); } });
$("csv").addEventListener("click", () => {
  const lines = ["date,shift,status,arrive,leave,hours"].concat(
    state.results.map((r) => [r.day, r.shift, r.status, r.first ? hm(r.first) : "", r.last ? hm(r.last) : "", r.hours.toFixed(2)].join(","))
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  a.download = "work-attendance.csv";
  a.click();
});
$("prevMonth").addEventListener("click", () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); });
$("nextMonth").addEventListener("click", () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); });

$("searchBtn").addEventListener("click", async () => {
  const q = $("search").value.trim();
  if (!q) return;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!data[0]) return showError(new Error("ไม่พบสถานที่"));
  setWork(+data[0].lat, +data[0].lon);
});

function showPane(name) {
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("show", p.id === `pane-${name}`));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
  if (name === "setup") setTimeout(() => map.invalidateSize(), 200);
}
document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showPane(btn.dataset.pane)));
showPane("setup");

const fields = ["lat", "lng", "radius", "minHours", "dateFrom", "dateTo"];
$("save").addEventListener("click", () => {
  const payload = Object.fromEntries(fields.map((id) => [id, $(id).value]));
  payload.days = [...document.querySelectorAll("#days input")].map((el) => el.checked);
  payload.shift = currentShiftKey();
  localStorage.setItem("workpulse-gas", JSON.stringify(payload));
  $("resultHint").textContent = "บันทึกค่าตั้งแล้ว";
});
try {
  const raw = JSON.parse(localStorage.getItem("workpulse-gas") || "null");
  if (raw) {
    fields.forEach((id) => { if (raw[id] != null) $(id).value = raw[id]; });
    document.querySelectorAll("#days input").forEach((el, i) => { if (raw.days) el.checked = raw.days[i]; });
    if (raw.shift) {
      const el = document.querySelector(`input[name=shift][value="${raw.shift}"]`);
      if (el) el.checked = true;
    }
    $("radiusLabel").textContent = `${radiusValue()} ม.`;
    if (raw.lat && raw.lng) setWork(+raw.lat, +raw.lng, false);
  }
} catch {}

$("helpBtn").addEventListener("click", () => { $("helpModal").hidden = false; });
$("closeHelp").addEventListener("click", () => { $("helpModal").hidden = true; });
$("helpModal").addEventListener("click", (e) => { if (e.target.id === "helpModal") $("helpModal").hidden = true; });
setTimeout(() => map.invalidateSize(), 250);
window.addEventListener("resize", () => map.invalidateSize());
