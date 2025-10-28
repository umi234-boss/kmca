const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
const DATA_FILE = path.join(__dirname, "..", "data", "cases.json");

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch (_) {
    const dir = path.dirname(DATA_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(DATA_FILE, "[]", "utf-8");
  }
}

async function loadCases() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[cases] read failed, returning empty list:", error);
    return [];
  }
}

async function saveCases(nextCases) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(nextCases, null, 2), "utf-8");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function sendText(res, statusCode, text = "") {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    handler: withErrorHandling(async (_req, res, params) => {
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
    handler: withErrorHandling(async (_req, res, params) => {
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
