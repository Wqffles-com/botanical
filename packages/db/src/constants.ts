/**
 * Server environment contract.
 * Postgres stores these names in `settings` and `secret_refs`. It does not store the values.
 */
export const ENV = {
  databaseUrl: 'DATABASE_URL',
  deploymentMode: 'DEPLOYMENT_MODE',
  deploymentModeAlias: 'BOTANICAL_DEPLOYMENT_MODE',
  password: 'BOTANICAL_PASSWORD',
  passwordAlias: 'BOTANICAL_PASSCODE',
  passwordHash: 'BOTANICAL_PASSWORD_HASH',
  openaiApiKey: 'OPENAI_API_KEY',
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  xaiApiKey: 'XAI_API_KEY',
  deepseekApiKey: 'DEEPSEEK_API_KEY',
  openrouterApiKey: 'OPENROUTER_API_KEY',
} as const;

/** Lookup order for the self-host passcode. */
export const PASSCODE_ENV_VARS = [ENV.password, ENV.passwordAlias] as const;

export const PASSCODE_HASH_ENV_VAR = ENV.passwordHash;

/** Lookup order for the deployment mode flag. */
export const DEPLOYMENT_MODE_ENV_VARS = [ENV.deploymentMode, ENV.deploymentModeAlias] as const;

export const SETTING_KEYS = {
  deploymentMode: 'deployment.mode',
  authPasscodeEnv: 'auth.passcode_env',
  authPasscodeAliasEnv: 'auth.passcode_alias_env',
  authPasscodeHashEnv: 'auth.passcode_hash_env',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const PROVIDER_SECRET_REFS = [
  {
    logicalName: 'openai',
    envVar: ENV.openaiApiKey,
    provider: 'openai',
    description: 'OpenAI API key. Value lives in the server environment, not in this table.',
  },
  {
    logicalName: 'anthropic',
    envVar: ENV.anthropicApiKey,
    provider: 'anthropic',
    description: 'Anthropic API key. Value lives in the server environment, not in this table.',
  },
  {
    logicalName: 'xai',
    envVar: ENV.xaiApiKey,
    provider: 'xai',
    description: 'xAI / Grok API key. Value lives in the server environment, not in this table.',
  },
  {
    logicalName: 'deepseek',
    envVar: ENV.deepseekApiKey,
    provider: 'deepseek',
    description: 'DeepSeek API key. Value lives in the server environment, not in this table.',
  },
  {
    logicalName: 'openrouter',
    envVar: ENV.openrouterApiKey,
    provider: 'openrouter',
    description: 'OpenRouter API key. Value lives in the server environment, not in this table.',
  },
] as const;
