CREATE TABLE IF NOT EXISTS trees (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_node_id TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id),
  parent_id TEXT REFERENCES nodes(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  user_input TEXT,
  ai_response TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  model_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_tree ON nodes(tree_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  kind TEXT NOT NULL,
  anchor_from INTEGER,
  anchor_to INTEGER,
  quoted_text TEXT,
  note TEXT,
  child_node_id TEXT REFERENCES nodes(id),
  visual_target_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_node ON annotations(node_id);

CREATE TABLE IF NOT EXISTS context_segments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_node_id TEXT REFERENCES nodes(id),
  ref_version_no INTEGER,
  content TEXT
);

CREATE INDEX IF NOT EXISTS idx_segments_node ON context_segments(node_id);

CREATE TABLE IF NOT EXISTS node_versions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  version_no INTEGER NOT NULL,
  user_input TEXT,
  ai_response TEXT,
  change_kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_node ON node_versions(node_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_node_no
  ON node_versions(node_id, version_no);

CREATE TABLE IF NOT EXISTS merges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES nodes(id),
  target_node_id TEXT NOT NULL REFERENCES nodes(id),
  conclusion TEXT NOT NULL,
  landing_segment_id TEXT NOT NULL REFERENCES context_segments(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visual_artifacts (
  artifact_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  renderer TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  scene_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_visual_artifacts_latest
  ON visual_artifacts(artifact_id, revision DESC);

CREATE TABLE IF NOT EXISTS document_shares (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  token_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_shares_tree ON document_shares(tree_id);
