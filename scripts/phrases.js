/*
 * Sprechblasen: Standardsätze und ein "Beutel"-Prinzip gegen Wiederholungen.
 * Jeder NSC zieht Sätze aus einem gemischten Beutel, bis er leer ist; erst dann wird neu gemischt.
 * Der zuletzt gesagte Satz kommt nie direkt wieder.
 */

export const POOLS = {
  table: "Am Tisch",
  bar: "An der Theke",
  walk: "Unterwegs (nur Bedienung)",
  idle: "Leerlauf / Herumstehen",
  patrol: "Patrouille",
  blocked: "Weg versperrt"
};

export const DEFAULT_PHRASES = {
  table: [
    "Noch ein Bier?",
    "Darf's noch etwas sein?",
    "Kommt sofort!",
    "Wohl bekomm's!",
    "Der Eintopf ist heute besonders gut.",
    "Noch eine Runde für den Tisch?",
    "Vorsicht, heiß!",
    "Ihr seht hungrig aus.",
    "Die Pastete ist frisch aus dem Ofen.",
    "Soll ich anschreiben?",
    "Das macht zwei Silberstücke.",
    "Lasst es euch schmecken!",
    "Noch einen Krug Wasser dazu?",
    "Ihr seid nicht von hier, oder?",
    "Habt ihr schon vom Wein aus dem Süden probiert?"
  ],
  bar: [
    "Zwei Met, bitte!",
    "Einmal Eintopf, schnell!",
    "Das Fass ist fast leer.",
    "Noch einen Krug Dunkles!",
    "Die am Fenster wollen zahlen.",
    "Haben wir noch Brot?",
    "Wein für die Ecke!",
    "Puh, heute ist was los.",
    "Drei Bier und ein Wasser.",
    "Der Koch soll sich beeilen!"
  ],
  walk: [
    "Entschuldigung, darf ich mal?",
    "Vorsicht, Tablett!",
    "Bin gleich bei euch!",
    "Moment, Moment!",
    "Platz da!",
    "Ich komme ja schon!"
  ],
  idle: [
    "*summt leise ein Lied*",
    "*poliert einen Krug*",
    "*wischt über den Tresen*",
    "Ruhiger Abend heute …",
    "*gähnt*",
    "*zählt ein paar Münzen*",
    "*schaut zur Tür*",
    "*streckt sich*"
  ],
  patrol: [
    "Alles ruhig.",
    "*hält kurz inne und lauscht*",
    "Hmm …",
    "Wer da?",
    "*rückt den Helm zurecht*",
    "Noch drei Stunden bis zur Ablöse.",
    "*gähnt verstohlen*",
    "Nichts Verdächtiges."
  ],
  blocked: [
    "Darf ich mal durch?",
    "Entschuldigung …",
    "Würdet Ihr bitte zur Seite treten?",
    "*räuspert sich*",
    "Aus dem Weg, bitte.",
    "Ich müsste da mal vorbei.",
    "Nach Euch.",
    "Bitte, geht nur vor."
  ]
};

/** Mehrzeiliges Textfeld → Liste von Sätzen */
export function parseLines(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ziehbeutel pro NSC und Satzgruppe */
export class PhraseBag {
  constructor() { this.bags = new Map(); }

  draw(key, list) {
    if (!list.length) return null;
    const sig = list.join("\u0001");
    let bag = this.bags.get(key);
    if (!bag || bag.sig !== sig) bag = { sig, queue: [], last: null };
    if (!bag.queue.length) {
      bag.queue = shuffle(list);
      // Nicht denselben Satz zweimal hintereinander
      if (list.length > 1 && bag.queue[bag.queue.length - 1] === bag.last) {
        bag.queue.unshift(bag.queue.pop());
      }
    }
    const text = bag.queue.pop();
    bag.last = text;
    this.bags.set(key, bag);
    return text;
  }

  clear(prefix) {
    for (const k of [...this.bags.keys()]) if (!prefix || k.startsWith(prefix)) this.bags.delete(k);
  }
}
