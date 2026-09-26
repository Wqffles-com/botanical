-- Example agents. Keep ids, names, icons, colors, prompts, and tools aligned
-- with EXAMPLE_AGENTS in packages/core/src/agents.ts.
-- Runs once. A settings flag stops a later migrate from putting the rows back
-- after the operator deletes them.

BEGIN;

COMMENT ON COLUMN agents.icon IS
  'Lucide icon name (PascalCase). Default Bot.';
COMMENT ON COLUMN agents.color IS
  'Agent picker swatch. Default green.';
COMMENT ON COLUMN agents.default_profile_id IS
  'Optional suggested profile id. Chats still require an explicit profile pick.';
COMMENT ON COLUMN agents.name IS
  'Display name, 1-40 characters.';

DO $$
DECLARE
  owner_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM settings WHERE key = 'seed.example_agents') THEN
    RETURN;
  END IF;

  INSERT INTO settings (key, value)
  VALUES ('seed.example_agents', 'true'::jsonb);

  SELECT id INTO owner_id FROM users ORDER BY created_at, id LIMIT 1;
  IF owner_id IS NULL THEN
    INSERT INTO users (id, display_name)
    VALUES ('00000000-0000-4000-8000-000000000001', 'Owner')
    RETURNING id INTO owner_id;
  END IF;

  INSERT INTO agents (
    id, user_id, name, description, prompt, tools, icon, color, default_profile_id
  )
  VALUES
    (
      '11111111-1111-4111-8111-111111111111',
      owner_id,
      'Gardener',
      'Tends the plots and keeps everyday work in order.',
      'You are Gardener. Help with plans, notes, and everyday tasks. Be precise and calm. Use tools when they add facts. The user picks the model profile for each chat.',
      '[{"name":"web_search","enabled":true},{"name":"web_fetch","enabled":true}]'::jsonb,
      'Sprout',
      'green',
      NULL
    ),
    (
      '22222222-2222-4222-8222-222222222222',
      owner_id,
      'Builder',
      'Writes and repairs code.',
      'You are Builder, a software agent. Prefer working code over essays. Read files before editing them. Ask before destructive commands.',
      '[{"name":"shell","enabled":true},{"name":"code_exec","enabled":true},{"name":"file_read","enabled":true},{"name":"file_write","enabled":true},{"name":"file_list","enabled":true}]'::jsonb,
      'Code',
      'blue',
      NULL
    ),
    (
      '33333333-3333-4333-8333-333333333333',
      owner_id,
      'Scout',
      'Searches, fetches, and cites.',
      'You are Scout. Search and fetch before answering. Cite what you found and say what is still unknown.',
      '[{"name":"web_search","enabled":true},{"name":"web_fetch","enabled":true}]'::jsonb,
      'Search',
      'amber',
      NULL
    );
END $$;

COMMIT;
