-- Idempotent metadata. Re-running does not overwrite operator changes.
-- Secret values are never inserted. These rows name env vars only.

BEGIN;

INSERT INTO settings (key, value)
VALUES
  ('deployment.mode', '"self_host"'::jsonb),
  ('auth.passcode_env', '"BOTANICAL_PASSWORD"'::jsonb),
  ('auth.passcode_alias_env', '"BOTANICAL_PASSCODE"'::jsonb),
  ('auth.passcode_hash_env', '"BOTANICAL_PASSWORD_HASH"'::jsonb),
  ('auth.signup_mode', '"open"'::jsonb),
  ('providers.allow_global_keys', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO secret_refs (logical_name, env_var, provider, description)
VALUES
  (
    'openai',
    'OPENAI_API_KEY',
    'openai',
    'OpenAI API key. Value lives in the server environment, not in this table.'
  ),
  (
    'anthropic',
    'ANTHROPIC_API_KEY',
    'anthropic',
    'Anthropic API key. Value lives in the server environment, not in this table.'
  ),
  (
    'xai',
    'XAI_API_KEY',
    'xai',
    'xAI / Grok API key. Value lives in the server environment, not in this table.'
  ),
  (
    'deepseek',
    'DEEPSEEK_API_KEY',
    'deepseek',
    'DeepSeek API key. Value lives in the server environment, not in this table.'
  ),
  (
    'openrouter',
    'OPENROUTER_API_KEY',
    'openrouter',
    'OpenRouter API key. Value lives in the server environment, not in this table.'
  )
ON CONFLICT (logical_name) DO NOTHING;

COMMENT ON TABLE secret_refs IS
  'Metadata pointing at server env vars. Do not store secret values in Postgres.';
COMMENT ON COLUMN users.password_hash IS
  'Argon2id password hash. Never a raw password. Null means the bootstrap owner has not been claimed by the first signup.';
COMMENT ON COLUMN users.role IS
  'admin or member. The first account to set a password is admin.';
COMMENT ON TABLE secrets IS
  'AES-256-GCM ciphertext of provider and speech keys. user_id null is admin-global. last4 is the only display hint.';
COMMENT ON TABLE invites IS
  'Single-use signup invites. token_hash is SHA-256 of the link token.';
COMMENT ON COLUMN model_profiles.config IS
  'Non-secret model options (temperature, maxTokens, baseUrl, apiKeyEnv). Raw API keys are rejected.';
COMMENT ON TABLE settings IS
  'Instance-level configuration. Auth rows store env var names. deployment.mode is self_host or saas.';
COMMENT ON COLUMN chats.agent_id IS
  'Owning agent. Immutable after insert: one agent per chat.';
COMMENT ON COLUMN chats.profile_id IS
  'Explicit model profile. Botanical has no default profile.';
COMMENT ON TABLE tool_audit IS
  'Append-only tool log. Store redacted args only. Updates and deletes are rejected.';
COMMENT ON TABLE tenants IS
  'Optional SaaS grouping. Self-host users leave users.tenant_id null. No billing data in v0.';

COMMIT;
