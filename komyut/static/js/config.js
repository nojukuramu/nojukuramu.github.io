/* ============================================================
   KomyutApp — where the community's data lives

   The house rule in this repository is "no API keys, and therefore no
   service that needs one", and this file needs a word about why it is not
   a breach of it.

   The rule exists because a *secret* in a public script is a donation. A
   Supabase **anon key** is not a secret: it is the publishable identifier
   every browser session is supposed to carry, it is safe to print on a
   billboard, and on its own it grants nothing at all. What decides who may
   read and write what is Row Level Security, enforced in Postgres, where
   the browser cannot reach it. Every policy this app relies on is written
   out in supabase/schema.sql so it can be read rather than trusted.

   The keys that WOULD be a donation — the service-role key, the database
   password, the JWT secret — are not here, are not in the repository, and
   must never be. If you are pasting a key that starts with the words
   "service_role", stop.

   Nothing else in the app reads these two values directly; they go through
   KM.supa, which is the only module that talks to the network about them.
   ============================================================ */
var KM = KM || {};

KM.config = {
  /* Your project's URL, e.g. "https://abcdefghijklm.supabase.co".
     Leave blank and the app still runs: the map, the route builder and the
     weather all work offline of any account, and every community surface
     says so rather than failing silently. */
  SUPABASE_URL: "",

  /* The publishable anon key (Project Settings -> API -> "anon public").
     NOT the service_role key. */
  SUPABASE_ANON_KEY: "",

  /* Where the map opens when there is nothing else to go on. Manila, because
     that is who this is for first; a phone that grants location is moved to
     it immediately, and the last place you looked is remembered after that. */
  DEFAULT_CENTER: { lat: 14.5995, lon: 120.9842 },
  DEFAULT_ZOOM: 12,

  /* The default country a new route is filed under. Changing it does not
     restrict anything: a route abroad simply carries its own code. */
  DEFAULT_COUNTRY: "PH",
  DEFAULT_CURRENCY: "PHP"
};

/* True once both values above are filled in. Every community feature checks
   this and degrades to read-only-with-an-explanation rather than throwing. */
KM.config.ready = function () {
  return !!(KM.config.SUPABASE_URL && KM.config.SUPABASE_ANON_KEY);
};
