# Ascandir - DnD5e NPC Behavior Automation

Foundry VTT v13/v14 · dnd5e 5.x/6.x · eingestellt wird nur vom SL

Belebt deine Szenen: Eine Bedienung geht von besetztem Tisch zu besetztem Tisch und zurück zur Theke, eine Wache läuft ihre Runde, Gäste schlendern umher – und alle sagen dabei abwechslungsreiche Sätze in Sprechblasen.

## Installation

Manifest-URL in Foundry (Module installieren):

```
https://github.com/Ascandir/Ascandir---DnD5e-NPC-Behavior-Automation/releases/latest/download/module.json
```

## Schnellstart: belebte Taverne

Pro Tisch legst du **zwei Regionen** an (Werkzeug **Regionen** links):

| Region | Was du ziehst | Beispielname |
|---|---|---|
| **Tischfläche** | genau über die Tischplatte | „Tisch 1 – Platte“ |
| **Sitzbereich** | um Tisch *und* Stühle herum, ruhig ein Feld großzügiger | „Tisch 1 – Sitzplätze“ |

1. Für jeden Tisch Tischfläche und Sitzbereich ziehen.
2. **Theke markieren:** eine Region „Theke“ ziehen – dort, wo die Bedienung ihre Bestellungen abholt. Den Tresen selbst kannst du zusätzlich als Tischfläche markieren.
3. **Bedienung einstellen:** Rechtsklick auf den Token der Bedienung → Knopf mit dem laufenden Männchen (🚶).
   - Verhalten aktiv: ✔
   - Verhalten: **Bedienung**
   - **Hindernisse:** alle Tischflächen ankreuzen
   - **Sitzbereiche:** alle Sitzbereiche ankreuzen
   - Theke auswählen → **Speichern**
4. Fertig. Setzt sich ein Spieler (oder ein Gäste-NSC) in einen Sitzbereich, kommt die Bedienung, stellt sich auf ein freies Feld **neben** die Gäste, wartet ein bisschen, geht zur Theke und weiter.

**Hindernisse** werden nie betreten – auch nicht im Vorbeigehen. Sie gelten für **alle** NSCs der Szene: Hakst du die Tischflächen bei der Bedienung an, laufen auch Wachen und Gäste nicht mehr über die Tische.

Ein Sitzbereich ist **besetzt**, sobald ein sichtbarer Token darin steht. NSCs, die selbst gerade laufen (Bedienung, Patrouille, Umherschlendern), zählen nicht als Gäste. NSCs mit „Stehen & Reden“ zählen als Gäste.

## Verhalten

| Verhalten | Was passiert |
|---|---|
| **Bedienung** | Geht zu besetzten Tischen (der am längsten nicht besuchte zuerst), wartet, geht meist zur Theke, dann zum nächsten Tisch. Sind alle Tische leer, wartet sie an der Theke. |
| **Patrouille** | Läuft einen gezeichneten Weg ab – als Rundgang oder hin und zurück. Wartet an jedem Punkt kurz, ab und zu länger. |
| **Umherschlendern** | Geht in einer Region zu zufälligen freien Stellen und bleibt dort eine Weile. Gut für Gäste, Händler, Kinder auf dem Marktplatz. |
| **Stehen & Reden** | Bleibt stehen und sagt ab und zu etwas. Gut für den Wirt hinter der Theke. |

## Wege finden

**Automatisch (Standard):** Der NSC sucht selbst einen Weg um Wände herum. Muss er in einen anderen Raum, nimmt er die nächste Tür oder Lücke. **Verschlossene** Türen benutzt er nie, Geheimtüren nur, wenn du es in den Moduleinstellungen erlaubst.

**Türen:** Jeder NSC öffnet Türen, die nicht verschlossen sind. Pro NSC stellst du ein, ob er sie wieder schließt:
- **Türen hinter sich schließen ✔ (Standard):** Er bleibt vor der Tür stehen, öffnet sie, tritt hindurch, schließt sie hinter sich und läuft weiter. Steht gerade jemand anderes im Durchgang, wartet die Tür, bis der Weg frei ist.
- **ohne Haken:** Er öffnet die Tür, geht hindurch und lässt sie offen.

**Anderen Token ausweichen** (Haken pro NSC, Standard an): Der NSC weicht nur Token aus, die er **sehen** kann. Wer hinter einer geschlossenen Tür steht, ist ihm unbekannt:
1. Er geht zur Tür und öffnet sie.
2. Steht jemand im Türrahmen, tritt er **einen Schritt zurück** und macht Platz, damit der andere durchkommt.
3. Gibt es einen anderen Weg, nimmt er ihn. Sonst wartet er, bis der Durchgang frei ist, geht hindurch und schließt die Tür hinter sich.

Steht jemand mitten im Raum im Weg, geht er außen herum oder wartet davor. Bleibt der Weg sehr lange versperrt (ca. 30 Sekunden), lässt er das Ziel aus. **Haken aus** für fliegende oder geisterhafte Wesen: Sie ziehen einfach über bzw. durch andere Token hinweg.

**Gezeichnete Wege (optional):** Du kannst Wege selbst vorgeben:

1. Werkzeug **Zeichnungen** → **Polygon** (oder Freihand) und den Weg Punkt für Punkt durch die Szene klicken.
2. Tipp: In der Zeichnung unter **Text** einen Namen eintragen (z. B. „Küchengang“) und die Zeichnung **ausblenden**, damit die Spieler sie nicht sehen.
3. Beim NSC unter **Wegfindung** „Bevorzugt über gezeichnete Wege“ wählen und die Wege ankreuzen.

Der NSC benutzt die Wege dann wie Gänge. Bis zum Weg und vom Weg zum Ziel findet er selbst hin. Für die **Patrouille** wählst du den Weg direkt aus, jeder Punkt der Linie ist ein Halt.

**Karte verlassen:** Punkte des Patrouillenwegs dürfen im grauen Rand **außerhalb der Karte** liegen. Die Wache läuft dann z. B. durchs Stadttor hinaus, wird am Kartenrand **unsichtbar**, wartet draußen und taucht beim Zurückkommen am Rand wieder auf. Mit dem Haken „Außerhalb der Karte unsichtbar“ (Patrouille, Standard an) schaltest du das Ausblenden ab. Token, die du selbst versteckt hast, blendet das Modul nie ein.

## Sprechblasen

- Jede Situation hat eigene Sätze: am Tisch, an der Theke, unterwegs (nur Bedienung), Leerlauf, Patrouille.
- **Keine Dauerwiederholung:** Jeder NSC zieht Sätze wie aus einem gemischten Beutel. Erst wenn alle einmal dran waren, wird neu gemischt, und derselbe Satz kommt nie zweimal hintereinander.
- **Eigene Sätze:** im Einstellungsfenster, einer pro Zeile. Mit „Standardsätze mitverwenden“ entscheidest du, ob die mitgelieferten Sätze dazukommen.
- **Wichtige Sätze:** Gerüchte oder Hinweise für die Gruppe. Sie werden mit dem eingestellten Anteil bevorzugt eingestreut, egal wo der NSC gerade steht.
- **Sofort sagen:** Im Einstellungsfenster einen Satz eintippen und **Sagen** drücken – der NSC sagt ihn sofort.
- Spieler sehen eine Sprechblase nur, wenn sie den Token auch sehen können.

## Steuerung

- **Token-HUD (Rechtsklick auf den Token):** 🚶 öffnet die Einstellungen. Darunter ⏸ **pausiert** den NSC sofort – auch mitten im Laufen. ▶ setzt ihn fort, und er macht genau dort weiter, wo er war (z. B. beim selben Patrouillenpunkt).
- **Token-Leiste links:** Knopf „NSC-Belebung an/aus“ (Hauptschalter für alle) und „Übersicht“.
- **Übersicht:** alle NSCs der Szene mit aktuellem Status („geht zu Tisch 2“, „pausiert (SL)“ …). Pro NSC: ⏸/▶ pausieren/fortsetzen, ⏻ Verhalten ein/aus, ⚙ einstellen.
- **Tot oder bewusstlos:** Hat der Token den Status *Tot* oder *Bewusstlos* oder 0 TP, wird er sofort **pausiert**. Solange er tot ist, ist der Fortsetzen-Knopf ausgegraut. Wird er geheilt oder wiederbelebt, **bleibt er pausiert**, bis du ihn selbst mit ▶ fortsetzt.
- Schiebst du einen NSC selbst, macht er 15 Sekunden Pause und läuft dann von dort weiter.
- Bei **Spielpause** und während eines **Kampfes** bleiben alle sofort stehen – auch mitten auf dem Weg, spätestens am Ende des Feldes, auf dem sie gerade laufen. Danach geht es von dort weiter (beides abschaltbar).

## Moduleinstellungen

| Einstellung | Standard |
|---|---|
| Belebung aktiv | an |
| Bei Spielpause anhalten | an |
| Im Kampf anhalten | an |
| NSCs benutzen Geheimtüren | aus |
| Geplante Wege anzeigen (nur SL) | aus – zeigt den geplanten Weg als orange Linie, Türdurchgänge blau |

## Gut zu wissen

- Gesteuert wird alles vom **SL-Client**. Die NSCs laufen nur in der Szene, die der SL gerade offen hat, und nur solange ein SL eingeloggt ist.
- Die Einstellungen hängen am **Token in der Szene**, nicht am Actor. Kopierst du den Token, kopierst du das Verhalten mit.
