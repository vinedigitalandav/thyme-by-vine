// @ts-ignore — built server bundle
import * as build from "../build/server";
import { createPagesFunctionHandler } from "@remix-run/cloudflare-pages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onRequest = createPagesFunctionHandler({
  build,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLoadContext: (ctx: any) => ctx.context,
});
