import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";

export async function processorFetch(
  env: Env,
  path: string,
  init: RequestInit
): Promise<Response> {
  const container = getContainer(env.PROCESSOR);
  const url = `http://processor${path.startsWith("/") ? path : `/${path}`}`;
  return container.fetch(url, init);
}
