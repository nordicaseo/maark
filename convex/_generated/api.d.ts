/* eslint-disable */
/**
 * Generated `api` utility.
 * Run `npx convex dev` to regenerate.
 */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as tasks from "../tasks.js";
import type * as agents from "../agents.js";

declare const fullApi: ApiFromModules<{
  tasks: typeof tasks;
  agents: typeof agents;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
