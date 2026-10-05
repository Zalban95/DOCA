// Face concepts: clocks, calendars and the parts of the day. Weak (weak: true): a sentence naming something more
// concrete shows that instead — "tomorrow it rains" is rain.
FACE_CONCEPTS.push(
  { id: 'clock', weak: true, glyph: '🕒', color: '#57c9c2', words: { en: ["o'clock", 'oclock', 'clock', 'clocks', 'hour', 'hours', 'minute', 'minutes', 'midday', 'noon', 'midnight'], it: ['ore', 'orario', 'orari', 'minuto', 'minuti', 'mezzogiorno', 'mezzanotte'] } },
  { id: 'alarm', weak: true, glyph: '⏰', color: '#ffb040', words: { en: ['alarm', 'alarms', 'wake', 'waking', 'wakeup'], it: ['sveglia', 'sveglie', 'svegliarsi', 'svegliami', 'allarme', 'allarmi'] } },
  { id: 'timer', weak: true, glyph: '⏱', color: '#57c9c2', words: { en: ['timer', 'timers', 'stopwatch', 'countdown', 'seconds'], it: ['cronometro', 'secondi'] } },
  { id: 'hourglass', weak: true, glyph: '⌛', color: '#e8c070', words: { en: ['hourglass', 'loading', 'deadline', 'deadlines'], it: ['clessidra', 'attesa', 'aspettando', 'scadenza', 'scadenze'] } },
  { id: 'calendar', weak: true, glyph: '📅', color: '#57c9c2', words: { en: ['calendar', 'calendars', 'date', 'dates', 'schedule', 'scheduled', 'appointment', 'appointments', 'agenda', 'event', 'events'], it: ['calendario', 'calendari', 'appuntamento', 'appuntamenti', 'evento', 'eventi', 'programmato', 'pianificato'] } },
  { id: 'today', weak: true, glyph: '📆', color: '#57c9c2', words: { en: ['today', 'tomorrow', 'yesterday', 'week', 'weeks', 'weekly', 'weekend', 'month', 'months', 'monthly'], it: ['oggi', 'domani', 'ieri', 'settimana', 'settimane', 'mese', 'mesi', 'mensile'] } },
  { id: 'weekday', weak: true, glyph: '🗓', color: '#57c9c2', words: { en: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], it: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi'] } },
  { id: 'year', weak: true, glyph: '⟳', color: '#57c9c2', words: { en: ['year', 'years', 'yearly', 'annual', 'anniversary'], it: ['anno', 'anni', 'annuale', 'anniversario'] } },
  { id: 'sunrise', weak: true, glyph: '🌅', color: '#ff9a50', words: { en: ['sunrise', 'dawn', 'morning', 'mornings', 'daybreak'], it: ['alba', 'mattina', 'mattino', 'mattinata', 'stamattina'] } },
  { id: 'sunset', weak: true, glyph: '🌇', color: '#ff7a50', words: { en: ['sunset', 'dusk', 'evening', 'evenings', 'tonight', 'twilight'], it: ['tramonto', 'sera', 'serata', 'stasera', 'crepuscolo'] } },
  { id: 'night', weak: true, glyph: '🌙', color: '#8a7af0', words: { en: ['night', 'nights', 'nighttime', 'overnight', 'goodnight'], it: ['notte', 'notti', 'stanotte', 'notturno', 'buonanotte'] } },
  { id: 'new-year', weak: true, glyph: '🎆', color: '#ffd060', words: { en: ['fireworks', 'firework', 'newyear'], it: ['capodanno', 'botti'] } },
  { id: 'summer', weak: true, glyph: '🏄', color: '#ffb840', words: { en: ['summer', 'summertime', 'holiday', 'holidays', 'vacation', 'vacations'], it: ['estate', 'estivo', 'estiva', 'vacanza', 'vacanze', 'ferie'] } },
  { id: 'winter', weak: true, glyph: '⛄', color: '#a8dcff', words: { en: ['winter', 'wintertime', 'skiing', 'ski', 'skis'], it: ['inverno', 'invernale', 'sci', 'sciare', 'sciata'] } },
  { id: 'history', weak: true, glyph: '🏛', color: '#d8c8a8', words: { en: ['history', 'historical', 'ancient', 'museum', 'museums', 'rome', 'roman'], it: ['storia', 'storico', 'storica', 'antico', 'antica', 'museo', 'musei', 'roma', 'romano', 'romana'] } },
  { id: 'future', weak: true, glyph: '🔮', color: '#b080f0', words: { en: ['future', 'predict', 'prediction', 'predictions', 'fortune'], it: ['futuro', 'prevedere', 'previsione', 'predizione'] } },
  { id: 'pause', weak: true, glyph: '⏸', color: '#c8c8d8', words: { en: ['pause', 'paused', 'pausing'], it: ['pausa', 'sospeso', 'sospesa', 'interrompere'] } },
  { id: 'play', weak: true, glyph: '▶', color: '#6ad890', words: { en: ['resume', 'resumed'], it: ['riprendi', 'avvia', 'avviato', 'avviata'] } },
  { id: 'rewind', weak: true, glyph: '⏪', color: '#57c9c2', words: { en: ['rewind', 'undo', 'previous', 'revert', 'rollback'], it: ['riavvolgi', 'annulla', 'precedente', 'ripristina', 'ripristinare'] } },
  { id: 'repeat', weak: true, glyph: '🔁', color: '#57c9c2', words: { en: ['repeat', 'repeating', 'loop', 'loops', 'recurring'], it: ['ripeti', 'ripetere', 'ripetizione', 'ciclo', 'ricorrente'] } }
);
