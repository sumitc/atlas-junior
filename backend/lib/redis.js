const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export function hasRedis() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

export async function redisCmd(...args) {
  if (!hasRedis()) {
    throw new Error("Redis env vars are missing");
  }

  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

export async function redisPipeline(commands) {
  if (!hasRedis()) {
    throw new Error("Redis env vars are missing");
  }

  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  for (const item of json) {
    if (item.error) throw new Error(item.error);
  }
  return json.map((item) => item.result);
}
