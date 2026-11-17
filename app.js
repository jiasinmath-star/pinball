(() => {
  "use strict";

  const STORAGE_KEY = "marble-statistics-lab-v6-interactive-drops";
  const LEGACY_STORAGE_KEYS = [
    "marble-statistics-lab-v5-seven-level-board",
    "marble-statistics-lab-v4-direct-input",
    "marble-statistics-lab-v3-confirm",
  ];
  const MAX_VISIBLE_PER_BIN = 6000;
  const GROUPS = [
    { id: 1, name: "第1組", color: "#12b9d4" },
    { id: 2, name: "第2組", color: "#7a61ff" },
    { id: 3, name: "第3組", color: "#ff786f" },
    { id: 4, name: "第4組", color: "#c98b00" },
    { id: 5, name: "第5組", color: "#25c99d" },
    { id: 6, name: "第6組", color: "#f05f9f" },
    { id: 7, name: "第7組", color: "#3e8fe8" },
    { id: 8, name: "第8組", color: "#9a6de3" },
  ];
  const TARGETS = [
    { score: 50, label: "左側第4格", short: "左 50", accent: "#ff786f" },
    { score: 30, label: "左側第3格", short: "左 30", accent: "#7a61ff" },
    { score: 20, label: "左側第2格", short: "左 20", accent: "#12b9d4" },
    { score: 10, label: "左側第1格", short: "左 10", accent: "#e9aa19" },
    { score: 10, label: "右側第1格", short: "右 10", accent: "#e9aa19" },
    { score: 20, label: "右側第2格", short: "右 20", accent: "#12b9d4" },
    { score: 30, label: "右側第3格", short: "右 30", accent: "#7a61ff" },
    { score: 50, label: "右側第4格", short: "右 50", accent: "#ff786f" },
  ];

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    groupTabs: $("#groupTabs"),
    totalMetric: $("#totalMetric"),
    totalGoalMetric: $("#totalGoalMetric"),
    peakMetric: $("#peakMetric"),
    peakDetail: $("#peakDetail"),
    shapeMetric: $("#shapeMetric"),
    shapeDetail: $("#shapeDetail"),
    boardTitle: $("#boardTitle"),
    chartLegend: $("#chartLegend"),
    chartNote: $("#chartNote"),
    targetAxis: $("#targetAxis"),
    canvas: $("#marbleCanvas"),
    chartShell: $("#chartShell"),
    emptyChart: $("#emptyChart"),
    quickGroup: $("#quickGroup"),
    quickProgressText: $("#quickProgressText"),
    confirmGroupButton: $("#confirmGroupButton"),
    targetInputs: $("#targetInputs"),
    quickHint: $("#quickHint"),
    groupRows: $("#groupRows"),
    rosterSummary: $("#rosterSummary"),
    undoButton: $("#undoButton"),
    demoButton: $("#demoButton"),
    exportButton: $("#exportButton"),
    clearButton: $("#clearButton"),
    clearDialog: $("#clearDialog"),
    confirmClear: $("#confirmClear"),
    randomDropButton: $("#randomDropButton"),
    randomDropLabel: $("#randomDropLabel"),
    soundButton: $("#soundButton"),
    soundLabel: $("#soundLabel"),
    toast: $("#toast"),
    liveRegion: $("#liveRegion"),
  };

  const blankCounts = () => Array.from({ length: 8 }, () => Array(8).fill(0));
  const blankState = () => ({
    counts: blankCounts(),
    draftCounts: blankCounts(),
    selectedView: "all",
    quickGroup: 1,
    sound: false,
  });

  let state = loadState();
  let history = [];
  let toastTimer = 0;
  let audioContext = null;
  let lastSoundAt = 0;
  let randomDropActive = false;
  let randomDropTimer = 0;

  const ctx = elements.canvas.getContext("2d");
  const particles = [];
  const bursts = [];
  let canvasSize = { width: 0, height: 0, dpr: 1 };
  let animationFrame = 0;
  let lastLayout = null;

  function sanitizeCount(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed));
  }

  function loadState() {
    const fallback = blankState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
        || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.counts)) return fallback;
      const counts = Array.from({ length: 8 }, (_, groupIndex) =>
        Array.from({ length: 8 }, (_, targetIndex) =>
          sanitizeCount(saved.counts?.[groupIndex]?.[targetIndex], 0),
        ),
      );
      const draftCounts = Array.from({ length: 8 }, (_, groupIndex) =>
        Array.from({ length: 8 }, (_, targetIndex) =>
          sanitizeCount(saved.draftCounts?.[groupIndex]?.[targetIndex], counts[groupIndex][targetIndex]),
        ),
      );
      return {
        counts,
        draftCounts,
        selectedView:
          saved.selectedView === "all" || GROUPS.some((group) => String(group.id) === String(saved.selectedView))
            ? String(saved.selectedView)
            : "all",
        quickGroup: Math.max(1, Math.min(8, sanitizeCount(saved.quickGroup, 1))),
        sound: Boolean(saved.sound),
      };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast("瀏覽器無法保存資料，但本頁仍可繼續使用。");
    }
  }

  function recordHistory({ syncDrafts = false } = {}) {
    history.push(
      JSON.stringify({
        counts: state.counts,
        draftCounts: syncDrafts ? state.counts : state.draftCounts,
      }),
    );
    if (history.length > 40) history.shift();
  }

  function groupMeta(groupId) {
    return GROUPS.find((group) => group.id === Number(groupId)) || GROUPS[0];
  }

  function countsForGroup(groupId) {
    return state.counts[Number(groupId) - 1];
  }

  function draftForGroup(groupId) {
    return state.draftCounts[Number(groupId) - 1];
  }

  function groupTotal(groupId) {
    return countsForGroup(groupId).reduce((sum, count) => sum + count, 0);
  }

  function draftGroupTotal(groupId) {
    return draftForGroup(groupId).reduce((sum, count) => sum + count, 0);
  }

  function groupHasPending(groupId) {
    return draftForGroup(groupId).some((count, index) => count !== countsForGroup(groupId)[index]);
  }

  function hasAnyDraftData() {
    return GROUPS.some((group) => draftGroupTotal(group.id) > 0);
  }

  function visibleGroupIds() {
    return state.selectedView === "all"
      ? GROUPS.map((group) => group.id)
      : [Number(state.selectedView)];
  }

  function totalsFor(groupIds = visibleGroupIds()) {
    const totals = Array(8).fill(0);
    groupIds.forEach((groupId) => {
      countsForGroup(groupId).forEach((count, targetIndex) => {
        totals[targetIndex] += count;
      });
    });
    return totals;
  }

  function totalAllGroups() {
    return GROUPS.reduce((sum, group) => sum + groupTotal(group.id), 0);
  }

  function visualScaleForTotals(totals) {
    return Math.max(1, Math.ceil(Math.max(1, ...totals) / MAX_VISIBLE_PER_BIN));
  }

  function render() {
    renderGroupTabs();
    renderMetrics();
    renderQuickControls();
    renderGroupTable();
    renderLegend();
    renderActions();
    drawScene();
    saveState();
  }

  function renderGroupTabs() {
    const tabs = [{ id: "all", name: "全班" }, ...GROUPS];
    elements.groupTabs.innerHTML = tabs
      .map((group) => {
        const id = String(group.id);
        const active = state.selectedView === id;
        return `<button class="group-tab${active ? " is-active" : ""}" type="button" data-view="${id}" aria-pressed="${active}">${group.name}</button>`;
      })
      .join("");
    elements.boardTitle.textContent =
      state.selectedView === "all"
        ? "全班彈珠分布"
        : `${groupMeta(state.selectedView).name}彈珠分布`;
  }

  function renderMetrics() {
    const totals = totalsFor();
    const total = totals.reduce((sum, count) => sum + count, 0);
    const max = Math.max(...totals);
    const peakIndex = max > 0 ? totals.indexOf(max) : -1;
    const scale = visualScaleForTotals(totals);

    elements.totalMetric.textContent = total.toLocaleString("zh-TW");
    elements.totalGoalMetric.textContent = "顆";
    elements.chartNote.textContent =
      scale === 1
        ? "點選落點會直接增加 1 顆；隨機連續模式會依 7 次左右碰撞，自然形成中央較高的分布。"
        : `資料量較大，落地彈珠已縮小並改為每顆圓點約代表 ${scale.toLocaleString("zh-TW")} 顆；點選落點與隨機連續落珠仍可使用。`;

    if (peakIndex < 0) {
      elements.peakMetric.textContent = "—";
      elements.peakDetail.textContent = "等待資料";
      elements.shapeMetric.textContent = "準備開始";
      elements.shapeDetail.textContent = "輸入第一筆資料後，這裡會提示分布特徵。";
    } else {
      elements.peakMetric.textContent = TARGETS[peakIndex].short;
      elements.peakDetail.textContent = `${max.toLocaleString("zh-TW")} 顆`;

      const left = totals.slice(0, 4).reduce((sum, count) => sum + count, 0);
      const right = totals.slice(4).reduce((sum, count) => sum + count, 0);
      const mirroredDifference = [0, 1, 2, 3].reduce(
        (sum, index) => sum + Math.abs(totals[index] - totals[7 - index]),
        0,
      );
      const symmetry = Math.max(0, Math.round((1 - mirroredDifference / Math.max(total, 1)) * 100));
      const sideDifference = Math.abs(left - right) / Math.max(total, 1);
      const center = totals.slice(2, 6).reduce((sum, count) => sum + count, 0);
      const outer = totals[0] + totals[1] + totals[6] + totals[7];

      if (sideDifference >= 0.22) {
        const side = left > right ? "左側" : "右側";
        elements.shapeMetric.textContent = `${side}較多`;
        elements.shapeDetail.textContent = `左右相差 ${Math.abs(left - right).toLocaleString("zh-TW")} 顆；目前對稱度約 ${symmetry}%。`;
      } else if (symmetry >= 86) {
        elements.shapeMetric.textContent = "左右大致對稱";
        elements.shapeDetail.textContent = `鏡像位置的數量很接近，目前對稱度約 ${symmetry}%。`;
      } else if (center > outer * 1.25) {
        elements.shapeMetric.textContent = "中央形成高峰";
        elements.shapeDetail.textContent = `中間四格共有 ${center.toLocaleString("zh-TW")} 顆，分布較集中。`;
      } else if (outer > center * 1.25) {
        elements.shapeMetric.textContent = "兩側較集中";
        elements.shapeDetail.textContent = `外側四格共有 ${outer.toLocaleString("zh-TW")} 顆，分布向兩端展開。`;
      } else {
        elements.shapeMetric.textContent = "分布逐漸成形";
        elements.shapeDetail.textContent = `目前左右對稱度約 ${symmetry}%，再增加資料會更容易觀察。`;
      }
    }

    elements.emptyChart.classList.toggle("is-hidden", total > 0);
    elements.canvas.setAttribute(
      "aria-label",
      total === 0
        ? "目前還沒有彈珠資料"
        : `目前共 ${total} 顆彈珠，八個落點依序為 ${totals.join("、")} 顆`,
    );
  }

  function renderQuickControls() {
    const confirmedTotal = groupTotal(state.quickGroup);
    const draftTotal = draftGroupTotal(state.quickGroup);
    const pending = groupHasPending(state.quickGroup);
    elements.quickGroup.value = String(state.quickGroup);
    elements.quickProgressText.textContent = `${draftTotal.toLocaleString("zh-TW")} 顆`;
    elements.quickHint.textContent = pending
      ? `${groupMeta(state.quickGroup).name}尚未確定；已確認 ${confirmedTotal.toLocaleString("zh-TW")} 顆。`
      : `${groupMeta(state.quickGroup).name}目前資料已確定，可直接修改數字後再次確認。`;
    elements.confirmGroupButton.disabled = !pending;
    elements.targetInputs.querySelectorAll(".quick-count-input").forEach((input) => {
      input.value = String(draftForGroup(state.quickGroup)[Number(input.dataset.targetIndex)]);
      input.setAttribute("aria-label", `${groupMeta(state.quickGroup).name} ${TARGETS[Number(input.dataset.targetIndex)].short} 彈珠數`);
    });
  }

  function renderGroupTable() {
    const groupIds = GROUPS.map((group) => group.id);
    elements.groupRows.innerHTML = groupIds
      .map((groupId) => {
        const meta = groupMeta(groupId);
        const counts = draftForGroup(groupId);
        const total = draftGroupTotal(groupId);
        const confirmedTotal = groupTotal(groupId);
        const pending = groupHasPending(groupId);
        const values = counts
          .map(
            (count) => `<td><span class="count-display">${count.toLocaleString("zh-TW")}</span></td>`,
          )
          .join("");
        return `
          <tr class="${pending ? "has-pending" : ""}">
            <td><span class="group-badge" style="--group-color:${meta.color}">${meta.name}</span></td>
            ${values}
            <td class="row-total">${total.toLocaleString("zh-TW")}<small>已確認 ${confirmedTotal.toLocaleString("zh-TW")}</small></td>
            <td class="row-actions">
              <button class="edit-group-row" type="button" data-edit-group="${groupId}">${pending ? "繼續輸入" : "右側輸入"}</button>
              <button class="reset-group" type="button" data-reset-group="${groupId}" ${total === 0 && confirmedTotal === 0 ? "disabled" : ""}>歸零</button>
            </td>
          </tr>`;
      })
      .join("");

    const nonEmptyGroups = GROUPS.filter((group) => groupTotal(group.id) > 0).length;
    const pendingGroups = GROUPS.filter((group) => groupHasPending(group.id)).length;
    elements.rosterSummary.textContent = `${nonEmptyGroups}／8 組已確認 · ${pendingGroups} 組待確認 · 全班 ${totalAllGroups().toLocaleString("zh-TW")} 顆`;
  }

  function renderLegend() {
    const groups = state.selectedView === "all" ? GROUPS : [groupMeta(state.selectedView)];
    elements.chartLegend.innerHTML = groups
      .map(
        (group) =>
          `<span class="legend-item"><i class="legend-dot" style="--dot:${group.color}"></i>${group.name}</span>`,
      )
      .join("");
  }

  function renderActions() {
    const hasConfirmedData = totalAllGroups() > 0;
    const hasData = hasConfirmedData || hasAnyDraftData();
    elements.undoButton.disabled = history.length === 0;
    elements.clearButton.disabled = !hasData;
    elements.exportButton.disabled = !hasConfirmedData;
    elements.demoButton.hidden = hasData;
    elements.randomDropButton.setAttribute("aria-pressed", String(randomDropActive));
    elements.randomDropButton.classList.toggle("is-active", randomDropActive);
    elements.randomDropLabel.textContent = randomDropActive ? "停止連續落珠" : "隨機連續落珠";
    elements.randomDropButton.setAttribute(
      "aria-label",
      randomDropActive
        ? `停止${groupMeta(state.quickGroup).name}的隨機連續落珠`
        : `開始讓${groupMeta(state.quickGroup).name}隨機連續落珠`,
    );
    elements.soundButton.setAttribute("aria-pressed", String(state.sound));
    elements.soundButton.setAttribute("aria-label", state.sound ? "關閉落珠音效" : "開啟落珠音效");
    elements.soundLabel.textContent = state.sound ? "音效開啟" : "音效關閉";
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
  }

  function announce(message) {
    elements.liveRegion.textContent = "";
    requestAnimationFrame(() => {
      elements.liveRegion.textContent = message;
    });
  }

  function visibleOrdinalStart(groupId, targetIndex) {
    const numericGroup = Number(groupId);
    if (state.selectedView !== "all") return countsForGroup(numericGroup)[targetIndex];
    return GROUPS.reduce((sum, group) => {
      if (group.id >= numericGroup) return sum;
      return sum + countsForGroup(group.id)[targetIndex];
    }, 0) + countsForGroup(numericGroup)[targetIndex];
  }

  function dropSingleMarble(targetIndex, groupId = state.quickGroup, moves = null, silent = false) {
    const numericGroup = Number(groupId);
    const safeTarget = Math.max(0, Math.min(7, Number(targetIndex)));
    const ordinalStart = visibleOrdinalStart(numericGroup, safeTarget);
    recordHistory();
    countsForGroup(numericGroup)[safeTarget] += 1;
    draftForGroup(numericGroup)[safeTarget] += 1;
    startDrops(safeTarget, 1, numericGroup, ordinalStart, 0, 1, moves);
    render();
    if (!silent) {
      const message = `${groupMeta(numericGroup).name}投下 1 顆彈珠，目標是${TARGETS[safeTarget].short}。`;
      showToast(message);
      announce(message);
    }
  }

  function randomSevenMoves() {
    return Array.from({ length: 7 }, () => Math.random() >= 0.5);
  }

  function scheduleRandomDrop() {
    if (!randomDropActive) return;
    const moves = randomSevenMoves();
    const targetIndex = moves.reduce((sum, move) => sum + (move ? 1 : 0), 0);
    dropSingleMarble(targetIndex, state.quickGroup, moves, true);
    randomDropTimer = window.setTimeout(scheduleRandomDrop, 680 + Math.random() * 420);
  }

  function startRandomDrops() {
    if (randomDropActive) return;
    randomDropActive = true;
    renderActions();
    const message = `${groupMeta(state.quickGroup).name}開始隨機連續落珠。`;
    showToast(message);
    announce(message);
    scheduleRandomDrop();
  }

  function stopRandomDrops(silent = false) {
    if (!randomDropActive && !randomDropTimer) return;
    randomDropActive = false;
    clearTimeout(randomDropTimer);
    randomDropTimer = 0;
    renderActions();
    if (!silent) {
      showToast("已停止隨機連續落珠。");
      announce("已停止隨機連續落珠。");
    }
  }

  function toggleRandomDrops() {
    if (randomDropActive) stopRandomDrops();
    else startRandomDrops();
  }

  function stageCount(groupId, targetIndex, nextValue) {
    const numericGroup = Number(groupId);
    const counts = draftForGroup(numericGroup);
    const previous = counts[targetIndex];
    const next = sanitizeCount(nextValue, previous);
    if (next === previous) return;
    counts[targetIndex] = next;
    render();
    showToast(`${groupMeta(numericGroup).name}的${TARGETS[targetIndex].short}待確認為 ${next.toLocaleString("zh-TW")} 顆`);
  }

  function confirmGroup(groupId) {
    const numericGroup = Number(groupId);
    if (!groupHasPending(numericGroup)) {
      showToast(`${groupMeta(numericGroup).name}目前沒有待確認的修改。`);
      return;
    }

    const previous = countsForGroup(numericGroup).slice();
    const next = draftForGroup(numericGroup).slice();
    recordHistory({ syncDrafts: true });
    state.counts[numericGroup - 1] = next.slice();
    state.draftCounts[numericGroup - 1] = next.slice();
    state.quickGroup = numericGroup;
    state.selectedView = String(numericGroup);
    removeParticlesForGroup(numericGroup);

    let fallingAmount = 0;
    next.forEach((count, targetIndex) => {
      const delta = count - previous[targetIndex];
      if (delta > 0) {
        fallingAmount += delta;
        startDrops(targetIndex, delta, numericGroup, previous[targetIndex], targetIndex * 130);
      }
    });

    render();
    const message = fallingAmount > 0
      ? `${groupMeta(numericGroup).name}已確定，${fallingAmount.toLocaleString("zh-TW")} 顆彈珠開始慢速落下。`
      : `${groupMeta(numericGroup).name}已確定，統計圖已更新。`;
    showToast(message);
    announce(message);
  }

  function showGroupView(viewId, replay = true) {
    const nextView = String(viewId);
    state.selectedView = nextView;
    particles.length = 0;
    bursts.length = 0;

    if (nextView === "all") {
      const total = totalAllGroups();
      if (replay && total > 0) {
        const particleLimit = total > 20000 ? 10 : total > 8000 ? 16 : total > 3000 ? 28 : total > 1200 ? 48 : 120;
        const priorCounts = Array(8).fill(0);
        GROUPS.forEach((group, groupIndex) => {
          countsForGroup(group.id).forEach((count, targetIndex) => {
            if (count > 0) {
              startDrops(
                targetIndex,
                count,
                group.id,
                priorCounts[targetIndex],
                targetIndex * 130 + groupIndex * 45,
                particleLimit,
              );
              priorCounts[targetIndex] += count;
            }
          });
        });
        announce("全班的彈珠正在重新落下。");
      }
    } else {
      const groupId = Number(nextView);
      state.quickGroup = groupId;
      const counts = countsForGroup(groupId);
      const total = counts.reduce((sum, count) => sum + count, 0);
      if (replay && total > 0) {
        const particleLimit = total > 2000 ? 90 : total > 800 ? 140 : 320;
        counts.forEach((count, targetIndex) => {
          if (count > 0) startDrops(targetIndex, count, groupId, 0, targetIndex * 130, particleLimit);
        });
        announce(`${groupMeta(groupId).name}的彈珠正在重新落下。`);
      }
    }

    render();
  }

  function removeParticlesForGroup(groupId) {
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      if (particles[index].group === Number(groupId)) particles.splice(index, 1);
    }
  }

  function resetGroup(groupId) {
    const numericGroup = Number(groupId);
    if (groupTotal(numericGroup) === 0 && draftGroupTotal(numericGroup) === 0) return;
    stopRandomDrops(true);
    recordHistory();
    state.counts[numericGroup - 1] = Array(8).fill(0);
    state.draftCounts[numericGroup - 1] = Array(8).fill(0);
    removeParticlesForGroup(numericGroup);
    render();
    showToast(`${groupMeta(numericGroup).name}已歸零，可按「復原上一步」找回。`);
  }

  function undo() {
    stopRandomDrops(true);
    const snapshot = history.pop();
    if (!snapshot) return;
    const restored = JSON.parse(snapshot);
    state.counts = restored.counts;
    state.draftCounts = restored.draftCounts;
    particles.length = 0;
    bursts.length = 0;
    render();
    showToast("已復原上一步。");
  }

  function clearAll() {
    if (totalAllGroups() === 0 && !hasAnyDraftData()) return;
    stopRandomDrops(true);
    recordHistory();
    state.counts = blankCounts();
    state.draftCounts = blankCounts();
    particles.length = 0;
    bursts.length = 0;
    render();
    showToast("8 個組別已全部歸零，可按「復原上一步」找回。");
  }

  function loadDemo() {
    if (totalAllGroups() > 0 || hasAnyDraftData()) return;
    stopRandomDrops(true);
    recordHistory();
    state.counts = [
      [4, 8, 14, 24, 24, 14, 8, 4],
      [3, 7, 15, 25, 24, 15, 8, 3],
      [5, 10, 15, 20, 20, 15, 10, 5],
      [2, 8, 18, 22, 22, 18, 8, 2],
      [6, 9, 13, 22, 22, 13, 9, 6],
      [4, 10, 16, 20, 20, 16, 10, 4],
      [3, 9, 14, 24, 24, 14, 9, 3],
      [5, 7, 13, 25, 25, 13, 7, 5],
    ];
    state.draftCounts = state.counts.map((counts) => counts.slice());
    state.quickGroup = 1;
    showGroupView("all", true);
    showToast("已載入 8 個組別的示範分布。");
  }

  function exportCsv() {
    if (totalAllGroups() === 0) return;
    const header = ["組別", ...TARGETS.map((target) => target.short), "總計"];
    const rows = GROUPS.map((group) => [
      group.name,
      ...countsForGroup(group.id),
      groupTotal(group.id),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `彈珠統計_8個組別_${new Date().toLocaleDateString("zh-TW").replaceAll("/", "-")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("已匯出 8 個組別的 CSV 檔案。");
  }

  function initializeControls() {
    elements.quickGroup.innerHTML = GROUPS.map(
      (group) => `<option value="${group.id}">${group.name}</option>`,
    ).join("");
    elements.quickGroup.value = String(state.quickGroup);
    elements.targetInputs.innerHTML = TARGETS.map(
      (target, index) => `
        <label class="target-input-card" style="--accent:${target.accent}">
          <span class="target-input-heading">
            <strong>${target.score}</strong>
            <small>${target.label}</small>
          </span>
          <input
            class="quick-count-input"
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            value="0"
            data-target-index="${index}"
            aria-label="${groupMeta(state.quickGroup).name} ${target.short} 彈珠數"
          />
        </label>`,
    ).join("");
    elements.targetAxis.innerHTML = TARGETS.map(
      (target, index) => `
        <button class="axis-label" type="button" style="--axis-accent:${target.accent}" data-drop-target="${index}" aria-label="投一顆彈珠到${target.short}">
          <strong>${target.score}</strong>
          <span>${index < 4 ? `左 ${4 - index}` : `右 ${index - 3}`}</span>
        </button>`,
    ).join("");
  }

  function bindEvents() {
    elements.groupTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      showGroupView(button.dataset.view, true);
    });
    elements.quickGroup.addEventListener("change", () => {
      showGroupView(elements.quickGroup.value, true);
    });
    elements.targetInputs.addEventListener("change", (event) => {
      const input = event.target.closest(".quick-count-input");
      if (!input) return;
      stageCount(state.quickGroup, Number(input.dataset.targetIndex), input.value);
    });
    elements.targetInputs.addEventListener("keydown", (event) => {
      const input = event.target.closest(".quick-count-input");
      if (!input || event.key !== "Enter") return;
      event.preventDefault();
      stageCount(state.quickGroup, Number(input.dataset.targetIndex), input.value);
      confirmGroup(state.quickGroup);
    });
    elements.confirmGroupButton.addEventListener("click", () => confirmGroup(state.quickGroup));
    elements.targetAxis.addEventListener("click", (event) => {
      const button = event.target.closest("[data-drop-target]");
      if (!button) return;
      dropSingleMarble(Number(button.dataset.dropTarget));
    });
    elements.randomDropButton.addEventListener("click", toggleRandomDrops);
    elements.groupRows.addEventListener("click", (event) => {
      const editButton = event.target.closest("[data-edit-group]");
      if (editButton) {
        showGroupView(editButton.dataset.editGroup, true);
        elements.quickGroup.focus();
        return;
      }
      const resetButton = event.target.closest("[data-reset-group]");
      if (resetButton) resetGroup(resetButton.dataset.resetGroup);
    });
    elements.undoButton.addEventListener("click", undo);
    elements.demoButton.addEventListener("click", loadDemo);
    elements.exportButton.addEventListener("click", exportCsv);
    elements.clearButton.addEventListener("click", () => {
      stopRandomDrops(true);
      if (typeof elements.clearDialog.showModal === "function") {
        elements.clearDialog.showModal();
      } else if (confirm("要清空 8 個組別的全部彈珠資料嗎？")) {
        clearAll();
      }
    });
    elements.confirmClear.addEventListener("click", clearAll);
    elements.soundButton.addEventListener("click", async () => {
      state.sound = !state.sound;
      if (state.sound) {
        audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === "suspended") await audioContext.resume();
        playLandingSound(true);
      }
      renderActions();
      saveState();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopRandomDrops(true);
    });
  }

  function resizeCanvas() {
    const rect = elements.chartShell.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvasSize.width === width && canvasSize.height === height && canvasSize.dpr === dpr) return;
    canvasSize = { width, height, dpr };
    elements.canvas.width = Math.round(width * dpr);
    elements.canvas.height = Math.round(height * dpr);
    elements.canvas.style.width = `${width}px`;
    elements.canvas.style.height = `${height}px`;
    drawScene();
  }

  function computeLayout(maxCount) {
    const { width, height } = canvasSize;
    const side = Math.max(12, width * 0.018);
    const peg = {
      top: Math.max(64, height * 0.09),
      bottom: Math.min(height * 0.57, height - 190),
    };
    const plot = {
      left: side,
      right: width - side,
      top: peg.bottom + 28,
      bottom: height - 16,
    };
    const binWidth = (plot.right - plot.left) / 8;
    const availableHeight = plot.bottom - plot.top - 10;
    let radius = 9;
    let columns = 1;
    for (let candidate = 9; candidate >= 0.55; candidate -= 0.15) {
      const gap = Math.max(0.3, candidate * 0.18);
      const step = candidate * 2 + gap;
      const candidateColumns = Math.max(1, Math.floor((binWidth - 8) / step));
      const shortColumns = Math.max(1, candidateColumns - 1);
      const pairCapacity = candidateColumns + shortColumns;
      const completePairs = Math.floor(Math.max(1, maxCount) / pairCapacity);
      const remainder = Math.max(1, maxCount) % pairCapacity;
      const rows = completePairs * 2 + (remainder > 0 ? 1 : 0) + (remainder > candidateColumns ? 1 : 0);
      if (rows * step <= availableHeight) {
        radius = candidate;
        columns = candidateColumns;
        break;
      }
      radius = 0.55;
      columns = Math.max(1, Math.floor((binWidth - 4) / 1.4));
    }
    return { plot, peg, binWidth, radius, columns, step: radius * 2 + Math.max(0.3, radius * 0.18), maxCount };
  }

  function pinPosition(row, index, layout = lastLayout) {
    const center = (layout.plot.left + layout.plot.right) / 2;
    const y = layout.peg.top + (row / 6) * (layout.peg.bottom - layout.peg.top);
    return {
      x: center + (index - row / 2) * layout.binWidth,
      y,
    };
  }

  function pegPathPoints(moves, layout = lastLayout) {
    const center = (layout.plot.left + layout.plot.right) / 2;
    const points = [{ x: center, y: layout.peg.top - 38 }];
    let rights = 0;
    for (let row = 0; row < 7; row += 1) {
      points.push(pinPosition(row, rights, layout));
      if (moves[row]) rights += 1;
    }
    points.push({
      x: layout.plot.left + layout.binWidth * (rights + 0.5),
      y: layout.plot.top - 12,
    });
    return points;
  }

  function randomMovesForTarget(targetIndex) {
    const moves = Array.from({ length: 7 }, (_, index) => index < targetIndex);
    for (let index = moves.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [moves[index], moves[swapIndex]] = [moves[swapIndex], moves[index]];
    }
    return moves;
  }

  function marblePosition(binIndex, ordinal, layout = lastLayout) {
    const { plot, binWidth, radius, columns, step } = layout;
    const shortColumns = Math.max(1, columns - 1);
    const pairCapacity = columns + shortColumns;
    const pair = Math.floor(ordinal / pairCapacity);
    const withinPair = ordinal % pairCapacity;
    const isShortRow = withinPair >= columns;
    const row = pair * 2 + (isShortRow ? 1 : 0);
    const column = isShortRow ? withinPair - columns : withinPair;
    const rowColumns = isShortRow ? shortColumns : columns;
    const gridWidth = (rowColumns - 1) * step;
    const center = plot.left + binWidth * (binIndex + 0.5);
    const pileWidth = gridWidth + radius * 2;
    const sideRoom = Math.max(0, (binWidth - pileWidth) / 2 - 2);
    const hash = (seed) => {
      const value = Math.sin(seed * 12.9898 + binIndex * 78.233) * 43758.5453;
      return (value - Math.floor(value)) * 2 - 1;
    };
    const rowShift = Math.sin(row * 2.17 + binIndex * 0.91) * Math.min(radius * 0.7, sideRoom * 0.55);
    const xJitter = hash(ordinal + 11) * Math.min(radius * 0.34, sideRoom * 0.4);
    const yJitter = row === 0
      ? -Math.abs(hash(ordinal + 29)) * radius * 0.2
      : hash(ordinal + 29) * radius * 0.36;
    return {
      x: center - gridWidth / 2 + column * step + rowShift + xJitter,
      y: plot.bottom - radius - row * step + yJitter,
    };
  }

  function pendingCounts() {
    const map = new Map();
    particles.forEach((particle) => {
      const key = `${particle.group}-${particle.targetIndex}`;
      map.set(key, (map.get(key) || 0) + particle.weight);
    });
    return map;
  }

  function marbleGroupsByTarget(scale) {
    const result = Array.from({ length: 8 }, () => []);
    const pending = pendingCounts();
    visibleGroupIds().forEach((groupId) => {
      countsForGroup(groupId).forEach((count, targetIndex) => {
        const waiting = pending.get(`${groupId}-${targetIndex}`) || 0;
        const settled = Math.max(0, count - waiting);
        const visibleCount = settled === 0 ? 0 : Math.ceil(settled / scale);
        for (let index = 0; index < visibleCount; index += 1) result[targetIndex].push(groupId);
      });
    });
    return result;
  }

  function drawScene(now = performance.now()) {
    if (!canvasSize.width || !canvasSize.height) return;
    const dpr = canvasSize.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    const totals = totalsFor();
    const scale = visualScaleForTotals(totals);
    const maxVisibleCount = Math.max(1, ...totals.map((count) => Math.ceil(count / scale)));
    lastLayout = computeLayout(maxVisibleCount);
    drawBoard(lastLayout, Math.max(...totals), scale);

    const groupsByTarget = marbleGroupsByTarget(scale);
    const totalDots = groupsByTarget.reduce((sum, groups) => sum + groups.length, 0);
    groupsByTarget.forEach((groups, targetIndex) => {
      groups.forEach((groupId, ordinal) => {
        const position = marblePosition(targetIndex, ordinal, lastLayout);
        drawMarble(position.x, position.y, lastLayout.radius, groupMeta(groupId).color, totalDots < 1000);
      });
    });

    let active = false;
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      if (now < particle.startTime) { active = true; continue; }
      const progress = Math.min(1, (now - particle.startTime) / particle.duration);
      const target = marblePosition(particle.targetIndex, particle.ordinal, lastLayout);
      const path = pegPathPoints(particle.moves, lastLayout);
      const routeEnd = 0.78;
      let x;
      let y;
      if (progress < routeEnd) {
        const routeProgress = progress / routeEnd;
        const segmentFloat = routeProgress * (path.length - 1);
        const segment = Math.min(path.length - 2, Math.floor(segmentFloat));
        const local = Math.min(1, segmentFloat - segment);
        const eased = local * local * (3 - 2 * local);
        const from = path[segment];
        const to = path[segment + 1];
        x = from.x + (to.x - from.x) * eased;
        y = from.y + (to.y - from.y) * eased - Math.sin(local * Math.PI) * Math.max(2, lastLayout.radius * 0.45);
      } else {
        const settleProgress = (progress - routeEnd) / (1 - routeEnd);
        const exit = path[path.length - 1];
        if (settleProgress < 0.78) {
          const fall = settleProgress / 0.78;
          x = exit.x + (target.x - exit.x) * fall;
          y = exit.y + (target.y - exit.y) * fall * fall;
        } else {
          const bounceProgress = (settleProgress - 0.78) / 0.22;
          const bounce = Math.abs(Math.sin(bounceProgress * Math.PI * 2.25)) * (1 - bounceProgress);
          x = target.x;
          y = target.y - bounce * Math.max(7, lastLayout.radius * 2.2);
        }
      }
      const wobble = Math.sin(progress * Math.PI * 10 + particle.wobble) * (1 - progress) * 1.8;
      const animatedRadius = Math.max(3.4, Math.min(8, lastLayout.radius * 1.12));
      drawMarble(x + wobble, y, animatedRadius, groupMeta(particle.group).color, true);
      if (progress >= 1) {
        particles.splice(index, 1);
        addBurst(target.x, target.y, groupMeta(particle.group).color);
        playLandingSound();
      } else active = true;
    }

    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      const age = (now - burst.startedAt) / 420;
      if (age >= 1) { bursts.splice(index, 1); continue; }
      ctx.save();
      ctx.globalAlpha = (1 - age) * 0.7;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 1.5;
      for (let ray = 0; ray < 5; ray += 1) {
        const angle = (Math.PI * 2 * ray) / 5;
        const start = 5 + age * 5;
        const end = 8 + age * 14;
        ctx.beginPath();
        ctx.moveTo(burst.x + Math.cos(angle) * start, burst.y + Math.sin(angle) * start);
        ctx.lineTo(burst.x + Math.cos(angle) * end, burst.y + Math.sin(angle) * end);
        ctx.stroke();
      }
      ctx.restore();
      active = true;
    }
    if (active || particles.length || bursts.length) requestDraw();
  }

  function drawBoard(layout, maxCount, scale) {
    const { plot, peg, binWidth } = layout;
    const { width } = canvasSize;
    const topGlow = ctx.createRadialGradient(width / 2, 0, 5, width / 2, 70, width * 0.45);
    topGlow.addColorStop(0, "rgba(255, 222, 107, 0.34)");
    topGlow.addColorStop(0.45, "rgba(78, 216, 233, 0.14)");
    topGlow.addColorStop(1, "rgba(231, 251, 255, 0)");
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, width, peg.bottom + 24);
    for (let index = 0; index < 8; index += 1) {
      ctx.fillStyle = index % 2 ? "rgba(255,255,255,0.18)" : "rgba(18,185,212,0.035)";
      ctx.fillRect(plot.left + index * binWidth, plot.top, binWidth, plot.bottom - plot.top);
    }
    ctx.save();
    ctx.strokeStyle = "rgba(255, 120, 111, 0.28)";
    ctx.lineWidth = 1.35;
    for (let row = 0; row < 6; row += 1) {
      for (let pin = 0; pin <= row; pin += 1) {
        const from = pinPosition(row, pin, layout);
        const left = pinPosition(row + 1, pin, layout);
        const right = pinPosition(row + 1, pin + 1, layout);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(left.x, left.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(right.x, right.y); ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    for (let row = 0; row < 7; row += 1) {
      for (let pin = 0; pin <= row; pin += 1) {
        const point = pinPosition(row, pin, layout);
        const pinRadius = Math.max(3.2, Math.min(5.2, binWidth * 0.055));
        ctx.shadowColor = "rgba(18,185,212,0.55)";
        ctx.shadowBlur = 9;
        ctx.fillStyle = "#087f98";
        ctx.beginPath(); ctx.arc(point.x, point.y, pinRadius, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath(); ctx.arc(point.x - pinRadius * 0.28, point.y - pinRadius * 0.3, Math.max(0.7, pinRadius * 0.18), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1;
    for (let line = 1; line <= 2; line += 1) {
      const y = plot.top + ((plot.bottom - plot.top) * line) / 3;
      ctx.strokeStyle = "rgba(24,128,150,0.12)";
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(24,128,150,0.16)";
    ctx.lineWidth = 1;
    for (let index = 1; index < 8; index += 1) {
      const x = plot.left + index * binWidth;
      ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(9,151,176,0.58)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(18,185,212,0.3)";
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(plot.left, plot.bottom + 1); ctx.lineTo(plot.right, plot.bottom + 1); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(7,60,77,0.72)";
    ctx.font = '800 12px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText("7 層彈珠台", plot.left + 6, peg.top - 28);
    ctx.fillStyle = "rgba(7,60,77,0.5)";
    ctx.font = '700 10px "Microsoft JhengHei", sans-serif';
    ctx.fillText("彈珠每層隨機向左或向右彈跳", plot.left + 6, peg.top - 12);
    if (maxCount > 0) {
      ctx.fillStyle = "rgba(7,60,77,0.58)";
      ctx.font = '700 10px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = "left";
      const label = scale === 1
        ? `最高 ${maxCount.toLocaleString("zh-TW")} 顆`
        : `最高 ${maxCount.toLocaleString("zh-TW")} 顆 · 1 點約 ${scale.toLocaleString("zh-TW")} 顆`;
      ctx.fillText(label, plot.left + 6, plot.top + 12);
    }
  }

  function drawMarble(x, y, radius, color, detailed) {
    ctx.save();
    ctx.globalAlpha = 0.97;
    if (detailed && radius >= 3.2) { ctx.shadowColor = color; ctx.shadowBlur = Math.min(10, radius * 1.3); }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = Math.max(0.2, radius * 0.1);
    ctx.stroke();
    if (detailed && radius >= 3.4) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath(); ctx.arc(x - radius * 0.28, y - radius * 0.3, Math.max(0.8, radius * 0.18), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function addBurst(x, y, color) {
    if (bursts.length > 35) bursts.shift();
    bursts.push({ x, y, color, startedAt: performance.now() });
  }

  function startDrops(targetIndex, amount, group, actualOrdinalStart, extraDelay = 0, particleLimit = 320, movesOverride = null) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { drawScene(); return; }
    const scale = visualScaleForTotals(totalsFor());
    const desiredParticles = scale === 1 ? amount : Math.ceil(amount / scale);
    const visualAmount = Math.max(1, Math.min(particleLimit, desiredParticles));
    const baseWeight = Math.floor(amount / visualAmount);
    const extraWeight = amount % visualAmount;
    const now = performance.now();
    const stagger = visualAmount > 120 ? 15 : visualAmount > 40 ? 28 : visualAmount > 8 ? 55 : 95;
    const visualOrdinalStart = Math.ceil(actualOrdinalStart / scale);
    for (let index = 0; index < visualAmount; index += 1) {
      particles.push({
        targetIndex,
        group,
        ordinal: Math.max(0, visualOrdinalStart + index),
        weight: baseWeight + (index < extraWeight ? 1 : 0),
        startTime: now + extraDelay + index * stagger,
        duration: 3600 + Math.random() * 900,
        wobble: Math.random() * Math.PI * 2,
        moves: movesOverride && visualAmount === 1
          ? movesOverride.slice()
          : randomMovesForTarget(targetIndex),
      });
    }
    requestDraw();
  }

  function requestDraw() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame((now) => { animationFrame = 0; drawScene(now); });
  }

  function playLandingSound(force = false) {
    if (!state.sound || !audioContext) return;
    const now = performance.now();
    if (!force && now - lastSoundAt < 55) return;
    lastSoundAt = now;
    try {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(force ? 610 : 430 + Math.random() * 150, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(250, audioContext.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(force ? 0.07 : 0.035, audioContext.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + 0.11);
    } catch {
      state.sound = false;
      renderActions();
    }
  }

  initializeControls();
  bindEvents();
  render();
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(elements.chartShell);
})();
