# Ascandir - DnD5e NPC Behavior Automation

Foundry VTT v13/v14 · dnd5e 5.x/6.x · eingestellt wird nur vom SL

Belebt deine Szenen: Eine Bedienung geht von besetztem Tisch zu besetztem Tisch und zurück zur Theke, eine Wache läuft ihre Runde, Gäste schlendern umher – und alle sagen dabei abwechslungsreiche Sätze in Sprechblasen.

## Installation

Manifest-URL in Foundry (Module installieren):

```
https://github.com/Ascandir/Ascandir---DnD5e-NPC-Behavior-Automation/releases/latest/download/module.json
```

## Schnellstart: belebte Taverne

1. **Tische markieren:** Links das Werkzeug **Regionen** wählen und um jeden Tisch (mit Stühlen) ein Rechteck ziehen. Region benennen, z. B. „Tisch 1“, „Tisch 2“.
2. **Theke markieren:** Genauso eine Region „Theke“ ziehen – dort, wo die Bedienung ihre Bestellungen abholt.
3. **Bedienung einstellen:** Rechtsklick auf den Token der Bedienung → Knopf mit dem laufenden Männchen (🚶).
   - Verhalten aktiv: ✔
   - Verhalten: **Bedienung**
   - Tische ankreuzen, Theke auswählen → **Speichern**
4. Fertig. Setzt sich ein Spieler (oder ein Gäste-NSC) an einen Tisch, kommt die Bedienung vorbei, wartet ein bisschen, geht zur Theke und weiter.

Ein Tisch ist **besetzt**, sobald ein sichtbarer Token in seiner Region steht. NSCs, die selbst gerade laufen (Bedienung, Patrouille, Umherschlendern), zählen nicht als Gäste. NSCs mit „Stehen & Reden“ zählen als Gäste.

## Verhalten

| Verhalten | Was passiert |
|---|---|
| **Bedienung** | Geht zu besetzten Tischen (der am längsten nicht besuchte zuerst), wartet, geht meist zur Theke, dann zum nächsten Tisch. Sind alle Tische leer, wartet sie an der Theke. |
| **Patrouille** | Läuft einen gezeichneten Weg ab – als Rundgang oder hin und zurück. Wartet an jedem Punkt kurz, ab und zu länger. |
| **Umherschlendern** | Geht in einer Region zu zufälligen freien Stellen und bleibt dort eine Weile. Gut für Gäste, Händler, Kinder auf dem Marktplatz. |
| **Stehen & Reden** | Bleibt stehen und sagt ab und zu etwas. Gut für den Wirt hinter der Theke. |

## Wege finden

**Automatisch (Standard):** Der NSC sucht selbst einen Weg um Wände herum. Muss er in einen anderen Raum, nimmt er die nächste Tür oder Lücke. Geschlossene Türen öffnet er und schließt sie hinter sich wieder. **Verschlossene** Türen benutzt er nie, Geheimtüren nur, wenn du es in den Moduleinstellungen erlaubst.

**Gezeichnete Wege (optional):** Du kannst Wege selbst vorgeben:

1. Werkzeug **Zeichnungen** → **Polygon** (oder Freihand) und den Weg Punkt für Punkt durch die Szene klicken.
2. Tipp: In der Zeichnung unter **Text** einen Namen eintragen (z. B. „Küchengang“) und die Zeichnung **ausblenden**, damit die Spieler sie nicht sehen.
3. Beim NSC unter **Wegfindung** „Bevorzugt über gezeichnete Wege“ wählen und die Wege ankreuzen.

Der NSC benutzt die Wege dann wie Gänge. Bis zum Weg und vom Weg zum Ziel findet er selbst hin. Für die **Patrouille** wählst du den Weg direkt aus, jeder Punkt der Linie ist ein Halt.

## Sprechblasen

- Jede Situation hat eigene Sätze: am Tisch, an der Theke, unterwegs (nur Bedienung), Leerlauf, Patrouille.
- **Keine Dauerwiederholung:** Jeder NSC zieht Sätze wie aus einem gemischten Beutel. Erst wenn alle einmal dran waren, wird neu gemischt, und derselbe Satz kommt nie zweimal hintereinander.
- **Eigene Sätze:** im Einstellungsfenster, einer pro Zeile. Mit „Standardsätze mitverwenden“ entscheidest du, ob die mitgelieferten Sätze dazukommen.
- **Wichtige Sätze:** Gerüchte oder Hinweise für die Gruppe. Sie werden mit dem eingestellten Anteil bevorzugt eingestreut, egal wo der NSC gerade steht.
- **Sofort sagen:** Im Einstellungsfenster einen Satz eintippen und **Sagen** drücken – der NSC sagt ihn sofort.
- Spieler sehen eine Sprechblase nur, wenn sie den Token auch sehen können.

## Steuerung

- **Token-Leiste links:** Knopf „NSC-Belebung an/aus“ (Hauptschalter) und „Übersicht“.
- **Übersicht:** alle NSCs der Szene mit aktuellem Status („geht zu Tisch 2“, „an der Theke“ …), Start/Pause und Einstellen.
- Schiebst du einen NSC selbst, macht er 15 Sekunden Pause und läuft dann von dort weiter.
- Bei **Spielpause** und während eines **Kampfes** bleiben alle stehen (beides abschaltbar).

## Moduleinstellungen

| Einstellung | Standard |
|---|---|
| Belebung aktiv | an |
| Bei Spielpause anhalten | an |
| Im Kampf anhalten | an |
| Türen hinter sich schließen | an |
| NSCs benutzen Geheimtüren | aus |
| Geplante Wege anzeigen (nur SL) | aus – zeigt den geplanten Weg als orange Linie, Türdurchgänge blau |

## Gut zu wissen

- Gesteuert wird alles vom **SL-Client**. Die NSCs laufen nur in der Szene, die der SL gerade offen hat, und nur solange ein SL eingeloggt ist.
- Die Einstellungen hängen am **Token in der Szene**, nicht am Actor. Kopierst du den Token, kopierst du das Verhalten mit.
