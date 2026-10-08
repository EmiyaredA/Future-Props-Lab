"use strict";
const board = JSON.parse(document.getElementById("board-data").textContent);
const labels = board.labels;
const pending = new Map();
let activeShot = board.shots[0]?.id;
let filter = "all";
let detailTab = "compare";
const chosen = new Map(board.shots.map((s) => [s.id, s.selected_candidate_id]));

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, className) {
  const node = el("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function badge(status) {
  return el(
    "span",
    labels[status] || status,
    `badge${["fail", "reject", "needs_changes", "stale", "insufficient"].includes(status) ? " warn" : ""}`,
  );
}
function list(values, empty = "暂无") {
  const node = el("ul");
  for (const value of values.length ? values : [empty])
    node.append(el("li", value));
  return node;
}
function candidate(shot) {
  return shot.candidates.find((c) => c.id === chosen.get(shot.id));
}
const executionLabels = {
  not_started: "尚未执行",
  running: "执行中",
  completed: "执行完成",
  failed: "执行失败",
};
function message(text) {
  document.getElementById("message").textContent = text;
}
function dirty() {
  document.getElementById("dirty").textContent = pending.size
    ? `${pending.size} 项意见尚未导出`
    : "暂无未导出意见";
  document.getElementById("export").disabled = pending.size === 0;
}
function reviewForm(target, key, status) {
  const form = el("div", undefined, "review");
  const heading = el("p");
  heading.append(el("strong", "用户 review · "), badge(status));
  form.append(heading);
  const label = el("label", "意见与返修要求");
  const note = el("textarea");
  note.id = `review-${key}`;
  label.htmlFor = note.id;
  note.value = pending.get(key)?.note || "";
  note.placeholder = "说明具体镜头、时间和需要保留或修改的内容…";
  const decisions = el("div", undefined, "decisions");
  const options = [
    ["approve", "确认通过"],
    ["needs_changes", "要求修改"],
    ["reject", "驳回"],
  ];
  if (target.kind === "candidate") options.push(["comment", "只留意见"]);
  const update = (decision) => {
    pending.set(key, { ...target, decision, note: note.value });
    for (const item of decisions.children)
      item.setAttribute(
        "aria-pressed",
        String(item.dataset.decision === decision),
      );
    dirty();
  };
  note.addEventListener("input", () => {
    const decision =
      pending.get(key)?.decision ||
      (target.kind === "candidate" ? "comment" : null);
    if (decision) update(decision);
    else {
      pending.set(key, { ...target, decision: null, note: note.value });
      dirty();
    }
  });
  for (const [value, title] of options) {
    const item = button(title, () => update(value));
    item.dataset.decision = value;
    item.setAttribute(
      "aria-pressed",
      String(pending.get(key)?.decision === value),
    );
    decisions.append(item);
  }
  form.append(label, note, decisions);
  return form;
}
function mediaCard(media, caption) {
  const figure = el("figure", undefined, "media-card");
  figure.append(el("figcaption", caption));
  const stage = el(
    "div",
    undefined,
    `media-stage${media?.kind === "audio" ? " audio" : ""}`,
  );
  figure.append(stage);
  if (!media || media.missing || !media.path) {
    stage.append(
      el(
        "p",
        media?.missing
          ? "媒体缺失 · 请获取对应文件后重新生成快照"
          : "尚未提供媒体 · 此卡不代表实际生成结果",
        "missing",
      ),
    );
    return { figure, seek: () => message("该候选尚无可定位媒体。") };
  }
  const node = el(media.kind === "image" ? "img" : media.kind);
  node.src = media.path;
  node.addEventListener("error", () => {
    stage.replaceChildren(
      el("p", "媒体无法读取或格式不支持 · 该维度尚未验证", "missing"),
    );
  });
  if (media.kind === "image") {
    node.alt = caption;
    stage.append(node);
    return {
      figure,
      seek: () => message("已显示静态画面；证据时间不能用于证明动态连续性。"),
    };
  }
  node.preload = "metadata";
  const offset = media.offset || 0;
  const duration = () =>
    Math.max(0, Math.min(media.duration || Infinity, node.duration - offset));
  const transport = el("div", undefined, "transport");
  const play = button("播放", async () => {
    if (node.paused) {
      if (node.currentTime < offset || node.currentTime >= offset + duration())
        node.currentTime = offset;
      try {
        await node.play();
      } catch {
        message("无法播放媒体，请检查格式与文件。 ");
      }
    } else node.pause();
  });
  const range = el("input");
  range.type = "range";
  range.min = "0";
  range.max = "0";
  range.step = "0.01";
  range.value = "0";
  range.setAttribute("aria-label", `${caption} · 相对时间`);
  const time = el("span", "0.00s", "muted");
  node.addEventListener("loadedmetadata", () => {
    range.max = String(duration());
    node.currentTime = offset;
  });
  node.addEventListener("timeupdate", () => {
    range.value = String(Math.max(0, node.currentTime - offset));
    time.textContent = `${Number(range.value).toFixed(2)}s`;
    if (node.currentTime > offset + duration()) {
      node.pause();
      node.currentTime = offset + duration();
    }
  });
  node.addEventListener("play", () => {
    play.textContent = "暂停";
  });
  node.addEventListener("pause", () => {
    play.textContent = "播放";
  });
  range.addEventListener("input", () => {
    node.pause();
    node.currentTime = offset + Number(range.value);
  });
  transport.append(play, range, time);
  if (media.kind === "video") {
    node.playsInline = true;
    transport.append(
      button("全屏", () => {
        node
          .requestFullscreen?.()
          .catch(() => message("当前浏览器不支持全屏。"));
      }),
    );
  }
  stage.append(node);
  figure.append(transport);
  return {
    figure,
    seek: (seconds) => {
      if (node.readyState < 1)
        return message("媒体尚未就绪，请先加载后定位。 ");
      node.pause();
      node.currentTime = offset + Math.min(seconds, duration());
      message(
        `已定位候选相对时间 ${seconds.toFixed(2)}s；播放器定位不代表逐帧验收。`,
      );
    },
  };
}
function showChecks(candidate, seek) {
  const grid = el("div", undefined, "checks");
  for (const dimension of ["technical", "static", "dynamic", "audio"]) {
    const check = candidate?.checks.find((c) => c.dimension === dimension);
    const card = el("div", undefined, "check");
    const title = el("p");
    title.append(
      el("strong", `${labels[dimension]} `),
      badge(check?.status || "unverified"),
    );
    card.append(title, el("p", check?.note || "没有对应实际证据，尚未验证。"));
    for (const evidence of check?.evidence || []) {
      card.append(
        button(
          `${labels[evidence.kind]} · ${evidence.time.toFixed(2)}s · ${evidence.text}`,
          () => seek(evidence.time),
          "evidence",
        ),
      );
    }
    grid.append(card);
  }
  return grid;
}
function showGates() {
  const root = document.getElementById("gates");
  root.replaceChildren();
  for (const [i, gate] of ["scheme", "representative", "final"].entries()) {
    const card = el("div", undefined, "gate");
    card.append(el("strong", `0${i + 1} · ${labels[gate]}`));
    if (board.gates[gate].note)
      card.append(el("p", board.gates[gate].note, "muted"));
    card.append(
      reviewForm(
        {
          kind: "gate",
          gate,
          subject_hash: board.gate_views[gate].subject_hash,
        },
        `gate-${gate}`,
        board.gate_views[gate].status,
      ),
    );
    root.append(card);
  }
}
function matches(shot) {
  const c = candidate(shot);
  return (
    filter === "all" ||
    (filter === "repair" &&
      ["fail", "reject", "needs_changes"].some((s) =>
        [c?.agent_status, c?.user_status].includes(s),
      )) ||
    (filter === "stale" &&
      [c?.agent_status, c?.user_status].includes("stale")) ||
    (filter === "review" && c && ["pending", "comment"].includes(c.user_status))
  );
}
function showShots() {
  const shots = board.shots.filter(matches);
  if (!shots.some((s) => s.id === activeShot)) activeShot = shots[0]?.id;
  document.getElementById("count").textContent =
    `${shots.length} / ${board.shots.length} 个镜头`;
  const root = document.getElementById("shots");
  root.replaceChildren();
  for (const shot of shots) {
    const c = candidate(shot);
    const item = button(
      "",
      () => {
        activeShot = shot.id;
        showShots();
        showDetail();
      },
      "shot-button",
    );
    item.setAttribute("aria-pressed", String(shot.id === activeShot));
    item.append(
      el("strong", shot.id),
      el("span", shot.title),
      el("small", `${shot.stage} · ${shot.source_range.join("–")}s`),
    );
    root.append(item);
    if (c)
      item.append(
        el("small", `${labels[c.agent_status]} / ${labels[c.user_status]}`),
      );
  }
}
function showDetail() {
  const root = document.getElementById("detail");
  root.querySelectorAll("video,audio").forEach((node) => node.pause());
  root.replaceChildren();
  const shot = board.shots.find((s) => s.id === activeShot);
  if (!shot) {
    root.append(el("p", "当前筛选下没有镜头。", "muted"));
    return;
  }
  root.append(
    el("h2", `${shot.id} · ${shot.title}`),
    el(
      "p",
      `任务：${executionLabels[shot.execution_status]} · 下一步：${shot.next_step}`,
      "muted",
    ),
  );
  const tabs = el("div", undefined, "tabs");
  for (const [key, text] of [
    ["compare", "候选对照"],
    ["shot", "镜头制作卡"],
    ["repairs", "返修记录"],
  ]) {
    const tab = button(text, () => {
      detailTab = key;
      showDetail();
    });
    tab.setAttribute("aria-pressed", String(detailTab === key));
    tabs.append(tab);
  }
  root.append(tabs);
  if (detailTab === "shot") {
    root.append(
      el("h3", "保留与替换要求"),
      list(shot.requirements),
      el("h3", "参考职责"),
      list(shot.references.map((r) => `${labels[r.role]} · ${r.description}`)),
      el("h3", "动作段落"),
      list(
        shot.segments.map((s) => `${s.range.join("–")}s · ${s.reason}`),
        "单段镜头",
      ),
      el(
        "p",
        `人物：${shot.character_ids.join("、") || "无"} · 场景：${shot.scene_id || "沿用原片"}`,
      ),
    );
    return;
  }
  if (detailTab === "repairs") {
    if (!shot.repairs.length) root.append(el("p", "暂无返修记录。", "muted"));
    for (const repair of shot.repairs) {
      const card = el("div", undefined, "repair");
      card.append(
        el(
          "strong",
          `${repair.from_candidate_id} → ${repair.to_candidate_id || "待制作"} · ${repair.range.join("–")}s`,
        ),
      );
      for (const [key, label] of [
        ["problem", "问题"],
        ["cause", "根因判断"],
        ["change", "修改"],
        ["comparison", "复查与退化检查"],
      ])
        card.append(el("p", `${label}：${repair[key]}`));
      root.append(card);
    }
    return;
  }
  const candidates = el("div", undefined, "tabs");
  for (const c of shot.candidates) {
    const item = button(c.label, () => {
      chosen.set(shot.id, c.id);
      showShots();
      showDetail();
    });
    item.setAttribute("aria-pressed", String(c.id === chosen.get(shot.id)));
    candidates.append(item);
  }
  root.append(candidates);
  const c = candidate(shot);
  const original = mediaCard(shot.source_media, "原片 / 构图参考");
  const target = mediaCard(c?.media, c ? `候选 · ${c.label}` : "尚无候选");
  const compare = el("div", undefined, "compare");
  compare.append(original.figure, target.figure);
  root.append(compare, showChecks(c, target.seek));
  if (!c) return;
  root.append(
    el(
      "p",
      `候选：${c.id} · 输出：${c.output_id || "未登记"} · 采用：${shot.adopted_candidate_id || "尚未采用"}`,
      "muted",
    ),
  );
  for (const d of shot.decisions.filter((d) => d.candidate_id === c.id))
    root.append(
      el(
        "p",
        `${labels[d.decision]}${d.subject_hash !== c.subject_hash ? "（历史意见，待复查）" : ""}：${d.note}`,
        "muted",
      ),
    );
  root.append(
    reviewForm(
      {
        kind: "candidate",
        shot_id: shot.id,
        candidate_id: c.id,
        subject_hash: c.subject_hash,
      },
      `${shot.id}-${c.id}`,
      c.user_status,
    ),
  );
}
function initialize() {
  document.getElementById("title").textContent = board.title;
  document.getElementById("demo").textContent = board.demo
    ? "演示数据 · 未执行真实生成"
    : "制作记录快照";
  document.getElementById("snapshot").textContent =
    `revision ${board.revision} · 快照生成 ${board.snapshot_at} · 记录更新 ${board.updated_at} · ${board.phase}`;
  const metrics = document.getElementById("metrics");
  const values = [
    [board.shots.length, "镜头总数"],
    [board.shots.filter((s) => s.adopted_candidate_id).length, "明确采用"],
    [
      board.shots.filter((s) => candidate(s)?.agent_status === "fail").length,
      "需返修",
    ],
    [
      Object.values(board.gate_views).filter(
        (g) => g.status === "pending" || g.status === "stale",
      ).length,
      "待确认关口",
    ],
  ];
  for (const [value, label] of values) {
    const card = el("div", undefined, "metric");
    card.append(el("strong", value), el("span", label));
    metrics.append(card);
  }
  const progress = document.getElementById("progress");
  for (const shot of board.shots) {
    const c = shot.candidates.find(
      (item) => item.id === shot.selected_candidate_id,
    );
    const row = el("tr");
    const link = button(`${shot.id} · ${shot.title}`, () => {
      filter = "all";
      document
        .querySelectorAll("[data-filter]")
        .forEach((item) =>
          item.setAttribute(
            "aria-pressed",
            String(item.dataset.filter === "all"),
          ),
        );
      activeShot = shot.id;
      detailTab = "compare";
      showShots();
      showDetail();
      document.getElementById("detail").scrollIntoView({ block: "start" });
    });
    const first = el("td");
    first.append(link);
    const agent = el("td");
    agent.append(badge(c?.agent_status || "unverified"));
    const user = el("td");
    user.append(badge(c?.user_status || "pending"));
    row.append(
      first,
      el("td", shot.stage),
      agent,
      user,
      el("td", shot.next_step),
    );
    progress.append(row);
  }
  const refs = document.getElementById("references");
  refs.append(
    el("h3", "必须保留"),
    list(board.brief.preserve),
    el("h3", "允许替换"),
    list(board.brief.replace),
    list(
      [...board.characters, ...board.scenes].map(
        (e) => `${e.name} · ${e.mapping || e.description || ""}`,
      ),
    ),
  );
  const thumbnails = el("div", undefined, "compare");
  for (const entity of [...board.characters, ...board.scenes]) {
    for (const reference of entity.references)
      thumbnails.append(
        mediaCard(reference, `${entity.name} · 统一参考`).figure,
      );
  }
  if (thumbnails.childElementCount) refs.append(thumbnails);
  const next = document.getElementById("next");
  next.append(
    list(board.next_steps),
    el("h3", "当前阻塞"),
    list(board.blockers, "无阻塞"),
  );
  const final = document.getElementById("final");
  const finalMedia = mediaCard(board.final.candidate?.media, "成片候选");
  final.append(
    el("p", board.final.summary),
    finalMedia.figure,
    showChecks(board.final.candidate, finalMedia.seek),
    el("h3", "未解决问题"),
    list(board.final.issues, "尚无已登记问题；以实际检查为准"),
  );
  document.querySelectorAll("[data-filter]").forEach((item) =>
    item.addEventListener("click", () => {
      filter = item.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === item)));
      showShots();
      showDetail();
    }),
  );
  document.getElementById("theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.getElementById("theme").textContent = dark
      ? "切换浅色"
      : "切换深色";
  });
  document.getElementById("export").addEventListener("click", () => {
    const entries = [...pending.values()];
    if (!entries.length) return;
    if (
      entries.some(
        (e) => !e.decision || (e.decision !== "approve" && !e.note.trim()),
      )
    )
      return message("请为每项反馈选择决定，并为修改、驳回或意见填写说明。 ");
    const feedback = {
      schema_version: 1,
      record_id: board.record_id,
      revision: board.revision,
      snapshot_hash: board.snapshot_hash,
      exported_at: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(feedback, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = "review-feedback.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    pending.clear();
    dirty();
    showGates();
    showDetail();
    message("意见已导出，尚未合并到制作记录。请将文件交给 Agent 校验合并。 ");
  });
  showGates();
  showShots();
  showDetail();
  dirty();
}
initialize();
