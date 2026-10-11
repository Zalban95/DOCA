'use strict';

/**
 * The declaration of prefs `machineBackup` (settings-schema.js reads it from here, beside the code it governs): this
 * machine's own files backed up with restic (machine-backup/). Never proposable: what of a person's files leaves the
 * machine, and where to, is theirs. The password and a remote's keys are not here: they live in keys/machine-backup.json.
 */
module.exports = { is: 'local', home: 'device', on: 'host', note: 'this machine\'s files backed up with restic: where, which folders, when, how many to keep (machine-backup/)',
    keys: {
      enabled:     { type: 'boolean', default: false, hint: 'Back up this machine\'s files every day. Off: nothing runs by itself; Back up now still works once it is set up.' },
      repo:        { type: 'string', default: '', hint: 'Where the backup is kept: a folder (another disk, a NAS mount, a USB disk), or a restic address (s3:…, b2:…, sftp:…, rest:…). Empty: not set up.' },
      folders:     { type: 'array', default: [], hint: 'The folders and files backed up. Empty: the suggested ones for this OS that exist (documents, pictures, projects, settings files…).' },
      exclude:     { type: 'array', default: ['.cache', 'Library/Caches', 'Cache', 'Code Cache', 'GPUCache', 'CachedData', 'node_modules', '.venv', 'venv', '__pycache__', 'build', 'dist', '.Trash', '.local/share/Trash', '$RECYCLE.BIN', 'Downloads', '*.gguf', '*.safetensors', 'huggingface', '*.qcow2', '*.vdi', '*.vmdk', '*.vhd', '*.vhdx'],
        hint: 'What is left out wherever it is found, one pattern per line (restic\'s --exclude): caches, dependency and build folders, the bin, downloads, model weights and VM disks — they are downloaded again or huge.' },
      at:          { type: 'string', default: '03:00', hint: 'The time of day, on this machine\'s clock, when the daily backup runs.' },
      catchUp:     { type: 'boolean', default: true, hint: 'When the day\'s backup was missed (the disk unplugged, the machine off), run it as soon as the destination can be reached again — checked every 10 minutes.' },
      keepDaily:   { type: 'integer', min: 1, max: 366, default: 7, hint: 'How many days back a copy is kept, one a day: 7 is a week of differences at 24 hours apart.' },
      keepWeekly:  { type: 'integer', min: 0, max: 520, default: 0, hint: 'How many weeks back one copy a week is also kept (0: none beyond the daily ones).' },
      keepMonthly: { type: 'integer', min: 0, max: 240, default: 0, hint: 'How many months back one copy a month is also kept (0: none).' },
    } };
