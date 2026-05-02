const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const DATABASE_URL = process.env.DATABASE_URL || "";

let pgPool = null;
if (DATABASE_URL) {
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });
}

const sampleData = {
  users: [
    { id: "admin-user", username: "admin", password: "admin123", role: "admin", restricted: false },
    { id: "staff-user", username: "staff", password: "staff123", role: "staff", restricted: false },
  ],
  regions: [
    {
      id: "north-region",
      name: "North Region",
      customers: [
        { id: "apex-traders", name: "Apex Traders" },
        { id: "bright-foods", name: "Bright Foods" },
      ],
    },
    {
      id: "south-region",
      name: "South Region",
      customers: [
        { id: "crown-market", name: "Crown Market" },
        { id: "delta-supplies", name: "Delta Supplies" },
      ],
    },
  ],
  transactions: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function normalizeState(data) {
  const normalized = data && typeof data === "object" ? data : {};
  return {
    users: Array.isArray(normalized.users) && normalized.users.length ? normalized.users : sampleData.users,
    regions: Array.isArray(normalized.regions) ? normalized.regions : sampleData.regions,
    transactions: Array.isArray(normalized.transactions) ? normalized.transactions : [],
  };
}

async function initStore() {
  if (!pgPool) {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(sampleData, null, 2));
    }
    const data = normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return;
  }

  await pgPool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await pgPool.query(
    `
      insert into app_state (id, data)
      values ('main', $1::jsonb)
      on conflict (id) do nothing
    `,
    [JSON.stringify(sampleData)],
  );
}

async function loadState() {
  if (!pgPool) {
    await initStore();
    return normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  }

  await initStore();
  const result = await pgPool.query("select data from app_state where id = 'main'");
  return normalizeState(result.rows[0]?.data);
}

async function saveState(data) {
  const normalized = normalizeState(data);
  if (!pgPool) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  await pgPool.query(
    `
      update app_state
      set data = $1::jsonb, updated_at = now()
      where id = 'main'
    `,
    [JSON.stringify(normalized)],
  );
  return normalized;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function readBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 10_000_000) {
        reject(new Error("File too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(body);
}

function mergeData(current, incoming) {
  const result = {
    users: [...(current.users || sampleData.users)],
    regions: [...(current.regions || [])],
    transactions: [...(current.transactions || [])],
  };

  for (const incomingUser of incoming.users || []) {
    const user = result.users.find(
      (item) => item.id === incomingUser.id || item.username.toLowerCase() === incomingUser.username.toLowerCase(),
    );
    if (user) {
      user.username = incomingUser.username;
      user.password = incomingUser.password;
      user.role = incomingUser.role;
      user.restricted = Boolean(incomingUser.restricted);
    } else {
      result.users.push(incomingUser);
    }
  }

  for (const incomingRegion of incoming.regions || []) {
    let region = result.regions.find((item) => item.id === incomingRegion.id);
    if (!region) region = result.regions.find((item) => item.name.toLowerCase() === incomingRegion.name.toLowerCase());
    if (!region) {
      result.regions.push({ ...incomingRegion, customers: incomingRegion.customers || [] });
      continue;
    }
    region.name = incomingRegion.name;
    region.customers = region.customers || [];
    for (const incomingCustomer of incomingRegion.customers || []) {
      const exists = region.customers.some(
        (customer) =>
          customer.id === incomingCustomer.id || customer.name.toLowerCase() === incomingCustomer.name.toLowerCase(),
      );
      if (!exists) region.customers.push(incomingCustomer);
    }
  }

  for (const transaction of incoming.transactions || []) {
    if (!result.transactions.some((item) => item.id === transaction.id)) result.transactions.push(transaction);
  }

  return result;
}

function parseMultipart(buffer, contentType) {
  const boundary =
    /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)?.[1] ||
    /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)?.[2];
  if (!boundary) throw new Error("Missing upload boundary");
  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`).filter((part) => part.includes("Content-Disposition"));
  const result = {};
  for (const part of parts) {
    const splitIndex = part.indexOf("\r\n\r\n");
    if (splitIndex === -1) continue;
    const header = part.slice(0, splitIndex);
    let body = part.slice(splitIndex + 4);
    body = body.replace(/\r\n$/, "");
    const name = /name="([^"]+)"/.exec(header)?.[1];
    const filename = /filename="([^"]*)"/.exec(header)?.[1];
    if (!name) continue;
    result[name] = filename ? { filename, buffer: Buffer.from(body, "binary") } : body;
  }
  return result;
}

function unzipEntries(buffer) {
  const zlib = require("zlib");
  const entries = [];
  let index = 0;
  while (index < buffer.length - 4) {
    if (buffer.readUInt32LE(index) !== 0x04034b50) {
      index += 1;
      continue;
    }
    const method = buffer.readUInt16LE(index + 8);
    const compressedSize = buffer.readUInt32LE(index + 18);
    const nameLength = buffer.readUInt16LE(index + 26);
    const extraLength = buffer.readUInt16LE(index + 28);
    const name = buffer.slice(index + 30, index + 30 + nameLength).toString("utf8");
    const start = index + 30 + nameLength + extraLength;
    const compressed = buffer.slice(start, start + compressedSize);
    let content = compressed;
    if (method === 8) content = zlib.inflateRawSync(compressed);
    if (method === 0 || method === 8) entries.push({ name, content: content.toString("utf8") });
    index = start + compressedSize;
  }
  return entries;
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function parseCustomerNamesFromXlsx(buffer) {
  const entries = unzipEntries(buffer);
  const get = (name) => entries.find((entry) => entry.name === name)?.content || "";
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join(""),
  );
  const sheet = entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
  if (!sheet) throw new Error("No worksheet found");
  const values = [...sheet.content.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cell = /<c\s+([^>]*)>([\s\S]*?)<\/c>/.exec(row[1]);
    if (!cell) return "";
    const type = /t="([^"]+)"/.exec(cell[1])?.[1] || "";
    let value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] || "";
    if (type === "s") value = shared[Number(value)] || "";
    return decodeXml(value).trim();
  });
  return values.filter(Boolean).filter((value, index) => index !== 0 || !/customer|cutomer/i.test(value));
}

function serveFile(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }
    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    send(response, 200, content, type);
  });
}

function getNetworkAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
}

function getPublicUrl(request) {
  const proto = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    send(response, 204, "");
    return;
  }

  if (request.url === "/api/health" && request.method === "GET") {
    send(
      response,
      200,
      JSON.stringify({ ok: true, store: pgPool ? "postgres" : "json", time: new Date().toISOString() }),
      "application/json; charset=utf-8",
    );
    return;
  }

  if (request.url === "/api/state" && request.method === "GET") {
    try {
      send(response, 200, JSON.stringify(await loadState()), "application/json; charset=utf-8");
    } catch (error) {
      send(response, 500, JSON.stringify({ ok: false, error: error.message }), "application/json; charset=utf-8");
    }
    return;
  }

  if (request.url === "/api/server-info" && request.method === "GET") {
    const publicUrl = getPublicUrl(request);
    const urls = [publicUrl, `http://localhost:${PORT}`, ...getNetworkAddresses()];
    send(response, 200, JSON.stringify({ urls }), "application/json; charset=utf-8");
    return;
  }

  if (request.url === "/api/state" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.regions) || !Array.isArray(parsed.transactions)) {
        throw new Error("Invalid data shape");
      }
      const merged = mergeData(await loadState(), parsed);
      send(response, 200, JSON.stringify(await saveState(merged)), "application/json; charset=utf-8");
    } catch (error) {
      send(response, 400, JSON.stringify({ ok: false, error: error.message }), "application/json; charset=utf-8");
    }
    return;
  }

  if (request.url === "/api/import-customers" && request.method === "POST") {
    try {
      const parts = parseMultipart(await readBuffer(request), request.headers["content-type"] || "");
      const regionId = String(parts.regionId || "");
      const file = parts.file;
      if (!regionId || !file?.buffer) throw new Error("Select a region and Excel file");
      const names = parseCustomerNamesFromXlsx(file.buffer);
      const data = await loadState();
      const region = data.regions.find((item) => item.id === regionId);
      if (!region) throw new Error("Region not found");
      region.customers = region.customers || [];
      let added = 0;
      for (const name of names) {
        const exists = region.customers.some((customer) => customer.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          region.customers.push({ id: `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, name });
          added += 1;
        }
      }
      send(response, 200, JSON.stringify({ added, state: await saveState(data) }), "application/json; charset=utf-8");
    } catch (error) {
      send(response, 400, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
    return;
  }

  serveFile(request, response);
});

initStore()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`City Tech cloud server running at http://localhost:${PORT}`);
      console.log(`Storage: ${pgPool ? "PostgreSQL" : "local data.json"}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start City Tech cloud server", error);
    process.exit(1);
  });
