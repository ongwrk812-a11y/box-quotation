(function () {
  // ════════════════════════════════════════════════════════════════
  // 展开图 PDF 导出（图纸下载）
  //
  // 思路：不去"截图"页面上正在显示的预览，而是按当前输入的 L/W/H
  // 重新生成一份展开图 SVG（直接调用 app.js 里现成的 createXxxSVG），
  // 把蓝色标注（尺寸线 / 引导线 / 文字 / 箭头）整套剥掉，只留下切割线
  // 和折叠线，再用 jsPDF + svg2pdf.js 转成矢量 PDF。
  //
  // 为什么不直接拿预览区的 SVG：
  //   1) 用户可能正在看 3D 模式，2D 预览区不一定是最新的
  //   2) Gift / 5 Panel 的预览是异步加载的，可能还停在 Loading 占位上
  //   3) 重新生成的话，不会碰到预览区的缩放/平移状态
  //
  // 尺寸：各箱型展开图的坐标单位本来就是 pt（1pt = 1/72 英寸，
  // 跟 JLC 原始 SVG 一致），所以 PDF 页面大小直接取 viewBox 的宽高，
  // 打印出来就是 1:1 的真实尺寸。
  //
  // 两种导出：
  //   - 纯刀模图：只有展开图
  //   - 刀模图 + 报价：在展开图下面（左下角）多加一块报价单，内容直接
  //     读取页面左侧"报价结果"区域里已经算好的数字，保证 PDF 和屏幕
  //     上看到的完全一致；页面会自动加长，避免报价单压到展开图
  //
  // 依赖：页面上要先加载 jsPDF 和 svg2pdf.js（见 index.html），
  // 另外直接使用 app.js 里的全局函数 / 变量：selectedBox、
  // getBoxDefaultDimensions、createPizzaTemplateBSVG、
  // createRSCTemplateSVG、createGiftTemplateSVG、
  // createFivePanelTemplateSVG。
  // ════════════════════════════════════════════════════════════════

  // 文件名里的箱型前缀：5 Panel Box → 5_panel
  const FILE_PREFIX = {
    "RSC Box": "rsc",
    "5 Panel Box": "5_panel",
    "Pizza Box": "pizza",
    "Gift Box": "gift"
  };

  // 要从 PDF 里剥掉的蓝色标注元素（类名跟 app.js 里的预览标注一致）
  const DIM_SELECTOR = ".pizza-dim-line, .pizza-dim-guide, .pizza-dim-text, text, marker, defs";

  // 真正要画进 PDF 的图形元素
  const SHAPE_SELECTOR = "line, path, polyline, polygon, rect, circle, ellipse";

  function readInputDimensions() {
    // 跟 render2DPreview 里取 L/W/H 的逻辑保持一致：
    // 输入框为空就用该箱型的默认值
    const defaults = getBoxDefaultDimensions(selectedBox);
    return {
      L: parseFloat(document.getElementById("length").value) || defaults.L || 0,
      W: parseFloat(document.getElementById("width").value) || defaults.W || 0,
      H: parseFloat(document.getElementById("height").value) || defaults.H || 0
    };
  }

  // 按箱型调用对应的 SVG 生成函数，返回 { html, dims }
  async function buildDieline(boxType, L, W, H) {
    if (boxType === "Pizza Box") return createPizzaTemplateBSVG(L, W, H);
    if (boxType === "RSC Box") return createRSCTemplateSVG(L, W, H);
    if (boxType === "Gift Box") return await createGiftTemplateSVG(L, W, H);
    if (boxType === "5 Panel Box") return await createFivePanelTemplateSVG(L, W, H);
    throw new Error("Unsupported box type: " + boxType);
  }

  // 尺寸数字进文件名：整数就写整数，有小数最多保留 1 位（100.5 → 100.5）
  function fmtFileNum(v) {
    return String(Number(Number(v).toFixed(1)));
  }

  function buildFileName(boxType, dims) {
    const prefix = FILE_PREFIX[boxType] || "box";
    // Pizza Box 的第三个尺寸叫 D（深度），其它箱型叫 H，位置都是第三个
    const third = dims.H != null ? dims.H : dims.D;
    return [
      prefix,
      fmtFileNum(dims.L) + "mm",
      fmtFileNum(dims.W) + "mm",
      fmtFileNum(third) + "mm"
    ].join("_");
  }

  // 把 SVG 里靠 CSS 类（pizza-cut / pizza-fold / gift-inner / five-inner 等）
  // 决定的样式，全部"固化"成元素自身的属性。svg2pdf 不会去解析页面
  // 的样式表，不固化的话线条会丢颜色/粗细。
  function inlineComputedStyles(svg) {
    svg.querySelectorAll(SHAPE_SELECTOR).forEach((el) => {
      const cs = window.getComputedStyle(el);

      // 预览里的半透明白色填充在白纸上本来就看不出来，
      // 导出时直接不填充，避免 PDF 里出现透明度
      const fill = cs.fill || "none";
      el.setAttribute("fill", /rgba\(/i.test(fill) ? "none" : fill);

      el.setAttribute("stroke", cs.stroke || "none");
      el.setAttribute("stroke-width", cs.strokeWidth || "1");
      el.setAttribute("stroke-linecap", cs.strokeLinecap || "butt");
      el.setAttribute("stroke-linejoin", cs.strokeLinejoin || "miter");

      if (cs.strokeDasharray && cs.strokeDasharray !== "none") {
        el.setAttribute("stroke-dasharray", cs.strokeDasharray);
      }

      el.removeAttribute("class");
      el.removeAttribute("style");
    });
  }

  // ── 报价单：读取 + 绘制 ───────────────────────────────────

  // 从页面左侧"报价结果"区域读出每个分区的标题、数据行和备注。
  // 报价还没算出来（没填数量 / 没选层数材质 / 数量不足 30 被报错）时返回 null
  function readQuoteSections() {
    const ready =
      parseFloat(document.getElementById("length").value) > 0 &&
      parseFloat(document.getElementById("width").value) > 0 &&
      parseFloat(document.getElementById("height").value) > 0 &&
      parseFloat(document.getElementById("qty").value) > 0 &&
      selectedMaterialFactor;

    if (!ready) return null;

    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const sections = [];

    document.querySelectorAll("#result .result-section").forEach((sec) => {
      const titleEl = sec.querySelector(".result-section-title");
      const items = [];

      sec.querySelectorAll(".result-row, .result-note").forEach((el) => {
        if (el.classList.contains("result-row")) {
          const b = el.querySelector("b");
          const value = b ? norm(b.textContent) : "";
          const label = norm(b ? el.textContent.replace(b.textContent, "") : el.textContent).replace(/\s*:\s*$/, "");
          items.push({ type: "row", label: label, value: value });
        } else {
          items.push({ type: "note", text: norm(el.textContent) });
        }
      });

      sections.push({ title: norm(titleEl ? titleEl.textContent : ""), items: items });
    });

    return sections.length ? sections : null;
  }

  // 报价单版式（单位 pt，页面按 1:1 真实尺寸，所以字号也是真实打印字号）
  const QUOTE = {
    width: 400,
    pad: 20,
    valueX: 175,
    titleSize: 15,
    rowSize: 13,
    noteSize: 11,
    rowGap: 21,
    noteGap: 15,
    sectionGap: 16,
    titleGap: 24
  };

  // 先"排版"（只算每一行的位置和总高度，不画），这样才能知道页面要加长多少
  function layoutQuote(measureDoc, sections) {
    const q = QUOTE;
    const lines = [];
    let y = q.pad + q.titleSize * 0.8;

    sections.forEach((sec, idx) => {
      if (idx > 0) y += q.sectionGap;
      lines.push({ kind: "title", text: sec.title.toUpperCase(), y: y });
      y += q.titleGap;

      sec.items.forEach((item) => {
        if (item.type === "row") {
          lines.push({ kind: "row", label: item.label + " :", value: item.value, y: y });
          y += q.rowGap;
        } else {
          measureDoc.setFont("helvetica", "normal");
          measureDoc.setFontSize(q.noteSize);
          const wrapped = measureDoc.splitTextToSize(item.text, q.width - q.pad * 2);
          wrapped.forEach((t) => {
            lines.push({ kind: "note", text: t, y: y });
            y += q.noteGap;
          });
        }
      });
    });

    return { lines: lines, height: y + q.pad - q.noteGap + 6 };
  }

  function drawQuote(doc, layout, x, y) {
    const q = QUOTE;

    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, q.width, layout.height, 6, 6, "S");

    layout.lines.forEach((ln) => {
      const ty = y + ln.y;
      if (ln.kind === "title") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(q.titleSize);
        doc.setTextColor(20, 30, 45);
        doc.text(ln.text, x + q.pad, ty);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.6);
        doc.line(x + q.pad, ty + 6, x + q.width - q.pad, ty + 6);
      } else if (ln.kind === "row") {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(q.rowSize);
        doc.setTextColor(60, 60, 60);
        doc.text(ln.label, x + q.pad, ty);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(10, 10, 10);
        doc.text(ln.value, x + q.valueX, ty);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(q.noteSize);
        doc.setTextColor(110, 110, 110);
        doc.text(ln.text, x + q.pad, ty);
      }
    });
  }

  async function exportDielinePdf(withQuote) {
    if (!selectedBox) {
      throw new Error("No box type selected.");
    }

    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      throw new Error("PDF library not loaded. Please check your internet connection and refresh.");
    }

    let quoteSections = null;
    if (withQuote) {
      quoteSections = readQuoteSections();
      if (!quoteSections) {
        throw new Error("Enter quantity and select layer & material first, so the quotation can be included.");
      }
    }

    const { L, W, H } = readInputDimensions();
    const result = await buildDieline(selectedBox, L, W, H);

    // 先把 SVG 临时挂到页面外（看不见的地方），这样 getComputedStyle
    // 才能拿到真实生效的样式
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;";
    host.innerHTML = result.html;
    document.body.appendChild(host);

    try {
      const svg = host.querySelector("svg");
      if (!svg) {
        throw new Error("Die line SVG was not generated.");
      }

      // 1) 先剥掉蓝色标注和箭头定义（要靠类名识别，所以必须在
      //    固化样式之前做——固化时会把类名清掉）
      svg.querySelectorAll(DIM_SELECTOR).forEach((el) => el.remove());

      // 2) 固化样式（必须在删 <style> 之前做），然后删掉内嵌样式表
      inlineComputedStyles(svg);
      svg.querySelectorAll("style").forEach((el) => el.remove());

      // 3) 页面尺寸 = viewBox 宽高（单位 pt，即 1:1 真实尺寸）
      const vb = svg.viewBox.baseVal;
      const pageW = vb.width;
      const pageH = vb.height;
      svg.removeAttribute("class");
      svg.setAttribute("width", String(pageW));
      svg.setAttribute("height", String(pageH));

      // 有报价时：页面在展开图下面加长一截放报价单（左下角），
      // 展开图本身的位置和大小完全不动，所以不会互相重叠。
      // 页面宽度不够放报价单时（极小的箱子）也一并加宽。
      let totalW = pageW;
      let totalH = pageH;
      let quoteLayout = null;
      const QUOTE_LEFT = 28;
      const QUOTE_GAP = 4;
      const QUOTE_BOTTOM = 28;

      if (quoteSections) {
        const measureDoc = new jsPDFCtor({ unit: "pt", format: [200, 200] });
        quoteLayout = layoutQuote(measureDoc, quoteSections);
        totalH = pageH + QUOTE_GAP + quoteLayout.height + QUOTE_BOTTOM;
        totalW = Math.max(pageW, QUOTE.width + QUOTE_LEFT * 2);
      }

      const doc = new jsPDFCtor({
        orientation: totalW >= totalH ? "landscape" : "portrait",
        unit: "pt",
        format: [totalW, totalH],
        compress: true
      });

      const baseName = buildFileName(selectedBox, result.dims);
      const fileName = withQuote ? baseName + "_quotation" : baseName;
      doc.setProperties({ title: fileName });

      await doc.svg(svg, { x: 0, y: 0, width: pageW, height: pageH });

      if (quoteLayout) {
        drawQuote(doc, quoteLayout, QUOTE_LEFT, pageH + QUOTE_GAP);
      }

      doc.save(fileName + ".pdf");

      return fileName + ".pdf";
    } finally {
      host.remove();
    }
  }

  // ── 按钮绑定 ──────────────────────────────────────────────
  const btnPlain = document.getElementById("downloadPdfBtn");
  const btnQuote = document.getElementById("downloadQuotePdfBtn");
  const status = document.getElementById("downloadPdfStatus");
  let statusTimer = 0;

  function showStatus(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", !!isError);
    window.clearTimeout(statusTimer);
    if (text) {
      statusTimer = window.setTimeout(() => { status.textContent = ""; }, 6000);
    }
  }

  // 导出期间两个按钮一起锁住，避免连点
  function setBusy(busy, activeBtn) {
    [btnPlain, btnQuote].forEach((b) => {
      if (!b) return;
      b.disabled = busy;
      b.classList.toggle("is-busy", busy && b === activeBtn);
    });
  }

  function bindExportButton(button, withQuote) {
    if (!button) return;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      setBusy(true, button);
      showStatus("Generating PDF...", false);

      try {
        const name = await exportDielinePdf(withQuote);
        showStatus("Saved: " + name, false);
      } catch (err) {
        console.error(err);
        showStatus(err && err.message ? err.message : "Failed to generate PDF.", true);
      } finally {
        setBusy(false, button);
      }
    });
  }

  bindExportButton(btnPlain, false);
  bindExportButton(btnQuote, true);

  window.exportDielinePdf = exportDielinePdf;
})();
