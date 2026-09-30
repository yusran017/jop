const $ = (id) => document.getElementById(id);

const state = {
  raw: null,
  segments: [],
  results: [],
  marker: null,
};

const map = L.map("map").setView([13.7563, 100.5018], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

function setWork(lat, lng, pan = true) {
  $("lat").value = Number(lat).toFixed(6);
  $("lng").value = Number(lng).toFixed(6);
  if (state.marker) state.marker.setLatLng([lat, lng]);
  else state.marker = L.marker([lat, lng]).addTo(map);
  if (pan) map.setView([lat, lng], 16);
}

map.on("click", (e) => setWork(e.latlng.lat, e.latlng.lng, false));

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
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const n =
    s1 * s1 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(n)));
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractSegments(data) {
  const out = [];
  const add = (start, end, loc, label) => {
    const s = toDate(start);
    const e = toDate(end);
    const p = parseLatLng(loc);
    if (!s || !e || !p) return;
    out.push({ start: s, end: e, loc: p, label: label || "" });
  };

  const handleVisit = (obj) => {
    const visit = obj.visit || obj.placeVisit;
    if (!visit) return;
    const top = visit.topCandidate || visit.location || {};
    const loc =
      top.placeLocation ||
      top.latLng ||
      visit.centerLatE7 && { latitudeE7: visit.centerLatE7, longitudeE7: visit.centerLngE7 };
    add(obj.startTime || visit.startTimestamp || visit.duration?.startTimestamp, obj.endTime || visit.endTimestamp || visit.duration?.endTimestamp, loc, top.semanticType || top.label || "");
  };

  const handlePath = (obj) => {
    const path = obj.timelinePath;
    if (!Array.isArray(path) || !path.length) return;
    let runStart = null;
    let last = null;
    for (const pt of path) {
      const loc = parseLatLng(pt.point || pt);
      const t = toDate(pt.time || obj.startTime);
      if (!loc || !t) continue;
      if (!runStart) runStart = { t, loc };
      last = { t, loc };
    }
    if (runStart && last) add(runStart.t, last.t, last.loc, "path");
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    if (node.visit || node.placeVisit || node.timelinePath || node.activitySegment) {
      handleVisit(node);
      handlePath(node);
      const act = node.activitySegment;
      if (act) {
        add(act.duration?.startTimestamp || node.startTime, act.duration?.endTimestamp || node.endTime, act.startLocation || act.waypointPath?.waypoints?.[0], "activity");
      }
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") walk(v);
    }
  };

  if (Array.isArray(data)) walk(data);
  else walk(data);
  return out;
}

function extractFrequentPlaces(data) {
  const places = [];
  const profile = data?.userLocationProfile?.frequentPlaces || [];
  for (const p of profile) {
    const loc = parseLatLng(p.placeLocation || p);
    if (!loc) continue;
    places.push({ label: p.label || p.semanticType || "สถานที่ที่ไปบ่อย", loc });
  }
  return places;
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hm(date) {
  return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function parseTimeOnDay(dayStr, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${dayStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, end - start);
}

function selectedDays() {
  return new Set(
    [...document.querySelectorAll("#days input:checked")].map((el) => Number(el.value))
  );
}

function analyze() {
  $("error").hidden = true;
  if (!state.segments.length) throw new Error("ยังไม่มีข้อมูล Timeline ที่อ่านได้");
  const lat = parseFloat($("lat").value);
  const lng = parseFloat($("lng").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("กรุณาใส่พิกัดที่ทำงาน หรือปักหมุดบนแผนที่");
  const radius = Number($("radius").value) || 120;
  const minHours = Number($("minHours").value) || 0;
  const workStart = $("workStart").value || "08:00";
  const workEnd = $("workEnd").value || "18:00";
  const onlyWorkHours = $("onlyWorkHours").checked;
  const days = selectedDays();
  const from = $("dateFrom").value;
  const to = $("dateTo").value;
  const work = { lat, lng };

  const byDay = new Map();
  for (const seg of state.segments) {
    if (haversine(work, seg.loc) > radius) continue;
    const dayKey = ymd(seg.start);
    if (from && dayKey < from) continue;
    if (to && dayKey > to) continue;
    if (!days.has(seg.start.getDay())) continue;
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(seg);
  }

  const keys = [...byDay.keys()].sort();
  // also include empty workdays in range if specified
  if (from && to) {
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      const key = ymd(cursor);
      if (days.has(cursor.getDay()) && !byDay.has(key)) byDay.set(key, []);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const rows = [...byDay.keys()].sort().map((day) => {
    const segs = byDay.get(day);
    let ms = 0;
    let first = null;
    let last = null;
    const winStart = parseTimeOnDay(day, workStart);
    const winEnd = parseTimeOnDay(day, workEnd);
    for (const seg of segs) {
      let s = seg.start;
      let e = seg.end;
      if (e < s) continue;
      if (onlyWorkHours) {
        ms += overlapMs(s, e, winStart, winEnd);
        const clippedStart = new Date(Math.max(s.getTime(), winStart.getTime()));
        const clippedEnd = new Date(Math.min(e.getTime(), winEnd.getTime()));
        if (clippedEnd > clippedStart) {
          if (!first || clippedStart < first) first = clippedStart;
          if (!last || clippedEnd > last) last = clippedEnd;
        }
      } else {
        ms += e.getTime() - s.getTime();
        if (!first || s < first) first = s;
        if (!last || e > last) last = e;
      }
    }
    const hours = ms / 3600000;
    let status = "ไม่พบที่ทำงาน";
    let cls = "bad";
    if (hours >= minHours && hours > 0) {
      status = "ไปทำงาน";
      cls = "ok";
    } else if (hours > 0) {
      status = "ไปไม่ครบเกณฑ์";
      cls = "warn";
    }
    return { day, status, cls, first, last, hours };
  });

  state.results = rows;
  renderResults(rows, minHours);
}

function renderResults(rows, minHours) {
  const ok = rows.filter((r) => r.cls === "ok").length;
  const warn = rows.filter((r) => r.cls === "warn").length;
  const bad = rows.filter((r) => r.cls === "bad").length;
  $("stats").innerHTML = `
    <div class="stat"><span>ไปทำงาน</span><b class="ok">${ok}</b></div>
    <div class="stat"><span>ไปไม่ครบ ${minHours} ชม.</span><b class="warn">${warn}</b></div>
    <div class="stat"><span>ไม่พบที่ทำงาน</span><b class="bad">${bad}</b></div>
  `;
  $("tbody").innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.day}</td>
        <td class="${r.cls}">${r.status}</td>
        <td>${r.first ? hm(r.first) : "-"}</td>
        <td>${r.last ? hm(r.last) : "-"}</td>
        <td>${r.hours ? r.hours.toFixed(2) : "0.00"}</td>
      </tr>`
    )
    .join("");
  $("results").hidden = false;
  $("csv").disabled = !rows.length;
}

function downloadCsv() {
  const header = ["date", "status", "arrive", "leave", "hours"];
  const lines = [header.join(",")].concat(
    state.results.map((r) =>
      [r.day, r.status, r.first ? hm(r.first) : "", r.last ? hm(r.last) : "", r.hours.toFixed(2)].join(",")
    )
  );
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "work-attendance.csv";
  a.click();
}

$("file").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  $("error").hidden = true;
  if (!file) return;
  $("fileLabel").textContent = file.name;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    state.raw = data;
    state.segments = extractSegments(data);
    $("fileInfo").textContent = `อ่านได้ ${state.segments.length.toLocaleString()} ช่วงเวลาจากไฟล์`;
    const places = extractFrequentPlaces(data);
    $("detectedPlaces").innerHTML = "";
    for (const p of places) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `ใช้ ${p.label}`;
      btn.addEventListener("click", () => setWork(p.loc.lat, p.loc.lng));
      $("detectedPlaces").appendChild(btn);
      if (String(p.label).toUpperCase() === "WORK" && !$("lat").value) setWork(p.loc.lat, p.loc.lng);
    }
  } catch (err) {
    $("fileInfo").textContent = "อ่านไฟล์ไม่สำเร็จ";
    $("error").hidden = false;
    $("error").textContent = "ไฟล์ JSON ไม่ถูกต้อง หรือไม่ใช่รูปแบบ Timeline";
  }
});

$("run").addEventListener("click", () => {
  try {
    analyze();
  } catch (err) {
    $("error").hidden = false;
    $("error").textContent = err.message;
  }
});

$("csv").addEventListener("click", downloadCsv);

setTimeout(() => map.invalidateSize(), 300);
window.addEventListener("resize", () => map.invalidateSize());
