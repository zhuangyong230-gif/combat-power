const STORAGE_KEY = "combat-power-system:v1";
const UI_STORAGE_KEY = "combat-power-ui:v1";
const CLOUD_TABLE_NAME = "combat_profiles";
const CLOUD_SAVE_DELAY = 900;

const ROUTES = {
  dashboard: "战斗力",
  today: "今日",
  projects: "项目",
  growth: "成长",
  settings: "设置"
};

const DEFAULT_LEVEL_RULES = [
  { level: 1, score: 0 },
  { level: 2, score: 30 },
  { level: 3, score: 100 },
  { level: 4, score: 210 },
  { level: 5, score: 360 },
  { level: 6, score: 600 },
  { level: 7, score: 920 },
  { level: 8, score: 1300 },
  { level: 9, score: 1680 },
  { level: 10, score: 2000 }
];

const DEFAULT_MULTIPLIER_RULES = [
  { levelSum: 30, multiplier: 1.1 },
  { levelSum: 60, multiplier: 1.25 },
  { levelSum: 90, multiplier: 1.5 },
  { levelSum: 120, multiplier: 2 }
];

const SYSTEM_ORDER = ["身体", "社交", "能力", "事业"];

const SEED_CATALOG_ID = "initial-projects-2026-08-13-v2";
const SCORING_RULE_ID = "scoring-2026-08-13-v3";
const DEFAULT_STAR_SCORES = [0.9, 1, 1.1, 1.2, 1.3];

const SEED_PROJECT_DEFS = [
  { id: "body-fitness-fat-loss", system: "身体", level1: "身体", level2: "健身", level3: "减脂" },
  { id: "body-fitness-muscle", system: "身体", level1: "身体", level2: "健身", level3: "增肌" },
  { id: "body-habit-early-sleep", system: "身体", level1: "身体", level2: "生活习惯", level3: "早睡早起" },
  { id: "body-habit-brush-teeth", system: "身体", level1: "身体", level2: "生活习惯", level3: "睡前刷牙" },
  { id: "body-habit-drink-water", system: "身体", level1: "身体", level2: "生活习惯", level3: "多喝水" },
  { id: "body-habit-healthy-diet", system: "身体", level1: "身体", level2: "生活习惯", level3: "健康饮食" },
  { id: "social-relationship-fast-close", system: "社交", level1: "社交", level2: "更快速拉近关系" },
  { id: "social-communication", system: "社交", level1: "社交", level2: "沟通能力" },
  { id: "social-expression", system: "社交", level1: "社交", level2: "表达能力" },
  { id: "ability-english", system: "能力", level1: "能力", level2: "英语" },
  { id: "ability-photography", system: "能力", level1: "能力", level2: "摄影" },
  { id: "ability-writing", system: "能力", level1: "能力", level2: "写作" },
  { id: "career-ecommerce", system: "事业", level1: "事业", level2: "电商" },
  { id: "career-stock-a-share", system: "事业", level1: "事业", level2: "股票", level3: "A股" },
  { id: "career-stock-us", system: "事业", level1: "事业", level2: "股票", level3: "美股" },
  { id: "career-stock-options", system: "事业", level1: "事业", level2: "股票", level3: "期权" }
];

let state = createEmptyState();
let currentRoute = "dashboard";
let refs = {};
let activeDetailProjectId = null;
let uiState = createDefaultUiState();
let cloudSaveTimer = null;
let isApplyingRemoteState = false;

const cloudState = {
  configured: false,
  client: null,
  user: null,
  tableName: CLOUD_TABLE_NAME,
  status: "local",
  message: "本机保存",
  lastSyncedAt: ""
};

function createDefaultUiState() {
  return {
    collapsed: {}
  };
}

function createEmptyState() {
  const now = new Date().toISOString();
  const settings = {
    starScores: DEFAULT_STAR_SCORES.slice(),
    levelRules: cloneRules(DEFAULT_LEVEL_RULES),
    multiplierRules: cloneMultipliers(DEFAULT_MULTIPLIER_RULES)
  };

  return {
    version: 1,
    updatedAt: now,
    projects: createSeedProjects(settings),
    records: [],
    settings,
    seededCatalogs: [SEED_CATALOG_ID],
    scoringMigrations: [SCORING_RULE_ID],
    deletedProjectIds: []
  };
}

function createSeedProjects(settings) {
  const now = new Date().toISOString();
  return SEED_PROJECT_DEFS.map((item) => ({
    id: item.id,
    name: getSeedLeafName(item),
    system: item.system,
    level1: item.level1 || "",
    level2: item.level2 || "",
    level3: item.level3 || "",
    task: item.task || getSeedLeafName(item),
    cadence: "daily",
    completionCoefficient: 1,
    qualityCoefficient: 1,
    enabled: hasScoringLevels(item),
    showToday: hasScoringLevels(item),
    levelRules: cloneRules(settings.levelRules),
    rewards: {},
    createdAt: now,
    updatedAt: now
  }));
}

function applySeedProjects(projects, settings, deletedProjectIds = []) {
  const now = new Date().toISOString();
  const result = projects.slice();
  const seeded = createSeedProjects(settings);
  const deletedIds = new Set(deletedProjectIds.map(String));

  seeded.forEach((seed) => {
    if (deletedIds.has(seed.id)) return;
    const index = result.findIndex((project) => project.id === seed.id);
    if (index >= 0) {
      const existing = result[index];
      const shouldUseSeedTask = !existing.task || cleanText(existing.task) === cleanText(existing.name);
      const next = {
        ...existing,
        name: seed.name,
        system: seed.system,
        level1: seed.level1,
        level2: seed.level2,
        level3: seed.level3,
        task: shouldUseSeedTask ? seed.task : existing.task,
        completionCoefficient: existing.completionCoefficient === 10 ? 1 : existing.completionCoefficient,
        qualityCoefficient: 1,
        levelRules: existing.levelRules && existing.levelRules.length ? existing.levelRules : cloneRules(settings.levelRules)
      };

      const changed =
        existing.name !== next.name ||
        existing.system !== next.system ||
        existing.level1 !== next.level1 ||
        existing.level2 !== next.level2 ||
        existing.level3 !== next.level3 ||
        existing.task !== next.task;

      result[index] = changed ? { ...next, updatedAt: now } : next;
      return;
    }

    const existsByIdentity = result.some((project) => getProjectIdentityKey(project) === getProjectIdentityKey(seed));
    if (!existsByIdentity) result.push(seed);
  });

  return result;
}

function getSeedLeafName(item) {
  return item.level3 || item.level2 || item.level1 || item.system;
}

function cloneRules(rules) {
  return rules.map((rule) => ({ level: Number(rule.level), score: Number(rule.score) }));
}

function cloneMultipliers(rules) {
  return rules.map((rule) => ({
    levelSum: Number(rule.levelSum),
    multiplier: Number(rule.multiplier)
  }));
}

async function init() {
  state = loadState();
  uiState = loadUiState();
  currentRoute = getRouteFromHash();
  saveState({ localOnly: true, skipTouch: true });
  refs = {
    view: document.getElementById("view"),
    routeTitle: document.getElementById("routeTitle"),
    todayLabel: document.getElementById("todayLabel"),
    toast: document.getElementById("toast"),
    modalRoot: document.getElementById("modalRoot"),
    importFile: document.getElementById("importFile")
  };

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      currentRoute = button.dataset.route;
      if (window.location.hash !== `#${currentRoute}`) {
        history.replaceState(null, "", `#${currentRoute}`);
      }
      closeModal();
      render();
    });
  });

  window.addEventListener("hashchange", () => {
    const nextRoute = getRouteFromHash();
    if (nextRoute === currentRoute) return;
    currentRoute = nextRoute;
    closeModal();
    render();
  });

  refs.view.addEventListener("click", handleViewClick);
  refs.view.addEventListener("submit", handleViewSubmit);
  refs.modalRoot.addEventListener("click", handleModalClick);
  refs.modalRoot.addEventListener("submit", handleModalSubmit);
  refs.importFile.addEventListener("change", handleImportFile);

  registerServiceWorker();
  await initCloudSync();
  render();
}

function getRouteFromHash() {
  const route = window.location.hash.replace("#", "");
  return ROUTES[route] ? route : "dashboard";
}

function loadUiState() {
  if (typeof localStorage === "undefined") return createDefaultUiState();
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return createDefaultUiState();
    const incoming = JSON.parse(raw);
    return {
      collapsed: incoming && typeof incoming.collapsed === "object" ? incoming.collapsed : {}
    };
  } catch (error) {
    console.error("Failed to load UI state", error);
    return createDefaultUiState();
  }
}

function saveUiState() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiState));
}

function loadState() {
  if (typeof localStorage === "undefined") return createEmptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load local data", error);
    return createEmptyState();
  }
}

function normalizeState(input) {
  const base = createEmptyState();
  const incoming = input && typeof input === "object" ? input : {};
  const settings = normalizeSettings(incoming.settings || {});
  const seededCatalogs = Array.isArray(incoming.seededCatalogs) ? incoming.seededCatalogs.map(String) : [];
  const scoringMigrations = Array.isArray(incoming.scoringMigrations) ? incoming.scoringMigrations.map(String) : [];
  const deletedProjectIds = Array.isArray(incoming.deletedProjectIds) ? incoming.deletedProjectIds.map(String) : [];
  let projects = Array.isArray(incoming.projects)
    ? incoming.projects.map((project) => normalizeProject(project, settings))
    : base.projects;

  if (!scoringMigrations.includes(SCORING_RULE_ID)) {
    settings.starScores = DEFAULT_STAR_SCORES.slice();
    settings.levelRules = cloneRules(DEFAULT_LEVEL_RULES);
    settings.multiplierRules = cloneMultipliers(DEFAULT_MULTIPLIER_RULES);
    projects = projects.map(applyScoringMigrationToProject);
    scoringMigrations.push(SCORING_RULE_ID);
  }

  projects = applySeedProjects(projects, settings, deletedProjectIds);
  if (!seededCatalogs.includes(SEED_CATALOG_ID)) seededCatalogs.push(SEED_CATALOG_ID);

  const records = Array.isArray(incoming.records)
    ? dedupeRecords(incoming.records.map(normalizeRecord).filter(Boolean))
    : base.records;

  return {
    version: 1,
    updatedAt: resolveStateUpdatedAt(incoming, projects, records),
    projects,
    records,
    settings,
    seededCatalogs,
    scoringMigrations,
    deletedProjectIds
  };
}

function resolveStateUpdatedAt(incoming, projects, records) {
  const timestamps = [incoming.updatedAt]
    .concat(projects.map((project) => project.updatedAt))
    .concat(records.map((record) => record.updatedAt))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : new Date().toISOString();
}

function applyScoringMigrationToProject(project) {
  return {
    ...project,
    completionCoefficient: project.completionCoefficient === 10 ? 1 : project.completionCoefficient,
    qualityCoefficient: 1,
    levelRules: cloneRules(DEFAULT_LEVEL_RULES)
  };
}

function normalizeSettings(settings) {
  const starScores = Array.isArray(settings.starScores)
    ? settings.starScores.slice(0, 5).map((value, index) => numberOr(value, index + 1))
    : DEFAULT_STAR_SCORES.slice();

  while (starScores.length < 5) starScores.push(DEFAULT_STAR_SCORES[starScores.length] || 1);

  return {
    starScores,
    levelRules: normalizeLevelRules(settings.levelRules, DEFAULT_LEVEL_RULES),
    multiplierRules: normalizeMultiplierRules(settings.multiplierRules)
  };
}

function normalizeLevelRules(rules, fallback) {
  const source = Array.isArray(rules) && rules.length ? rules : fallback;
  const byLevel = new Map();

  source.forEach((rule) => {
    const level = clamp(numberOr(rule.level, 1), 1, 99);
    byLevel.set(level, {
      level,
      score: Math.max(0, numberOr(rule.score, 0))
    });
  });

  DEFAULT_LEVEL_RULES.forEach((rule) => {
    if (!byLevel.has(rule.level)) byLevel.set(rule.level, { ...rule });
  });

  return Array.from(byLevel.values()).sort((a, b) => a.level - b.level);
}

function normalizeMultiplierRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : DEFAULT_MULTIPLIER_RULES;
  return source
    .map((rule) => ({
      levelSum: Math.max(1, numberOr(rule.levelSum, numberOr(rule.minLevelSum, numberOr(rule.minLevel, 1)))),
      multiplier: Math.max(1, numberOr(rule.multiplier, 1))
    }))
    .sort((a, b) => a.levelSum - b.levelSum);
}

function normalizeProject(project, settings) {
  const now = new Date().toISOString();
  const normalizedProject = normalizeHierarchyParts({
    system: project.system,
    level1: project.level1,
    level2: project.level2,
    level3: project.level3
  });
  const canScore = hasScoringLevels(normalizedProject);
  const projectName = cleanText(
    project.name || project.projectName || normalizedProject.level3 || normalizedProject.level2 || normalizedProject.level1 || "未命名项目"
  );

  return {
    id: String(project.id || makeId()),
    name: projectName,
    system: normalizedProject.system,
    level1: normalizedProject.level1,
    level2: normalizedProject.level2,
    level3: normalizedProject.level3,
    task: cleanText(project.task || project.content || project.taskContent || ""),
    cadence: project.cadence === "weekly" || project.type === "weekly" ? "weekly" : "daily",
    completionCoefficient: numberOr(project.completionCoefficient, numberOr(project.completionCoeff, 1)),
    qualityCoefficient: numberOr(project.qualityCoefficient, numberOr(project.qualityCoeff, 1)),
    enabled: project.enabled !== false && canScore,
    showToday: project.showToday !== false && canScore,
    levelRules: normalizeLevelRules(project.levelRules, settings.levelRules),
    rewards: normalizeRewards(project.rewards),
    createdAt: project.createdAt || now,
    updatedAt: project.updatedAt || now
  };
}

function normalizeHierarchyParts(project) {
  const level1 = cleanText(project.level1 || project.system || "") || "其他";
  return {
    system: level1,
    level1,
    level2: cleanText(project.level2 || ""),
    level3: cleanText(project.level3 || "")
  };
}

function hasScoringLevels(project) {
  return Boolean(cleanText(project.level1 || "") && cleanText(project.level2 || "") && cleanText(project.level3 || ""));
}

function isScoringProject(project) {
  return hasScoringLevels(project);
}

function normalizeRewards(rewards) {
  const result = {};
  if (rewards && typeof rewards === "object") {
    Object.entries(rewards).forEach(([level, value]) => {
      const key = String(numberOr(level, 0));
      if (key !== "0") result[key] = cleanText(value);
    });
  }
  return result;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || !record.projectId) return null;
  const type = record.type === "weekly" ? "weekly" : "daily";
  const date = validDateKey(record.date) ? record.date : formatDateKey(new Date());
  const periodKey = cleanText(record.periodKey || (type === "weekly" ? getISOWeekKey(new Date(date)) : date));
  const rating = clamp(Math.round(numberOr(record.rating, 0)), 1, 5);

  return {
    id: String(record.id || makeId()),
    projectId: String(record.projectId),
    type,
    date,
    periodKey,
    rating,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

function dedupeRecords(records) {
  const byPeriod = new Map();
  records.forEach((record) => {
    const key = `${record.projectId}:${record.type}:${record.periodKey}`;
    const previous = byPeriod.get(key);
    if (!previous || previous.updatedAt < record.updatedAt) byPeriod.set(key, record);
  });
  return Array.from(byPeriod.values());
}

function saveState(options = {}) {
  if (typeof localStorage === "undefined") return;
  if (!options.skipTouch) state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.localOnly) queueCloudSave();
}

async function initCloudSync() {
  const config = getCloudConfig();
  cloudState.tableName = config.tableName || CLOUD_TABLE_NAME;

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    cloudState.configured = false;
    cloudState.status = "local";
    cloudState.message = "本机保存";
    return;
  }

  cloudState.configured = true;
  if (!globalThis.supabase || typeof globalThis.supabase.createClient !== "function") {
    cloudState.status = "error";
    cloudState.message = "同步组件未加载";
    return;
  }

  try {
    cloudState.client = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storageKey: "combat-power-auth"
      }
    });

    const { data, error } = await cloudState.client.auth.getSession();
    if (error) throw error;

    cloudState.user = data.session?.user || null;
    cloudState.status = cloudState.user ? "syncing" : "signed-out";
    cloudState.message = cloudState.user ? "正在同步" : "请登录";

    cloudState.client.auth.onAuthStateChange((event, session) => {
      const previousUserId = cloudState.user?.id || "";
      cloudState.user = session?.user || null;

      if (event === "SIGNED_IN" && cloudState.user && cloudState.user.id !== previousUserId) {
        syncFromCloud("auth", { render: true, toast: false }).catch((error) => handleCloudError(error, "同步失败"));
      }

      if (event === "SIGNED_OUT") {
        cloudState.status = "signed-out";
        cloudState.message = "请登录";
        render();
      }
    });

    if (cloudState.user) {
      await syncFromCloud("init", { render: false, toast: false });
    }
  } catch (error) {
    handleCloudError(error, "登录状态读取失败");
  }
}

function getCloudConfig() {
  const config = globalThis.COMBAT_CLOUD_CONFIG && typeof globalThis.COMBAT_CLOUD_CONFIG === "object"
    ? globalThis.COMBAT_CLOUD_CONFIG
    : {};
  const supabaseUrl = cleanCloudConfigValue(config.supabaseUrl || config.url || "");
  const supabaseAnonKey = cleanCloudConfigValue(
    config.supabaseAnonKey || config.anonKey || config.publishableKey || config.key || ""
  );
  const tableName = cleanText(config.tableName || CLOUD_TABLE_NAME) || CLOUD_TABLE_NAME;

  return {
    supabaseUrl,
    supabaseAnonKey,
    tableName
  };
}

function cleanCloudConfigValue(value) {
  const text = cleanText(value);
  if (!text || /YOUR_|填入|PASTE_/i.test(text)) return "";
  return text;
}

function shouldShowLogin() {
  return cloudState.configured && !cloudState.user;
}

function queueCloudSave() {
  if (!cloudState.configured || !cloudState.client || !cloudState.user || isApplyingRemoteState) return;
  cloudState.status = "pending";
  cloudState.message = "等待同步";
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    uploadCloudState().catch((error) => handleCloudError(error, "自动同步失败"));
  }, CLOUD_SAVE_DELAY);
}

async function syncFromCloud(source = "manual", options = {}) {
  if (!cloudState.client || !cloudState.user) return false;

  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  cloudState.status = "syncing";
  cloudState.message = "正在同步";
  let synced = false;

  try {
    const { data, error } = await cloudState.client
      .from(cloudState.tableName)
      .select("data, updated_at")
      .eq("user_id", cloudState.user.id)
      .maybeSingle();

    if (error) throw error;

    if (data && data.data) {
      const remoteState = normalizeState(data.data);
      const remoteTimestamp = Math.max(getStateTimestamp(remoteState), Date.parse(data.updated_at) || 0);
      const localTimestamp = getStateTimestamp(state);
      const localShouldWin = hasMeaningfulUserData(state) && localTimestamp > remoteTimestamp + 1000;

      if (localShouldWin) {
        await uploadCloudState({ skipStatus: true });
        cloudState.message = source === "manual" ? "已上传本机数据" : "已同步本机数据";
      } else {
        isApplyingRemoteState = true;
        state = remoteState;
        saveState({ localOnly: true, skipTouch: true });
        isApplyingRemoteState = false;
        cloudState.message = "已同步云端数据";
      }
    } else {
      await uploadCloudState({ skipStatus: true });
      cloudState.message = "已创建云端数据";
    }

    cloudState.status = "synced";
    cloudState.lastSyncedAt = new Date().toISOString();
    synced = true;
    if (options.toast !== false) showToast("同步完成");
  } catch (error) {
    isApplyingRemoteState = false;
    handleCloudError(error, "同步失败");
  } finally {
    if (options.render !== false) render();
  }

  return synced;
}

async function uploadCloudState(options = {}) {
  if (!cloudState.client || !cloudState.user || isApplyingRemoteState) return;

  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  const now = new Date().toISOString();
  if (!state.updatedAt) state.updatedAt = now;

  if (!options.skipStatus) {
    cloudState.status = "syncing";
    cloudState.message = "正在上传";
  }

  const payload = JSON.parse(JSON.stringify(state));
  const { error } = await cloudState.client.from(cloudState.tableName).upsert(
    {
      user_id: cloudState.user.id,
      data: payload,
      updated_at: now
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;

  cloudState.status = "synced";
  cloudState.message = "已同步";
  cloudState.lastSyncedAt = now;
}

function handleCloudError(error, fallbackMessage) {
  console.error(error);
  cloudState.status = "error";
  cloudState.message = error && error.message ? `${fallbackMessage}：${error.message}` : fallbackMessage;
  if (refs.view) showToast(fallbackMessage);
}

async function handleLoginSubmit(event) {
  const form = event.target;
  const mode = event.submitter?.dataset.authMode || "signin";
  const account = cleanText(new FormData(form).get("account"));
  const password = String(new FormData(form).get("password") || "");
  const submitter = event.submitter;

  if (!cloudState.client) {
    showToast("云同步未配置");
    return;
  }

  if (!account || !password) {
    showToast("请输入账号和密码");
    return;
  }

  if (password.length < 6) {
    showToast("密码至少 6 位");
    return;
  }

  if (submitter) {
    submitter.disabled = true;
    submitter.textContent = mode === "signup" ? "创建中..." : "登录中...";
  }

  try {
    const email = accountToAuthEmail(account);
    const result = mode === "signup"
      ? await cloudState.client.auth.signUp({
          email,
          password,
          options: {
            data: {
              account
            }
          }
        })
      : await cloudState.client.auth.signInWithPassword({
          email,
          password
        });

    if (result.error) throw result.error;

    cloudState.user = result.data.user || result.data.session?.user || cloudState.user;
    if (cloudState.user) {
      const synced = await syncFromCloud("login", { render: false, toast: false });
      render();
      showToast(synced ? (mode === "signup" ? "账号已创建" : "登录成功") : "已登录，但同步失败");
    } else {
      render();
      showToast("账号已创建，请确认后登录");
    }
  } catch (error) {
    handleCloudError(error, mode === "signup" ? "创建账号失败" : "登录失败");
    render();
  }
}

async function handleCloudLogout() {
  if (!cloudState.client) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;

  try {
    const { error } = await cloudState.client.auth.signOut();
    if (error) throw error;
    cloudState.user = null;
    cloudState.status = "signed-out";
    cloudState.message = "请登录";
    render();
    showToast("已退出登录");
  } catch (error) {
    handleCloudError(error, "退出失败");
  }
}

function accountToAuthEmail(account) {
  const text = cleanText(account).toLowerCase();
  if (text.includes("@")) return text;

  const slug = Array.from(text)
    .map((char) => (/^[a-z0-9._-]$/.test(char) ? char : `u${char.codePointAt(0).toString(36)}`))
    .join("")
    .replace(/\.+/g, ".")
    .slice(0, 64);

  return `${slug || "user"}@combat.local`;
}

function getCloudUserLabel() {
  if (!cloudState.user) return "未登录";
  const account = cloudState.user.user_metadata?.account;
  if (account) return account;
  return String(cloudState.user.email || "").replace(/@combat\.local$/i, "") || "已登录";
}

function getStateTimestamp(candidate) {
  const input = candidate && typeof candidate === "object" ? candidate : {};
  const timestamps = [input.updatedAt]
    .concat((input.projects || []).map((project) => project.updatedAt))
    .concat((input.records || []).map((record) => record.updatedAt))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);

  return timestamps.length ? Math.max(...timestamps) : 0;
}

function hasMeaningfulUserData(candidate) {
  return getStateFingerprint(candidate) !== getStateFingerprint(createEmptyState());
}

function getStateFingerprint(candidate) {
  const input = candidate && typeof candidate === "object" ? candidate : {};
  return JSON.stringify({
    projects: (input.projects || [])
      .map((project) => ({
        id: project.id,
        name: project.name,
        level1: project.level1,
        level2: project.level2,
        level3: project.level3,
        task: project.task,
        cadence: project.cadence,
        completionCoefficient: Number(project.completionCoefficient),
        enabled: project.enabled !== false,
        showToday: project.showToday !== false,
        rewards: project.rewards || {}
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    records: (input.records || [])
      .map((record) => ({
        projectId: record.projectId,
        type: record.type,
        date: record.date,
        periodKey: record.periodKey,
        rating: Number(record.rating)
      }))
      .sort((a, b) => `${a.projectId}:${a.periodKey}`.localeCompare(`${b.projectId}:${b.periodKey}`)),
    settings: input.settings || {},
    deletedProjectIds: (input.deletedProjectIds || []).slice().sort()
  });
}

function render() {
  if (!refs.view) return;
  if (shouldShowLogin()) {
    refs.routeTitle.textContent = "登录";
    refs.todayLabel.textContent = "云同步";
    document.querySelector(".bottom-nav")?.classList.add("is-hidden");
    refs.view.innerHTML = renderLogin();
    return;
  }

  document.querySelector(".bottom-nav")?.classList.remove("is-hidden");
  refs.routeTitle.textContent = ROUTES[currentRoute] || "战斗力";
  refs.todayLabel.textContent = formatDateLabel(new Date());

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === currentRoute);
  });

  const renderers = {
    dashboard: renderDashboard,
    today: renderToday,
    projects: renderProjects,
    growth: renderGrowth,
    settings: renderSettings
  };

  refs.view.innerHTML = (renderers[currentRoute] || renderDashboard)();
}

function renderLogin() {
  const errorMarkup = cloudState.status === "error"
    ? `<div class="sync-alert">${escapeHtml(cloudState.message)}</div>`
    : "";

  return `
    <section class="auth-shell">
      <div class="auth-panel">
        <div class="weapon-mark auth-mark">⚔</div>
        <p class="eyebrow">Cloud Sync</p>
        <h2 class="auth-title">账号登录</h2>
        <p class="auth-copy">同一个账号会同步项目、打星记录、等级和设置。</p>
        ${errorMarkup}
        <form id="loginForm" class="auth-form">
          <label>账号
            <input name="account" autocomplete="username" maxlength="80" required placeholder="输入账号或邮箱">
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="至少 6 位">
          </label>
          <div class="two-col">
            <button class="primary-btn" type="submit" data-auth-mode="signin">登录</button>
            <button class="ghost-btn" type="submit" data-auth-mode="signup">创建账号</button>
          </div>
        </form>
        <p class="project-path auth-note">登录后会保持状态，之后打开页面会自动进入。</p>
      </div>
    </section>
  `;
}

function renderDashboard() {
  const stats = getAllStats();

  if (!state.projects.length) {
    return `
      <section class="hero-panel">
        <div class="hero-content">
          <div class="weapon-mark">⚔</div>
          <p class="power-number">0</p>
          <p class="hero-label">总战斗力</p>
          <button class="primary-btn" type="button" data-action="add-project">新增第一个项目</button>
        </div>
      </section>
      ${emptyState("先建立一个项目", "例如：身体 / 运动 / 跑步 / 每天跑步30分钟。")}
    `;
  }

  return `
    <section class="hero-panel">
      <div class="hero-content">
        <div class="weapon-mark">⚔</div>
        <p class="power-number">${formatNumber(stats.totalPower)}</p>
        <p class="hero-label">总战斗力</p>
        <div class="stats-row">
          <span class="metric-chip">基础战斗力 <strong>${formatNumber(stats.basePower)}</strong></span>
          <span class="metric-chip">综合倍率 <strong>×${trimNumber(stats.multiplier)}</strong></span>
          <span class="metric-chip">等级总和 <strong>${formatNumber(stats.levelSum)}</strong></span>
          <span class="metric-chip">一级 <strong>${stats.systems.length}</strong></span>
        </div>
      </div>
    </section>

    <div class="section-head">
      <h2>一级成长树</h2>
      <p>点分类展开</p>
    </div>
    <section class="tree-panel dashboard-tree">
      ${renderProjectTree(stats.projectStats, "dashboard")}
    </section>
  `;
}

function renderSystemBand(system) {
  return `
    <article class="system-band">
      <div class="inline-row">
        <div>
          <h3 class="project-title">${escapeHtml(system.name)}</h3>
          <p class="project-path">Lv${system.levelInfo.current.level} · ${system.projects.length} 个项目</p>
        </div>
        <div class="system-score">${formatNumber(system.score)}</div>
      </div>
      <div class="bar" aria-label="一级等级进度">
        <span style="--value:${system.levelInfo.progressPercent}%"></span>
      </div>
      <div class="inline-row muted">
        <span>${system.levelInfo.next ? `距离Lv${system.levelInfo.next.level}` : "已达最高等级"}</span>
        <span>${system.levelInfo.next ? `${formatNumber(system.levelInfo.remaining)}战斗力` : "满级"}</span>
      </div>
    </article>
  `;
}

function renderToday() {
  const visibleProjects = state.projects.filter((project) => isScoringProject(project) && project.enabled && project.showToday);
  const groups = groupProjectsBySystem(visibleProjects);

  if (!visibleProjects.length) {
    return `
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="project-title">今日任务</h2>
            <p class="project-path">${formatDateLabel(new Date())}</p>
          </div>
          <button class="primary-btn" type="button" data-action="add-project">新增项目</button>
        </div>
      </section>
      ${emptyState("今日没有项目", "先在项目页添加三级项目，并打开“今日显示”。")}
    `;
  }

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="project-title">今日任务</h2>
          <p class="project-path">${formatDateLabel(new Date())} · 自动保存</p>
        </div>
        <span class="chip warn">${visibleProjects.length} 项</span>
      </div>
    </section>
    ${Object.entries(groups)
      .map(
        ([system, projects]) => `
          <section class="today-group">
            <h2 class="group-title">${escapeHtml(system)}</h2>
            ${projects.map(renderTodayCard).join("")}
          </section>
        `
      )
      .join("")}
  `;
}

function renderTodayCard(project) {
  const current = getCurrentRecord(project);
  const rating = current ? current.rating : 0;
  const stats = calculateProjectStats(project);
  const status = current
    ? project.cadence === "weekly"
      ? `本周已完成 ${stars(rating)}`
      : stars(rating)
    : "未完成";

  return `
    <article class="today-card">
      <div class="project-top">
        <div>
          <h3 class="project-title">${escapeHtml(project.name)}</h3>
          <p class="project-path">${escapeHtml(project.task || getProjectPath(project))}</p>
        </div>
        <span class="chip ${project.cadence === "weekly" ? "warn" : "good"}">${project.cadence === "weekly" ? "周" : "日"}</span>
      </div>
      <div class="inline-row">
        <span class="muted">${escapeHtml(status)}</span>
        <span class="muted">Lv${stats.levelInfo.current.level} · ${formatNumber(stats.score)}战斗力</span>
      </div>
      <div class="rating-row" aria-label="${escapeAttr(project.name)}星级">
        <button class="unfinished-btn ${rating ? "" : "is-active"}" type="button" data-action="clear-current" data-project-id="${escapeAttr(project.id)}">未完成</button>
        ${[1, 2, 3, 4, 5]
          .map(
            (value) => `
              <button class="star-btn ${rating === value ? "is-active" : ""}" type="button" data-action="set-rating" data-project-id="${escapeAttr(project.id)}" data-rating="${value}" data-rating-size="${value}" aria-label="${value}星">${stars(value)}</button>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderProjects() {
  const stats = getAllStats();
  const sorted = stats.projectStats.sort((a, b) => {
    if (a.project.enabled !== b.project.enabled) return a.project.enabled ? -1 : 1;
    return getLevelOneName(a.project).localeCompare(getLevelOneName(b.project), "zh-CN") || a.project.name.localeCompare(b.project.name, "zh-CN");
  });

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="project-title">项目配置</h2>
          <p class="project-path">按一级项目树维护，每个节点一行</p>
        </div>
        <button class="primary-btn" type="button" data-action="add-project">新增</button>
      </div>
    </section>
    <section class="tree-panel">
      ${
        sorted.length
          ? renderProjectTree(sorted)
          : emptyState("还没有项目", "新增一个项目后，今日页会自动出现。")
      }
    </section>
  `;
}

function renderProjectTree(projectStats, mode = "config") {
  const systems = buildProjectTree(projectStats);
  return systems.map((system, index) => renderTreeNode(system, 0, index === systems.length - 1, mode)).join("");
}

function buildProjectTree(projectStats) {
  const systems = new Map();

  projectStats.forEach((item) => {
    const project = item.project;
    const systemName = getLevelOneName(project);
    if (!systems.has(systemName)) {
      systems.set(
        systemName,
        createTreeNode(systemName, "folder", `level1:${systemName}`, {
          system: systemName,
          level1: systemName,
          level2: "",
          level3: ""
        })
      );
    }

    const root = systems.get(systemName);
    const entries = getProjectTreeEntries(project);
    let cursor = root;
    if (isScoringProject(project)) addTreeStats(cursor, item);

    entries.forEach((entry) => {
      cursor = getOrCreateTreeChild(cursor, entry);
      if (isScoringProject(project)) addTreeStats(cursor, item);
      if (entry.isProject) {
        cursor.type = "project";
        cursor.item = item;
      }
    });
  });

  return Array.from(systems.values()).sort((a, b) => compareSystemNames(a.label, b.label));
}

function createTreeNode(label, type, key, context) {
  return {
    key,
    label,
    type,
    children: [],
    childMap: new Map(),
    item: null,
    context,
    score: 0,
    completedCount: 0,
    projectCount: 0
  };
}

function getOrCreateTreeChild(parent, entry) {
  const childKey = `${parent.key}/${entry.label}`;
  if (!parent.childMap.has(childKey)) {
    const child = createTreeNode(entry.label, entry.isProject ? "project" : "folder", childKey, entry.context);
    parent.childMap.set(childKey, child);
    parent.children.push(child);
  }

  const child = parent.childMap.get(childKey);
  child.context = entry.context;
  return child;
}

function addTreeStats(node, item) {
  node.score += item.score;
  node.completedCount += item.completedCount;
  node.projectCount += 1;
}

function getProjectTreeEntries(project) {
  const level1 = getLevelOneName(project);
  const context = {
    system: level1,
    level1,
    level2: "",
    level3: ""
  };
  const entries = [];

  [project.level2, project.level3].forEach((levelName, index) => {
    const clean = cleanText(levelName);
    if (!clean) return;
    context[`level${index + 2}`] = clean;
    if (entries.length && entries[entries.length - 1].label === clean) return;
    entries.push({
      label: clean,
      context: { ...context },
      isProject: false
    });
  });

  const projectName = cleanText(project.name) || context.level3 || context.level2 || context.level1 || "未命名项目";
  const canScore = isScoringProject(project);
  if (entries.length && entries[entries.length - 1].label === projectName) {
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      context: { ...context },
      isProject: canScore
    };
    return entries;
  }

  entries.push({
    label: projectName,
    context: { ...context },
    isProject: canScore
  });

  return entries;
}

function renderTreeNode(node, depth, isLast, mode) {
  const sortedChildren = node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.label.localeCompare(b.label, "zh-CN");
  });
  const hasChildren = sortedChildren.length > 0;
  const collapsed = hasChildren && isTreeNodeCollapsed(node.key, mode);
  const childMarkup = hasChildren && !collapsed
    ? sortedChildren.map((child, index) => renderTreeNode(child, depth + 1, index === sortedChildren.length - 1, mode)).join("")
    : "";

  if (node.type === "project" && node.item) {
    return renderTreeProjectRow(node, depth, mode, hasChildren, collapsed) + childMarkup;
  }

  return renderTreeFolderRow(node, depth, mode, hasChildren, collapsed) + childMarkup;
}

function renderTreeFolderRow(node, depth, mode, hasChildren, collapsed) {
  const contextAttrs = renderContextAttrs(node.context);
  const canAdd = canAddChild(node.context);
  const showsPower = depth === 0;
  const metric = showsPower ? `${formatNumber(node.score)}战斗力` : `${node.projectCount}项`;
  const meta = showsPower ? `一级战斗力 · 完成${node.completedCount}次` : `分类 · ${node.projectCount}项`;

  return `
    <div class="tree-row is-folder depth-${depth}" style="--depth:${depth}">
      <button class="tree-expander ${hasChildren ? "" : "is-empty"}" type="button" data-action="toggle-node" data-node-key="${escapeAttr(node.key)}" data-tree-mode="${escapeAttr(mode)}" aria-label="${collapsed ? "展开" : "收起"}${escapeAttr(node.label)}">${hasChildren ? (collapsed ? "›" : "⌄") : ""}</button>
      <button class="tree-node-main tree-folder-button" type="button" data-action="toggle-node" data-node-key="${escapeAttr(node.key)}" data-tree-mode="${escapeAttr(mode)}">
        <span class="tree-label">${escapeHtml(node.label)}</span>
        <span class="tree-meta">${meta}</span>
      </button>
      <span class="tree-status ${showsPower ? "warn" : "neutral"}">${metric}</span>
      ${mode === "config" ? `<div class="tree-actions">${canAdd ? renderAddChildButton(node.label, contextAttrs) : ""}</div>` : ""}
    </div>
  `;
}

function renderTreeProjectRow(node, depth, mode, hasChildren, collapsed) {
  const { project, completedCount, score, levelInfo } = node.item;
  const contextAttrs = renderContextAttrs(node.context);
  const mainAction = mode === "dashboard" ? "open-detail" : "edit-project";
  const canAdd = canAddChild(node.context);
  const canScore = isScoringProject(project);
  const status = !canScore ? "分类" : mode === "dashboard" ? `${formatNumber(score)}战斗力` : project.enabled ? (project.showToday ? "今日" : "隐藏") : "停用";
  const statusClass = !canScore ? "neutral" : mode === "dashboard" ? "warn" : project.enabled ? (project.showToday ? "good" : "warn") : "off";

  return `
    <div class="tree-row is-project ${project.enabled ? "" : "is-disabled"} depth-${depth}" style="--depth:${depth}">
      <button class="tree-expander ${hasChildren ? "" : "is-empty"}" type="button" data-action="toggle-node" data-node-key="${escapeAttr(node.key)}" data-tree-mode="${escapeAttr(mode)}" aria-label="${collapsed ? "展开" : "收起"}${escapeAttr(node.label)}">${hasChildren ? (collapsed ? "›" : "⌄") : ""}</button>
      <button class="tree-node-main tree-project-button" type="button" data-action="${canScore ? mainAction : "edit-project"}" data-project-id="${escapeAttr(project.id)}">
        <span class="tree-label">${escapeHtml(node.label)}</span>
        <span class="tree-meta">${canScore ? `${project.cadence === "weekly" ? "周" : "日"} · Lv${levelInfo.current.level} · ${completedCount}${project.cadence === "weekly" ? "周" : "天"} · ${formatNumber(score)}战斗力` : "未满三级 · 不计战斗力"}</span>
      </button>
      <span class="tree-status ${statusClass}">${status}</span>
      ${mode === "config" ? `<div class="tree-actions">
        ${canAdd ? renderAddChildButton(project.name, contextAttrs) : ""}
        ${canScore ? `
          <button class="tree-icon-btn" type="button" data-action="open-detail" data-project-id="${escapeAttr(project.id)}" title="历史" aria-label="${escapeAttr(project.name)}历史">史</button>
          <button class="tree-icon-btn" type="button" data-action="toggle-today" data-project-id="${escapeAttr(project.id)}" title="${project.showToday ? "今日隐藏" : "今日显示"}" aria-label="${escapeAttr(project.name)}${project.showToday ? "今日隐藏" : "今日显示"}">${project.showToday ? "藏" : "显"}</button>
          <button class="tree-icon-btn ${project.enabled ? "danger" : ""}" type="button" data-action="toggle-enabled" data-project-id="${escapeAttr(project.id)}" title="${project.enabled ? "停用" : "启用"}" aria-label="${escapeAttr(project.name)}${project.enabled ? "停用" : "启用"}">${project.enabled ? "停" : "启"}</button>
        ` : ""}
      </div>` : ""}
    </div>
  `;
}

function renderContextAttrs(context) {
  return `
    data-system="${escapeAttr(context.system || "")}"
    data-level1="${escapeAttr(context.level1 || "")}"
    data-level2="${escapeAttr(context.level2 || "")}"
    data-level3="${escapeAttr(context.level3 || "")}"
  `;
}

function renderAddChildButton(label, contextAttrs) {
  return `<button class="tree-icon-btn add" type="button" data-action="add-child" ${contextAttrs} title="新增下级" aria-label="在${escapeAttr(label)}下新增">+</button>`;
}

function canAddChild(context) {
  return Boolean(context && !cleanText(context.level3));
}

function renderProjectCard(item, context) {
  const { project, completedCount, starScoreSum, score, levelInfo, nextReward } = item;
  const disabledClass = project.enabled ? "" : "is-disabled";
  const reward = levelInfo.next && nextReward ? `<p class="task-text">奖励：${escapeHtml(nextReward)}</p>` : "";
  const path = getProjectPath(project);

  return `
    <article class="project-card ${disabledClass}">
      <div class="project-top">
        <div>
          <h3 class="project-title">${escapeHtml(project.name)}</h3>
          <p class="project-path">${escapeHtml(path)}</p>
        </div>
        <span class="chip ${project.enabled ? "good" : "off"}">${project.enabled ? "启用" : "停用"}</span>
      </div>
      ${project.task ? `<p class="task-text">${escapeHtml(project.task)}</p>` : ""}
      <div class="chips">
        ${context === "projects" ? renderHierarchyChips(project) : ""}
        <span class="chip ${project.cadence === "weekly" ? "warn" : "good"}">${project.cadence === "weekly" ? "周项目" : "日项目"}</span>
        <span class="chip ${project.showToday ? "good" : "off"}">${project.showToday ? "今日显示" : "今日隐藏"}</span>
        <span class="chip">星级战斗力 ${formatNumber(starScoreSum)}</span>
      </div>
      <div class="mini-stats">
        <div class="mini-stat"><b>${completedCount}</b><span>完成次数</span></div>
        <div class="mini-stat"><b>Lv${levelInfo.current.level}</b><span>等级</span></div>
        <div class="mini-stat"><b>${formatNumber(score)}</b><span>战斗力</span></div>
      </div>
      <div class="bar"><span style="--value:${levelInfo.progressPercent}%"></span></div>
      <div class="inline-row muted">
        <span>${levelInfo.next ? `距离Lv${levelInfo.next.level}` : "已达最高等级"}</span>
        <span>${levelInfo.next ? `${formatNumber(levelInfo.remaining)}战斗力` : "满级"}</span>
      </div>
      ${reward}
      <div class="actions">
        <button class="tiny-btn" type="button" data-action="open-detail" data-project-id="${escapeAttr(project.id)}">历史</button>
        ${
          context === "projects"
            ? `
              <button class="tiny-btn" type="button" data-action="edit-project" data-project-id="${escapeAttr(project.id)}">编辑</button>
              <button class="tiny-btn" type="button" data-action="toggle-today" data-project-id="${escapeAttr(project.id)}">${project.showToday ? "隐藏今日" : "显示今日"}</button>
              <button class="${project.enabled ? "danger-btn" : "ghost-btn"}" type="button" data-action="toggle-enabled" data-project-id="${escapeAttr(project.id)}">${project.enabled ? "停用" : "启用"}</button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderGrowth() {
  const stats = getAllStats();
  const systems = stats.systems.filter((system) => system.projects.length);

  if (!systems.length) {
    return emptyState("还没有成长数据", "新增项目并完成打星后，这里会按一级项目展示等级。");
  }

  return systems
    .map((system) => {
      const projects = system.projects.sort((a, b) => b.score - a.score);
      return `
        <section class="system-band">
          <div class="inline-row">
            <div>
              <h2 class="project-title">${escapeHtml(system.name)}</h2>
              <p class="project-path">一级战斗力 ${formatNumber(system.score)} · Lv${system.levelInfo.current.level}</p>
            </div>
            <span class="chip warn">${projects.length} 项</span>
          </div>
          ${projects.map((item) => renderGrowthRow(item)).join("")}
        </section>
      `;
    })
    .join("");
}

function renderGrowthRow(item) {
  const { project, completedCount, score, levelInfo, nextReward } = item;
  return `
    <article class="card">
      <div class="project-top">
        <div>
          <h3 class="project-title">${escapeHtml(project.name)}</h3>
          <p class="project-path">Lv${levelInfo.current.level} · 完成：${completedCount}${project.cadence === "weekly" ? "周" : "天"} · 战斗力：${formatNumber(score)}</p>
        </div>
        <button class="tiny-btn" type="button" data-action="open-detail" data-project-id="${escapeAttr(project.id)}">历史</button>
      </div>
      <div class="bar"><span style="--value:${levelInfo.progressPercent}%"></span></div>
      <div class="inline-row muted">
        <span>${levelInfo.next ? `距离Lv${levelInfo.next.level}` : "已达最高等级"}</span>
        <span>${levelInfo.next ? `${formatNumber(levelInfo.remaining)}战斗力` : "满级"}</span>
      </div>
      ${levelInfo.next && nextReward ? `<p class="task-text">奖励：${escapeHtml(nextReward)}</p>` : ""}
    </article>
  `;
}

function renderSettings() {
  const settings = state.settings;
  return `
    <form id="settingsForm" class="settings-grid">
      ${renderCloudSettingsPanel()}
      <section class="settings-panel">
        <div class="card-header">
          <div>
            <h2 class="project-title">星级战斗力</h2>
            <p class="project-path">默认 0.9 到 1.3，用于质量战斗力计算</p>
          </div>
        </div>
        <div class="form-grid">
          ${[1, 2, 3, 4, 5]
            .map(
              (rating) => `
                <label>${stars(rating)}
                  <input type="number" inputmode="decimal" min="0" step="0.1" name="star-${rating}" value="${escapeAttr(settings.starScores[rating - 1])}">
                </label>
              `
            )
            .join("")}
        </div>
      </section>

      <section class="settings-panel">
        <div class="card-header">
          <div>
            <h2 class="project-title">默认等级要求</h2>
            <p class="project-path">按稳定执行约两年达到 Lv10 规划</p>
          </div>
        </div>
        <div class="form-grid two-col">
          ${settings.levelRules
            .slice()
            .sort((a, b) => a.level - b.level)
            .map(
              (rule) => `
                <label>Lv${rule.level}
                  <input type="number" inputmode="numeric" min="0" step="1" name="default-level-${rule.level}" value="${escapeAttr(rule.score)}">
                </label>
              `
            )
            .join("")}
        </div>
      </section>

      <section class="settings-panel">
        <div class="card-header">
          <div>
            <h2 class="project-title">综合能力倍率</h2>
            <p class="project-path">所有三级项目等级相加达到后生效</p>
          </div>
          <button class="tiny-btn" type="button" data-action="add-multiplier">新增</button>
        </div>
        <div class="form-grid" id="multiplierRules">
          ${settings.multiplierRules
            .map(
              (rule, index) => `
                <div class="multiplier-row" data-multiplier-row>
                  <label>等级总和达到
                    <input type="number" inputmode="numeric" min="1" step="1" name="multi-level-sum" value="${escapeAttr(rule.levelSum)}">
                  </label>
                  <label>倍率
                    <input type="number" inputmode="decimal" min="1" step="0.01" name="multi-value" value="${escapeAttr(rule.multiplier)}">
                  </label>
                  <button class="tiny-btn" type="button" data-action="delete-multiplier" data-index="${index}">删除</button>
                </div>
              `
            )
            .join("")}
        </div>
      </section>

      <section class="settings-panel">
        <div class="card-header">
          <div>
            <h2 class="project-title">数据备份</h2>
            <p class="project-path">${state.projects.length} 个项目 · ${state.records.length} 条记录</p>
          </div>
        </div>
        <div class="form-grid">
          <button class="ghost-btn" type="button" data-action="export-data">导出数据</button>
          <button class="ghost-btn" type="button" data-action="import-data">导入数据</button>
          <button class="primary-btn" type="submit">保存设置</button>
        </div>
      </section>
    </form>
  `;
}

function renderCloudSettingsPanel() {
  const statusClass = {
    synced: "good",
    syncing: "warn",
    pending: "warn",
    error: "off",
    "signed-out": "off",
    local: "neutral"
  }[cloudState.status] || "neutral";
  const lastSynced = cloudState.lastSyncedAt ? formatTimeLabel(cloudState.lastSyncedAt) : "未同步";

  if (!cloudState.configured) {
    return `
      <section class="settings-panel">
        <div class="card-header">
          <div>
            <h2 class="project-title">账号同步</h2>
            <p class="project-path">本机保存 · 云同步未配置</p>
          </div>
          <span class="chip neutral">Local</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="settings-panel">
      <div class="card-header">
        <div>
          <h2 class="project-title">账号同步</h2>
          <p class="project-path">${escapeHtml(getCloudUserLabel())} · ${escapeHtml(cloudState.message)}</p>
        </div>
        <span class="chip ${statusClass}">${cloudState.status === "synced" ? "已同步" : "同步"}</span>
      </div>
      <div class="cloud-status-grid">
        <div class="mini-stat"><b>${escapeHtml(lastSynced)}</b><span>最近同步</span></div>
        <div class="mini-stat"><b>${state.records.length}</b><span>记录</span></div>
      </div>
      <div class="actions">
        <button class="ghost-btn" type="button" data-action="manual-sync">立即同步</button>
        <button class="danger-btn" type="button" data-action="logout">退出登录</button>
      </div>
    </section>
  `;
}

function handleViewClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, projectId, rating, index, nodeKey, treeMode } = button.dataset;

  if (action === "add-project") openProjectForm();
  if (action === "add-child") openProjectForm("", getPresetFromDataset(button.dataset));
  if (action === "toggle-node") toggleTreeNode(nodeKey, treeMode);
  if (action === "edit-project") openProjectForm(projectId);
  if (action === "open-detail") openProjectDetail(projectId);
  if (action === "toggle-enabled") toggleProjectEnabled(projectId);
  if (action === "toggle-today") toggleProjectToday(projectId);
  if (action === "set-rating") setCurrentRating(projectId, Number(rating));
  if (action === "clear-current") clearCurrentRating(projectId);
  if (action === "export-data") exportData();
  if (action === "import-data") refs.importFile.click();
  if (action === "add-multiplier") addMultiplierRule();
  if (action === "delete-multiplier") deleteMultiplierRule(Number(index));
  if (action === "manual-sync") syncFromCloud("manual", { render: true });
  if (action === "logout") handleCloudLogout();
}

function getPresetFromDataset(dataset) {
  return {
    system: cleanText(dataset.system),
    level1: cleanText(dataset.level1),
    level2: cleanText(dataset.level2),
    level3: cleanText(dataset.level3)
  };
}

function toggleTreeNode(nodeKey, mode) {
  if (!nodeKey) return;
  const key = getCollapseKey(nodeKey, mode || currentRoute);
  uiState.collapsed[key] = !uiState.collapsed[key];
  saveUiState();
  render();
}

function isTreeNodeCollapsed(nodeKey, mode) {
  return Boolean(uiState.collapsed[getCollapseKey(nodeKey, mode || currentRoute)]);
}

function getCollapseKey(nodeKey, mode) {
  return `${mode}:${nodeKey}`;
}

function handleViewSubmit(event) {
  if (event.target.id === "loginForm") {
    event.preventDefault();
    handleLoginSubmit(event);
    return;
  }

  if (event.target.id !== "settingsForm") return;
  event.preventDefault();
  saveSettingsFromForm(event.target);
}

function handleModalClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, recordId, rating, projectId } = button.dataset;

  if (action === "close-modal") closeModal();
  if (action === "history-rating") updateHistoryRating(recordId, Number(rating));
  if (action === "delete-record") deleteRecord(recordId);
  if (action === "edit-project") openProjectForm(projectId);
  if (action === "delete-project") deleteProject(projectId);
}

function handleModalSubmit(event) {
  if (event.target.id !== "projectForm") return;
  event.preventDefault();
  saveProjectFromForm(event.target);
}

function openProjectForm(projectId, preset = null) {
  const existing = state.projects.find((project) => project.id === projectId);
  const lockedPreset = !existing && preset && preset.system;
  const childLevel = lockedPreset ? getNextChildLevel(preset) : null;
  const childLevelLabel = childLevel ? getLevelLabel(childLevel) : "项目";
  const project =
    existing ||
    {
      id: "",
      name: "",
      system: preset?.system || "",
      level1: preset?.level1 || "",
      level2: preset?.level2 || "",
      level3: preset?.level3 || "",
      task: "",
      cadence: "daily",
      completionCoefficient: 1,
      qualityCoefficient: 1,
      enabled: true,
      showToday: true,
      levelRules: cloneRules(state.settings.levelRules),
      rewards: {}
    };

  const title = existing ? "编辑项目" : lockedPreset ? `新增${childLevelLabel}` : "新增项目";
  const hierarchyFields = lockedPreset ? renderLockedHierarchyFields(project) : renderEditableHierarchyFields(project);
  const scoringHint = lockedPreset
    ? getChildScoringHint(project, childLevel)
    : "必须有一级、二级、三级；未满三级只作为分类，不进今日，不计战斗力";
  const qualityHint = getQualityHint(existing || project);
  refs.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-header">
          <h2 class="modal-title">${title}</h2>
          <button class="close-btn" type="button" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        <form id="projectForm" class="form-grid" data-project-id="${existing ? escapeAttr(existing.id) : ""}" data-preset-child="${lockedPreset ? "1" : "0"}">
          ${lockedPreset ? `<div class="path-lock"><span>添加到</span><strong>${escapeHtml(formatPresetPath(project))}</strong></div>` : ""}
          <div class="path-lock">
            <span>计分规则</span>
            <strong>${escapeHtml(scoringHint)}</strong>
          </div>
          <label>${escapeHtml(lockedPreset ? childLevelLabel : "项目名称")}
            <input name="name" required maxlength="40" value="${escapeAttr(project.name)}" placeholder="${escapeAttr(lockedPreset ? getChildPlaceholder(childLevel) : "跑步")}">
          </label>
          ${hierarchyFields}
          <label>具体任务内容
            <textarea name="task" maxlength="160" placeholder="每天跑步30分钟">${escapeHtml(project.task)}</textarea>
          </label>
          <div class="two-col">
            <label>类型
              <select name="cadence">
                <option value="daily" ${project.cadence === "daily" ? "selected" : ""}>日项目</option>
                <option value="weekly" ${project.cadence === "weekly" ? "selected" : ""}>周项目</option>
              </select>
            </label>
            <label>完成系数
              <input name="completionCoefficient" type="number" inputmode="decimal" min="0" step="0.1" value="${escapeAttr(project.completionCoefficient)}">
            </label>
          </div>
          <div class="path-lock">
            <span>质量系数</span>
            <strong>${escapeHtml(qualityHint)}</strong>
          </div>
          <label class="switch-row">是否启用
            <input name="enabled" type="checkbox" ${project.enabled ? "checked" : ""}>
          </label>
          <label class="switch-row">是否今日显示
            <input name="showToday" type="checkbox" ${project.showToday ? "checked" : ""}>
          </label>

          <details>
            <summary>等级规则</summary>
            <div class="form-grid two-col">
              ${project.levelRules
                .slice()
                .sort((a, b) => a.level - b.level)
                .map(
                  (rule) => `
                    <label>Lv${rule.level}
                      <input name="level-${rule.level}" type="number" inputmode="numeric" min="0" step="1" value="${escapeAttr(rule.score)}">
                    </label>
                  `
                )
                .join("")}
            </div>
          </details>

          <details>
            <summary>升级奖励</summary>
            <div class="form-grid">
              ${[2, 3, 4, 5, 6, 7, 8, 9, 10]
                .map(
                  (level) => `
                    <label>Lv${level} 奖励
                      <input name="reward-${level}" maxlength="80" value="${escapeAttr(project.rewards[String(level)] || "")}" placeholder="例如：买一双新跑鞋">
                    </label>
                  `
                )
                .join("")}
            </div>
          </details>

          <div class="actions form-actions">
            <button class="primary-btn" type="submit">保存项目</button>
            ${existing ? `<button class="danger-btn" type="button" data-action="delete-project" data-project-id="${escapeAttr(existing.id)}">删除项目</button>` : ""}
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderLockedHierarchyFields(project) {
  const level1 = getLevelOneName(project);
  return `
    <input type="hidden" name="system" value="${escapeAttr(level1)}">
    <input type="hidden" name="level1" value="${escapeAttr(level1)}">
    <input type="hidden" name="level2" value="${escapeAttr(project.level2)}">
    <input type="hidden" name="level3" value="${escapeAttr(project.level3)}">
  `;
}

function getNextChildLevel(context) {
  if (!context) return null;
  if (!cleanText(context.level1)) return 1;
  if (!cleanText(context.level2)) return 2;
  if (!cleanText(context.level3)) return 3;
  return null;
}

function getLevelLabel(level) {
  return {
    1: "一级项目",
    2: "二级项目",
    3: "三级项目"
  }[level] || "项目";
}

function getChildPlaceholder(level) {
  return {
    1: "例如：表达",
    2: "例如：口才",
    3: "例如：10分钟表达训练"
  }[level] || "例如：跑步";
}

function getChildScoringHint(project, childLevel) {
  if (childLevel === 3) return "保存后就是三级项目，可进入今日，并计算战斗力";
  if (childLevel === 2) return "保存后是二级分类；继续添加三级项目后才计战斗力";
  if (childLevel === 1) return "保存后是一级分类；补齐二级、三级后才计战斗力";
  return "三级项目下面不能再添加下级";
}

function normalizeManualHierarchy(formData) {
  const rawName = cleanText(formData.get("name"));
  let level1 = cleanText(formData.get("level1"));
  let level2 = cleanText(formData.get("level2"));
  let level3 = cleanText(formData.get("level3"));

  if (!level1) level1 = rawName || level3 || level2 || "其他";
  if (!level3 && level2 && rawName && rawName !== level2) level3 = rawName;
  if (level3 && rawName) level3 = rawName;

  const name = rawName || level3 || level2 || level1 || "未命名项目";
  return {
    name,
    system: level1,
    level1,
    level2,
    level3
  };
}

function renderEditableHierarchyFields(project) {
  const level1 = getLevelOneName(project);
  return `
    <div class="two-col">
      <label>一级项目
        <input name="level1" required maxlength="40" value="${escapeAttr(level1 === "其他" && !project.level1 && !project.system ? "" : level1)}" placeholder="身体">
      </label>
      <label>二级项目
        <input name="level2" maxlength="40" value="${escapeAttr(project.level2)}" placeholder="有氧">
      </label>
    </div>
    <label>三级项目
      <input name="level3" maxlength="40" value="${escapeAttr(project.level3)}" placeholder="跑步">
    </label>
  `;
}

function formatPresetPath(project) {
  const parts = [
    ["一级", getLevelOneName(project)],
    ["二级", project.level2],
    ["三级", project.level3]
  ];

  return parts
    .filter(([, value]) => cleanText(value))
    .filter(([, value], index, list) => index === 0 || value !== list[index - 1][1])
    .map(([label, value]) => `${label}：${value}`)
    .join(" / ");
}

function deriveChildHierarchy(formData) {
  const name = cleanText(formData.get("name")) || "未命名项目";
  const hierarchy = normalizeHierarchyParts({
    level1: cleanText(formData.get("level1")),
    level2: cleanText(formData.get("level2")),
    level3: cleanText(formData.get("level3"))
  });
  const childLevel = getNextChildLevel(hierarchy);

  if (childLevel === 1) {
    hierarchy.level1 = name;
  } else if (childLevel === 2) {
    hierarchy.level2 = name;
  } else if (childLevel === 3) {
    hierarchy.level3 = name;
  }

  return {
    ...normalizeHierarchyParts(hierarchy),
    ...hierarchy,
    system: hierarchy.level1,
    name
  };
}

function openProjectDetail(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  activeDetailProjectId = projectId;

  const stats = calculateProjectStats(project);
  const records = getProjectRecords(project.id).sort(compareRecordsDesc);

  refs.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-label="${escapeAttr(project.name)}历史">
        <div class="modal-header">
          <div>
            <h2 class="modal-title">${escapeHtml(project.name)}</h2>
            <p class="project-path">${escapeHtml(getProjectPath(project))}</p>
          </div>
          <button class="close-btn" type="button" data-action="close-modal" aria-label="关闭">×</button>
        </div>

        <div class="form-grid">
          <div class="mini-stats">
            <div class="mini-stat"><b>${stats.completedCount}</b><span>完成次数</span></div>
            <div class="mini-stat"><b>Lv${stats.levelInfo.current.level}</b><span>等级</span></div>
            <div class="mini-stat"><b>${formatNumber(stats.score)}</b><span>战斗力</span></div>
          </div>
          <div class="bar"><span style="--value:${stats.levelInfo.progressPercent}%"></span></div>
          <div class="inline-row muted">
            <span>${stats.levelInfo.next ? `距离Lv${stats.levelInfo.next.level}` : "已达最高等级"}</span>
            <span>${stats.levelInfo.next ? `${formatNumber(stats.levelInfo.remaining)}战斗力` : "满级"}</span>
          </div>
          ${stats.levelInfo.next && stats.nextReward ? `<p class="task-text">奖励：${escapeHtml(stats.nextReward)}</p>` : ""}
          <div class="actions">
            <button class="tiny-btn" type="button" data-action="edit-project" data-project-id="${escapeAttr(project.id)}">修改名字</button>
            <button class="danger-btn tiny-btn" type="button" data-action="delete-project" data-project-id="${escapeAttr(project.id)}">删除项目</button>
          </div>
        </div>

        <div class="section-head">
          <h2>历史记录</h2>
          <p>${records.length} 条</p>
        </div>
        <section class="history-list">
          ${
            records.length
              ? records.map(renderHistoryRecord).join("")
              : emptyState("还没有记录", "在今日页打星后，会出现在这里。")
          }
        </section>
      </section>
    </div>
  `;
}

function renderHistoryRecord(record) {
  return `
    <article class="record-line">
      <div>
        <h3 class="project-title">${escapeHtml(recordLabel(record))}</h3>
        <p class="project-path">${record.type === "weekly" ? "周项目" : "日项目"} · ${stars(record.rating)}</p>
      </div>
      <div class="record-actions">
        <div class="record-stars">
          ${[1, 2, 3, 4, 5]
            .map(
              (value) => `
                <button class="star-btn ${record.rating === value ? "is-active" : ""}" type="button" data-action="history-rating" data-record-id="${escapeAttr(record.id)}" data-rating="${value}" data-rating-size="${value}" aria-label="${value}星">${stars(value)}</button>
              `
            )
            .join("")}
        </div>
        <button class="danger-btn tiny-btn" type="button" data-action="delete-record" data-record-id="${escapeAttr(record.id)}">删除</button>
      </div>
    </article>
  `;
}

function saveProjectFromForm(form) {
  const formData = new FormData(form);
  const projectId = form.dataset.projectId || makeId();
  const existing = state.projects.find((project) => project.id === projectId);
  const now = new Date().toISOString();
  const levelRules = state.settings.levelRules.map((rule) => ({
    level: rule.level,
    score: Math.max(0, numberOr(formData.get(`level-${rule.level}`), rule.score))
  }));
  const rewards = {};

  [2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((level) => {
    const reward = cleanText(formData.get(`reward-${level}`));
    if (reward) rewards[String(level)] = reward;
  });

  const hierarchy = form.dataset.presetChild === "1"
    ? deriveChildHierarchy(formData)
    : normalizeManualHierarchy(formData);

  const project = {
    id: projectId,
    name: hierarchy.name,
    system: hierarchy.level1,
    level1: hierarchy.level1,
    level2: hierarchy.level2,
    level3: hierarchy.level3,
    task: cleanText(formData.get("task")) || hierarchy.name,
    cadence: formData.get("cadence") === "weekly" ? "weekly" : "daily",
    completionCoefficient: Math.max(0, numberOr(formData.get("completionCoefficient"), 1)),
    qualityCoefficient: 1,
    enabled: formData.get("enabled") === "on" && hasScoringLevels(hierarchy),
    showToday: formData.get("showToday") === "on" && hasScoringLevels(hierarchy),
    levelRules: normalizeLevelRules(levelRules, state.settings.levelRules),
    rewards,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };

  if (existing) {
    state.projects = state.projects.map((item) => (item.id === projectId ? project : item));
  } else {
    state.projects.push(project);
  }

  saveState();
  closeModal();
  render();
  showToast("项目已保存");
}

function saveSettingsFromForm(form) {
  const formData = new FormData(form);
  const starScores = [1, 2, 3, 4, 5].map((rating) => Math.max(0, numberOr(formData.get(`star-${rating}`), rating)));
  const levelRules = state.settings.levelRules.map((rule) => ({
    level: rule.level,
    score: Math.max(0, numberOr(formData.get(`default-level-${rule.level}`), rule.score))
  }));
  const multiplierRules = Array.from(form.querySelectorAll("[data-multiplier-row]"))
    .map((row) => ({
      levelSum: Math.max(1, numberOr(row.querySelector("[name='multi-level-sum']").value, 1)),
      multiplier: Math.max(1, numberOr(row.querySelector("[name='multi-value']").value, 1))
    }))
    .sort((a, b) => a.levelSum - b.levelSum);

  state.settings = {
    starScores,
    levelRules: normalizeLevelRules(levelRules, DEFAULT_LEVEL_RULES),
    multiplierRules: normalizeMultiplierRules(multiplierRules)
  };

  saveState();
  render();
  showToast("设置已保存");
}

function toggleProjectEnabled(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  if (!isScoringProject(project)) {
    project.enabled = false;
    project.showToday = false;
    saveState();
    render();
    showToast("补齐三级项目后才能启用");
    return;
  }
  project.enabled = !project.enabled;
  project.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast(project.enabled ? "项目已启用" : "项目已停用");
}

function toggleProjectToday(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  if (!isScoringProject(project)) {
    project.enabled = false;
    project.showToday = false;
    saveState();
    render();
    showToast("补齐三级项目后才能今日显示");
    return;
  }
  project.showToday = !project.showToday;
  project.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast(project.showToday ? "今日已显示" : "今日已隐藏");
}

function deleteProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const confirmed =
    typeof window === "undefined" ||
    window.confirm(`确定删除「${project.name}」吗？这个项目的历史记录也会一起删除。`);
  if (!confirmed) return;

  state.projects = state.projects.filter((item) => item.id !== projectId);
  state.records = state.records.filter((record) => record.projectId !== projectId);
  if (!Array.isArray(state.deletedProjectIds)) state.deletedProjectIds = [];
  if (!state.deletedProjectIds.includes(projectId)) state.deletedProjectIds.push(projectId);
  if (activeDetailProjectId === projectId) activeDetailProjectId = null;

  saveState();
  closeModal();
  render();
  showToast("项目已删除");
}

function setCurrentRating(projectId, rating) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || !isScoringProject(project)) return;
  const period = currentPeriodForProject(project);
  const now = new Date().toISOString();
  const existing = state.records.find(
    (record) => record.projectId === projectId && record.type === project.cadence && record.periodKey === period.periodKey
  );

  if (existing) {
    existing.rating = clamp(Math.round(rating), 1, 5);
    existing.updatedAt = now;
  } else {
    state.records.push({
      id: makeId(),
      projectId,
      type: project.cadence,
      date: period.date,
      periodKey: period.periodKey,
      rating: clamp(Math.round(rating), 1, 5),
      createdAt: now,
      updatedAt: now
    });
  }

  saveState();
  render();
}

function clearCurrentRating(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const period = currentPeriodForProject(project);
  const before = state.records.length;
  state.records = state.records.filter(
    (record) => !(record.projectId === projectId && record.type === project.cadence && record.periodKey === period.periodKey)
  );
  if (state.records.length !== before) {
    saveState();
    render();
    showToast("今日记录已清除");
  }
}

function updateHistoryRating(recordId, rating) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  record.rating = clamp(Math.round(rating), 1, 5);
  record.updatedAt = new Date().toISOString();
  saveState();
  render();
  if (activeDetailProjectId) openProjectDetail(activeDetailProjectId);
}

function deleteRecord(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  state.records = state.records.filter((item) => item.id !== recordId);
  saveState();
  render();
  if (record) openProjectDetail(record.projectId);
  showToast("记录已删除");
}

function addMultiplierRule() {
  state.settings.multiplierRules.push({ levelSum: 1, multiplier: 1 });
  render();
}

function deleteMultiplierRule(index) {
  state.settings.multiplierRules.splice(index, 1);
  if (!state.settings.multiplierRules.length) state.settings.multiplierRules.push({ levelSum: 1, multiplier: 1 });
  saveState();
  render();
}

function exportData() {
  const payload = {
    ...state,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `combat-power-backup-${formatDateKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("JSON 已导出");
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = normalizeState(JSON.parse(text));
    state = imported;
    saveState();
    closeModal();
    render();
    showToast("数据已导入");
  } catch (error) {
    console.error(error);
    showToast("导入失败，请检查 JSON 文件");
  } finally {
    event.target.value = "";
  }
}

function getAllStats() {
  const projectStats = state.projects.map((project) => calculateProjectStats(project));
  const scoringProjectStats = projectStats.filter((item) => isScoringProject(item.project));
  const systemsMap = new Map();

  projectStats.forEach((item) => {
    const systemName = getLevelOneName(item.project);
    if (!systemsMap.has(systemName)) {
      systemsMap.set(systemName, {
        name: systemName,
        score: 0,
        projects: []
      });
    }
  });

  scoringProjectStats.forEach((item) => {
    const systemName = getLevelOneName(item.project);
    const system = systemsMap.get(systemName);
    system.score += item.score;
    system.projects.push(item);
  });

  const systems = Array.from(systemsMap.values())
    .map((system) => ({
      ...system,
      levelInfo: getLevelInfo(system.score, state.settings.levelRules)
    }))
    .sort((a, b) => b.score - a.score);

  const basePower = systems.reduce((sum, system) => sum + system.score, 0);
  const levelSum = scoringProjectStats.reduce((sum, item) => sum + item.levelInfo.current.level, 0);
  const multiplier = getCombatMultiplier(levelSum);
  const totalPower = Math.round(basePower * multiplier);

  return {
    projectStats,
    scoringProjectStats,
    systems,
    basePower,
    levelSum,
    multiplier,
    totalPower
  };
}

function calculateProjectStats(project, records = state.records, settings = state.settings) {
  if (!isScoringProject(project)) {
    return {
      project,
      records: [],
      completedCount: 0,
      starScoreSum: 0,
      qualityPower: 0,
      score: 0,
      levelInfo: getLevelInfo(0, project.levelRules || settings.levelRules),
      nextReward: ""
    };
  }

  const projectRecords = records.filter((record) => record.projectId === project.id).sort(compareRecordsAsc);
  const completedCount = projectRecords.length;
  const completionPower = completedCount * project.completionCoefficient;
  const starScoreSum = projectRecords.reduce((sum, record) => sum + getStarScore(record.rating, settings), 0);
  const resolvedLevel = getScoreLinkedLevel(completionPower, starScoreSum, project.levelRules || settings.levelRules);
  const qualityMultiplier = getQualityMultiplierForLevel(resolvedLevel);
  const qualityPower = starScoreSum * qualityMultiplier;
  const score = completionPower + qualityPower;
  const levelInfo = getLevelInfo(score, project.levelRules || settings.levelRules);
  const nextReward = levelInfo.next ? project.rewards[String(levelInfo.next.level)] || "" : "";

  return {
    project,
    records: projectRecords,
    completedCount,
    starScoreSum,
    qualityPower,
    qualityMultiplier,
    score,
    levelInfo,
    nextReward
  };
}

function getScoreLinkedLevel(completionPower, starScoreSum, rules) {
  const sorted = normalizeLevelRules(rules, DEFAULT_LEVEL_RULES).sort((a, b) => a.score - b.score || a.level - b.level);
  let current = sorted[0]?.level || 1;

  sorted.forEach((rule) => {
    const scoreAtLevel = completionPower + starScoreSum * getQualityMultiplierForLevel(rule.level);
    if (scoreAtLevel >= rule.score) current = rule.level;
  });

  return current;
}

function getQualityMultiplierForLevel(level) {
  return 1 + Math.max(0, numberOr(level, 1) - 1) * 0.1;
}

function getQualityHint(project) {
  if (!project || !isScoringProject(project)) {
    return "未满三级不计算；三级项目从 Lv1 ×1.0 开始，升级后自动切换";
  }

  const stats = calculateProjectStats(project);
  return `当前 Lv${stats.levelInfo.current.level} ×${trimNumber(stats.qualityMultiplier)}；等级变化后自动重算`;
}

function getCombatMultiplier(levelSum) {
  const eligible = state.settings.multiplierRules
    .filter((rule) => levelSum >= rule.levelSum)
    .sort((a, b) => b.levelSum - a.levelSum || b.multiplier - a.multiplier);
  return eligible.length ? eligible[0].multiplier : 1;
}

function getLevelInfo(score, rules) {
  const sorted = normalizeLevelRules(rules, DEFAULT_LEVEL_RULES).sort((a, b) => a.score - b.score || a.level - b.level);
  let current = sorted[0];

  sorted.forEach((rule) => {
    if (score >= rule.score) current = rule;
  });

  const next = sorted.find((rule) => rule.score > score) || null;
  const remaining = next ? Math.max(0, next.score - score) : 0;
  const progressPercent = next
    ? clamp(Math.round(((score - current.score) / Math.max(1, next.score - current.score)) * 100), 0, 100)
    : 100;

  return {
    current,
    next,
    remaining,
    progressPercent
  };
}

function getStarScore(rating, settings = state.settings) {
  return numberOr(settings.starScores[clamp(Math.round(rating), 1, 5) - 1], rating);
}

function getProjectRecords(projectId) {
  return state.records.filter((record) => record.projectId === projectId);
}

function getCurrentRecord(project) {
  const period = currentPeriodForProject(project);
  return state.records.find(
    (record) => record.projectId === project.id && record.type === project.cadence && record.periodKey === period.periodKey
  );
}

function currentPeriodForProject(project) {
  const today = new Date();
  const date = formatDateKey(today);
  return {
    date,
    periodKey: project.cadence === "weekly" ? getISOWeekKey(today) : date
  };
}

function groupProjectsBySystem(projects) {
  return projects.reduce((groups, project) => {
    const key = getLevelOneName(project);
    if (!groups[key]) groups[key] = [];
    groups[key].push(project);
    return groups;
  }, {});
}

function getProjectPath(project) {
  const parts = [getLevelOneName(project), project.level2, project.level3].filter(Boolean);
  const compact = parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
  return compact.join(" / ") || "其他";
}

function renderHierarchyChips(project) {
  const chips = [
    ["一级", getLevelOneName(project)],
    ["二级", project.level2],
    ["三级", project.level3]
  ];

  return chips
    .filter(([, value]) => value)
    .map(([label, value]) => `<span class="chip">${label} ${escapeHtml(value)}</span>`)
    .join("");
}

function getProjectIdentityKey(project) {
  return [getLevelOneName(project), project.level2, project.level3, project.name]
    .map((part) => cleanText(part).toLowerCase())
    .join("|");
}

function getLevelOneName(project) {
  return cleanText(project?.level1 || project?.system || "") || "其他";
}

function compareSystemNames(a, b) {
  const indexA = SYSTEM_ORDER.indexOf(a);
  const indexB = SYSTEM_ORDER.indexOf(b);
  if (indexA !== -1 || indexB !== -1) {
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  }
  return a.localeCompare(b, "zh-CN");
}

function compareRecordsDesc(a, b) {
  const keyA = a.periodKey || a.date;
  const keyB = b.periodKey || b.date;
  return keyB.localeCompare(keyA);
}

function compareRecordsAsc(a, b) {
  const keyA = a.periodKey || a.date;
  const keyB = b.periodKey || b.date;
  return keyA.localeCompare(keyB);
}

function recordLabel(record) {
  if (record.type === "weekly") return `${record.periodKey} 周`;
  return formatDateShort(record.date);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getISOWeekKey(date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((copy - yearStart) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function formatDateLabel(date) {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

function formatTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未同步";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function formatDateShort(dateKey) {
  if (!validDateKey(dateKey)) return dateKey;
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function formatNumber(value) {
  return Math.round(numberOr(value, 0)).toLocaleString("zh-CN");
}

function trimNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function stars(rating) {
  return "★★★★★".slice(0, clamp(Math.round(numberOr(rating, 0)), 0, 5)) || "未完成";
}

function emptyState(title, body) {
  return `
    <section class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(body)}</p>
    </section>
  `;
}

function closeModal() {
  activeDetailProjectId = null;
  if (refs.modalRoot) refs.modalRoot.innerHTML = "";
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 1700);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.info("Service worker skipped", error));
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

globalThis.CombatPowerTest = {
  createEmptyState,
  normalizeState,
  buildProjectTree,
  renderProjectTree,
  deriveChildHierarchy,
  normalizeManualHierarchy,
  canAddChild,
  getNextChildLevel,
  getLevelOneName,
  getAllStats,
  getCombatMultiplier,
  isScoringProject,
  calculateProjectStats,
  getScoreLinkedLevel,
  getQualityMultiplierForLevel,
  getLevelInfo,
  accountToAuthEmail,
  hasMeaningfulUserData,
  getStateTimestamp,
  getStateFingerprint,
  getISOWeekKey,
  DEFAULT_LEVEL_RULES
};
