export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "hourly_ip" | "daily_site"; retryAfterSeconds: number; error: string };

export interface RateLimiter {
  checkAndRecord(ip: string, now?: number): Promise<RateLimitDecision>;
  reset?(): Promise<void>;
}

export type RateLimiterOptions = {
  hourlyPerIp?: number;
  dailyTotal?: number;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function createMemoryRateLimiter(options?: RateLimiterOptions): RateLimiter {
  const hourlyPerIp = options?.hourlyPerIp ?? (Number(process.env.HOURLY_UPLOAD_LIMIT) || 10);
  const dailyTotal = options?.dailyTotal ?? (Number(process.env.DAILY_UPLOAD_LIMIT) || 50);

  const ipHits = new Map<string, number[]>();
  let siteHits: number[] = [];

  return {
    async checkAndRecord(ip: string, now = Date.now()): Promise<RateLimitDecision> {
      // 1. Check IP hourly window
      const ipTimestamps = (ipHits.get(ip) ?? []).filter((t) => now - t < ONE_HOUR_MS);
      if (ipTimestamps.length >= hourlyPerIp) {
        const oldest = ipTimestamps[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + ONE_HOUR_MS - now) / 1000));
        return {
          allowed: false,
          reason: "hourly_ip",
          retryAfterSeconds,
          error: "That's the limit for this demo. Try again in an hour.",
        };
      }

      // 2. Check site-wide daily window
      siteHits = siteHits.filter((t) => now - t < ONE_DAY_MS);
      if (siteHits.length >= dailyTotal) {
        const oldest = siteHits[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + ONE_DAY_MS - now) / 1000));
        return {
          allowed: false,
          reason: "daily_site",
          retryAfterSeconds,
          error: "The daily upload limit for this demo has been reached. Try again tomorrow or explore the samples.",
        };
      }

      // 3. Record hit
      ipTimestamps.push(now);
      ipHits.set(ip, ipTimestamps);
      siteHits.push(now);

      return {
        allowed: true,
        remaining: Math.max(0, hourlyPerIp - ipTimestamps.length),
      };
    },

    async reset(): Promise<void> {
      ipHits.clear();
      siteHits = [];
    },
  };
}

export const rateLimiter: RateLimiter = createMemoryRateLimiter();
