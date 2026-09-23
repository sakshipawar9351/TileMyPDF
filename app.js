const { PDFDocument, rgb } = PDFLib;

const state = {
  file: null,
  sourceBytes: null,
  pageCount: 0,
  pagesPerSheet: 2,
  outputUrl: null,
  outputBlob: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  dropZone: $("dropZone"),
  chooseBtn: $("chooseBtn"),
  fileInput: $("fileInput"),
  fileBar: $("fileBar"),
  fileName: $("fileName"),
  fileMeta: $("fileMeta"),
  removeBtn: $("removeBtn"),
  workspace: $("workspace"),
  layoutGrid: $("layoutGrid"),
  pageCountBadge: $("pageCountBadge"),
  paperSize: $("paperSize"),
  orientation: $("orientation"),
  margin: $("margin"),
  order: $("order"),
  showBorders: $("showBorders"),
  centerPages: $("centerPages"),
  generateBtn: $("generateBtn"),
  resetBtn: $("resetBtn"),
  progressWrap: $("progressWrap"),
  progressText: $("progressText"),
  progressPercent: $("progressPercent"),
  progressBar: $("progressBar"),
  preview: $("preview"),
  previewInfo: $("previewInfo"),
  summaryInput: $("summaryInput"),
  summaryPps: $("summaryPps"),
  summaryOutput: $("summaryOutput"),
  summaryPaper: $("summaryPaper"),
  successBox: $("successBox"),
  downloadBtn: $("downloadBtn"),
};

const PAPER = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
  A5: [419.53, 595.28],
};

function getGrid(n) {
  const grids = {
    1: [1, 1],
    2: [2, 1],
    4: [2, 2],
    6: [3, 2],
    9: [3, 3],
    16: [4, 4],
  };
  return grids[n] || [2, 1];
}

function getSheetSize() {
  const base = PAPER[els.paperSize.value];
  const orientation = els.orientation.value;
  if (orientation === "landscape") return [Math.max(base[0], base[1]), Math.min(base[0], base[1])];
  if (orientation === "portrait") return [Math.min(base[0], base[1]), Math.max(base[0], base[1])];

  // Auto: 2 pages horizontally and multi-column layouts use landscape.
  const [cols] = getGrid(state.pagesPerSheet);
  return cols > 1 ? [Math.max(base[0], base[1]), Math.min(base[0], base[1])]
                  : [Math.min(base[0], base[1]), Math.max(base[0], base[1])];
}

function setProgress(value, text) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  els.progressBar.style.width = pct + "%";
  els.progressPercent.textContent = pct + "%";
  els.progressText.textContent = text;
}

function setSelectedLayout(n) {
  state.pagesPerSheet = n;
  document.querySelectorAll(".layout-option").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.count) === n);
  });
  els.summaryPps.textContent = n;
  updateSummary();
  if (state.sourceBytes) renderPreview();
}

function updateSummary() {
  els.summaryInput.textContent = state.pageCount || "—";
  els.summaryPps.textContent = state.pagesPerSheet;
  els.summaryOutput.textContent = state.pageCount
    ? Math.ceil(state.pageCount / state.pagesPerSheet)
    : "—";
  els.summaryPaper.textContent = els.paperSize.value;
  els.pageCountBadge.textContent = state.pageCount ? `${state.pageCount} pages` : "0 pages";
}

function resetOutput() {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
  state.outputBlob = null;
  els.downloadBtn.classList.add("disabled");
  els.downloadBtn.removeAttribute("href");
  els.successBox.hidden = true;
}

async function loadFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please choose a PDF file.");
    return;
  }

  resetOutput();
  state.file = file;
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = "Reading PDF…";
  els.fileBar.style.display = "flex";

  try {
    state.sourceBytes = new Uint8Array(await file.arrayBuffer());
    const src = await PDFDocument.load(state.sourceBytes, { ignoreEncryption: false });
    state.pageCount = src.getPageCount();

    if (!state.pageCount) throw new Error("The PDF contains no pages.");

    els.fileMeta.textContent = `${state.pageCount} page${state.pageCount === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
    els.workspace.style.display = "block";
    updateSummary();
    await renderPreview();
  } catch (err) {
    console.error(err);
    alert("Could not read this PDF. It may be encrypted, damaged, or unsupported.");
    clearFile();
  }
}

function clearFile() {
  resetOutput();
  state.file = null;
  state.sourceBytes = null;
  state.pageCount = 0;
  els.fileInput.value = "";
  els.fileBar.style.display = "none";
  els.workspace.style.display = "none";
  els.preview.innerHTML = `<div class="empty-preview"><span>▧</span><p>Your first generated sheet will appear here.</p></div>`;
  updateSummary();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fitPageIntoCell(pageWidth, pageHeight, cellWidth, cellHeight) {
  const scale = Math.min(cellWidth / pageWidth, cellHeight / pageHeight);
  return { width: pageWidth * scale, height: pageHeight * scale };
}

async function createOutputPdf(onProgress = () => {}) {
  const src = await PDFDocument.load(state.sourceBytes);
  const out = await PDFDocument.create();
  const [sheetW, sheetH] = getSheetSize();
  const margin = Number(els.margin.value);
  const [cols, rows] = getGrid(state.pagesPerSheet);
  const gap = margin;
  const usableW = sheetW - margin * 2 - gap * (cols - 1);
  const usableH = sheetH - margin * 2 - gap * (rows - 1);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  const indices = Array.from({ length: state.pageCount }, (_, i) => i);
  if (els.order.value === "reverse") indices.reverse();

  for (let start = 0; start < indices.length; start += state.pagesPerSheet) {
    const sheet = out.addPage([sheetW, sheetH]);
    const batch = indices.slice(start, start + state.pagesPerSheet);

    for (let slot = 0; slot < state.pagesPerSheet; slot++) {
      if (slot >= batch.length) break;

      const sourceIndex = batch[slot];
      const sourcePage = src.getPage(sourceIndex);
      const pageW = sourcePage.getWidth();
      const pageH = sourcePage.getHeight();

      const col = slot % cols;
      const row = Math.floor(slot / cols);

      const fitted = fitPageIntoCell(pageW, pageH, cellW, cellH);
      const x = margin + col * (cellW + gap) + (els.centerPages.checked ? (cellW - fitted.width) / 2 : 0);
      const yTop = margin + row * (cellH + gap);
      const y = sheetH - yTop - (els.centerPages.checked ? (cellH + fitted.height) / 2 : fitted.height);

      const [embedded] = await out.embedPdf(state.sourceBytes, [sourceIndex]);
      sheet.drawPage(embedded, {
        x,
        y,
        width: fitted.width,
        height: fitted.height,
      });

      if (els.showBorders.checked) {
        sheet.drawRectangle({
          x: margin + col * (cellW + gap),
          y: sheetH - margin - (row + 1) * cellH - row * gap,
          width: cellW,
          height: cellH,
          borderWidth: 0.7,
          borderColor: rgb(0.75, 0.77, 0.82),
          color: undefined,
          opacity: 1,
        });
      }
    }

    onProgress(Math.min(98, ((start + batch.length) / indices.length) * 100), `Creating sheet ${Math.ceil((start + batch.length) / state.pagesPerSheet)} of ${Math.ceil(indices.length / state.pagesPerSheet)}…`);
    await new Promise(requestAnimationFrame);
  }

  return await out.save({ useObjectStreams: true });
}

async function renderPreview() {
  if (!state.sourceBytes) return;

  els.previewInfo.textContent = "Rendering preview…";
  try {
    const bytes = await createOutputPdf(() => {});
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    // PDF.js module is optional for the preview. If unavailable, show a native PDF iframe.
    let pdfjs = window.pdfjsLib;
    if (!pdfjs && window.__pdfjsPromise) pdfjs = await window.__pdfjsPromise;

    if (!pdfjs) {
      // The browser can still display the first output page.
      els.preview.innerHTML = `<iframe title="PDF preview" style="width:100%;min-height:500px;border:0;border-radius:10px;background:white" src="${url}#page=1&zoom=page-fit"></iframe>`;
      els.previewInfo.textContent = "First sheet";
      return;
    }

    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const maxW = Math.max(320, els.preview.clientWidth - 45);
    const scale = Math.min(1.7, maxW / viewport.width);
    const scaled = page.getViewport({ scale });

    els.preview.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.id = "previewCanvas";
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    els.preview.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaled }).promise;
    els.previewInfo.textContent = "First sheet";
    URL.revokeObjectURL(url);
  } catch (err) {
    console.warn("Preview failed:", err);
    els.preview.innerHTML = `<div class="empty-preview"><span>▧</span><p>Preview unavailable, but PDF generation still works.</p></div>`;
    els.previewInfo.textContent = "Preview unavailable";
  }
}

async function generate() {
  if (!state.sourceBytes) return;
  resetOutput();
  els.generateBtn.disabled = true;
  els.progressWrap.hidden = false;
  setProgress(1, "Preparing PDF…");

  try {
    const bytes = await createOutputPdf((pct, text) => setProgress(pct, text));
    const blob = new Blob([bytes], { type: "application/pdf" });
    state.outputBlob = blob;
    state.outputUrl = URL.createObjectURL(blob);

    const base = state.file.name.replace(/\.pdf$/i, "");
    const filename = `${base}_${state.pagesPerSheet}-pages-per-sheet.pdf`;
    els.downloadBtn.href = state.outputUrl;
    els.downloadBtn.download = filename;
    els.downloadBtn.classList.remove("disabled");
    els.successBox.hidden = false;
    setProgress(100, "PDF created successfully.");
    await renderPreview();
  } catch (err) {
    console.error(err);
    alert(`Could not create the PDF: ${err.message || err}`);
    setProgress(0, "Generation failed.");
  } finally {
    els.generateBtn.disabled = false;
  }
}

function resetSettings() {
  els.paperSize.value = "A4";
  els.orientation.value = "auto";
  els.margin.value = "12";
  els.order.value = "normal";
  els.showBorders.checked = false;
  els.centerPages.checked = true;
  setSelectedLayout(2);
  resetOutput();
  if (state.sourceBytes) renderPreview();
}

els.chooseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.fileInput.click();
});
els.dropZone.addEventListener("click", () => els.fileInput.click());
els.dropZone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
});
els.fileInput.addEventListener("change", e => loadFile(e.target.files[0]));
els.removeBtn.addEventListener("click", clearFile);
els.generateBtn.addEventListener("click", generate);
els.resetBtn.addEventListener("click", resetSettings);

document.querySelectorAll(".layout-option").forEach(btn => {
  btn.addEventListener("click", () => setSelectedLayout(Number(btn.dataset.count)));
});
[els.paperSize, els.orientation, els.margin, els.order, els.showBorders, els.centerPages].forEach(el => {
  el.addEventListener("change", () => {
    updateSummary();
    resetOutput();
    if (state.sourceBytes) renderPreview();
  });
});

["dragenter", "dragover"].forEach(type => els.dropZone.addEventListener(type, e => {
  e.preventDefault(); els.dropZone.classList.add("dragover");
}));
["dragleave", "drop"].forEach(type => els.dropZone.addEventListener(type, e => {
  e.preventDefault(); els.dropZone.classList.remove("dragover");
}));
els.dropZone.addEventListener("drop", e => loadFile(e.dataTransfer.files[0]));

window.addEventListener("beforeunload", () => {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
});

// Load PDF.js as an ES module for the preview without making generation depend on it.
(async () => {
  try {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
    window.pdfjsLib = pdfjs;
  } catch (e) {
    console.warn("PDF.js preview module could not be loaded. Native preview fallback will be used.");
  }
})();
