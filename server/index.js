const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv(filePath) {
  try {
    const raw = fsSync.readFileSync(filePath, "utf-8");
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        if (!key) return;
        const value = line.slice(idx + 1).trim();
        if (typeof process.env[key] === "undefined") {
          process.env[key] = value;
        }
      });
  } catch (_) {
    // optional .env file
  }
}

loadEnv(path.join(__dirname, "..", ".env"));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
const CASES_FILE = path.join(__dirname, "..", "data", "cases.json");
const CONTACT_FILE = path.join(__dirname, "..", "data", "contact.json");
const API_SECRET = process.env.KMCA_API_SECRET || "";

function isAuthorized(req) {
  if (!API_SECRET) return false;
  const headerValue = req.headers["x-kmca-admin"];
  if (typeof headerValue !== "string") return false;
  return headerValue === API_SECRET;
}

function requireAuthorized(req, res) {
  if (!API_SECRET) {
    sendJson(res, 500, {
      success: false,
      error: "서버에 관리자 비밀키가 설정되지 않았습니다.",
    });
    return false;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: "관리자 인증이 필요합니다." });
    return false;
  }
  return true;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function sanitizeContactEntry(entry, options = {}) {
  if (!entry || typeof entry !== "object") return null;
  const includeBody = Boolean(options.includeBody);
  const includeReplies = Boolean(options.includeReplies);
  const {
    passwordHash,
    passwordHint,
    replies = [],
    body = "",
    ...rest
  } = entry;
  const base = {
    ...rest,
    hasReplies: Array.isArray(replies) ? replies.length > 0 : false,
    replyCount: Array.isArray(replies) ? replies.length : 0,
  };
  if (includeBody) {
    base.body = body;
  }
  if (includeReplies) {
    base.replies = Array.isArray(replies) ? replies : [];
  }
  return base;
}

async function ensureDataFile(filePath, fallback = "[]") {
  try {
    await fs.access(filePath);
  } catch (_) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, fallback, "utf-8");
  }
}

async function loadCases() {
  await ensureDataFile(CASES_FILE, "[]");
  try {
    const raw = await fs.readFile(CASES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[cases] read failed, returning empty list:", error);
    return [];
  }
}

async function saveCases(nextCases) {
  await ensureDataFile(CASES_FILE, "[]");
  await fs.writeFile(CASES_FILE, JSON.stringify(nextCases, null, 2), "utf-8");
}

async function loadContactEntries() {
  await ensureDataFile(CONTACT_FILE, "[]");
  try {
    const raw = await fs.readFile(CONTACT_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[contact] read failed, returning empty list:", error);
    return [];
  }
}

async function saveContactEntries(entries) {
  await ensureDataFile(CONTACT_FILE, "[]");
  await fs.writeFile(CONTACT_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-KMCA-Admin",
  });
  res.end(body);
}

function sendText(res, statusCode, text = "") {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-KMCA-Admin",
  });
  res.end(text);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req
      .on("data", (chunk) => {
        chunks.push(chunk);
      })
      .on("end", () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const data = JSON.parse(raw);
          resolve(data);
        } catch (error) {
          reject(error);
        }
      })
      .on("error", reject);
  });
}

function withErrorHandling(handler) {
  return async (req, res, params) => {
    try {
      await handler(req, res, params);
    } catch (error) {
      console.error("[api] unhandled error:", error);
      sendJson(res, 500, { success: false, error: "서버 오류가 발생했습니다." });
    }
  };
}

const routes = [
  {
    method: "GET",
    pattern: /^\/api\/contact\/entries\/?$/,
    handler: withErrorHandling(async (_req, res) => {
      const entries = await loadContactEntries();
      const sanitized = entries
        .map((entry) => sanitizeContactEntry(entry, { includeBody: false }))
        .sort((a, b) => {
          const tA = new Date(a.createdAt || 0).getTime();
          const tB = new Date(b.createdAt || 0).getTime();
          return tB - tA;
        });
      sendJson(res, 200, { success: true, entries: sanitized });
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/contact\/entries\/?$/,
    handler: withErrorHandling(async (req, res) => {
      const body = await readJsonBody(req);
      const categoryValue =
        typeof body.categoryValue === "string" ? body.categoryValue.trim() : "";
      const categoryLabel =
        typeof body.categoryLabel === "string" ? body.categoryLabel.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.body === "string" ? body.body.trim() : "";
      const authorName =
        typeof body.authorName === "string" ? body.authorName.trim() : "익명";
      const password =
        typeof body.password === "string" ? body.password.trim() : "";

      if (!title || !content || !password) {
        sendJson(res, 400, {
          success: false,
          error: "제목, 본문, 비밀번호는 필수 입력 항목입니다.",
        });
        return;
      }

      const now = new Date();
      const entry = {
        id: body.id && typeof body.id === "string" ? body.id : `contact-${Date.now()}`,
        categoryValue: categoryValue || null,
        categoryLabel: categoryLabel || null,
        title,
        body: content,
        authorName,
        passwordHash: hashPassword(password),
        createdAt: now.toISOString(),
        replies: [],
      };

      const entries = await loadContactEntries();
      entries.push(entry);
      await saveContactEntries(entries);

      sendJson(res, 201, {
        success: true,
        entry: sanitizeContactEntry(entry, { includeBody: true, includeReplies: true }),
      });
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/contact\/entries\/([^/]+)\/view\/?$/,
    handler: withErrorHandling(async (req, res, params) => {
      const [, entryId] = params;
      const body = await readJsonBody(req);
      const password =
        typeof body.password === "string" ? body.password.trim() : "";
      if (!password) {
        sendJson(res, 400, {
          success: false,
          error: "비밀번호를 입력해주세요.",
        });
        return;
      }

      const entries = await loadContactEntries();
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) {
        sendJson(res, 404, { success: false, error: "문의 글을 찾을 수 없습니다." });
        return;
      }

      if (hashPassword(password) !== entry.passwordHash) {
        sendJson(res, 401, { success: false, error: "비밀번호가 올바르지 않습니다." });
        return;
      }

      sendJson(res, 200, {
        success: true,
        entry: sanitizeContactEntry(entry, {
          includeBody: true,
          includeReplies: true,
        }),
      });
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/contact\/entries\/([^/]+)\/replies\/?$/,
    handler: withErrorHandling(async (req, res, params) => {
      const [, entryId] = params;
      const body = await readJsonBody(req);
      const password =
        typeof body.password === "string" ? body.password.trim() : "";
      const replyAuthor =
        typeof body.author === "string" ? body.author.trim() : "관리자";
      const replyBody = typeof body.body === "string" ? body.body.trim() : "";

      if (!password || !replyBody) {
        sendJson(res, 400, {
          success: false,
          error: "비밀번호와 답변 내용을 모두 입력해주세요.",
        });
        return;
      }

      const entries = await loadContactEntries();
      const entryIndex = entries.findIndex((item) => item.id === entryId);
      if (entryIndex === -1) {
        sendJson(res, 404, { success: false, error: "문의 글을 찾을 수 없습니다." });
        return;
      }

      const entry = entries[entryIndex];
      if (hashPassword(password) !== entry.passwordHash) {
        sendJson(res, 401, { success: false, error: "비밀번호가 올바르지 않습니다." });
        return;
      }

      const reply = {
        id: `reply-${Date.now()}`,
        author: replyAuthor || "관리자",
        body: replyBody,
        createdAt: new Date().toISOString(),
      };

      entry.replies = Array.isArray(entry.replies) ? entry.replies : [];
      entry.replies.push(reply);
      entries[entryIndex] = entry;
      await saveContactEntries(entries);

      sendJson(res, 200, {
        success: true,
        entry: sanitizeContactEntry(entry, {
          includeBody: true,
          includeReplies: true,
        }),
      });
    }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/contact\/entries\/([^/]+)\/?$/,
    handler: withErrorHandling(async (req, res, params) => {
      const [, entryId] = params;
      const body = await readJsonBody(req);
      const password =
        typeof body.password === "string" ? body.password.trim() : "";

      if (!password) {
        sendJson(res, 400, {
          success: false,
          error: "비밀번호를 입력해주세요.",
        });
        return;
      }

      const entries = await loadContactEntries();
      const entryIndex = entries.findIndex((item) => item.id === entryId);
      if (entryIndex === -1) {
        sendJson(res, 404, { success: false, error: "문의 글을 찾을 수 없습니다." });
        return;
      }

      const entry = entries[entryIndex];
      if (hashPassword(password) !== entry.passwordHash) {
        sendJson(res, 401, { success: false, error: "비밀번호가 올바르지 않습니다." });
        return;
      }

      const nextEntries = [
        ...entries.slice(0, entryIndex),
        ...entries.slice(entryIndex + 1),
      ];
      await saveContactEntries(nextEntries);

      sendJson(res, 200, { success: true });
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/cases\/?$/,
    handler: withErrorHandling(async (_req, res) => {
      const cases = await loadCases();
      // 최신순 정렬 (createdAt 없으면 기본)
      const sorted = [...cases].sort((a, b) => {
        const tA = new Date(a.createdAt || 0).getTime();
        const tB = new Date(b.createdAt || 0).getTime();
        return tB - tA;
      });
      sendJson(res, 200, { success: true, cases: sorted });
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/cases\/([^/]+)\/?$/,
    handler: withErrorHandling(async (_req, res, params) => {
      const [, caseId] = params;
      const cases = await loadCases();
      const found = cases.find((item) => item.id === caseId);
      if (!found) {
        sendJson(res, 404, { success: false, error: "사례를 찾을 수 없습니다." });
        return;
      }
      sendJson(res, 200, { success: true, case: found });
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/cases\/?$/,
    handler: withErrorHandling(async (req, res) => {
      if (!requireAuthorized(req, res)) return;
      const body = await readJsonBody(req);
      const categoryValue =
        typeof body.categoryValue === "string" ? body.categoryValue.trim() : "";
      const categoryLabel =
        typeof body.categoryLabel === "string" ? body.categoryLabel.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.body === "string" ? body.body.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "관리자";

      if (!title || !content) {
        sendJson(res, 400, {
          success: false,
          error: "제목과 본문은 필수 입력 항목입니다.",
        });
        return;
      }

      const now = new Date();
      const entry = {
        id: body.id && typeof body.id === "string" ? body.id : `case-${Date.now()}`,
        categoryValue: categoryValue || null,
        categoryLabel: categoryLabel || null,
        title,
        body: content,
        author: author || "관리자",
        views: 0,
        createdAt: now.toISOString(),
        isDefault: false,
      };

      const cases = await loadCases();
      cases.push(entry);
      await saveCases(cases);
      sendJson(res, 201, { success: true, case: entry });
    }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/cases\/([^/]+)\/?$/,
    handler: withErrorHandling(async (req, res, params) => {
      if (!requireAuthorized(req, res)) return;
      const [, caseId] = params;
      const cases = await loadCases();
      const nextCases = cases.filter((item) => item.id !== caseId);
      if (nextCases.length === cases.length) {
        sendJson(res, 404, { success: false, error: "삭제할 사례가 없습니다." });
        return;
      }
      await saveCases(nextCases);
      sendJson(res, 200, { success: true });
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/cases\/([^/]+)\/views\/?$/,
    handler: withErrorHandling(async (req, res, params) => {
      if (!requireAuthorized(req, res)) return;
      const [, caseId] = params;
      const cases = await loadCases();
      let updatedCase = null;
      const nextCases = cases.map((item) => {
        if (item.id !== caseId) return item;
        const nextViews = Number(item.views || 0) + 1;
        updatedCase = { ...item, views: nextViews };
        return updatedCase;
      });
      if (!updatedCase) {
        sendJson(res, 404, { success: false, error: "사례를 찾을 수 없습니다." });
        return;
      }
      await saveCases(nextCases);
      sendJson(res, 200, { success: true, case: updatedCase });
    }),
  },
];

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendText(res, 204);
    return;
  }

  const match = routes.find(
    (route) => route.method === req.method && route.pattern.test(req.url)
  );

  if (!match) {
    sendJson(res, 404, { success: false, error: "지원하지 않는 경로입니다." });
    return;
  }

  const params = match.pattern.exec(req.url);
  await match.handler(req, res, params);
});

server.listen(PORT, () => {
  console.log(`[kmca] API server listening on http://localhost:${PORT}`);
});
