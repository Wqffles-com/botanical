import type { LLMProvider, ProfileResolver } from "@botanical/agent-runtime";
import type { RuntimeLLMProvider, RuntimeProfileResolver } from "@botanical/providers";

/** Compile-time check: the provider bridge is a runtime ProfileResolver. */
type Assert<T extends true> = T;

export type RuntimeProviderMatchesAgentRuntime = Assert<RuntimeLLMProvider extends LLMProvider ? true : false>;
export type RuntimeResolverMatchesAgentRuntime = Assert<
  RuntimeProfileResolver extends ProfileResolver ? true : false
>;
