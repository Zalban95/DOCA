'use strict';

/**
 * Server-side limits for the /api/v1 client layer. Every value here is
 * advertised verbatim in GET /api/v1/capabilities (`limits`) so clients can
 * size their behaviour from the server rather than hard-coding numbers.
 */
module.exports = {
  PROTOCOL_VERSION: '1.0',
  PROTOCOL_MIN_CLIENT: '1.0',

  // Payload ceilings (bytes)
  SNAPSHOT_BYTES:   16 * 1024,
  PROMPT_BYTES:     32 * 1024,
  EVENT_BYTES:      32 * 1024,
  IMAGE_BYTES:      200 * 1024,       // server-rendered images
  MEDIA_BYTES:      1536 * 1024,      // device uploads (photos, audio)
  AUDIO_BYTES:      1024 * 1024,
  AUDIO_SEC:        30,
  ARTIFACT_BYTES:   256 * 1024,
  EXT_BYTES:        8 * 1024,         // opaque `ext` objects anywhere
  VARS_BYTES:       16 * 1024,        // per-device variables document
  JSON_BODY_LIMIT:  '2mb',

  // Push channel
  HEARTBEAT_SEC:      25,
  OUTBOX_MAX_EVENTS:  500,
  OUTBOX_MAX_HOURS:   24,
  DEFAULT_EVENT_TTL_SEC: 24 * 3600,

  // Sampling
  SAMPLER_MIN_INTERVAL_SEC: 2,
  SAMPLER_IDLE_STOP_SEC:    60,
  SPARK_MAX_POINTS:         60,
  HISTORY_MAX_POINTS:       720,      // 1 h at 5 s

  // Pairing / tokens
  PAIR_CODE_TTL_SEC:     300,
  TOKEN_ROTATE_GRACE_SEC: 60,

  // Sensors
  SENSOR_MAX_RATE_HZ:      50,
  SENSOR_MAX_DURATION_SEC: 600,
  SENSOR_BATCH_MAX:        500,
  SENSOR_RING_MAX:         2000,

  // Media retention
  MEDIA_TTL_HOURS: 24,

  // Prompts
  PROMPT_DEFAULT_TTL_SEC: 3600,
  PROMPT_MAX_CHOICES:     8,
  PENDING_TIMEOUT_SEC:    90,
};
