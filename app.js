const STORAGE_KEY = "ritmo-machine-readings-v1";
const MACHINE_NAMES = [
  "Torno 1", "Torno 2", "Torno 3",
  "Fresadora 1", "Fresadora 2", "Fresadora 3",
  "CNC 1", "CNC 2", "CNC 3", "Rectificadora"
];
const state = { readings: loadReadings(), draft: [], photos: [], recordedAt: null, busy: false };

const elements = {
  dateTime: document.querySelector("#reading-datetime"),
  photo: document.querySelector("#photo-input"),
  photoLabel: document.querySelector("#photo-button-label"),
  photoStrip: document.querySelector("#photo-strip"),
  rows: document.querySelector("#machine-rows"),
  status: document.querySelector("#scan-status"),
  message: document.querySelector("#scan-message"),
  save: document.querySelector("#save-button"),
  saveHint: document.querySelector("#save-hint"),
  historyCount: document.querySelector("#history-count"),
  historyList: document.querySelector("#history-list"),
  emptyHistory: document.querySelector("#empty-history"),
  historySummary: document.querySelector("#history-summary"),
  historyError: document.querySelector("#history-error"),
  clearHistory: document.querySelector("#clear-history-button"),
  export: document.querySelector("#export-button")
};

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeValue(date = new Date()) {
  const datePart = localDateValue(date);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${datePart}T${hours}:${minutes}:${seconds}`;
}

function displayDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Hora no registrada";
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(date);
}

function isValidLocalDateTime(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && localDateTimeValue(date) === value;
}

async function readPhotoTimestamp(file) {
  const attachedAt = new Date();
  try {
    const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("La foto no contiene EXIF JPEG.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const segmentLength = view.getUint16(offset + 2, false);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if (marker === 0xe1 && segmentLength >= 14 &&
          bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 &&
          bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66 &&
          bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
        const tiff = offset + 10;
        const byteOrder = view.getUint16(tiff, false);
        const littleEndian = byteOrder === 0x4949;
        if (!littleEndian && byteOrder !== 0x4d4d) break;
        const read16 = position => view.getUint16(position, littleEndian);
        const read32 = position => view.getUint32(position, littleEndian);
        if (read16(tiff + 2) !== 42) break;
        const ifd0 = tiff + read32(tiff + 4);
        if (ifd0 + 2 > bytes.length) break;
        const entryCount = read16(ifd0);
        let exifIfd = null;
        let dateText = null;
        for (let index = 0; index < entryCount; index += 1) {
          const entry = ifd0 + 2 + index * 12;
          if (entry + 12 > bytes.length) break;
          const tag = read16(entry);
          if (tag === 0x8769) exifIfd = tiff + read32(entry + 8);
          if (tag === 0x0132) {
            const count = read32(entry + 4);
            const valueOffset = count <= 4 ? entry + 8 : tiff + read32(entry + 8);
            if (valueOffset + Math.min(count, 20) <= bytes.length) {
              const value = new TextDecoder().decode(bytes.subarray(valueOffset, valueOffset + Math.min(count, 20)));
              if (/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(value)) dateText = value.slice(0, 19);
            }
          }
        }
        if (exifIfd !== null && exifIfd + 2 <= bytes.length) {
          const exifCount = read16(exifIfd);
          for (let index = 0; index < exifCount; index += 1) {
            const entry = exifIfd + 2 + index * 12;
            if (entry + 12 > bytes.length) break;
            const tag = read16(entry);
            if (tag !== 0x9003 && tag !== 0x9004) continue;
            const count = read32(entry + 4);
            const valueOffset = count <= 4 ? entry + 8 : tiff + read32(entry + 8);
            if (valueOffset + Math.min(count, 20) > bytes.length) continue;
            const value = new TextDecoder().decode(bytes.subarray(valueOffset, valueOffset + Math.min(count, 20)));
            if (/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
              dateText = value.slice(0, 19);
              break;
            }
          }
        }
        if (dateText) {
          const timestamp = `${dateText.slice(0, 4)}-${dateText.slice(5, 7)}-${dateText.slice(8, 10)}T${dateText.slice(11)}`;
          if (isValidLocalDateTime(timestamp)) return { timestamp, source: "Hora de captura" };
        }
      }
      offset += 2 + segmentLength;
    }
  } catch (error) {
    console.info("La foto no incluye una fecha EXIF legible; se usará la fecha del archivo o la hora de adjunto.", error);
  }
  const modifiedAt = new Date(file.lastModified);
  if (file.lastModified > 0 && !Number.isNaN(modifiedAt.getTime()) &&
      modifiedAt.getFullYear() >= 2000 && modifiedAt.getTime() <= attachedAt.getTime() + 60000) {
    return { timestamp: localDateTimeValue(modifiedAt), source: "Fecha del archivo" };
  }
  return { timestamp: localDateTimeValue(attachedAt), source: "Hora de adjunto" };
}

function loadReadings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.error("No se pudieron leer las lecturas guardadas:", error);
    return [];
  }
}

function saveReadings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.readings));
  } catch (error) {
    showStatus("No se pudo guardar. Revisa el espacio disponible en el dispositivo.", true);
    console.error("No se pudieron guardar las lecturas:", error);
    return false;
  }
  return true;
}

function showStatus(message, isError = false, visible = true) {
  elements.status.hidden = !visible;
  elements.status.classList.toggle("error", isError);
  elements.message.textContent = message;
  elements.status.querySelector(".status-spinner").style.display = isError ? "none" : "";
}

function makeMachine(name = "", seconds = null) {
  const duration = seconds === null ? { days: "", hours: "", minutes: "", seconds: "" } : secondsToFields(seconds);
  return { name, ...duration };
}

function secondsToFields(totalSeconds) {
  const value = Math.max(0, Math.floor(totalSeconds));
  return {
    days: String(Math.floor(value / 86400)),
    hours: String(Math.floor(value % 86400 / 3600)).padStart(2, "0"),
    minutes: String(Math.floor(value % 3600 / 60)).padStart(2, "0"),
    seconds: String(value % 60).padStart(2, "0")
  };
}

function fieldsToSeconds(machine) {
  const fields = [machine.days, machine.hours, machine.minutes, machine.seconds];
  if (fields.some(value => String(value).trim() === "")) return null;
  const values = fields.map(value => Number(value));
  if (values.some(value => !Number.isInteger(value) || value < 0)) return null;
  if (values[1] > 23 || values[2] > 59 || values[3] > 59) return null;
  return values[0] * 86400 + values[1] * 3600 + values[2] * 60 + values[3];
}

function renderRows() {
  elements.rows.replaceChildren();
  state.draft.forEach((machine, index) => {
    const row = document.createElement("div");
    row.className = "machine-table machine-row";
    const name = document.createElement("input");
    name.className = "machine-name";
    name.type = "text";
    name.value = machine.name;
    name.setAttribute("aria-label", `Nombre de la máquina ${index + 1}`);
    name.placeholder = "Nombre de máquina";
    name.addEventListener("input", () => {
      state.draft[index].name = name.value;
      updateSaveButton();
    });

    const duration = document.createElement("div");
    duration.className = "duration-inputs";
    [["days", "d"], ["hours", "h"], ["minutes", "m"], ["seconds", "s"]].forEach(([key, unit], fieldIndex) => {
      const wrapper = document.createElement("label");
      wrapper.className = "duration-field";
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "0";
      input.max = fieldIndex === 1 ? "23" : fieldIndex > 1 ? "59" : "";
      input.placeholder = "00";
      input.value = machine[key];
      input.setAttribute("aria-label", `${machine.name || "Máquina"}: ${unit}`);
      input.addEventListener("input", () => {
        state.draft[index][key] = input.value;
        input.setCustomValidity(fieldsToSeconds(state.draft[index]) === null ? "Ingresa días, horas de 0 a 23, y minutos y segundos de 0 a 59." : "");
        updateSaveButton();
      });
      const label = document.createElement("small");
      label.textContent = unit;
      wrapper.append(input, label);
      duration.append(wrapper);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-row";
    remove.setAttribute("aria-label", `Quitar ${machine.name || "máquina"}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.draft.splice(index, 1);
      renderRows();
    });
    row.append(name, duration, remove);
    elements.rows.append(row);
  });
  updateSaveButton();
}

function updateSaveButton() {
  const valid = Boolean(state.recordedAt) && state.draft.length > 0 && state.draft.every(machine =>
    machine.name.trim() && fieldsToSeconds(machine) !== null
  );
  elements.save.disabled = !valid || state.busy;
  if (!state.recordedAt) {
    elements.saveHint.textContent = "Agrega una foto para asignar automáticamente la fecha y hora.";
  } else if (!state.draft.length) {
    elements.saveHint.textContent = "Agrega los datos de las máquinas.";
  } else if (state.draft.some(machine => !machine.name.trim() || fieldsToSeconds(machine) === null)) {
    elements.saveHint.textContent = "Completa los datos de las máquinas.";
  } else {
    elements.saveHint.textContent = `${state.draft.length} máquina${state.draft.length === 1 ? "" : "s"} lista${state.draft.length === 1 ? "" : "s"} para guardar.`;
  }
}

function normalizeText(text) {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[|]/g, " ").replace(/\b[ij](?=(?:dias?|horas?|min|seg)\b)/g, "")
    .replace(/\b([o])(?=\s*(?:dias|horas|min|seg|s\b))/g, "0");
}

function parseOcr(text) {
  const normalized = normalizeText(text);
  const parsed = [];
  const machineRegex = /\b(rectificadora|(?:torno|fresadora|cnc)\s*[1-9])\b/g;
  const matches = [...normalized.matchAll(machineRegex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
    const following = normalized.slice(start, end).slice(0, 260);
    const readField = pattern => following.match(pattern)?.[1] ?? "";
    const fields = {
      days: readField(/(\d{1,3})\D{0,10}?\b(?:dias?|d)\b/),
      hours: readField(/(\d{1,2})\D{0,10}?\b(?:horas?|h)\b/),
      minutes: readField(/(\d{1,2})\D{0,10}?\b(?:min(?:utos?)?|m)\b/),
      seconds: readField(/(\d{1,2})\D{0,10}?\b(?:seg(?:undos?)?|s)\b/)
    };
    if (fields.hours !== "" && Number(fields.hours) > 23) fields.hours = "";
    if (fields.minutes !== "" && Number(fields.minutes) > 59) fields.minutes = "";
    if (fields.seconds !== "" && Number(fields.seconds) > 59) fields.seconds = "";
    const detectedName = match[1].replace(/\b(cnc|torno|fresadora)\s*([1-9])\b/, "$1 $2")
      .replace(/\s+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
    const name = MACHINE_NAMES.find(item => item.toLocaleLowerCase("es") === detectedName.toLocaleLowerCase("es")) || detectedName;
    parsed.push({
      name,
      days: fields.days === "" ? "" : String(Number(fields.days)),
      hours: fields.hours === "" ? "" : String(Number(fields.hours)).padStart(2, "0"),
      minutes: fields.minutes === "" ? "" : String(Number(fields.minutes)).padStart(2, "0"),
      seconds: fields.seconds === "" ? "" : String(Number(fields.seconds)).padStart(2, "0")
    });
  }
  return parsed;
}

function mergeOcrReadings(primary, secondary) {
  const readings = new Map(primary.map(machine => [machine.name.toLocaleLowerCase("es"), { ...machine }]));
  secondary.forEach(machine => {
    const key = machine.name.toLocaleLowerCase("es");
    const existing = readings.get(key);
    if (!existing) {
      readings.set(key, { ...machine });
      return;
    }
    ["days", "hours", "minutes", "seconds"].forEach(field => {
      if (existing[field] === "" && machine[field] !== "") existing[field] = machine[field];
    });
  });
  return [...readings.values()];
}

function mergeDraft(recognized) {
  recognized.forEach(machine => {
    const existing = state.draft.find(item => item.name.toLocaleLowerCase("es") === machine.name.toLocaleLowerCase("es"));
    if (existing) {
      ["days", "hours", "minutes", "seconds"].forEach(field => {
        if (machine[field] !== "") existing[field] = machine[field];
      });
    }
    else state.draft.push(machine);
  });
  const order = new Map(MACHINE_NAMES.map((name, index) => [name.toLocaleLowerCase("es"), index]));
  state.draft.sort((a, b) => (order.get(a.name.toLocaleLowerCase("es")) ?? 99) - (order.get(b.name.toLocaleLowerCase("es")) ?? 99));
}

async function loadOcr() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar el lector de texto. Verifica tu conexión a internet e inténtalo de nuevo."));
    document.head.append(script);
  });
  return window.Tesseract;
}

async function scanPhoto(file) {
  if (!file.type.startsWith("image/")) {
    showStatus("Elige un archivo de imagen válido.", true);
    return;
  }
  state.busy = true;
  updateSaveButton();
  showStatus("Preparando el lector de texto. La primera vez puede tardar un momento.");
  const imageUrl = URL.createObjectURL(file);
  const photoTime = await readPhotoTimestamp(file);
  const photo = { url: imageUrl, ...photoTime };
  if (!state.recordedAt) {
    state.recordedAt = photo.timestamp;
    elements.dateTime.textContent = `${displayDateTime(photo.timestamp)} · ${photo.source}`;
  }
  let boardImage;
  try {
    const image = await createImageBitmap(file);
    const cropX = Math.round(image.width * 0.14);
    const cropY = Math.round(image.height * 0.22);
    const cropWidth = Math.round(image.width * 0.84);
    const cropHeight = Math.round(image.height * 0.66);
    boardImage = document.createElement("canvas");
    boardImage.width = cropWidth;
    boardImage.height = cropHeight;
    boardImage.getContext("2d").drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    image.close();
  } catch (error) {
    console.error("No se pudo recortar la foto; se intentará leer la imagen completa:", error);
    boardImage = file;
  }
  const item = document.createElement("div");
  item.className = "photo-item";
  const thumbnail = document.createElement("img");
  thumbnail.className = "photo-thumb";
  thumbnail.src = imageUrl;
  thumbnail.alt = "Foto agregada para esta lectura";
  const details = document.createElement("span");
  details.className = "photo-time";
  const time = document.createElement("strong");
  time.textContent = displayDateTime(photo.timestamp);
  const source = document.createElement("small");
  source.textContent = photo.source;
  details.append(time, source);
  item.append(thumbnail, details);
  elements.photoStrip.append(item);
  state.photos.push(photo);
  elements.photoLabel.textContent = "Agregar otra foto";
  try {
    const Tesseract = await loadOcr();
    const worker = await Tesseract.createWorker("spa", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: progress => {
        if (progress.status === "recognizing text") showStatus(`Leyendo el tablero… ${Math.round(progress.progress * 100)}%`);
      }
    });
    try {
      let result = await worker.recognize(boardImage);
      let recognized = parseOcr(result.data.text);
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      result = await worker.recognize(boardImage);
      recognized = mergeOcrReadings(recognized, parseOcr(result.data.text));
      if (!recognized.length && boardImage !== file) {
        result = await worker.recognize(file);
        recognized = parseOcr(result.data.text);
      }
      if (recognized.length) {
        mergeDraft(recognized);
        renderRows();
        showStatus(`Se reconocieron ${recognized.length} ${recognized.length === 1 ? "máquina" : "máquinas"}. Revisa los valores y agrega la otra página si hace falta.`, false, true);
      } else {
        showStatus("No se reconocieron los contadores. Prueba con una foto más de frente y con mejor luz; también puedes ingresar los datos manualmente.", true);
      }
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    showStatus(error.message || "No se pudo leer la foto. Inténtalo otra vez o ingresa los valores manualmente.", true);
    console.error("Error al procesar la foto:", error);
  } finally {
    state.busy = false;
    updateSaveButton();
    elements.photo.value = "";
  }
}

function formatDuration(totalSeconds) {
  const fields = secondsToFields(totalSeconds);
  return `${fields.days}d ${fields.hours}h ${fields.minutes}m`;
}

function getUsage(date, machineName, currentSeconds) {
  const previous = state.readings
    .filter(reading => reading.date < date && reading.machines.some(machine => machine.name.toLocaleLowerCase("es") === machineName.toLocaleLowerCase("es")))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!previous) return { text: "Primera lectura", reset: false, deltaSeconds: null, daysBetween: null, averageSecondsPerDay: null, utilizationPercent: null };
  const previousMachine = previous.machines.find(machine => machine.name.toLocaleLowerCase("es") === machineName.toLocaleLowerCase("es"));
  const delta = currentSeconds - previousMachine.seconds;
  if (delta < 0) return {
    text: `${formatDuration(currentSeconds)} · reinicio`,
    reset: true,
    deltaSeconds: currentSeconds,
    daysBetween: null,
    averageSecondsPerDay: null,
    utilizationPercent: null
  };
  const daysBetween = Math.round((new Date(`${date}T12:00:00`) - new Date(`${previous.date}T12:00:00`)) / 86400000);
  const averageSecondsPerDay = delta / daysBetween;
  const utilizationPercent = averageSecondsPerDay / 86400 * 100;
  const utilization = `${utilizationPercent.toLocaleString("es-CO", { maximumFractionDigits: 1 })}% de 24h`;
  const text = daysBetween > 1
    ? `Prom. ${formatDuration(averageSecondsPerDay)}/día · ${utilization}`
    : `${formatDuration(delta)} · ${utilization}`;
  return { text, reset: false, deltaSeconds: delta, daysBetween, averageSecondsPerDay, utilizationPercent };
}

function renderHistory() {
  const sorted = [...state.readings].sort((a, b) => b.date.localeCompare(a.date));
  elements.historyCount.textContent = String(sorted.length);
  elements.clearHistory.disabled = !sorted.length;
  elements.export.disabled = !sorted.length;
  elements.historySummary.textContent = sorted.length ? `${sorted.length} lectura${sorted.length === 1 ? "" : "s"} guardada${sorted.length === 1 ? "" : "s"}` : "Tus lecturas aparecerán aquí.";
  elements.historyList.replaceChildren();
  elements.emptyHistory.hidden = sorted.length > 0;
  sorted.forEach(reading => {
    const dateHeading = document.createElement("div");
    dateHeading.className = "history-date";
    dateHeading.textContent = reading.recordedAt
      ? displayDateTime(reading.recordedAt)
      : `${formatDate(reading.date)} · Hora no registrada`;
    elements.historyList.append(dateHeading);
    reading.machines.forEach(machine => {
      const row = document.createElement("div");
      row.className = "history-reading";
      const name = document.createElement("strong");
      name.textContent = machine.name;
      const total = document.createElement("span");
      total.textContent = `Acum. ${formatDuration(machine.seconds)}`;
      const usage = document.createElement("span");
      const result = getUsage(reading.date, machine.name, machine.seconds);
      usage.className = `usage${result.reset ? " reset" : ""}`;
      usage.textContent = result.text;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-reading";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Eliminar lectura de ${machine.name} del ${formatDate(reading.date)}`);
      remove.addEventListener("click", () => deleteMachine(reading.date, machine.name));
      row.append(name, total, usage, remove);
      elements.historyList.append(row);
    });
  });
}

function clearHistory() {
  if (!state.readings.length) return;
  const confirmed = window.confirm("¿Borrar todas las lecturas guardadas en este dispositivo? Esta acción no se puede deshacer.");
  if (!confirmed) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    elements.historyError.textContent = "No se pudo borrar el historial guardado. Inténtalo de nuevo.";
    elements.historyError.hidden = false;
    console.error("No se pudo borrar el historial:", error);
    return;
  }
  state.readings = [];
  renderHistory();
  elements.historySummary.textContent = "Historial borrado.";
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(new Date(year, month - 1, day));
}

function deleteMachine(date, name) {
  const reading = state.readings.find(item => item.date === date);
  if (!reading) return;
  reading.machines = reading.machines.filter(machine => machine.name !== name);
  if (!reading.machines.length) state.readings = state.readings.filter(item => item.date !== date);
  if (saveReadings()) renderHistory();
}

function saveDraft() {
  if (elements.save.disabled) return;
  const date = state.recordedAt?.slice(0, 10);
  if (!date) {
    showStatus("Agrega una foto para asignar automáticamente la fecha y hora de la lectura.", true);
    return;
  }
  const machines = state.draft.map(machine => ({
    name: machine.name.trim(),
    seconds: fieldsToSeconds(machine)
  }));
  const existingIndex = state.readings.findIndex(reading => reading.date === date);
  const existing = existingIndex >= 0 ? state.readings[existingIndex] : { date, machines: [] };
  const machineMap = new Map(existing.machines.map(machine => [machine.name.toLocaleLowerCase("es"), machine]));
  machines.forEach(machine => machineMap.set(machine.name.toLocaleLowerCase("es"), machine));
  const reading = {
    date,
    recordedAt: existing.recordedAt || state.recordedAt,
    machines: [...machineMap.values()].sort((a, b) => a.name.localeCompare(b.name, "es"))
  };
  if (existingIndex >= 0) state.readings[existingIndex] = reading;
  else state.readings.push(reading);
  if (!saveReadings()) return;
  state.draft = [];
  state.photos.forEach(photo => URL.revokeObjectURL(photo.url));
  state.photos = [];
  state.recordedAt = null;
  elements.dateTime.textContent = "Se asignará automáticamente al agregar una foto";
  elements.photoStrip.replaceChildren();
  elements.photoLabel.textContent = "Tomar foto";
  renderRows();
  renderHistory();
  showStatus("Lectura guardada correctamente.", false, true);
  document.querySelector('[data-view="historial"]').click();
}

function excelRows() {
  const result = [["Fecha", "Fecha y hora de lectura", "Máquina", "Contador acumulado (segundos)", "Contador acumulado", "Uso desde lectura anterior", "Intervalo (días)", "Promedio de uso por día (segundos)", "Utilización de 24 h (%)", "Fecha lectura anterior", "Observación"]];
  const sorted = [...state.readings].sort((a, b) => a.date.localeCompare(b.date));
  sorted.forEach(reading => reading.machines.forEach(machine => {
    const usage = getUsage(reading.date, machine.name, machine.seconds);
    const previous = state.readings
      .filter(item => item.date < reading.date && item.machines.some(entry => entry.name.toLocaleLowerCase("es") === machine.name.toLocaleLowerCase("es")))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    result.push([
      reading.date,
      reading.recordedAt ? displayDateTime(reading.recordedAt) : "Hora no registrada",
      machine.name,
      machine.seconds,
      formatDuration(machine.seconds),
      usage.text,
      usage.daysBetween,
      usage.averageSecondsPerDay,
      usage.utilizationPercent,
      previous ? previous.date : "",
      usage.reset ? "El contador disminuyó; se toma la lectura actual como tiempo desde el reinicio." : ""
    ]);
  }));
  return result;
}

async function exportExcel() {
  if (!state.readings.length) return;
  elements.export.disabled = true;
  elements.historyError.hidden = true;
  try {
    if (!window.XLSX) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error("No se pudo cargar el exportador de Excel. Revisa tu conexión a internet."));
        document.head.append(script);
      });
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(excelRows());
    worksheet["!cols"] = [{ wch: 14 }, { wch: 25 }, { wch: 22 }, { wch: 28 }, { wch: 24 }, { wch: 37 }, { wch: 16 }, { wch: 35 }, { wch: 24 }, { wch: 20 }, { wch: 65 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Uso por máquina");
    XLSX.writeFile(workbook, `ritmo-uso-maquinas-${localDateValue()}.xlsx`);
  } catch (error) {
    elements.historyError.textContent = error.message || "No se pudo exportar a Excel. Inténtalo de nuevo.";
    elements.historyError.hidden = false;
    console.error("No se pudo exportar a Excel:", error);
  } finally {
    elements.export.disabled = !state.readings.length;
  }
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
  document.querySelectorAll(".view").forEach(view => { view.hidden = view.id !== `${tab.dataset.view}-view`; });
}));

elements.photo.addEventListener("change", event => {
  const [file] = event.target.files || [];
  if (file) scanPhoto(file);
});
elements.save.addEventListener("click", saveDraft);
elements.export.addEventListener("click", exportExcel);
elements.clearHistory.addEventListener("click", clearHistory);
document.querySelector("#add-machine-button").addEventListener("click", () => {
  state.draft.push(makeMachine());
  renderRows();
  elements.rows.lastElementChild?.querySelector(".machine-name").focus();
});

renderRows();
renderHistory();
