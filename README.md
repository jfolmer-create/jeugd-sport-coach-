# Teamplanner Jeugdvoetbal

Een web-app voor coaches van jeugdteams. Hij werkt op telefoon en computer en je kunt hem op je beginscherm zetten.

- **Spelers** met hun posities, en per gezin wat de ouders kunnen doen: rijden (met het aantal plekken), grensrechter en wassen.
- **Wedstrijden** invoeren of in één keer plakken vanaf de clubsite. De app rekent de verzameltijd uit (standaard 45 minuten voor de aftrap). Bij uitwedstrijden berekent hij de reistijd (OpenStreetMap) en de vertrektijd vanaf het eigen sportcomplex, altijd naar beneden afgerond op 5 minuten.
- **Taakschema**: met één knop eerlijk verdeeld over het seizoen, rekening houdend met afwezigen en wat ieder gezin kan.
- **Wisselschema** per wedstrijd met posities. Kinderen met de minste speelminuten krijgen voorrang, zodat iedereen over het seizoen ongeveer even veel speelt.
- **Kijklink voor ouders**: zij zien de tijden en taken. Is er een nieuw blok wedstrijden, dan opent de coach een *beschikbaarheidsronde*: ouders geven via dezelfde link door wanneer hun kind er niet is (wat ieder gezin kan doen, stelt de coach zelf in bij Spelers). Sluit de coach de ronde, dan worden de taken ingedeeld en vastgezet; daarna ruilen ouders onderling (de coach past het aan via *Taken ruilen*).
- **Wedstrijdmodus** langs het veld: grote klok, wie er bij de volgende wissel in en uit gaat (met trilling en piep), en knoppen voor een andere wissel, een blessure of een speler die later komt. De speelminuten tellen zoals het echt ging.
- **Afgelast of verplaatst**: een afgelaste wedstrijd heeft geen taken en telt niet mee; de beurten schuiven door.
- **Mede-coaches**: nodig je mede-trainer of leider uit met een link; samen werken jullie in hetzelfde team.
- **Werkt zonder bereik**: de app opent ook offline, en wijzigingen worden later alsnog opgeslagen. Slaat iemand anders tussendoor op, dan vraagt de app welke versie je houdt.
- **Eerdere versies**: de app bewaart automatisch versies, dus wat per ongeluk gewist is, zet je terug.
- **Nieuw seizoen**: begin opnieuw met dezelfde spelers, of kopieer spelers naar een ander team.
- Elke coach logt in met zijn e-mailadres en kan meerdere teams beheren. Bij een nieuw team zoek je je club op in de lijst van voetbalclubs; adres en wedstrijdvorm (op basis van de leeftijdscategorie) worden dan ingevuld.

Clubs, adressen en routes komen uit OpenStreetMap (© OpenStreetMap-bijdragers, ODbL) via Overpass, Nominatim en OSRM.

## Hoe het werkt

Het is een statische website (HTML, CSS en JavaScript, zonder build-stap) die via GitHub Pages online staat. De gegevens staan in [Supabase](https://supabase.com), een gratis online database. Is Supabase niet ingesteld, dan werkt de app ook, maar blijven de gegevens in de browser.

| Bestand | Wat |
|---|---|
| `index.html` | De pagina |
| `js/app.js` | De app: schermen, planner voor taken en wissels, opslag |
| `js/config.js` | Adres en publieke sleutel van je Supabase-project |
| `css/style.css` | Opmaak (licht en donker) |
| `supabase/schema.sql` | Tabellen, beveiliging, mede-coaches, versies en de functie voor de kijklink |
| `sw.js` | Bewaart de app zodat hij ook zonder internet opent |
| `privacy.html` | Uitleg voor ouders en coaches: wat de app bewaart en wie wat ziet |
| `fonts/` | Lettertypes in de app zelf (geen Google Fonts) |
| `tests/` | Tests voor de planners en de schermen (`npm install` en dan `npm test`) |

## Installeren (één keer)

### 1. Supabase
1. Maak een gratis account op supabase.com en een nieuw project (regio Frankfurt).
2. Open **SQL Editor → New query**, plak de inhoud van `supabase/schema.sql` en klik op **Run**. Doe dit opnieuw na elke update van dit bestand; het script kan veilig vaker draaien.
3. Ga naar **Authentication → URL Configuration**:
   - *Site URL*: `https://jfolmer-create.github.io/jeugd-sport-coach-/`
   - *Redirect URLs*: voeg hetzelfde adres toe.
4. **Eigen mailserver (nodig zodra andere coaches de app gebruiken).** De ingebouwde mail van Supabase stuurt maar een paar mails per uur en, voor zover bekend, alleen naar e-mailadressen van je eigen Supabase-team. Zo stel je een gratis mailserver in, bijvoorbeeld met Brevo:
   1. Maak een gratis account op brevo.com en bevestig bij *Senders* het afzenderadres dat je wilt gebruiken.
   2. Ga in Brevo naar *SMTP & API* → *SMTP* en maak een SMTP-sleutel.
   3. In Supabase: **Authentication → Emails → SMTP Settings**, zet *Enable custom SMTP* aan en vul in: host `smtp-relay.brevo.com`, poort `587`, gebruikersnaam = je Brevo-login (staat op dezelfde pagina), wachtwoord = de SMTP-sleutel, afzender = het bevestigde adres, afzendernaam `Teamplanner`.
   4. Zet bij **Authentication → Rate Limits** het aantal mails per uur hoger, bijvoorbeeld 30.
   5. Test het door met een ander e-mailadres in te loggen.
5. Optioneel, alleen met eigen SMTP (zie Privacy): zet in **Authentication → Emails → Magic Link** de regel `<p>Je code: {{ .Token }}</p>`. Dan kun je ook inloggen met een code in plaats van de link.
6. Kopieer bij **Project Settings → API** de *Project URL* en de *anon / publishable key* naar `js/config.js`. Gebruik nooit de *service_role* of *secret* key: die geeft volledige toegang.

### 2. GitHub Pages
In de repository: **Settings → Pages → Build and deployment → Deploy from a branch**, kies `main` en `/ (root)`. Na een minuut staat de app op `https://jfolmer-create.github.io/jeugd-sport-coach-/`.

## Privacy
Zie ook [privacy.html](privacy.html), de uitleg voor ouders en coaches.
- Een coach ziet alleen de teams waarvan hij eigenaar of mede-coach is (Row Level Security in Supabase).
- De kijklink bevat een lang willekeurig token. Wie de link heeft, ziet de wedstrijden, tijden, taken en de namen van spelers en ouders. De database stuurt geen wisselschema's, speelminuten, posities, trainingsopkomst of wat gezinnen wel of niet kunnen mee. Via Instellingen maak je een nieuwe link; de oude werkt dan niet meer.
- Het logo en de teamfoto staan openbaar online. Vraag ouders toestemming voor een teamfoto.
- Coaches kunnen bij Instellingen een team verwijderen of hun account opheffen.

## Gratis Supabase gaat op pauze
Een gratis Supabase-project wordt stilgezet na ongeveer een week zonder gebruik. De GitHub-taak *Supabase wakker houden* (`.github/workflows/supabase-wakker.yml`) doet elke drie dagen een klein verzoek om dat te voorkomen. Het gratis plan maakt geen back-ups die je zelf kunt terugzetten; de app bewaart daarom zelf eerdere versies per team. Gaan veel teams de app gebruiken, overweeg dan het betaalde plan (Pro).

## Lokaal draaien
Elke eenvoudige webserver werkt, bijvoorbeeld `python3 -m http.server` in deze map. Open daarna http://localhost:8000.
